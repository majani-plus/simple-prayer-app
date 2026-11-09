/**
 * The FOSS build's adhan voices: the free set (`assets/audio/CREDITS.md`, "The free set").
 *
 * metro.config.js swaps `domain/adhanVoiceSet` and `hooks/adhanAssets` for their `src/foss/`
 * versions when `FOSS_BUILD=1`. Jest runs the normal build, so this file does the swap itself with
 * `jest.mock` and checks that everything downstream follows: the voice list, the files, the
 * notification sounds, the names on screen and the credit.
 */
import { render, screen } from '@testing-library/react-native';
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

import { freeAdhanSounds } from '../../app.config';
import AboutScreen from '../app/settings/about';
import {
  ADHAN_VOICES,
  DEFAULT_ADHAN_VOICE,
  FREE_ADHAN_VOICES,
  adhanSoundFile,
  allAdhanSoundFiles,
  isAdhanVoice,
} from '../domain/adhanVoices';
import { initI18n } from '../i18n';

jest.mock('../domain/adhanVoiceSet', () => ({ ADHAN_VOICE_SET: 'free' }));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
    replace: jest.fn(),
  }),
}));

const ROOT = resolve(__dirname, '..', '..');
const LOCALES = ['en', 'ar', 'tr', 'ur'] as const;

function locale(lang: string): {
  settings: {
    reminders: { voice: Record<string, string> };
    about: { audio: Record<string, string> };
  };
} {
  return JSON.parse(readFileSync(join(ROOT, 'src/i18n/locales', `${lang}.json`), 'utf8'));
}

describe('the free voice set', () => {
  it('is what the app offers once the set is swapped', () => {
    expect(ADHAN_VOICES).toEqual(FREE_ADHAN_VOICES);
    expect(FREE_ADHAN_VOICES).toContain(DEFAULT_ADHAN_VOICE);
    expect(isAdhanVoice('menk')).toBe(false);
    expect(isAdhanVoice('istanbul')).toBe(true);
  });

  it('plays only files from assets/audio/free, on every platform', () => {
    for (const voice of ADHAN_VOICES) {
      for (const platform of ['android', 'ios', 'other'] as const) {
        const file = adhanSoundFile(voice, platform);
        expect({ voice, file, exists: existsSync(join(ROOT, 'assets/audio/free', file)) }).toEqual({
          voice,
          file: expect.stringMatching(/^adhan_free_[a-z]+\.mp3$/) as unknown as string,
          exists: true,
        });
      }
    }
  });

  it('a voice from the other set falls back to the default rather than to a missing file', () => {
    expect(adhanSoundFile('menk', 'android')).toBe(adhanSoundFile(DEFAULT_ADHAN_VOICE, 'android'));
  });

  it('is exactly the notification sounds the FOSS config bundles', () => {
    expect(
      freeAdhanSounds()
        .map((path) => basename(path))
        .sort()
    ).toEqual(allAdhanSoundFiles().sort());
  });

  it('has legal Android resource names (lowercase, digits, underscores)', () => {
    for (const file of allAdhanSoundFiles()) {
      expect(basename(file, extname(file))).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('is bundled by the FOSS asset table, one static require per file', () => {
    const source = readFileSync(join(__dirname, 'adhanAssets.ts'), 'utf8');
    for (const file of allAdhanSoundFiles()) {
      expect(source).toContain(`'${file}': require('../../assets/audio/free/${file}')`);
    }
    // And none of the standard recordings, which F-Droid would not accept.
    expect(source).not.toMatch(/assets\/audio\/adhan_/);
  });

  it('says how many there are, in every language', () => {
    const counts = { en: 'Three', ar: 'ثلاثة', tr: 'Üç', ur: 'تین' };
    expect(ADHAN_VOICES).toHaveLength(3);
    for (const lang of LOCALES) {
      expect(locale(lang).settings.reminders.voice.descriptionFree).toContain(counts[lang]);
    }
  });

  it('has a name in every language', () => {
    for (const lang of LOCALES) {
      for (const voice of ADHAN_VOICES) {
        expect({ lang, voice, name: locale(lang).settings.reminders.voice[voice] }).toEqual({
          lang,
          voice,
          name: expect.any(String) as unknown as string,
        });
      }
    }
  });
});

describe('the credit for the free set', () => {
  /**
   * CC BY requires the author and the licence. The names are Latin script in every language,
   * because they are Commons user names.
   */
  it('names the CC BY author and the licences in every language', () => {
    for (const lang of LOCALES) {
      const text = locale(lang).settings.about.audio.attributionFree;
      for (const required of ['Seyfula Islam', 'CC BY 3.0', 'CC0']) {
        expect({ lang, required, present: text.includes(required) }).toEqual({
          lang,
          required,
          present: true,
        });
      }
    }
  });

  it('is the sentence assets/audio/CREDITS.md specifies, and the About screen shows it', async () => {
    const credits = readFileSync(join(ROOT, 'assets/audio/CREDITS.md'), 'utf8');
    const start = credits.indexOf("### Attribution string for the FOSS build's About screen");
    expect(start).toBeGreaterThanOrEqual(0);
    const quote = credits
      .slice(start)
      .split('\n\n')[1]
      .split('\n')
      .map((line) => line.replace(/^>\s?/, ''))
      .join(' ');

    initI18n();
    await render(<AboutScreen />);
    expect(screen.getByText(quote)).toBeTruthy();
    expect(locale('en').settings.about.audio.attributionFree).toBe(quote);
  });
});
