// Settings screen. Plain +/- steppers and segmented toggles so we don't pull
// in an extra native slider dependency.

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../theme';

function Row({ label, hint, children }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLabelWrap}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <View style={styles.rowControl}>{children}</View>
    </View>
  );
}

function Stepper({ value, onChange, min, max, step, format }) {
  const dec = () => onChange(Math.max(min, Math.round((value - step) * 100) / 100));
  const inc = () => onChange(Math.min(max, Math.round((value + step) * 100) / 100));
  return (
    <View style={styles.stepper}>
      <Pressable style={styles.stepBtn} onPress={dec} hitSlop={8}>
        <Text style={styles.stepBtnText}>−</Text>
      </Pressable>
      <Text style={styles.stepValue}>{format ? format(value) : value}</Text>
      <Pressable style={styles.stepBtn} onPress={inc} hitSlop={8}>
        <Text style={styles.stepBtnText}>+</Text>
      </Pressable>
    </View>
  );
}

function Segment({ value, options, onChange }) {
  return (
    <View style={styles.segment}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            style={[styles.segItem, active && styles.segItemActive]}
            onPress={() => onChange(opt.value)}
          >
            <Text style={[styles.segText, active && styles.segTextActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function SettingsScreen({ settings, onChange, onBack }) {
  const set = (patch) => onChange({ ...settings, ...patch });
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingLeft: insets.left, paddingRight: insets.right }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable hitSlop={12} onPress={onBack}>
          <Text style={[styles.headerAction, { color: colors.accent }]}>Done</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 60 }}>
        <Text style={styles.section}>Reading</Text>

        <Row label="Text size">
          <Stepper value={settings.fontSize} onChange={(v) => set({ fontSize: v })} min={20} max={64} step={2} />
        </Row>

        <Row label="Band position" hint="Higher = closer to the camera (better eyeline)">
          <Stepper
            value={settings.bandPosition}
            onChange={(v) => set({ bandPosition: v })}
            min={0.15}
            max={0.6}
            step={0.03}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </Row>

        <Row label="Dim other lines" hint="Fade the lines above/below the band">
          <Switch
            value={settings.dimNonActive}
            onValueChange={(v) => set({ dimNonActive: v })}
            trackColor={{ true: colors.accent }}
          />
        </Row>

        <Row label="Highlight each word" hint="Karaoke-style, off = whole line stays lit">
          <Switch
            value={settings.wordHighlight}
            onValueChange={(v) => set({ wordHighlight: v })}
            trackColor={{ true: colors.accent }}
          />
        </Row>

        <Row label="Follow my voice" hint="Auto-scroll from speech while recording">
          <Switch
            value={settings.voiceTracking}
            onValueChange={(v) => set({ voiceTracking: v })}
            trackColor={{ true: colors.accent }}
          />
        </Row>

        <Row label="Scroll smoothing" hint="How gently the text catches up">
          <Stepper
            value={settings.scrollSmoothing}
            onChange={(v) => set({ scrollSmoothing: v })}
            min={100}
            max={500}
            step={20}
            format={(v) => `${v}ms`}
          />
        </Row>

        <Text style={styles.section}>Camera</Text>

        <Row label="Mirror preview" hint="On-screen only — the saved video is never mirrored">
          <Switch
            value={settings.mirrorPreview}
            onValueChange={(v) => set({ mirrorPreview: v })}
            trackColor={{ true: colors.accent }}
          />
        </Row>

        <Row label="Resolution">
          <Segment
            value={settings.targetResolution}
            onChange={(v) => set({ targetResolution: v })}
            options={[
              { value: 'uhd', label: '4K' },
              { value: 'fhd', label: '1080p' },
            ]}
          />
        </Row>

        <Row label="Orientation">
          <Segment
            value={settings.orientationLock}
            onChange={(v) => set({ orientationLock: v })}
            options={[
              { value: 'default', label: 'Auto' },
              { value: 'portrait', label: 'Portrait' },
              { value: 'landscape', label: 'Land' },
            ]}
          />
        </Row>

        <Row label="Countdown" hint="Seconds before recording starts">
          <Stepper
            value={settings.countdown}
            onChange={(v) => set({ countdown: v })}
            min={0}
            max={10}
            step={1}
            format={(v) => `${v}s`}
          />
        </Row>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  headerAction: { fontSize: 16, fontWeight: '700' },
  section: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    minHeight: 58,
  },
  rowLabelWrap: { flex: 1, paddingRight: spacing.sm },
  rowLabel: { color: colors.text, fontSize: 16, fontWeight: '600' },
  rowHint: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  rowControl: { alignItems: 'flex-end' },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { color: colors.text, fontSize: 20, fontWeight: '800' },
  stepValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    minWidth: 54,
    textAlign: 'center',
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: 2,
  },
  segItem: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.sm - 2 },
  segItemActive: { backgroundColor: colors.accent },
  segText: { color: colors.textDim, fontSize: 14, fontWeight: '700' },
  segTextActive: { color: colors.accentText },
});
