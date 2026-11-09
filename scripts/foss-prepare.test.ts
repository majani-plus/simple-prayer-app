/**
 * Tests for the pure half of `foss-prepare`, plus the one check that matters before any FOSS build:
 * the expo-notifications patch still applies to the installed version.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

import packageJson from '../package.json';
import {
  FOSS_ANDROID_EXCLUDE,
  nonFreePaths,
  withFossAutolinking,
  withoutDependencies,
} from './foss-prepare';

const ROOT = resolve(__dirname, '..');

describe('autolinking', () => {
  it('the normal build links expo-location and leaves out only foss-location', () => {
    expect(packageJson.expo.autolinking.android.exclude).toEqual(['foss-location']);
  });

  it('the FOSS build leaves out every Google-backed module, links foss-location, keeps the rest', () => {
    const foss = withFossAutolinking(packageJson);
    expect(foss.expo?.autolinking?.android?.exclude).toEqual([...FOSS_ANDROID_EXCLUDE]);
    expect(foss.expo?.autolinking?.android?.exclude).not.toContain('foss-location');
    expect(foss.expo?.autolinking?.buildFromSource).toEqual(['expo-notifications']);
    expect({ ...foss, expo: undefined }).toEqual({ ...packageJson, expo: undefined });
    // Repeatable.
    expect(withFossAutolinking(foss)).toEqual(foss);
  });

  it('excludes natively every package metro.config.js stubs in JavaScript', () => {
    const metro = readFileSync(join(ROOT, 'metro.config.js'), 'utf8');
    const stubbed = [...metro.matchAll(/'([@\w/.-]+)': foss\(/g)].map((m) => m[1]);
    expect(stubbed.length).toBeGreaterThan(0);
    for (const pkg of stubbed) expect(FOSS_ANDROID_EXCLUDE).toContain(pkg);
  });
});

describe('buddy-nicknames', () => {
  it('drops the Firebase dependency block and nothing else', () => {
    const gradle = readFileSync(join(ROOT, 'modules/buddy-nicknames/android/build.gradle'), 'utf8');
    expect(gradle).toContain('firebase-messaging');
    const foss = withoutDependencies(gradle);
    expect(foss).not.toMatch(/firebase|dependencies/);
    expect(foss).toContain('namespace "expo.modules.buddynicknames"');
    expect(withoutDependencies(foss)).toBe(foss);
  });
});

describe('non-free files', () => {
  it('lists the four unlicensed recordings and their clips, and never the free set', () => {
    const paths = nonFreePaths(ROOT);
    const audio = paths.filter((p) => p.startsWith('assets/audio/'));
    expect(audio).toHaveLength(8);
    expect(audio.every((p) => /^assets\/audio\/adhan_[a-z]+(_clip)?\.(mp3|caf)$/.test(p))).toBe(
      true
    );
    expect(paths).toEqual(expect.arrayContaining(['wear', 'wear-face', 'google-services.json']));
  });
});

describe('the expo-notifications FOSS patch', () => {
  it('applies to the installed expo-notifications', () => {
    // Throws, with git's reason, when an upgrade or a change to the bun patch breaks it.
    expect(() =>
      execFileSync(
        'git',
        [
          'apply',
          '--check',
          '-p1',
          '--directory=node_modules/expo-notifications',
          'patches/foss/expo-notifications@58.1.7.patch',
        ],
        { cwd: ROOT, stdio: 'pipe' }
      )
    ).not.toThrow();
  });

  it('removes the Firebase dependency and the FCM service', () => {
    const patch = readFileSync(join(ROOT, 'patches/foss/expo-notifications@58.1.7.patch'), 'utf8');
    expect(patch).toMatch(/^-\s+implementation 'com\.google\.firebase:firebase-messaging/m);
    expect(patch).toMatch(/^-\s+android:name="\.service\.ExpoFirebaseMessagingService"/m);
    expect(patch).not.toMatch(/^\+.*import com\.google\.firebase/m);
  });
});
