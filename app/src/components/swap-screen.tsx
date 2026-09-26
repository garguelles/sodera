import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createPublicClient, erc20Abi, formatUnits, http, type Address } from 'viem';
import { sepolia } from 'viem/chains';

import { SEPOLIA_USDC_ADDRESS } from '@/wallet/sepolia';
import {
  SWAP_ASSET_DECIMALS,
  SWAP_DIRECTIONS,
  SWAP_SLIPPAGE_BPS,
  formatSwapAmount,
  formatSwapRate,
  parseSwapAmount,
  quoteSwap,
  type SwapAsset,
  type SwapDirection,
  type SwapQuote,
} from '@/wallet/uniswap-quote';
import {
  readPersistedWalletIdentity,
  type PersistedWalletIdentity,
  type WalletIdentityStorage,
} from '@/wallet/wallet-identity';
import { walletIdentityNativeStorage } from '@/wallet/wallet-identity-native-storage';

const QUOTE_DEBOUNCE_MS = 400;

export type SwapBalances = Record<SwapAsset, bigint>;

type SwapScreenProps = {
  storage?: WalletIdentityStorage;
  readBalances?: (account: Address) => Promise<SwapBalances>;
  quote?: (request: { direction: SwapDirection; amountIn: bigint }) => Promise<SwapQuote>;
  onDone?: () => void;
};

type LoadedWallet = PersistedWalletIdentity & { balances: SwapBalances };
type AmountCheck =
  | { kind: 'empty' }
  | { kind: 'invalid'; message: string }
  | { kind: 'valid'; amountIn: bigint };
type QuoteResult = { direction: SwapDirection; amountIn: bigint } & (
  | { quote: SwapQuote }
  | { error: string }
);
type QuoteState =
  | { kind: 'idle' }
  | { kind: 'invalid'; message: string }
  | { kind: 'loading' }
  | { kind: 'ready'; quote: SwapQuote }
  | { kind: 'error'; message: string };

const defaultQuote: NonNullable<SwapScreenProps['quote']> = (request) => quoteSwap(request);

export function SwapScreen({
  storage = walletIdentityNativeStorage,
  readBalances = readSepoliaSwapBalances,
  quote = defaultQuote,
  onDone = () => router.back(),
}: SwapScreenProps = {}) {
  const [wallet, setWallet] = useState<LoadedWallet | null>(null);
  const [direction, setDirection] = useState<SwapDirection>('eth-to-usdc');
  const [amount, setAmount] = useState('');
  const [quoteResult, setQuoteResult] = useState<QuoteResult | null>(null);
  const [status, setStatus] = useState('Loading wallet...');
  const invocation = useRef(0);

  const { input, output } = SWAP_DIRECTIONS[direction];

  useEffect(() => {
    const currentInvocation = ++invocation.current;
    const load = async () => {
      try {
        const identity = await readPersistedWalletIdentity(storage);
        const balances = await readBalances(identity.account);
        if (currentInvocation !== invocation.current) return;
        setWallet({ ...identity, balances });
        setStatus('');
      } catch (error) {
        if (currentInvocation === invocation.current) setStatus(describeError(error));
      }
    };
    void load();
    return () => {
      invocation.current += 1;
    };
  }, [readBalances, storage]);

  const amountCheck = checkAmount({ wallet, direction, amount });
  const validAmountIn = amountCheck.kind === 'valid' ? amountCheck.amountIn : null;

  useEffect(() => {
    if (validAmountIn === null) return;
    let current = true;
    const timer = setTimeout(() => {
      quote({ direction, amountIn: validAmountIn }).then(
        (nextQuote) => {
          if (current) setQuoteResult({ direction, amountIn: validAmountIn, quote: nextQuote });
        },
        (error: unknown) => {
          if (current) {
            setQuoteResult({ direction, amountIn: validAmountIn, error: describeError(error) });
          }
        },
      );
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [direction, quote, validAmountIn]);

  const quoteState = resolveQuoteState(amountCheck, direction, quoteResult);

  const switchDirection = () => {
    setDirection((currentDirection) =>
      currentDirection === 'eth-to-usdc' ? 'usdc-to-eth' : 'eth-to-usdc',
    );
    setAmount('');
  };

  const fillMaximum = () => {
    if (!wallet) return;
    setAmount(formatUnits(wallet.balances[input], SWAP_ASSET_DECIMALS[input]));
  };

  const readyQuote = quoteState.kind === 'ready' ? quoteState.quote : null;
  const amountMessage =
    quoteState.kind === 'invalid' || quoteState.kind === 'error' ? quoteState.message : '';

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" onPress={onDone} style={styles.backButton}>
          <Text style={styles.back}>Back</Text>
        </Pressable>

        <View style={styles.heading}>
          <Text style={styles.eyebrow}>ETHEREUM SEPOLIA · UNISWAP</Text>
          <Text style={styles.title}>Swap</Text>
          <Text style={styles.body}>Trade between ETH and USDC in your wallet.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>YOU PAY</Text>
          <View style={styles.amountRow}>
            <TextInput
              accessibilityLabel={`${input} amount to pay`}
              editable={Boolean(wallet)}
              inputMode="decimal"
              onChangeText={setAmount}
              placeholder="0.0"
              placeholderTextColor="#66665d"
              style={styles.amountInput}
              value={amount}
            />
            <Text style={styles.asset}>{input}</Text>
          </View>
          <View style={styles.balanceRow}>
            <Text style={styles.balanceText}>
              Balance: {wallet ? `${formatSwapAmount(wallet.balances[input], input)} ${input}` : '...'}
            </Text>
            <Pressable
              accessibilityLabel={`Use full ${input} balance`}
              accessibilityRole="button"
              disabled={!wallet}
              onPress={fillMaximum}
              style={({ pressed }) => [styles.maxButton, pressed && styles.pressed]}
            >
              <Text style={styles.maxButtonText}>Max</Text>
            </Pressable>
          </View>
          {amountMessage ? (
            <Text accessibilityRole="alert" style={styles.fieldError}>
              {amountMessage}
            </Text>
          ) : null}
        </View>

        <Pressable
          accessibilityLabel={`Switch to paying with ${output}`}
          accessibilityRole="button"
          onPress={switchDirection}
          style={({ pressed }) => [styles.switchButton, pressed && styles.pressed]}
        >
          <Text style={styles.switchButtonText}>⇅ Switch</Text>
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.label}>YOU RECEIVE (ESTIMATED)</Text>
          <Text accessibilityLiveRegion="polite" style={styles.receiveAmount}>
            {quoteState.kind === 'loading'
              ? 'Getting quote...'
              : readyQuote
                ? `${formatSwapAmount(readyQuote.amountOut, output)} ${output}`
                : `0 ${output}`}
          </Text>
        </View>

        {readyQuote ? (
          <View style={styles.details}>
            <DetailRow
              label="Minimum received"
              value={`${formatSwapAmount(readyQuote.minAmountOut, output)} ${output}`}
            />
            <DetailRow label="Slippage limit" value={`${Number(SWAP_SLIPPAGE_BPS) / 100}%`} />
            <DetailRow label="Rate" value={formatSwapRate(readyQuote)} />
            <DetailRow label="Route" value="Uniswap v4 · ETH/USDC pool" last />
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          disabled
          style={[styles.primaryButton, styles.disabled]}
        >
          <Text style={styles.primaryButtonText}>Review swap</Text>
        </Pressable>

        {status ? (
          <View accessibilityRole="alert" style={styles.statusCard}>
            <Text style={styles.statusText}>{status}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function checkAmount({
  wallet,
  direction,
  amount,
}: {
  wallet: LoadedWallet | null;
  direction: SwapDirection;
  amount: string;
}): AmountCheck {
  if (!wallet || !amount.trim()) return { kind: 'empty' };
  try {
    const balance = wallet.balances[SWAP_DIRECTIONS[direction].input];
    return { kind: 'valid', amountIn: parseSwapAmount({ direction, amount, balance }) };
  } catch (error) {
    return { kind: 'invalid', message: describeError(error) };
  }
}

function resolveQuoteState(
  amountCheck: AmountCheck,
  direction: SwapDirection,
  result: QuoteResult | null,
): QuoteState {
  if (amountCheck.kind === 'empty') return { kind: 'idle' };
  if (amountCheck.kind === 'invalid') return amountCheck;
  if (!result || result.direction !== direction || result.amountIn !== amountCheck.amountIn) {
    return { kind: 'loading' };
  }
  return 'quote' in result
    ? { kind: 'ready', quote: result.quote }
    : { kind: 'error', message: result.error };
}

function DetailRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.detailRow, !last && styles.detailDivider]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text selectable style={styles.detailValue}>{value}</Text>
    </View>
  );
}

async function readSepoliaSwapBalances(account: Address): Promise<SwapBalances> {
  const rpcUrl = process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error('EXPO_PUBLIC_SEPOLIA_RPC_URL is required to swap');
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  if ((await client.getChainId()) !== sepolia.id) throw new Error('Swap RPC is not Ethereum Sepolia');
  const [eth, usdc] = await Promise.all([
    client.getBalance({ address: account }),
    client.readContract({
      address: SEPOLIA_USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    }),
  ]);
  return { ETH: eth, USDC: usdc };
}

function describeError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Swap failed';
  return message.replace(/https?:\/\/\S+/g, '[redacted RPC URL]');
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#171713' },
  content: { flexGrow: 1, padding: 22, paddingBottom: 48, gap: 16 },
  backButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  back: { color: '#d4f06a', fontSize: 14, fontWeight: '700' },
  heading: { gap: 9, paddingBottom: 6 },
  eyebrow: { color: '#d4f06a', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: '#f3f0e8', fontSize: 38, lineHeight: 43, fontWeight: '800', letterSpacing: -1.2 },
  body: { color: '#aaa89f', fontSize: 16, lineHeight: 23 },
  card: {
    borderRadius: 20,
    borderCurve: 'continuous',
    backgroundColor: '#24241f',
    padding: 18,
    gap: 10,
  },
  label: { color: '#929188', fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  amountInput: {
    flex: 1,
    minHeight: 52,
    color: '#f3f0e8',
    fontSize: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    padding: 0,
  },
  asset: { color: '#d4f06a', fontSize: 16, fontWeight: '800' },
  balanceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  balanceText: { color: '#aaa89f', fontSize: 13, fontVariant: ['tabular-nums'], flexShrink: 1 },
  maxButton: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 10,
    borderCurve: 'continuous',
    backgroundColor: '#34342d',
  },
  maxButtonText: { color: '#d4f06a', fontSize: 13, fontWeight: '800' },
  fieldError: { color: '#f4d4b5', fontSize: 13, lineHeight: 19 },
  switchButton: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 22,
    borderCurve: 'continuous',
    backgroundColor: '#34342d',
  },
  switchButtonText: { color: '#f3f0e8', fontSize: 14, fontWeight: '800' },
  receiveAmount: {
    color: '#f3f0e8',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  details: { paddingHorizontal: 4 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 12 },
  detailDivider: { borderBottomWidth: 1, borderBottomColor: '#383831' },
  detailLabel: { color: '#929188', fontSize: 13, fontWeight: '700' },
  detailValue: {
    color: '#f3f0e8',
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
    textAlign: 'right',
  },
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
  statusCard: {
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: '#352a22',
    padding: 14,
  },
  statusText: { color: '#f4d4b5', fontSize: 14, lineHeight: 20 },
});
