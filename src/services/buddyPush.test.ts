/**
 * The words a buddy's phone is sent — the only part of buddy mode that one phone writes for
 * another, so the only part where getting it wrong shows up on somebody else's lock screen.
 */

import { Platform } from 'react-native';

import {
  BUDDY_CHANNEL_ID,
  composeBuddyNotification,
  configureBuddyNotifications,
  getBuddyPushToken,
  LEGACY_BUDDY_CHANNEL_ID,
  PUSH_TOKEN_TIMEOUT_MS,
} from './buddyPush';
import i18n, { initI18n } from '@/i18n';

const mockGetExpoPushToken = jest.fn();
const mockSetChannel = jest.fn(async () => null);
const mockDeleteChannel = jest.fn(async () => undefined);
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: async () => ({ status: 'granted' }),
  getExpoPushTokenAsync: () => mockGetExpoPushToken(),
  setNotificationChannelAsync: (...args: unknown[]) => mockSetChannel(...(args as [])),
  deleteNotificationChannelAsync: (...args: unknown[]) => mockDeleteChannel(...(args as [])),
  AndroidImportance: { LOW: 2, DEFAULT: 3, HIGH: 4 },
}));

beforeAll(() => {
  initI18n();
});

const LANGUAGES = ['en', 'ar', 'tr'] as const;

/** Render as the sender does: a fixed translator for the *receiver's* language. */
function compose(lang: string) {
  const translate = i18n.getFixedT(lang);
  return composeBuddyNotification((key, values) => String(translate(key, values as never)), 'maghrib');
}

describe('what a buddy is told', () => {
  it('says who prayed what, in one line', () => {
    const text = compose('en');
    // Isolates around the interpolated values are the formatter's doing and are stripped here so
    // the claim reads as a sentence; the next test is about the isolates themselves.
    const plain = (value: string) => value.replace(/[\u2066-\u2069]/g, '');
    expect(plain(text.title)).toBe('Your buddy prayed Maghrib');
    expect(plain(text.titleNamed)).toBe('{} prayed Maghrib');
  });

  it.each(LANGUAGES)('carries a plain sentence and a named one in %s', (lang) => {
    const text = compose(lang);
    expect(text.title.length).toBeGreaterThan(0);
    expect(text.titleNamed).toContain('{}');
    expect(text.title).not.toContain('{}');
  });

  it.each(LANGUAGES)('stays inside what the relay will carry (%s)', (lang) => {
    // The relay refuses control characters and every format character EXCEPT the four bidi
    // isolates (U+2066–U+2069), and caps a title at 80. The isolates are allowed precisely so that
    // this sentence can be built with ordinary interpolation: the prayer name and the nickname hole
    // are both values, and `i18n/formatter.ts` isolates every value so a Latin name inside an
    // Arabic sentence keeps its place.
    const text = compose(lang);
    const forbidden = /[\p{Cc}]|(?![\u2066-\u2069])\p{Cf}/u;

    expect(text.title).not.toMatch(forbidden);
    expect(text.titleNamed).not.toMatch(forbidden);
    expect(text.title.length).toBeLessThanOrEqual(80);
    expect(text.titleNamed.length).toBeLessThanOrEqual(80);
  });
});

describe('asking for a push token (D194)', () => {
  it('answers with the token when Expo gives one', async () => {
    mockGetExpoPushToken.mockResolvedValueOnce({ data: 'ExponentPushToken[abc]' });
    await expect(getBuddyPushToken()).resolves.toBe('ExponentPushToken[abc]');
  });

  it('gives up after eight seconds rather than waiting for ever', async () => {
    // Native registration plus a fetch with no timeout of its own: before this, a hang here held
    // every buddy sync — and every mark behind it — until the app was killed.
    jest.useFakeTimers();
    try {
      mockGetExpoPushToken.mockReturnValueOnce(new Promise(() => undefined));
      const token = getBuddyPushToken();
      await jest.advanceTimersByTimeAsync(PUSH_TOKEN_TIMEOUT_MS + 1);
      await expect(token).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the Android buddy channel (D196)', () => {
  const realOS = Platform.OS;
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    mockSetChannel.mockClear();
    mockDeleteChannel.mockClear();
  });
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: realOS, configurable: true });
  });

  it('is a new, HIGH-importance channel that stays silent, and retires the LOW one', async () => {
    await configureBuddyNotifications({ channelName: 'Buddies', channelDescription: 'd' });

    expect(BUDDY_CHANNEL_ID).not.toBe(LEGACY_BUDDY_CHANNEL_ID);
    expect(mockSetChannel).toHaveBeenCalledWith(
      BUDDY_CHANNEL_ID,
      expect.objectContaining({ importance: 4, sound: null, enableVibrate: false })
    );
    expect(mockDeleteChannel).toHaveBeenCalledWith(LEGACY_BUDDY_CHANNEL_ID);
  });
});

