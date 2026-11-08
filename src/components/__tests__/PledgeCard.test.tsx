/**
 * Tests for `PledgeCard` (decision D31).
 *
 * A privacy pledge is only worth showing if it is checkable, so two of these tests are about
 * *truthfulness* rather than rendering:
 *
 * - every clause is stated in the app's own words and read as one statement by a screen reader,
 *   rather than as five unrelated fragments a user has to swipe through to assemble;
 * - the footnote naming the one thing that does leave the phone is present by default. Dropping it
 *   would make the card read as a bigger claim than the app can honestly make, and overselling is
 *   exactly how privacy claims stop being believed.
 *
 * There is also a guard nobody would think to write until it was too late: the pledge says there
 * are no ads and no analytics, and `package.json` is where that stops being true. If an ad SDK or
 * an analytics SDK is ever added, this suite fails and whoever added it has to come and change
 * the card — which is the conversation that should happen.
 */

import { render, screen } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import { join } from 'path';

import { PLEDGE_POINTS, PledgeCard } from '../PledgeCard';
import { initI18n } from '@/i18n';

// Jest has no app config; stand in for the normal build, which ships a Sentry DSN.
let mockSentryDsn: string | null = 'https://key@o1.ingest.de.sentry.io/1';
jest.mock('@/services/telemetry', () => ({
  ...jest.requireActual('@/services/telemetry'),
  sentryDsn: () => mockSentryDsn,
}));

beforeAll(() => {
  initI18n();
});

beforeEach(async () => {
  await initI18n().changeLanguage('en');
});

describe('PledgeCard', () => {
  it('states all four promises plainly', async () => {
    await render(<PledgeCard />);

    expect(screen.getByText('No ads, ever')).toBeTruthy();
    expect(screen.getByText('No ads. Not now, not later.')).toBeTruthy();
    expect(screen.getByText('No account, no sign-in, no email address.')).toBeTruthy();
    expect(
      screen.getByText('No analytics, no ad trackers, nobody following you across apps.')
    ).toBeTruthy();
    // The device line is qualified since buddy mode (D174), and the qualification is the point:
    // the promise still holds for everyone who has not turned it on, and names the exception for
    // everyone who has, rather than retreating into something vaguer that covers both.
    expect(
      screen.getByText(
        'Your prayer log stays on this phone — unless you add a buddy, and then each prayer you mark is sent to their phone.'
      )
    ).toBeTruthy();
    expect(PLEDGE_POINTS).toHaveLength(4);
  });

  it('owns up to buddy mode in the footnote, and no longer says "three things"', async () => {
    await render(<PledgeCard />);

    // The count is load-bearing: PRODUCT_SPEC §14a once used "exactly three" to kill an in-app
    // feedback form. Buddy mode made it four, so the number had to move with it.
    expect(screen.getByText(/Four things can ever leave this phone/)).toBeTruthy();
    expect(screen.getByText(/only if you add a buddy/)).toBeTruthy();
  });

  it('drops only the crash-report sentence in a build with no Sentry DSN', async () => {
    mockSentryDsn = null;
    try {
      await render(<PledgeCard />);

      expect(screen.getByText(/Three things can ever leave this phone/)).toBeTruthy();
      expect(screen.queryByText(/crash report/i)).toBeNull();
      expect(screen.getByText(/only if you add a buddy/)).toBeTruthy();
    } finally {
      mockSentryDsn = 'https://key@o1.ingest.de.sentry.io/1';
    }
  });

  it('keeps the caveat about the one thing that does leave the phone', async () => {
    await render(<PledgeCard />);

    // A city name typed into the search goes to the phone's own map service. Saying so is what
    // makes the four lines above it credible.
    expect(screen.getByText(/city name you type/)).toBeTruthy();
  });

  it('names the device-position half of the lookup too, not only the typed name', async () => {
    await render(<PledgeCard />);

    // `resolveAutoLocation` reverse-geocodes the coarse fix, so the approximate *position* leaves
    // the phone as well — and auto location is the default. A footnote that mentioned only the
    // typed city name would be the flattering version and the untrue one.
    expect(screen.getByText(/approximate position/)).toBeTruthy();
    expect(screen.getByText(/device.s location/)).toBeTruthy();
  });

  it('can drop the caveat where it has already been said', async () => {
    await render(<PledgeCard showFootnote={false} />);

    expect(screen.queryByText(/city name you type/)).toBeNull();
  });

  it('reads as one statement, not five fragments', async () => {
    await render(<PledgeCard />);

    const card = screen.getByTestId('pledge-card');
    expect(card).toBeTruthy();
    const label = screen.getByLabelText(/No ads, ever/);
    // One node carrying the whole pledge, so VoiceOver announces it in a single pass.
    expect(label.props.accessibilityLabel).toContain('No account');
    expect(label.props.accessibilityLabel).toContain('stays on this phone');
  });

  it('renders unframed for a group that already draws the card', async () => {
    await render(<PledgeCard framed={false} testID="inline-pledge" />);

    // Same words either way; only the surface changes.
    expect(screen.getByTestId('inline-pledge')).toBeTruthy();
    expect(screen.getByText('No ads, ever')).toBeTruthy();
  });

  it('is translated rather than left in English', async () => {
    await initI18n().changeLanguage('tr');
    await render(<PledgeCard />);

    expect(screen.queryByText('No ads, ever')).toBeNull();
    expect(screen.getByTestId('pledge-card')).toBeTruthy();
  });
});

describe('the pledge is still true', () => {
  /** Every dependency the app ships with. */
  const dependencies = Object.keys(
    (
      JSON.parse(
        readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8')
      ) as { dependencies: Record<string, string> }
    ).dependencies
  );

  it('ships no advertising or analytics SDK', () => {
    // Names, not a heuristic: a match here means the card above has become a lie, and the fix is
    // never to quietly soften the wording.
    const forbidden = [
      /^react-native-google-mobile-ads/,
      /^expo-ads/,
      /admob/i,
      /^@react-native-firebase\/analytics/,
      /^@amplitude/,
      /^@segment/,
      /^posthog/,
      /^mixpanel/,
      /^@datadog/,
      /appsflyer/i,
      /^react-native-facebook/,
    ];

    const offenders = dependencies.filter((name) =>
      forbidden.some((pattern) => pattern.test(name))
    );
    expect(offenders).toEqual([]);
  });

  it('ships no telemetry beyond the crash reporter the pledge discloses', () => {
    // `@sentry/react-native` is a crash reporter, not an ad or analytics SDK, and it is allowed
    // here for one reason only: the pledge footnote now names crash reporting, and Settings
    // carries an off switch (D51). privacyClaims.test.ts couples the DSN to that disclosure; this
    // test pins the other direction — no second telemetry SDK arrives without this conversation.
    const telemetry = dependencies.filter((name) =>
      /sentry|crashlytics|bugsnag|instabug/i.test(name)
    );
    expect(telemetry).toEqual(['@sentry/react-native']);
  });

  it('keeps the prayer log in on-device storage', () => {
    // SQLite on the device and MMKV for settings — no client for a backend of ours, because there
    // is no backend of ours.
    expect(dependencies).toContain('expo-sqlite');
    expect(dependencies).toContain('react-native-mmkv');
  });
});
