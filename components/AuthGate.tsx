import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { Mascot } from '@/components/Mascot';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { loading, error, profile } = useAuth();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Couldn&apos;t sign in</Text>
        <Text style={styles.body}>{error}</Text>
      </View>
    );
  }

  if (!profile) {
    return <NamePrompt />;
  }

  return <>{children}</>;
}

function NamePrompt() {
  const { setDisplayName } = useAuth();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim()) {
      setLocalError('Enter a name to continue');
      return;
    }
    setSubmitting(true);
    setLocalError(null);
    try {
      await setDisplayName(name);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.center}>
      <Mascot size={96} mood="content" />
      <Text style={styles.title}>Welcome to Breadcrumbs</Text>
      <Text style={styles.body}>What should we call you?</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        placeholderTextColor={colors.toast}
        style={styles.input}
        autoFocus
        autoCapitalize="words"
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
      />
      {localError ? <Text style={styles.error}>{localError}</Text> : null}
      <Pressable style={styles.button} onPress={handleSubmit} disabled={submitting}>
        {submitting ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.buttonText}>Let&apos;s go</Text>
        )}
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cream,
    padding: spacing.lg,
  },
  title: {
    fontFamily: typography.display,
    fontSize: 24,
    color: colors.ink,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  body: {
    fontFamily: typography.body,
    fontSize: 16,
    color: colors.toast,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.outline,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: typography.body,
    fontSize: 16,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  error: {
    fontFamily: typography.body,
    color: colors.danger,
    marginBottom: spacing.sm,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.sm,
  },
  buttonText: {
    fontFamily: typography.bodyBold,
    color: colors.white,
    fontSize: 16,
  },
});
