/**
 * Screen test for Settings → About (`src/app/settings/about.tsx`).
 *
 * Most of this screen is credits, and credits are the kind of thing that rots quietly: someone
 * re-encodes the adhan clip, someone else rewrites a sentence, and a month later the app is
 * shipping an attribution that no longer describes the file it ships. So the load-bearing test
 * here reads `assets/audio/CREDITS.md` — the licence record itself — and fails if the English
 * string on screen has drifted from the one that document specifies (decision D36). The
 * dedication is CC0 and imposes no attribution duty; showing it is a promise we made ourselves,
 * and this is what keeps it.
 *
 * The rest covers the things a user can act on: the version line, the two credit links, the
 * website, and "Rate the app" — which must be a store deep link and never `expo-store-review`
 * (PRODUCT_SPEC §13).
 *
 * This file lives outside `src/app/` because every file under the router root becomes a route.
 */

import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Linking } from 'react-native';

import AboutScreen from '../app/settings/about';
import { ADHAN_VOICES } from '../domain/adhanVoices';
import type { AdhanVoice } from '../domain/types';
import { initI18n } from '../i18n';
import { APP_WEBSITE_URL, BUNDLED_FONTS, FEEDBACK_URL } from '../services/appInfo';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: mockBack,
    canGoBack: () => true,
    replace: mockReplace,
  }),
}));

/**
 * The attribution sentence exactly as `assets/audio/CREDITS.md` specifies it.
 *
 * Pulled out of the document rather than copied into this file, so the test cannot drift with the
 * screen: the blockquote under "Attribution string for the About screen" is the single source of
 * truth for both.
 */
function attributionFromCredits(): string {
  const credits = readFileSync(
    join(__dirname, '..', '..', 'assets', 'audio', 'CREDITS.md'),
    'utf8'
  );
  const heading = credits.indexOf('### Attribution string for the About screen');
  expect(heading).toBeGreaterThanOrEqual(0);

  const lines = credits.slice(heading).split('\n');
  const quote: string[] = [];
  for (const line of lines) {
    if (line.startsWith('>')) {
      quote.push(line.replace(/^>\s?/, '').trim());
      continue;
    }
    // The first blockquote is the long form; stop at the blank line that ends it.
    if (quote.length > 0) break;
  }
  expect(quote.length).toBeGreaterThan(0);
  return quote.join(' ').replaceAll(/\s+/g, ' ').trim();
}

/**
 * The reciters, as each bundle must name them. Written out here rather than read from the locale
 * files: a test that took its expectation from the same file it is checking would pass however
 * badly that file was edited.
 */
const NAMES: Record<'en' | 'ar', Record<AdhanVoice, string>> = {
  en: {
    makkah: 'Makkah',
    alqatami: 'Nasser Alqatami',
    menk: 'Mufti Ismail Musa Menk',
    fakhry: 'Sabah Fakhri',
    istanbul: 'Istanbul',
    beautiful: 'Beautiful adhan',
  },
  ar: {
    makkah: 'مكة',
    alqatami: 'ناصر القطامي',
    menk: 'مفتي إسماعيل موسى منك',
    fakhry: 'صباح فخري',
    istanbul: 'إسطنبول',
    beautiful: 'أذان جميل',
  },
};

let openUrl: jest.SpyInstance;

beforeAll(() => {
  initI18n();
});

beforeEach(async () => {
  mockBack.mockClear();
  mockReplace.mockClear();
  openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await initI18n().changeLanguage('en');
});

afterEach(() => {
  openUrl.mockRestore();
});

describe('the adhan attribution', () => {
  it('shows the exact sentence assets/audio/CREDITS.md specifies', async () => {
    await render(<AboutScreen />);

    expect(screen.getByText(attributionFromCredits())).toBeTruthy();
  });

  it('names every reciter the app ships, because names are the whole of the credit', async () => {
    await render(<AboutScreen />);

    // There is no licence page and no dedication to link to for these four (CREDITS.md records
    // why), so the sentence itself is the attribution — and it is worthless if it omits one of
    // them. Driven off the domain list, so shipping a fifth recitation fails here rather than
    // silently going uncredited.
    const row = within(screen.getByTestId('about-audio-attribution'));
    for (const voice of ADHAN_VOICES) {
      expect(row.getByText(new RegExp(NAMES.en[voice]))).toBeTruthy();
    }
  });

  it('translates the sentence rather than dropping it, and keeps the names', async () => {
    await initI18n().changeLanguage('ar');
    await render(<AboutScreen />);

    // Arabic prose, with the reciters' names in Arabic script — the same names written properly,
    // not translations of them, and not transliterations a reader could not check.
    const row = within(screen.getByTestId('about-audio-attribution'));
    for (const voice of ADHAN_VOICES) {
      expect(row.getByText(new RegExp(NAMES.ar[voice]))).toBeTruthy();
    }
  });
});

describe('the typeface credits', () => {
  it('names every bundled family and who made it', async () => {
    await render(<AboutScreen />);

    for (const font of BUNDLED_FONTS) {
      expect(screen.getByText(font.name)).toBeTruthy();
      // One author can make several families (the Noto Project made both Arabic-script faces).
      expect(screen.getAllByText(font.author).length).toBeGreaterThan(0);
    }
  });

  it('states the licences the fonts are used under', async () => {
    await render(<AboutScreen />);

    expect(screen.getByText(/SIL Open Font License 1\.1/)).toBeTruthy();
    expect(screen.getByText(/Apache License 2\.0/)).toBeTruthy();
  });
});

describe('identity', () => {
  it('names the app and states a version', async () => {
    await render(<AboutScreen />);

    expect(screen.getByText('Simple Prayer')).toBeTruthy();
    // The exact number comes from app.json via expo-constants; what matters is that the line is
    // there and is not the "unavailable" fallback in a build that knows its own version.
    expect(screen.getByTestId('about-version').props.children).toBeTruthy();
  });
});

describe('the links out', () => {
  it('opens the website', async () => {
    await render(<AboutScreen />);

    // Shown as a place, not a URL.
    expect(screen.getByText('simpleprayer.app')).toBeTruthy();

    // …and opened at the page the row's own description promises ("Support and the privacy
    // policy"), not at the site root, which is a landing page for people who do not have the app.
    await fireEvent.press(screen.getByTestId('about-website'));
    expect(openUrl).toHaveBeenCalledWith(`${APP_WEBSITE_URL}/support`);
  });

  it('links to the source code, so anyone can build and copy the app', async () => {
    await render(<AboutScreen />);

    expect(screen.getByText('Source code')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('about-source'));
    expect(openUrl).toHaveBeenCalledWith('https://github.com/majani-plus/simple-prayer-app');
  });

  it('carries the feedback row too, because this is the other screen people hunt on', async () => {
    // Deliberate duplication, matching "Rate the app", which has lived in both places all along
    // (D87). Someone looking for a way to reach the developer tries Settings, then About; neither
    // is the wrong guess, so neither is a dead end.
    await render(<AboutScreen />);

    expect(screen.getByTestId('about-feedback')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('about-feedback'));
    expect(openUrl).toHaveBeenCalledWith(FEEDBACK_URL);
  });

  it('says so when the device cannot open a link, instead of doing nothing', async () => {
    openUrl.mockRejectedValueOnce(new Error('no browser'));
    await render(<AboutScreen />);

    await fireEvent.press(screen.getByTestId('about-website'));

    expect(await screen.findByTestId('about-link-failed')).toBeTruthy();
  });

  it('carries a rate row that is a plain link, never the in-app review API', async () => {
    await render(<AboutScreen />);

    expect(screen.getByTestId('about-rate')).toBeTruthy();
    // Neither this screen nor the row itself may *import* expo-store-review: the OS review prompt
    // has a quota of three a year and it is not a button's to spend (PRODUCT_SPEC §13). Mentioning
    // the module in a comment explaining why is fine; depending on it is not.
    const forbidden = /from\s*['"]expo-store-review['"]|require\(\s*['"]expo-store-review['"]/;
    for (const file of [
      join(__dirname, '..', 'app', 'settings', 'about.tsx'),
      join(__dirname, '..', 'components', 'RateAppRow.tsx'),
    ]) {
      expect(readFileSync(file, 'utf8')).not.toMatch(forbidden);
    }
  });

  it('goes back', async () => {
    await render(<AboutScreen />);
    await fireEvent.press(screen.getByTestId('about-back'));

    expect(mockBack).toHaveBeenCalled();
  });
});
