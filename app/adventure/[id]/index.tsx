import { useCallback, useState } from 'react';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import MapView, { Marker, Polyline } from 'react-native-maps';
import QRCode from 'react-native-qrcode-svg';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { decodePolyline } from '@/lib/polyline';

type Stop = {
  id: string;
  order_index: number;
  name: string;
  lat: number;
  lng: number;
  description: string | null;
  challenge: string | null;
  dropped_at: string | null;
};

type Adventure = {
  id: string;
  owner_id: string;
  title: string;
  summary: string | null;
  status: 'planned' | 'active' | 'completed';
  join_code: string;
  start_lat: number;
  start_lng: number;
  route_polyline: string | null;
};

export default function AdventureScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();

  const [adventure, setAdventure] = useState<Adventure | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [{ data: adventureData, error: adventureError }, { data: stopsData, error: stopsError }] =
      await Promise.all([
        supabase.from('adventures').select('*').eq('id', id).single(),
        supabase.from('stops').select('*').eq('adventure_id', id).order('order_index'),
      ]);

    if (adventureError) {
      setError(adventureError.message);
      return;
    }
    if (stopsError) {
      setError(stopsError.message);
      return;
    }
    setAdventure(adventureData);
    setStops(stopsData ?? []);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().finally(() => setLoading(false));
    }, [load])
  );

  async function handleFinish() {
    if (!adventure) return;
    Alert.alert('Finish adventure?', 'This turns it into a shared album for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Finish',
        onPress: async () => {
          setFinishing(true);
          const { error: updateError } = await supabase
            .from('adventures')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('id', adventure.id);
          setFinishing(false);
          if (updateError) {
            Alert.alert('Could not finish adventure', updateError.message);
            return;
          }
          router.replace(`/adventure/${adventure.id}/album`);
        },
      },
    ]);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  if (error || !adventure) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <Text style={styles.errorText}>{error ?? 'Adventure not found'}</Text>
      </SafeAreaView>
    );
  }

  const routePoints = adventure.route_polyline
    ? decodePolyline(adventure.route_polyline)
    : stops.map((s) => ({ latitude: s.lat, longitude: s.lng }));

  const isOwner = session?.user.id === adventure.owner_id;

  return (
    <>
      <Stack.Screen options={{ title: adventure.title }} />
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScrollView>
          <MapView
            style={styles.map}
            initialRegion={{
              latitude: adventure.start_lat,
              longitude: adventure.start_lng,
              latitudeDelta: 0.03,
              longitudeDelta: 0.03,
            }}
          >
            {routePoints.length > 1 ? (
              <Polyline coordinates={routePoints} strokeColor={colors.primary} strokeWidth={4} />
            ) : null}
            {stops.map((stop) => (
              <Marker
                key={stop.id}
                coordinate={{ latitude: stop.lat, longitude: stop.lng }}
                title={`${stop.order_index + 1}. ${stop.name}`}
                pinColor={stop.dropped_at ? colors.blush : colors.primary}
              />
            ))}
          </MapView>

          <View style={styles.header}>
            {adventure.summary ? <Text style={styles.summary}>{adventure.summary}</Text> : null}

            <Pressable style={styles.inviteRow} onPress={() => setShowInvite((v) => !v)}>
              <Text style={styles.inviteCode}>Join code: {adventure.join_code}</Text>
              <Text style={styles.inviteToggle}>{showInvite ? 'hide' : 'show QR'}</Text>
            </Pressable>
            {showInvite ? (
              <View style={styles.qrWrap}>
                <QRCode value={adventure.join_code} size={160} />
              </View>
            ) : null}
          </View>

          <View style={styles.stopList}>
            {stops.map((stop) => (
              <Pressable
                key={stop.id}
                style={[styles.stopCard, stop.dropped_at ? styles.stopCardDropped : null]}
                onPress={() => router.push(`/adventure/${adventure.id}/stop/${stop.id}`)}
              >
                <View style={styles.stopNumber}>
                  <Text style={styles.stopNumberText}>{stop.order_index + 1}</Text>
                </View>
                <View style={styles.stopInfo}>
                  <Text style={styles.stopName}>{stop.name}</Text>
                  {stop.description ? (
                    <Text style={styles.stopDescription} numberOfLines={2}>
                      {stop.description}
                    </Text>
                  ) : null}
                </View>
                {stop.dropped_at ? <Text style={styles.droppedBadge}>🍞</Text> : null}
              </Pressable>
            ))}
          </View>

          {isOwner && adventure.status !== 'completed' ? (
            <Pressable style={styles.finishButton} onPress={handleFinish} disabled={finishing}>
              {finishing ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.finishButtonText}>Finish adventure</Text>
              )}
            </Pressable>
          ) : null}

          {adventure.status === 'completed' ? (
            <Pressable
              style={styles.finishButton}
              onPress={() => router.push(`/adventure/${adventure.id}/album`)}
            >
              <Text style={styles.finishButtonText}>View album</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.cream },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  errorText: { color: colors.danger, fontFamily: typography.body, padding: spacing.lg, textAlign: 'center' },
  map: { width: '100%', height: 260 },
  header: { padding: spacing.lg },
  summary: { fontFamily: typography.body, fontSize: 15, color: colors.ink, marginBottom: spacing.sm },
  inviteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.outline,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inviteCode: { fontFamily: typography.bodyBold, fontSize: 15, color: colors.ink, letterSpacing: 2 },
  inviteToggle: { fontFamily: typography.body, color: colors.primary },
  qrWrap: { alignItems: 'center', marginTop: spacing.md },
  stopList: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  stopCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.outline,
    padding: spacing.md,
    gap: spacing.md,
  },
  stopCardDropped: { backgroundColor: colors.blush + '22', borderColor: colors.blush },
  stopNumber: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopNumberText: { fontFamily: typography.bodyBold, color: colors.white, fontSize: 13 },
  stopInfo: { flex: 1 },
  stopName: { fontFamily: typography.bodyBold, fontSize: 15, color: colors.ink },
  stopDescription: { fontFamily: typography.body, fontSize: 13, color: colors.toast, marginTop: 2 },
  droppedBadge: { fontSize: 20 },
  finishButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  finishButtonText: { fontFamily: typography.bodyBold, color: colors.white, fontSize: 16 },
});
