import { useRef, useState } from 'react';
import { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors, radius, spacing, typography } from '@/constants/theme';

export type DialOption = {
  label: string; // short text shown on the dial
  prompt: string; // text used when building the prompt (same wording the old chips used)
};

const ITEM_WIDTH = 76;
const ANY_LABEL = 'Any';

// Horizontal "volume dial" picker with snapping. Index 0 is always "Any" (= not set), so it stays optional.
export function CrumbDial({
  options,
  value,
  onChange,
}: {
  options: DialOption[];
  value: string | null; // the selected option's `prompt`, or null for "Any"
  onChange: (prompt: string | null) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const initialIndex = value ? options.findIndex((o) => o.prompt === value) + 1 : 0;
  const [index, setIndex] = useState(Math.max(0, initialIndex));
  const lastIndex = useRef(Math.max(0, initialIndex));

  const items = [{ label: ANY_LABEL, prompt: '' }, ...options];
  const sidePad = Math.max(0, (width - ITEM_WIDTH) / 2);

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.min(items.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / ITEM_WIDTH)));
    if (next !== lastIndex.current) {
      lastIndex.current = next;
      setIndex(next);
      Haptics.selectionAsync().catch(() => {});
      onChange(next === 0 ? null : items[next].prompt);
    }
  }

  function jumpTo(i: number) {
    scrollRef.current?.scrollTo({ x: i * ITEM_WIDTH, animated: true });
  }

  function onLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width);
  }

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <Text style={styles.readout}>{index === 0 ? 'Any' : `🍞 ${items[index].label}`}</Text>
      <View style={styles.dial}>
        {width > 0 ? (
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={ITEM_WIDTH}
            decelerationRate="fast"
            scrollEventThrottle={16}
            onScroll={handleScroll}
            contentContainerStyle={{ paddingHorizontal: sidePad }}
          >
            {items.map((item, i) => {
              const selected = i === index;
              return (
                <Pressable key={item.label} style={styles.item} onPress={() => jumpTo(i)}>
                  <Text style={[styles.itemLabel, selected ? styles.itemLabelSelected : null, i === 0 ? styles.anyLabel : null]}>
                    {item.label}
                  </Text>
                  {selected ? <Text style={styles.bread}>🍞</Text> : <View style={styles.crumb} />}
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        {/* Fixed centre indicator */}
        <View pointerEvents="none" style={[styles.indicator, { left: sidePad, width: ITEM_WIDTH }]} />
        <View pointerEvents="none" style={[styles.fadeEdge, styles.fadeLeft]} />
        <View pointerEvents="none" style={[styles.fadeEdge, styles.fadeRight]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  readout: { fontFamily: typography.bodyBold, color: colors.toast, fontSize: 14 },
  dial: {
    height: 72,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.outline,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  item: { width: ITEM_WIDTH, height: 72, alignItems: 'center', justifyContent: 'center', gap: 6 },
  itemLabel: { fontFamily: typography.bodyBold, fontSize: 15, color: colors.toast, opacity: 0.7 },
  itemLabelSelected: { color: colors.ink, opacity: 1, fontSize: 17 },
  anyLabel: { fontStyle: 'italic' },
  bread: { fontSize: 16, height: 16, lineHeight: 18 },
  crumb: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.outline, marginTop: 5, marginBottom: 5 },
  indicator: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: 'rgba(232,163,61,0.12)',
  },
  fadeEdge: { position: 'absolute', top: 0, bottom: 0, width: 24, backgroundColor: 'rgba(255,255,255,0.7)' },
  fadeLeft: { left: 0 },
  fadeRight: { right: 0 },
});
