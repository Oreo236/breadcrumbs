import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

export default function JoinScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    const trimmed = code.trim();
    if (!trimmed) {
      setError('Enter a join code');
      return;
    }
    setSubmitting(true);
    setError(null);
    const { data, error: joinError } = await supabase.rpc('join_adventure', { code: trimmed });
    setSubmitting(false);

    if (joinError) {
      setError(joinError.message);
      return;
    }
    router.push(`/adventure/${data}`);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={styles.title}>Join an adventure</Text>
      <Text style={styles.body}>Enter the 6-character code a friend shared with you.</Text>
      <TextInput
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        placeholder="ABC123"
        placeholderTextColor={colors.toast}
        style={styles.input}
        autoCapitalize="characters"
        maxLength={6}
        returnKeyType="done"
        onSubmitEditing={handleJoin}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.button} onPress={handleJoin} disabled={submitting}>
        {submitting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Join</Text>}
      </Pressable>
      <View style={styles.hint}>
        <Text style={styles.hintText}>Scanning a QR code is coming soon — use the code for now.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.cream, padding: spacing.lg },
  title: { fontFamily: typography.display, fontSize: 26, color: colors.ink, marginTop: spacing.md },
  body: { fontFamily: typography.body, fontSize: 15, color: colors.toast, marginTop: spacing.xs, marginBottom: spacing.lg },
  input: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.outline,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: typography.bodyBold,
    fontSize: 20,
    letterSpacing: 4,
    color: colors.ink,
    textAlign: 'center',
  },
  error: { color: colors.danger, fontFamily: typography.body, marginTop: spacing.sm },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  buttonText: { fontFamily: typography.bodyBold, color: colors.white, fontSize: 16 },
  hint: { marginTop: spacing.lg, alignItems: 'center' },
  hintText: { fontFamily: typography.body, fontSize: 13, color: colors.toast },
});
