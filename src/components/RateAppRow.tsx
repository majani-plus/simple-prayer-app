import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform } from 'react-native';

import { SettingRow } from './SettingRow';
import { storeReviewUrl } from '@/services/appInfo';

/**
 * Settings → Support: "Rate the app".
 *
 * The important thing about this row is what it does **not** do. `expo-store-review` opens the
 * native in-app review sheet, and the OS enforces a quota on it — three prompts per user per year
 * on iOS, an unspecified but real one on Android — which a button would silently burn on someone
 * who was going to leave a review anyway. Google's policy goes further and forbids attaching any
 * call-to-action to that API at all. So a row the user *chose* to press opens the store's own
 * write-a-review page instead (PRODUCT_SPEC §13, our market research). The in-app API is
 * reserved for the behavioural triggers arriving in M9 — a different code path, in a different
 * module, that no button will ever be wired to.
 *
 * Two honest edge cases, both visible rather than hidden:
 *
 * - **No listing yet.** Until the app has an App Store id (`appInfo.IOS_APP_STORE_ID`, set in
 *   M10), there is nowhere to send an iOS user, so the row is *shown but inert*, saying so. A row
 *   that vanishes looks like a bug; a row that opens a broken link is one.
 * - **No store app.** `market://` only resolves where the Play Store exists, so a failure falls
 *   back to the https listing, and a second failure says so in the row rather than doing nothing.
 */

export interface RateAppRowProps {
  /** Overridden by tests; defaults to the running platform. */
  platform?: string;
  /** Overridden by tests; defaults to `Linking.openURL`. */
  openUrl?: (url: string) => Promise<unknown>;
  testID?: string;
}

/**
 * The "Rate the app" row.
 *
 * @returns A row that opens the platform's store listing, or an inert one explaining why not.
 */
export function RateAppRow({
  platform = Platform.OS,
  openUrl,
  testID = 'settings-row-rate',
}: RateAppRowProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  const target = storeReviewUrl(platform);

  const open = useCallback(async () => {
    if (target === null) return;
    const openWith = openUrl ?? ((url: string) => Linking.openURL(url));
    setFailed(false);
    try {
      await openWith(target.url);
    } catch {
      // `market://` is absent wherever the Play Store is (Huawei, some China ROMs); the https
      // listing opens in a browser there.
      if (target.fallback === undefined) {
        setFailed(true);
        return;
      }
      try {
        await openWith(target.fallback);
      } catch {
        setFailed(true);
      }
    }
  }, [openUrl, target]);

  const description = failed
    ? t('settings.home.support.rate.failed')
    : target === null
      ? t('settings.home.support.rate.unavailable')
      : t('settings.home.support.rate.description');

  return (
    <SettingRow
      testID={testID}
      icon="star"
      label={t('settings.home.support.rate.label')}
      description={description}
      disabled={target === null}
      chevron={target !== null}
      accessibilityRole="button"
      accessibilityHint={t('settings.home.support.rate.a11yHint')}
      onPress={() => {
        void open();
      }}
    />
  );
}
