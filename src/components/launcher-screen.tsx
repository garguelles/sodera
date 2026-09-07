import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { LauncherApp, LauncherClient } from '@/launcher/launcher-client';

type LauncherScreenProps = {
  client: LauncherClient;
};

export function LauncherScreen({ client }: LauncherScreenProps) {
  const [apps, setApps] = useState<LauncherApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    let latestRequest = 0;

    const loadApps = async () => {
      const request = ++latestRequest;
      try {
        const nextApps = await client.getLaunchableApps();
        if (active && request === latestRequest) {
          setApps(nextApps);
          setError(null);
        }
      } catch (loadError) {
        if (active && request === latestRequest) setError(getErrorMessage(loadError));
      } finally {
        if (active && request === latestRequest) setLoading(false);
      }
    };

    void loadApps();
    const unsubscribe = client.subscribeToAppChanges(() => void loadApps());
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void loadApps();
    });
    return () => {
      active = false;
      unsubscribe();
      appStateSubscription.remove();
    };
  }, [client, retryCount]);

  const openApp = async (app: LauncherApp) => {
    try {
      setError(null);
      await client.launchApp(app.componentName);
    } catch (launchError) {
      setError(getErrorMessage(launchError));
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.wordmark}>Sodera</Text>
        <Text style={styles.count}>{apps.length} apps</Text>
      </View>
      {error ? (
        <View accessibilityRole="alert" style={styles.error}>
          <Text style={styles.errorText}>{error}</Text>
          {apps.length === 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setLoading(true);
                setRetryCount((count) => count + 1);
              }}>
              <Text style={styles.retry}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#f3f0e8" />
          <Text style={styles.secondary}>Loading apps...</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.grid}
          data={apps}
          keyExtractor={(app) => app.componentName}
          numColumns={4}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.label}`}
              onPress={() => void openApp(item)}
              style={({ pressed }) => [styles.app, pressed && styles.pressed]}>
              {item.icon ? (
                <Image source={{ uri: item.icon }} style={styles.icon} />
              ) : (
                <View style={[styles.icon, styles.fallbackIcon]}>
                  <Text style={styles.fallbackText}>{item.label.slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
              <Text numberOfLines={2} style={styles.label}>
                {item.label}
              </Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to open app';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#171713' },
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  wordmark: { color: '#f3f0e8', fontSize: 28, fontWeight: '700', letterSpacing: -1 },
  count: { color: '#929188', fontSize: 13 },
  grid: { paddingHorizontal: 12, paddingBottom: 32 },
  app: { width: '25%', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 14 },
  pressed: { opacity: 0.55, transform: [{ scale: 0.96 }] },
  icon: { width: 56, height: 56, borderRadius: 14 },
  fallbackIcon: { backgroundColor: '#393932', alignItems: 'center', justifyContent: 'center' },
  fallbackText: { color: '#f3f0e8', fontSize: 22, fontWeight: '600' },
  label: { color: '#f3f0e8', fontSize: 12, lineHeight: 15, marginTop: 8, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  secondary: { color: '#929188', fontSize: 14 },
  error: { marginHorizontal: 18, marginBottom: 6, padding: 12, backgroundColor: '#4b2724' },
  errorText: { color: '#ffd9d4', fontSize: 13 },
  retry: { color: '#ffffff', fontSize: 13, fontWeight: '700', marginTop: 8 },
});
