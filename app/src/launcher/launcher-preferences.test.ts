import {
  createLauncherPreferencesRepository,
  parseLauncherPreferences,
  type LauncherPreferencesStorage,
} from './launcher-preferences';

describe('launcher preferences', () => {
  it('loads safe defaults when preferences are absent or invalid', () => {
    expect(parseLauncherPreferences(null)).toEqual({
      schemaVersion: 1,
      favoritePackageNames: [],
    });
    expect(parseLauncherPreferences('{invalid')).toEqual({
      schemaVersion: 1,
      favoritePackageNames: [],
    });
    expect(parseLauncherPreferences('{"schemaVersion":2,"favoritePackageNames":[]}')).toEqual({
      schemaVersion: 1,
      favoritePackageNames: [],
    });
  });

  it('normalizes persisted package identities', () => {
    expect(
      parseLauncherPreferences(
        JSON.stringify({
          schemaVersion: 1,
          favoritePackageNames: ['com.example.app', '', 'com.example.app', 42],
        }),
      ),
    ).toEqual({
      schemaVersion: 1,
      favoritePackageNames: ['com.example.app'],
    });
  });

  it('limits persisted favorites to four apps', () => {
    expect(
      parseLauncherPreferences(
        JSON.stringify({
          schemaVersion: 1,
          favoritePackageNames: ['one', 'two', 'three', 'four', 'five'],
        }),
      ).favoritePackageNames,
    ).toEqual(['one', 'two', 'three', 'four']);
  });

  it('serializes writes so rapid updates cannot persist stale preferences', async () => {
    let finishFirstWrite: () => void = () => undefined;
    const writes: string[] = [];
    const storage: LauncherPreferencesStorage = {
      read: jest.fn().mockResolvedValue(null),
      write: jest
        .fn()
        .mockImplementationOnce(
          (value: string) =>
            new Promise<void>((resolve) => {
              writes.push(value);
              finishFirstWrite = resolve;
            }),
        )
        .mockImplementationOnce(async (value: string) => {
          writes.push(value);
        }),
    };
    const repository = createLauncherPreferencesRepository(storage);

    const first = repository.save(['com.example.first']);
    const second = repository.save(['com.example.second']);
    await Promise.resolve();

    expect(writes).toHaveLength(1);
    finishFirstWrite();
    await Promise.all([first, second]);

    expect(writes.map((value) => JSON.parse(value).favoritePackageNames)).toEqual([
      ['com.example.first'],
      ['com.example.second'],
    ]);
  });
});
