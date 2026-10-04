import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';

import { colors, typography } from '@/constants/theme';

type Props = {
  latitude: number;
  longitude: number;
  title: string;
  thumbnailUrl: string | null;
  count: number;
  onPress: () => void;
};

// Map pin that shows a photo thumbnail with a photo-count badge.
// tracksViewChanges stays on until the thumbnail loads so the native marker snapshot isn't blank.
export function PhotoPin({ latitude, longitude, title, thumbnailUrl, count, onPress }: Props) {
  const [tracking, setTracking] = useState(true);

  return (
    <Marker
      coordinate={{ latitude, longitude }}
      title={title}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracking}
      onPress={onPress}
      onCalloutPress={onPress}
    >
      <View style={styles.wrap} collapsable={false}>
        <View style={styles.frame}>
          {thumbnailUrl ? (
            <Image
              source={{ uri: thumbnailUrl }}
              style={styles.image}
              onLoad={() => setTracking(false)}
              onError={() => setTracking(false)}
            />
          ) : (
            <Text style={styles.fallback}>🍞</Text>
          )}
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count}</Text>
        </View>
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 64, height: 64, padding: 4 },
  frame: {
    width: 56,
    height: 56,
    borderRadius: 14,
    borderWidth: 3,
    borderColor: colors.blush,
    backgroundColor: colors.cream,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  fallback: { fontSize: 24 },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.white, fontSize: 11, fontFamily: typography.bodyBold },
});
