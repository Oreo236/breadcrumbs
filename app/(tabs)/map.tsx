import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import MapView, { Marker } from 'react-native-maps';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

type AdventurePin = {
  id: string;
  title: string;
  status: 'planned' | 'active' | 'completed';
  start_lat: number;
  start_lng: number;
};

export default function MemoryMapScreen() {
  const router = useRouter();
  const [pins, setPins] = useState<AdventurePin[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      setLoading(true);
      supabase
        .from('adventures')
        .select('id, title, status, start_lat, start_lng')
        .then(({ data }) => {
          if (mounted) {
            setPins(data ?? []);
            setLoading(false);
          }
        });
      return () => {
        mounted = false;
      };
    }, [])
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  if (pins.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Text style={styles.title}>Memory Map</Text>
        <View style={styles.empty}>
          <Text style={styles.emoji}>🗺️</Text>
          <Text style={styles.text}>Your finished adventures will show up here as pins.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: pins[0].start_lat,
          longitude: pins[0].start_lng,
          latitudeDelta: 0.5,
          longitudeDelta: 0.5,
        }}
      >
        {pins.map((pin) => (
          <Marker
            key={pin.id}
            coordinate={{ latitude: pin.start_lat, longitude: pin.start_lng }}
            title={pin.title}
            pinColor={pin.status === 'completed' ? colors.blush : colors.primary}
            onPress={() =>
              router.push(
                pin.status === 'completed' ? `/adventure/${pin.id}/album` : `/adventure/${pin.id}`
              )
            }
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
