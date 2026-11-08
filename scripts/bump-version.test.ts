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
  bumpGradleVersionCode,
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

describe('bumpGradleVersionCode', () => {
  // The shape of the real files, comments included — those comments are the reason this needs a
  // line-anchored regex rather than a bare /versionCode (\d+)/.
  const WEAR = `android {
  defaultConfig {
    // Disjoint from the phone's EAS-remote versionCodes forever: the 9xx-million block is Wear's.
    // This must NOT be made to match the phone's versionCode, and a shared/matching number here
    // would either collide with a future phone build or require coordinating one counter.
    versionCode 900000002
    versionName appVersion
  }
}
`;

  it('steps the counter by one', () => {
    const { content, from, to } = bumpGradleVersionCode(WEAR);
    expect(from).toBe(900000002);
    expect(to).toBe(900000003);
    expect(content).toContain('versionCode 900000003');
  });

  it('leaves the rest of the file untouched, comments included', () => {
    const { content } = bumpGradleVersionCode(WEAR);
    expect(content).toBe(WEAR.replace('versionCode 900000002', 'versionCode 900000003'));
  });

  it('does not mistake prose about versionCode for a declaration', () => {
    // Every line here mentions versionCode; only one declares it. A naive regex takes the comment
    // on line 3 and writes a number into the middle of a sentence.
    const { content, to } = bumpGradleVersionCode(WEAR);
    expect(to).toBe(900000003);
    expect(content).toContain("the phone's EAS-remote versionCodes forever");
    expect(content).toContain("match the phone's versionCode, and a shared");
  });

  it('preserves the existing indentation and spacing', () => {
    const tabbed = 'android {\n\t\tversionCode   7\n}\n';
    expect(bumpGradleVersionCode(tabbed).content).toBe('android {\n\t\tversionCode   8\n}\n');
  });

  it('steps the watch face counter, which is a small number of its own', () => {
    // wear-face is a separate Play listing, so it counts from 1 rather than the 9xx-million block.
    const face = 'defaultConfig {\n    versionCode 2\n    versionName appVersion\n}\n';
    expect(bumpGradleVersionCode(face).to).toBe(3);
  });

  it('refuses a file with no versionCode rather than silently doing nothing', () => {
    // Silence here would mean a green build and a rejected upload a day later.
    expect(() => bumpGradleVersionCode('android {\n  versionName appVersion\n}\n')).toThrow(
      /found 0/
    );
  });

  it('refuses a file with more than one, rather than guessing which', () => {
    const twoFlavours = 'a {\n  versionCode 1\n}\nb {\n  versionCode 2\n}\n';
    expect(() => bumpGradleVersionCode(twoFlavours)).toThrow(/found 2/);
  });
});
