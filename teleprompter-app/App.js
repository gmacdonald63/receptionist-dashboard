// Teleprompter — a personal front-camera video recorder with a voice-driven
// teleprompter overlay. State-based navigation (no router lib) between the
// script library, settings, recorder, and review screens.

import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ScriptsScreen from './src/screens/ScriptsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import RecorderScreen from './src/screens/RecorderScreen';
import ReviewScreen from './src/screens/ReviewScreen';
import {
  DEFAULT_SETTINGS,
  deleteScript,
  loadScripts,
  loadSettings,
  saveSettings,
  upsertScript,
} from './src/storage';
import { colors } from './src/theme';

export default function App() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState('scripts'); // scripts | settings | record | review
  const [scripts, setScripts] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [activeScript, setActiveScript] = useState(null);
  const [lastVideo, setLastVideo] = useState(null);

  useEffect(() => {
    (async () => {
      const [s, cfg] = await Promise.all([loadScripts(), loadSettings()]);
      setScripts(s);
      setSettings(cfg);
      setReady(true);
    })();
  }, []);

  const refreshScripts = useCallback(async () => {
    setScripts(await loadScripts());
  }, []);

  const handleSaveScript = useCallback(
    async (script) => {
      await upsertScript(script);
      await refreshScripts();
    },
    [refreshScripts]
  );

  const handleDeleteScript = useCallback(async (id) => {
    const next = await deleteScript(id);
    setScripts(next);
  }, []);

  const handleChangeSettings = useCallback((next) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const startRecording = useCallback((script) => {
    setActiveScript(script);
    setScreen('record');
  }, []);

  if (!ready) {
    return (
      <SafeAreaProvider>
        <View style={styles.loading}>
          <StatusBar style="light" />
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar style="light" hidden={screen === 'record'} />

      {screen === 'scripts' && (
        <ScriptsScreen
          scripts={scripts}
          onSave={handleSaveScript}
          onDelete={handleDeleteScript}
          onRecord={startRecording}
          onOpenSettings={() => setScreen('settings')}
        />
      )}

      {screen === 'settings' && (
        <SettingsScreen
          settings={settings}
          onChange={handleChangeSettings}
          onBack={() => setScreen('scripts')}
        />
      )}

      {screen === 'record' && (
        <RecorderScreen
          script={activeScript}
          settings={settings}
          onChangeSettings={handleChangeSettings}
          onExit={() => setScreen('scripts')}
          onFinish={(video) => {
            setLastVideo(video);
            setScreen('review');
          }}
        />
      )}

        {screen === 'review' && (
          <ReviewScreen
            video={lastVideo}
            onRetake={() => setScreen('record')}
            onDone={() => setScreen('scripts')}
          />
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
