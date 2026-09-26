import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  createPublicClient,
  formatEther,
  http,
  isAddress,
  parseEther,
  type Address,
  type Hash,
} from 'viem';
import { sepolia } from 'viem/chains';

import { platinum } from '@/constants/theme';
import {
  createKernelPasskeyExecutionClient,
  type KernelOperationReview,
  type KernelPasskeyExecutionClient,
} from '@/wallet/kernel-passkey-execution';
import { createPasskeyCeremonyClient, type PasskeyCeremonyClient } from '@/wallet/passkey-ceremony';
import { passkeyNativeAdapter } from '@/wallet/passkey-native-adapter';
import {
  markPersistedWalletIdentityDeployed,
  readPersistedWalletIdentity,
  type PersistedWalletIdentity,
  type WalletIdentityStorage,
} from '@/wallet/wallet-identity';
import { walletHomeLiveProvider } from '@/wallet/wallet-home-live';
import { walletIdentityNativeStorage } from '@/wallet/wallet-identity-native-storage';
import { waitForAppForeground } from '@/wallet/wait-for-app-foreground';
import { sepoliaTransactionUrl, shortenAddress } from '@/wallet/sepolia';

const defaultCeremonyClient = createPasskeyCeremonyClient(passkeyNativeAdapter, {
  isForeground: waitForAppForeground,
});

type SendScreenProps = {
  ceremonyClient?: PasskeyCeremonyClient;
  storage?: WalletIdentityStorage;
  createExecutionClient?: typeof createKernelPasskeyExecutionClient;
  readBalance?: (account: Address) => Promise<bigint>;
  copyTransactionHash?: (hash: Hash) => Promise<void>;
  openTransaction?: (url: string) => Promise<void>;
  onDone?: () => void;
};

type LoadedWallet = PersistedWalletIdentity & { balance: bigint };
type SendStep = 'entry' | 'review' | 'authorizing' | 'success';

export function SendScreen({
  ceremonyClient = defaultCeremonyClient,
  storage = walletIdentityNativeStorage,
  createExecutionClient = createKernelPasskeyExecutionClient,
  readBalance = readSepoliaEthBalance,
  copyTransactionHash = async (hash) => {
    await Clipboard.setStringAsync(hash);
  },
  openTransaction = async (url) => {
    await Linking.openURL(url);
  },
  onDone = () => router.back(),
}: SendScreenProps = {}) {
  const [wallet, setWallet] = useState<LoadedWallet | null>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [review, setReview] = useState<KernelOperationReview | null>(null);
  const [executionClient, setExecutionClient] = useState<KernelPasskeyExecutionClient | null>(null);
  const [transactionHash, setTransactionHash] = useState<Hash | null>(null);
  const [status, setStatus] = useState('Loading wallet...');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<SendStep>('entry');
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [hashCopied, setHashCopied] = useState(false);
  const invocation = useRef(0);
  const executionInFlight = useRef(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const currentInvocation = ++invocation.current;
    const load = async () => {
      try {
        const identity = await readPersistedWalletIdentity(storage);
        const balance = await readBalance(identity.account);
        if (currentInvocation !== invocation.current) return;
        setWallet({ ...identity, balance });
        setStatus('');
      } catch (error) {
        if (currentInvocation === invocation.current) setStatus(describeError(error));
      }
    };
    void load();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        setReview(null);
        setExecutionClient(null);
        setStep((current) => (current === 'review' ? 'entry' : current));
      }
    });
    return () => {
      invocation.current += 1;
      ceremonyClient.cancelPending();
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      subscription.remove();
    };
  }, [ceremonyClient, readBalance, storage]);

  const invalidateReview = () => {
    setReview(null);
    setExecutionClient(null);
    setTransactionHash(null);
    setStep('entry');
    setShowTechnicalDetails(false);
  };

  const prepare = async () => {
    if (!wallet) return;
    let transfer: ReturnType<typeof parseEthTransfer>;
    try {
      transfer = parseEthTransfer({ recipient, amount, balance: wallet.balance });
    } catch (error) {
      setStatus(describeError(error));
      return;
    }

    const currentInvocation = ++invocation.current;
    setBusy(true);
    setStatus('Preparing and simulating the exact sponsored transfer...');
    try {
      const client = await createExecutionClient({
        ceremonyClient,
        credential: wallet.credential,
      });
      if (client.account.toLowerCase() !== wallet.account.toLowerCase()) {
        throw new Error('The signing account does not match the persisted wallet');
      }
      const nextReview = await client.prepare([
        { to: transfer.recipient, value: transfer.value, data: '0x' },
      ]);
      if (
        nextReview.calls.length !== 1 ||
        nextReview.calls[0].to.toLowerCase() !== transfer.recipient.toLowerCase() ||
        nextReview.calls[0].valueWei !== transfer.value.toString() ||
        nextReview.calls[0].data !== '0x'
      ) {
        throw new Error('The prepared transfer does not match the requested recipient and amount');
      }
      if (currentInvocation !== invocation.current) return;
      setExecutionClient(client);
      setReview(nextReview);
      setStatus('');
      setStep('review');
    } catch (error) {
      if (currentInvocation === invocation.current) setStatus(describeError(error));
    } finally {
      if (currentInvocation === invocation.current) setBusy(false);
    }
  };

  const execute = async () => {
    if (!wallet || !review || !executionClient || executionInFlight.current) return;
    executionInFlight.current = true;
    const currentInvocation = ++invocation.current;
    const approvedHash = review.userOperationHash;
    setBusy(true);
    setStatus('');
    setStep('authorizing');
    try {
      const evidence = await executionClient.execute(approvedHash);
      if (currentInvocation !== invocation.current) return;
      try {
        await markPersistedWalletIdentityDeployed(storage, evidence.account);
      } catch {
        // The confirmed chain result remains authoritative; reopening reconciles this marker.
      }
      setTransactionHash(evidence.transactionHash);
      setReview(null);
      setExecutionClient(null);
      setStep('success');
      walletHomeLiveProvider.refresh();
    } catch (error) {
      if (currentInvocation === invocation.current) {
        setReview(null);
        setExecutionClient(null);
        setStep('entry');
        setStatus(describeError(error));
      }
    } finally {
      executionInFlight.current = false;
      if (currentInvocation === invocation.current) setBusy(false);
    }
  };

  const copyHash = async (hash: Hash) => {
    setStatus('');
    try {
      await copyTransactionHash(hash);
      setHashCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setHashCopied(false), 2000);
    } catch (error) {
      setStatus(describeError(error));
    }
  };

  const viewTransaction = async (hash: Hash) => {
    setStatus('');
    try {
      await openTransaction(sepoliaTransactionUrl(hash));
    } catch (error) {
      setStatus(describeError(error));
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      {step === 'entry' ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable accessibilityRole="button" onPress={onDone} style={styles.backButton}>
            <Text style={styles.back}>Back</Text>
          </Pressable>

          <View style={styles.heading}>
            <Text style={styles.eyebrow}>ETHEREUM SEPOLIA</Text>
            <Text style={styles.title}>Send ETH</Text>
            <Text style={styles.body}>Choose who to send to and how much.</Text>
          </View>

          <View style={styles.balanceCard}>
            <Text style={styles.label}>AVAILABLE TO SEND</Text>
            <Text style={styles.balance}>{wallet ? `${formatEther(wallet.balance)} ETH` : '...'}</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.fieldLabel}>RECIPIENT</Text>
            <TextInput
              accessibilityLabel="Recipient address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onChangeText={(value) => {
                setRecipient(value);
                invalidateReview();
              }}
              placeholder="0x..."
              placeholderTextColor={platinum.colors.faintText}
              style={styles.input}
              value={recipient}
            />
            <Text style={styles.fieldLabel}>AMOUNT</Text>
            <View style={styles.amountRow}>
              <TextInput
                accessibilityLabel="ETH amount"
                editable={!busy}
                inputMode="decimal"
                onChangeText={(value) => {
                  setAmount(value);
                  invalidateReview();
                }}
                placeholder="0.0"
                placeholderTextColor={platinum.colors.faintText}
                style={[styles.input, styles.amountInput]}
                value={amount}
              />
              <Text style={styles.asset}>ETH</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={busy || !wallet}
              onPress={() => void prepare()}
              style={({ pressed }) => [
                styles.primaryButton,
                (busy || !wallet) && styles.disabled,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.primaryButtonText}>
                {busy ? 'Preparing your transfer...' : 'Continue'}
              </Text>
            </Pressable>
          </View>

          {status ? (
            <View accessibilityRole="alert" style={styles.statusCard}>
              <Text style={styles.statusText}>{status}</Text>
            </View>
          ) : null}
        </ScrollView>
      ) : null}

      {step === 'review' && review ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setReview(null);
              setExecutionClient(null);
              setStep('entry');
            }}
            style={styles.backButton}
          >
            <Text style={styles.back}>Back</Text>
          </Pressable>

          <View style={styles.heading}>
            <Text style={styles.eyebrow}>CHECK BEFORE SENDING</Text>
            <Text style={styles.title}>Does this look right?</Text>
            <Text style={styles.body}>Once sent, this transfer cannot be reversed.</Text>
          </View>

          <SendReview
            review={review}
            showTechnicalDetails={showTechnicalDetails}
            onToggleTechnicalDetails={() => setShowTechnicalDetails((visible) => !visible)}
          />

          <Pressable
            accessibilityState={{ busy, disabled: busy }}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void execute()}
            style={({ pressed }) => [styles.primaryButton, (pressed || busy) && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>Confirm with passkey</Text>
          </Pressable>
          <Text style={styles.reassurance}>Your passkey confirms only this transfer.</Text>
        </ScrollView>
      ) : null}

      {step === 'authorizing' ? (
        <View accessibilityLiveRegion="polite" style={styles.centeredStep}>
          <View style={styles.progressIcon}>
            <ActivityIndicator color={platinum.colors.emerald} size="large" />
          </View>
          <Text style={styles.centeredTitle}>Confirm on your device</Text>
          <Text style={styles.centeredBody}>
            Follow the passkey prompt. Keep Sodera open while your transfer is confirmed.
          </Text>
        </View>
      ) : null}

      {step === 'success' && transactionHash ? (
        <ScrollView contentContainerStyle={styles.successContent}>
          <View style={styles.successIcon}>
            <Text importantForAccessibility="no" style={styles.successIconText}>✓</Text>
          </View>
          <View style={styles.successHeading}>
            <Text accessibilityRole="header" style={styles.successTitle}>ETH sent successfully</Text>
            <Text style={styles.centeredBody}>Your transfer is confirmed on Ethereum Sepolia.</Text>
          </View>

          <View style={styles.transactionCard}>
            <Text style={styles.label}>TRANSACTION</Text>
            <Text selectable style={styles.shortHash}>{shortenHash(transactionHash)}</Text>
            <View style={styles.transactionActions}>
              <Pressable
                accessibilityLabel="Copy transaction hash"
                accessibilityRole="button"
                onPress={() => void copyHash(transactionHash)}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
              >
                <Text style={styles.secondaryButtonText}>{hashCopied ? 'Copied' : 'Copy'}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="link"
                onPress={() => void viewTransaction(transactionHash)}
                style={({ pressed }) => [styles.explorerLink, pressed && styles.pressed]}
              >
                <Text style={styles.explorerLinkText}>View on explorer</Text>
              </Pressable>
            </View>
          </View>

          {status ? <Text accessibilityRole="alert" style={styles.errorText}>{status}</Text> : null}

          <Pressable accessibilityRole="button" onPress={onDone} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Done</Text>
          </Pressable>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

export function parseEthTransfer({
  recipient,
  amount,
  balance,
}: {
  recipient: string;
  amount: string;
  balance: bigint;
}) {
  const normalizedRecipient = recipient.trim();
  if (!isAddress(normalizedRecipient)) throw new Error('Enter a valid Ethereum address');
  let value: bigint;
  try {
    value = parseEther(amount.trim());
  } catch {
    throw new Error('Enter a valid ETH amount with no more than 18 decimals');
  }
  if (value <= 0n) throw new Error('Amount must be greater than zero');
  if (value > balance) throw new Error('Amount exceeds the available ETH balance');
  return { recipient: normalizedRecipient, value } as const;
}

export function shortenHash(hash: Hash) {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function SendReview({
  review,
  showTechnicalDetails,
  onToggleTechnicalDetails,
}: {
  review: KernelOperationReview;
  showTechnicalDetails: boolean;
  onToggleTechnicalDetails: () => void;
}) {
  const call = review.calls[0];
  const amount = `${formatEther(BigInt(call.valueWei))} ETH`;
  return (
    <View style={styles.reviewSection}>
      <View style={styles.amountSummary}>
        <Text style={styles.label}>YOU ARE SENDING</Text>
        <Text selectable style={styles.reviewAmount}>{amount}</Text>
      </View>

      <View style={styles.reviewDetails}>
        <FriendlyReviewRow label="To" value={call.to} mono />
        <FriendlyReviewRow label="From" value={`Your wallet (${shortenAddress(review.account)})`} />
        <FriendlyReviewRow label="Network" value="Ethereum Sepolia" />
        <FriendlyReviewRow
          label="Network fee"
          value={
            review.sponsored
              ? 'Sponsored'
              : `${formatEther(BigInt(review.maximumNetworkFeeWei))} ETH maximum`
          }
          last={!review.deploymentRequired}
        />
        {review.deploymentRequired ? (
          <FriendlyReviewRow label="Wallet setup" value="Included with this first send" last />
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showTechnicalDetails }}
        onPress={onToggleTechnicalDetails}
        style={({ pressed }) => [styles.technicalToggle, pressed && styles.pressed]}
      >
        <Text style={styles.technicalToggleText}>
          {showTechnicalDetails ? 'Hide details' : 'More details'}
        </Text>
      </Pressable>

      {showTechnicalDetails ? (
        <View style={styles.technicalDetails}>
          <ReviewRow label="Asset" value="ETH" />
          <ReviewRow label="Amount" value={amount} />
          <ReviewRow label="Recipient" value={call.to} />
          <ReviewRow label="From account" value={review.account} />
          <ReviewRow label="Network" value={`${review.chain} (${review.chainId})`} />
          <ReviewRow label="Deploy account" value={review.deploymentRequired ? 'Yes' : 'No'} />
          <ReviewRow label="EntryPoint" value={review.entryPoint} />
          <ReviewRow label="Nonce" value={review.userOperation.nonce ?? 'Unavailable'} />
          <ReviewRow label="Call data" value={call.data} />
          <ReviewRow label="Sponsored" value={review.sponsored ? 'Yes' : 'No'} />
          <ReviewRow label="Paymaster" value={review.paymaster ?? 'None'} />
          <ReviewRow label="Maximum network fee" value={`${review.maximumNetworkFeeWei} wei`} />
          <ReviewRow label="Encoded account call" value={review.userOperation.callData ?? 'Unavailable'} />
          <ReviewRow label="UserOperation hash" value={review.userOperationHash} />
        </View>
      ) : null}
    </View>
  );
}

function FriendlyReviewRow({
  label,
  value,
  mono = false,
  last = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.friendlyReviewRow, !last && styles.friendlyReviewDivider]}>
      <Text style={styles.friendlyReviewLabel}>{label}</Text>
      <Text selectable style={[styles.friendlyReviewValue, mono && styles.monoValue]}>{value}</Text>
    </View>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text selectable style={styles.reviewValue}>{value}</Text>
    </View>
  );
}

async function readSepoliaEthBalance(account: Address) {
  const rpcUrl = process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error('EXPO_PUBLIC_SEPOLIA_RPC_URL is required to send ETH');
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const chainId = await client.getChainId();
  if (chainId !== sepolia.id) throw new Error('Send RPC is not Ethereum Sepolia');
  return client.getBalance({ address: account });
}

function describeError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Send failed';
  return message.replace(/https?:\/\/\S+/g, '[redacted RPC URL]');
}

const { colors, spacing, radius, typography } = platinum;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { flexGrow: 1, padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl },
  successContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.xl,
  },
  backButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  back: { ...typography.bodySmall, color: colors.secondaryText },
  heading: { gap: spacing.sm },
  eyebrow: { ...typography.labelSmall, color: colors.emerald },
  title: { ...typography.display, color: colors.platinum },
  body: { ...typography.body, color: colors.mutedText },
  balanceCard: {
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  label: { ...typography.labelSmall, color: colors.mutedText },
  fieldLabel: { ...typography.labelSmall, color: colors.secondaryText, paddingTop: spacing.xs },
  balance: { ...typography.title, color: colors.platinum, fontVariant: ['tabular-nums'] },
  form: { gap: spacing.md },
  input: {
    minHeight: 56,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.borderLit,
    backgroundColor: colors.surfaceLow,
    color: colors.platinum,
    paddingHorizontal: spacing.lg,
    ...typography.body,
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  amountInput: { flex: 1 },
  asset: { ...typography.label, color: colors.emerald },
  primaryButton: {
    minHeight: 56,
    alignSelf: 'stretch',
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.platinum,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
  },
  primaryButtonText: { ...typography.body, fontFamily: typography.subheading.fontFamily, color: colors.onPlatinum },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.65, transform: [{ scale: 0.98 }] },
  reviewSection: { gap: spacing.lg },
  amountSummary: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  reviewAmount: {
    ...typography.display,
    color: colors.platinum,
    fontVariant: ['tabular-nums'],
  },
  reviewDetails: { paddingHorizontal: spacing.xs },
  friendlyReviewRow: { gap: spacing.sm, paddingVertical: spacing.md },
  friendlyReviewDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  friendlyReviewLabel: { ...typography.caption, color: colors.mutedText },
  friendlyReviewValue: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.platinum },
  monoValue: { ...typography.caption, fontFamily: typography.micro.fontFamily },
  technicalToggle: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
  technicalToggleText: { ...typography.label, color: colors.mutedText },
  technicalDetails: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  reviewRow: { gap: spacing.xs },
  reviewLabel: { ...typography.micro, color: colors.mutedText },
  reviewValue: { ...typography.labelSmall, color: colors.platinum },
  reassurance: { ...typography.bodySmall, color: colors.faintText, textAlign: 'center' },
  statusCard: {
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceHigh,
    padding: spacing.md,
  },
  statusText: { ...typography.bodySmall, color: colors.warning },
  centeredStep: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xxl,
  },
  progressIcon: {
    width: 88,
    height: 88,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.emeraldWash,
  },
  centeredTitle: { ...typography.title, color: colors.platinum, textAlign: 'center' },
  centeredBody: { ...typography.body, color: colors.mutedText, textAlign: 'center' },
  successIcon: {
    width: 112,
    height: 112,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.emeraldWash,
  },
  successIconText: { color: colors.emerald, fontSize: 62, lineHeight: 70 },
  successHeading: { alignItems: 'center', gap: spacing.sm },
  successTitle: { ...typography.title, color: colors.platinum, textAlign: 'center' },
  transactionCard: {
    alignSelf: 'stretch',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  shortHash: { ...typography.label, color: colors.platinum },
  transactionActions: { flexDirection: 'row', gap: spacing.md },
  secondaryButton: {
    minHeight: 48,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceHigh,
  },
  secondaryButtonText: { ...typography.bodySmall, color: colors.platinum },
  explorerLink: {
    minHeight: 48,
    flex: 1.6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceHigh,
  },
  explorerLinkText: { ...typography.bodySmall, color: colors.cyan },
  errorText: { ...typography.bodySmall, color: colors.negative, textAlign: 'center' },
});
