const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const HOME_FILTER = {
  action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
  category: [
    { $: { 'android:name': 'android.intent.category.HOME' } },
    { $: { 'android:name': 'android.intent.category.DEFAULT' } },
  ],
};

const LAUNCHER_QUERY = {
  intent: [
    {
      action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
      category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
    },
  ],
};

function applyAndroidManifest(androidManifest) {
  const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(androidManifest);
  const filters = mainActivity['intent-filter'] ?? [];
  const hasHomeFilter = filters.some((filter) =>
    filter.category?.some(
      (category) => category.$['android:name'] === 'android.intent.category.HOME',
    ),
  );

  if (!hasHomeFilter) {
    filters.push(HOME_FILTER);
    mainActivity['intent-filter'] = filters;
  }

  const queries = androidManifest.manifest.queries ?? [];
  const hasLauncherQuery = queries.some((query) =>
    query.intent?.some((intent) =>
      intent.category?.some(
        (category) => category.$['android:name'] === 'android.intent.category.LAUNCHER',
      ),
    ),
  );

  if (!hasLauncherQuery) {
    queries.push(LAUNCHER_QUERY);
    androidManifest.manifest.queries = queries;
  }

  return androidManifest;
}

function withSoderaLauncher(config) {
  return withAndroidManifest(config, (modConfig) => {
    applyAndroidManifest(modConfig.modResults);
    return modConfig;
  });
}

withSoderaLauncher.applyAndroidManifest = applyAndroidManifest;

module.exports = withSoderaLauncher;
