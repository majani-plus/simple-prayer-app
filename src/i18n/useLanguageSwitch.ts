/**
 * Changing the language from Settings — including the restart nobody enjoys.
 *
 * Switching between Arabic and a left-to-right language turns the entire layout around, and React
 * Native can only do that at startup (`./direction` explains why). This hook is the whole policy
 * for that awkward fact, in one place, so the Settings screen stays a list of switches:
 *
 * - **A change that keeps the direction just happens.** English ⇄ Turkish never asks for anything;
 *   the paper repaints in the new language and that is the end of it.
 * - **A change that flips the direction asks first.** Never a surprise restart: the user is told
 *   what will happen and chooses. "Later" is a real option — the language still changes, and the
 *   layout turns around the next time the app opens.
 * - **A restart that cannot happen says so.** `Updates.reloadAsync()` is unavailable in a dev
 *   client and in any build without update config (`./reload`). Rather than a dead button or a
 *   silent no-op, the user gets one calm sentence: it applies next launch.
 *
 * The one state this hook refuses to produce is a half-mirrored app *without the user knowing*.
 * Half-mirrored-and-told is survivable for one launch; half-mirrored-and-unexplained reads as a
 * broken app.
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { applyLayoutDirection, isRtlLanguage, isLayoutRTL } from './direction';
import { reloadApp } from './reload';
import { SUPPORTED_LANGUAGES, deviceLanguage, type AppLanguage } from './index';
import { useLanguagePreference, useSettingsActions } from '@/stores/settingsStore';

import type { LanguagePreference } from '@/domain/types';

/**
 * Resolves a stored preference to the language actually rendered.
 *
 * @param preference - `system` follows the device; anything else is already concrete.
 */
/**
 * How long to let the renderer settle before asking the platform to restart. Short enough that
 * nobody perceives it, long enough that the commit in flight has been mounted.
 */
const RESTART_SETTLE_MS = 120;

export function resolveLanguage(preference: LanguagePreference): AppLanguage {
  if (preference === 'system') return deviceLanguage();
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(preference)
    ? (preference as AppLanguage)
    : 'en';
}

export interface LanguageSwitch {
  /** The stored preference, for the selected chip. */
  preference: LanguagePreference;
  /** Apply a new preference, handling the restart when the direction flips. */
  chooseLanguage: (preference: LanguagePreference) => void;
  /**
   * True while the strings and the layout disagree — the user chose a direction change and has
   * not restarted yet.
   *
   * Settings renders a notice on this, and must keep doing so. It was computed and unit-tested
   * for a long time while nothing displayed it, which left anyone who tapped "Later" reading
   * Arabic in a left-to-right layout with nothing on screen explaining why or offering a way
   * out. That state was reported from a real device and looked like a rendering bug.
   */
  awaitingRestart: boolean;
  /** Reload now, for someone who declined the restart and wants the layout to catch up. */
  restartNow: () => Promise<void>;
}

/**
 * The Settings language row's behaviour.
 *
 * @returns The current preference, the setter that owns the restart flow, and whether the app is
 * currently mid-flip.
 */
export function useLanguageSwitch(): LanguageSwitch {
  const { t } = useTranslation();
  const preference = useLanguagePreference();
  const { setLanguage } = useSettingsActions();

  const awaitingRestart = isRtlLanguage(resolveLanguage(preference)) !== isLayoutRTL();

  const chooseLanguage = useCallback(
    (next: LanguagePreference) => {
      if (next === preference) return;
      const resolved = resolveLanguage(next);

      // The direction the app is *rendered* in right now — not the direction of the language the
      // store holds, which may already be ahead of the layout if the user declined an earlier
      // restart. Comparing against what is on screen is what makes a second change coherent.
      if (isRtlLanguage(resolved) === isLayoutRTL()) {
        setLanguage(next);
        return;
      }

      // Named in its own language ("العربية", "Türkçe"), like the picker itself, so the sentence
      // stays readable to someone switching away from a language they can read. Interpolating an
      // Arabic name into an English sentence is also precisely the bidi case `i18n/formatter`
      // isolates — without it, "العربية lays the screens out…" starts on the wrong word.
      const languageName = t(`settings.home.appearance.language.${resolved}`);

      // The warning is written in the language currently on screen — the one the user can still
      // read. Everything after the choice speaks the new one.
      Alert.alert(
        t('settings.home.appearance.language.direction.title'),
        t('settings.home.appearance.language.direction.body', { language: languageName }),
        [
          {
            text: t('settings.home.appearance.language.direction.later'),
            style: 'cancel',
            // The language still changes: a setting that visibly does nothing until you restart is
            // worse than one that half-applies and says so. `applyLayoutDirection` persists the
            // flag, so the next launch comes up correct with no further action — which is exactly
            // what the body just promised.
            onPress: () => {
              commit(next, resolved);
            },
          },
          {
            text: t('settings.home.appearance.language.direction.restart'),
            onPress: () => {
              commit(next, resolved);
              scheduleRestart(resolved);
            },
          },
        ],
        { cancelable: true }
      );

      function commit(preferenceToStore: LanguagePreference, language: AppLanguage): void {
        setLanguage(preferenceToStore);
        applyLayoutDirection(language);
      }

      /**
       * Reload, but never in the same tick as the change that prompted it.
       *
       * `commit` does two things that put the renderer to work: the language change re-renders
       * every screen, and `forceRTL` asks the native side to turn the layout around. Calling
       * `reloadAsync` immediately afterwards tears the React instance down while that mount
       * transaction is still being committed, and Fabric's scheduler then calls back through a
       * freed delegate. That is an EXC_BAD_ACCESS, and it is what a tester hit on 1.4.0 (iPhone 15,
       * iOS 26.5) switching between English and Arabic — reported as "language switching crashes".
       *
       * A plain timer lets the commit and the alert's own dismissal settle first (RN 0.87 removed
       * `InteractionManager`, which by 0.86 waited for nothing anyway). This runs immediately
       * before the process is deliberately killed, so a few milliseconds cost nothing and the
       * window is what matters.
       */
      function scheduleRestart(language: AppLanguage): void {
        setTimeout(() => {
          void restart(language);
        }, RESTART_SETTLE_MS);
      }

      /** Reload if the runtime can; otherwise say plainly that it applies next launch. */
      async function restart(language: AppLanguage): Promise<void> {
        if (await reloadApp()) return;
        // In the *new* language: the switch has already happened, so the app speaks it now.
        Alert.alert(
          t('settings.home.appearance.language.direction.pending.title', { lng: language }),
          t('settings.home.appearance.language.direction.pending.body', { lng: language }),
          [{ text: t('settings.home.appearance.language.direction.pending.ok', { lng: language }) }]
        );
      }
    },
    [preference, setLanguage, t]
  );

  /**
   * Reload now, for someone who declined the restart earlier and is looking at Arabic strings in
   * a left-to-right layout. Falls back to the same honest "next launch" sentence the switch flow
   * uses when the runtime cannot reload itself.
   */
  const restartNow = useCallback(async (): Promise<void> => {
    // Same reasoning as `scheduleRestart` above: never tear the runtime down in the same tick as
    // the render that the tap itself caused.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, RESTART_SETTLE_MS);
    });
    if (await reloadApp()) return;
    const language = resolveLanguage(preference);
    Alert.alert(
      t('settings.home.appearance.language.direction.pending.title', { lng: language }),
      t('settings.home.appearance.language.direction.pending.body', { lng: language }),
      [{ text: t('settings.home.appearance.language.direction.pending.ok', { lng: language }) }]
    );
  }, [preference, t]);

  return { preference, chooseLanguage, awaitingRestart, restartNow };
}
