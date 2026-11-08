/**
 * What the widget needs to tell a buddy by itself (D180).
 *
 * ## Why an outbox exists at all
 *
 * A seal tap on a home-screen widget runs in a process with no React runtime: a widget extension on
 * iOS, a broadcast receiver on Android. Until D180 all it could do was append to the D92 queue and
 * wait for the app to be opened — so a prayer marked from the homescreen, which is the whole point
 * of having a widget, told nobody for hours. Now the tapping process posts to the relay itself.
 *
 * To do that it needs three things the app has and it does not: the relay secret (the keychain,
 * through `buddyCredentials.ts`), the pairs to post to, and the sentence to send each of them —
 * written in *their* language, because the relay holds no copy and no translations. The last two
 * are this file. It is rebuilt whenever the roster, the language or the notification preference
 * changes, and cleared when buddy mode is switched off.
 *
 * ## What is deliberately not in it
 *
 * No nickname, no icon, no colour. Those are chosen by the person looking at their buddy and have
 * never crossed a network (D174): the sentence with the name in it is the one with `{}` where the
 * name goes, and the receiving phone fills the hole from its own roster
 * (`modules/buddy-nicknames`). `src/__tests__/privacyClaims.test.ts` fails the build if a nickname
 * ever reaches this JSON.
 *
 * No prayer log either: the outbox says who to tell and what to say, never what was marked. The
 * tap itself carries the day, the prayer and the state.
 */

import {
  clearBuddyOutbox as clearOutboxBridge,
  setBuddyOutbox,
  takeBuddyWidgetSent,
} from '../../modules/buddy-nicknames';
import type { MarkState } from '../domain/buddies';
import { isValidDay } from '../domain/dates';
import { isPrayer, type Prayer, type PrayerDay } from '../domain/types';
import i18n from '../i18n';
import type { BuddyPair } from '../stores/buddyStore';
import { composeBuddyNotification, type BuddyNotificationText } from './buddyPush';

/** The shape the native senders parse. Bumped only if they are changed in the same commit. */
export const BUDDY_OUTBOX_VERSION = 1;

/** One buddy's five sentences, already written in their language. */
export type OutboxTitles = Partial<Record<Prayer, BuddyNotificationText>>;

export interface OutboxPair {
  pairId: string;
  /** Their language and preference, cached from the last flag they sent. */
  lang: string;
  notify: boolean;
  /**
   * Absent for a buddy who has asked not to be told. That absence is the whole mechanism: with no
   * words to send, the sender posts the flag alone and their phone stays silent — the relay never
   * learning that anybody preferred anything.
   */
  titles?: OutboxTitles;
}

export interface Outbox {
  v: typeof BUDDY_OUTBOX_VERSION;
  /** Our own language and preference, which every flag carries so buddies can address us. */
  lang: string;
  notify: boolean;
  pairs: OutboxPair[];
}

/** One line of the ledger a widget tap leaves behind. */
export interface WidgetSent {
  day: PrayerDay;
  prayer: Prayer;
  state: MarkState;
  /** Epoch ms, as everywhere the native side writes a time. */
  at: number;
}

export interface BuildOutboxInput {
  pairs: readonly BuddyPair[];
  /** This phone's language, sent so a buddy can write to us in it next time. */
  lang: string;
  /** This phone's "tell me when a buddy prays", same reason. */
  notify: boolean;
  compose: (lang: string, prayer: Prayer) => BuddyNotificationText | null;
}

const PRAYER_ORDER: readonly Prayer[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/**
 * The words for a buddy's phone, written in *their* language.
 *
 * `getFixedT` is what makes that possible: it renders a language this phone is not itself using,
 * from the same authored bundles, so the relay never has to hold a translation. Null when it
 * cannot be rendered — the flag then goes out without words, and the buddy sees it when they open
 * the app rather than being told wrongly.
 */
export function defaultCompose(lang: string, prayer: Prayer): BuddyNotificationText | null {
  try {
    const translate = i18n.getFixedT(lang);
    return composeBuddyNotification((key, values) => String(translate(key, values as never)), prayer);
  } catch {
    return null;
  }
}

/**
 * Everything a process with no JS needs in order to tell the buddies.
 *
 * Pure: it reads nothing and writes nothing. The five sentences are composed up front because the
 * tapping process cannot compose them — it has no bundles, no i18next and, on Android, no idea what
 * language anybody reads.
 */
export function buildOutbox(input: BuildOutboxInput): Outbox {
  const pairs: OutboxPair[] = input.pairs.map((pair) => {
    const entry: OutboxPair = { pairId: pair.pairId, lang: pair.lang, notify: pair.notify };
    if (!pair.notify) return entry;

    const titles: OutboxTitles = {};
    for (const prayer of PRAYER_ORDER) {
      const text = input.compose(pair.lang, prayer);
      if (text) titles[prayer] = { title: text.title, titleNamed: text.titleNamed };
    }
    // An empty map would be a promise of words that are not there. Absent says the same thing the
    // sender already understands: post the flag, say nothing.
    if (Object.keys(titles).length > 0) entry.titles = titles;
    return entry;
  });

  return { v: BUDDY_OUTBOX_VERSION, lang: input.lang, notify: input.notify, pairs };
}

/** Leave it where the widget can read it. Best-effort: the app still tells them on its next open. */
export async function writeBuddyOutbox(outbox: Outbox): Promise<void> {
  await setBuddyOutbox(JSON.stringify(outbox));
}

/** Forget who to tell. Called when buddy mode is switched off. */
export async function clearBuddyOutbox(): Promise<void> {
  await clearOutboxBridge();
}

function isWidgetSent(value: unknown): value is WidgetSent {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    isValidDay(row.day) &&
    typeof row.prayer === 'string' &&
    isPrayer(row.prayer) &&
    (row.state === 'prayed' || row.state === 'cleared') &&
    typeof row.at === 'number' &&
    Number.isFinite(row.at)
  );
}

/**
 * What a widget tap already posted, emptied as it is read.
 *
 * Validated strictly and entry by entry: an unreadable line is dropped rather than trusted, and
 * dropping one only means the app tells that buddy again — a duplicate notification, which is the
 * gentler of the two failures available here.
 */
export async function takeWidgetSent(): Promise<WidgetSent[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await takeBuddyWidgetSent());
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter(isWidgetSent) : [];
}
