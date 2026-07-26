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
import * as NavigationBar from 'expo-navigation-bar';
import {
  Camera,
  CommonResolutions,
  useCameraDevice,
  useCameraPermission,
  useMicrophonePermission,
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

  // Hide the Android navigation bar while on the recorder screen (immersive),
  // so long lines aren't clipped by it and the frame is uncluttered.
  useEffect(() => {
    NavigationBar.setVisibilityAsync('hidden').catch(() => {});
    return () => {
      NavigationBar.setVisibilityAsync('visible').catch(() => {});
    };
  }, []);

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
    // Android's recognizer stops on pauses — restart to stay continuous, with a
    // small delay so it can't tight-loop if the mic is unavailable.
    if (listeningRef.current) {
      setTimeout(() => {
        if (!listeningRef.current) return;
        try {
          startRecognizer();
        } catch (e) {
          // ignore
        }
      }, 350);
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
      setStatus('Preparing recorder…');
      if (!videoOutput) throw new Error('video output not ready');
      const recorder = await videoOutput.createRecorder({});
      recorderRef.current = recorder;
      setStatus('Starting recording…');
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
          setStatus(`Recording error: ${error?.message || error}`);
        }
      );
      setStatus('');
      setPhase('recording');
      setRecording(true);
      // Start voice tracking so the script follows the speaker during the take.
      // (Recording started first so the video keeps its audio even if the phone
      // won't let the recognizer share the mic.)
      startListening();
    } catch (e) {
      recorderRef.current = null;
      setPhase('idle');
      setStatus(`Couldn’t start recording: ${e?.message || e}`);
    }
  }

  // Stop = pause: hold the recording but stay on-screen so the user can resume
  // (tap Record again) or Save.
  async function pauseTake() {
    stopListening();
    setRecording(false);
    setPhase('paused');
    try {
      if (recorderRef.current) await recorderRef.current.pauseRecording();
    } catch (e) {
      setStatus(`Pause failed: ${e?.message || e}`);
    }
  }

  async function resumeTake() {
    setPhase('recording');
    setRecording(true);
    try {
      if (recorderRef.current) await recorderRef.current.resumeRecording();
      startListening();
    } catch (e) {
      setStatus(`Resume failed: ${e?.message || e}`);
    }
  }

  // Finalize the take and go to the review/save screen.
  async function saveTake() {
    stopListening();
    setStatus('Finishing…');
    try {
      if (recorderRef.current) await recorderRef.current.stopRecording();
    } catch (e) {
      setStatus(`Save failed: ${e?.message || e}`);
    }
  }

  async function discardAndExit() {
    stopListening();
    try {
      if (recorderRef.current) await recorderRef.current.cancelRecording();
    } catch (e) {
      // ignore
    }
    recorderRef.current = null;
    onExit();
  }

  function onRecordPress() {
    if (phase === 'recording') pauseTake();
    else if (phase === 'paused') resumeTake();
    else if (phase === 'countdown') cancelCountdown.current = true;
    else beginTake();
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
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            // Mirror the preview (selfie feel) and, in landscape, rotate the
            // *preview only* 180° — the saved recording is already upright, so
            // this transform never touches the file.
            transform: [
              ...(settings.mirrorPreview ? [{ scaleX: -1 }] : []),
              ...(layout.width > layout.height ? [{ rotate: '180deg' }] : []),
            ],
          },
        ]}
      >
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          outputs={[videoOutput]}
          isActive
          mirrorMode="off"
          orientationSource="device"
          implementationMode="compatible"
          onError={(e) => setStatus(`Camera: ${e?.message || 'error'}`)}
          onStarted={() => setStatus('')}
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
      <View
        style={[
          styles.topBar,
          {
            paddingTop: insets.top + spacing.sm,
            paddingLeft: spacing.md + insets.left,
            paddingRight: spacing.md + insets.right,
          },
        ]}
        pointerEvents="box-none"
      >
        <Pressable style={styles.topBtn} onPress={discardAndExit} hitSlop={10}>
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

        <View style={{ width: 40 }} />
      </View>

      {/* Status line */}
      {status ? (
        <View style={styles.statusWrap} pointerEvents="none">
          <Text style={styles.statusText}>{status}</Text>
        </View>
      ) : null}

      {/* Bottom control — a single Record / Stop button. */}
      <View
        style={[
          styles.bottomBar,
          {
            paddingBottom: insets.bottom + spacing.md,
            paddingLeft: spacing.lg + insets.left,
            paddingRight: spacing.lg + insets.right,
          },
        ]}
        pointerEvents="box-none"
      >
        {phase === 'paused' && (
          <Pressable style={[styles.pill, styles.pillSave]} onPress={saveTake}>
            <Text style={styles.pillText}>Save</Text>
          </Pressable>
        )}

        <Pressable style={[styles.pill, styles.pillRecord]} onPress={onRecordPress}>
          <View style={phase === 'recording' ? styles.iconSquare : styles.iconCircle} />
          <Text style={styles.pillText}>
            {phase === 'recording' ? 'Stop' : phase === 'countdown' ? 'Cancel' : 'Record'}
          </Text>
        </Pressable>
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
    top: 100,
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 20,
  },
  statusText: {
    color: '#fff',
    backgroundColor: 'rgba(200,30,30,0.92)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.md,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    overflow: 'hidden',
  },

  speed: {
    minWidth: 84,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  speedBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedBtnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  speedLabelWrap: { alignItems: 'center', minWidth: 34 },
  speedValue: { color: '#fff', fontSize: 14, fontWeight: '800' },
  speedUnit: { color: '#cbd2dc', fontSize: 9, fontWeight: '700', marginTop: -2 },

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
    justifyContent: 'center',
    gap: spacing.md,
    zIndex: 10,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minWidth: 150,
    paddingVertical: 15,
    paddingHorizontal: 24,
    borderRadius: radius.pill,
  },
  pillRecord: { backgroundColor: colors.danger },
  pillSave: { backgroundColor: colors.success },
  pillText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  iconCircle: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  iconSquare: { width: 16, height: 16, borderRadius: 3, backgroundColor: '#fff' },
});
