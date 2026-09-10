const withSoderaPasskey = require('./with-sodera-passkey');

describe('withSoderaPasskey', () => {
  it('declares the Digital Asset Links statement in the manifest', () => {
    const manifest = createManifest();

    withSoderaPasskey.applyAndroidManifest(manifest);
    withSoderaPasskey.applyAndroidManifest(manifest);

    expect(manifest.manifest.application[0]['meta-data']).toEqual([
      {
        $: {
          'android:name': 'asset_statements',
          'android:resource': '@string/asset_statements',
        },
      },
    ]);
  });

  it('points asset statements at the Sodera association file', () => {
    const stringsXml = { resources: {} };

    const result = withSoderaPasskey.applyStringsXml(stringsXml);

    expect(result.resources.string).toEqual([
      {
        $: { name: 'asset_statements', translatable: 'false' },
        _: '[{\\"include\\":\\"https://sodera.xyz/.well-known/assetlinks.json\\"}]',
      },
    ]);
  });
});

function createManifest() {
  return {
    manifest: {
      application: [{ $: { 'android:name': '.MainApplication' } }],
    },
  };
}
