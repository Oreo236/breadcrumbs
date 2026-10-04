import { useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { generateJoinCode } from '@/lib/joinCode';
import { randomChallenge } from '@/lib/challenges';
import { readExifGps, readExifTime } from '@/lib/exif';
import { uploadStopPhoto } from '@/lib/uploadPhoto';
import { generateId } from '@/lib/id';

type Mode = 'planning' | 'went';

type LocalPhoto = { uri: string; mimeType: string | null; takenAt: Date | null };

type DraftStop = {
  key: string;
  name: string;
  note: string;
  query: string;
  lat: number | null;
  lng: number | null;
  locationSource: 'photo' | 'search' | 'device' | null;
  photos: LocalPhoto[];
  challenge: string;
  busy: boolean;
};

function newStop(): DraftStop {
  return {
    key: generateId(),
    name: '',
    note: '',
    query: '',
    lat: null,
    lng: null,
    locationSource: null,
    photos: [],
    challenge: randomChallenge(),
    busy: false,
  };
}

async function suggestName(lat: number, lng: number): Promise<string | null> {
  try {
    const [r] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (!r) return null;
    const street = [r.streetNumber, r.street].filter(Boolean).join(' ');
    return r.name || street || r.district || r.city || null;
  } catch {
    return null;
  }
}

export default function CustomAdventureScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [mode, setMode] = useState<Mode>('went');
  const planning = mode === 'planning';
  const [title, setTitle] = useState('');
  const [stops, setStops] = useState<DraftStop[]>([newStop()]);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function patchStop(key: string, patch: Partial<DraftStop> | ((s: DraftStop) => Partial<DraftStop>)) {
    setStops((cur) =>
      cur.map((s) => (s.key === key ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s))
    );
  }

  function moveStop(index: number, delta: number) {
    setStops((cur) => {
      const target = index + delta;
      if (target < 0 || target >= cur.length) return cur;
      const next = [...cur];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeStop(key: string) {
    setStops((cur) => (cur.length === 1 ? [newStop()] : cur.filter((s) => s.key !== key)));
  }

  function sortByPhotoTime() {
    setStops((cur) => {
      const time = (s: DraftStop) => s.photos.map((p) => p.takenAt?.getTime()).filter((t): t is number => !!t);
      if (cur.some((s) => time(s).length === 0)) {
        Alert.alert('Cannot sort', 'Every stop needs at least one photo with a timestamp to sort by time.');
        return cur;
      }
      return [...cur].sort((a, b) => Math.min(...time(a)) - Math.min(...time(b)));
    });
  }

  async function pickPhotos(key: string) {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to add photos (and read where they were taken).');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 10,
      exif: true,
      quality: 0.7,
    });
    if (result.canceled || result.assets.length === 0) return;

    const photos: LocalPhoto[] = result.assets.map((a) => ({
      uri: a.uri,
      mimeType: a.mimeType ?? null,
      takenAt: readExifTime(a.exif),
    }));
    const gps = result.assets.map((a) => readExifGps(a.exif)).find((g) => g !== null) ?? null;

    patchStop(key, (s) => {
      const fill = !s.lat && gps;
      return {
        // Planning a trip: photos are only used to read a location, never kept or uploaded.
        photos: planning ? s.photos : [...s.photos, ...photos],
        ...(fill ? { lat: gps.lat, lng: gps.lng, locationSource: 'photo' as const } : {}),
      };
    });

    if (!gps) {
      Alert.alert(
        'No location in photo',
        "These photos don't have GPS data (it can be stripped on share/edit). Type an address below or use your current location for this stop."
      );
    } else {
      const suggestion = await suggestName(gps.lat, gps.lng);
      if (suggestion) patchStop(key, (s) => (s.name.trim() ? {} : { name: suggestion }));
    }
  }

  async function findAddress(key: string, query: string) {
    if (!query.trim()) return;
    patchStop(key, { busy: true });
    try {
      const results = await Location.geocodeAsync(query.trim());
      if (results.length === 0) {
        Alert.alert('Not found', "Couldn't find that place. Try a more specific address.");
        return;
      }
      const { latitude, longitude } = results[0];
      patchStop(key, { lat: latitude, lng: longitude, locationSource: 'search' });
      const suggestion = await suggestName(latitude, longitude);
      patchStop(key, (s) => (s.name.trim() ? {} : { name: suggestion ?? query.trim() }));
    } catch {
      Alert.alert('Geocoding failed', 'Try again or use your current location.');
    } finally {
      patchStop(key, { busy: false });
    }
  }

  async function fillFromDevice(key: string) {
    patchStop(key, { busy: true });
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow location access, or type an address instead.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = pos.coords;
      patchStop(key, { lat: latitude, lng: longitude, locationSource: 'device' });
      const suggestion = await suggestName(latitude, longitude);
      if (suggestion) patchStop(key, (s) => (s.name.trim() ? {} : { name: suggestion }));
    } catch {
      Alert.alert("Couldn't get your location", 'Type an address instead.');
    } finally {
      patchStop(key, { busy: false });
    }
  }

  async function save() {
    if (!session) return;
    setError(null);
    if (!title.trim()) {
      setError('Give your adventure a title.');
      return;
    }
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      if (!s.name.trim()) {
        setError(`Stop ${i + 1} needs a name.`);
        return;
      }
      if (s.lat == null || s.lng == null) {
        setError(`Stop ${i + 1} ("${s.name.trim()}") needs a location: ${planning ? 'type an address or use your current location' : 'add a photo with GPS, type an address, or use your current location'}.`);
        return;
      }
    }

    setSaving(true);
    const userId = session.user.id;
    try {
      setProgress('Creating adventure…');
      let adventureId: string | null = null;
      for (let attempt = 0; attempt < 5 && !adventureId; attempt++) {
        const { data, error: insertError } = await supabase
          .from('adventures')
          .insert({
            owner_id: userId,
            title: title.trim(),
            summary: planning ? 'A planned adventure.' : 'A custom adventure.',
            prompt: `Custom adventure: ${title.trim()}`,
            constraints: { custom: true, mode },
            start_lat: stops[0].lat,
            start_lng: stops[0].lng,
            route_polyline: null,
            status: 'planned',
            join_code: generateJoinCode(),
          })
          .select('id')
          .single();
        if (!insertError) {
          adventureId = data.id;
        } else if (insertError.code !== '23505') {
          throw insertError;
        }
      }
      if (!adventureId) throw new Error('Could not allocate a unique join code. Try again.');

      const { error: memberError } = await supabase
        .from('adventure_members')
        .insert({ adventure_id: adventureId, user_id: userId, role: 'owner' });
      if (memberError) throw memberError;

      const { data: insertedStops, error: stopsError } = await supabase
        .from('stops')
        .insert(
          stops.map((s, i) => ({
            adventure_id: adventureId,
            order_index: i,
            name: s.name.trim(),
            lat: s.lat,
            lng: s.lng,
            address: s.query.trim() || null,
            description: s.note.trim() || null,
            challenge: s.challenge,
          }))
        )
        .select('id, order_index');
      if (stopsError) throw stopsError;

      // Upload photos and mark those stops as dropped Breadcrumbs.
      // Planning mode: nothing is uploaded or dropped; Breadcrumbs get dropped later from the stop screen.
      const uploadStops = planning ? stops.map((s) => ({ ...s, photos: [] as LocalPhoto[] })) : stops;
      const totalPhotos = uploadStops.reduce((n, s) => n + s.photos.length, 0);
      let done = 0;
      let failed = 0;
      for (let i = 0; i < stops.length; i++) {
        const row = insertedStops?.find((r) => r.order_index === i);
        if (!row || uploadStops[i].photos.length === 0) continue;
        let uploadedAny = false;
        for (const photo of uploadStops[i].photos) {
          setProgress(`Uploading photo ${done + 1} of ${totalPhotos}…`);
          try {
            await uploadStopPhoto({
              adventureId,
              stopId: row.id,
              userId,
              uri: photo.uri,
              mimeType: photo.mimeType,
            });
            uploadedAny = true;
          } catch {
            failed++;
          }
          done++;
        }
        if (uploadedAny) {
          await supabase
            .from('stops')
            .update({ dropped_at: new Date().toISOString(), dropped_by: userId })
            .eq('id', row.id);
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (failed > 0) {
        Alert.alert('Saved, but some photos failed', `${failed} photo${failed === 1 ? '' : 's'} did not upload. You can add them again from the stop screen.`);
      }
      router.replace(`/adventure/${adventureId}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'Something went wrong';
      const blocked = /row-level security|permission denied/i.test(message);
      setError(
        blocked
          ? `Saving was blocked by database permissions (${message}). The 0003_custom_adventures.sql migration may need to be run in Supabase.`
          : message
      );
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Add your own adventure' }} />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.modeRow}>
            {([
              ['went', '📸 Already went'],
              ['planning', '🗺️ Planning a trip'],
            ] as const).map(([value, label]) => (
              <Pressable
                key={value}
                style={[styles.modeOption, mode === value ? styles.modeOptionSelected : null]}
                onPress={() => setMode(value)}
              >
                <Text style={[styles.modeText, mode === value ? styles.modeTextSelected : null]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.modeHint}>
            {planning
              ? "Add the places you'll go. Drop Breadcrumbs later by taking photos at each stop."
              : 'Add places you already visited with photos. Stops with photos become dropped Breadcrumbs.'}
          </Text>

          <Text style={styles.label}>Adventure title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Saturday on the Commons"
            placeholderTextColor={colors.toast}
            style={styles.input}
          />

          {stops.map((s, i) => (
            <View key={s.key} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{i + 1}</Text>
                </View>
                <Text style={styles.cardTitle}>Stop {i + 1}</Text>
                <View style={styles.headerButtons}>
                  <Pressable onPress={() => moveStop(i, -1)} disabled={i === 0} hitSlop={6}>
                    <Text style={[styles.iconButton, i === 0 ? styles.iconDisabled : null]}>▲</Text>
                  </Pressable>
                  <Pressable onPress={() => moveStop(i, 1)} disabled={i === stops.length - 1} hitSlop={6}>
                    <Text style={[styles.iconButton, i === stops.length - 1 ? styles.iconDisabled : null]}>▼</Text>
                  </Pressable>
                  <Pressable onPress={() => removeStop(s.key)} hitSlop={6}>
                    <Text style={[styles.iconButton, { color: colors.danger }]}>✕</Text>
                  </Pressable>
                </View>
              </View>

              <TextInput
                value={s.name}
                onChangeText={(name) => patchStop(s.key, { name })}
                placeholder="Stop name (e.g. Ithaca Falls)"
                placeholderTextColor={colors.toast}
                style={styles.input}
              />
              <TextInput
                value={s.note}
                onChangeText={(note) => patchStop(s.key, { note })}
                placeholder="Note (optional)"
                placeholderTextColor={colors.toast}
                style={styles.input}
              />

              {planning ? (
                <Pressable onPress={() => pickPhotos(s.key)}>
                  <Text style={styles.link}>🖼️ Use a photo&apos;s location (optional, the photo isn&apos;t saved)</Text>
                </Pressable>
              ) : (
                <Pressable style={styles.secondaryButton} onPress={() => pickPhotos(s.key)}>
                  <Text style={styles.secondaryButtonText}>🖼️ Add photos (reads location)</Text>
                </Pressable>
              )}
              {!planning && s.photos.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
                  {s.photos.map((p, pi) => (
                    <View key={`${p.uri}-${pi}`}>
                      <Image source={{ uri: p.uri }} style={styles.thumb} contentFit="cover" />
                      <Pressable
                        style={styles.thumbRemove}
                        hitSlop={6}
                        onPress={() => patchStop(s.key, (cur) => ({ photos: cur.photos.filter((_, x) => x !== pi) }))}
                      >
                        <Text style={styles.thumbRemoveText}>✕</Text>
                      </Pressable>
                    </View>
                  ))}
                </ScrollView>
              ) : null}

              <View style={styles.row}>
                <TextInput
                  value={s.query}
                  onChangeText={(query) => patchStop(s.key, { query })}
                  placeholder="or type an address"
                  placeholderTextColor={colors.toast}
                  style={[styles.input, { flex: 1 }]}
                  onSubmitEditing={() => findAddress(s.key, s.query)}
                  returnKeyType="search"
                />
                <Pressable style={styles.goButton} onPress={() => findAddress(s.key, s.query)} disabled={s.busy}>
                  <Text style={styles.goButtonText}>Find</Text>
                </Pressable>
              </View>
              <Pressable onPress={() => fillFromDevice(s.key)} disabled={s.busy}>
                <Text style={styles.link}>📍 Use my current location</Text>
              </Pressable>

              {s.busy ? (
                <ActivityIndicator color={colors.primary} />
              ) : s.lat != null && s.lng != null ? (
                <Text style={styles.okText}>
                  ✓ {s.lat.toFixed(5)}, {s.lng.toFixed(5)} (
                  {s.locationSource === 'photo' ? 'from photo' : s.locationSource === 'search' ? 'from address' : 'your location'})
                </Text>
              ) : (
                <Text style={styles.warnText}>No location yet</Text>
              )}

              <Text style={styles.challengeText}>📸 {s.challenge}</Text>
              <Pressable onPress={() => patchStop(s.key, { challenge: randomChallenge() })}>
                <Text style={styles.link}>🎲 Different challenge</Text>
              </Pressable>
            </View>
          ))}

          <Pressable style={styles.addStop} onPress={() => setStops((cur) => [...cur, newStop()])}>
            <Text style={styles.addStopText}>+ Add another stop</Text>
          </Pressable>
          {!planning && stops.length > 1 ? (
            <Pressable onPress={sortByPhotoTime}>
              <Text style={styles.link}>🕒 Sort stops by photo time</Text>
            </Pressable>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable style={styles.cta} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.ctaText}>🍞 Save adventure</Text>}
          </Pressable>
          {progress ? <Text style={styles.progress}>{progress}</Text> : null}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.cream },
  scroll: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xl * 2 },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.outline,
    padding: 3,
  },
  modeOption: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.pill, alignItems: 'center' },
  modeOptionSelected: { backgroundColor: colors.primary },
  modeText: { fontFamily: typography.bodyBold, color: colors.toast, fontSize: 14 },
  modeTextSelected: { color: colors.white },
  modeHint: { fontFamily: typography.body, fontSize: 13, color: colors.toast, marginBottom: spacing.xs },
  label: { fontFamily: typography.bodyBold, fontSize: 15, color: colors.ink },
  input: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.outline,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: typography.body,
    fontSize: 15,
    color: colors.ink,
  },
  card: {
    backgroundColor: colors.cream,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.outline,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: typography.bodyBold, color: colors.white },
  cardTitle: { fontFamily: typography.bodyBold, fontSize: 16, color: colors.ink, flex: 1 },
  headerButtons: { flexDirection: 'row', gap: spacing.md },
  iconButton: { fontFamily: typography.bodyBold, fontSize: 18, color: colors.toast },
  iconDisabled: { opacity: 0.25 },
  secondaryButton: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  secondaryButtonText: { fontFamily: typography.bodyBold, color: colors.primary, fontSize: 15 },
  thumb: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.outline },
  thumbRemove: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(43,27,18,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveText: { color: colors.white, fontSize: 10, fontFamily: typography.bodyBold },
  row: { flexDirection: 'row', gap: spacing.sm },
  goButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  goButtonText: { fontFamily: typography.bodyBold, color: colors.white },
  link: { fontFamily: typography.bodyBold, color: colors.primary },
  okText: { fontFamily: typography.body, color: colors.success },
  warnText: { fontFamily: typography.body, color: colors.toast },
  challengeText: { fontFamily: typography.body, color: colors.ink, fontSize: 14 },
  addStop: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  addStopText: { fontFamily: typography.bodyBold, color: colors.primary, fontSize: 15 },
  error: { color: colors.danger, fontFamily: typography.body, marginTop: spacing.xs },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  ctaText: { fontFamily: typography.bodyBold, color: colors.white, fontSize: 17 },
  progress: { fontFamily: typography.body, fontSize: 13, color: colors.toast, textAlign: 'center' },
});
