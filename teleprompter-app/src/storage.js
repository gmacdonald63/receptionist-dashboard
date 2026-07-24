// Local persistence for scripts and settings using AsyncStorage.
// Everything lives on-device; nothing is uploaded anywhere.

import AsyncStorage from '@react-native-async-storage/async-storage';

const SCRIPTS_KEY = '@teleprompter/scripts';
const SETTINGS_KEY = '@teleprompter/settings';

export const DEFAULT_SETTINGS = {
  fontSize: 34, // px
  bandPosition: 0.32, // fraction of screen height for the reading band center (default HIGH, near the top camera)
  dimNonActive: false, // OFF by default — all text full brightness, only the band strip marks position
  wordHighlight: false, // OFF by default — highlight the whole current line, not individual words
  mirrorPreview: true, // mirror the on-screen preview (natural selfie feel); the saved file is always un-mirrored
  countdown: 3, // seconds before recording starts
  orientationLock: 'default', // 'default' | 'portrait' | 'landscape'
  targetResolution: 'uhd', // 'uhd' (4K) | 'fhd' (1080p)
  scrollSmoothing: 260, // ms for the scroll animation to settle on a new word
};

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadSettings() {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings) {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    // Non-fatal — settings just won't persist this run.
  }
}

export async function loadScripts() {
  try {
    const raw = await AsyncStorage.getItem(SCRIPTS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

async function persistScripts(list) {
  try {
    await AsyncStorage.setItem(SCRIPTS_KEY, JSON.stringify(list));
  } catch (e) {
    // Non-fatal.
  }
}

export async function upsertScript(script) {
  const list = await loadScripts();
  const now = Date.now();
  if (script.id) {
    const idx = list.findIndex((s) => s.id === script.id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...script, updatedAt: now };
      await persistScripts(list);
      return list[idx];
    }
  }
  const created = {
    id: makeId(),
    title: script.title || 'Untitled script',
    body: script.body || '',
    createdAt: now,
    updatedAt: now,
  };
  list.unshift(created);
  await persistScripts(list);
  return created;
}

export async function deleteScript(id) {
  const list = await loadScripts();
  const next = list.filter((s) => s.id !== id);
  await persistScripts(next);
  return next;
}
