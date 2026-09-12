import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import {
  AppState,
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

const defaultCeremonyClient = createPasskeyCeremonyClient(passkeyNativeAdapter, {
  isForeground: waitForAppForeground,
});

type SendScreenProps = {
  ceremonyClient?: PasskeyCeremonyClient;
  storage?: WalletIdentityStorage;
  createExecutionClient?: typeof createKernelPasskeyExecutionClient;
  readBalance?: (account: Address) => Promise<bigint>;
  onDone?: () => void;
};

type LoadedWallet = PersistedWalletIdentity & { balance: bigint };

export function SendScreen({
  ceremonyClient = defaultCeremonyClient,
  storage = walletIdentityNativeStorage,
  createExecutionClient = createKernelPasskeyExecutionClient,
  readBalance = readSepoliaEthBalance,
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
  const invocation = useRef(0);

  useEffect(() => {
    const currentInvocation = ++invocation.current;
    const load = async () => {
      try {
        const identity = await readPersistedWalletIdentity(storage);
        const balance = await readBalance(identity.account);
        if (currentInvocation !== invocation.current) return;
        setWallet({ ...identity, balance });
        setStatus('Enter a Sepolia address and ETH amount.');
      } catch (error) {
        if (currentInvocation === invocation.current) setStatus(describeError(error));
      }
    };
    void load();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        setReview(null);
        setExecutionClient(null);
      }
    });
    return () => {
      invocation.current += 1;
      ceremonyClient.cancelPending();
      subscription.remove();
    };
  }, [ceremonyClient, readBalance, storage]);

  const invalidateReview = () => {
    setReview(null);
    setExecutionClient(null);
    setTransactionHash(null);
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
      setStatus('Review the exact transfer before passkey authorization.');
    } catch (error) {
      if (currentInvocation === invocation.current) setStatus(describeError(error));
    } finally {
      if (currentInvocation === invocation.current) setBusy(false);
    }
  };

  const execute = async () => {
    if (!wallet || !review || !executionClient) return;
    const currentInvocation = ++invocation.current;
    const approvedHash = review.userOperationHash;
    setBusy(true);
    setReview(null);
    setStatus('Authorize this exact transfer with your Primary Passkey...');
    try {
      const evidence = await executionClient.execute(approvedHash);
      if (currentInvocation !== invocation.current) return;
      try {
        await markPersistedWalletIdentityDeployed(storage, evidence.account);
      } catch {
        // The confirmed chain result remains authoritative; reopening reconciles this marker.
      }
      setTransactionHash(evidence.transactionHash);
      setStatus('Transfer confirmed on Ethereum Sepolia.');
      walletHomeLiveProvider.refresh();
    } catch (error) {
      if (currentInvocation === invocation.current) setStatus(describeError(error));
    } finally {
      if (currentInvocation === invocation.current) setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" onPress={onDone} style={styles.backButton}>
          <Text style={styles.back}>Back</Text>
        </Pressable>

        <View style={styles.heading}>
          <Text style={styles.eyebrow}>ETHEREUM SEPOLIA</Text>
          <Text style={styles.title}>Send ETH</Text>
          <Text style={styles.body}>From your passkey-controlled Kernel smart account.</Text>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.label}>AVAILABLE</Text>
          <Text style={styles.balance}>{wallet ? `${formatEther(wallet.balance)} ETH` : '...'}</Text>
          <Text selectable style={styles.address}>{wallet?.account ?? 'Loading account...'}</Text>
        </View>

        {!transactionHash ? (
          <View style={styles.form}>
            <Text style={styles.label}>RECIPIENT ADDRESS</Text>
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
            <Text style={styles.label}>AMOUNT</Text>
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

            {review ? <SendReview review={review} /> : null}

            <Pressable
              accessibilityRole="button"
              disabled={busy || !wallet}
              onPress={() => (review ? execute() : prepare())}
              style={({ pressed }) => [
                styles.primaryButton,
                (busy || !wallet) && styles.disabled,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.primaryButtonText}>
                {busy ? 'Working...' : review ? 'Authorize and send' : 'Review send'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.successCard}>
            <Text style={styles.successTitle}>Send confirmed</Text>
            <Text selectable style={styles.hash}>{transactionHash}</Text>
            <Pressable accessibilityRole="button" onPress={onDone} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Done</Text>
            </Pressable>
          </View>
        )}

        <View accessibilityRole="alert" style={styles.statusCard}>
          <Text style={styles.label}>STATUS</Text>
          <Text style={styles.body}>{status}</Text>
        </View>
      </ScrollView>
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

function SendReview({ review }: { review: KernelOperationReview }) {
  return (
    <View style={styles.reviewCard}>
      <Text style={styles.reviewTitle}>Review exact transfer</Text>
      <ReviewRow label="Asset" value="ETH" />
      <ReviewRow label="Amount" value={`${formatEther(BigInt(review.calls[0].valueWei))} ETH`} />
      <ReviewRow label="Recipient" value={review.calls[0].to} />
      <ReviewRow label="From" value={review.account} />
      <ReviewRow label="Network" value={`${review.chain} (${review.chainId})`} />
      <ReviewRow label="Deploy account" value={review.deploymentRequired ? 'Yes' : 'No'} />
      <ReviewRow label="EntryPoint" value={review.entryPoint} />
      <ReviewRow label="Nonce" value={review.userOperation.nonce ?? 'Unavailable'} />
      <ReviewRow label="Call data" value={review.calls[0].data} />
      <ReviewRow label="Sponsored" value={review.sponsored ? 'Yes' : 'No'} />
      <ReviewRow label="Paymaster" value={review.paymaster ?? 'None'} />
      <ReviewRow label="Maximum network fee" value={`${review.maximumNetworkFeeWei} wei`} />
      <ReviewRow label="Encoded account call" value={review.userOperation.callData ?? 'Unavailable'} />
      <ReviewRow label="UserOperation hash" value={review.userOperationHash} />
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

function waitForAppForeground(): Promise<boolean> {
  if (AppState.currentState === 'active') return Promise.resolve(true);
  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout>;
    let subscription: ReturnType<typeof AppState.addEventListener>;
    const finish = (foreground: boolean) => {
      clearTimeout(timeout);
      subscription.remove();
      resolve(foreground);
    };
    subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') finish(true);
    });
    timeout = setTimeout(() => finish(false), 1000);
    if (AppState.currentState === 'active') finish(true);
  });
}

function describeError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Send failed';
  return message.replace(/https?:\/\/\S+/g, '[redacted RPC URL]');
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#171713' },
  content: { padding: 22, paddingBottom: 48, gap: 18 },
  backButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  back: { color: '#d4f06a', fontSize: 14, fontWeight: '700' },
  heading: { gap: 6 },
  eyebrow: { color: '#929188', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: '#f3f0e8', fontSize: 34, fontWeight: '700', letterSpacing: -1.2 },
  body: { color: '#c8c5bb', fontSize: 14, lineHeight: 20 },
  balanceCard: { borderRadius: 18, backgroundColor: '#24241f', padding: 18, gap: 6 },
  label: { color: '#929188', fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  balance: { color: '#f3f0e8', fontSize: 24, fontWeight: '700' },
  address: { color: '#929188', fontFamily: 'monospace', fontSize: 11 },
  form: { gap: 10 },
  input: {
    minHeight: 52,
    borderRadius: 13,
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
    minHeight: 52,
    borderRadius: 13,
    backgroundColor: '#d4f06a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 6,
  },
  primaryButtonText: { color: '#202515', fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.65, transform: [{ scale: 0.98 }] },
  reviewCard: { borderRadius: 16, backgroundColor: '#292923', padding: 16, gap: 10 },
  reviewTitle: { color: '#f3f0e8', fontSize: 18, fontWeight: '700' },
  reviewRow: { gap: 2 },
  reviewLabel: { color: '#929188', fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  reviewValue: { color: '#f3f0e8', fontFamily: 'monospace', fontSize: 11, lineHeight: 17 },
  statusCard: { borderLeftWidth: 2, borderLeftColor: '#d4f06a', padding: 14, gap: 5 },
  successCard: { borderRadius: 18, backgroundColor: '#203521', padding: 18, gap: 12 },
  successTitle: { color: '#d4f06a', fontSize: 22, fontWeight: '700' },
  hash: { color: '#c8c5bb', fontFamily: 'monospace', fontSize: 11, lineHeight: 17 },
});
