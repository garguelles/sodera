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
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  type Address,
  type Hash,
} from 'viem';
import { sepolia } from 'viem/chains';

import { AssetLogo } from '@/components/asset-logo';
import { platinum } from '@/constants/theme';
import { withoutCommittedUsdc } from '@/wallet/aqua-position';
import {
  createKernelPasskeyExecutionClient,
  type KernelExecutionCall,
  type KernelOperationReview,
  type KernelPasskeyExecutionClient,
} from '@/wallet/kernel-passkey-execution';
import { createPasskeyCeremonyClient, type PasskeyCeremonyClient } from '@/wallet/passkey-ceremony';
import { passkeyNativeAdapter } from '@/wallet/passkey-native-adapter';
import { SEPOLIA_USDC_ADDRESS, sepoliaTransactionUrl, shortenAddress } from '@/wallet/sepolia';
import { multiBaasTransactionActivityProvider } from '@/wallet/transaction-activity-multibaas';
import { SWAP_POOL_ID } from '@/wallet/uniswap-sdk';
import { buildSwapCalls, swapDeadline } from '@/wallet/uniswap-swap-calls';
import {
  SWAP_ASSET_DECIMALS,
  SWAP_DIRECTIONS,
  SWAP_SLIPPAGE_LABEL,
  formatPriceImpact,
  formatSwapAmount,
  formatSwapRate,
  isHighPriceImpact,
  parseSwapAmount,
  quoteSwap,
  type SwapAsset,
  type SwapDirection,
  type SwapQuote,
} from '@/wallet/uniswap-quote';
import { walletHomeLiveProvider } from '@/wallet/wallet-home-live';
import {
  markPersistedWalletIdentityDeployed,
  readPersistedWalletIdentity,
  type PersistedWalletIdentity,
  type WalletIdentityStorage,
} from '@/wallet/wallet-identity';
import { walletIdentityNativeStorage } from '@/wallet/wallet-identity-native-storage';
import { waitForAppForeground } from '@/wallet/wait-for-app-foreground';

const QUOTE_DEBOUNCE_MS = 400;
const REVIEW_TTL_MS = 60_000;
const REVIEW_EXPIRED_MESSAGE = 'That quote expired. Review the swap again for a fresh price.';
const currentTimeMs = () => Date.now();
const SLIPPAGE_LABEL = SWAP_SLIPPAGE_LABEL;

const defaultCeremonyClient = createPasskeyCeremonyClient(passkeyNativeAdapter, {
  isForeground: waitForAppForeground,
});

export type SwapBalances = Record<SwapAsset, bigint>;

type SwapScreenProps = {
  ceremonyClient?: PasskeyCeremonyClient;
  storage?: WalletIdentityStorage;
  createExecutionClient?: typeof createKernelPasskeyExecutionClient;
  readBalances?: (account: Address) => Promise<SwapBalances>;
  quote?: (request: { direction: SwapDirection; amountIn: bigint }) => Promise<SwapQuote>;
  copyTransactionHash?: (hash: Hash) => Promise<void>;
  openTransaction?: (url: string) => Promise<void>;
  onDone?: () => void;
};

type LoadedWallet = PersistedWalletIdentity & { balances: SwapBalances };
type SwapStep = 'entry' | 'review' | 'authorizing' | 'success';
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
type PreparedSwap = {
  quote: SwapQuote;
  calls: KernelExecutionCall[];
  deadline: bigint;
  review: KernelOperationReview;
  client: KernelPasskeyExecutionClient;
  preparedAt: number;
};
type CompletedSwap = { quote: SwapQuote; transactionHash: Hash };

const defaultQuote: NonNullable<SwapScreenProps['quote']> = (request) => quoteSwap(request);

export function SwapScreen({
  ceremonyClient = defaultCeremonyClient,
  storage = walletIdentityNativeStorage,
  createExecutionClient = createKernelPasskeyExecutionClient,
  readBalances = readSepoliaSwapBalances,
  quote = defaultQuote,
  copyTransactionHash = async (hash) => {
    await Clipboard.setStringAsync(hash);
  },
  openTransaction = async (url) => {
    await Linking.openURL(url);
  },
  onDone = () => router.back(),
}: SwapScreenProps = {}) {
  const [wallet, setWallet] = useState<LoadedWallet | null>(null);
  const [direction, setDirection] = useState<SwapDirection>('eth-to-usdc');
  const [amount, setAmount] = useState('');
  const [quoteResult, setQuoteResult] = useState<QuoteResult | null>(null);
  const [prepared, setPrepared] = useState<PreparedSwap | null>(null);
  const [completed, setCompleted] = useState<CompletedSwap | null>(null);
  const [status, setStatus] = useState('Loading wallet...');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<SwapStep>('entry');
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [hashCopied, setHashCopied] = useState(false);
  const invocation = useRef(0);
  const executionInFlight = useRef(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        setPrepared(null);
        setStep((current) => (current === 'review' ? 'entry' : current));
      }
    });
    return () => {
      invocation.current += 1;
      ceremonyClient.cancelPending();
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      subscription.remove();
    };
  }, [ceremonyClient, readBalances, storage]);

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

  const editAmount = (value: string) => {
    setAmount(value);
    if (wallet) setStatus('');
  };

  const switchDirection = () => {
    setDirection((currentDirection) =>
      currentDirection === 'eth-to-usdc' ? 'usdc-to-eth' : 'eth-to-usdc',
    );
    editAmount('');
  };

  const fillMaximum = () => {
    if (!wallet) return;
    editAmount(formatUnits(wallet.balances[input], SWAP_ASSET_DECIMALS[input]));
  };

  // Each prepare consumes sponsorship allowance, so it runs only when the user asks to review.
  const prepare = async () => {
    if (!wallet || busy || amountCheck.kind !== 'valid') return;
    const currentInvocation = ++invocation.current;
    setBusy(true);
    setShowTechnicalDetails(false);
    setStatus('Getting a fresh quote and simulating the exact swap...');
    try {
      const freshQuote = await quote({ direction, amountIn: amountCheck.amountIn });
      const deadline = swapDeadline();
      const calls = buildSwapCalls({
        direction,
        amountIn: freshQuote.amountIn,
        minAmountOut: freshQuote.minAmountOut,
        deadline,
      });
      const client = await createExecutionClient({ ceremonyClient, credential: wallet.credential });
      if (client.account.toLowerCase() !== wallet.account.toLowerCase()) {
        throw new Error('The signing account does not match the persisted wallet');
      }
      const review = await client.prepare(calls);
      if (!reviewMatchesCalls(review, calls)) {
        throw new Error('The prepared swap does not match the requested calls');
      }
      if (currentInvocation !== invocation.current) return;
      setPrepared({ quote: freshQuote, calls, deadline, review, client, preparedAt: currentTimeMs() });
      setStatus('');
      setStep('review');
    } catch (error) {
      if (currentInvocation === invocation.current) setStatus(describeSwapError(error));
    } finally {
      if (currentInvocation === invocation.current) setBusy(false);
    }
  };

  const expireReview = () => {
    setPrepared(null);
    setStep((current) => (current === 'review' ? 'entry' : current));
    setStatus(REVIEW_EXPIRED_MESSAGE);
  };

  useEffect(() => {
    if (step !== 'review' || !prepared) return;
    const timer = setTimeout(
      expireReview,
      Math.max(0, prepared.preparedAt + REVIEW_TTL_MS - currentTimeMs()),
    );
    return () => clearTimeout(timer);
  }, [prepared, step]);

  const execute = async () => {
    if (!wallet || !prepared || executionInFlight.current) return;
    // Timers pause while the app sleeps, so recheck the age at confirmation time.
    if (currentTimeMs() - prepared.preparedAt > REVIEW_TTL_MS) {
      expireReview();
      return;
    }
    executionInFlight.current = true;
    const currentInvocation = ++invocation.current;
    const approvedSwap = prepared;
    setBusy(true);
    setStatus('');
    setStep('authorizing');
    try {
      const evidence = await approvedSwap.client.execute(approvedSwap.review.userOperationHash);
      if (currentInvocation !== invocation.current) return;
      try {
        await markPersistedWalletIdentityDeployed(storage, evidence.account);
      } catch {
        // The confirmed chain result remains authoritative; reopening reconciles this marker.
      }
      setCompleted({ quote: approvedSwap.quote, transactionHash: evidence.transactionHash });
      setPrepared(null);
      setStep('success');
      walletHomeLiveProvider.refresh();
      multiBaasTransactionActivityProvider.refresh();
    } catch (error) {
      if (currentInvocation === invocation.current) {
        setPrepared(null);
        setStep('entry');
        setStatus(describeSwapError(error));
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

  const readyQuote = quoteState.kind === 'ready' ? quoteState.quote : null;
  const amountMessage =
    quoteState.kind === 'invalid' || quoteState.kind === 'error' ? quoteState.message : '';
  const canReview = Boolean(wallet) && amountCheck.kind === 'valid' && !busy;

  return (
    <SafeAreaView style={styles.screen}>
      {step === 'entry' ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable accessibilityRole="button" onPress={onDone} style={styles.backButton}>
            <Text style={styles.back}>Back</Text>
          </Pressable>

          <View style={styles.heading}>
            <Text style={styles.eyebrow}>ETHEREUM · UNISWAP</Text>
            <Text style={styles.title}>Swap</Text>
            <Text style={styles.body}>Trade between ETH and USDC in your wallet.</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>YOU PAY</Text>
            <View style={styles.amountRow}>
              <TextInput
                accessibilityLabel={`${input} amount to pay`}
                editable={Boolean(wallet) && !busy}
                inputMode="decimal"
                onChangeText={editAmount}
                placeholder="0.0"
                placeholderTextColor={platinum.colors.faintText}
                style={styles.amountInput}
                value={amount}
              />
              <AssetLogo asset={input} size={28} />
              <Text style={styles.asset}>{input}</Text>
            </View>
            <View style={styles.balanceRow}>
              <Text style={styles.balanceText}>
                Balance:{' '}
                {wallet ? `${formatSwapAmount(wallet.balances[input], input)} ${input}` : '...'}
              </Text>
              <Pressable
                accessibilityLabel={`Use full ${input} balance`}
                accessibilityRole="button"
                disabled={!wallet || busy}
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
            disabled={busy}
            onPress={switchDirection}
            style={({ pressed }) => [styles.switchButton, pressed && styles.pressed]}
          >
            <Text style={styles.switchButtonText}>⇅ Switch</Text>
          </Pressable>

          <View style={styles.card}>
            <Text style={styles.label}>YOU RECEIVE (ESTIMATED)</Text>
            <View style={styles.amountRow}>
              <Text accessibilityLiveRegion="polite" style={styles.receiveAmount}>
                {quoteState.kind === 'loading'
                  ? 'Getting quote...'
                  : readyQuote
                    ? `${formatSwapAmount(readyQuote.amountOut, output)} ${output}`
                    : `0 ${output}`}
              </Text>
              <AssetLogo asset={output} size={28} />
            </View>
          </View>

          {readyQuote ? (
            <View style={styles.details}>
              <DetailRow
                label="Minimum received"
                value={`${formatSwapAmount(readyQuote.minAmountOut, output)} ${output}`}
              />
              <DetailRow label="Slippage limit" value={SLIPPAGE_LABEL} />
              <DetailRow label="Rate" value={formatSwapRate(readyQuote)} />
              <PriceImpactRow priceImpact={readyQuote.priceImpact} Row={DetailRow} />
              <DetailRow label="Route" value="Uniswap v4 · ETH/USDC pool" last />
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: !canReview }}
            disabled={!canReview}
            onPress={() => void prepare()}
            style={({ pressed }) => [
              styles.primaryButton,
              !canReview && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {busy ? 'Preparing your swap...' : 'Review swap'}
            </Text>
          </Pressable>

          {status ? (
            <View accessibilityRole="alert" style={styles.statusCard}>
              <Text style={styles.statusText}>{status}</Text>
            </View>
          ) : null}
        </ScrollView>
      ) : null}

      {step === 'review' && prepared ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setPrepared(null);
              setStep('entry');
            }}
            style={styles.backButton}
          >
            <Text style={styles.back}>Back</Text>
          </Pressable>

          <View style={styles.heading}>
            <Text style={styles.eyebrow}>CHECK BEFORE SWAPPING</Text>
            <Text style={styles.title}>Does this look right?</Text>
            <Text style={styles.body}>
              If the price moves past your minimum, the swap is cancelled instead of filling.
            </Text>
          </View>

          <SwapReview
            prepared={prepared}
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
          <Text style={styles.reassurance}>
            Your passkey confirms only this swap. The quote expires after one minute.
          </Text>
        </ScrollView>
      ) : null}

      {step === 'authorizing' ? (
        <View accessibilityLiveRegion="polite" style={styles.centeredStep}>
          <View style={styles.progressIcon}>
            <ActivityIndicator color={platinum.colors.emerald} size="large" />
          </View>
          <Text style={styles.centeredTitle}>Confirm on your device</Text>
          <Text style={styles.centeredBody}>
            Follow the passkey prompt. Keep Sodera open while your swap is confirmed.
          </Text>
        </View>
      ) : null}

      {step === 'success' && completed ? (
        <ScrollView contentContainerStyle={styles.successContent}>
          <View style={styles.successIcon}>
            <Text importantForAccessibility="no" style={styles.successIconText}>
              ✓
            </Text>
          </View>
          <View style={styles.successHeading}>
            <Text accessibilityRole="header" style={styles.successTitle}>
              Swap complete
            </Text>
            <Text style={styles.centeredBody}>
              {`You swapped ${formatSwapAmount(completed.quote.amountIn, SWAP_DIRECTIONS[completed.quote.direction].input)} ${SWAP_DIRECTIONS[completed.quote.direction].output} on Ethereum.`}
            </Text>
          </View>

          <View style={styles.transactionCard}>
            <Text style={styles.label}>TRANSACTION</Text>
            <Text selectable style={styles.shortHash}>
              {shortenHash(completed.transactionHash)}
            </Text>
            <View style={styles.transactionActions}>
              <Pressable
                accessibilityLabel="Copy transaction hash"
                accessibilityRole="button"
                onPress={() => void copyHash(completed.transactionHash)}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
              >
                <Text style={styles.secondaryButtonText}>{hashCopied ? 'Copied' : 'Copy'}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="link"
                onPress={() => void viewTransaction(completed.transactionHash)}
                style={({ pressed }) => [styles.explorerLink, pressed && styles.pressed]}
              >
                <Text style={styles.explorerLinkText}>View on explorer</Text>
              </Pressable>
            </View>
          </View>

          {status ? (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {status}
            </Text>
          ) : null}

          <Pressable accessibilityRole="button" onPress={onDone} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Done</Text>
          </Pressable>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function SwapReview({
  prepared,
  showTechnicalDetails,
  onToggleTechnicalDetails,
}: {
  prepared: PreparedSwap;
  showTechnicalDetails: boolean;
  onToggleTechnicalDetails: () => void;
}) {
  const { quote, calls, deadline, review } = prepared;
  const { input, output } = SWAP_DIRECTIONS[quote.direction];
  const pay = `${formatSwapAmount(quote.amountIn, input)} ${input}`;
  const receive = `${formatSwapAmount(quote.amountOut, output)} ${output}`;
  const minimum = `${formatSwapAmount(quote.minAmountOut, output)} ${output}`;
  const expiry = new Date(Number(deadline) * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const callLabels =
    quote.direction === 'usdc-to-eth'
      ? ['Approve USDC for Permit2', 'Allow Uniswap router in Permit2', 'Uniswap swap']
      : ['Uniswap swap'];

  return (
    <View style={styles.reviewSection}>
      <View style={styles.amountSummary}>
        <Text style={styles.label}>YOU PAY</Text>
        <Text selectable style={styles.reviewAmount}>{pay}</Text>
        <Text style={styles.label}>YOU RECEIVE (ESTIMATED)</Text>
        <Text selectable style={styles.reviewReceive}>{receive}</Text>
      </View>

      <View style={styles.reviewDetails}>
        <FriendlyReviewRow label="Minimum received" value={minimum} />
        <FriendlyReviewRow label="Slippage limit" value={SLIPPAGE_LABEL} />
        <FriendlyReviewRow label="Rate" value={formatSwapRate(quote)} />
        <PriceImpactRow priceImpact={quote.priceImpact} Row={FriendlyReviewRow} />
        {quote.direction === 'usdc-to-eth' ? (
          <FriendlyReviewRow
            label="Approval"
            value={`Uniswap may spend exactly ${pay} for this swap, until ${expiry}. Nothing stays approved afterwards.`}
          />
        ) : null}
        <FriendlyReviewRow label="Route" value="Uniswap v4 · ETH/USDC pool" />
        <FriendlyReviewRow label="From" value={`Your wallet (${shortenAddress(review.account)})`} />
        <FriendlyReviewRow label="Network" value="Ethereum" />
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
          <FriendlyReviewRow label="Wallet setup" value="Included with this swap" last />
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
          <ReviewRow label="Pay" value={`${quote.amountIn} (${input} base units)`} />
          <ReviewRow label="Quoted output" value={`${quote.amountOut} (${output} base units)`} />
          <ReviewRow label="Minimum output" value={`${quote.minAmountOut} (${output} base units)`} />
          <ReviewRow label="Price impact" value={`${quote.priceImpact.toSignificant(6)}%`} />
          <ReviewRow label="Uniswap pool ID" value={SWAP_POOL_ID} />
          <ReviewRow label="Swap deadline" value={`${deadline} (${expiry})`} />
          {calls.map((call, index) => (
            <ReviewRow
              key={`${call.to}-${index}`}
              label={`Call ${index + 1}: ${callLabels[index]}`}
              value={`to ${call.to}\nvalue ${call.value} wei\ndata ${call.data}`}
            />
          ))}
          <ReviewRow label="From account" value={review.account} />
          <ReviewRow label="Network" value="Ethereum" />
          <ReviewRow label="Deploy account" value={review.deploymentRequired ? 'Yes' : 'No'} />
          <ReviewRow label="EntryPoint" value={review.entryPoint} />
          <ReviewRow label="Nonce" value={review.userOperation.nonce ?? 'Unavailable'} />
          <ReviewRow label="Sponsored" value={review.sponsored ? 'Yes' : 'No'} />
          <ReviewRow label="Paymaster" value={review.paymaster ?? 'None'} />
          <ReviewRow label="Maximum network fee" value={`${review.maximumNetworkFeeWei} wei`} />
          <ReviewRow
            label="Encoded account call"
            value={review.userOperation.callData ?? 'Unavailable'}
          />
          <ReviewRow label="UserOperation hash" value={review.userOperationHash} />
        </View>
      ) : null}
    </View>
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

function reviewMatchesCalls(review: KernelOperationReview, calls: KernelExecutionCall[]) {
  return (
    review.calls.length === calls.length &&
    review.calls.every(
      (reviewed, index) =>
        reviewed.to.toLowerCase() === calls[index].to.toLowerCase() &&
        reviewed.valueWei === calls[index].value.toString() &&
        reviewed.data === calls[index].data,
    )
  );
}

type RowProps = { label: string; value: string; last?: boolean; caution?: boolean };

function PriceImpactRow({
  priceImpact,
  Row,
}: {
  priceImpact: SwapQuote['priceImpact'];
  Row: (props: RowProps) => React.JSX.Element;
}) {
  const high = isHighPriceImpact(priceImpact);
  const value = formatPriceImpact(priceImpact);
  return <Row label="Price impact" value={high ? `${value} · high` : value} caution={high} />;
}

function DetailRow({ label, value, last = false, caution = false }: RowProps) {
  return (
    <View style={[styles.detailRow, !last && styles.detailDivider]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text selectable style={[styles.detailValue, caution && styles.cautionValue]}>
        {value}
      </Text>
    </View>
  );
}

function FriendlyReviewRow({ label, value, last = false, caution = false }: RowProps) {
  return (
    <View style={[styles.friendlyReviewRow, !last && styles.detailDivider]}>
      <Text style={styles.friendlyReviewLabel}>{label}</Text>
      <Text selectable style={[styles.friendlyReviewValue, caution && styles.cautionValue]}>
        {value}
      </Text>
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

function shortenHash(hash: Hash) {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

async function readSepoliaSwapBalances(account: Address): Promise<SwapBalances> {
  const rpcUrl = process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error('Ethereum RPC URL is required to swap');
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  if ((await client.getChainId()) !== sepolia.id) throw new Error('Swap RPC is connected to the wrong network');
  const [eth, usdc] = await Promise.all([
    client.getBalance({ address: account }),
    client.readContract({
      address: SEPOLIA_USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    }),
  ]);
  // USDC committed to an open Earn position stays in the wallet but is not swappable.
  return withoutCommittedUsdc(account, { ETH: eth, USDC: usdc });
}

const SWAP_ERROR_MESSAGES: { pattern: RegExp; message: string }[] = [
  {
    pattern: /0x8b063d73|V4TooLittleReceived/i,
    message: `The price moved past your ${SLIPPAGE_LABEL} limit, so nothing was swapped. Review again for a fresh quote.`,
  },
  {
    pattern: /0x5bf6f916|0xbfb22adf|0xd81b2f2e|DeadlinePassed|AllowanceExpired/i,
    message: 'The swap deadline passed before it was confirmed, so nothing was swapped. Review again.',
  },
  {
    pattern: /sponsor|paymaster|gas policy|\bAA3\d\b/i,
    message:
      'Gas sponsorship is unavailable for this swap right now, possibly because the daily limit is used up. Nothing was swapped.',
  },
  {
    pattern: /transfer amount exceeds balance|insufficient (funds|balance)/i,
    message: 'Your balance changed and no longer covers this swap. Nothing was swapped.',
  },
];

function describeSwapError(error: unknown) {
  const details: string[] = [];
  for (let current = error; current instanceof Error; current = current.cause) {
    const { details: detail, data } = current as { details?: unknown; data?: unknown };
    details.push(current.message, String(detail ?? ''), String(data ?? ''));
  }
  const text = details.join(' ');
  return SWAP_ERROR_MESSAGES.find(({ pattern }) => pattern.test(text))?.message ?? describeError(error);
}

function describeError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Swap failed';
  return message.replace(/https?:\/\/\S+/g, '[redacted RPC URL]');
}

const { colors, spacing, radius, typography } = platinum;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { flexGrow: 1, padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  successContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.xl,
  },
  backButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  back: { ...typography.bodySmall, color: colors.secondaryText },
  heading: { gap: spacing.sm, paddingBottom: spacing.xs },
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
  label: { ...typography.labelSmall, color: colors.mutedText },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  amountInput: {
    ...typography.title,
    flex: 1,
    minHeight: 52,
    color: colors.platinum,
    fontVariant: ['tabular-nums'],
    padding: 0,
  },
  asset: { ...typography.label, color: colors.emerald },
  balanceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  balanceText: { ...typography.label, color: colors.secondaryText, fontVariant: ['tabular-nums'], flexShrink: 1 },
  maxButton: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.borderLit,
    backgroundColor: colors.glassRaised,
  },
  maxButtonText: { ...typography.label, color: colors.platinum },
  fieldError: { ...typography.bodySmall, color: colors.warning },
  switchButton: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.borderLit,
    backgroundColor: colors.surfaceLow,
  },
  switchButtonText: { ...typography.label, color: colors.platinum },
  receiveAmount: { ...typography.title, flex: 1, color: colors.platinum, fontVariant: ['tabular-nums'] },
  details: { paddingHorizontal: spacing.xs },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.md },
  detailDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  detailLabel: { ...typography.bodySmall, color: colors.mutedText },
  detailValue: {
    ...typography.label,
    color: colors.platinum,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
    textAlign: 'right',
  },
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
    marginBottom: spacing.sm,
  },
  reviewReceive: { ...typography.heading, color: colors.emerald, fontVariant: ['tabular-nums'] },
  reviewDetails: { paddingHorizontal: spacing.xs },
  friendlyReviewRow: { gap: spacing.sm, paddingVertical: spacing.md },
  friendlyReviewLabel: { ...typography.caption, color: colors.mutedText },
  friendlyReviewValue: { ...typography.bodySmall, fontFamily: typography.subheading.fontFamily, color: colors.platinum },
  cautionValue: { color: colors.warning },
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
    borderWidth: 1,
    borderColor: colors.borderLit,
    backgroundColor: colors.glassRaised,
  },
  secondaryButtonText: { ...typography.label, color: colors.platinum },
  explorerLink: {
    minHeight: 48,
    flex: 1.6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.borderLit,
    backgroundColor: colors.glassRaised,
  },
  explorerLinkText: { ...typography.label, color: colors.emerald },
  errorText: { ...typography.bodySmall, color: colors.negative, textAlign: 'center' },
});
