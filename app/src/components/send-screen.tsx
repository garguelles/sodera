import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatEther, formatUnits, isAddressEqual, type Address, type Hash } from 'viem';

import {
  createAgentClient,
  readAgentConfigFromEnv,
  type PayQuote,
  type PayQuoteRequest,
} from '@/agent/agent-client';
import { AssetLogo } from '@/components/asset-logo';
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
import { shortenAddress } from '@/wallet/sepolia';
import { pendingSends, type PendingSend } from '@/wallet/pending-sends';
import { buildPayWithCalls } from '@/wallet/pay-with-swap';
import { simulatePayWith as simulatePayWithOnSepolia } from '@/wallet/pay-with-simulation';
import { assertPreparedCallsMatch } from '@/wallet/prepared-calls';
import {
  parseSendAmount,
  parseSendTransfer,
  readSendBalances,
  resolveSepoliaRecipient,
  type SendAsset,
} from '@/wallet/send-transfer';

const defaultCeremonyClient = createPasskeyCeremonyClient(passkeyNativeAdapter, {
  isForeground: waitForAppForeground,
});

const agentConfig = readAgentConfigFromEnv();
/** Pay with needs the backend's quote proxy; without it Send only offers same-asset transfers. */
const defaultQuotePay = agentConfig ? createAgentClient({ config: agentConfig }).payQuote : null;

/** Classic quotes do not expire on their own, so the review does. */
export const PAY_WITH_REVIEW_TTL_MS = 30_000;
const PAY_WITH_EXPIRED_MESSAGE = 'The quote expired. Get a new quote to continue.';
const CAUTION_PRICE_IMPACT_PERCENT = 2;
const BLOCKING_PRICE_IMPACT_PERCENT = 10;

type PayWithReview = { request: PayQuoteRequest; quote: PayQuote; spent: bigint; preparedAt: number };

type SendScreenProps = {
  ceremonyClient?: PasskeyCeremonyClient;
  storage?: WalletIdentityStorage;
  createExecutionClient?: typeof createKernelPasskeyExecutionClient;
  readBalances?: (account: Address) => Promise<{ ETH: bigint; USDC: bigint }>;
  resolveRecipient?: typeof resolveSepoliaRecipient;
  recordSend?: (send: PendingSend) => Promise<void>;
  quotePay?: ((request: PayQuoteRequest) => Promise<PayQuote>) | null;
  simulatePayWith?: typeof simulatePayWithOnSepolia;
  now?: () => number;
  onOpenHistory?: () => void;
  onDone?: () => void;
};

type LoadedWallet = PersistedWalletIdentity & { balances: { ETH: bigint; USDC: bigint } };
type SendStep = 'recipient' | 'asset' | 'amount' | 'review' | 'authorizing' | 'submitted';

export function SendScreen({
  ceremonyClient = defaultCeremonyClient,
  storage = walletIdentityNativeStorage,
  createExecutionClient = createKernelPasskeyExecutionClient,
  readBalances = readSendBalances,
  resolveRecipient = resolveSepoliaRecipient,
  recordSend = pendingSends.update,
  quotePay = defaultQuotePay,
  simulatePayWith = simulatePayWithOnSepolia,
  now = Date.now,
  onOpenHistory = () => router.replace('/transactions'),
  onDone = () => router.back(),
}: SendScreenProps = {}) {
  const [wallet, setWallet] = useState<LoadedWallet | null>(null);
  const [recipient, setRecipient] = useState('');
  const [resolvedRecipient, setResolvedRecipient] = useState<{ address: Address; name: string | null } | null>(null);
  const [asset, setAsset] = useState<SendAsset | null>(null);
  const [amount, setAmount] = useState('');
  /** The asset the wallet spends; null or the send asset means a plain transfer. */
  const [payWith, setPayWith] = useState<SendAsset | null>(null);
  const [payWithReview, setPayWithReview] = useState<PayWithReview | null>(null);
  const [payWithFailed, setPayWithFailed] = useState(false);
  const [review, setReview] = useState<KernelOperationReview | null>(null);
  const [executionClient, setExecutionClient] = useState<KernelPasskeyExecutionClient | null>(null);
  const [submittedHash, setSubmittedHash] = useState<Hash | null>(null);
  const [status, setStatus] = useState('Loading wallet...');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<SendStep>('recipient');
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const invocation = useRef(0);
  const executionInFlight = useRef(false);

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
        setReview(null);
        setExecutionClient(null);
        setStep((current) => (current === 'review' ? 'amount' : current));
      }
    });
    return () => {
      invocation.current += 1;
      ceremonyClient.cancelPending();
      subscription.remove();
    };
  }, [ceremonyClient, readBalances, storage]);

  const invalidateReview = () => {
    invocation.current += 1;
    setReview(null);
    setExecutionClient(null);
    setPayWithReview(null);
    setShowTechnicalDetails(false);
  };

  const payAsset = payWith && payWith !== asset ? payWith : null;

  const expirePayWithReview = () => {
    invalidateReview();
    setStep((current) => (current === 'review' ? 'amount' : current));
    setStatus(PAY_WITH_EXPIRED_MESSAGE);
  };

  useEffect(() => {
    if (step !== 'review' || !payWithReview) return;
    const timer = setTimeout(() => {
      invocation.current += 1;
      setReview(null);
      setExecutionClient(null);
      setPayWithReview(null);
      setShowTechnicalDetails(false);
      setStep('amount');
      setStatus(PAY_WITH_EXPIRED_MESSAGE);
    }, Math.max(0, payWithReview.preparedAt + PAY_WITH_REVIEW_TTL_MS - now()));
    return () => clearTimeout(timer);
  }, [now, payWithReview, step]);

  const continueRecipient = async () => {
    const currentInvocation = ++invocation.current;
    setBusy(true);
    setStatus('');
    try {
      const result = await resolveRecipient(recipient);
      if (currentInvocation !== invocation.current) return;
      setResolvedRecipient(result);
      setStep('asset');
    } catch (error) {
      if (currentInvocation === invocation.current) setStatus(describeError(error));
    } finally {
      if (currentInvocation === invocation.current) setBusy(false);
    }
  };

  const prepare = async () => {
    if (!wallet || !resolvedRecipient || !asset) return;
    if (payAsset) {
      await preparePayWith(payAsset);
      return;
    }
    let transfer: ReturnType<typeof parseSendTransfer>;
    try {
      transfer = parseSendTransfer({ recipient: resolvedRecipient.address, amount, asset, balance: wallet.balances[asset] });
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
      const nextReview = await client.prepare([transfer.call]);
      assertPreparedCallsMatch(
        nextReview,
        [transfer.call],
        'The prepared transfer does not match the requested recipient and amount',
      );
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

  // Swaps the pay asset into the account through the Trading API route, then sends the exact amount.
  const preparePayWith = async (spend: SendAsset) => {
    if (!wallet || !resolvedRecipient || !asset || !quotePay) return;
    let amountOut: bigint;
    try {
      amountOut = parseSendAmount({ amount, asset });
      if (isAddressEqual(resolvedRecipient.address, wallet.account)) {
        throw new Error(`Paying yourself with ${spend} is a swap. Use Swap instead`);
      }
    } catch (error) {
      setStatus(describeError(error));
      return;
    }

    const currentInvocation = ++invocation.current;
    setBusy(true);
    setPayWithFailed(false);
    setStatus(`Finding a Uniswap route and simulating the payment with ${spend}...`);
    try {
      const request: PayQuoteRequest = {
        account: wallet.account,
        payAsset: spend,
        receiveAsset: asset,
        amountOut: amountOut.toString(),
      };
      const quote = await quotePay(request);
      const maxAmountIn = BigInt(quote.maxAmountIn);
      if ((quote.priceImpactPercent ?? 0) > BLOCKING_PRICE_IMPACT_PERCENT) {
        throw new Error(`Price impact is ${quote.priceImpactPercent}%, too high to pay with ${spend}`);
      }
      if (maxAmountIn > wallet.balances[spend]) {
        throw new Error(`This payment can cost up to ${formatAssetAmount(maxAmountIn, spend)} ${spend}, more than your balance`);
      }
      const calls = buildPayWithCalls({ request, quote, recipient: resolvedRecipient.address, nowMs: now() });
      const { spent } = await simulatePayWith({
        account: wallet.account,
        recipient: resolvedRecipient.address,
        request,
        maxAmountIn,
        calls,
      });
      const client = await createExecutionClient({ ceremonyClient, credential: wallet.credential });
      if (client.account.toLowerCase() !== wallet.account.toLowerCase()) {
        throw new Error('The signing account does not match the persisted wallet');
      }
      const nextReview = await client.prepare(calls);
      assertPreparedCallsMatch(nextReview, calls, 'The prepared payment does not match the verified calls');
      if (currentInvocation !== invocation.current) return;
      setExecutionClient(client);
      setReview(nextReview);
      setPayWithReview({ request, quote, spent, preparedAt: now() });
      setStatus('');
      setStep('review');
    } catch (error) {
      if (currentInvocation === invocation.current) {
        setStatus(describeError(error));
        setPayWithFailed(true);
      }
    } finally {
      if (currentInvocation === invocation.current) setBusy(false);
    }
  };

  const execute = async () => {
    if (!wallet || !review || !executionClient || !resolvedRecipient || !asset || executionInFlight.current) return;
    // Timers pause while the app sleeps, so recheck the quote's age at confirmation time.
    if (payWithReview && now() - payWithReview.preparedAt > PAY_WITH_REVIEW_TTL_MS) {
      expirePayWithReview();
      return;
    }
    executionInFlight.current = true;
    const currentInvocation = ++invocation.current;
    const approvedHash = review.userOperationHash;
    const value = parseSendAmount({ amount, asset });
    setBusy(true);
    setStatus('');
    setStep('authorizing');
    try {
      const userOperationHash = await executionClient.submit(approvedHash);
      const send: PendingSend = {
        account: wallet.account,
        userOperationHash,
        transactionHash: null,
        recipient: resolvedRecipient.address,
        asset,
        amount: formatAssetAmount(value, asset),
        timestamp: new Date().toISOString(),
        status: 'submitted',
        ...(payWithReview
          ? {
              payAsset: payWithReview.request.payAsset,
              maxPayAmount: formatAssetAmount(BigInt(payWithReview.quote.maxAmountIn), payWithReview.request.payAsset),
            }
          : {}),
      };
      try {
        await recordSend(send);
      } catch {
        if (currentInvocation === invocation.current) setStatus('Submitted, but this device could not save the send to history.');
      }
      if (currentInvocation === invocation.current) {
        setSubmittedHash(userOperationHash);
        setReview(null);
        setExecutionClient(null);
        setPayWithReview(null);
        setStep('submitted');
      }
      walletHomeLiveProvider.refresh();
      void executionClient.waitForConfirmation(userOperationHash).then(async (evidence) => {
        await recordSend({ ...send, status: 'confirmed', transactionHash: evidence.transactionHash });
        try {
          await markPersistedWalletIdentityDeployed(storage, evidence.account);
        } catch {
          // The confirmed chain result remains authoritative; reopening reconciles this marker.
        }
        walletHomeLiveProvider.refresh();
      }).catch(() => {
        // A transient receipt lookup is retried from history; only a definitive Bundler receipt marks failure.
      });
    } catch (error) {
      if (currentInvocation === invocation.current) {
        setReview(null);
        setExecutionClient(null);
        setPayWithReview(null);
        setStep('amount');
        setStatus(describeError(error));
      }
    } finally {
      executionInFlight.current = false;
      if (currentInvocation === invocation.current) setBusy(false);
    }
  };

  const back = () => {
    invalidateReview();
    setPayWithFailed(false);
    setStatus('');
    setStep(step === 'review' ? 'amount' : step === 'amount' ? 'asset' : 'recipient');
  };

  return (
    <SafeAreaView style={styles.screen}>
      {step === 'recipient' || step === 'asset' || step === 'amount' ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable accessibilityRole="button" onPress={step === 'recipient' ? onDone : back} style={styles.backButton}>
            <Text style={styles.back}>Back</Text>
          </Pressable>

          <View style={styles.heading}>
            <Text style={styles.eyebrow}>ETHEREUM SEPOLIA · STEP {step === 'recipient' ? '1' : step === 'asset' ? '2' : '3'} OF 4</Text>
            <Text style={styles.title}>{step === 'recipient' ? 'Who are you sending to?' : step === 'asset' ? 'Choose an asset' : 'How much?'}</Text>
            <Text style={styles.body}>{step === 'recipient' ? 'Enter a Sepolia ENS name or wallet address.' : step === 'asset' ? 'Select the asset you want to send.' : payAsset ? `Enter the exact amount of ${asset} the recipient gets. Uniswap swaps your ${payAsset} for it.` : `Enter the amount of ${asset} to send.`}</Text>
          </View>

          {step === 'recipient' ? <View style={styles.form}>
            <Text style={styles.fieldLabel}>ENS NAME OR ADDRESS</Text>
            <TextInput
              accessibilityLabel="Recipient ENS name or address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onChangeText={(value) => {
                setRecipient(value);
                setResolvedRecipient(null);
                invalidateReview();
              }}
              placeholder="gargs.eth, gargs.sodera.eth or 0x..."
              placeholderTextColor={platinum.colors.faintText}
              style={styles.input}
              value={recipient}
            />
            <PrimaryButton disabled={busy || !wallet} label={busy ? 'Resolving on Sepolia...' : 'Continue'} onPress={() => void continueRecipient()} />
          </View> : null}

          {step === 'asset' ? <View style={styles.form}>
            <Text style={styles.label}>TO {resolvedRecipient?.name ?? shortenAddress(resolvedRecipient?.address ?? '')}</Text>
            {(['ETH', 'USDC'] as const).map((choice) => (
              <Pressable accessibilityLabel={`Select ${choice}`} accessibilityRole="button" accessibilityState={{ selected: asset === choice }} key={choice} onPress={() => { setAsset(choice); setAmount(''); setPayWith(null); setPayWithFailed(false); invalidateReview(); setStep('amount'); }} style={styles.assetChoice}>
                <AssetLogo asset={choice} />
                <View style={styles.assetChoiceCopy}>
                  <Text style={styles.assetChoiceName}>{choice === 'ETH' ? 'Ethereum' : 'USD Coin'}</Text>
                  <Text style={styles.body}>{choice}</Text>
                </View>
                <Text style={styles.assetBalance}>{wallet ? `${choice === 'ETH' ? formatEther(wallet.balances.ETH) : formatUnits(wallet.balances.USDC, 6)} ${choice}` : '...'}</Text>
              </Pressable>
            ))}
          </View> : null}

          {step === 'amount' && asset ? <View style={styles.form}>
            {quotePay ? (
              <View style={styles.payWithRow}>
                <Text style={styles.label}>PAY WITH</Text>
                <View style={styles.payWithChoices}>
                  {(['ETH', 'USDC'] as const).map((choice) => {
                    const selected = (payAsset ?? asset) === choice;
                    return (
                      <Pressable
                        accessibilityLabel={`Pay with ${choice}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected, disabled: busy }}
                        disabled={busy}
                        key={choice}
                        onPress={() => {
                          setPayWith(choice === asset ? null : choice);
                          setPayWithFailed(false);
                          setStatus('');
                          invalidateReview();
                        }}
                        style={[styles.payWithChoice, selected && styles.payWithChoiceSelected]}
                      >
                        <AssetLogo asset={choice} size={20} />
                        <Text style={[styles.payWithChoiceText, selected && styles.payWithChoiceTextSelected]}>{choice}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
            <View style={styles.balanceCard}>
              <Text style={styles.label}>{payAsset ? 'AVAILABLE TO PAY WITH' : 'AVAILABLE TO SEND'}</Text>
              <Text style={styles.balance}>{wallet ? `${formatAssetAmount(wallet.balances[payAsset ?? asset], payAsset ?? asset)} ${payAsset ?? asset}` : '...'}</Text>
            </View>
            <View style={styles.amountRow}>
              <TextInput
                accessibilityLabel={`${asset} amount`}
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
              <AssetLogo asset={asset} size={32} />
              <Text style={styles.asset}>{asset}</Text>
            </View>
            <PrimaryButton
              disabled={busy || !wallet}
              label={busy ? (payAsset ? 'Getting a quote...' : 'Preparing your transfer...') : payAsset ? 'Get quote' : 'Review transfer'}
              onPress={() => void prepare()}
            />
          </View> : null}

          {status ? (
            <View accessibilityRole="alert" style={styles.statusCard}>
              <Text style={styles.statusText}>{status}</Text>
            </View>
          ) : null}
          {step === 'amount' && asset && payAsset && payWithFailed && !busy ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setPayWith(null);
                setPayWithFailed(false);
                setStatus('');
              }}
              style={styles.backButton}
            >
              <Text style={styles.back}>{`Pay with ${asset} instead`}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : null}

      {step === 'review' && review ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable
            accessibilityRole="button"
            onPress={back}
            style={styles.backButton}
          >
            <Text style={styles.back}>Back</Text>
          </Pressable>

          <View style={styles.heading}>
            <Text style={styles.eyebrow}>ETHEREUM SEPOLIA · STEP 4 OF 4</Text>
            <Text style={styles.title}>Does this look right?</Text>
            <Text style={styles.body}>{payWithReview ? 'The swap and the transfer run together. Once sent, the payment cannot be reversed.' : 'Once sent, this transfer cannot be reversed.'}</Text>
          </View>

          <SendReview
            review={review}
            asset={asset!}
            recipient={resolvedRecipient!}
            amount={amount}
            payWith={payWithReview}
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
            {payWithReview
              ? 'Your passkey confirms only this payment. The quote expires after 30 seconds.'
              : 'Your passkey confirms only this transfer.'}
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
            Follow the passkey prompt. Keep Sodera open until the transfer is submitted.
          </Text>
        </View>
      ) : null}

      {step === 'submitted' && submittedHash ? (
        <ScrollView contentContainerStyle={styles.successContent}>
          <View style={styles.successIcon}>
            <Text importantForAccessibility="no" style={styles.successIconText}>↗</Text>
          </View>
          <View style={styles.successHeading}>
            <Text accessibilityRole="header" style={styles.successTitle}>Transaction submitted</Text>
            <Text style={styles.centeredBody}>Your {asset} {payWith && payWith !== asset ? 'payment' : 'transfer'} is awaiting confirmation on Ethereum Sepolia. Check its status in transaction history.</Text>
          </View>

          <View style={styles.transactionCard}>
            <Text style={styles.label}>USER OPERATION</Text>
            <Text selectable style={styles.shortHash}>{shortenHash(submittedHash)}</Text>
          </View>

          {status ? <Text accessibilityRole="alert" style={styles.errorText}>{status}</Text> : null}

          <PrimaryButton label="View transaction history" onPress={onOpenHistory} />
          <Pressable accessibilityRole="button" onPress={onDone} style={styles.backButton}><Text style={styles.back}>Done</Text></Pressable>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

export function shortenHash(hash: Hash) {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function SendReview({
  review,
  asset,
  recipient,
  amount,
  payWith,
  showTechnicalDetails,
  onToggleTechnicalDetails,
}: {
  review: KernelOperationReview;
  asset: SendAsset;
  recipient: { address: Address; name: string | null };
  amount: string;
  payWith: PayWithReview | null;
  showTechnicalDetails: boolean;
  onToggleTechnicalDetails: () => void;
}) {
  const displayAmount = `${amount.trim()} ${asset}`;
  const quote = payWith?.quote;
  const priceImpact = quote?.priceImpactPercent ?? null;
  const highImpact = priceImpact !== null && priceImpact > CAUTION_PRICE_IMPACT_PERCENT;
  return (
    <View style={styles.reviewSection}>
      <View style={styles.amountSummary}>
        <Text style={styles.label}>{payWith ? 'RECIPIENT GETS EXACTLY' : 'YOU ARE SENDING'}</Text>
        <Text selectable style={styles.reviewAmount}>{displayAmount}</Text>
      </View>

      <View style={styles.reviewDetails}>
        {recipient.name ? <FriendlyReviewRow label="ENS name" value={recipient.name} /> : null}
        <FriendlyReviewRow label="To" value={recipient.address} mono />
        {payWith && quote ? (
          <>
            <FriendlyReviewRow
              label="You pay"
              value={`${formatAssetAmount(payWith.spent, quote.payAsset)} ${quote.payAsset} (at most ${formatAssetAmount(BigInt(quote.maxAmountIn), quote.payAsset)})`}
            />
            <FriendlyReviewRow label="Route" value={describeRoute(quote.route)} />
            <FriendlyReviewRow
              label="Price impact"
              value={priceImpact === null ? 'Unavailable' : `${priceImpact.toFixed(2)}%${highImpact ? ' · high' : ''}`}
              caution={highImpact}
            />
            {quote.payAsset === 'USDC' ? (
              <FriendlyReviewRow
                label="Approval"
                value={`Up to ${formatAssetAmount(BigInt(quote.maxAmountIn), 'USDC')} USDC for Uniswap, until ${new Date(quote.deadline * 1000).toLocaleTimeString()}`}
              />
            ) : null}
            <FriendlyReviewRow label="Prices" value="Sepolia testnet pools, not market prices" />
          </>
        ) : (
          <FriendlyReviewRow label="Asset" value={asset} />
        )}
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
          <ReviewRow label="Asset" value={asset} />
          <ReviewRow label="Amount" value={displayAmount} />
          <ReviewRow label="Recipient" value={recipient.address} />
          {quote ? (
            <>
              <ReviewRow label="Uniswap route" value={quote.route ?? 'Unavailable'} />
              <ReviewRow label="Quoted input" value={`${formatAssetAmount(BigInt(quote.amountIn), quote.payAsset)} ${quote.payAsset}`} />
              <ReviewRow label="Uniswap request" value={quote.requestId ?? 'Unavailable'} />
            </>
          ) : null}
          {review.calls.map((call, index) => (
            <ReviewRow
              key={`${call.to}-${index}`}
              label={review.calls.length === 1 ? 'Call target' : `Call ${index + 1} target`}
              value={call.valueWei === '0' ? call.to : `${call.to} · ${formatEther(BigInt(call.valueWei))} ETH`}
            />
          ))}
          <ReviewRow label="From account" value={review.account} />
          <ReviewRow label="Network" value={`${review.chain} (${review.chainId})`} />
          <ReviewRow label="Deploy account" value={review.deploymentRequired ? 'Yes' : 'No'} />
          <ReviewRow label="EntryPoint" value={review.entryPoint} />
          <ReviewRow label="Nonce" value={review.userOperation.nonce ?? 'Unavailable'} />
          {review.calls.map((call, index) => (
            <ReviewRow
              key={`${call.to}-data-${index}`}
              label={review.calls.length === 1 ? 'Call data' : `Call ${index + 1} data`}
              value={call.data}
            />
          ))}
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
  caution = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  last?: boolean;
  caution?: boolean;
}) {
  return (
    <View style={[styles.friendlyReviewRow, !last && styles.friendlyReviewDivider]}>
      <Text style={styles.friendlyReviewLabel}>{label}</Text>
      <Text selectable style={[styles.friendlyReviewValue, mono && styles.monoValue, caution && styles.cautionValue]}>{value}</Text>
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

function PrimaryButton({ label, disabled = false, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryButton, disabled && styles.disabled, pressed && styles.pressed]}>
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function formatAssetAmount(value: bigint, asset: SendAsset) {
  return asset === 'ETH' ? formatEther(value) : formatUnits(value, 6);
}

/** "[v4] 100.00% = [0.01%] ... -> ..." becomes "Uniswap v4 · 2 hops". */
function describeRoute(route: string | null) {
  if (!route) return 'Uniswap';
  const protocols = [...new Set(Array.from(route.matchAll(/\[(v\d)\]/g), (match) => match[1]))];
  const splits = route.split(/\[v\d\]/).slice(1);
  const hops = splits.length === 1 ? splits[0].split('->').length : null;
  return `Uniswap ${protocols.join(' + ') || ''}${hops ? ` · ${hops} ${hops === 1 ? 'hop' : 'hops'}` : ` · ${splits.length} splits`}`.trim();
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
  assetChoice: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderColor: colors.borderLit, borderRadius: radius.lg, borderCurve: 'continuous', backgroundColor: colors.surface, padding: spacing.lg, minHeight: 80 },
  assetChoiceCopy: { flex: 1, gap: spacing.xs },
  assetChoiceName: { ...typography.subheading, color: colors.platinum },
  assetBalance: { ...typography.labelSmall, color: colors.secondaryText },
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
  cautionValue: { color: colors.warning },
  payWithRow: { gap: spacing.sm },
  payWithChoices: { flexDirection: 'row', gap: spacing.sm },
  payWithChoice: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceLow,
  },
  payWithChoiceSelected: { borderColor: colors.emerald, backgroundColor: colors.emeraldWash },
  payWithChoiceText: { ...typography.label, color: colors.secondaryText },
  payWithChoiceTextSelected: { color: colors.platinum },
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
  errorText: { ...typography.bodySmall, color: colors.negative, textAlign: 'center' },
});
