// Script library + editor. Lists saved scripts and lets you create, edit,
// delete, and jump straight into recording one.

import React, { useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../theme';

function snippet(body) {
  const s = (body || '').replace(/\s+/g, ' ').trim();
  return s.length > 90 ? s.slice(0, 90) + '…' : s;
}

export default function ScriptsScreen({ scripts, onSave, onDelete, onRecord, onOpenSettings }) {
  const [editing, setEditing] = useState(null); // null = list view; object = editor
  const insets = useSafeAreaInsets();

  if (editing) {
    const isNew = !editing.id;
    return (
      <KeyboardAvoidingView
        style={[styles.root, { paddingLeft: insets.left, paddingRight: insets.right }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.editorHeader, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable hitSlop={12} onPress={() => setEditing(null)}>
            <Text style={styles.headerAction}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle}>{isNew ? 'New script' : 'Edit script'}</Text>
          <Pressable
            hitSlop={12}
            onPress={() => {
              onSave(editing);
              setEditing(null);
            }}
          >
            <Text style={[styles.headerAction, { color: colors.accent }]}>Save</Text>
          </Pressable>
        </View>

        <TextInput
          style={styles.titleInput}
          placeholder="Script title"
          placeholderTextColor={colors.textDim}
          value={editing.title}
          onChangeText={(title) => setEditing({ ...editing, title })}
        />
        <TextInput
          style={styles.bodyInput}
          placeholder="Paste or type your script here…"
          placeholderTextColor={colors.textDim}
          value={editing.body}
          onChangeText={(body) => setEditing({ ...editing, body })}
          multiline
          textAlignVertical="top"
        />

        {!isNew && (
          <Pressable
            style={[styles.recordBtn, { marginBottom: insets.bottom + spacing.md }]}
            onPress={() => {
              onSave(editing);
              onRecord(editing);
            }}
          >
            <Text style={styles.recordBtnText}>Save & Record ●</Text>
          </Pressable>
        )}
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={[styles.root, { paddingLeft: insets.left, paddingRight: insets.right }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.headerTitle}>Teleprompter</Text>
        <Pressable hitSlop={12} onPress={onOpenSettings}>
          <Text style={styles.headerAction}>Settings</Text>
        </Pressable>
      </View>

      <FlatList
        data={scripts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 96 }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No scripts yet. Tap “New script” to write your first one.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => setEditing(item)}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.title || 'Untitled script'}
            </Text>
            <Text style={styles.cardSnippet} numberOfLines={2}>
              {snippet(item.body) || 'Empty'}
            </Text>
            <View style={styles.cardRow}>
              <Pressable
                style={[styles.smallBtn, styles.smallBtnPrimary]}
                onPress={() => onRecord(item)}
              >
                <Text style={styles.smallBtnPrimaryText}>Record ●</Text>
              </Pressable>
              <Pressable style={styles.smallBtn} onPress={() => setEditing(item)}>
                <Text style={styles.smallBtnText}>Edit</Text>
              </Pressable>
              <Pressable style={styles.smallBtn} onPress={() => onDelete(item.id)}>
                <Text style={[styles.smallBtnText, { color: colors.danger }]}>Delete</Text>
              </Pressable>
            </View>
          </Pressable>
        )}
      />

      <Pressable
        style={[styles.newBtn, { bottom: insets.bottom + spacing.md }]}
        onPress={() => setEditing({ title: '', body: '' })}
      >
        <Text style={styles.newBtnText}>+ New script</Text>
      </Pressable>
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
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerTitle: { color: colors.text, fontSize: 22, fontWeight: '800' },
  headerAction: { color: colors.textDim, fontSize: 16, fontWeight: '600' },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: spacing.xl, fontSize: 15 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  cardSnippet: { color: colors.textDim, fontSize: 14, marginTop: 4 },
  cardRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  smallBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  smallBtnText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  smallBtnPrimary: { backgroundColor: colors.accent },
  smallBtnPrimaryText: { color: colors.accentText, fontSize: 14, fontWeight: '700' },
  newBtn: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.lg,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: 16,
    alignItems: 'center',
  },
  newBtnText: { color: colors.accentText, fontSize: 17, fontWeight: '800' },
  titleInput: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bodyInput: {
    flex: 1,
    color: colors.text,
    fontSize: 17,
    lineHeight: 25,
    padding: spacing.md,
  },
  recordBtn: {
    margin: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: 16,
    alignItems: 'center',
  },
  recordBtnText: { color: colors.accentText, fontSize: 17, fontWeight: '800' },
});
