// The scrolling script overlay. Renders every word, keeps the current word
// centered inside a fixed reading band, and lets the user drag to re-sync if
// voice tracking loses the place. Uses RN's built-in Animated + PanResponder
// (no reanimated) to keep the native build simple.

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
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
  const { fontSize, bandPosition, dimNonActive, wordHighlight, scrollSmoothing } = settings;

  const lineHeight = Math.round(fontSize * 1.34);
  const bandHeight = Math.round(lineHeight * 2.6); // room for ~2–3 lines
  const bandCenter = Math.max(bandHeight / 2 + 8, Math.round((height || 0) * bandPosition));

  const scrollY = useRef(new Animated.Value(0)).current;
  const scrollYValue = useRef(0);
  const wordY = useRef({}); // index -> top offset within the text column
  const dragStart = useRef(0);

  // Keep a plain-number mirror of the animated scroll value for gesture math.
  useEffect(() => {
    const id = scrollY.addListener(({ value }) => {
      scrollYValue.current = value;
    });
    return () => scrollY.removeListener(id);
  }, [scrollY]);

  // Move the current word to the band center whenever the pointer changes,
  // unless the user has paused following.
  useEffect(() => {
    if (paused) return;
    const y = wordY.current[pointer];
    if (y == null) return;
    const target = bandCenter - (y + lineHeight / 2);
    Animated.timing(scrollY, {
      toValue: target,
      duration: scrollSmoothing,
      useNativeDriver: true,
    }).start();
  }, [pointer, paused, bandCenter, lineHeight, scrollSmoothing, scrollY]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, g) => Math.abs(g.dy) > 6,
        onPanResponderGrant: () => {
          scrollY.stopAnimation((v) => {
            dragStart.current = v;
          });
        },
        onPanResponderMove: (_evt, g) => {
          scrollY.setValue(dragStart.current + g.dy);
        },
        onPanResponderRelease: () => {
          // Snap the pointer to whatever matchable word is now nearest the band,
          // so voice tracking resumes from where the user dragged to.
          const cur = scrollYValue.current;
          let best = -1;
          let bestDist = Infinity;
          for (const key of Object.keys(wordY.current)) {
            const i = Number(key);
            const t = tokens[i];
            if (!t || !t.matchable) continue;
            const screenY = wordY.current[i] + cur + lineHeight / 2;
            const dist = Math.abs(screenY - bandCenter);
            if (dist < bestDist) {
              bestDist = dist;
              best = i;
            }
          }
          if (best >= 0 && onResync) onResync(best);
        },
      }),
    [tokens, bandCenter, lineHeight, scrollY, onResync]
  );

  // Precompute which token index is the "active" one for line-level styling.
  const activeWindow = 8;

  return (
    <View style={[styles.root, { height, width }]} {...panResponder.panHandlers}>
      {/* Reading band sits behind the text so words stay readable on top of it. */}
      <View
        pointerEvents="none"
        style={[
          styles.band,
          {
            top: bandCenter - bandHeight / 2,
            height: bandHeight,
          },
        ]}
      />

      <Animated.View
        style={[
          styles.column,
          {
            paddingTop: bandCenter,
            paddingBottom: Math.max(0, (height || 0) - bandCenter),
            transform: [{ translateY: scrollY }],
          },
        ]}
      >
        <View style={styles.wrap}>
          {tokens.map((t) => {
            if (t.isBreak) {
              return <View key={t.index} style={styles.break} />;
            }
            const isSpoken = t.index < pointer;
            const isCurrent = t.index === pointer;
            let color = colors.promptText;
            if (isSpoken) color = colors.promptSpoken;

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
      </Animated.View>
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
  },
  column: {
    paddingHorizontal: 18,
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
