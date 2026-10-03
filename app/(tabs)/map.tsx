import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '@/constants/theme';

// Full memory map (pins for every adventure) lands in Milestone 8.
export default function MemoryMapScreen() {
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.cream, padding: spacing.lg },
  title: { fontFamily: typography.display, fontSize: 26, color: colors.ink, marginTop: spacing.md },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  emoji: { fontSize: 40 },
  text: { fontFamily: typography.body, color: colors.toast, textAlign: 'center', paddingHorizontal: spacing.lg },
});
