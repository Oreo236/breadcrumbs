import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '@/constants/theme';

// Built out in Milestone 4: route map, stop list, invite code/QR, finish adventure.
export default function AdventureScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <>
      <Stack.Screen options={{ title: 'Adventure' }} />
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.emoji}>🧭</Text>
          <Text style={styles.text}>Route map for adventure {id} is coming in the next milestone.</Text>
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.cream },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  emoji: { fontSize: 40 },
  text: { fontFamily: typography.body, color: colors.toast, textAlign: 'center' },
});
