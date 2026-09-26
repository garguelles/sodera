import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipientDetail } from '@/agent/plan-encoder';
import type { EnrichedPlan, Violation } from '@/agent/policy';
import type { PlannerState } from '@/agent/use-agent-planner';
import { VIOLATION_TITLES } from '@/agent/violation-copy';
import { platinum } from '@/constants/theme';
import { shortenAddress } from '@/wallet/sepolia';

const PLANNING_STEPS = ['checking balances', 'resolving names', 'building plan'];
export const PLANNING_STEP_MS = 1_500;

type PlanCardProps = {
  state: Exclude<PlannerState, { phase: 'idle' }>;
  /** Remaining sponsored operations today, when the sponsorship service reports it. */
  sponsoredRemaining?: number | null;
  onReview: (plan: EnrichedPlan) => void;
  onOpenSend: () => void;
  onOpenSwap: () => void;
  /** False for earlier answers in a conversation: they stay readable but lose their buttons. */
  active?: boolean;
  /** The plan was reviewed and signed. */
  signed?: boolean;
};

export function PlanCard({
  state,
  sponsoredRemaining = null,
  onReview,
  onOpenSend,
  onOpenSwap,
  active = true,
  signed = false,
}: PlanCardProps) {
  const openSend = active ? onOpenSend : undefined;
  switch (state.phase) {
    case 'planning':
      return <PlanningCard />;
    case 'plan':
      return (
        <PlanResultCard
          plan={state.plan}
          sponsoredRemaining={sponsoredRemaining}
          signed={signed}
          onReview={active && !signed ? () => onReview(state.plan) : undefined}
        />
      );
    case 'question':
      return <QuestionCard question={state.question} active={active} />;
    case 'blocked':
      return (
        <BlockedCard
          violations={state.violations}
          onOpenSend={openSend}
          onOpenSwap={active ? onOpenSwap : undefined}
        />
      );
    case 'declined':
      return (
        <NoticeCard
          eyebrow="CAN'T HELP WITH THAT"
          icon={{ ios: 'hand.raised', android: 'do_not_touch', web: 'do_not_touch' }}
          title={state.message}
          onOpenSend={openSend}
        />
      );
    case 'offline':
      return state.reason === 'timeout' ? (
        <NoticeCard
          eyebrow="PLANNER TOOK TOO LONG"
          icon={{ ios: 'hourglass', android: 'hourglass_empty', web: 'hourglass_empty' }}
          title="The planner took too long to answer."
          body="Try a shorter request. Your wallet works as usual."
          onOpenSend={openSend}
        />
      ) : (
        <NoticeCard
          eyebrow="PLANNER OFFLINE"
          icon={{ ios: 'icloud.slash', android: 'cloud_off', web: 'cloud_off' }}
          title="Can't reach the planner right now."
          body="Your wallet works as usual."
          onOpenSend={openSend}
        />
      );
  }
}

function PlanningCard() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep((current) => (current + 1) % PLANNING_STEPS.length), PLANNING_STEP_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <View accessibilityLabel="Planning" accessibilityLiveRegion="polite" style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.accentEyebrow}>PLANNING…</Text>
        <Text style={styles.caption}>{PLANNING_STEPS[step]}</Text>
      </View>
      <View style={[styles.skeleton, { width: '80%' }]} />
      <View style={[styles.skeleton, { width: '52%' }]} />
      <View style={[styles.skeleton, { width: '66%' }]} />
      <View style={styles.skeletonButton} />
    </View>
  );
}

function PlanResultCard({
  plan,
  sponsoredRemaining,
  signed,
  onReview,
}: {
  plan: EnrichedPlan;
  sponsoredRemaining: number | null;
  signed: boolean;
  onReview?: () => void;
}) {
  const count = plan.actions.length;
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={[styles.planEyebrow, styles.grow]}>
          PLAN · {count} {count === 1 ? 'ACTION' : 'ACTIONS'}
        </Text>
        <View accessibilityLabel="Checked on device" style={styles.checkedPill}>
          <SymbolView
            importantForAccessibility="no"
            name={{ ios: 'checkmark.shield', android: 'verified_user', web: 'verified_user' }}
            size={14}
            tintColor={colors.emerald}
          />
          <Text style={styles.checkedText}>checked on device</Text>
        </View>
      </View>

      {plan.actions.map((item, index) => (
        <View key={index} style={styles.actionRow}>
          <View style={styles.actionNumber}>
            <Text style={styles.actionNumberText}>{index + 1}</Text>
          </View>
          <View style={styles.actionCopy}>
            <Text style={styles.actionTitle}>{actionTitle(item)}</Text>
            {item.recipient ? <Text style={styles.actionDetail}>{recipientDetail(item.recipient)}</Text> : null}
          </View>
        </View>
      ))}

      <View style={styles.divider} />
      {plan.assumptions.length > 0 ? (
        <View style={styles.assumptions}>
          <Text style={styles.mutedEyebrow}>ASSUMPTIONS</Text>
          {plan.assumptions.map((assumption) => (
            <Text key={assumption} style={styles.assumption}>· {assumption === 'Network: Ethereum Sepolia' ? 'Network: Ethereum' : assumption}</Text>
          ))}
        </View>
      ) : null}
      <View style={styles.gasRow}>
        <Text style={styles.gasLabel}>gas</Text>
        {sponsoredRemaining !== null && sponsoredRemaining >= 1 ? (
          <Text style={styles.sponsoredPill}>SPONSORED</Text>
        ) : (
          <Text style={styles.caption}>shown at review</Text>
        )}
      </View>

      {signed ? (
        <View accessibilityLabel="Signed" style={styles.signedRow}>
          <SymbolView importantForAccessibility="no" name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }} size={16} tintColor={colors.emerald} />
          <Text style={styles.checkedText}>Signed and confirmed</Text>
        </View>
      ) : onReview ? (
        <Pressable accessibilityRole="button" onPress={onReview} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <Text style={styles.primaryButtonText}>Review & sign</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function QuestionCard({ question, active }: { question: string; active: boolean }) {
  return (
    <View accessibilityLiveRegion="polite" style={[styles.card, styles.questionCard]}>
      <View style={styles.eyebrowRow}>
        <SymbolView
          importantForAccessibility="no"
          name={{ ios: 'questionmark.circle', android: 'help', web: 'help' }}
          size={16}
          tintColor={colors.ethereum}
        />
        <Text style={styles.accentEyebrow}>NEEDS ONE DETAIL</Text>
      </View>
      <Text style={styles.heading}>{question}</Text>
      {active ? <Text style={styles.accentCaption}>reply below</Text> : null}
    </View>
  );
}

function BlockedCard({
  violations,
  onOpenSend,
  onOpenSwap,
}: {
  violations: readonly Violation[];
  onOpenSend?: () => void;
  onOpenSwap?: () => void;
}) {
  const [first] = violations;
  const title = first ? VIOLATION_TITLES[first.code] ?? VIOLATION_TITLES.schema : VIOLATION_TITLES.schema;
  const aboutSwap = first?.code === 'action_disabled' && first.message.startsWith('Swaps');
  return (
    <View accessibilityRole="alert" style={styles.card}>
      <View style={styles.eyebrowRow}>
        <SymbolView importantForAccessibility="no" name={{ ios: 'nosign', android: 'block', web: 'block' }} size={16} tintColor={colors.negative} />
        <Text style={styles.blockedEyebrow}>BLOCKED · SAFETY CHECK</Text>
      </View>
      <Text style={styles.heading}>{title}</Text>
      {first ? <Text style={styles.body}>{first.message}</Text> : null}
      <Text style={styles.faint}>checked by the planner and again on this phone</Text>
      {(aboutSwap ? onOpenSwap : onOpenSend) ? (
        <Pressable
          accessibilityRole="button"
          onPress={aboutSwap ? onOpenSwap : onOpenSend}
          style={({ pressed }) => [styles.wideButton, pressed && styles.pressed]}>
          <Text style={styles.secondaryButtonText}>{aboutSwap ? 'Open Swap' : 'Open Send'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function NoticeCard({
  eyebrow,
  icon,
  title,
  body,
  onOpenSend,
}: {
  eyebrow: string;
  icon: { ios: string; android: string; web: string };
  title: string;
  body?: string;
  onOpenSend?: () => void;
}) {
  return (
    <View accessibilityRole="alert" style={styles.card}>
      <View style={styles.eyebrowRow}>
        <SymbolView importantForAccessibility="no" name={icon as never} size={16} tintColor={colors.mutedText} />
        <Text style={styles.mutedEyebrow}>{eyebrow}</Text>
      </View>
      <Text style={styles.heading}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {onOpenSend ? (
        <Pressable accessibilityRole="button" onPress={onOpenSend} style={({ pressed }) => [styles.wideButton, pressed && styles.pressed]}>
          <Text style={styles.secondaryButtonText}>Open Send</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function actionTitle(item: EnrichedPlan['actions'][number]) {
  const { action } = item;
  switch (action.type) {
    case 'send_eth':
    case 'send_usdc':
      return `Send ${action.amount} ${item.asset} to ${item.recipient?.name ?? (item.recipient ? shortenAddress(item.recipient.address) : 'recipient')}`;
    case 'swap':
      return `Swap ${action.amountIn} ${action.direction === 'eth_to_usdc' ? 'ETH for USDC' : 'USDC for ETH'}`;
    case 'vault_deposit':
      return `Deposit ${action.amount} USDC into the vault`;
    case 'vault_withdraw':
      return action.amount === 'all' ? 'Withdraw everything from the vault' : `Withdraw ${action.amount} USDC from the vault`;
  }
}

const { colors, radius, spacing, typography } = platinum;
const indigoWash = 'rgba(139, 158, 255, 0.08)';
const indigoBorder = 'rgba(139, 158, 255, 0.35)';

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  questionCard: { backgroundColor: indigoWash, borderColor: indigoBorder },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  accentEyebrow: { ...typography.labelSmall, color: colors.ethereum, letterSpacing: 2 },
  mutedEyebrow: { ...typography.labelSmall, color: colors.mutedText, letterSpacing: 2 },
  blockedEyebrow: { ...typography.labelSmall, color: colors.negative, letterSpacing: 2 },
  planEyebrow: { ...typography.label, color: colors.platinum, letterSpacing: 2 },
  caption: { ...typography.labelSmall, color: colors.mutedText },
  accentCaption: { ...typography.label, color: colors.ethereum },
  faint: { ...typography.labelSmall, color: colors.faintText },
  heading: { ...typography.cardTitle, color: colors.platinum },
  body: { ...typography.bodySmall, color: colors.secondaryText },
  skeleton: { height: 14, borderRadius: radius.full, backgroundColor: colors.glassRaised },
  skeletonButton: { height: 48, borderRadius: radius.xl, backgroundColor: colors.glass, marginTop: spacing.xs },
  checkedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(78, 222, 163, 0.35)',
    backgroundColor: colors.emeraldWash,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  checkedText: { ...typography.labelSmall, color: colors.emerald },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actionNumber: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.platinum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionNumberText: { ...typography.label, color: colors.onPlatinum },
  actionCopy: { flex: 1, minWidth: 0, gap: 2 },
  actionTitle: { ...typography.subheading, color: colors.platinum },
  actionDetail: { ...typography.labelSmall, color: colors.mutedText },
  divider: { height: 1, backgroundColor: colors.border },
  assumptions: { gap: spacing.xs },
  assumption: { ...typography.bodySmall, color: colors.secondaryText },
  gasRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gasLabel: { ...typography.bodySmall, color: colors.mutedText },
  sponsoredPill: {
    ...typography.labelSmall,
    color: colors.emerald,
    backgroundColor: colors.emeraldWash,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(78, 222, 163, 0.35)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
  },
  secondaryButtonText: { ...typography.body, fontFamily: typography.subheading.fontFamily, color: colors.platinum },
  primaryButton: {
    minHeight: 52,
    marginTop: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.platinum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { ...typography.body, fontFamily: typography.subheading.fontFamily, color: colors.onPlatinum },
  wideButton: {
    minHeight: 52,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceLow,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  grow: { flex: 1 },
  signedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pressed: { opacity: 0.7 },
});
