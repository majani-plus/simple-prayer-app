import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Card } from './Card';
import { Icon } from './Icon';
import { sentryDsn } from '@/services/telemetry';
import { spacing, useTheme } from '@/theme';

/**
 * The pledge (decision D31): no ads, no account, no tracking, and the log stays on the phone.
 *
 * This is the single strongest line the market research turned up, and the reason it works is
 * that it is *unusual to be true*. 55–75% of critical reviews at the big prayer apps are about
 * ads, and the sharpest ones are about content — gambling and dating ads during dhikr, music
 * auto-playing at Fajr — while the category's other running sore is the Muslim Pro location-data
 * scandal, still driving switching six years on (our market research).
 *
 * So the card is written to be **checkable rather than persuasive**. Four flat statements, no
 * adjectives, no exclamation mark, no badge, no gold seal: the design's quietest surface, the
 * plainest wording that is exactly true, and one footnote naming the single thing that does leave
 * the phone — the **city lookup**. That is both directions of it: the name you type
 * (`searchCity` → `geocodeAsync`) *and* your approximate position when you use the device's
 * location (`resolveAutoLocation` → `reverseGeocodeAsync`), because `CLGeocoder` and Android's
 * `Geocoder` are network services. Naming only the typed name would be the more flattering
 * sentence and the false one — and auto location is the default, so the flattering version would
 * be wrong for most users. Overselling a privacy claim is how privacy claims stop being believed;
 * a footnote nobody forced us to write is what makes the four lines above it credible.
 *
 * Every clause is verifiable against the code: there is no ad SDK and no analytics SDK anywhere in
 * `package.json`, no account system and no network client of our own (`src/services/*` talks to
 * the OS and nothing else — the geocoder included, which is why the footnote says "your phone
 * asks" rather than "we ask"), the log lives in on-device SQLite (`src/db`) and the settings in
 * on-device MMKV. If any of that ever stops being true, this card is the first thing that has to
 * change — and `src/__tests__/privacyClaims.test.ts` is what makes that a failing test rather than
 * a good intention.
 *
 * ## The one clause with an expiry date on it
 *
 * "The one thing that ever leaves it is the city lookup" is true of the app **as it ships**, and
 * only because the tip jar is switched off: `react-native-purchases` is in `package.json`, and
 * a purchase talks to RevenueCat's servers, which are neither this phone nor its map service.
 * Switching tipping on is a key pasted into `app.json` (`docs/TIP_JAR_RUNBOOK.md`) — a release
 * whose diff contains no copy change at all — so the coupling is enforced by a test rather than
 * by remembering: `privacyClaims.test.ts` → "the pledge and the tip jar" demands that the footnote
 * name the purchase path in every language the day a RevenueCat key appears.
 *
 * Rendered in two places, hence `framed`: as its own card on the About screen, and unframed as a
 * row inside the Settings → Support group, which already draws the card around it.
 */

/** The pledge lines, in order; each names a `settings.pledge.points.*` key. */
export const PLEDGE_POINTS = ['ads', 'account', 'tracking', 'device'] as const;
export type PledgePoint = (typeof PLEDGE_POINTS)[number];

export interface PledgeCardProps {
  /**
   * Draws the paper card around the content. Defaults to `true`; pass `false` when the parent
   * (a `SettingGroup`) is already a card.
   */
  framed?: boolean;
  /** Hides the map-service footnote. Only for a context that has already said it. */
  showFootnote?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The "no ads, ever" pledge.
 *
 * @param framed - Whether to draw the card (default `true`).
 * @returns A quiet block of four statements and their caveat.
 */
export function PledgeCard({
  framed = true,
  showFootnote = true,
  style,
  testID = 'pledge-card',
}: PledgeCardProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const title = t('settings.pledge.title');
  // Spelled out rather than mapped over PLEDGE_POINTS so every key is a literal the locale
  // guard's scanner can see (`src/i18n/__tests__/locales.test.ts`).
  const points = [
    t('settings.pledge.points.ads'),
    t('settings.pledge.points.account'),
    t('settings.pledge.points.tracking'),
    t('settings.pledge.points.device'),
  ];
  // A build with no Sentry DSN (FOSS, a fork) sends no crash reports, so it must not claim to.
  const footnote = !showFootnote
    ? undefined
    : sentryDsn() === null
      ? t('settings.pledge.footnoteWithoutCrashReports')
      : t('settings.pledge.footnote');

  // Read as one paragraph rather than six separate stops: it is a single statement, and a
  // screen-reader user should not have to swipe through it a line at a time to get the point.
  // The props go on whichever element carries the testID, framed or not, so the announcement is
  // the same in both placements.
  const a11y = {
    accessible: true,
    accessibilityRole: 'summary' as const,
    accessibilityLabel: [title, ...points, footnote].filter(Boolean).join('. '),
  };

  const content = (
    <View style={{ gap: spacing.sm }}>
      <AppText variant="rowName" weight={600} tone="strong">
        {title}
      </AppText>

      <View style={{ gap: spacing.xs }}>
        {points.map((point) => (
          <View
            key={point}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}
          >
            {/* Decorative: the sentence beside it carries the whole meaning. */}
            <Icon name="check" size={14} color={colors.accent} style={{ marginTop: 3 }} />
            <AppText variant="caption" tone="muted" style={{ flex: 1 }}>
              {point}
            </AppText>
          </View>
        ))}
      </View>

      {footnote === undefined ? null : (
        <AppText variant="hint" style={{ marginTop: spacing.xs }}>
          {footnote}
        </AppText>
      )}
    </View>
  );

  if (!framed) {
    return (
      <View
        testID={testID}
        {...a11y}
        style={[{ paddingVertical: spacing.md, paddingHorizontal: spacing.lg }, style]}
      >
        {content}
      </View>
    );
  }

  return (
    <Card
      testID={testID}
      {...a11y}
      variant="quiet"
      border="faint"
      style={[{ padding: spacing.lg }, style]}
    >
      {content}
    </Card>
  );
}
