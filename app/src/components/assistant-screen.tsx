import { useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View, type TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Address } from 'viem';

import { AGENT_CAPABILITIES } from '@/agent/agent-context';
import { createAgentClient, type AgentClient, type AgentConfig } from '@/agent/agent-client';
import { pendingPlan } from '@/agent/pending-plan';
import { useAgentPlanner } from '@/agent/use-agent-planner';
import { platinum } from '@/constants/theme';
import type { resolveSepoliaRecipient } from '@/wallet/send-transfer';
import { createDefaultBalanceClient, type SepoliaBalanceClient } from '@/wallet/wallet-home-live';

import { IntentBar, type IntentBarMode } from './intent-bar';
import { PlanCard } from './plan-card';

const SUGGESTIONS = [
  AGENT_CAPABILITIES.send_eth ? 'send 0.01 eth to alice' : null,
  AGENT_CAPABILITIES.send_usdc ? 'send 2 usdc to alice' : null,
  AGENT_CAPABILITIES.swap ? 'swap 50 usdc to eth' : null,
  AGENT_CAPABILITIES.vault_deposit ? 'deposit 100 usdc' : null,
].filter((item): item is string => item !== null);

type AssistantScreenProps = {
  account: Address;
  config: AgentConfig;
  onBack: () => void;
  onOpenPlan: () => void;
  onOpenSend: () => void;
  onOpenSwap: () => void;
  client?: AgentClient;
  balanceClient?: () => SepoliaBalanceClient;
  resolveRecipient?: typeof resolveSepoliaRecipient;
};

export function AssistantScreen({
  account,
  config,
  onBack,
  onOpenPlan,
  onOpenSend,
  onOpenSwap,
  client,
  balanceClient,
  resolveRecipient,
}: AssistantScreenProps) {
  const agentClient = useMemo(() => client ?? createAgentClient({ config }), [client, config]);
  const readBalances = useMemo(() => {
    if (balanceClient) return balanceClient;
    let cached: SepoliaBalanceClient | undefined;
    return () => (cached ??= createDefaultBalanceClient());
  }, [balanceClient]);
  const { state, turns, submit, reset, markSigned } = useAgentPlanner({
    account,
    client: agentClient,
    balanceClient: readBalances,
    resolveRecipient,
  });

  const [text, setText] = useState('');
  const input = useRef<TextInput>(null);
  const scroll = useRef<ScrollView>(null);

  // Back from a signed plan: mark that plan as signed in the conversation.
  useFocusEffect(
    useCallback(() => {
      const turnId = pendingPlan.consumeCompletedTurn();
      if (turnId !== null) markSigned(turnId);
    }, [markSigned]),
  );

  const mode: IntentBarMode =
    state.phase === 'planning' ? 'planning' : state.phase === 'question' ? 'reply' : turns.length > 0 ? 'follow-up' : 'start';

  const send = async (sentence = text) => {
    const intent = sentence.trim();
    if (!intent || state.phase === 'planning') return;
    setText('');
    await submit(intent);
  };

  const lastId = turns.at(-1)?.id;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} onPress={onBack} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>‹</Text>
        </Pressable>
        <View style={styles.titleRow}>
          <SymbolView importantForAccessibility="no" name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} size={16} tintColor={colors.ethereum} />
          <Text accessibilityRole="header" style={styles.title}>Dera</Text>
        </View>
        {turns.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New chat"
            disabled={state.phase === 'planning'}
            hitSlop={8}
            onPress={() => {
              setText('');
              reset();
            }}
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
            <SymbolView importantForAccessibility="no" name={{ ios: 'square.and.pencil', android: 'edit_square', web: 'edit_square' }} size={16} tintColor={colors.secondaryText} />
          </Pressable>
        ) : (
          <View style={styles.headerButtonSpacer} />
        )}
      </View>

      {/* Android runs edge-to-edge, where the system no longer resizes the window for the keyboard,
          so the page adds the keyboard's height as padding on both platforms. */}
      <KeyboardAvoidingView behavior="padding" style={styles.body}>
        <ScrollView
          ref={scroll}
          contentContainerStyle={[styles.conversation, turns.length === 0 && styles.conversationEmpty]}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
          testID="assistant-conversation">
          {turns.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <SymbolView importantForAccessibility="no" name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} size={26} tintColor={colors.ethereum} />
              </View>
              <Text style={styles.emptyTitle}>Ask Dera</Text>
              <Text style={styles.emptyBody}>Dera turns what you say into a plan. You review and sign every step with your passkey.</Text>
              <Text style={styles.eyebrow}>TRY SAYING</Text>
              <View style={styles.chips}>
                {SUGGESTIONS.map((suggestion) => (
                  <Pressable
                    key={suggestion}
                    accessibilityRole="button"
                    accessibilityLabel={`Try: ${suggestion}`}
                    onPress={() => {
                      setText(suggestion);
                      input.current?.focus();
                    }}
                    style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
                    <Text style={styles.chipText}>{suggestion}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            turns.map((turn) => (
              <View key={turn.id} style={styles.turn}>
                <View style={styles.userBubble}>
                  <Text selectable style={styles.userText}>{turn.state.intent}</Text>
                </View>
                <PlanCard
                  active={turn.id === lastId}
                  onOpenSend={onOpenSend}
                  onOpenSwap={onOpenSwap}
                  onReview={(plan) => {
                    pendingPlan.set({ plan, intent: turn.state.intent, turnId: turn.id });
                    onOpenPlan();
                  }}
                  signed={turn.signed}
                  state={turn.state}
                />
              </View>
            ))
          )}
        </ScrollView>

        <View style={styles.composer}>
          <IntentBar
            ref={input}
            highlighted={state.phase === 'question'}
            mode={mode}
            onChangeText={setText}
            onSubmit={() => void send()}
            value={text}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const { colors, radius, spacing, typography } = platinum;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonSpacer: { width: 38, height: 38 },
  headerButtonText: { ...typography.heading, color: colors.secondaryText, lineHeight: 28 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.label, color: colors.platinum, letterSpacing: 3, textTransform: 'uppercase' },
  body: { flex: 1 },
  conversation: { padding: spacing.lg, gap: spacing.xl },
  conversationEmpty: { flexGrow: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: 'rgba(139, 158, 255, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(139, 158, 255, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { ...typography.title, color: colors.platinum, textAlign: 'center' },
  emptyBody: { ...typography.bodySmall, color: colors.mutedText, textAlign: 'center', maxWidth: 300 },
  eyebrow: { ...typography.labelSmall, color: colors.mutedText, letterSpacing: 2, marginTop: spacing.lg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  chip: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceLowest,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipText: { ...typography.label, color: colors.text },
  turn: { gap: spacing.md },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    borderRadius: radius.lg,
    borderBottomRightRadius: radius.sm,
    backgroundColor: colors.surfaceHigh,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  userText: { ...typography.label, fontSize: 14, color: colors.platinum },
  composer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.canvas,
  },
  pressed: { opacity: 0.7 },
});
