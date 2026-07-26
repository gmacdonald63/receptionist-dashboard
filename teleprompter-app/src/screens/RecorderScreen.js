// The recording screen: full-screen front-camera preview with the teleprompter
// overlaid on top, plus the record/practice/pause controls and the voice
// tracking that scrolls the script as you speak.
//
// The teleprompter text is a UI overlay only — VisionCamera records the raw
// sensor feed with mirrorMode 'off', so the saved file is clean (no text) and
// un-mirrored regardless of the mirrored on-screen preview.
//
// Uses VisionCamera v5's outputs API: a preview output + a video output whose
// Recorder handles start/stop.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import {
  Camera,
  CommonResolutions,
  useCameraDevice,
  useCameraPermission,
  useMicrophonePermission,
  usePreviewOutput,
  useVideoOutput,
} from 'react-native-vision-camera';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

import Teleprompter from '../components/Teleprompter';
import { advancePointer, newWordsFromTranscript, tokenize } from '../voice';
import { colors, radius, spacing } from '../theme';

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function RecorderScreen({ script, settings, onExit, onFinish }) {
  useKeepAwake();
  const insets = useSafeAreaInsets();

  const tokens = useMemo(() => tokenize(script?.body || ''), [script]);

  const device = useCameraDevice('front');
  const previewOutput = usePreviewOutput();
  const targetResolution =
    settings.targetResolution === 'uhd'
      ? CommonResolutions.UHD_16_9
      : CommonResolutions.FHD_16_9;
  const videoOutput = useVideoOutput({ targetResolution, enableAudio: true });

  const { hasPermission: hasCam, requestPermission: reqCam } = useCameraPermission();
  const { hasPermission: hasMic, requestPermission: reqMic } = useMicrophonePermission();

  const recorderRef = useRef(null);

  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [phase, setPhase] = useState('idle'); // 'idle' | 'countdown' | 'recording'
  const [countNum, setCountNum] = useState(0);
  const [recording, setRecording] = useState(false);
  const [listening, setListening] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pointer, setPointer] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState('');

  // Refs mirror state for use inside the speech event callbacks.
  const pointerRef = useRef(0);
  const consumedRef = useRef(0);
  const listeningRef = useRef(false);
  const pausedRef = useRef(false);
  const cancelCountdown = useRef(false);
  useEffect(() => {
    pointerRef.current = pointer;
  }, [pointer]);
  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Ask for camera + mic up front.
  useEffect(() => {
    if (!hasCam) reqCam();
    if (!hasMic) reqMic();
  }, [hasCam, hasMic, reqCam, reqMic]);

  // Apply the orientation lock preference.
  useEffect(() => {
    (async () => {
      try {
        if (settings.orientationLock === 'portrait') {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        } else if (settings.orientationLock === 'landscape') {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        } else {
          await ScreenOrientation.unlockAsync();
        }
      } catch (e) {
        // ignore
      }
    })();
    return () => {
      ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, [settings.orientationLock]);

  // Recording timer.
  useEffect(() => {
    if (!recording) return;
    setElapsed(0);
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  // ---- Speech recognition events -------------------------------------------
  useSpeechRecognitionEvent('result', (e) => {
    if (!listeningRef.current || pausedRef.current) return;
    const transcript = e.results?.[0]?.transcript || '';
    const { newWords, consumed } = newWordsFromTranscript(transcript, consumedRef.current);
    consumedRef.current = consumed;
    if (newWords.length) {
      const next = advancePointer(tokens, pointerRef.current, newWords);
      if (next !== pointerRef.current) {
        pointerRef.current = next;
        setPointer(next);
      }
    }
  });

  useSpeechRecognitionEvent('end', () => {
    consumedRef.current = 0;
    // Android's recognizer stops on pauses — restart to stay continuous.
    if (listeningRef.current) {
      try {
        startRecognizer();
      } catch (e) {
        // ignore
      }
    }
  });

  useSpeechRecognitionEvent('error', (e) => {
    if (e?.error && e.error !== 'no-speech') {
      setStatus(`Voice: ${e.error}`);
    }
  });

  function startRecognizer() {
    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: false,
      addsPunctuation: false,
    });
  }

  async function startListening() {
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        setStatus('Speech permission denied — scroll won’t follow your voice.');
        return;
      }
      consumedRef.current = 0;
      listeningRef.current = true;
      setListening(true);
      setStatus('');
      startRecognizer();
    } catch (e) {
      setStatus('Could not start voice tracking.');
    }
  }

  function stopListening() {
    listeningRef.current = false;
    setListening(false);
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch (e) {
      // ignore
    }
  }

  function resetToTop() {
    pointerRef.current = 0;
    consumedRef.current = 0;
    setPointer(0);
    setPaused(false);
  }

  // ---- Recording lifecycle -------------------------------------------------
  async function beginTake() {
    resetToTop();
    cancelCountdown.current = false;
    if (settings.countdown > 0) {
      setPhase('countdown');
      for (let n = settings.countdown; n > 0; n--) {
        if (cancelCountdown.current) {
          setPhase('idle');
          return;
        }
        setCountNum(n);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (cancelCountdown.current) {
      setPhase('idle');
      return;
    }
    try {
      const recorder = await videoOutput.createRecorder({});
      recorderRef.current = recorder;
      await recorder.startRecording(
        (filePath) => {
          recorderRef.current = null;
          setRecording(false);
          setPhase('idle');
          onFinish({ path: filePath });
        },
        (error) => {
          recorderRef.current = null;
          setRecording(false);
          setPhase('idle');
          setStatus(`Recording error: ${error?.message || 'unknown'}`);
        }
      );
      setPhase('recording');
      setRecording(true);
      if (settings.voiceTracking) startListening();
    } catch (e) {
      recorderRef.current = null;
      setPhase('idle');
      setStatus(`Could not start recording: ${e?.message || e}`);
    }
  }

  async function endTake() {
    stopListening();
    try {
      if (recorderRef.current) await recorderRef.current.stopRecording();
    } catch (e) {
      setRecording(false);
      setPhase('idle');
    }
  }

  function togglePractice() {
    if (recording) return;
    if (listening) {
      stopListening();
    } else {
      resetToTop();
      startListening();
    }
  }

  function onRecordPress() {
    if (recording) endTake();
    else if (phase === 'countdown') {
      cancelCountdown.current = true;
    } else beginTake();
  }

  // ---- Permission / device gates -------------------------------------------
  if (!hasCam || !hasMic) {
    return (
      <View style={styles.gate}>
        <Text style={styles.gateTitle}>Camera & microphone needed</Text>
        <Text style={styles.gateText}>
          The teleprompter needs the camera to record and the microphone to follow your voice.
        </Text>
        <Pressable
          style={styles.gateBtn}
          onPress={() => {
            reqCam();
            reqMic();
          }}
        >
          <Text style={styles.gateBtnText}>Grant access</Text>
        </Pressable>
        <Pressable style={styles.gateLink} onPress={onExit}>
          <Text style={styles.gateLinkText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.gate}>
        <Text style={styles.gateTitle}>No front camera found</Text>
        <Pressable style={styles.gateLink} onPress={onExit}>
          <Text style={styles.gateLinkText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root} onLayout={(e) => setLayout(e.nativeEvent.layout)}>
      {/* Mirrored preview (scaleX flips the on-screen view only; mirrorMode
          'off' keeps the recorded file un-mirrored). */}
      <View style={[StyleSheet.absoluteFill, settings.mirrorPreview ? styles.mirror : null]}>
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          outputs={[previewOutput, videoOutput]}
          isActive
          mirrorMode="off"
        />
      </View>

      {/* Teleprompter overlay */}
      {layout.height > 0 && (
        <Teleprompter
          tokens={tokens}
          pointer={pointer}
          settings={settings}
          height={layout.height}
          width={layout.width}
          paused={paused}
          onResync={(i) => {
            pointerRef.current = i;
            setPointer(i);
          }}
        />
      )}

      {/* Countdown overlay */}
      {phase === 'countdown' && (
        <View style={styles.countdown} pointerEvents="none">
          <Text style={styles.countNum}>{countNum}</Text>
        </View>
      )}

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
        <Pressable style={styles.topBtn} onPress={onExit} hitSlop={10}>
          <Text style={styles.topBtnText}>✕</Text>
        </Pressable>

        {recording ? (
          <View style={styles.recPill}>
            <View style={styles.recDot} />
            <Text style={styles.recTime}>{fmtTime(elapsed)}</Text>
          </View>
        ) : (
          <View />
        )}

        <View style={styles.topRight} pointerEvents="box-none">
          <Pressable style={styles.topBtn} onPress={resetToTop} hitSlop={10}>
            <Text style={styles.topBtnText}>⟲</Text>
          </Pressable>
          <Pressable
            style={[styles.topBtn, listening && !recording && styles.topBtnActive]}
            onPress={togglePractice}
            hitSlop={10}
          >
            <Text style={styles.topBtnLabel}>Practice</Text>
          </Pressable>
        </View>
      </View>

      {/* Status line */}
      {status ? (
        <View style={styles.statusWrap} pointerEvents="none">
          <Text style={styles.statusText}>{status}</Text>
        </View>
      ) : null}

      {/* Bottom controls */}
      <View
        style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.md }]}
        pointerEvents="box-none"
      >
        <Pressable style={styles.sideBtn} onPress={() => setPaused((p) => !p)} hitSlop={10}>
          <Text style={styles.sideBtnText}>{paused ? 'Resume' : 'Pause'}</Text>
        </Pressable>

        <Pressable style={styles.recordOuter} onPress={onRecordPress}>
          <View style={[styles.recordInner, recording && styles.recordInnerStop]} />
        </Pressable>

        <View style={styles.sideBtn} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  mirror: { transform: [{ scaleX: -1 }] },

  gate: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  gateTitle: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  gateText: {
    color: colors.textDim,
    fontSize: 15,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 21,
  },
  gateBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  gateBtnText: { color: colors.accentText, fontSize: 16, fontWeight: '800' },
  gateLink: { marginTop: spacing.md, padding: spacing.sm },
  gateLinkText: { color: colors.textDim, fontSize: 15 },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 44,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  topBtn: {
    minWidth: 40,
    height: 40,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBtnActive: { backgroundColor: colors.accent },
  topBtnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  topBtnLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },

  recPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
  recTime: { color: '#fff', fontSize: 14, fontWeight: '700' },

  statusWrap: {
    position: 'absolute',
    top: 92,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  statusText: {
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
    fontSize: 13,
    overflow: 'hidden',
  },

  countdown: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  countNum: { color: '#fff', fontSize: 120, fontWeight: '900' },

  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: 40,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sideBtn: {
    minWidth: 84,
    height: 44,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  recordOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.danger,
  },
  recordInnerStop: {
    width: 34,
    height: 34,
    borderRadius: 6,
  },
});
