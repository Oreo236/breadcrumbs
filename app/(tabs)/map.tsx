import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import MapView from 'react-native-maps';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { PhotoPin } from '@/components/PhotoPin';

// One pin per Breadcrumb (stop) that has photos, placed at the stop's real coordinates.
// Adventures/stops without photos get no pin, so nothing is ever pinned at the start point by default.
type CrumbPin = {
  stopId: string;
  adventureId: string;
  title: string;
  lat: number;
  lng: number;
  count: number;
  thumbnailUrl: string | null;
};

export default function MemoryMapScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const [pins, setPins] = useState<CrumbPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data: photoRows, error: photoError } = await supabase
      .from('photos')
      .select('stop_id, adventure_id, storage_path, created_at')
      .order('created_at', { ascending: false });
    if (photoError) {
      setError(photoError.message);
      return;
    }

    // Group by stop; rows are newest-first so the first path per stop is the latest photo.
    const byStop = new Map<string, { adventureId: string; paths: string[] }>();
    for (const row of photoRows ?? []) {
      const entry = byStop.get(row.stop_id) ?? { adventureId: row.adventure_id as string, paths: [] as string[] };
      entry.paths.push(row.storage_path);
      byStop.set(row.stop_id, entry);
    }
    const stopIds = [...byStop.keys()];
    if (stopIds.length === 0) {
      setPins([]);
      return;
    }

    const [{ data: stopRows }, { data: signed }] = await Promise.all([
      supabase.from('stops').select('id, name, lat, lng, adventure_id').in('id', stopIds),
      supabase.storage.from('photos').createSignedUrls(
        stopIds.map((id) => byStop.get(id)!.paths[0]),
        3600
      ),
    ]);

    const urlByPath = new Map<string, string>();
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) urlByPath.set(item.path, item.signedUrl);
    }

    setPins(
      (stopRows ?? []).map((stop) => {
        const entry = byStop.get(stop.id)!;
        return {
          stopId: stop.id,
          adventureId: stop.adventure_id,
          title: stop.name,
          lat: stop.lat,
          lng: stop.lng,
          count: entry.paths.length,
          thumbnailUrl: urlByPath.get(entry.paths[0]) ?? null,
        };
      })
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      setLoading(true);
      load().finally(() => {
        if (mounted) setLoading(false);
      });
      return () => {
        mounted = false;
      };
    }, [load])
  );

  function fitPins() {
    if (pins.length === 0) return;
    mapRef.current?.fitToCoordinates(
      pins.map((p) => ({ latitude: p.lat, longitude: p.lng })),
      { edgePadding: { top: 80, right: 80, bottom: 80, left: 80 }, animated: false }
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <Text style={styles.text}>{error}</Text>
      </SafeAreaView>
    );
  }

  if (pins.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Text style={styles.title}>Memory Map</Text>
        <View style={styles.empty}>
          <Text style={styles.emoji}>🗺️</Text>
          <Text style={styles.text}>Drop a Breadcrumb with a photo and it will show up here as a pin.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <MapView
        ref={mapRef}
        style={styles.map}
        onMapReady={fitPins}
        initialRegion={{
          latitude: pins[0].lat,
          longitude: pins[0].lng,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        {pins.map((pin) => (
          <PhotoPin
            key={pin.stopId}
            latitude={pin.lat}
            longitude={pin.lng}
            title={`${pin.title} · ${pin.count} photo${pin.count === 1 ? '' : 's'}`}
            thumbnailUrl={pin.thumbnailUrl}
            count={pin.count}
            onPress={() => router.push(`/adventure/${pin.adventureId}/album`)}
          />
        ))}
      </MapView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.cream },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  map: { flex: 1 },
  title: { fontFamily: typography.display, fontSize: 26, color: colors.ink, margin: spacing.lg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  emoji: { fontSize: 40 },
  text: { fontFamily: typography.body, color: colors.toast, textAlign: 'center', paddingHorizontal: spacing.lg },
});
