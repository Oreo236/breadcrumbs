import { useCallback, useState } from 'react';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
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
import { generateId } from '@/lib/id';

type StopDetail = {
  id: string;
  adventure_id: string;
  order_index: number;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  description: string | null;
  challenge: string | null;
  dropped_at: string | null;
};

type PhotoItem = { id: string; storage_path: string; signedUrl: string | null };

export default function StopScreen() {
  const { id, stopId } = useLocalSearchParams<{ id: string; stopId: string }>();
  const { session } = useAuth();

  const [stop, setStop] = useState<StopDetail | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const { data: stopData, error: stopError } = await supabase
      .from('stops')
      .select('*')
      .eq('id', stopId)
      .single();

    if (stopError) {
      setError(stopError.message);
      return;
    }
    setStop(stopData);

    const { data: photoRows, error: photoError } = await supabase
      .from('photos')
      .select('id, storage_path')
      .eq('stop_id', stopId)
      .order('created_at', { ascending: false });

    if (photoError) {
      setError(photoError.message);
      return;
    }

    const withUrls = await Promise.all(
      (photoRows ?? []).map(async (p) => {
        const { data } = await supabase.storage.from('photos').createSignedUrl(p.storage_path, 3600);
        return { id: p.id, storage_path: p.storage_path, signedUrl: data?.signedUrl ?? null };
      })
    );
    setPhotos(withUrls);
  }, [stopId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().finally(() => setLoading(false));
    }, [load])
  );

  function openDirections() {
    if (!stop) return;
    const label = encodeURIComponent(stop.name);
    const url =
      Platform.OS === 'ios'
        ? `maps://?daddr=${stop.lat},${stop.lng}&q=${label}`
        : `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`;
    Linking.openURL(url).catch(() =>
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`)
    );
  }

  async function addPhoto(fromCamera: boolean) {
    if (!stop || !session) return;

    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('Permission needed', `Allow ${fromCamera ? 'camera' : 'photo library'} access to add a photo.`);
      return;
    }

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });

    if (result.canceled || !result.assets?.[0]) return;

    setUploading(true);
    try {
      const asset = result.assets[0];
      const ext = asset.uri.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${stop.adventure_id}/${stop.id}/${generateId()}.${ext}`;

      // Reading via expo-file-system's File class (not global fetch) avoids a known RN/Hermes
      // issue where fetch(uri).arrayBuffer() on a local file:// URI silently returns truncated
      // or empty data, producing a broken image once uploaded.
      const arrayBuffer = await new File(asset.uri).arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from('photos')
        .upload(path, arrayBuffer, { contentType: asset.mimeType ?? 'image/jpeg' });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from('photos').insert({
        adventure_id: stop.adventure_id,
        stop_id: stop.id,
        user_id: session.user.id,
        storage_path: path,
      });
      if (insertError) throw insertError;

      if (!stop.dropped_at) {
        const { error: dropError } = await supabase
          .from('stops')
          .update({ dropped_at: new Date().toISOString(), dropped_by: session.user.id })
          .eq('id', stop.id);
        if (!dropError) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }

      await load();
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Stop' }} />
        <SafeAreaView style={styles.center} edges={['top']}>
          <ActivityIndicator color={colors.primary} size="large" />
        </SafeAreaView>
      </>
    );
  }

  if (error || !stop) {
    return (
      <>
        <Stack.Screen options={{ title: 'Stop' }} />
        <SafeAreaView style={styles.center} edges={['top']}>
          <Text style={styles.errorText}>{error ?? 'Stop not found'}</Text>
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: stop.name }} />
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
          {stop.dropped_at ? (
            <View style={styles.droppedBanner}>
              <Text style={styles.droppedBannerText}>🍞 Breadcrumb dropped!</Text>
            </View>
          ) : null}

          {stop.description ? <Text style={styles.description}>{stop.description}</Text> : null}

          {stop.challenge ? (
            <View style={styles.challengeCard}>
              <Text style={styles.challengeLabel}>📸 Photo challenge</Text>
              <Text style={styles.challengeText}>{stop.challenge}</Text>
            </View>
          ) : null}

          <Pressable style={styles.directionsButton} onPress={openDirections}>
            <Text style={styles.directionsButtonText}>🧭 Directions</Text>
          </Pressable>

          <View style={styles.photoActions}>
            <Pressable style={styles.photoButton} onPress={() => addPhoto(true)} disabled={uploading}>
              <Text style={styles.photoButtonText}>📷 Take photo</Text>
            </Pressable>
            <Pressable style={styles.photoButton} onPress={() => addPhoto(false)} disabled={uploading}>
              <Text style={styles.photoButtonText}>🖼️ Choose photo</Text>
            </Pressable>
          </View>
          {uploading ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.sm }} /> : null}

          <Text style={styles.photoCount}>{photos.length} photo{photos.length === 1 ? '' : 's'}</Text>
          <View style={styles.photoGrid}>
            {photos.map((p) =>
              p.signedUrl ? (
                <Image key={p.id} source={{ uri: p.signedUrl }} style={styles.photoThumb} contentFit="cover" />
              ) : null
            )}
          </View>
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
  droppedBanner: {
    backgroundColor: colors.blush,
    borderRadius: radius.md,
    padding: spacing.sm,
    alignItems: 'center',
  },
  droppedBannerText: { fontFamily: typography.bodyBold, color: colors.ink },
  description: { fontFamily: typography.body, fontSize: 16, color: colors.ink, lineHeight: 22 },
  challengeCard: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.outline,
    padding: spacing.md,
  },
  challengeLabel: { fontFamily: typography.bodyBold, color: colors.primary, marginBottom: spacing.xs },
  challengeText: { fontFamily: typography.body, color: colors.ink, fontSize: 15 },
  directionsButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  directionsButtonText: { fontFamily: typography.bodyBold, color: colors.white, fontSize: 16 },
  photoActions: { flexDirection: 'row', gap: spacing.sm },
  photoButton: {
    flex: 1,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  photoButtonText: { fontFamily: typography.bodyBold, color: colors.primary },
  photoCount: { fontFamily: typography.body, color: colors.toast, marginTop: spacing.sm },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  photoThumb: { width: '31%', aspectRatio: 1, borderRadius: radius.sm, backgroundColor: colors.outline },
});
