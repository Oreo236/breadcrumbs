import { useCallback, useState } from 'react';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

type StopWithPhotos = {
  id: string;
  order_index: number;
  name: string;
  challenge: string | null;
  photoUrls: string[];
  contributorCount: number;
};

export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [title, setTitle] = useState('');
  const [stops, setStops] = useState<StopWithPhotos[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data: adventure, error: adventureError } = await supabase
      .from('adventures')
      .select('title')
      .eq('id', id)
      .single();
    if (adventureError) {
      setError(adventureError.message);
      return;
    }
    setTitle(adventure.title);

    const { data: stopRows, error: stopsError } = await supabase
      .from('stops')
      .select('id, order_index, name, challenge')
      .eq('adventure_id', id)
      .order('order_index');
    if (stopsError) {
      setError(stopsError.message);
      return;
    }

    const withPhotos = await Promise.all(
      (stopRows ?? []).map(async (stop) => {
        const { data: photoRows } = await supabase
          .from('photos')
          .select('storage_path, user_id')
          .eq('stop_id', stop.id)
          .order('created_at', { ascending: false });

        const urls = await Promise.all(
          (photoRows ?? []).map(async (p) => {
            const { data } = await supabase.storage.from('photos').createSignedUrl(p.storage_path, 3600);
            return data?.signedUrl ?? null;
          })
        );

        return {
          ...stop,
          photoUrls: urls.filter((u): u is string => !!u),
          contributorCount: new Set((photoRows ?? []).map((p) => p.user_id)).size,
        };
      })
    );

    setStops(withPhotos);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().finally(() => setLoading(false));
    }, [load])
  );

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
        <Text style={styles.errorText}>{error}</Text>
      </SafeAreaView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Album' }} />
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>{title}</Text>
          {stops.map((stop) => (
            <View key={stop.id} style={styles.card}>
              <Text style={styles.cardTitle}>
                Breadcrumb #{stop.order_index + 1} — {stop.name}
              </Text>
              {stop.challenge ? <Text style={styles.cardChallenge}>"{stop.challenge}"</Text> : null}
              <Text style={styles.cardMeta}>
                📸 {stop.photoUrls.length} photo{stop.photoUrls.length === 1 ? '' : 's'} · 👥{' '}
                {stop.contributorCount} friend{stop.contributorCount === 1 ? '' : 's'}
              </Text>
              {stop.photoUrls.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
                  {stop.photoUrls.map((url) => (
                    <Image key={url} source={{ uri: url }} style={styles.photo} contentFit="cover" />
                  ))}
                </ScrollView>
              ) : (
                <Text style={styles.noPhotos}>No photos dropped here.</Text>
              )}
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.cream },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  errorText: { color: colors.danger, fontFamily: typography.body, padding: spacing.lg, textAlign: 'center' },
  content: { padding: spacing.lg, gap: spacing.md },
  title: { fontFamily: typography.display, fontSize: 24, color: colors.ink, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.outline,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardTitle: { fontFamily: typography.bodyBold, fontSize: 16, color: colors.ink },
  cardChallenge: { fontFamily: typography.body, fontStyle: 'italic', color: colors.toast },
  cardMeta: { fontFamily: typography.body, fontSize: 13, color: colors.primary },
  photoRow: { marginTop: spacing.xs },
  photo: { width: 96, height: 96, borderRadius: radius.sm, marginRight: spacing.xs, backgroundColor: colors.outline },
  noPhotos: { fontFamily: typography.body, fontSize: 13, color: colors.toast, fontStyle: 'italic' },
});
