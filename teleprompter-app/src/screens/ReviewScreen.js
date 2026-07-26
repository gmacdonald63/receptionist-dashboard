// Review a finished take: play it back, save it to the gallery, share it, or
// discard and record again.

import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../theme';

function toUri(path) {
  if (!path) return path;
  return path.startsWith('file://') || path.startsWith('content://') ? path : `file://${path}`;
}

export default function ReviewScreen({ video, onRetake, onDone }) {
  const insets = useSafeAreaInsets();
  const uri = toUri(video?.path);
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
  });

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState('');

  async function saveToGallery() {
    try {
      setSaving(true);
      setMsg('');
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        setMsg('Gallery permission denied.');
        setSaving(false);
        return;
      }
      await MediaLibrary.saveToLibraryAsync(uri);
      setSaved(true);
      setMsg('Saved to your gallery.');
    } catch (e) {
      setMsg(`Could not save: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  }

  async function share() {
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setMsg('Sharing is not available on this device.');
        return;
      }
      await Sharing.shareAsync(uri, { mimeType: 'video/mp4' });
    } catch (e) {
      setMsg(`Could not share: ${e?.message || e}`);
    }
  }

  return (
    <View style={[styles.root, { paddingLeft: insets.left, paddingRight: insets.right }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.headerTitle}>Review take</Text>
      </View>

      <View style={styles.videoWrap}>
        {uri ? (
          <VideoView
            style={styles.video}
            player={player}
            contentFit="contain"
            allowsFullscreen
            nativeControls
          />
        ) : (
          <Text style={styles.noVideo}>No recording to show.</Text>
        )}
      </View>

      {msg ? <Text style={styles.msg}>{msg}</Text> : null}

      <View style={[styles.actions, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable
          style={[styles.btn, styles.btnPrimary, (saving || saved) && styles.btnDisabled]}
          onPress={saveToGallery}
          disabled={saving || saved}
        >
          {saving ? (
            <ActivityIndicator color={colors.accentText} />
          ) : (
            <Text style={styles.btnPrimaryText}>{saved ? '✓ Saved' : 'Save to gallery'}</Text>
          )}
        </Pressable>

        <Pressable style={[styles.btn, styles.btnSecondary]} onPress={share}>
          <Text style={styles.btnSecondaryText}>Share</Text>
        </Pressable>

        <View style={styles.bottomRow}>
          <Pressable style={styles.textBtn} onPress={onRetake}>
            <Text style={styles.textBtnText}>Record again</Text>
          </Pressable>
          <Pressable style={styles.textBtn} onPress={onDone}>
            <Text style={[styles.textBtnText, { color: colors.accent }]}>Done</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  headerTitle: { color: colors.text, fontSize: 22, fontWeight: '800' },
  videoWrap: {
    flex: 1,
    margin: spacing.md,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  video: { width: '100%', height: '100%' },
  noVideo: { color: colors.textDim },
  msg: {
    color: colors.textDim,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  actions: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  btn: { borderRadius: radius.pill, paddingVertical: 15, alignItems: 'center' },
  btnPrimary: { backgroundColor: colors.accent },
  btnPrimaryText: { color: colors.accentText, fontSize: 16, fontWeight: '800' },
  btnSecondary: { backgroundColor: colors.surfaceAlt },
  btnSecondaryText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  textBtn: { padding: spacing.sm },
  textBtnText: { color: colors.textDim, fontSize: 16, fontWeight: '700' },
});
