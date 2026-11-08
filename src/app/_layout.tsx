import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { runMigrations } from '@/db/client';
import { useBackgroundRefresh } from '@/hooks/useBackgroundRefresh';
import { useLocationRefresh } from '@/hooks/useLocationRefresh';
import { useNotificationSync } from '@/hooks/useNotificationSync';
import { useOngoingNotification } from '@/hooks/useOngoingNotification';
import { useOrientationPolicy } from '@/hooks/useOrientationPolicy';
import { BuddyPairedSheet } from '@/components/BuddyPairedSheet';
import { usePendingMarks } from '@/hooks/usePendingMarks';
import { useBuddySync } from '@/hooks/useBuddySync';
import { useURL } from 'expo-linking';

import { getBuddyActions, useBuddyEnabled, useBuddyStore } from '@/stores/buddyStore';
import { useReviewPrompt } from '@/hooks/useReviewPrompt';
import { useTodayDayResolver } from '@/hooks/useTodayDayResolver';
import { useWidgetSync } from '@/hooks/useWidgetSync';
import { applyLanguage, deviceLanguage, initI18n } from '@/i18n';
import { setNumeralPreference } from '@/i18n/numerals';
import { initTelemetry, reportHandledError, wrapRootWithTelemetry } from '@/services/telemetry';
import {
  getSettingsSnapshot,
  useArabicNumerals,
  useLanguagePreference,
  useOnboardingCompleted,
  useThemePreference,
} from '@/stores/settingsStore';
import { getTrackingActions } from '@/stores/trackingStore';
import { ThemePreferenceContext, useTheme } from '@/theme';

void SplashScreen.preventAutoHideAsync().catch(() => {
  // The splash screen may already be gone (fast refresh); never let this reject.
});

// i18next is initialised at module scope so the very first render already has strings — and so the
// OS layout-direction flag is written before anything lays out (see i18n/direction.ts).
// `initI18n` picks the device language, so whatever it resolves to IS the "system" language;
// capturing it here avoids duplicating the device-language lookup in this layer.
initI18n();
const SYSTEM_LANGUAGE = deviceLanguage();

// Crash reporting starts here — before the first render, so early crashes are caught — and only
// when the user's setting allows it (Settings → Support → Crash reports; on by default, D31's
// diagnostic-only exception). The read is synchronous because the settings store hydrates from
// MMKV during `create()` (D13). `initTelemetry` never throws: a client without the Sentry module
// degrades silently, so this line can never white-screen the app.
initTelemetry(getSettingsSnapshot().crashReportingEnabled);

/**
 * Runs the one-time startup work that must happen before any screen queries the database:
 * applies the Drizzle migrations, then hydrates the tracking store's caches.
 *
 * Failure is deliberately non-fatal. A migration or hydration error is logged and reported,
 * but startup still completes, so a broken database can never leave the user staring at a
 * white screen behind a splash that never hides.
 *
 * @returns `done` — startup has settled (successfully or not) — and the error, if any.
 */
function useStartup(): { done: boolean; error: Error | null } {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    const finish = (failure?: unknown) => {
      if (cancelled) return;
      if (failure !== undefined) {
        const asError = failure instanceof Error ? failure : new Error(String(failure));
        console.error('[startup] database initialisation failed', asError);
        // The app survives this, so no crash report would exist — report it as a handled error
        // instead (a no-op when crash reporting is off or unavailable).
        reportHandledError(asError);
        setError(asError);
      }
      setDone(true);
    };

    runMigrations()
      .then(() => {
        if (cancelled) return;
        // Hydration reads through the same connection the migrations just prepared.
        getTrackingActions().hydrate();
        finish();
      })
      .catch(finish);

    return () => {
      cancelled = true;
    };
  }, []);

  return { done, error };
}

/** The navigator, rendered inside the theme provider so it sees the user's preference. */
function RootNavigator() {
  const { scheme, colors } = useTheme();

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        {/* The city picker is an answer to the screen underneath it, not a place you navigate
            to, so it is presented over that screen and dismisses straight back to it. */}
        <Stack.Screen name="city" options={{ presentation: 'fullScreenModal' }} />
      </Stack>
    </>
  );
}

function RootLayout() {
  const themePreference = useThemePreference();
  const languagePreference = useLanguagePreference();
  const arabicNumerals = useArabicNumerals();
  const onboardingCompleted = useOnboardingCompleted();
  const startup = useStartup();
  // Read here rather than inside the hook so that switching buddy mode on RE-RUNS its effect. Keyed
  // only on `startup.done`, the effect never re-ran in the session somebody turned the feature on:
  // the silent Android channel is created by that effect, so the first buddy notifications landed
  // on the default channel instead — with sound and vibration, which is the one thing they must
  // never have.
  const buddyEnabled = useBuddyEnabled();
  // The URL this launch came in on, if any — read so the onboarding redirect below can put a
  // pairing invite aside instead of swallowing it.
  const initialUrl = useURL();
  // The prayer day (Fajr→Fajr) is installed on the tracking store here, at the root, so it holds
  // for EVERY route — including one reached by a deep link without the Today tab ever mounting.
  // It is deliberately not a screen's job: see `hooks/useTodayDayResolver`.
  useTodayDayResolver();
  // Lets big Android screens rotate while phones stay portrait (D123). Mounted at the root because
  // the policy belongs to the device, not to a screen, and a foldable can be opened on any route.
  // Inert on iOS, where the plist already says the same thing.
  useOrientationPolicy();
  // Re-resolves a granted auto location on launch and foreground (PRODUCT_SPEC §10) and absorbs
  // the OS permission into the location store, which is what lets the Qibla compass start without
  // a tap. It never prompts, and it leaves an unanswered permission — and the first-run cards
  // that explain it — completely untouched.
  useLocationRefresh();
  // Keeps the OS notification schedule current (foreground, settings, logs, day rollover) and
  // routes a notification tap back to Today. Without this the notification engine is inert.
  useNotificationSync();
  // Redraws the Android ongoing notification as prayers change (D27). Inert on iOS and while the
  // setting is off, which is its default.
  useOngoingNotification();
  // Writes anything the user marked from a notification while the app was closed (D91). Gated on
  // startup, because it writes to the database the migrations have only just prepared.
  usePendingMarks(startup.done);
  // Publishes the widgets' snapshot whenever the world it renders changes (D26). Gated on startup
  // for the same reason as the drain — and it runs after it, so a drained mark repaints at once.
  useWidgetSync(startup.done);
  // Asks the OS to wake the app about once an hour with no screen open, so the reminder plan never
  // runs out on a phone left alone and iOS gets a chance to clear stale rows out of the tray. The
  // task itself is defined at the repo-root entry point, not here — see `services/backgroundRefresh`.
  useBackgroundRefresh(startup.done);
  // Watches for a delight moment and, once the policy in `config/reviewTriggers` allows it, asks
  // for a store review (D28, PRODUCT_SPEC §13). Mounted here because the hook requires exactly one
  // instance above the tabs: it holds the session and diffs store state, so a per-screen mount
  // would both double-count and lose the session on navigation.
  //
  // It needs no arguments: the "never while the adhan is playing" exclusion wires itself through
  // `services/adhanPlayback`, which the preview player writes to and this hook reads (D89). That
  // was not always true, and the comment which used to stand here said there was no in-app
  // playback to observe — correct when it was written, and wrong a day later when D78 added the
  // "Hear the adhan" preview. What is still true is the narrower claim: the adhan that arrives at
  // Fajr is an OS *notification sound*, which no process can observe, so `prayerWindowMinutes`
  // remains the exclusion that actually protects someone on the mat.
  useReviewPrompt();
  // Buddy mode (D174): sends a flag when a prayer is marked, and collects whatever a buddy sent.
  // Gated on startup like the drain, because it reads the day the database has only just prepared,
  // and on the feature itself — so nothing of it runs, and no Android channel is created, for the
  // overwhelming majority who never turn it on.
  useBuddySync(startup.done && buddyEnabled);
  // No `useFonts` here any more. The fourteen font files are embedded in the native app by the
  // `expo-font` config plugin (`app.json`), so they are available the moment the process starts
  // and the splash no longer waits for ~2.5 MB to be read and registered on every cold start —
  // `theme/typography` carries each platform's name for them. The only thing left to wait for is
  // the database.

  // The settings store is the source of truth for the language; `system` follows the device.
  //
  // `applyLanguage` also re-points the OS layout-direction flag, and it runs even when the
  // language is already loaded. That is not redundant: `initI18n` writes the flag for the *device*
  // language at module scope, before the persisted preference has been read, so a user whose app
  // language differs from their phone's needs this pass to leave the flag correct for the next
  // launch. It never restarts anything — only the Settings row may do that (i18n/useLanguageSwitch).
  useEffect(() => {
    // Beside the language, and for the same reason: `src/i18n` must not reach into the store.
    setNumeralPreference(arabicNumerals);
    const language = languagePreference === 'system' ? SYSTEM_LANGUAGE : languagePreference;
    void applyLanguage(language).catch(() => {
      // Falling back to the currently loaded language is better than crashing the root layout.
    });
  }, [languagePreference, arabicNumerals]);

  const ready = startup.done;

  // Startup's last act: send a genuinely fresh install to the first-run setup flow, then bring
  // the splash down.
  //
  // The two live in one effect because the ORDER is the point. The redirect is issued while the
  // splash is still covering the screen, so the first thing anyone sees is the flow itself and
  // never a frame of Today painting behind it. Waiting for `ready` is what makes it possible at
  // all: until then this component renders `null`, and there is no navigator to redirect within.
  //
  // This is a redirect, not a gate. `app/onboarding` can be left from every step and sets the
  // same flag whether it was finished or skipped, so it is offered exactly once per install and
  // nobody is ever returned to a screen they already dismissed (PRODUCT_SPEC §10). An install
  // made before the flow existed reads `onboardingCompleted: true` and never sees it
  // (`stores/settingsStore.sanitizeSettings`).
  //
  // The one thing the redirect must not swallow is a pairing invite. The website sends `/b/*` to
  // the install page, so the first open after installing is frequently the one carrying the code —
  // exactly the open this redirect takes over. The code is put aside first and honoured once the
  // flow is done, so the commonest way people share buddy mode does not fail the first time it is
  // used. Anything else in the URL is left alone.
  useEffect(() => {
    if (!ready) return;

    if (!onboardingCompleted) {
      const code = /\/b\/([0-9A-Za-z]{8})\/?$/.exec(initialUrl ?? '')?.[1];
      if (code) getBuddyActions().setPendingCode(code.toUpperCase());
      router.replace('/onboarding');
    } else {
      const pending = useBuddyStore.getState().pendingCode;
      if (pending) {
        getBuddyActions().setPendingCode(null);
        router.replace({ pathname: '/b/[code]', params: { code: pending } });
      }
    }

    void SplashScreen.hideAsync().catch(() => {
      // Already hidden — nothing to do.
    });
  }, [ready, onboardingCompleted, initialUrl]);

  if (!ready) return null;

  return (
    <ThemePreferenceContext.Provider value={themePreference}>
      {/* The sheet host, and the gesture root it needs. Both wrap the navigator rather than
          living inside a screen, because a bottom sheet has to be able to paint over the tab bar
          — and they sit INSIDE the theme provider because the sheets are portalled to here, so
          this is where their `useTheme` is resolved (see components/BottomSheet). */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <BottomSheetModalProvider>
          <RootNavigator />
          {/* "Amina is your buddy now" — over whatever screen is open, whenever an acceptance
              is discovered, including a cold launch days after the invite (D181). */}
          <BuddyPairedSheet />
        </BottomSheetModalProvider>
      </GestureHandlerRootView>
    </ThemePreferenceContext.Provider>
  );
}

// expo-router's Sentry guidance: wrap the root layout's default export. When crash reporting is
// off (or the SDK is unavailable) this is the identity function — an opted-out user's tree
// contains no Sentry component at all.
export default wrapRootWithTelemetry(RootLayout);
