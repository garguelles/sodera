import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { LauncherApp, LauncherClient } from '@/launcher/launcher-client';
import {
  createLauncherPreferencesRepository,
  type LauncherPreferencesStorage,
} from '@/launcher/launcher-preferences';

type LauncherScreenProps = {
  client: LauncherClient;
  preferencesStorage: LauncherPreferencesStorage;
  homeContent?: ReactNode;
  onOpenPasskeyProof?: () => void;
};

export function LauncherScreen({
  client,
  preferencesStorage,
  homeContent,
  onOpenPasskeyProof,
}: LauncherScreenProps) {
  const [apps, setApps] = useState<LauncherApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [favoritePackageNames, setFavoritePackageNames] = useState<string[]>([]);
  const favoritePackageNamesRef = useRef(favoritePackageNames);
  const latestPreferenceChange = useRef(0);
  const [preferencesRepository] = useState(() =>
    createLauncherPreferencesRepository(preferencesStorage),
  );
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const [showSettings, setShowSettings] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    preferencesRepository
      .load()
      .then((preferences) => {
        if (!active) return;
        favoritePackageNamesRef.current = preferences.favoritePackageNames;
        setFavoritePackageNames(preferences.favoritePackageNames);
        setPreferencesLoaded(true);
      })
      .catch((loadError) => {
        if (!active) return;
        setPreferencesError(getErrorMessage(loadError));
        setPreferencesLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [preferencesRepository]);

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
      setApps((currentApps) =>
        currentApps.filter((currentApp) => currentApp.componentName !== app.componentName),
      );
      setError(getErrorMessage(launchError));
    }
  };

  const saveFavorites = (nextFavoritePackageNames: string[]) => {
    const change = ++latestPreferenceChange.current;
    favoritePackageNamesRef.current = nextFavoritePackageNames;
    setFavoritePackageNames(nextFavoritePackageNames);
    setPreferencesError(null);
    void preferencesRepository
      .save(nextFavoritePackageNames)
      .catch((saveError) => {
        if (change === latestPreferenceChange.current) {
          setPreferencesError(getErrorMessage(saveError));
        }
      });
  };

  const toggleFavorite = (packageName: string) => {
    const current = favoritePackageNamesRef.current;
    saveFavorites(
      current.includes(packageName)
        ? current.filter((favorite) => favorite !== packageName)
        : [...current, packageName],
    );
  };

  const favoritePackages = new Set(favoritePackageNames);
  const visibleFavoriteCount = new Set(
    apps.filter((app) => favoritePackages.has(app.packageName)).map((app) => app.packageName),
  ).size;
  const visibleApps = apps
    .filter((app) => app.label.toLocaleLowerCase().includes(normalizedQuery))
    .map((app, index) => ({ app, index }))
    .sort(
      (left, right) =>
        Number(favoritePackages.has(right.app.packageName)) -
          Number(favoritePackages.has(left.app.packageName)) || left.index - right.index,
    )
    .map(({ app }) => app);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.wordmark}>Sodera</Text>
        <View style={styles.headerActions}>
          {onOpenPasskeyProof ? (
            <Pressable accessibilityRole="button" onPress={onOpenPasskeyProof}>
              <Text style={styles.proofLink}>Passkey proof</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showSettings ? 'Close launcher settings' : 'Open launcher settings'}
            onPress={() => setShowSettings((current) => !current)}
            style={styles.headerButton}>
            <Text style={styles.headerLink}>{showSettings ? 'Done' : 'Settings'}</Text>
          </Pressable>
        </View>
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
      {preferencesError ? (
        <View accessibilityRole="alert" style={styles.preferenceError}>
          <Text style={styles.preferenceErrorText}>{preferencesError}</Text>
          <Text style={styles.preferenceErrorText}>Apps remain available, but changes may not persist.</Text>
        </View>
      ) : null}
      {showSettings ? (
        <View style={styles.settings}>
          <Text style={styles.settingsTitle}>Launcher settings</Text>
          <Text style={styles.secondary}>
            Favorites are stored on this device and stay available offline.
          </Text>
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={styles.settingLabel}>Favorite apps</Text>
              <Text style={styles.secondary}>
                {visibleFavoriteCount} currently installed
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear favorite apps"
              disabled={!preferencesLoaded || favoritePackageNames.length === 0}
              onPress={() => saveFavorites([])}
              style={({ pressed }) => [
                styles.clearButton,
                (!preferencesLoaded || favoritePackageNames.length === 0) && styles.disabled,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.clearButtonText}>Clear</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      <FlatList
        accessibilityElementsHidden={showSettings}
        importantForAccessibility={showSettings ? 'no-hide-descendants' : 'auto'}
        style={showSettings ? styles.hidden : styles.launcherContent}
        contentContainerStyle={styles.grid}
        data={loading ? [] : visibleApps}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(app) => app.componentName}
        ListEmptyComponent={
          loading ? (
            <View style={styles.center}>
              <ActivityIndicator color="#f3f0e8" />
              <Text style={styles.secondary}>Loading apps...</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                {normalizedQuery ? `No apps match "${query.trim()}"` : 'No launchable apps found'}
              </Text>
            </View>
          )
        }
        ListHeaderComponent={
          <View>
            {homeContent}
            <View style={styles.searchContainer}>
              <TextInput
                accessibilityLabel="Search apps"
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setQuery}
                placeholder="Search apps"
                placeholderTextColor="#77766e"
                returnKeyType="search"
                style={styles.search}
                value={query}
              />
            </View>
            <View style={styles.drawerMeta}>
              <Text style={styles.count}>
                {normalizedQuery
                  ? `${visibleApps.length} of ${apps.length} apps`
                  : `${apps.length} apps`}
              </Text>
              {visibleFavoriteCount > 0 ? (
                <Text style={styles.count}>
                  {visibleFavoriteCount} favorite{visibleFavoriteCount === 1 ? '' : 's'} first
                </Text>
              ) : null}
            </View>
          </View>
        }
        numColumns={4}
        renderItem={({ item }) => {
          const favorite = favoritePackages.has(item.packageName);
          return (
            <View style={styles.app}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.label}`}
                onPress={() => void openApp(item)}
                style={({ pressed }) => [styles.appButton, pressed && styles.pressed]}>
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${favorite ? 'Unpin' : 'Pin'} ${item.label}`}
                accessibilityState={{ disabled: !preferencesLoaded, selected: favorite }}
                disabled={!preferencesLoaded}
                onPress={() => toggleFavorite(item.packageName)}
                style={({ pressed }) => [styles.favoriteButton, pressed && styles.pressed]}>
                <Text style={[styles.favorite, favorite && styles.favoriteSelected]}>
                  {favorite ? 'Pinned' : 'Pin'}
                </Text>
              </Pressable>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to open app';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#171713' },
  launcherContent: { flex: 1 },
  hidden: { display: 'none' },
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  proofLink: { color: '#8cc8ff', fontSize: 13, fontWeight: '600' },
  headerButton: { minHeight: 48, justifyContent: 'center' },
  headerLink: { color: '#f3f0e8', fontSize: 13, fontWeight: '600' },
  searchContainer: { paddingHorizontal: 18, paddingBottom: 8 },
  search: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#292923',
    color: '#f3f0e8',
    paddingHorizontal: 14,
    fontSize: 16,
  },
  drawerMeta: {
    minHeight: 24,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  grid: { paddingHorizontal: 12, paddingBottom: 32 },
  emptyState: { minHeight: 180, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { color: '#929188', fontSize: 15, textAlign: 'center' },
  app: { width: '25%', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 12 },
  appButton: { alignItems: 'center' },
  pressed: { opacity: 0.55, transform: [{ scale: 0.96 }] },
  icon: { width: 56, height: 56, borderRadius: 14 },
  fallbackIcon: { backgroundColor: '#393932', alignItems: 'center', justifyContent: 'center' },
  fallbackText: { color: '#f3f0e8', fontSize: 22, fontWeight: '600' },
  label: { color: '#f3f0e8', fontSize: 12, lineHeight: 15, marginTop: 8, textAlign: 'center' },
  favoriteButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  favorite: { color: '#929188', fontSize: 11, lineHeight: 24, textAlign: 'center' },
  favoriteSelected: { color: '#f5c451' },
  center: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 12 },
  secondary: { color: '#929188', fontSize: 14 },
  error: { marginHorizontal: 18, marginBottom: 6, padding: 12, backgroundColor: '#4b2724' },
  errorText: { color: '#ffd9d4', fontSize: 13 },
  preferenceError: {
    marginHorizontal: 18,
    marginBottom: 8,
    padding: 12,
    backgroundColor: '#443a24',
  },
  preferenceErrorText: { color: '#f7e2ad', fontSize: 13 },
  retry: { color: '#ffffff', fontSize: 13, fontWeight: '700', marginTop: 8 },
  settings: { flex: 1, paddingHorizontal: 24, paddingTop: 18, gap: 10 },
  settingsTitle: { color: '#f3f0e8', fontSize: 22, fontWeight: '700' },
  settingRow: {
    marginTop: 16,
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#292923',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  settingCopy: { flex: 1, gap: 4 },
  settingLabel: { color: '#f3f0e8', fontSize: 16, fontWeight: '600' },
  clearButton: {
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: '#4b2724',
    paddingHorizontal: 15,
    justifyContent: 'center',
  },
  clearButtonText: { color: '#ffd9d4', fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.35 },
});
