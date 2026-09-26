import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { readAgentConfigFromEnv } from '@/agent/agent-client';
import { AssistantScreen } from '@/components/assistant-screen';
import { platinum } from '@/constants/theme';
import { useOnboarding } from '@/onboarding/onboarding-context';

const agentConfig = readAgentConfigFromEnv();

export default function AssistantRoute() {
  const { access } = useOnboarding();
  const account = access?.status === 'complete' ? access.profile.account : null;

  if (!agentConfig || !account) {
    return (
      <View style={styles.unavailable}>
        <Text style={styles.text}>The assistant is not configured.</Text>
      </View>
    );
  }

  return (
    <AssistantScreen
      account={account}
      config={agentConfig}
      onBack={() => router.back()}
      onOpenPlan={() => router.push('/plan')}
      onOpenSend={() => router.push('/send')}
      onOpenSwap={() => router.push('/swap')}
    />
  );
}

const styles = StyleSheet.create({
  unavailable: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: platinum.colors.canvas },
  text: { ...platinum.typography.bodySmall, color: platinum.colors.mutedText },
});
