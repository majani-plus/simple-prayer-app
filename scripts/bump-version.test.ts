/**
 * Tests for the pure half of `bump-version`.
 *
 * The git and filesystem half is not worth mocking — it is a straight-line sequence of `git`
 * invocations whose failure modes are all "git said no", and every one of them aborts before the
 * tag is pushed. What IS worth pinning is the changelog rewrite: it is a regex over markdown, its
 * output is committed and tagged, and a silent mismatch produces a changelog that looks fine and
 * says the wrong thing about a shipped release.
 */

import {
  bumpVersion,
  parseVersion,
  rollChangelog,
} from './bump-version';

const REPO = 'https://github.com/majani-plus/simple-prayer-app';

const CHANGELOG = `# Changelog

## [Unreleased]

### Added

- A thing that shipped in the next release.

### Changed

### Fixed

## [1.0.0] - 2026-08-19

The first release.

[Unreleased]: ${REPO}/compare/release/v1.0.0...HEAD
[1.0.0]: ${REPO}/releases/tag/release/v1.0.0
`;

describe('bumpVersion', () => {
  it.each([
    ['patch', '1.0.2', '1.0.3'],
    ['minor', '1.0.2', '1.1.0'],
    ['major', '1.0.2', '2.0.0'],
  ] as const)('%s: %s -> %s', (type, from, to) => {
    expect(bumpVersion(from, type)).toBe(to);
  });

  it('resets the lower components, rather than carrying them', () => {
    // The bug this catches is a minor bump that leaves the patch number behind (1.2.9 -> 1.3.9).
    expect(bumpVersion('1.2.9', 'minor')).toBe('1.3.0');
    expect(bumpVersion('1.2.9', 'major')).toBe('2.0.0');
  });
});

describe('parseVersion', () => {
  it('reads three numbers', () => {
    expect(parseVersion('10.20.30')).toEqual({ major: 10, minor: 20, patch: 30 });
  });

  it.each(['1.0', '1.0.0.0', '1.0.x', '', 'v1.0.0'])('refuses %p', (version) => {
    // Refusing beats guessing: a misparsed version would be committed, tagged and pushed.
    expect(() => parseVersion(version)).toThrow();
  });
});

describe('rollChangelog', () => {
  const rolled = rollChangelog(CHANGELOG, '1.1.0', '1.0.0', '2026-09-01');

  it('dates the new release and keeps what was under Unreleased', () => {
    expect(rolled).toContain('## [1.1.0] - 2026-09-01');
    expect(rolled).toContain('- A thing that shipped in the next release.');
  });

  it('leaves a fresh, empty Unreleased section at the top', () => {
    const unreleased = rolled.slice(
      rolled.indexOf('## [Unreleased]'),
      rolled.indexOf('## [1.1.0]')
    );
    expect(unreleased).toContain('### Added');
    expect(unreleased).toContain('### Changed');
    expect(unreleased).toContain('### Fixed');
    // The entry must have MOVED, not been copied into both sections.
    expect(unreleased).not.toContain('A thing that shipped');
  });

  it('orders the released section above the previous one', () => {
    expect(rolled.indexOf('## [1.1.0]')).toBeLessThan(rolled.indexOf('## [1.0.0]'));
  });

  it('retargets the Unreleased compare link and adds one for the release', () => {
    expect(rolled).toContain(`[Unreleased]: ${REPO}/compare/release/v1.1.0...HEAD`);
    expect(rolled).toContain(`[1.1.0]: ${REPO}/compare/release/v1.0.0...release/v1.1.0`);
    // The old link must be gone, not merely joined by a new one.
    expect(rolled).not.toContain(`[Unreleased]: ${REPO}/compare/release/v1.0.0...HEAD`);
  });

  it('keeps the previous release links intact', () => {
    expect(rolled).toContain(`[1.0.0]: ${REPO}/releases/tag/release/v1.0.0`);
  });

  it('refuses a changelog with no Unreleased section', () => {
    // Appending somewhere plausible instead would produce a file nobody notices is wrong.
    expect(() => rollChangelog('# Changelog\n\n## [1.0.0] - 2026-08-19\n', '1.1.0', '1.0.0', '2026-09-01')).toThrow(
      /Unreleased/
    );
  });

  it('still rolls the sections when the compare links are missing', () => {
    // A changelog without link definitions is unusual but not a reason to refuse a release.
    const withoutLinks = '# Changelog\n\n## [Unreleased]\n\n- pending\n';
    const result = rollChangelog(withoutLinks, '1.1.0', '1.0.0', '2026-09-01');
    expect(result).toContain('## [1.1.0] - 2026-09-01');
  });
});
