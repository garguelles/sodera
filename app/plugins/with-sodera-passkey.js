const {
  AndroidConfig,
  withAndroidManifest,
  withStringsXml,
} = require('expo/config-plugins');

const ASSET_STATEMENTS_NAME = 'asset_statements';
const ASSET_STATEMENTS = JSON.stringify([
  { include: 'https://sodera.xyz/.well-known/assetlinks.json' },
]).replaceAll('"', '\\"');

function applyAndroidManifest(androidManifest) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  const metadata = application['meta-data'] ?? [];
  const assetStatements = {
    $: {
      'android:name': ASSET_STATEMENTS_NAME,
      'android:resource': `@string/${ASSET_STATEMENTS_NAME}`,
    },
  };
  const existingIndex = metadata.findIndex(
    (item) => item.$['android:name'] === ASSET_STATEMENTS_NAME,
  );

  if (existingIndex === -1) {
    metadata.push(assetStatements);
  } else {
    metadata[existingIndex] = assetStatements;
  }
  application['meta-data'] = metadata;

  return androidManifest;
}

function applyStringsXml(stringsXml) {
  return AndroidConfig.Strings.setStringItem(
    [
      {
        $: { name: ASSET_STATEMENTS_NAME, translatable: 'false' },
        _: ASSET_STATEMENTS,
      },
    ],
    stringsXml,
  );
}

function withSoderaPasskey(config) {
  config = withAndroidManifest(config, (modConfig) => {
    applyAndroidManifest(modConfig.modResults);
    return modConfig;
  });

  return withStringsXml(config, (modConfig) => {
    modConfig.modResults = applyStringsXml(modConfig.modResults);
    return modConfig;
  });
}

withSoderaPasskey.applyAndroidManifest = applyAndroidManifest;
withSoderaPasskey.applyStringsXml = applyStringsXml;

module.exports = withSoderaPasskey;
