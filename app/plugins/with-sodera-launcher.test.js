const withSoderaLauncher = require('./with-sodera-launcher');

describe('withSoderaLauncher', () => {
  it('registers the main activity as a Home handler', () => {
    const manifest = createManifest();

    withSoderaLauncher.applyAndroidManifest(manifest);

    expect(manifest.manifest.application[0].activity[0]['intent-filter']).toEqual(
      expect.arrayContaining([
        {
          action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
          category: [
            { $: { 'android:name': 'android.intent.category.HOME' } },
            { $: { 'android:name': 'android.intent.category.DEFAULT' } },
          ],
        },
      ]),
    );
  });

  it('declares launcher intent visibility without broad package access', () => {
    const manifest = createManifest();

    withSoderaLauncher.applyAndroidManifest(manifest);

    expect(manifest.manifest.queries).toEqual([
      {
        intent: [
          {
            action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
            category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
          },
        ],
      },
    ]);
    expect(manifest.manifest['uses-permission']).toBeUndefined();
  });
});

function createManifest() {
  return {
    manifest: {
      application: [
        {
          activity: [
            {
              $: { 'android:name': '.MainActivity', 'android:exported': 'true' },
              'intent-filter': [],
            },
          ],
        },
      ],
    },
  };
}
