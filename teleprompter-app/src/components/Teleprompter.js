// The scrolling script overlay. Renders every word and keeps the current word
// centered inside a fixed reading band. Scrolls with a plain ScrollView (rather
// than an animated transform) so the text reliably composites *over* the camera
// preview on Android — a transformed view can otherwise be pushed behind the
// camera's TextureView. Dragging the text re-syncs voice tracking to that spot.

import React, { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

export default function Teleprompter({
  tokens,
  pointer,
  settings,
  height,
  width,
  paused,
  onResync,
}) {
  const { fontSize, bandPosition, dimNonActive, wordHighlight } = settings;

  const lineHeight = Math.round(fontSize * 1.34);
  const bandHeight = Math.round(lineHeight * 2.6); // room for ~2–3 lines
  const bandCenter = Math.max(bandHeight / 2 + 8, Math.round((height || 0) * bandPosition));
  const activeWindow = 8;

  const scrollRef = useRef(null);
  const wordY = useRef({}); // token index -> top offset within the scroll content

  // Keep the current word centered in the band whenever the pointer advances,
  // unless the user has paused following.
  useEffect(() => {
    if (paused) return;
    const y = wordY.current[pointer];
    if (y == null) return;
    // wordY is measured inside the content's top padding (= bandCenter), so the
    // scroll offset that lands this word's center on the band is simply
    // y + lineHeight/2 (the paddingTop and the band offset cancel out).
    const target = Math.max(0, y + lineHeight / 2);
    scrollRef.current?.scrollTo({ y: target, animated: true });
  }, [pointer, paused, bandCenter, lineHeight]);

  // When the user drags the text, snap the pointer to whatever matchable word is
  // now nearest the band so voice tracking resumes from there.
  const handleUserScroll = (e) => {
    const offset = e.nativeEvent.contentOffset.y;
    let best = -1;
    let bestDist = Infinity;
    for (const key of Object.keys(wordY.current)) {
      const i = Number(key);
      const t = tokens[i];
      if (!t || !t.matchable) continue;
      // Distance of this word's center from the band, in scroll-offset terms.
      const dist = Math.abs(wordY.current[i] + lineHeight / 2 - offset);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    if (best >= 0 && onResync) onResync(best);
  };

  return (
    <View style={[styles.root, { height, width }]}>
      {/* No visible reading band — the current line simply scrolls to a fixed
          vertical position and spoken words dim, which reads cleanly. */}
      <ScrollView
        ref={scrollRef}
        style={StyleSheet.absoluteFill}
        contentContainerStyle={{
          paddingTop: bandCenter,
          paddingBottom: Math.max(0, (height || 0) - bandCenter),
          paddingHorizontal: 18,
        }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScrollEndDrag={handleUserScroll}
      >
        <View style={styles.wrap}>
          {tokens.map((t) => {
            if (t.isBreak) {
              return <View key={t.index} style={styles.break} />;
            }
            if (t.isSpacer) {
              // A blank line the writer inserted — full-width vertical gap.
              return <View key={t.index} style={{ width: '100%', height: lineHeight }} />;
            }
            const isSpoken = t.index < pointer;
            const isCurrent = t.index === pointer;
            const color = isSpoken ? colors.promptSpoken : colors.promptText;

            let opacity = 1;
            if (dimNonActive) {
              const near = t.index >= pointer - 2 && t.index <= pointer + activeWindow;
              opacity = near ? 1 : 0.3;
            }

            const highlighted = wordHighlight && isCurrent;

            return (
              <Text
                key={t.index}
                onLayout={(e) => {
                  wordY.current[t.index] = e.nativeEvent.layout.y;
                }}
                style={[
                  styles.word,
                  {
                    fontSize,
                    lineHeight,
                    color: highlighted ? colors.wordHighlightText : color,
                    opacity,
                    backgroundColor: highlighted ? colors.wordHighlightBg : 'transparent',
                  },
                ]}
              >
                {t.raw + ' '}
              </Text>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: colors.bandFill,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.bandBorder,
    zIndex: 1,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  word: {
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    borderRadius: 4,
  },
  break: {
    width: '100%',
    height: 0,
  },
});
