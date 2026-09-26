import { parseSoderaUsername, SODERA_RESERVED_LABELS } from './username';

describe('Sodera username policy', () => {
  it('accepts the canonical label and builds the full ENS name', () => {
    expect(parseSoderaUsername('gargs')).toEqual({ label: 'gargs', name: 'gargs.sodera.eth' });
    expect(parseSoderaUsername('  alice-2b  ')).toEqual({ label: 'alice-2b', name: 'alice-2b.sodera.eth' });
    expect(parseSoderaUsername(`a${'1'.repeat(18)}z`).label).toHaveLength(20);
  });

  it.each(['ab', 'Alice', 'a1', '1alice', 'alice1', '-alice', 'alice-', 'al_ce', 'a'.repeat(21), 'alice.eth'])
    ('rejects a non-product label %s', (label) => {
      expect(() => parseSoderaUsername(label)).toThrow();
    });

  it('reserves the demo fixture and system identities', () => {
    expect(SODERA_RESERVED_LABELS).toContain('anon');
    expect(() => parseSoderaUsername('anon')).toThrow('reserved');
    expect(() => parseSoderaUsername('support')).toThrow('reserved');
  });
});
