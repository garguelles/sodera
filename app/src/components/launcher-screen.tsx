import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  FlatList,
  type GestureResponderEvent,
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
  MAX_FAVORITE_APPS,
  type LauncherPreferencesStorage,
} from '@/launcher/launcher-preferences';

type LauncherScreenProps = {
  client: LauncherClient;
  preferencesStorage: LauncherPreferencesStorage;
  homeContent?: ReactNode;
  onOpenSettings?: () => void;
};

export function LauncherScreen({
  client,
  preferencesStorage,
  homeContent,
  onOpenSettings,
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
  const [showAppDrawer, setShowAppDrawer] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let active = true;

    const loadPreferences = () => {
      void preferencesRepository
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
    };

    loadPreferences();
    const unsubscribe = preferencesStorage.subscribe?.(loadPreferences);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [preferencesRepository, preferencesStorage]);

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

  useEffect(() => {
    if (!showAppDrawer) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setShowAppDrawer(false);
      return true;
    });
    return () => subscription.remove();
  }, [showAppDrawer]);

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
    if (current.includes(packageName)) {
      saveFavorites(current.filter((favorite) => favorite !== packageName));
      return;
    }

    const installedPackages = new Set(apps.map((app) => app.packageName));
    const installedFavorites = current.filter((favorite) => installedPackages.has(favorite));
    if (installedFavorites.length >= MAX_FAVORITE_APPS) return;
    saveFavorites([...installedFavorites, packageName]);
  };

  const favoritePackages = new Set(favoritePackageNames);
  const visibleFavoriteCount = new Set(
    apps.filter((app) => favoritePackages.has(app.packageName)).map((app) => app.packageName),
  ).size;
  const drawerApps = apps
    .filter((app) => app.label.toLocaleLowerCase().includes(normalizedQuery))
    .map((app, index) => ({ app, index }))
    .sort(
      (left, right) =>
        Number(favoritePackages.has(right.app.packageName)) -
          Number(favoritePackages.has(left.app.packageName)) || left.index - right.index,
    )
    .map(({ app }) => app);
  const pinnedApps = apps.filter((app) => favoritePackages.has(app.packageName));
  const visibleApps = showAppDrawer ? drawerApps : pinnedApps;

  const handleTouchStart = (event: GestureResponderEvent) => {
    touchStart.current = {
      x: event.nativeEvent.pageX,
      y: event.nativeEvent.pageY,
    };
  };

  const handleTouchEnd = (event: GestureResponderEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;

    const deltaX = event.nativeEvent.pageX - start.x;
    const deltaY = event.nativeEvent.pageY - start.y;
    if (Math.abs(deltaY) < 60 || Math.abs(deltaY) <= Math.abs(deltaX)) return;
    setShowAppDrawer(deltaY < 0);
  };

  return (
    <SafeAreaView onTouchEnd={handleTouchEnd} onTouchStart={handleTouchStart} style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.wordmark}>Sodera</Text>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showAppDrawer ? 'Return to Home' : 'Open app drawer'}
            onPress={() => setShowAppDrawer((current) => !current)}
            style={styles.headerButton}>
            <Text style={styles.headerLink}>{showAppDrawer ? 'Home' : 'Apps'}</Text>
          </Pressable>
          {onOpenSettings ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open launcher settings"
              onPress={onOpenSettings}
              style={styles.headerButton}>
              <Text style={styles.headerLink}>Settings</Text>
            </Pressable>
          ) : null}
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
      <FlatList
        style={styles.launcherContent}
        contentContainerStyle={[styles.grid, !showAppDrawer && styles.homeGrid]}
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
                {showAppDrawer
                  ? normalizedQuery
                    ? `No apps match "${query.trim()}"`
                    : 'No launchable apps found'
                  : 'No pinned apps'}
              </Text>
            </View>
          )
        }
        ListHeaderComponent={
          <View>
            <View style={showAppDrawer ? styles.hidden : undefined}>{homeContent}</View>
            {showAppDrawer ? (
              <>
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
                      {visibleFavoriteCount}/{MAX_FAVORITE_APPS} pinned
                    </Text>
                  ) : null}
                </View>
              </>
            ) : null}
          </View>
        }
        ListHeaderComponentStyle={!showAppDrawer ? styles.homeHeader : undefined}
        numColumns={4}
        renderItem={({ item }) => {
          const favorite = favoritePackages.has(item.packageName);
          const pinLimitReached = !favorite && visibleFavoriteCount >= MAX_FAVORITE_APPS;
          return (
            <View style={[styles.app, !showAppDrawer && styles.dockApp]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.label}`}
                onPress={() => openApp(item)}
                style={({ pressed }) => [styles.appButton, pressed && styles.pressed]}>
                <View style={!showAppDrawer ? styles.dockIconFrame : undefined}>
                  {item.icon ? (
                    <Image
                      source={{ uri: item.icon }}
                      style={[styles.icon, !showAppDrawer && styles.dockIcon]}
                    />
                  ) : (
                    <View style={[styles.icon, styles.fallbackIcon, !showAppDrawer && styles.dockIcon]}>
                      <Text style={[styles.fallbackText, !showAppDrawer && styles.dockFallbackText]}>
                        {item.label.slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                  )}
                </View>
                <Text numberOfLines={2} style={[styles.label, !showAppDrawer && styles.dockLabel]}>
                  {item.label}
                </Text>
              </Pressable>
              {showAppDrawer ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${favorite ? 'Unpin' : pinLimitReached ? 'Pin limit reached for' : 'Pin'} ${item.label}`}
                  accessibilityState={{
                    disabled: !preferencesLoaded || pinLimitReached,
                    selected: favorite,
                  }}
                  disabled={!preferencesLoaded || pinLimitReached}
                  onPress={() => toggleFavorite(item.packageName)}
                  style={({ pressed }) => [
                    styles.favoriteButton,
                    pinLimitReached && styles.disabled,
                    pressed && styles.pressed,
                  ]}>
                  <Text style={[styles.favorite, favorite && styles.favoriteSelected]}>
                    {favorite ? 'Pinned' : pinLimitReached ? 'Full' : 'Pin'}
                  </Text>
                </Pressable>
              ) : null}
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
  homeGrid: { flexGrow: 1 },
  homeHeader: { flexGrow: 1 },
  emptyState: { minHeight: 180, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { color: '#929188', fontSize: 15, textAlign: 'center' },
  app: { width: '25%', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 12 },
  dockApp: { paddingVertical: 8 },
  appButton: { alignItems: 'center' },
  pressed: { opacity: 0.55, transform: [{ scale: 0.96 }] },
  icon: { width: 56, height: 56, borderRadius: 14 },
  dockIconFrame: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#292923',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockIcon: { width: 34, height: 34, borderRadius: 10, opacity: 0.82 },
  fallbackIcon: { backgroundColor: '#393932', alignItems: 'center', justifyContent: 'center' },
  fallbackText: { color: '#f3f0e8', fontSize: 22, fontWeight: '600' },
  dockFallbackText: { fontSize: 15 },
  label: { color: '#f3f0e8', fontSize: 12, lineHeight: 15, marginTop: 8, textAlign: 'center' },
  dockLabel: { color: '#aaa89f', fontSize: 11, lineHeight: 14, marginTop: 6 },
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
  disabled: { opacity: 0.35 },
});
