#!/usr/bin/env bun

/**
 * Version bump: sets the new version, rolls the changelog, tags, pushes.
 *
 *   bun run version:bump [major|minor|patch] [--skip-checks]
 *
 * Adapted from the same script in the divekit-app repo. What differs here, and why:
 *
 * - **It does not touch `ios.buildNumber` or `android.versionCode` in `app.json`.** `eas.json` sets
 *   `appVersionSource: "remote"`, so EAS owns the PHONE's build counter server-side and those
 *   `app.json` fields are dead (docs/RELEASE.md). Writing them would only create something that
 *   looks authoritative and is not.
 * - **It DOES step the two Wear `versionCode` literals**, because nothing else does. `wear/` and
 *   `wear-face/` are custom Gradle modules outside the CNG-managed tree, so EAS's remote counter
 *   never reaches them — their `versionCode` is a hardcoded number in each `build.gradle`, and Play
 *   refuses a duplicate. That failure arrives at UPLOAD, long after a green build, which is the
 *   worst place to learn it: 1.2.0 hit it and had to be fixed by hand (commit `f68283f`, "Both Wear
 *   versionCodes step, because Play only tells you by rejecting the upload"). Their `versionName`
 *   needs no help — both `build.gradle` files already read `expo.version` out of `app.json` at
 *   build time, so the marketing version follows this script for free.
 *   The two counters are independent and deliberately unrelated: `wear/` shares the phone's
 *   applicationId and so lives in a 9xx-million block that can never collide with EAS's remote
 *   numbers, while `wear-face/` is its own Play listing counting up from 1. Both simply step by one.
 * - **It runs the release checks before tagging.** The original aborted the bump if a generated
 *   artefact failed to rebuild, on the principle that a tag should never point at something broken.
 *   The equivalent here is `bun run pre-release` (lint + typecheck + test). `--skip-checks` exists
 *   for when you have just run them yourself.
 * - **It refuses to sweep up unrelated work.** The original staged its files unconditionally, so any
 *   other edit sitting in one of its files — now including the two Wear `build.gradle` — would ride
 *   along inside a commit labelled "Bump version". This one stops and tells you.
 * - **`app.json` is the source of truth** and `package.json` follows it. It also refuses to run when
 *   the two already disagree, rather than quietly picking one — they drifted once (0.1.0 vs 1.0.0)
 *   and silently resolving that would hide the real problem.
 *
 * Requires a clean-enough tree on `main`. Pushes both the commit and the tag.
 */

import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
} as const;

type Color = keyof typeof colors;
type BumpType = 'major' | 'minor' | 'patch';

const CHANGELOG_PATH = 'CHANGELOG.md';

interface VersionParts {
  major: number;
  minor: number;
  patch: number;
}

/**
 * The Wear modules' `build.gradle` files, whose `versionCode` literals this script steps.
 * EAS's remote counter does not reach them (see the header note), so they are ours to move.
 */
const WEAR_GRADLE_FILES = ['wear/build.gradle', 'wear-face/build.gradle'] as const;

/** Files this script may stage. Anything else in the tree is left alone. */
const OWNED_FILES = ['app.json', 'package.json', CHANGELOG_PATH, ...WEAR_GRADLE_FILES] as const;

const CHANGELOG = CHANGELOG_PATH;

function log(message: string, color: Color = 'reset'): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Splits a semantic version into its numbers.
 *
 * @param version - e.g. `"1.0.2"`.
 * @returns The three components.
 * @throws If it is not exactly three numbers.
 */
export function parseVersion(version: string): VersionParts {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid version format: ${version}. Expected X.Y.Z`);
  }
  return { major: parts[0], minor: parts[1], patch: parts[2] };
}

/**
 * Applies a semver increment.
 *
 * @param currentVersion - The version to move from.
 * @param bumpType - Which component to raise.
 * @returns The new version string.
 */
export function bumpVersion(currentVersion: string, bumpType: BumpType): string {
  const { major, minor, patch } = parseVersion(currentVersion);
  switch (bumpType) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
}

/** Runs git and captures its result, never throwing on a non-zero exit. */
function git(args: string[]): { ok: boolean; out: string; err: string } {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return {
    ok: result.status === 0,
    out: result.stdout?.trim() ?? '',
    err: result.stderr?.trim() ?? '',
  };
}

/** The marketing version in `app.json`, which is the source of truth. */
function appJsonVersion(): string {
  const json = JSON.parse(readFileSync('app.json', 'utf8')) as { expo?: { version?: string } };
  const version = json.expo?.version;
  if (typeof version !== 'string') throw new Error('app.json has no expo.version');
  return version;
}

/** The mirrored version in `package.json`. */
function packageJsonVersion(): string {
  const json = JSON.parse(readFileSync('package.json', 'utf8')) as { version?: string };
  if (typeof json.version !== 'string') throw new Error('package.json has no version');
  return json.version;
}

/**
 * Writes a version into a JSON file at a dotted path, preserving 2-space formatting.
 *
 * @param filePath - The file to rewrite.
 * @param versionPath - Dotted path to the field, e.g. `expo.version`.
 * @param newVersion - The value to set.
 */
export function updateVersionInFile(
  filePath: string,
  versionPath: string,
  newVersion: string
): void {
  const json = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  const keys = versionPath.split('.');
  let node = json;
  for (const key of keys.slice(0, -1)) {
    const next = node[key];
    if (typeof next !== 'object' || next === null) {
      throw new Error(`${filePath}: ${versionPath} does not exist`);
    }
    node = next as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = newVersion;
  writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`);
  log(`updated ${filePath}: ${versionPath} -> ${newVersion}`, 'green');
}

/**
 * Steps the `versionCode` literal in a Gradle module by one.
 *
 * Pure, so the regex can be pinned by tests rather than trusted — this number is the difference
 * between an upload Play accepts and one it rejects, and the rejection only happens after a build.
 *
 * The match is anchored to a whole line so it cannot hit the several COMMENTS in these files that
 * discuss `versionCode` in prose (`wear/build.gradle` has four). Exactly one declaration must
 * match: zero means the file changed shape and the caller must look, and more than one means the
 * file has per-flavour codes this function is too simple to reason about. Both throw rather than
 * guess, because guessing produces a plausible number and a failed upload a day later.
 *
 * @param content - The `build.gradle` source.
 * @returns The rewritten source and the numbers it moved between.
 * @throws If the file does not contain exactly one `versionCode` declaration.
 */
export function bumpGradleVersionCode(content: string): {
  content: string;
  from: number;
  to: number;
} {
  const declaration = /^([ \t]*)versionCode([ \t]+)(\d+)[ \t]*$/gm;
  const matches = [...content.matchAll(declaration)];
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one versionCode declaration, found ${matches.length}. ` +
        `Step it by hand and fix this script — Play only reports a duplicate at upload.`
    );
  }
  const [line, indent, gap, digits] = matches[0];
  const from = Number.parseInt(digits, 10);
  const to = from + 1;
  return {
    content: content.replace(line, `${indent}versionCode${gap}${to}`),
    from,
    to,
  };
}

/** Steps the `versionCode` in each Wear module on disk, logging each move. */
function bumpWearVersionCodes(): void {
  for (const file of WEAR_GRADLE_FILES) {
    const { content, from, to } = bumpGradleVersionCode(readFileSync(file, 'utf8'));
    writeFileSync(file, content);
    log(`updated ${file}: versionCode ${from} -> ${to}`, 'green');
  }
}

/**
 * Moves `[Unreleased]` into a dated section for the new version and opens a fresh one.
 *
 * Pure so it can be reasoned about without touching the disk.
 *
 * @param content - The current changelog.
 * @param newVersion - The version being released.
 * @param previousVersion - The version it follows, for the compare link.
 * @param date - Release date as `YYYY-MM-DD`.
 * @returns The rewritten changelog.
 * @throws If `[Unreleased]` is missing — the file's shape is a contract, and silently appending
 *   somewhere else would produce a changelog nobody notices is wrong.
 */
export function rollChangelog(
  content: string,
  newVersion: string,
  previousVersion: string,
  date: string
): string {
  if (!/^## \[Unreleased\]/m.test(content)) {
    throw new Error(`${CHANGELOG} has no "## [Unreleased]" section to roll`);
  }

  let updated = content.replace(
    /^## \[Unreleased\]/m,
    `## [Unreleased]\n\n### Added\n\n### Changed\n\n### Fixed\n\n## [${newVersion}] - ${date}`
  );

  // Retarget the Unreleased compare link at the new tag, and add a link for the released version.
  const unreleasedLink = /^\[Unreleased\]: (.+?)\/compare\/release\/v(.+?)\.\.\.HEAD$/m;
  const match = updated.match(unreleasedLink);
  if (match) {
    const repoUrl = match[1];
    updated = updated.replace(
      unreleasedLink,
      `[Unreleased]: ${repoUrl}/compare/release/v${newVersion}...HEAD\n` +
        `[${newVersion}]: ${repoUrl}/compare/release/v${previousVersion}...release/v${newVersion}`
    );
  } else {
    log(`warning: no [Unreleased] compare link found in ${CHANGELOG}; add ${newVersion}'s link by hand`, 'yellow');
  }

  return updated;
}

/** Stops the bump unless we are on `main`. */
function ensureOnMain(): void {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch.ok) throw new Error('not a git repository, or git is unavailable');
  if (branch.out !== 'main') {
    throw new Error(`version bumps happen on main. You are on ${branch.out}.`);
  }
}

/**
 * Stops the bump if the files we are about to stage already carry uncommitted edits, so the version
 * commit never quietly contains someone else's work.
 */
function ensureOwnedFilesClean(): void {
  const status = git(['status', '--porcelain', '--', ...OWNED_FILES]);
  if (!status.ok) throw new Error(`git status failed: ${status.err}`);
  if (status.out !== '') {
    throw new Error(
      `these files have uncommitted changes and would be swept into the version commit:\n` +
        `${status.out}\n\nCommit or stash them first.`
    );
  }
}

/** Stops the bump if the tag already exists, locally or on the remote. */
function ensureTagFree(tag: string): void {
  if (git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]).ok) {
    throw new Error(`tag ${tag} already exists locally`);
  }
  const remote = git(['ls-remote', '--tags', 'origin', tag]);
  if (remote.ok && remote.out !== '') {
    throw new Error(`tag ${tag} already exists on origin`);
  }
}

/** Runs lint + typecheck + tests. A tag should never point at a red tree. */
function runReleaseChecks(): void {
  log('running pre-release checks (lint, typecheck, test)...', 'blue');
  const result = spawnSync('bun', ['run', 'pre-release'], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(
      'pre-release checks failed. Nothing was committed and no tag was created. Fix them, or re-run ' +
        'with --skip-checks if you have already run them yourself.'
    );
  }
  log('checks passed', 'green');
}

/**
 * Commits the version files, tags the release and pushes both.
 *
 * @param newVersion - The version being released.
 * @param tag - The tag name to create.
 */
function commitTagAndPush(newVersion: string, tag: string): void {
  const stage = git(['add', ...OWNED_FILES]);
  if (!stage.ok) throw new Error(`failed to stage: ${stage.err}`);

  const commit = git(['commit', '-m', `Bump version to ${newVersion}`]);
  if (!commit.ok) throw new Error(`failed to commit: ${commit.err}`);
  log('committed', 'green');

  const tagged = git(['tag', tag]);
  if (!tagged.ok) throw new Error(`failed to tag: ${tagged.err}`);
  log(`tagged ${tag}`, 'green');

  const pushCommit = git(['push']);
  if (!pushCommit.ok) {
    throw new Error(
      `failed to push the commit: ${pushCommit.err}\n` +
        `The commit and tag exist locally. Push them with: git push && git push origin ${tag}`
    );
  }
  log('pushed commit', 'green');

  const pushTag = git(['push', 'origin', tag]);
  if (!pushTag.ok) {
    throw new Error(
      `failed to push the tag: ${pushTag.err}\nPush it with: git push origin ${tag}`
    );
  }
  log('pushed tag', 'green');
}

function usage(): void {
  log('Simple Prayer — version bump', 'bold');
  log('');
  log('  bun run version:bump [major|minor|patch] [--skip-checks]', 'cyan');
  log('');
  log('  patch   1.0.2 -> 1.0.3     minor   1.0.2 -> 1.1.0     major   1.0.2 -> 2.0.0', 'cyan');
  log('');
  try {
    log(`Current version: ${appJsonVersion()}`, 'yellow');
  } catch {
    log('Current version: could not be read from app.json', 'red');
  }
}

/**
 * How far the bump got before it threw. The recovery advice is wrong if it does not know this: a
 * failure during the push has already created a commit and a tag, and telling someone "nothing was
 * tagged" there sends them looking in the wrong place.
 */
type Progress = 'nothing-written' | 'files-rewritten' | 'committed';

function main(): void {
  let progress: Progress = 'nothing-written';
  const args = process.argv.slice(2);
  const skipChecks = args.includes('--skip-checks');
  const bumpType = args.find((arg) => !arg.startsWith('--'));

  if (bumpType === undefined) {
    usage();
    process.exit(0);
  }
  if (bumpType !== 'major' && bumpType !== 'minor' && bumpType !== 'patch') {
    log(`Unknown bump type: ${bumpType}. Use major, minor or patch.`, 'red');
    process.exit(1);
  }

  try {
    ensureOnMain();
    ensureOwnedFilesClean();

    const currentVersion = appJsonVersion();
    const mirrored = packageJsonVersion();
    if (mirrored !== currentVersion) {
      throw new Error(
        `app.json says ${currentVersion} but package.json says ${mirrored}. ` +
          `Make them agree first — picking one silently would hide whichever is wrong.`
      );
    }

    const newVersion = bumpVersion(currentVersion, bumpType);
    const tag = `release/v${newVersion}`;
    ensureTagFree(tag);

    log(`${currentVersion} -> ${newVersion}`, 'cyan');
    log('');

    progress = 'files-rewritten';
    updateVersionInFile('app.json', 'expo.version', newVersion);
    updateVersionInFile('package.json', 'version', newVersion);
    // Both Wear modules carry their own hardcoded counter; EAS's remote one never reaches them.
    bumpWearVersionCodes();

    const date = new Date().toISOString().slice(0, 10);
    writeFileSync(
      CHANGELOG,
      rollChangelog(readFileSync(CHANGELOG, 'utf8'), newVersion, currentVersion, date)
    );
    log(`updated ${CHANGELOG}: released ${newVersion} (${date})`, 'green');
    log('');

    if (skipChecks) {
      log('skipping pre-release checks (--skip-checks)', 'yellow');
    } else {
      runReleaseChecks();
    }
    log('');

    progress = 'committed';
    commitTagAndPush(newVersion, tag);

    log('');
    log(`Released ${newVersion}.`, 'green');
    log('');
    log('Next: bun run release        (builds and submits both platforms)', 'yellow');
  } catch (error) {
    log('');
    log(`Version bump failed: ${(error as Error).message}`, 'red');
    log('');
    if (progress === 'nothing-written') {
      log('Nothing was changed.', 'yellow');
    } else if (progress === 'files-rewritten') {
      log('No commit and no tag were made, but the version files were already rewritten.', 'yellow');
      log(`Undo them with: git checkout -- ${OWNED_FILES.join(' ')}`, 'yellow');
    } else {
      log('The commit and/or tag were already created — see the message above for how to', 'yellow');
      log('finish, and do NOT re-run the bump, which would move the version a second time.', 'yellow');
    }
    process.exit(1);
  }
}

// Only when run as a script. Without this guard, importing the pure helpers from a test would
// execute a real version bump.
if (process.argv[1]?.endsWith('bump-version.ts') === true) {
  main();
}
