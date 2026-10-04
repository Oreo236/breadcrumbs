import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

type AdventureRow = {
  id: string;
  title: string;
  summary: string | null;
  status: 'planned' | 'active' | 'completed';
  created_at: string;
};

export default function HomeScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [adventures, setAdventures] = useState<AdventureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('adventures')
      .select('id, title, summary, status, created_at')
      .order('created_at', { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setAdventures(data ?? []);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().finally(() => setLoading(false));
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Hey {profile?.display_name ?? 'there'} 👋</Text>
        <Text style={styles.title}>Where to today?</Text>
      </View>

      <Pressable style={styles.cta} onPress={() => router.push('/new')}>
        <Text style={styles.ctaText}>🍞 Plan an adventure</Text>
      </Pressable>
      <Pressable style={styles.secondaryCta} onPress={() => router.push('/custom')}>
        <Text style={styles.secondaryCtaText}>📸 Add your own adventure</Text>
      </Pressable>

      {loading ? (
        <ActivityIndicator style={styles.loader} color={colors.primary} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <FlatList
          data={adventures}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>🥐</Text>
              <Text style={styles.emptyText}>No adventures yet. Plan your first one above!</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => router.push(`/adventure/${item.id}`)}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              {item.summary ? <Text style={styles.cardSummary}>{item.summary}</Text> : null}
              <Text style={styles.cardStatus}>{item.status}</Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.cream },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  greeting: { fontFamily: typography.body, fontSize: 16, color: colors.toast },
  title: { fontFamily: typography.display, fontSize: 28, color: colors.ink, marginTop: spacing.xs },
  cta: {
    backgroundColor: colors.primary,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    alignItems: 'center',
  },
  ctaText: { fontFamily: typography.bodyBold, color: colors.white, fontSize: 17 },
  secondaryCta: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.primary,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.lg,
    alignItems: 'center',
  },
  secondaryCtaText: { fontFamily: typography.bodyBold, color: colors.primary, fontSize: 16 },
  loader: { marginTop: spacing.xl },
  error: { color: colors.danger, textAlign: 'center', marginTop: spacing.xl, fontFamily: typography.body },
  list: { padding: spacing.lg, gap: spacing.md },
  empty: { alignItems: 'center', marginTop: spacing.xl, gap: spacing.sm },
  emptyEmoji: { fontSize: 40 },
  emptyText: { fontFamily: typography.body, color: colors.toast, textAlign: 'center' },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.outline,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardTitle: { fontFamily: typography.bodyBold, fontSize: 17, color: colors.ink },
  cardSummary: { fontFamily: typography.body, fontSize: 14, color: colors.toast, marginTop: spacing.xs },
  cardStatus: { fontFamily: typography.body, fontSize: 12, color: colors.primary, marginTop: spacing.xs, textTransform: 'uppercase' },
});
