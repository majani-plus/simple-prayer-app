import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

import { SettingRow } from './SettingRow';
import { FEEDBACK_URL } from '@/services/appInfo';

/**
 * Settings → Support: "Ask for a feature".
 *
 * The app had no way to reach the people who make it — no address, no form, nothing but a link to
 * the site's root. This row is that way, and it is a link out rather than anything the app sends,
 * for the reason written on {@link FEEDBACK_URL}: the pledge two rows above names exactly three
 * things that ever leave this phone, and a feedback form in the app would make it four.
 *
 * The description ends "No account needed", which is the whole reason this destination was
 * acceptable. The pledge directly above says "No account, no sign-in, no email address"; a board
 * that made people sign up to be heard would have read as that promise breaking the moment anyone
 * followed it. Anonymous posting is switched on, so the row can say so plainly — and if it were
 * ever switched off, this sentence is the first thing that would have to change.
 *
 * Renders nothing when there is no board configured, exactly as `TipJar` renders nothing without a
 * RevenueCat key. That is the difference from `RateAppRow`, which stays visible-but-inert: a
 * missing store listing is a temporary state of a row users expect, whereas a missing board means
 * there is no such feature to explain.
 */

export interface FeedbackRowProps {
  /** Overridden by tests; defaults to `appInfo.FEEDBACK_URL`. */
  url?: string | null;
  /** Overridden by tests; defaults to `Linking.openURL`. */
  openUrl?: (url: string) => Promise<unknown>;
  testID?: string;
}

/**
 * The "Ask for a feature" row.
 *
 * @returns A row that opens the public feedback page, or nothing if none is configured.
 */
export function FeedbackRow({
  url = FEEDBACK_URL,
  openUrl,
  testID = 'settings-row-feedback',
}: FeedbackRowProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  const open = useCallback(async () => {
    if (url === null) return;
    const openWith = openUrl ?? ((target: string) => Linking.openURL(target));
    setFailed(false);
    try {
      await openWith(url);
    } catch {
      // A device with no browser, or one that refuses the scheme. Say so in the row: a tap that
      // appears to do nothing reads as the app being broken.
      setFailed(true);
    }
  }, [openUrl, url]);

  if (url === null) return null;

  return (
    <SettingRow
      testID={testID}
      icon="edit"
      label={t('settings.home.support.feedback.label')}
      description={
        failed
          ? t('settings.home.support.feedback.failed')
          : t('settings.home.support.feedback.description')
      }
      chevron
      accessibilityRole="button"
      accessibilityHint={t('settings.home.support.feedback.a11yHint')}
      onPress={() => {
        void open();
      }}
    />
  );
}
