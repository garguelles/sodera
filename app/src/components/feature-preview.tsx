import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

type FeaturePreviewProps = {
  title: 'Earn' | 'Swap';
  symbol: string;
  description: string;
  steps: [string, string, string];
};

export function FeaturePreview({ title, symbol, description, steps }: FeaturePreviewProps) {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title, headerStyle: { backgroundColor: '#171713' }, headerTintColor: '#f3f0e8' }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.symbol}>{symbol}</Text>
          <Text style={styles.eyebrow}>COMING TO SODERA</Text>
          <Text style={styles.title}>{title} will live here.</Text>
          <Text style={styles.description}>{description}</Text>
        </View>
        <View style={styles.steps}>
          <Text style={styles.stepsLabel}>THE IDEA</Text>
          {steps.map((step, index) => (
            <View key={step} style={styles.step}>
              <Text style={styles.stepNumber}>0{index + 1}</Text>
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
  screen: { flex: 1, backgroundColor: '#171713' },
  content: { padding: 20, paddingBottom: 40, gap: 22 },
  hero: { minHeight: 300, borderRadius: 26, borderCurve: 'continuous', backgroundColor: '#313929', padding: 26, justifyContent: 'flex-end', gap: 12 },
  symbol: { color: '#d4f06a', fontSize: 64, fontWeight: '300', paddingBottom: 12 },
  eyebrow: { color: '#d4f06a', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: '#f3f0e8', fontSize: 30, fontWeight: '700', letterSpacing: -1 },
  description: { color: '#c5c6bc', fontSize: 14, lineHeight: 21 },
  steps: { paddingHorizontal: 6, gap: 18 },
  stepsLabel: { color: '#929188', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stepNumber: { color: '#d4f06a', fontSize: 14, fontWeight: '700' },
  stepText: { flex: 1, color: '#f3f0e8', fontSize: 14, lineHeight: 20 },
  note: { color: '#929188', fontSize: 12, lineHeight: 18, paddingHorizontal: 6 },
});
