import { Host, TextInput } from '@expo/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Address } from 'viem';

import { platinum } from '@/constants/theme';
import { createEnsClaimClient } from '@/ens/claim-client';
import { createEnsIdentityReader, type EnsIdentityReader } from '@/ens/identity-client';
import { parseSoderaUsername } from '@/ens/username';
import {
  persistCompletedOnboarding,
  persistPendingEnsClaim,
  resolveOnboardingAccess,
  type OnboardingProfile,
  type OnboardingProfileStorage,
  type PendingEnsClaim,
  type UsernameClaimClient,
} from '@/onboarding/onboarding';
import { onboardingNativeStorage } from '@/onboarding/onboarding-native-storage';
import { defaultHomeClient, type DefaultHomeClient } from '@/launcher/default-home';
import { createKernelPasskeyExecutionClient, type KernelOperationReview, type KernelPasskeyExecutionClient } from '@/wallet/kernel-passkey-execution';
import { createPasskeyCeremonyClient } from '@/wallet/passkey-ceremony';
import { passkeyNativeAdapter } from '@/wallet/passkey-native-adapter';
import {
  createWalletIdentityClient,
  inspectPersistedWalletIdentity,
  readPersistedWalletIdentity,
  type WalletIdentityStorage,
} from '@/wallet/wallet-identity';
import { walletIdentityNativeStorage } from '@/wallet/wallet-identity-native-storage';
import { waitForAppForeground } from '@/wallet/wait-for-app-foreground';

const defaultCeremonyClient = createPasskeyCeremonyClient(passkeyNativeAdapter, {
  isForeground: waitForAppForeground,
});

type Stage = 'loading' | 'welcome' | 'wallet' | 'activation' | 'username' | 'claimPending' | 'home' | 'recovery' | 'blocked';

export function OnboardingScreen({
  client = defaultCeremonyClient,
  createExecutionClient = createKernelPasskeyExecutionClient,
  identityStorage = walletIdentityNativeStorage,
  profileStorage = onboardingNativeStorage,
  usernameClaimClient,
  identityReader,
  homeClient = defaultHomeClient,
  onComplete,
  onRetry,
  initialError,
}: {
  client?: ReturnType<typeof createPasskeyCeremonyClient>;
  createExecutionClient?: typeof createKernelPasskeyExecutionClient;
  identityStorage?: WalletIdentityStorage;
  profileStorage?: OnboardingProfileStorage;
  usernameClaimClient?: UsernameClaimClient;
  identityReader?: EnsIdentityReader;
  homeClient?: DefaultHomeClient;
  onComplete(profile: OnboardingProfile): void;
  onRetry?: () => void;
  initialError?: string;
}) {
  const [stage, setStage] = useState<Stage>(initialError ? 'blocked' : 'loading');
  const [account, setAccount] = useState<Address | null>(null);
  const [executionClient, setExecutionClient] = useState<KernelPasskeyExecutionClient | null>(null);
  const [activationReview, setActivationReview] = useState<KernelOperationReview | null>(null);
  const [label, setLabel] = useState('');
  const [available, setAvailable] = useState(false);
  const currentLabel = useRef('');
  const availableLabel = useRef<string | null>(null);
  const [pending, setPending] = useState<PendingEnsClaim | null>(null);
  const [profile, setProfile] = useState<OnboardingProfile | null>(null);
  const [resumeWallet, setResumeWallet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialError ?? '');
  const invocation = useRef(0);
  const operationInFlight = useRef(false);

  const walletIdentityClient = createWalletIdentityClient({
    storage: identityStorage,
    ceremonyClient: client,
    async deriveAccount(primaryCredential) {
      const executionClient = await createExecutionClient({
        ceremonyClient: client,
        credential: primaryCredential,
      });
      return {
        address: executionClient.account,
        deployed: executionClient.deployed,
        executionClient,
      };
    },
  });

  useEffect(() => {
    if (initialError) return;
    let active = true;
    const bootstrap = async () => {
      try {
        const access = await resolveOnboardingAccess({ identityStorage, profileStorage, homeClient });
        if (!active) return;
        if (access.status === 'blocked') {
          setMessage(access.message);
          setStage('blocked');
          return;
        }
        if (access.status === 'incomplete') {
          const resumable = access.wallet === 'resumable';
          setResumeWallet(resumable);
          if (access.pending) {
            setAccount(access.pending.account);
            setLabel(access.pending.username.replace(/\.sodera\.eth$/, ''));
            setPending(access.pending);
            setStage('claimPending');
            return;
          }
          setStage(resumable ? 'wallet' : 'welcome');
          return;
        }
        setProfile(access.profile);
        setAccount(access.profile.account);
        setStage('home');
      } catch (error) {
        if (!active) return;
        setMessage(getErrorMessage(error));
        setStage('blocked');
      }
    };
    void bootstrap();
    return () => {
      active = false;
      invocation.current += 1;
      client.cancelPending();
    };
  }, [client, homeClient, identityStorage, initialError, profileStorage]);

  useEffect(() => {
    if (stage !== 'home' || !profile) return;
    let active = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void homeClient.isDefaultHome().then((isHome) => {
        if (active && isHome) onComplete(profile);
      }).catch((error) => {
        if (active) setMessage(getErrorMessage(error));
      });
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [homeClient, onComplete, profile, stage]);

  const selectDefaultHome = async () => {
    if (!profile || operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      if (await homeClient.isDefaultHome()) {
        onComplete(profile);
        return;
      }
      await homeClient.requestDefaultHome();
      if (await homeClient.isDefaultHome()) onComplete(profile);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  };

  const confirmDefaultHome = async () => {
    if (!profile || operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      if (await homeClient.isDefaultHome()) {
        onComplete(profile);
      } else {
        setMessage('Select Sodera in the Android Home app prompt to finish setup.');
      }
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    if (stage !== 'recovery' && (stage !== 'wallet' || resumeWallet)) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setStage('welcome');
      return true;
    });
    return () => subscription.remove();
  }, [resumeWallet, stage]);

  const createOrResumeWallet = async () => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    const currentInvocation = ++invocation.current;
    setBusy(true);
    setMessage('');
    try {
      const result = resumeWallet
        ? await walletIdentityClient.reopen()
        : await walletIdentityClient.create();
      if (currentInvocation !== invocation.current) return;
      if (result.status === 'blocked') {
        setMessage(result.message);
        const identityState = await inspectPersistedWalletIdentity(identityStorage);
        if (currentInvocation === invocation.current) {
          setResumeWallet(identityState.status !== 'missing');
        }
        return;
      }
      setAccount(result.account);
      setExecutionClient(result.executionClient ?? null);
      setStage(result.deployed ? 'username' : 'activation');
    } catch (error) {
      if (currentInvocation === invocation.current) setMessage(getErrorMessage(error));
    } finally {
      operationInFlight.current = false;
      if (currentInvocation === invocation.current) setBusy(false);
    }
  };

  const activateWallet = async () => {
    if (!executionClient || operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      if (!activationReview) {
        setActivationReview(await executionClient.prepare());
      } else {
        const receipt = await executionClient.execute(activationReview.userOperationHash);
        await walletIdentityClient.markDeployed(receipt.account);
        setActivationReview(null);
        setStage('username');
      }
    } catch (error) {
      setActivationReview(null);
      setMessage(getErrorMessage(error));
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  };

  const checkUsername = async () => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    setAvailable(false);
    availableLabel.current = null;
    setMessage('');
    try {
      const username = parseSoderaUsername(label);
      if (!(await (identityReader ?? createEnsIdentityReader()).availability(username.label))) {
        throw new Error('This name is unavailable or the parent expires too soon');
      }
      if (currentLabel.current === label) {
        availableLabel.current = username.label;
        setAvailable(true);
      }
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  };

  const claimUsername = async () => {
    if (!account || !available || availableLabel.current !== label || operationInFlight.current) return;
    operationInFlight.current = true;
    const currentInvocation = ++invocation.current;
    setBusy(true);
    setMessage('');
    try {
      const identity = await readPersistedWalletIdentity(identityStorage);
      if (!identity.deployed || identity.account.toLowerCase() !== account.toLowerCase()) {
        throw new Error('Activate this wallet before claiming a name');
      }
      const username = parseSoderaUsername(label);
      const claim = await (usernameClaimClient ?? createEnsClaimClient({ ceremonyClient: client })).submit({
        account, credential: identity.credential, label: username.label,
      });
      if (currentInvocation !== invocation.current) return;
      const saved = await persistPendingEnsClaim(profileStorage, {
        account, username: claim.name, claimId: claim.id,
      });
      setPending(saved);
      setStage('claimPending');
      if (claim.status === 'confirmed') void refreshClaim(saved);
    } catch (error) {
      if (currentInvocation === invocation.current) setMessage(getErrorMessage(error));
    } finally {
      operationInFlight.current = false;
      if (currentInvocation === invocation.current) setBusy(false);
    }
  };

  const refreshClaim = useCallback(async (claim: PendingEnsClaim) => {
    if (!claim || operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    try {
      const result = await (usernameClaimClient ?? createEnsClaimClient({ ceremonyClient: client })).status({
        id: claim.claimId, account: claim.account, label: claim.username.replace(/\.sodera\.eth$/, ''),
      });
      if (result.status === 'needs_attention' || result.status === 'detached') {
        setMessage('Issuance needs attention. Your wallet is safe; retry status later or contact Sodera support.');
      } else if (result.status === 'confirmed') {
        const verified = await (identityReader ?? createEnsIdentityReader()).verify(claim.username, claim.account);
        if (!verified) throw new Error('The name is not currently owned by and resolving to this wallet');
        const completed = await persistCompletedOnboarding({
          storage: profileStorage, account: claim.account, name: claim.username, claimId: claim.claimId,
        });
        setProfile(completed);
        setPending(null);
        setMessage('');
        setStage('home');
      } else {
        setMessage(`Registration is ${result.status.replace(/_/g, ' ')}. This can take a moment on Sepolia.`);
      }
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  }, [client, identityReader, profileStorage, usernameClaimClient]);

  useEffect(() => {
    if (stage !== 'claimPending' || !pending) return;
    void refreshClaim(pending);
    const interval = setInterval(() => void refreshClaim(pending), 5_000);
    return () => clearInterval(interval);
  }, [stage, pending, refreshClaim]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <View style={styles.header}>
          <View style={styles.mark}>
            <View style={styles.markCore} />
          </View>
          <Text style={styles.wordmark}>SODERA</Text>
          {stage !== 'loading' && stage !== 'blocked' && stage !== 'recovery' ? (
            <Text style={styles.progress}>{progressLabel(stage)}</Text>
          ) : null}
        </View>

        <View style={styles.body}>
          {stage === 'loading' ? (
            <View style={styles.centered}>
              <ActivityIndicator color={platinum.colors.emerald} />
              <Text style={styles.muted}>Checking this installation...</Text>
            </View>
          ) : null}

          {stage === 'welcome' ? (
            <>
              <View style={styles.hero}>
                <Text style={styles.eyebrow}>WALLET MEETS HOME</Text>
                <Text style={styles.title}>Your wallet, right at home.</Text>
                <Text style={styles.description}>
                  Create a passkey-controlled Sepolia wallet, then make it yours with a Sodera name.
                </Text>
              </View>
              <View style={styles.actions}>
                <ActionButton label="Create wallet" onPress={() => setStage('wallet')} />
                <ActionButton
                  label="Recover wallet"
                  onPress={() => setStage('recovery')}
                  secondary
                />
              </View>
            </>
          ) : null}

          {stage === 'wallet' ? (
            <>
              <View style={styles.hero}>
                <Text style={styles.eyebrow}>YOUR PRIMARY PASSKEY</Text>
                <Text style={styles.title}>{resumeWallet ? 'Finish your wallet.' : 'Create your wallet.'}</Text>
                <Text style={styles.description}>
                  Android will ask you to create a passkey. It directly controls your testnet smart account.
                </Text>
              </View>
              <View style={styles.detailCard}>
                <Text style={styles.detailTitle}>No password. No seed phrase.</Text>
                <Text style={styles.detailBody}>
                  This testnet wallet is tied to your passkey. Recovery is not available in this build.
                </Text>
              </View>
              <InlineError message={message} />
              <View style={styles.actions}>
                <ActionButton
                  busy={busy}
                  disabled={busy}
                  label={resumeWallet ? 'Continue wallet setup' : 'Create with passkey'}
                  onPress={createOrResumeWallet}
                />
                {!resumeWallet ? (
                  <ActionButton label="Back" onPress={() => setStage('welcome')} secondary />
                ) : null}
              </View>
            </>
          ) : null}

          {stage === 'activation' ? (
            <>
              <View style={styles.hero}>
                <Text style={styles.eyebrow}>ACTIVATE YOUR WALLET</Text>
                <Text style={styles.title}>Ready for your name.</Text>
                <Text style={styles.description}>Your new smart account must be deployed before it can prove passkey control to the ENS issuer. Review and authorize a zero-value Sepolia operation.</Text>
              </View>
              {activationReview ? (
                <View style={styles.detailCard}>
                  <Text style={styles.detailTitle}>Review activation</Text>
                  <Text selectable style={styles.detailBody}>Wallet: {activationReview.account}</Text>
                  <Text selectable style={styles.detailBody}>Call: {activationReview.calls[0]?.to} · {activationReview.calls[0]?.valueWei} wei</Text>
                  <Text selectable style={styles.detailBody}>UserOperation: {activationReview.userOperationHash}</Text>
                  <Text style={styles.detailBody}>Sponsored: {activationReview.sponsored ? 'Yes' : 'No'} · Maximum network fee: {activationReview.maximumNetworkFeeWei} wei</Text>
                </View>
              ) : null}
              <InlineError message={message} />
              <View style={styles.actions}>
                <ActionButton busy={busy} disabled={busy} label={activationReview ? 'Authorize wallet activation' : 'Prepare wallet activation'} onPress={activateWallet} />
              </View>
            </>
          ) : null}

          {stage === 'username' ? (
            <>
              <View style={styles.hero}>
                <Text style={styles.eyebrow}>YOUR SODERA NAME</Text>
                <Text style={styles.title}>Claim your place.</Text>
                <Text style={styles.description}>
                  Pick an available name owned by your passkey-controlled wallet. Registration lasts one year on Sepolia.
                </Text>
              </View>
              <View style={styles.nameCard}>
                <Host matchContents={{ vertical: true }} style={{ width: '100%' }}>
                  <TextInput autoCapitalize="none" autoCorrect={false} editable={!busy}
                    placeholder="yourname" testID="ens-username" onChangeText={(value) => { currentLabel.current = value; availableLabel.current = null; setLabel(value); setAvailable(false); setMessage(''); }}
                    style={styles.nameInput} />
                </Host>
                <Text style={styles.name}>.sodera.eth</Text>
                {available ? <View style={styles.availablePill}>
                  <View style={styles.availableDot} />
                  <Text style={styles.availableText}>Available now</Text>
                </View> : null}
              </View>
              <Text style={styles.disclaimer}>
                Free name registration; your passkey authorizes the request. Wait for on-chain confirmation before using this name.
              </Text>
              <InlineError message={message} />
              <View style={styles.actions}>
                <ActionButton
                  busy={busy}
                  disabled={busy || !label}
                  label="Check availability"
                  onPress={checkUsername}
                />
                <ActionButton busy={busy} disabled={busy || !available} label={`Claim ${label || 'your name'}.sodera.eth`} onPress={claimUsername} secondary />
              </View>
            </>
          ) : null}

          {stage === 'claimPending' && pending ? (
            <>
              <View style={styles.hero}>
                <Text style={styles.eyebrow}>REGISTRATION IN PROGRESS</Text>
                <Text style={styles.title}>Making it official.</Text>
                <Text selectable style={styles.description}>Your request for {pending.username} is saved on this device. We will continue checking after you reopen Sodera.</Text>
              </View>
              <View style={styles.detailCard}><Text style={styles.detailTitle}>Waiting for Sepolia</Text>
                <Text selectable style={styles.detailBody}>Claim ID: {pending.claimId}</Text></View>
              <InlineError message={message} />
              <View style={styles.actions}><ActionButton busy={busy} disabled={busy} label="Check registration status" onPress={() => void refreshClaim(pending)} /></View>
            </>
          ) : null}

          {stage === 'home' && account && profile ? (
            <>
              <View style={styles.hero}>
                <Text style={styles.eyebrow}>ONE LAST STEP</Text>
                <Text style={styles.title}>Make Sodera your Home.</Text>
                <Text style={styles.description}>
                  Choose Sodera as your default Home app in the Android prompt. Your Home button will then open Sodera.
                </Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>{profile.claimMode === 'ens' ? 'VERIFIED SODERA NAME' : 'LEGACY DEMO NAME (UNVERIFIED)'}</Text>
                <Text selectable style={styles.summaryValue}>
                  {profile.username}
                </Text>
                <View style={styles.divider} />
                <Text style={styles.summaryLabel}>WALLET ADDRESS</Text>
                <Text selectable style={styles.address}>
                  {account}
                </Text>
              </View>
              <InlineError message={message} />
              <View style={styles.actions}>
                <ActionButton label="Set Sodera as Home" busy={busy} disabled={busy} onPress={selectDefaultHome} />
                <ActionButton label="I've selected Sodera" disabled={busy} onPress={confirmDefaultHome} secondary />
              </View>
            </>
          ) : null}

          {stage === 'recovery' ? (
            <>
              <View style={styles.hero}>
                <Text style={styles.eyebrow}>RECOVER WALLET</Text>
                <Text style={styles.title}>Recovery is coming later.</Text>
                <Text style={styles.description}>
                  Recovery is not available in this testnet build. No existing wallet has been changed.
                </Text>
              </View>
              <View style={styles.actions}>
                <ActionButton label="Back to welcome" onPress={() => setStage('welcome')} />
              </View>
            </>
          ) : null}

          {stage === 'blocked' ? (
            <>
              <View style={styles.hero}>
                <Text style={styles.eyebrow}>SETUP NEEDS ATTENTION</Text>
                <Text style={styles.title}>{"We couldn't continue."}</Text>
                <Text selectable style={styles.description}>
                  {message}
                </Text>
              </View>
              {onRetry ? (
                <View style={styles.actions}>
                  <ActionButton label="Retry setup" onPress={onRetry} />
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionButton({
  label,
  onPress,
  secondary = false,
  disabled = false,
  busy = false,
}: {
  label: string;
  onPress(): void;
  secondary?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondaryButton,
        (pressed || disabled) && styles.buttonPressed,
      ]}
    >
      {busy ? <ActivityIndicator color={secondary ? platinum.colors.platinum : platinum.colors.onPlatinum} /> : <Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{label}</Text>}
    </Pressable>
  );
}

function InlineError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.errorCard}>
      <Text selectable style={styles.errorText}>
        {message}
      </Text>
    </View>
  );
}

function progressLabel(stage: Stage) {
  if (stage === 'welcome') return '1 / 4';
  if (stage === 'wallet') return '2 / 4';
  if (stage === 'activation' || stage === 'username' || stage === 'claimPending') return '3 / 4';
  return '4 / 4';
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Setup could not continue';
}

const { colors, spacing, radius, typography } = platinum;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingVertical: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  mark: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.borderLit,
    backgroundColor: colors.glassRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markCore: { width: 10, height: 10, borderRadius: radius.full, backgroundColor: colors.platinum },
  wordmark: { ...typography.label, color: colors.platinum, letterSpacing: 2, paddingLeft: spacing.md },
  progress: { ...typography.labelSmall, marginLeft: 'auto', color: colors.mutedText },
  body: { flex: 1, justifyContent: 'space-between', paddingTop: spacing.xxl, paddingBottom: spacing.lg, gap: spacing.xxl },
  centered: { flex: 1, minHeight: 400, alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  hero: { gap: spacing.md },
  eyebrow: { ...typography.labelSmall, color: colors.emerald },
  title: { ...typography.display, color: colors.platinum, maxWidth: 520 },
  description: { ...typography.body, color: colors.mutedText, maxWidth: 560 },
  muted: { ...typography.bodySmall, color: colors.mutedText },
  actions: { gap: spacing.md, paddingTop: spacing.xl },
  button: {
    minHeight: 56,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.platinum,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  secondaryButton: { backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.border },
  buttonPressed: { opacity: 0.65 },
  buttonText: { ...typography.body, fontFamily: typography.subheading.fontFamily, color: colors.onPlatinum },
  secondaryButtonText: { color: colors.platinum },
  detailCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    padding: spacing.xl,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  detailTitle: { ...typography.subheading, color: colors.platinum },
  detailBody: { ...typography.bodySmall, color: colors.mutedText },
  nameCard: {
    minHeight: 170,
    backgroundColor: colors.platinum,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    padding: spacing.xl,
    justifyContent: 'space-between',
  },
  name: { ...typography.title, color: colors.onPlatinum },
  nameInput: { backgroundColor: colors.platinum, color: colors.onPlatinum, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 50 },
  availablePill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.onPlatinum, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  availableDot: { width: 7, height: 7, borderRadius: radius.full, backgroundColor: colors.emerald },
  availableText: { ...typography.caption, color: colors.platinum },
  disclaimer: { ...typography.bodySmall, color: colors.mutedText },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    padding: spacing.xl,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryLabel: { ...typography.labelSmall, color: colors.mutedText },
  summaryValue: { ...typography.heading, color: colors.platinum },
  address: { ...typography.label, color: colors.secondaryText },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  errorCard: { backgroundColor: colors.negativeWash, borderRadius: radius.lg, borderCurve: 'continuous', padding: spacing.lg },
  errorText: { ...typography.bodySmall, color: colors.negative },
});
