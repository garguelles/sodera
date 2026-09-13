import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Address } from 'viem';

import { readPersistedWalletIdentity, type WalletIdentityStorage } from '@/wallet/wallet-identity';
import { walletIdentityNativeStorage } from '@/wallet/wallet-identity-native-storage';

type ReceiveState =
  | { status: 'loading' }
  | { status: 'ready'; address: Address }
  | { status: 'error'; message: string };

export function ReceiveScreen({
  storage = walletIdentityNativeStorage,
  copyAddress = async (address) => {
    await Clipboard.setStringAsync(address);
  },
  onBack = () => router.back(),
}: {
  storage?: WalletIdentityStorage;
  copyAddress?: (address: string) => Promise<void>;
  onBack?: () => void;
} = {}) {
  const { width } = useWindowDimensions();
  const [state, setState] = useState<ReceiveState>({ status: 'loading' });
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    void readPersistedWalletIdentity(storage)
      .then((identity) => {
        if (active) setState({ status: 'ready', address: identity.account });
      })
      .catch((error) => {
        if (active) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Could not load wallet address',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [retryCount, storage]);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const copy = async (address: Address) => {
    setCopyError('');
    try {
      await copyAddress(address);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      setCopied(false);
      setCopyError(error instanceof Error ? error.message : 'Could not copy wallet address');
    }
  };

  const qrSize = Math.min(264, width - 96);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            onPress={onBack}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <View style={styles.networkPill}>
            <View style={styles.networkDot} />
            <Text style={styles.networkText}>Sepolia</Text>
          </View>
        </View>

        <View style={styles.heading}>
          <Text style={styles.eyebrow}>RECEIVE ASSETS</Text>
          <Text style={styles.title}>Your wallet address.</Text>
          <Text style={styles.description}>
            Scan this code or copy the address to receive ETH and USDC on Ethereum Sepolia.
          </Text>
        </View>

        {state.status === 'loading' ? (
          <View accessibilityLabel="Loading wallet address" style={styles.stateCard}>
            <ActivityIndicator color="#d4f06a" />
            <Text style={styles.stateText}>Loading address...</Text>
          </View>
        ) : null}

        {state.status === 'error' ? (
          <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.errorCard}>
            <Text style={styles.errorTitle}>Wallet address unavailable</Text>
            <Text selectable style={styles.errorText}>
              {state.message}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setState({ status: 'loading' });
                setRetryCount((count) => count + 1);
              }}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {state.status === 'ready' ? (
          <View style={styles.receiveCard}>
            <View
              accessibilityLabel={`QR code for wallet address ${state.address}`}
              style={styles.qrFrame}
            >
              <QRCode
                backgroundColor="#ffffff"
                color="#171713"
                ecl="M"
                quietZone={12}
                size={qrSize}
                value={state.address}
              />
            </View>

            <View style={styles.addressBlock}>
              <Text style={styles.addressLabel}>WALLET ADDRESS</Text>
              <Text selectable style={styles.address}>
                {state.address}
              </Text>
            </View>

            <Pressable
              accessibilityLabel="Copy wallet address"
              accessibilityRole="button"
              onPress={() => void copy(state.address)}
              style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
            >
              <CopyIcon />
              <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy address'}</Text>
            </Pressable>

            {copyError ? (
              <Text accessibilityLiveRegion="assertive" selectable style={styles.copyError}>
                {copyError}
              </Text>
            ) : null}
          </View>
        ) : null}

        <Text style={styles.warning}>
          Only send Ethereum Sepolia assets to this address. Assets sent on another network may not
          appear here.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function CopyIcon() {
  return (
    <View importantForAccessibility="no-hide-descendants" style={styles.copyIcon}>
      <View style={styles.copyIconBack} />
      <View style={styles.copyIconFront} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#171713' },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 20, gap: 28 },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { minHeight: 44, justifyContent: 'center', paddingRight: 20 },
  backText: { color: '#f3f0e8', fontSize: 16, fontWeight: '700' },
  networkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#292923',
  },
  networkDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#d4f06a' },
  networkText: { color: '#c5c2b9', fontSize: 12, fontWeight: '700' },
  heading: { gap: 10 },
  eyebrow: { color: '#d4f06a', fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: '#f3f0e8', fontSize: 38, lineHeight: 42, fontWeight: '800', letterSpacing: -1.2 },
  description: { color: '#aaa89f', fontSize: 16, lineHeight: 24 },
  stateCard: { minHeight: 300, alignItems: 'center', justifyContent: 'center', gap: 14 },
  stateText: { color: '#929188', fontSize: 15 },
  receiveCard: {
    alignItems: 'center',
    gap: 22,
    padding: 20,
    borderRadius: 28,
    borderCurve: 'continuous',
    backgroundColor: '#24241f',
    borderWidth: 1,
    borderColor: '#34342d',
  },
  qrFrame: {
    padding: 8,
    borderRadius: 22,
    borderCurve: 'continuous',
    backgroundColor: '#ffffff',
  },
  addressBlock: { alignSelf: 'stretch', gap: 8 },
  addressLabel: { color: '#77766f', fontSize: 11, fontWeight: '800', letterSpacing: 1.3 },
  address: {
    color: '#f3f0e8',
    fontSize: 14,
    lineHeight: 22,
    fontFamily: 'monospace',
  },
  copyButton: {
    minHeight: 52,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 11,
    borderRadius: 17,
    borderCurve: 'continuous',
    backgroundColor: '#d4f06a',
  },
  copyText: { color: '#171713', fontSize: 16, fontWeight: '800' },
  copyIcon: { width: 20, height: 20 },
  copyIconBack: {
    position: 'absolute',
    left: 2,
    top: 2,
    width: 12,
    height: 13,
    borderWidth: 2,
    borderColor: '#171713',
    borderRadius: 3,
  },
  copyIconFront: {
    position: 'absolute',
    right: 1,
    bottom: 1,
    width: 12,
    height: 13,
    borderWidth: 2,
    borderColor: '#171713',
    borderRadius: 3,
    backgroundColor: '#d4f06a',
  },
  copyError: { color: '#ffd9d4', fontSize: 13, lineHeight: 19 },
  warning: { color: '#77766f', fontSize: 13, lineHeight: 19, paddingHorizontal: 4 },
  errorCard: {
    gap: 12,
    padding: 20,
    borderRadius: 20,
    borderCurve: 'continuous',
    backgroundColor: '#4b2724',
  },
  errorTitle: { color: '#fff2ef', fontSize: 18, fontWeight: '700' },
  errorText: { color: '#ffd9d4', fontSize: 14, lineHeight: 20 },
  retryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: '#ffd9d4',
  },
  retryText: { color: '#4b2724', fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.65 },
});
