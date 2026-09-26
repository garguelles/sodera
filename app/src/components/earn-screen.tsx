import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { erc20Abi, formatEther, formatUnits, type Address, type Hash } from 'viem';

import { platinum } from '@/constants/theme';
import { buildClosePositionCalls, buildOpenPositionCalls } from '@/wallet/aqua-calls';
import {
  aquaPositionStore,
  availableAfterCommitment,
  earnedVsHoldingUsdCents,
  formatPositionAmounts,
  readAquaPosition,
  readWethBalance,
  rpcReadClient,
  trimEther,
  valueUsdCents,
  wethForUsdc,
  type AquaPositionRecord,
  type AquaPositionState,
  type EthUsdPrice,
} from '@/wallet/aqua-position';
import { AQUA_FEE_LABEL, buildAquaOrder } from '@/wallet/aqua-strategy';
import {
  createKernelPasskeyExecutionClient,
  type KernelExecutionCall,
  type KernelOperationReview,
  type KernelPasskeyExecutionClient,
} from '@/wallet/kernel-passkey-execution';
import { createPasskeyCeremonyClient, type PasskeyCeremonyClient } from '@/wallet/passkey-ceremony';
import { passkeyNativeAdapter } from '@/wallet/passkey-native-adapter';
import { sepoliaClient } from '@/wallet/send-transfer';
import {
  SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS,
  SEPOLIA_USDC_ADDRESS,
  sepoliaTransactionUrl,
  shortenAddress,
} from '@/wallet/sepolia';
import { multiBaasTransactionActivityProvider } from '@/wallet/transaction-activity-multibaas';
import { parseSwapAmount } from '@/wallet/uniswap-quote';
import { createDefaultBalanceClient, readEthUsdPrice, walletHomeLiveProvider } from '@/wallet/wallet-home-live';
import {
  markPersistedWalletIdentityDeployed,
  readPersistedWalletIdentity,
  type PersistedWalletIdentity,
  type WalletIdentityStorage,
} from '@/wallet/wallet-identity';
import { walletIdentityNativeStorage } from '@/wallet/wallet-identity-native-storage';
import { waitForAppForeground } from '@/wallet/wait-for-app-foreground';

const REVIEW_TTL_MS = 60_000;
const REVIEW_EXPIRED_MESSAGE = 'That review expired. Review again for a fresh price.';
const currentTimeMs = () => Date.now();

const defaultCeremonyClient = createPasskeyCeremonyClient(passkeyNativeAdapter, {
  isForeground: waitForAppForeground,
});

/** Everything Earn shows, read fresh on load and again before each review. */
export type EarnWallet = {
  eth: bigint;
  usdc: bigint;
  weth: bigint;
  price: EthUsdPrice | null;
  position: AquaPositionState | null;
};

type EarnScreenProps = {
  ceremonyClient?: PasskeyCeremonyClient;
  storage?: WalletIdentityStorage;
  positionStore?: Pick<typeof aquaPositionStore, 'read' | 'save' | 'clear'>;
  createExecutionClient?: typeof createKernelPasskeyExecutionClient;
  readWallet?: (account: Address, record: AquaPositionRecord | null) => Promise<EarnWallet>;
  copyTransactionHash?: (hash: Hash) => Promise<void>;
  openTransaction?: (url: string) => Promise<void>;
  onDone?: () => void;
};

type LoadedWallet = PersistedWalletIdentity & EarnWallet;
type EarnStep = 'overview' | 'review' | 'authorizing' | 'success';
type OpenPlan = { kind: 'open'; usdc: bigint; weth: bigint; wrapWei: bigint; record: AquaPositionRecord };
type ClosePlan = { kind: 'close'; position: AquaPositionState; unwrapWei: bigint };
type Prepared = (OpenPlan | ClosePlan) & {
  calls: KernelExecutionCall[];
  review: KernelOperationReview;
  client: KernelPasskeyExecutionClient;
  price: EthUsdPrice | null;
  preparedAt: number;
};
type Completed = { kind: 'open' | 'close'; summary: string; transactionHash: Hash };
type AmountCheck =
  | { kind: 'empty' }
  | { kind: 'invalid'; message: string }
  | { kind: 'valid'; usdc: bigint; weth: bigint; wrapWei: bigint };

export function EarnScreen({
  ceremonyClient = defaultCeremonyClient,
  storage = walletIdentityNativeStorage,
  positionStore = aquaPositionStore,
  createExecutionClient = createKernelPasskeyExecutionClient,
  readWallet = readEarnWallet,
  copyTransactionHash = async (hash) => {
    await Clipboard.setStringAsync(hash);
  },
  openTransaction = async (url) => {
    await Linking.openURL(url);
  },
  onDone = () => router.back(),
}: EarnScreenProps = {}) {
  const [wallet, setWallet] = useState<LoadedWallet | null>(null);
  const [amount, setAmount] = useState('');
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [completed, setCompleted] = useState<Completed | null>(null);
  const [status, setStatus] = useState('Loading wallet...');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<EarnStep>('overview');
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [hashCopied, setHashCopied] = useState(false);
  const invocation = useRef(0);
  const executionInFlight = useRef(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadWallet = useCallback(async () => {
    const identity = await readPersistedWalletIdentity(storage);
    const record = await positionStore.read(identity.account);
    return { ...identity, ...(await readWallet(identity.account, record)) };
  }, [positionStore, readWallet, storage]);

  const reload = useCallback(async () => {
    const currentInvocation = ++invocation.current;
    try {
      const next = await loadWallet();
      if (currentInvocation !== invocation.current) return;
      setWallet(next);
      setStatus('');
    } catch (error) {
      if (currentInvocation === invocation.current) setStatus(describeError(error));
    }
  }, [loadWallet]);

  const refresh = async () => {
    setBusy(true);
    await reload();
    setBusy(false);
  };

  useEffect(() => {
    const currentInvocation = ++invocation.current;
    const load = async () => {
      try {
        const next = await loadWallet();
        if (currentInvocation !== invocation.current) return;
        setWallet(next);
        setStatus('');
      } catch (error) {
        if (currentInvocation === invocation.current) setStatus(describeError(error));
      }
    };
    void load();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        setPrepared(null);
        setStep((current) => (current === 'review' ? 'overview' : current));
      }
    });
    return () => {
      invocation.current += 1;
      ceremonyClient.cancelPending();
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      subscription.remove();
    };
  }, [ceremonyClient, loadWallet]);

  const amountCheck = checkAmount(wallet, amount);

  const editAmount = (value: string) => {
    setAmount(value);
    if (wallet) setStatus('');
  };

  // Each prepare consumes sponsorship allowance, so it runs only when the user asks to review.
  const prepare = async (kind: 'open' | 'close') => {
    if (!wallet || busy) return;
    if (kind === 'open' && amountCheck.kind !== 'valid') return;
    const currentInvocation = ++invocation.current;
    setBusy(true);
    setShowTechnicalDetails(false);
    setStatus('Reading fresh balances and simulating the exact transaction...');
    try {
      const fresh = await loadWallet();
      let plan: OpenPlan | ClosePlan;
      let calls: KernelExecutionCall[];
      if (kind === 'open') {
        const check = checkAmount(fresh, amount);
        if (check.kind !== 'valid') throw new Error(check.kind === 'invalid' ? check.message : 'Enter an amount');
        const salt = BigInt(Math.floor(currentTimeMs() / 1000));
        const { order, strategyHash } = buildAquaOrder({ maker: fresh.account, salt });
        calls = buildOpenPositionCalls({ order, usdcAmount: check.usdc, wethAmount: check.weth, wrapWei: check.wrapWei });
        plan = {
          kind: 'open',
          usdc: check.usdc,
          weth: check.weth,
          wrapWei: check.wrapWei,
          record: {
            account: fresh.account,
            order,
            strategyHash,
            usdcAmount: check.usdc.toString(),
            wethAmount: check.weth.toString(),
            openedAt: new Date(currentTimeMs()).toISOString(),
            transactionHash: null,
          },
        };
      } else {
        if (!fresh.position) throw new Error('There is no open position to close');
        // Unwrap only what the position returns, never WETH the wallet held apart from it.
        const unwrapWei = fresh.position.weth < fresh.weth ? fresh.position.weth : fresh.weth;
        calls = buildClosePositionCalls({ strategyHash: fresh.position.record.strategyHash, unwrapWei });
        plan = { kind: 'close', position: fresh.position, unwrapWei };
      }
      const client = await createExecutionClient({ ceremonyClient, credential: fresh.credential });
      if (client.account.toLowerCase() !== fresh.account.toLowerCase()) {
        throw new Error('The signing account does not match the persisted wallet');
      }
      const review = await client.prepare(calls);
      if (!reviewMatchesCalls(review, calls)) {
        throw new Error('The prepared transaction does not match the requested calls');
      }
      if (currentInvocation !== invocation.current) return;
      setWallet(fresh);
      setPrepared({ ...plan, calls, review, client, price: fresh.price, preparedAt: currentTimeMs() });
      setStatus('');
      setStep('review');
    } catch (error) {
      if (currentInvocation === invocation.current) setStatus(describeEarnError(error));
    } finally {
      if (currentInvocation === invocation.current) setBusy(false);
    }
  };

  const expireReview = () => {
    setPrepared(null);
    setStep((current) => (current === 'review' ? 'overview' : current));
    setStatus(REVIEW_EXPIRED_MESSAGE);
  };

  useEffect(() => {
    if (step !== 'review' || !prepared) return;
    const timer = setTimeout(expireReview, Math.max(0, prepared.preparedAt + REVIEW_TTL_MS - currentTimeMs()));
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
    const approved = prepared;
    setBusy(true);
    setStatus('');
    setStep('authorizing');
    try {
      // Record the position before it is submitted, so a crash cannot orphan it. Loading reads
      // Aqua and ignores a record whose strategy was never shipped.
      if (approved.kind === 'open') await positionStore.save(approved.record);
      const evidence = await approved.client.execute(approved.review.userOperationHash);
      if (approved.kind === 'open') {
        await positionStore.save({ ...approved.record, transactionHash: evidence.transactionHash });
      } else {
        await positionStore.clear();
      }
      if (currentInvocation !== invocation.current) return;
      try {
        await markPersistedWalletIdentityDeployed(storage, evidence.account);
      } catch {
        // The confirmed chain result remains authoritative; reopening reconciles this marker.
      }
      setCompleted({
        kind: approved.kind,
        summary:
          approved.kind === 'open'
            ? `You added ${formatPositionAmounts({ usdc: approved.usdc, weth: approved.weth })} to a 1inch Aqua pool. The tokens stay in your wallet.`
            : `You closed your position. ${formatPositionAmounts(approved.position)} is free to use again.`,
        transactionHash: evidence.transactionHash,
      });
      setPrepared(null);
      setAmount('');
      setStep('success');
      walletHomeLiveProvider.refresh();
      multiBaasTransactionActivityProvider.refresh();
    } catch (error) {
      if (currentInvocation === invocation.current) {
        setPrepared(null);
        setStep('overview');
        setStatus(describeEarnError(error));
      }
    } finally {
      executionInFlight.current = false;
      if (currentInvocation === invocation.current) setBusy(false);
    }
  };

  const finish = () => {
    setCompleted(null);
    setStep('overview');
    void reload();
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

  const position = wallet?.position ?? null;
  const canReviewOpen = Boolean(wallet) && amountCheck.kind === 'valid' && !busy;

  return (
    <SafeAreaView style={styles.screen}>
      {step === 'overview' ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable accessibilityRole="button" onPress={onDone} style={styles.backButton}>
            <Text style={styles.back}>Back</Text>
          </Pressable>

          <View style={styles.heading}>
            <Text style={styles.eyebrow}>ETHEREUM SEPOLIA · 1INCH AQUA</Text>
            <Text style={styles.title}>Earn</Text>
            <Text style={styles.body}>
              {`Provide USDC/WETH liquidity straight from your wallet. Your tokens never leave it: traders swap against them and pay you a ${AQUA_FEE_LABEL} fee.`}
            </Text>
          </View>

          {position && wallet ? (
            <PositionCard
              position={position}
              price={wallet.price}
              busy={busy}
              onRefresh={() => void refresh()}
              onClose={() => void prepare('close')}
            />
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.label}>YOU ADD</Text>
                <View style={styles.amountRow}>
                  <TextInput
                    accessibilityLabel="USDC amount to add"
                    editable={Boolean(wallet) && !busy}
                    inputMode="decimal"
                    onChangeText={editAmount}
                    placeholder="0.0"
                    placeholderTextColor={platinum.colors.faintText}
                    style={styles.amountInput}
                    value={amount}
                  />
                  <Text style={styles.asset}>USDC</Text>
                </View>
                <Text style={styles.balanceText}>
                  Balance: {wallet ? `${formatUnits(wallet.usdc, 6)} USDC · ${trimEther(wallet.eth)} ETH` : '...'}
                  {wallet && wallet.weth > 0n ? ` · ${trimEther(wallet.weth)} WETH` : ''}
                </Text>
                {amountCheck.kind === 'invalid' ? (
                  <Text accessibilityRole="alert" style={styles.fieldError}>
                    {amountCheck.message}
                  </Text>
                ) : null}
              </View>

              {amountCheck.kind === 'valid' && wallet ? (
                <View style={styles.details}>
                  <DetailRow label="Paired with" value={`${trimEther(amountCheck.weth)} WETH`} />
                  {amountCheck.wrapWei > 0n ? (
                    <DetailRow label="Wraps" value={`${trimEther(amountCheck.wrapWei)} ETH into WETH`} />
                  ) : null}
                  <DetailRow
                    label="Position value"
                    value={formatUsd(valueUsdCents({ usdc: amountCheck.usdc, weth: amountCheck.weth }, wallet.price))}
                  />
                  <DetailRow label="Price" value={formatPrice(wallet.price)} />
                  <DetailRow label="Trading fee to you" value={AQUA_FEE_LABEL} />
                  <DetailRow label="Pool" value="1inch SwapVM · x·y=k USDC/WETH" last />
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ busy, disabled: !canReviewOpen }}
                disabled={!canReviewOpen}
                onPress={() => void prepare('open')}
                style={({ pressed }) => [styles.primaryButton, !canReviewOpen && styles.disabled, pressed && styles.pressed]}
              >
                <Text style={styles.primaryButtonText}>{busy && wallet ? 'Preparing...' : 'Review position'}</Text>
              </Pressable>
            </>
          )}

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
              setStep('overview');
            }}
            style={styles.backButton}
          >
            <Text style={styles.back}>Back</Text>
          </Pressable>

          <View style={styles.heading}>
            <Text style={styles.eyebrow}>{prepared.kind === 'open' ? 'CHECK BEFORE ADDING' : 'CHECK BEFORE CLOSING'}</Text>
            <Text style={styles.title}>Does this look right?</Text>
            <Text style={styles.body}>
              {prepared.kind === 'open'
                ? 'Your tokens stay in your wallet. Aqua only lets traders swap against the amounts below.'
                : 'Traders can no longer use your tokens, and Aqua loses its permission to move them.'}
            </Text>
          </View>

          <EarnReview
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
            Your passkey confirms only this transaction. The review expires after one minute.
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
            Follow the passkey prompt. Keep Sodera open while your transaction is confirmed.
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
              {completed.kind === 'open' ? 'Position open' : 'Position closed'}
            </Text>
            <Text style={styles.centeredBody}>{completed.summary}</Text>
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

          <Pressable accessibilityRole="button" onPress={finish} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Done</Text>
          </Pressable>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function PositionCard({
  position,
  price,
  busy,
  onRefresh,
  onClose,
}: {
  position: AquaPositionState;
  price: EthUsdPrice | null;
  busy: boolean;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const earned = earnedVsHoldingUsdCents(position, price);
  const opened = { usdc: BigInt(position.record.usdcAmount), weth: BigInt(position.record.wethAmount) };
  return (
    <>
      <View style={styles.card}>
        <View style={styles.positionHeading}>
          <Text style={styles.label}>YOUR POSITION</Text>
          <Text style={styles.protocol}>1inch Aqua</Text>
        </View>
        <Text style={styles.positionValue}>{formatUsd(valueUsdCents(position, price))}</Text>
        <Text style={styles.positionAmounts}>{formatPositionAmounts(position)}</Text>
        <Text style={[styles.earned, earned !== null && earned < 0 && styles.cautionValue]}>
          {earned === null ? 'Earnings need an ETH price' : `${formatSignedUsd(earned)} earned vs holding`}
        </Text>
      </View>

      <View style={styles.details}>
        <DetailRow label="Opened with" value={formatPositionAmounts(opened)} />
        <DetailRow label="Opened" value={new Date(position.record.openedAt).toLocaleString()} />
        <DetailRow label="Trading fee to you" value={AQUA_FEE_LABEL} />
        <DetailRow label="Where your tokens are" value="In your wallet" />
        <DetailRow label="Pool" value="1inch SwapVM · x·y=k USDC/WETH" last />
      </View>

      <View style={styles.transactionActions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onRefresh}
          style={({ pressed }) => [styles.secondaryButton, busy && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryButtonText}>Refresh</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onClose}
          style={({ pressed }) => [styles.secondaryButton, busy && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryButtonText}>{busy ? 'Preparing...' : 'Close position'}</Text>
        </Pressable>
      </View>
    </>
  );
}

function EarnReview({
  prepared,
  showTechnicalDetails,
  onToggleTechnicalDetails,
}: {
  prepared: Prepared;
  showTechnicalDetails: boolean;
  onToggleTechnicalDetails: () => void;
}) {
  const { calls, review } = prepared;
  const headline =
    prepared.kind === 'open'
      ? formatPositionAmounts({ usdc: prepared.usdc, weth: prepared.weth })
      : formatPositionAmounts(prepared.position);
  const callLabels =
    prepared.kind === 'open'
      ? [...(prepared.wrapWei > 0n ? ['Wrap ETH into WETH'] : []), 'Let Aqua use USDC', 'Let Aqua use WETH', 'Ship the Aqua strategy']
      : ['Dock the Aqua strategy', 'Remove the USDC permission', 'Remove the WETH permission', ...(prepared.unwrapWei > 0n ? ['Unwrap WETH into ETH'] : [])];

  return (
    <View style={styles.reviewSection}>
      <View style={styles.amountSummary}>
        <Text style={styles.label}>{prepared.kind === 'open' ? 'YOU ADD' : 'YOU CLOSE'}</Text>
        <Text selectable style={styles.reviewAmount}>
          {headline}
        </Text>
        <Text style={styles.reviewValue}>
          {formatUsd(
            valueUsdCents(prepared.kind === 'open' ? { usdc: prepared.usdc, weth: prepared.weth } : prepared.position, prepared.price),
          )}
        </Text>
      </View>

      <View style={styles.reviewDetails}>
        {prepared.kind === 'open' ? (
          <>
            {prepared.wrapWei > 0n ? (
              <FriendlyReviewRow label="Wrap" value={`${trimEther(prepared.wrapWei)} ETH becomes WETH`} />
            ) : null}
            <FriendlyReviewRow label="Price" value={formatPrice(prepared.price)} />
            <FriendlyReviewRow label="Trading fee to you" value={AQUA_FEE_LABEL} />
            <FriendlyReviewRow
              label="Permission"
              value="Aqua may move your USDC and WETH only when a trade fills, and only within this position. Closing removes the permission."
            />
          </>
        ) : (
          <>
            <FriendlyReviewRow label="Earned vs holding" value={formatEarned(prepared.position, prepared.price)} />
            {prepared.unwrapWei > 0n ? (
              <FriendlyReviewRow label="Unwrap" value={`${trimEther(prepared.unwrapWei)} WETH becomes ETH`} />
            ) : null}
          </>
        )}
        <FriendlyReviewRow label="Pool" value="1inch SwapVM · x·y=k USDC/WETH" />
        <FriendlyReviewRow label="From" value={`Your wallet (${shortenAddress(review.account)})`} />
        <FriendlyReviewRow label="Network" value="Ethereum Sepolia" />
        <FriendlyReviewRow
          label="Network fee"
          value={review.sponsored ? 'Sponsored' : `${formatEther(BigInt(review.maximumNetworkFeeWei))} ETH maximum`}
          last={!review.deploymentRequired}
        />
        {review.deploymentRequired ? (
          <FriendlyReviewRow label="Wallet setup" value="Included with this transaction" last />
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showTechnicalDetails }}
        onPress={onToggleTechnicalDetails}
        style={({ pressed }) => [styles.technicalToggle, pressed && styles.pressed]}
      >
        <Text style={styles.technicalToggleText}>{showTechnicalDetails ? 'Hide details' : 'More details'}</Text>
      </Pressable>

      {showTechnicalDetails ? (
        <View style={styles.technicalDetails}>
          <ReviewRow
            label="Strategy hash"
            value={prepared.kind === 'open' ? prepared.record.strategyHash : prepared.position.record.strategyHash}
          />
          <ReviewRow label="SwapVM router" value={SEPOLIA_AQUA_SWAP_VM_ROUTER_ADDRESS} />
          {calls.map((call, index) => (
            <ReviewRow
              key={`${call.to}-${index}`}
              label={`Call ${index + 1}: ${callLabels[index]}`}
              value={`to ${call.to}\nvalue ${call.value} wei\ndata ${call.data}`}
            />
          ))}
          <ReviewRow label="From account" value={review.account} />
          <ReviewRow label="Network" value={`${review.chain} (${review.chainId})`} />
          <ReviewRow label="Deploy account" value={review.deploymentRequired ? 'Yes' : 'No'} />
          <ReviewRow label="EntryPoint" value={review.entryPoint} />
          <ReviewRow label="Nonce" value={review.userOperation.nonce ?? 'Unavailable'} />
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

/**
 * The USDC side comes from the input; the WETH side is sized at the Chainlink price, using the
 * wallet's WETH first and wrapping ETH for the rest. Gas is sponsored, so all ETH is usable.
 */
function checkAmount(wallet: EarnWallet | null, amount: string): AmountCheck {
  if (!wallet || !amount.trim()) return { kind: 'empty' };
  if (!wallet.price) return { kind: 'invalid', message: 'The ETH price is unavailable, so the pool cannot be priced. Try again shortly.' };
  try {
    const usdc = parseSwapAmount({ direction: 'usdc-to-eth', amount, balance: wallet.usdc });
    const weth = wethForUsdc(usdc, wallet.price);
    if (weth <= 0n) return { kind: 'invalid', message: 'Amount is too small to pair with WETH' };
    const wrapWei = availableAfterCommitment(weth, wallet.weth);
    if (wrapWei > wallet.eth) {
      return {
        kind: 'invalid',
        message: `This needs ${trimEther(weth)} WETH, but you have ${trimEther(wallet.eth + wallet.weth)} ETH and WETH together.`,
      };
    }
    return { kind: 'valid', usdc, weth, wrapWei };
  } catch (error) {
    return { kind: 'invalid', message: describeError(error) };
  }
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

type RowProps = { label: string; value: string; last?: boolean };

function DetailRow({ label, value, last = false }: RowProps) {
  return (
    <View style={[styles.detailRow, !last && styles.detailDivider]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text selectable style={styles.detailValue}>
        {value}
      </Text>
    </View>
  );
}

function FriendlyReviewRow({ label, value, last = false }: RowProps) {
  return (
    <View style={[styles.friendlyReviewRow, !last && styles.detailDivider]}>
      <Text style={styles.friendlyReviewLabel}>{label}</Text>
      <Text selectable style={styles.friendlyReviewValue}>
        {value}
      </Text>
    </View>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text selectable style={styles.reviewValueSmall}>
        {value}
      </Text>
    </View>
  );
}

function formatUsd(cents: number | null) {
  if (cents === null) return '$0.00';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSignedUsd(cents: number) {
  return `${cents < 0 ? '−' : '+'}${formatUsd(Math.abs(cents))}`;
}

function formatEarned(position: AquaPositionState, price: EthUsdPrice | null) {
  const earned = earnedVsHoldingUsdCents(position, price);
  return earned === null ? 'Needs an ETH price' : formatSignedUsd(earned);
}

function formatPrice(price: EthUsdPrice | null) {
  if (!price) return 'Unavailable';
  const usd = Number(formatUnits(price.answer, price.decimals));
  return `${usd.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC per WETH · Chainlink`;
}

function shortenHash(hash: Hash) {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

/** Balances and the position over the Sepolia RPC; the ETH price through MultiBaas, as on home. */
async function readEarnWallet(account: Address, record: AquaPositionRecord | null): Promise<EarnWallet> {
  const client = sepoliaClient();
  const reader = rpcReadClient();
  const [eth, usdc, weth, price, position] = await Promise.all([
    client.getBalance({ address: account }),
    client.readContract({ address: SEPOLIA_USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
    readWethBalance(reader, account),
    readEthUsdPrice(createDefaultBalanceClient()),
    record ? readAquaPosition(reader, record) : null,
  ]);
  return { eth, usdc, weth, price, position: position?.status === 'active' ? position : null };
}

const EARN_ERROR_MESSAGES: { pattern: RegExp; message: string }[] = [
  {
    pattern: /sponsor|paymaster|gas policy|\bAA3\d\b/i,
    message:
      'Gas sponsorship is unavailable for this transaction right now, possibly because the daily limit is used up. Nothing changed.',
  },
  {
    pattern: /transfer amount exceeds balance|insufficient (funds|balance)/i,
    message: 'Your balance changed and no longer covers this. Nothing changed.',
  },
  {
    pattern: /StrategiesMustBeImmutable/i,
    message: 'This position already exists. Refresh and try again.',
  },
];

function describeEarnError(error: unknown) {
  const details: string[] = [];
  for (let current = error; current instanceof Error; current = current.cause) {
    const { details: detail, data } = current as { details?: unknown; data?: unknown };
    details.push(current.message, String(detail ?? ''), String(data ?? ''));
  }
  const text = details.join(' ');
  return EARN_ERROR_MESSAGES.find(({ pattern }) => pattern.test(text))?.message ?? describeError(error);
}

function describeError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Earn failed';
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
  balanceText: { ...typography.label, color: colors.secondaryText, fontVariant: ['tabular-nums'] },
  fieldError: { ...typography.bodySmall, color: colors.warning },
  positionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  protocol: { ...typography.labelSmall, color: colors.emerald },
  positionValue: { ...typography.display, color: colors.platinum, fontVariant: ['tabular-nums'] },
  positionAmounts: { ...typography.label, color: colors.secondaryText, fontVariant: ['tabular-nums'] },
  earned: { ...typography.label, color: colors.emerald, fontVariant: ['tabular-nums'] },
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
  reviewAmount: { ...typography.heading, color: colors.platinum, fontVariant: ['tabular-nums'], textAlign: 'center' },
  reviewValue: { ...typography.label, color: colors.emerald, fontVariant: ['tabular-nums'] },
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
  reviewValueSmall: { ...typography.labelSmall, color: colors.platinum },
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
