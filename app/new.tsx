import { useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import {
  ActivityIndicator,
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

type Coords = { lat: number; lng: number };

// Quick-select chips; their text is appended to whatever the user typed when generating.
const TIME_OPTIONS = ['15 minutes', '30 minutes', '1 hour', '2 hours', '3 hours'];
const BUDGET_OPTIONS = ['free', '$10', '$25', '$50+'];
const VIBE_OPTIONS = ['relaxing', 'food', 'cozy', 'scenic', 'shopping', 'exploring', 'active'];

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, selected ? styles.chipSelected : null]} onPress={onPress}>
      <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>{label}</Text>
    </Pressable>
  );
}

export default function NewAdventureScreen() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [time, setTime] = useState<string | null>(null);
  const [budget, setBudget] = useState<string | null>(null);
  const [vibes, setVibes] = useState<string[]>([]);
  const [surprise, setSurprise] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [cityInput, setCityInput] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [showEnd, setShowEnd] = useState(false);
  const [endCoords, setEndCoords] = useState<Coords | null>(null);
  const [endCityInput, setEndCityInput] = useState('');
  const [endLocating, setEndLocating] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function useMyLocation() {
    setLocating(true);
    setLocationError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Location permission denied. Type a city or address below instead.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
    } catch {
      setLocationError("Couldn't get your location. Type a city or address below instead.");
    } finally {
      setLocating(false);
    }
  }

  async function geocodeCity() {
    if (!cityInput.trim()) return;
    setLocating(true);
    setLocationError(null);
    try {
      const results = await Location.geocodeAsync(cityInput.trim());
      if (results.length === 0) {
        setLocationError("Couldn't find that place. Try a more specific address.");
        return;
      }
      setCoords({ lat: results[0].latitude, lng: results[0].longitude });
    } catch {
      setLocationError('Geocoding failed. Try again or use your device location.');
    } finally {
      setLocating(false);
    }
  }

  async function geocodeEndCity() {
    if (!endCityInput.trim()) return;
    setEndLocating(true);
    setEndError(null);
    try {
      const results = await Location.geocodeAsync(endCityInput.trim());
      if (results.length === 0) {
        setEndError("Couldn't find that place. Try a more specific address.");
        return;
      }
      setEndCoords({ lat: results[0].latitude, lng: results[0].longitude });
    } catch {
      setEndError('Geocoding failed. Try again.');
    } finally {
      setEndLocating(false);
    }
  }

  function buildPrompt() {
    const parts: string[] = [];
    if (prompt.trim()) parts.push(prompt.trim());
    if (time) parts.push(`I have ${time}.`);
    if (budget) parts.push(budget === 'free' ? 'Budget: free.' : `Budget: ${budget}.`);
    if (vibes.length > 0) parts.push(`I'm in the mood for: ${vibes.join(', ')}.`);
    if (surprise) parts.push('Surprise me - mix different kinds of places, not just one type.');
    return parts.join(' ');
  }

  function toggleVibe(v: string) {
    setVibes((current) => (current.includes(v) ? current.filter((x) => x !== v) : [...current, v]));
  }

  async function handleGenerate() {
    const fullPrompt = buildPrompt();
    if (!fullPrompt) {
      setError('Describe your adventure or pick a few options first (time, budget, vibe).');
      return;
    }
    if (!coords) {
      setError('Set a starting point first — use your location or type a city.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('generate-adventure', {
        body: { prompt: fullPrompt, start: coords, destination: endCoords ?? null },
      });

      if (fnError) {
        // FunctionsHttpError/FunctionsRelayError carry the real response on `.context`;
        // fnError.message is just a generic "non-2xx status code" string otherwise.
        const context = (fnError as { context?: Response }).context;
        let message = fnError.message;
        if (context) {
          try {
            const body = await context.json();
            if (body?.error) message = body.error;
          } catch {
            // context wasn't JSON - fall back to fnError.message
          }
        }
        throw new Error(message);
      }
      if (!data?.adventure_id) throw new Error('No adventure returned');

      router.replace(`/adventure/${data.adventure_id}`);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Couldn't build that one. Try loosening your constraints."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Plan an adventure' }} />
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>What are you in the mood for?</Text>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            placeholder="3 hours, $20, bookstores and food, surprise me"
            placeholderTextColor={colors.toast}
            style={styles.promptInput}
            multiline
            numberOfLines={4}
          />

          <Text style={styles.label}>How much time?</Text>
          <View style={styles.chipRow}>
            {TIME_OPTIONS.map((o) => (
              <Chip key={o} label={o} selected={time === o} onPress={() => setTime(time === o ? null : o)} />
            ))}
          </View>

          <Text style={styles.label}>Budget</Text>
          <View style={styles.chipRow}>
            {BUDGET_OPTIONS.map((o) => (
              <Chip key={o} label={o} selected={budget === o} onPress={() => setBudget(budget === o ? null : o)} />
            ))}
          </View>

          <Text style={styles.label}>Vibe</Text>
          <View style={styles.chipRow}>
            {VIBE_OPTIONS.map((o) => (
              <Chip key={o} label={o} selected={vibes.includes(o)} onPress={() => toggleVibe(o)} />
            ))}
            <Chip label="🎲 Surprise me" selected={surprise} onPress={() => setSurprise((v) => !v)} />
          </View>

          <Text style={styles.label}>Starting point</Text>
          {coords ? (
            <View style={styles.coordsBadge}>
              <Text style={styles.coordsText}>
                📍 {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
              </Text>
              <Pressable onPress={() => setCoords(null)}>
                <Text style={styles.changeLink}>change</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Pressable style={styles.secondaryButton} onPress={useMyLocation} disabled={locating}>
                {locating ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Text style={styles.secondaryButtonText}>📍 Use my location</Text>
                )}
              </Pressable>
              <Text style={styles.orText}>or type a city / address</Text>
              <View style={styles.row}>
                <TextInput
                  value={cityInput}
                  onChangeText={setCityInput}
                  placeholder="Ithaca, NY"
                  placeholderTextColor={colors.toast}
                  style={styles.cityInput}
                  onSubmitEditing={geocodeCity}
                  returnKeyType="done"
                />
                <Pressable style={styles.goButton} onPress={geocodeCity} disabled={locating}>
                  <Text style={styles.goButtonText}>Go</Text>
                </Pressable>
              </View>
              {locationError ? <Text style={styles.error}>{locationError}</Text> : null}
            </>
          )}

          {showEnd ? (
            <>
              <Text style={styles.label}>Ending point</Text>
              {endCoords ? (
                <View style={styles.coordsBadge}>
                  <Text style={styles.coordsText}>
                    🏁 {endCoords.lat.toFixed(4)}, {endCoords.lng.toFixed(4)}
                  </Text>
                  <Pressable onPress={() => setEndCoords(null)}>
                    <Text style={styles.changeLink}>change</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.row}>
                  <TextInput
                    value={endCityInput}
                    onChangeText={setEndCityInput}
                    placeholder="Where you'll end up"
                    placeholderTextColor={colors.toast}
                    style={styles.cityInput}
                    onSubmitEditing={geocodeEndCity}
                    returnKeyType="done"
                  />
                  <Pressable style={styles.goButton} onPress={geocodeEndCity} disabled={endLocating}>
                    {endLocating ? <ActivityIndicator color={colors.white} /> : <Text style={styles.goButtonText}>Go</Text>}
                  </Pressable>
                </View>
              )}
              {endError ? <Text style={styles.error}>{endError}</Text> : null}
              <Pressable
                onPress={() => {
                  setShowEnd(false);
                  setEndCoords(null);
                  setEndError(null);
                }}
              >
                <Text style={styles.orText}>remove ending point</Text>
              </Pressable>
            </>
          ) : (
            <Pressable onPress={() => setShowEnd(true)}>
              <Text style={styles.addEndLink}>+ Add an ending point (optional)</Text>
            </Pressable>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable style={styles.cta} onPress={handleGenerate} disabled={submitting}>
            {submitting ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.ctaText}>✨ Generate adventure</Text>
            )}
          </Pressable>
          {submitting ? (
            <Text style={styles.submittingHint}>
              Finding real places and planning your route — this can take up to 25 seconds…
            </Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.outline,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: typography.bodyBold, fontSize: 14, color: colors.ink },
  chipTextSelected: { color: colors.white },
  container: { flex: 1, backgroundColor: colors.cream },
  scroll: { padding: spacing.lg, gap: spacing.sm },
  label: {
    fontFamily: typography.bodyBold,
    fontSize: 15,
    color: colors.ink,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  promptInput: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.outline,
    padding: spacing.md,
    fontFamily: typography.body,
    fontSize: 15,
    color: colors.ink,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  secondaryButton: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  secondaryButtonText: { fontFamily: typography.bodyBold, color: colors.primary, fontSize: 15 },
  orText: {
    fontFamily: typography.body,
    fontSize: 13,
    color: colors.toast,
    textAlign: 'center',
    marginVertical: spacing.xs,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  cityInput: {
    flex: 1,
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
  goButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  goButtonText: { fontFamily: typography.bodyBold, color: colors.white },
  coordsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.outline,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  coordsText: { fontFamily: typography.body, color: colors.ink },
  addEndLink: {
    fontFamily: typography.bodyBold,
    color: colors.primary,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  changeLink: { fontFamily: typography.bodyBold, color: colors.primary },
  error: { color: colors.danger, fontFamily: typography.body, marginTop: spacing.xs },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  ctaText: { fontFamily: typography.bodyBold, color: colors.white, fontSize: 17 },
  submittingHint: {
    fontFamily: typography.body,
    fontSize: 13,
    color: colors.toast,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
