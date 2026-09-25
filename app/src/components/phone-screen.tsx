import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Image,
  Keyboard,
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

type PhoneScreenProps = {
  client: LauncherClient;
  preferencesStorage: LauncherPreferencesStorage;
};

export function PhoneScreen({
  client,
  preferencesStorage,
}: PhoneScreenProps) {
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
  const [retryCount, setRetryCount] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

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
    .filter((app) =>
      app.label.toLocaleLowerCase().includes(normalizedQuery) &&
      (normalizedQuery.length > 0 || !favoritePackages.has(app.packageName)),
    )
    .map((app, index) => ({ app, index }))
    .sort((left, right) => left.app.label.localeCompare(right.app.label) || left.index - right.index)
    .map(({ app }) => app);
  const pinnedApps = apps.filter((app) => favoritePackages.has(app.packageName));

  return (
    <SafeAreaView edges={['bottom']} style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>YOUR PHONE</Text>
          <Text style={styles.title}>All your apps.</Text>
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
      <FlatList
        style={styles.launcherContent}
        contentContainerStyle={styles.grid}
        data={loading ? [] : drawerApps}
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
                {normalizedQuery
                  ? `No apps match "${query.trim()}"`
                  : apps.length > 0 ? 'All apps are in your favorites' : 'No launchable apps found'}
              </Text>
            </View>
          )
        }
        ListHeaderComponent={
          <View style={styles.drawerMeta}>
            <Text style={styles.count}>
              {normalizedQuery ? `${drawerApps.length} of ${apps.length} apps` : `${apps.length} apps`}
            </Text>
            <Text style={styles.count}>Search includes favorites</Text>
          </View>
        }
        numColumns={4}
        renderItem={({ item }) => {
          const favorite = favoritePackages.has(item.packageName);
          const pinLimitReached = !favorite && visibleFavoriteCount >= MAX_FAVORITE_APPS;
          return (
            <View style={styles.app}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.label}`}
                onPress={() => openApp(item)}
                style={({ pressed }) => [styles.appButton, pressed && styles.pressed]}>
                <View>
                  {item.icon ? (
                    <Image source={{ uri: item.icon }} style={styles.icon} />
                  ) : (
                    <View style={[styles.icon, styles.fallbackIcon]}>
                      <Text style={styles.fallbackText}>
                        {item.label.slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                  )}
                </View>
                <Text numberOfLines={2} style={styles.label}>
                  {item.label}
                </Text>
              </Pressable>
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
            </View>
          );
        }}
      />
      {!loading && !normalizedQuery && !keyboardVisible ? (
        <View style={styles.favorites}>
          <View style={styles.favoritesHeading}>
            <Text style={styles.favoritesTitle}>FAVORITES</Text>
            <Text style={styles.count}>{visibleFavoriteCount}/{MAX_FAVORITE_APPS}</Text>
          </View>
          {pinnedApps.length > 0 ? (
            <View style={styles.favoriteRow}>
              {pinnedApps.map((app) => (
                <View key={app.packageName} style={styles.favoriteApp}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${app.label}`}
                    onPress={() => openApp(app)}
                    style={({ pressed }) => [styles.favoriteLaunch, pressed && styles.pressed]}>
                    {app.icon ? (
                      <Image source={{ uri: app.icon }} style={styles.favoriteIcon} />
                    ) : (
                      <View style={[styles.favoriteIcon, styles.fallbackIcon]}>
                        <Text style={styles.fallbackText}>{app.label.slice(0, 1).toUpperCase()}</Text>
                      </View>
                    )}
                    <Text numberOfLines={1} style={styles.favoriteAppLabel}>{app.label}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Unpin ${app.label}`}
                    disabled={!preferencesLoaded}
                    onPress={() => toggleFavorite(app.packageName)}
                    style={styles.favoriteRemove}>
                    <Text style={styles.favoriteRemoveText}>Unpin</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.favoritesHint}>Pin up to four apps for quick access.</Text>
          )}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to open app';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#171713' },
  launcherContent: { flex: 1 },
  header: { paddingHorizontal: 22, paddingTop: 16, paddingBottom: 18 },
  eyebrow: { color: '#d4f06a', fontSize: 10, fontWeight: '800', letterSpacing: 1.6 },
  title: { color: '#f3f0e8', fontSize: 28, fontWeight: '700', letterSpacing: -0.8, paddingTop: 5 },
  count: { color: '#929188', fontSize: 13 },
  searchContainer: { paddingHorizontal: 18, paddingBottom: 12 },
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
  grid: { paddingHorizontal: 12, paddingBottom: 24 },
  emptyState: { minHeight: 180, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { color: '#929188', fontSize: 13, textAlign: 'center' },
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
  favorites: {
    borderTopWidth: 1,
    borderTopColor: '#393932',
    backgroundColor: '#20201c',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 8,
    gap: 12,
  },
  favoritesHeading: { flexDirection: 'row', justifyContent: 'space-between' },
  favoritesTitle: { color: '#d4f06a', fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  favoritesHint: { color: '#929188', fontSize: 13, paddingBottom: 14 },
  favoriteRow: { flexDirection: 'row', alignItems: 'flex-start' },
  favoriteApp: { width: '25%', alignItems: 'center' },
  favoriteLaunch: { alignItems: 'center', width: '100%', gap: 4 },
  favoriteIcon: { width: 42, height: 42, borderRadius: 12 },
  favoriteAppLabel: { color: '#f3f0e8', fontSize: 11, textAlign: 'center' },
  favoriteRemove: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 8 },
  favoriteRemoveText: { color: '#929188', fontSize: 10 },
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
