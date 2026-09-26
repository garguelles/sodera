import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatEther, type Hash } from 'viem';

import { encodePlan, type PlanEncoderDependencies, type ReviewLine } from '@/agent/plan-encoder';
import { pendingPlan } from '@/agent/pending-plan';
import { platinum } from '@/constants/theme';
import {
  createKernelPasskeyExecutionClient,
  type KernelExecutionCall,
  type KernelOperationReview,
  type KernelPasskeyExecutionClient,
} from '@/wallet/kernel-passkey-execution';
import { createPasskeyCeremonyClient, type PasskeyCeremonyClient } from '@/wallet/passkey-ceremony';
import { passkeyNativeAdapter } from '@/wallet/passkey-native-adapter';
import { sepoliaTransactionUrl, shortenAddress } from '@/wallet/sepolia';
import { waitForAppForeground } from '@/wallet/wait-for-app-foreground';
import { walletHomeLiveProvider } from '@/wallet/wallet-home-live';
import {
  markPersistedWalletIdentityDeployed,
  readPersistedWalletIdentity,
  type WalletIdentityStorage,
} from '@/wallet/wallet-identity';
import { walletIdentityNativeStorage } from '@/wallet/wallet-identity-native-storage';

type Step = 'preparing' | 'review' | 'authorizing' | 'success' | 'failed';

type PlanReviewScreenProps = {
  ceremonyClient?: PasskeyCeremonyClient;
  storage?: WalletIdentityStorage;
  createExecutionClient?: typeof createKernelPasskeyExecutionClient;
  copyTransactionHash?: (hash: Hash) => Promise<void>;
  openTransaction?: (url: string) => Promise<void>;
  onDone?: () => void;
  /** Swap quoting and the clock, injectable for tests. */
  encoder?: PlanEncoderDependencies;
};

/** Refresh a swap quote this close to its deadline rather than sign one that may expire in flight. */
export const QUOTE_REFRESH_MARGIN_SECONDS = 30n;

let defaultCeremonyClient: PasskeyCeremonyClient | undefined;

export function PlanReviewScreen({
  ceremonyClient,
  storage = walletIdentityNativeStorage,
  createExecutionClient = createKernelPasskeyExecutionClient,
  copyTransactionHash = async (hash) => {
    await Clipboard.setStringAsync(hash);
  },
  openTransaction = async (url) => {
    await Linking.openURL(url);
  },
  onDone = () => router.back(),
  encoder,
}: PlanReviewScreenProps) {
  const ceremony =
    ceremonyClient ??
    (defaultCeremonyClient ??= createPasskeyCeremonyClient(passkeyNativeAdapter, { isForeground: waitForAppForeground }));
  const [step, setStep] = useState<Step>('preparing');
  const [lines, setLines] = useState<ReviewLine[]>([]);
  const [review, setReview] = useState<KernelOperationReview | null>(null);
  const [transactionHash, setTransactionHash] = useState<Hash | null>(null);
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');
  const expiresAt = useRef<bigint | null>(null);
  const executionClient = useRef<KernelPasskeyExecutionClient | null>(null);
  const executing = useRef(false);
  const active = useRef(true);

  const prepare = useCallback(async () => {
    try {
      const pending = pendingPlan.get();
      if (!pending) throw new Error('There is no plan to review. Ask Dera again.');
      const encoded = await encodePlan(pending.plan, encoder);
      const identity = await readPersistedWalletIdentity(storage);
      const client = await createExecutionClient({ ceremonyClient: ceremony, credential: identity.credential });
      if (client.account.toLowerCase() !== identity.account.toLowerCase()) {
        throw new Error('The signing account does not match the persisted wallet');
      }
      const prepared = await client.prepare(encoded.calls);
      assertCallsMatch(prepared, encoded.calls);
      if (!active.current) return;
      executionClient.current = client;
      expiresAt.current = encoded.expiresAt;
      setLines(encoded.lines);
      setReview(prepared);
      setStep('review');
    } catch (error) {
      if (!active.current) return;
      setMessage(describeError(error));
      setStep('failed');
    }
  }, [ceremony, createExecutionClient, encoder, storage]);

  useEffect(() => {
    active.current = true;
    // Deferred so the effect only schedules work; prepare's state updates happen after it.
    void Promise.resolve().then(prepare);
    return () => {
      active.current = false;
      ceremony.cancelPending();
    };
  }, [ceremony, prepare]);

  const confirm = async () => {
    const client = executionClient.current;
    if (!review || !client || executing.current) return;
    const nowSeconds = BigInt(Math.floor((encoder?.now ?? Date.now)() / 1000));
    if (expiresAt.current !== null && nowSeconds >= expiresAt.current - QUOTE_REFRESH_MARGIN_SECONDS) {
      setNotice('The swap quote expired, so it was refreshed. Check the amounts again.');
      setStep('preparing');
      await prepare();
      return;
    }
    executing.current = true;
    setNotice('');
    setStep('authorizing');
    try {
      const evidence = await client.execute(review.userOperationHash);
      try {
        await markPersistedWalletIdentityDeployed(storage, evidence.account);
      } catch {
        // The confirmed chain result remains authoritative; reopening reconciles this marker.
      }
      if (!active.current) return;
      pendingPlan.complete();
      setTransactionHash(evidence.transactionHash);
      setStep('success');
      walletHomeLiveProvider.refresh();
    } catch (error) {
      if (!active.current) return;
      setMessage(describeError(error));
      setStep('failed');
    } finally {
      executing.current = false;
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      {step === 'preparing' ? (
        <View accessibilityLiveRegion="polite" style={styles.centered}>
          <ActivityIndicator color={colors.emerald} size="large" />
          <Text style={styles.centeredTitle}>Preparing your plan</Text>
          <Text style={styles.centeredBody}>Building and simulating every step before you sign.</Text>
        </View>
      ) : null}

      {step === 'review' && review ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable accessibilityRole="button" onPress={onDone} style={styles.backButton}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <View style={styles.heading}>
            <Text style={styles.eyebrow}>CHECK BEFORE SIGNING</Text>
            <Text style={styles.title}>Does this look right?</Text>
            <Text style={styles.body}>
              {review.calls.length === 1 ? 'One step runs' : `${review.calls.length} steps run together`} as a single
              operation. Once confirmed, it cannot be reversed.
            </Text>
          </View>

          {notice ? (
            <View accessibilityRole="alert" style={styles.notice}>
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          ) : null}

          <View style={styles.card}>
            {lines.map((line, index) => (
              <View key={index} style={styles.lineRow}>
                <View style={styles.lineNumber}>
                  <Text style={styles.lineNumberText}>{index + 1}</Text>
                </View>
                <View style={styles.lineCopy}>
                  <Text style={styles.lineTitle}>{line.title}</Text>
                  <Text style={styles.lineDetail}>{line.detail}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <DetailRow label="From" value={`Your wallet (${shortenAddress(review.account)})`} />
            <DetailRow label="Network" value="Ethereum Sepolia" />
            <DetailRow
              label="Network fee"
              value={review.sponsored ? 'Sponsored' : `${formatEther(BigInt(review.maximumNetworkFeeWei))} ETH maximum`}
            />
            {review.deploymentRequired ? <DetailRow label="Wallet setup" value="Included with this operation" /> : null}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => void confirm()}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <Text style={styles.primaryButtonText}>Confirm with passkey</Text>
          </Pressable>
          <Text style={styles.reassurance}>Your passkey confirms only these steps.</Text>
        </ScrollView>
      ) : null}

      {step === 'authorizing' ? (
        <View accessibilityLiveRegion="polite" style={styles.centered}>
          <ActivityIndicator color={colors.emerald} size="large" />
          <Text style={styles.centeredTitle}>Confirm on your device</Text>
          <Text style={styles.centeredBody}>Follow the passkey prompt. Keep Sodera open while your plan is confirmed.</Text>
        </View>
      ) : null}

      {step === 'success' && transactionHash ? (
        <ScrollView contentContainerStyle={styles.centeredContent}>
          <Text accessibilityRole="header" style={styles.centeredTitle}>Plan completed</Text>
          <Text style={styles.centeredBody}>Your operation is confirmed on Ethereum Sepolia.</Text>
          <View style={styles.card}>
            <Text style={styles.eyebrow}>TRANSACTION</Text>
            <Text selectable style={styles.hash}>{`${transactionHash.slice(0, 10)}...${transactionHash.slice(-8)}`}</Text>
            <View style={styles.buttonRow}>
              <Pressable
                accessibilityLabel="Copy transaction hash"
                accessibilityRole="button"
                onPress={() =>
                  void copyTransactionHash(transactionHash).then(() => setCopied(true), () => undefined)
                }
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
                <Text style={styles.secondaryButtonText}>{copied ? 'Copied' : 'Copy'}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="link"
                onPress={() => void openTransaction(sepoliaTransactionUrl(transactionHash)).catch(() => undefined)}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
                <Text style={styles.secondaryButtonText}>View on explorer</Text>
              </Pressable>
            </View>
          </View>
          <Pressable accessibilityRole="button" onPress={onDone} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Done</Text>
          </Pressable>
        </ScrollView>
      ) : null}

      {step === 'failed' ? (
        <View accessibilityRole="alert" style={styles.centered}>
          <Text style={styles.centeredTitle}>{"This plan can't continue"}</Text>
          <Text selectable style={styles.centeredBody}>{message}</Text>
          <Pressable accessibilityRole="button" onPress={onDone} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Back to plan</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/** The prepared operation must contain exactly the encoded calls, in order. */
export function assertCallsMatch(review: KernelOperationReview, calls: readonly KernelExecutionCall[]) {
  const matches =
    review.calls.length === calls.length &&
    review.calls.every(
      (prepared, index) =>
        prepared.to.toLowerCase() === calls[index].to.toLowerCase() &&
        prepared.valueWei === calls[index].value.toString() &&
        prepared.data.toLowerCase() === calls[index].data.toLowerCase(),
    );
  if (!matches) throw new Error('The prepared operation does not match the plan');
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text selectable style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function describeError(error: unknown) {
  const message = error instanceof Error ? error.message : 'The plan failed';
  return message.replace(/https?:\/\/\S+/g, '[redacted RPC URL]');
}

const { colors, radius, spacing, typography } = platinum;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { flexGrow: 1, padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  centeredContent: { flexGrow: 1, justifyContent: 'center', gap: spacing.xl, padding: spacing.xl },
  centeredTitle: { ...typography.title, color: colors.platinum, textAlign: 'center' },
  centeredBody: { ...typography.body, color: colors.mutedText, textAlign: 'center' },
  backButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  back: { ...typography.bodySmall, color: colors.secondaryText },
  heading: { gap: spacing.sm },
  eyebrow: { ...typography.labelSmall, color: colors.emerald },
  title: { ...typography.display, color: colors.platinum },
  body: { ...typography.body, color: colors.mutedText },
  card: {
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  notice: {
    borderRadius: radius.lg,
    backgroundColor: colors.warningWash,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  noticeText: { ...typography.bodySmall, color: colors.warning },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  lineNumber: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.platinum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineNumberText: { ...typography.label, color: colors.onPlatinum },
  lineCopy: { flex: 1, minWidth: 0, gap: 2 },
  lineTitle: { ...typography.subheading, color: colors.platinum },
  lineDetail: { ...typography.labelSmall, color: colors.mutedText },
  detailRow: { gap: spacing.xs },
  detailLabel: { ...typography.caption, color: colors.mutedText },
  detailValue: { ...typography.bodySmall, color: colors.platinum },
  hash: { ...typography.label, color: colors.platinum },
  buttonRow: { flexDirection: 'row', gap: spacing.sm },
  primaryButton: {
    minHeight: 56,
    alignSelf: 'stretch',
    borderRadius: radius.full,
    backgroundColor: colors.platinum,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: { ...typography.body, fontFamily: typography.subheading.fontFamily, color: colors.onPlatinum },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.platinum },
  reassurance: { ...typography.caption, color: colors.faintText, textAlign: 'center' },
  pressed: { opacity: 0.7 },
});
