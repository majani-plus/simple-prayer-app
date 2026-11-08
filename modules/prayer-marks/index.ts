/**
 * `prayer-marks` — the "Prayed" button on the adhan notification, and the little queue it writes to.
 *
 * ## What the native halves do, and what they refuse to do
 *
 * When the button is pressed the app is usually not running, and starting it to write one row
 * would be both slow and beside the point. So the native handler does three cheap things and
 * **never touches the database**:
 *
 * 1. **Appends one entry** — `(id, day, prayer, decidedAt)` — to a queue in SharedPreferences
 *    (Android) or an App Group `UserDefaults` (iOS). Append-only, tiny, no schema.
 * 2. **Replaces the notification** with a short confirmation carrying **Undo**, which takes itself
 *    out of the tray after about thirty seconds.
 * 3. Nothing else. No prayer-day arithmetic, no qada, no streaks.
 *
 * That third point is the whole design. Prayer days run Fajr→Fajr, a miss moves a qada counter, an
 * exempt day is not a missed day — and all of that lives in `src/domain`, in TypeScript, under
 * test. A native path that wrote logs directly would be a second implementation of it, drifting
 * quietly in a language nobody runs the domain tests in. Instead the app drains the queue on its
 * next launch through `trackingStore.toggleStatus` (`services/pendingMarks`), so the rules are
 * applied exactly once, by the code that already owns them. See D92.
 *
 * ## Undo is an entry, not an edit
 *
 * Pressing Undo appends a second entry naming the first. If both drain together they cancel and
 * nothing is ever written; if the app was opened in between, the orphan undo clears the prayer it
 * names. Nothing has to be reversed, because nothing was written early.
 *
 * ## Copy
 *
 * The confirmation is composed natively, so its words have to be there before the button is
 * pressed — the app may be gone by then. {@link configure} pushes the already-translated strings
 * down whenever the notification schedule is rebuilt (which includes every language change), and
 * the native side stores them beside the queue. It never falls back to English: with no copy
 * stored, the mark is still queued and the original notification still cleared, but no
 * confirmation is posted.
 *
 * ## Where it does nothing
 *
 * Jest, web, and any dev client built before this module existed. Every function resolves without
 * doing anything there, so callers need no platform checks; {@link isSupported} exists so the app
 * can decide whether to advertise the button at all.
 */

/** The prayers this module knows how to be pressed about. Mirrors `domain/types`' `Prayer`. */
export type PrayerMarksPrayer = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

// ---------------------------------------------------------------------------
// Identifiers shared with the native halves
// ---------------------------------------------------------------------------
//
// Each of these appears once here and once in Kotlin and Swift, and nothing enforces the match but
// a press that resolves to nothing. They are constants on every side rather than literals at any
// of them, so a rename is at least greppable.
//
// Category identifiers avoid `:` and `-`: `expo-notifications` documents both as characters that
// stop categories working.

/** The category the adhan reminder is scheduled under, so its button appears. */
export const ADHAN_CATEGORY_ID = 'prayerAdhan';

/** The category the confirmation is posted under, so its Undo appears. */
export const CONFIRMATION_CATEGORY_ID = 'prayerMarkConfirmation';

/** The one action on a reminder. D58: a prayer whose window is open cannot be late or missed. */
export const MARK_PRAYED_ACTION = 'prayed';

/** The one action on a confirmation. */
export const MARK_UNDO_ACTION = 'undo';

/**
 * Payload field marking a notification as a **dress rehearsal**: pressing its Prayed button runs
 * the whole native loop — the notification is cleared and a confirmation appears — but **nothing
 * is ever queued or recorded**. The test notification carries it, so the button can be tried
 * without editing anyone's day. The confirmation it posts carries no Undo, because there is
 * nothing to undo, and its words come from {@link PrayerMarksCopy.testConfirmationTitle}.
 */
export const MARK_TEST_FIELD = 'test';

/**
 * Payload fields for a press on the **Android ongoing notification** (D95). `MARK_ONGOING_FIELD`
 * marks the payload as the ongoing notification's, so the press swaps it in place instead of
 * clearing it: the native handler re-posts it with `MARK_AFTER_TITLE_FIELD` /
 * `MARK_AFTER_BODY_FIELD` — the "Next: …" content the app pre-baked, because Kotlin cannot build
 * localized copy — on the channel named by `MARK_CHANNEL_FIELD`. The queue entry it appends is a
 * real one, exactly as if the adhan reminder had been pressed. Android only: the ongoing
 * notification does not exist on iOS (D27).
 */
export const MARK_ONGOING_FIELD = 'ongoing';
export const MARK_AFTER_TITLE_FIELD = 'afterTitle';
export const MARK_AFTER_BODY_FIELD = 'afterBody';
export const MARK_CHANNEL_FIELD = 'channelId';

/**
 * Everything the native side needs to write a confirmation, already translated.
 *
 * Every string is user-visible and comes from `src/i18n`; nothing here is composed natively beyond
 * picking one of the five titles, so no template ever has to be interpreted in Kotlin or Swift.
 */
export interface PrayerMarksCopy {
  /** The confirmation title per prayer, e.g. `{ maghrib: 'Maghrib marked' }`. */
  confirmationTitle: Record<PrayerMarksPrayer, string>;
  /**
   * The confirmation title for a **test** press ({@link MARK_TEST_FIELD}) — it must say the button
   * worked without claiming anything was saved, because nothing was.
   */
  testConfirmationTitle: string;
  /** The Undo button on the confirmation. */
  undo: string;
  /**
   * Android only: the notification channel the confirmation is posted on. Silent and low
   * importance — a confirmation of something the user just did must never make a sound.
   */
  channelName: string;
  /** Android only: the channel's description, shown in the system notification settings. */
  channelDescription: string;
}

/** The two calls the native module exposes. See the platform sources for the contract. */
interface PrayerMarksNativeModule {
  configure(copy: PrayerMarksCopy): Promise<void>;
  readPendingMarks(): Promise<string>;
  acknowledgePendingMarks(ids: string[]): Promise<void>;
}

/**
 * `null` until first use, then the module or `null` forever.
 *
 * Resolved lazily and behind a `try`, for the same two reasons as `notification-dismissal`:
 * importing `expo`'s native-module bridge eagerly breaks plain Jest runs, and a build without this
 * module must degrade rather than throw at import time.
 */
let resolved: PrayerMarksNativeModule | null | undefined;

function nativeModule(): PrayerMarksNativeModule | null {
  if (resolved !== undefined) return resolved;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo') as {
      requireOptionalNativeModule: <T>(name: string) => T | null;
    };
    resolved = requireOptionalNativeModule<PrayerMarksNativeModule>('PrayerMarks');
  } catch {
    resolved = null;
  }
  return resolved;
}

/**
 * Whether the running binary carries the native module. Exposed so the app can report honestly
 * and so the notification category is only registered where pressing it would do something.
 */
export function isSupported(): boolean {
  return nativeModule() !== null;
}

/**
 * Hands the native side the words it will need when the app is gone.
 *
 * Safe to call as often as you like; it overwrites. Never rejects — a confirmation that arrives
 * without its copy is a small loss, and losing the reminder sync over it would be a large one.
 *
 * @param copy - Already-translated strings; see {@link PrayerMarksCopy}.
 */
export async function configure(copy: PrayerMarksCopy): Promise<void> {
  const native = nativeModule();
  if (native === null) return;
  try {
    await native.configure(copy);
  } catch {
    // Deliberately swallowed — see above.
  }
}

/**
 * Reads the queue **without emptying it**.
 *
 * Read-then-acknowledge, rather than a single draining read, so that a crash between reading and
 * writing costs nothing: the entries are still there next launch, and applying them twice is a
 * no-op by construction (`domain/pendingMarks`). A read that emptied the queue would silently
 * lose someone's "I prayed", which is the one failure this feature must not have.
 *
 * @returns The raw entries, or `[]` on any platform or build without the module.
 */
export async function readPendingMarks(): Promise<unknown[]> {
  const native = nativeModule();
  if (native === null) return [];
  try {
    // Carried as one JSON string rather than a list of records: the entries are written by a
    // broadcast receiver with no bridge in sight, so JSON is already their storage format, and
    // handing it over verbatim keeps exactly one parser (this one) in the whole path.
    const parsed: unknown = JSON.parse(await native.readPendingMarks());
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Forgets entries whose writes have landed, and takes their confirmations out of the tray.
 *
 * @param ids - Entry ids, as read. Ids that are no longer there are ignored.
 */
export async function acknowledgePendingMarks(ids: readonly string[]): Promise<void> {
  const native = nativeModule();
  if (native === null || ids.length === 0) return;
  try {
    await native.acknowledgePendingMarks([...ids]);
  } catch {
    // Deliberately swallowed: the entries stay, and the next drain is a no-op that clears them.
  }
}
