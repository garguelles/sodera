import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { platinum } from '@/constants/theme';

type PlatinumFeaturePreviewProps = {
  title: 'Earn' | 'Swap';
  symbol: string;
  description: string;
  steps: [string, string, string];
};

const { colors, radius, spacing, typography } = platinum;

export function PlatinumFeaturePreview({ title, symbol, description, steps }: PlatinumFeaturePreviewProps) {
  const accent = title === 'Earn' ? colors.emerald : colors.cyan;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, headerShadowVisible: false, title, headerStyle: { backgroundColor: colors.canvas }, headerTintColor: colors.platinum }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={[styles.symbol, { color: accent }]}>{symbol}</Text>
          <View style={styles.heroCopy}>
            <Text style={[styles.eyebrow, { color: accent }]}>COMING TO SODERA</Text>
            <Text style={styles.title}>{title} will live here.</Text>
            <Text style={styles.description}>{description}</Text>
          </View>
        </View>
        <View style={styles.steps}>
          <Text style={styles.stepsLabel}>THE IDEA</Text>
          {steps.map((step, index) => (
            <View key={step} style={styles.step}>
              <Text style={[styles.stepNumber, { color: accent }]}>0{index + 1}</Text>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.note}>This is a preview. No quotes, yields, or transactions are available yet.</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl },
  hero: { minHeight: 280, borderRadius: radius.xl, borderCurve: 'continuous', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.xl, justifyContent: 'space-between' },
  symbol: { fontSize: 64, lineHeight: 72 },
  heroCopy: { gap: spacing.md },
  eyebrow: { ...typography.labelSmall },
  title: { ...typography.title, color: colors.platinum },
  description: { ...typography.bodySmall, color: colors.mutedText },
  steps: { gap: spacing.lg },
  stepsLabel: { ...typography.label, color: colors.secondaryText },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.md },
  stepNumber: { ...typography.label },
  stepText: { ...typography.bodySmall, flex: 1, color: colors.platinum },
  note: { ...typography.caption, color: colors.mutedText },
});
