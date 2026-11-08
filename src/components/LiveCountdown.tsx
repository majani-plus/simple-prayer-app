import { useTranslation } from 'react-i18next';

import { AppText, type AppTextProps } from './AppText';
import { useNow } from '@/hooks/useNow';
import { formatDuration, type DurationStyle } from '@/utils/formatTime';

/**
 * A countdown that re-renders itself once a second — and nothing else.
 *
 * The Today screen holds the prayer list, the hero and the header; re-rendering that tree every
 * second to move one line of text would be wasteful and would fight the seal's animations. So the
 * clock lives *here*: `useNow` is mounted inside this leaf component, and only this `Text` updates
 * on a tick (DESIGN.md §Animation principles — "countdown ticks once/second without re-rendering
 * the row list").
 *
 * It renders through {@link AppText}, so the call site picks the type role: the hero uses the
 * `long` style at 14pt italic, a prayer row uses the `compact` style in its caption.
 */
export interface LiveCountdownProps extends Omit<AppTextProps, 'children'> {
  /** The instant being counted down to (the prayer's start). */
  target: Date;
  /**
   * Milliseconds remaining, used only when `target` is not a usable date. The screen already
   * knows this figure (`NextPrayerInfo.msRemaining`), so a malformed `Date` still renders
   * something truthful rather than "now".
   */
  fallbackMs?: number;
  /** `long` → "in 2 hours 7 minutes"; `compact` → "in 2 h 07 m". Defaults to `long`. */
  durationStyle?: DurationStyle;
  /**
   * An i18n key that wraps the bare duration in its own sentence (`{{duration}}` interpolation) —
   * the hero's DUE mode says "2 hours 7 minutes **left to pray**" where the default framing says
   * "**in** 2 hours 7 minutes". Same clock, same arithmetic; only the sentence changes. Once the
   * moment arrives the phrase gives way to the localized "now" (a "0 seconds left" would be a
   * strange sentence to leave on screen).
   */
  phraseKey?: string;
  /**
   * Extra interpolation values for `phraseKey` beyond `{{duration}}` — the hero's WAITING
   * sentence names the prayer that was prayed ("Isha prayed · next in …").
   */
  phraseValues?: Record<string, string>;
  /** Tick period. Defaults to one second. */
  intervalMs?: number;
}

/**
 * A live "in 2 hours 7 minutes" text node.
 *
 * @param target - The moment being counted down to.
 * @param durationStyle - Long (hero) or compact (row caption) phrasing.
 * @returns An `AppText` that updates every `intervalMs` without touching its parent.
 */
export function LiveCountdown({
  target,
  fallbackMs,
  durationStyle = 'long',
  phraseKey,
  phraseValues,
  intervalMs = 1000,
  ...rest
}: LiveCountdownProps) {
  const now = useNow(intervalMs);
  // Subscribing to i18n here means a language switch re-renders the countdown immediately,
  // rather than at the next tick, and keeps the digits in the same script as the time beside it.
  const { t, i18n } = useTranslation();

  const targetMs = target.getTime();
  const remaining = Number.isFinite(targetMs) ? targetMs - now.getTime() : (fallbackMs ?? 0);

  const text =
    phraseKey !== undefined && remaining > 0
      ? t(phraseKey, {
          ...phraseValues,
          duration: formatDuration(remaining, {
            style: durationStyle,
            locale: i18n.language,
            countdown: false,
          }),
        })
      : formatDuration(remaining, { style: durationStyle, locale: i18n.language });

  return <AppText {...rest}>{text}</AppText>;
}
