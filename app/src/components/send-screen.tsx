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
              placeholderTextColor="#66665d"
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
                placeholderTextColor="#66665d"
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
            <ActivityIndicator color="#171713" size="large" />
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#171713' },
  content: { flexGrow: 1, padding: 22, paddingBottom: 48, gap: 22 },
  successContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 26,
  },
  backButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  back: { color: '#d4f06a', fontSize: 14, fontWeight: '700' },
  heading: { gap: 9 },
  eyebrow: { color: '#d4f06a', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: '#f3f0e8', fontSize: 38, lineHeight: 43, fontWeight: '800', letterSpacing: -1.2 },
  body: { color: '#aaa89f', fontSize: 16, lineHeight: 23 },
  balanceCard: {
    borderRadius: 20,
    borderCurve: 'continuous',
    backgroundColor: '#24241f',
    padding: 18,
    gap: 7,
  },
  label: { color: '#929188', fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  fieldLabel: { color: '#c8c5bb', fontSize: 12, fontWeight: '800', letterSpacing: 0.8, paddingTop: 4 },
  balance: { color: '#f3f0e8', fontSize: 27, fontWeight: '700', fontVariant: ['tabular-nums'] },
  form: { gap: 12 },
  input: {
    minHeight: 56,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: '#42423a',
    backgroundColor: '#20201c',
    color: '#f3f0e8',
    paddingHorizontal: 14,
    fontSize: 15,
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  amountInput: { flex: 1 },
  asset: { color: '#d4f06a', fontSize: 14, fontWeight: '800' },
  primaryButton: {
    minHeight: 56,
    alignSelf: 'stretch',
    borderRadius: 18,
    borderCurve: 'continuous',
    backgroundColor: '#d4f06a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 4,
  },
  primaryButtonText: { color: '#202515', fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.65, transform: [{ scale: 0.98 }] },
  reviewSection: { gap: 16 },
  amountSummary: { alignItems: 'center', gap: 5, paddingVertical: 8 },
  reviewAmount: {
    color: '#f3f0e8',
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '800',
    letterSpacing: -1.4,
    fontVariant: ['tabular-nums'],
  },
  reviewDetails: { paddingHorizontal: 4 },
  friendlyReviewRow: { gap: 6, paddingVertical: 14 },
  friendlyReviewDivider: { borderBottomWidth: 1, borderBottomColor: '#383831' },
  friendlyReviewLabel: { color: '#929188', fontSize: 12, fontWeight: '700' },
  friendlyReviewValue: { color: '#f3f0e8', fontSize: 15, lineHeight: 21, fontWeight: '600' },
  monoValue: { fontFamily: 'monospace', fontSize: 12, fontWeight: '400' },
  technicalToggle: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  technicalToggleText: { color: '#aaa89f', fontSize: 13, fontWeight: '700' },
  technicalDetails: {
    borderTopWidth: 1,
    borderTopColor: '#383831',
    paddingHorizontal: 4,
    paddingTop: 16,
    gap: 12,
  },
  reviewRow: { gap: 2 },
  reviewLabel: { color: '#929188', fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  reviewValue: { color: '#f3f0e8', fontFamily: 'monospace', fontSize: 11, lineHeight: 17 },
  reassurance: { color: '#77766f', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  statusCard: {
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: '#352a22',
    padding: 14,
  },
  statusText: { color: '#f4d4b5', fontSize: 14, lineHeight: 20 },
  centeredStep: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    padding: 32,
  },
  progressIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d4f06a',
  },
  centeredTitle: { color: '#f3f0e8', fontSize: 28, fontWeight: '800', textAlign: 'center' },
  centeredBody: { color: '#aaa89f', fontSize: 16, lineHeight: 24, textAlign: 'center' },
  successIcon: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d4f06a',
  },
  successIconText: { color: '#171713', fontSize: 62, lineHeight: 70, fontWeight: '800' },
  successHeading: { alignItems: 'center', gap: 8 },
  successTitle: { color: '#f3f0e8', fontSize: 30, lineHeight: 36, fontWeight: '800', textAlign: 'center' },
  transactionCard: {
    alignSelf: 'stretch',
    gap: 12,
    padding: 18,
    borderRadius: 20,
    borderCurve: 'continuous',
    backgroundColor: '#24241f',
  },
  shortHash: { color: '#f3f0e8', fontFamily: 'monospace', fontSize: 16, lineHeight: 22 },
  transactionActions: { flexDirection: 'row', gap: 10 },
  secondaryButton: {
    minHeight: 48,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    borderCurve: 'continuous',
    backgroundColor: '#34342d',
  },
  secondaryButtonText: { color: '#f3f0e8', fontSize: 14, fontWeight: '800' },
  explorerLink: {
    minHeight: 48,
    flex: 1.6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    borderCurve: 'continuous',
    backgroundColor: '#34342d',
  },
  explorerLinkText: { color: '#d4f06a', fontSize: 14, fontWeight: '800' },
  errorText: { color: '#ffd9d4', fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
