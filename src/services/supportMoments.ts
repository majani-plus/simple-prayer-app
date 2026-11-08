/**
 * When the app is allowed to *ask* for something back.
 *
 * The app asks the user for exactly two things — a store review (PRODUCT_SPEC §13) and a tip
 * (§14) — and decision D29 puts one hard rule between them: **never in the same session**. Two
 * asks in one sitting turns a quiet, free, ad-free prayer app into something that wants
 * something, which is precisely the reputation the whole product is positioned against
 * (our market research: the majors' worst reviews are about being monetised at, not about
 * missing features).
 *
 * This module is the shared referee, and it is deliberately tiny and dependency-free so that both
 * sides can import it without importing each other. It is used in **both** directions, because a
 * one-way rule is not the rule D29 states:
 *
 * - the review-prompt code calls {@link noteSessionMoment}`('reviewPrompt')` when it fires the
 *   native sheet, and the tip jar's *proactive* surface asks {@link canOfferTipPrompt} before it
 *   appears;
 * - `components/TipJar` calls {@link noteSessionMoment}`('tipPrompt')` when a tip actually
 *   completes, and `hooks/useReviewPrompt` reads {@link hasSessionMoment}`('tipPrompt')` into
 *   `ReviewMoment.alreadyGaveThisSession`, which blocks every prompt for the rest of the session.
 *
 * The second direction is the one that fires in practice: the jar is reachable from Settings at
 * any moment, while a proactive card does not exist yet.
 *
 * ## What "session" means here
 *
 * The module's own lifetime — i.e. from JS start to JS teardown. Nothing is persisted, on purpose:
 * a rule about "not in the same sitting" that survived a relaunch would be a rule about days, and
 * would need a clock, a stored timestamp and a definition of when a day starts. A process-lifetime
 * flag is exactly the promise being made.
 *
 * ## What this module does NOT gate
 *
 * The Settings and About tip jars, which the user *navigated to*. D29 is about the app putting
 * itself forward; a jar someone went looking for is an answer, not an ask, and hiding it because a
 * review sheet appeared earlier would just be broken. The gate applies only to an unprompted card.
 *
 * Dependency rule: `services → domain`. Pure; no React, no storage, no strings.
 */

/** The two things the app may ask for. */
export const SESSION_MOMENTS = ['reviewPrompt', 'tipPrompt'] as const;
export type SessionMoment = (typeof SESSION_MOMENTS)[number];

const seen = new Set<SessionMoment>();

/**
 * Records that the app asked for something in this session.
 *
 * @param moment - What was shown. Calling twice is harmless.
 */
export function noteSessionMoment(moment: SessionMoment): void {
  seen.add(moment);
}

/**
 * @param moment - The ask to check.
 * @returns Whether it has already happened this session.
 */
export function hasSessionMoment(moment: SessionMoment): boolean {
  return seen.has(moment);
}

/** Clears the session. For tests, and for nothing else. */
export function resetSessionMoments(): void {
  seen.clear();
}

/**
 * How much use has to have happened before the app may bring the tip jar up by itself.
 *
 * Thirty-five logged prayers is a full week of five-a-day: long enough that the app has
 * demonstrably worked (times right, reminders arriving, a streak worth having), short enough that
 * it is not a lifetime achievement. The number is deliberately a constant in one place so it can
 * be retuned through an EAS Update without a store release, exactly like the review triggers.
 */
export const MIN_LOGGED_PRAYERS_BEFORE_TIP_PROMPT = 35;

/** Everything the proactive-card decision depends on. Supplied by the caller; nothing is read. */
export interface TipPromptContext {
  /** How many prayers the user has logged, ever. The "has this app actually helped?" signal. */
  loggedPrayerCount: number;
  /** Whether the one-time card has already been dismissed. Dismissal is forever (PRODUCT_SPEC §14). */
  dismissed: boolean;
  /** Whether the user has already left a tip. Never ask someone who already said yes. */
  hasTipped: boolean;
}

/**
 * Whether an *unprompted* tip-jar card may appear right now.
 *
 * Four gates, all of which must pass:
 *
 * 1. No review prompt has been shown this session (D29).
 * 2. The card has not already been shown and dismissed — dismissible-forever means forever.
 * 3. The user has not already tipped.
 * 4. The app has actually been used, {@link MIN_LOGGED_PRAYERS_BEFORE_TIP_PROMPT} prayers' worth.
 *
 * @param context - See {@link TipPromptContext}.
 * @returns `true` only when every gate passes.
 */
export function canOfferTipPrompt(context: TipPromptContext): boolean {
  if (hasSessionMoment('reviewPrompt')) return false;
  if (context.dismissed || context.hasTipped) return false;
  return context.loggedPrayerCount >= MIN_LOGGED_PRAYERS_BEFORE_TIP_PROMPT;
}
