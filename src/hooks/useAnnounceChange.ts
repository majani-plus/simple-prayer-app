import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Speaks a status line when it changes — on the platform where `accessibilityLiveRegion` cannot.
 *
 * **The hole this fills.** React Native's `accessibilityLiveRegion` is Android-only: it is marked
 * `@platform android` in `ViewAccessibility.d.ts` and appears in `BaseViewConfig.android.js` and
 * nowhere else. There is no iOS counterpart in core. So every status surface in the app that
 * changed under the reader's feet — the qibla alignment pill, the tip jar's thank-you, the
 * reminder test's result — spoke on TalkBack and was **completely silent on VoiceOver**. A blind
 * user turning the phone toward Makkah heard nothing at all, because the one element that knew
 * was not the one they had focused.
 *
 * `announceForAccessibility` is the iOS route (`UIAccessibilityAnnouncementNotification`), and it
 * is a no-op when no screen reader is running, so this costs nothing for anyone else.
 *
 * **Android is deliberately left alone.** Keeping the live region there and announcing here would
 * say it twice, and a live region is what Google asks for (`View.announceForAccessibility` is
 * deprecated from API 34 in favour of exactly that). So each call site keeps its
 * `accessibilityLiveRegion` and adds this hook: one mechanism per platform, one utterance each.
 *
 * **Never on mount.** The first value is recorded and swallowed. An announcement fired as a screen
 * appears talks over VoiceOver reading that screen, and the status is already in the tree for it to
 * read — the same rule `CalendarMonth`'s month announcement follows.
 *
 * @param message - The status as it should be spoken, or `null`/`''` while there is nothing to say.
 */
export function useAnnounceChange(message: string | null | undefined): void {
  // Seeded with the first value, so the first effect run has nothing to report.
  const spoken = useRef(message);

  useEffect(() => {
    if (spoken.current === message) return;
    spoken.current = message;
    if (message === null || message === undefined || message === '') return;
    // Android already has a live region on the node itself; announcing again would double it.
    if (Platform.OS === 'android') return;
    AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
}
