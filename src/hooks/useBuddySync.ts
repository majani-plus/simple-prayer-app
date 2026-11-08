/**
 * Buddy mode's one moving part: what goes out when you mark a prayer, and what comes in when your
 * buddy marks theirs.
 *
 * ## Out
 *
 * There is no event bus in this app — a mark is a write to `trackingStore` that bumps its
 * `revision` — so this subscribes to that store and diffs today's statuses, exactly as the
 * notification, widget and review hooks do. `domain/buddies.markStateFor` decides whether a change
 * is worth a word, and the honest answer is usually no: only crossing into or out of "prayed or
 * late" speaks at all.
 *
 * ## In
 *
 * **The push is a doorbell and the inbox is the truth.** A data push can be applied the moment it
 * lands, but iOS will not promise the app ever runs to see one — a notification swiped away before
 * the app was next opened is a mark that would simply never arrive. So the inbox is pulled on
 * mount, on every return to the foreground, and after anything is sent; a collected flag is
 * acknowledged, which is what deletes it from the relay.
 *
 * ## Quietly
 *
 * Nothing here ever surfaces a failure. A relay that is unreachable, a pair that has been ended, a
 * push that does not go: none of it is something a person should meet while they are marking a
 * prayer. The rows stay as they are and the next sync catches up.
 */

import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { markStateFor, type BuddyMark } from '@/domain/buddies';
import { PRAYERS, type Prayer, type PrayerDay } from '@/domain/types';
import i18n from '@/i18n';
import { useBuddyStore } from '@/stores/buddyStore';
import { getTrackingActions, useTrackingStore } from '@/stores/trackingStore';
import { getBuddyRelay, type BuddyRelay, type SendMarkRequest } from '@/services/buddyRelay';
import { createBuddyCredentialStore, type BuddyCredentialStore } from '@/services/buddyCredentials';
import {
  composeBuddyNotification,
  configureBuddyNotifications,
  getBuddyPushToken,
  notifyInviteAccepted,
  subscribeToBuddyPushes,
  type BuddyNotificationText,
} from '@/services/buddyPush';
import { clearBuddyNicknames, setBuddyNicknames } from '../../modules/buddy-nicknames';
import {
  buildOutbox,
  clearBuddyOutbox,
  defaultCompose as composeForOutbox,
  takeWidgetSent,
  writeBuddyOutbox,
} from '@/services/buddyOutbox';
import { withTimeout } from '@/utils/withTimeout';

export interface BuddySyncOptions {
  relay?: BuddyRelay;
  credentials?: BuddyCredentialStore;
  /** What a buddy notification should say, rendered in the *receiver's* language by us. */
  composeNotification?: (input: { lang: string; prayer: Prayer }) => BuddyNotificationText | null;
}

/**
 * Pull everything waiting, apply it, and tell the relay it may forget it.
 *
 * Acknowledging is deleting, so it happens only after the store has the flags — a crash between
 * the two loses nothing, because an unacknowledged flag is still there next time.
 */
async function syncWithRelay(
  relay: BuddyRelay,
  credentials: BuddyCredentialStore,
  today: PrayerDay,
  { light = false }: { light?: boolean } = {}
) {
  const auth = await credentials.read();
  if (!auth) return;

  // The light pass is the one that runs on a timer while somebody is looking at Today, so it asks
  // the single question that changes minute to minute — has anything arrived? — and skips the
  // roster, which changes on the order of days. (The push token is not in here at all any more:
  // see `createPushTokenKeeper`.)
  if (light) {
    await drainInbox(relay, credentials, auth, today);
    return;
  }

  // The roster first, and not as an optimisation.
  //
  // An acceptor learns a pair id by redeeming a code; the inviter has no way to learn it at all
  // except by asking. A data-only push is sent, but iOS does not promise to run the app for one, so
  // an inviter watching their own invite code would otherwise see nothing happen when somebody took
  // it — and any mark that buddy sent would be dropped as coming from an unknown pair. Asking makes
  // it work without depending on a push, and it is also how a link ended from the other side is
  // noticed rather than waiting for a send to fail.
  // Read the epoch BEFORE asking, so an answer the user has since overtaken is recognised as
  // stale and dropped rather than undoing what they just did.
  const epoch = useBuddyStore.getState().epoch;
  const before = useBuddyStore.getState();
  const wasInvitingFor = before.inviteFor;
  const knownPairs = new Set(before.pairs.map((pair) => pair.pairId));

  const roster = await relay.listPairs(auth);
  if (roster.ok) {
    useBuddyStore.getState().actions.reconcilePairs(roster.value, Date.now(), epoch);

    // Somebody took the invite that was on screen. Tell the person who sent it — locally, because
    // this is the only phone that knows what language to say it in, and the acceptor's phone has no
    // idea. Once, for the first new pair, and never for a pair that simply arrived by other means.
    if (wasInvitingFor) {
      const added = useBuddyStore
        .getState()
        .pairs.find((pair) => !knownPairs.has(pair.pairId) && pair.nickname === wasInvitingFor.nickname);
      // Only when the app is out of sight: an acceptance discovered while it is open gets the
      // "new buddy" sheet, and a notification on top of that would be the same news twice. A cold
      // start reports `unknown` for a moment and is also an open app, so the test is for the two
      // states that mean "not looking", not for the absence of `active`.
      const away = AppState.currentState === 'background' || AppState.currentState === 'inactive';
      if (added && away) {
        void notifyInviteAccepted(
          i18n.t('buddy.accepted.title', { name: added.nickname || i18n.t('buddy.unnamed') }),
          i18n.t('buddy.accepted.body')
        ).catch(() => undefined);
      }
    }
  }

  await drainInbox(relay, credentials, auth, today);
}

/** Collect whatever is waiting, apply it, and tell the relay it may forget what was applied. */
async function drainInbox(
  relay: BuddyRelay,
  credentials: BuddyCredentialStore,
  auth: { deviceId: string; secret: string },
  today: PrayerDay
) {
  const result = await relay.fetchInbox(auth);
  if (!result.ok) {
    // `gone` means this phone's registration no longer exists on the relay — retired after ninety
    // quiet days, or wiped. Everything local goes with it; the person can pair again whenever.
    if (result.reason === 'gone') {
      useBuddyStore.getState().actions.setEnabled(false);
      await credentials.clear();
    }
    return;
  }

  const rows = result.value;
  if (rows.length === 0) return;

  const marks: BuddyMark[] = rows.map((row) => ({
    pairId: row.pairId,
    day: row.day,
    prayer: row.prayer,
    state: row.state,
  }));

  useBuddyStore.getState().actions.receive(marks, today);

  // Acknowledge ONLY what was applied. Acking is deleting, and a flag dated to a day this phone has
  // not reached yet was discarded by `applyMarks` — acking it would destroy it before it could ever
  // be shown. Two phones either side of a date line hit this every single day, in one direction,
  // silently. What is left behind is re-offered on the next pull, and expires on the relay in 24 h.
  const applied = rows.filter((row) => row.day === today).map((row) => row.id);
  if (applied.length > 0) await relay.ack(auth, applied);
}

/** How long a pull may take, all of it, before the next one is allowed to start anyway. */
const PULL_TIMEOUT_MS = 60_000;

/** How long the tracking store must be quiet before a mark's sync starts (D197). */
export const MARK_SETTLE_MS = 500;
/** A token that could not be had is asked for again after this — not on every pull. */
const TOKEN_RETRY_MS = 60_000;
/** An unchanged token is still handed to the relay this often, while the process lives. */
const TOKEN_REPUT_MS = 24 * 60 * 60 * 1000;

/**
 * The push token, kept off the path a mark takes out (D194).
 *
 * It used to be asked for inside every full sync, in line, before the inbox and before anything
 * outstanding was sent. `getExpoPushTokenAsync` is a native registration plus a fetch to Expo
 * with no timeout of its own; when it hung, the sync never finished, the single-flight flag never
 * cleared, and no mark of this phone's left again until the app was killed.
 *
 * So now: asked for once per mount (a success is kept in memory; a failure is retried after a
 * minute), never awaited by the sync, and never more than one at a time. And handed to the relay
 * not only when it changes but once per launch and once a day after that — the relay nulls a
 * token Expo calls dead and cannot use one it can no longer decrypt, and an unchanged token was
 * never sent again to heal either. The "once" lives in memory on purpose: remembering it across
 * launches would be a new stored field, and one extra PUT per launch costs nothing.
 */
function createPushTokenKeeper(relay: BuddyRelay, credentials: BuddyCredentialStore) {
  let token: string | null = null;
  let askedAt = -Infinity;
  let putAt = -Infinity;
  let busy = false;

  return async (now = Date.now()): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      if (!token && now - askedAt >= TOKEN_RETRY_MS) {
        askedAt = now;
        token = await getBuddyPushToken();
      }
      if (!token) return;
      const stale = token !== useBuddyStore.getState().pushToken || now - putAt >= TOKEN_REPUT_MS;
      if (!stale) return;
      const auth = await credentials.read();
      if (!auth) return;
      const stored = await relay.setPushToken(auth, token);
      if (stored.ok) {
        putAt = now;
        useBuddyStore.getState().actions.setPushToken(token);
      }
    } finally {
      busy = false;
    }
  };
}

/**
 * Tell one buddy about one prayer. Failure is silent to the user by design — but it is NOT silent
 * to the caller, which needs to know whether the flag actually left, so it can try again.
 *
 * @returns whether the relay has the flag now (or has told us the link is gone, which is settled
 *          either way — there is nobody left to tell).
 */
async function sendToPair(
  relay: BuddyRelay,
  auth: { deviceId: string; secret: string },
  request: SendMarkRequest
): Promise<boolean> {
  const result = await relay.send(auth, request);
  if (result.ok) return true;

  // The buddy ended the link, or the relay forgot it. Drop them locally and let the Buddies screen
  // say so once — never who, never why. Nothing is outstanding for a buddy who is gone.
  if (result.reason === 'gone') {
    useBuddyStore.getState().actions.endPair(request.pairId);
    return true;
  }
  return false;
}

/**
 * Send whatever a buddy ought to know and has not been successfully told.
 *
 * This is a **reconciliation, not a reaction**, and that distinction is the whole point. Written as
 * a reaction — diff on the store event, record, fire — a mark made with no signal was lost for the
 * rest of the day: the ledger said it had been told, and nothing ever looked again. Praying
 * somewhere without a connection is the ordinary case, not an edge.
 *
 * So it compares the day's record with what actually went out, sends the difference, and records
 * only what the relay accepted. Running it again is free when there is nothing outstanding, which
 * is what lets the inbox pull double as the retry.
 */
async function pushOutstanding(
  relay: BuddyRelay,
  credentials: BuddyCredentialStore,
  day: PrayerDay,
  compose: (input: { lang: string; prayer: Prayer }) => BuddyNotificationText | null
): Promise<void> {
  const buddy = useBuddyStore.getState();
  if (!buddy.enabled || buddy.pairs.length === 0) return;

  const statuses = useTrackingStore.getState().dayRecords[day]?.statuses;
  if (!statuses) return;

  // A first buddy has just arrived. Everything already logged today counts as told, so pairing at
  // noon does not land five flags and five notifications on them as a greeting. They see marks from
  // the moment you paired; an empty row means nothing arrived, as it does everywhere else here.
  if (buddy.seedPending) {
    useBuddyStore.getState().actions.seedSent(statuses);
    return;
  }

  // The ledger belongs to a day. An app left open across the Fajr boundary — a countdown on a
  // nightstand, which is exactly where this app sits — would otherwise read yesterday's entries
  // against today's prayers and decide the new day's Fajr had already been announced.
  const sent = buddy.day === day ? buddy.sent : {};

  const auth = await credentials.read();
  if (!auth) return;

  for (const prayer of PRAYERS) {
    const word = markStateFor(sent[prayer] === 'prayed' ? 'prayed' : 'unlogged', statuses[prayer]);
    if (word === null || sent[prayer] === word) continue;

    let delivered = false;
    for (const pair of useBuddyStore.getState().pairs) {
      // Written here, in the buddy's language, because the relay holds no copy and no language. A
      // buddy who has asked not to be told gets no words at all, which is how their phone stays
      // silent without the relay ever knowing their preference.
      let text: BuddyNotificationText | null = null;
      if (word === 'prayed' && pair.notify) {
        try {
          text = compose({ lang: pair.lang, prayer });
        } catch {
          text = null;
        }
      }

      const ok = await sendToPair(relay, auth, {
        pairId: pair.pairId,
        day,
        prayer,
        state: word,
        // Our own language, cached by the buddy's phone so it can address us next time.
        lang: i18n.language || 'en',
        notify: useBuddyStore.getState().notify,
        ...(text ? { title: text.title, titleNamed: text.titleNamed } : {}),
      });
      delivered = delivered || ok;
    }

    // Recorded only once it has actually gone somewhere. A flag that never left stays outstanding
    // and goes with the next pull.
    if (delivered) useBuddyStore.getState().actions.recordSent(prayer, word);
  }
}

/**
 * The words for a buddy's phone, written in *their* language.
 *
 * `getFixedT` is what makes that possible: it renders a language this phone is not itself using,
 * from the same authored bundles, so the relay never has to hold a translation.
 */
/**
 * The poll's heartbeat while the app is open and in front of somebody. Every tick asks the roster
 * while an invite is live (the inviter is watching for an acceptance); otherwise every
 * {@link INBOX_EVERY_TICKS}th tick asks for the inbox — thirty seconds, short enough that a buddy
 * undoing a prayer corrects itself while you are watching, long enough to be nothing against the
 * relay's sixty-a-minute ceiling.
 */
const POLL_TICK_MS = 4_000;
const INBOX_EVERY_TICKS = 8;

function defaultCompose({ lang, prayer }: { lang: string; prayer: Prayer }) {
  try {
    const translate = i18n.getFixedT(lang);
    return composeBuddyNotification((key, values) => String(translate(key, values as never)), prayer);
  } catch {
    // Words that cannot be rendered must never cost the flag itself. The buddy's row still fills
    // in; they simply are not told about it until they open the app.
    return null;
  }
}

export function useBuddySync(enabled: boolean, options: BuddySyncOptions = {}): void {
  const relay = options.relay ?? getBuddyRelay();
  const compose = options.composeNotification ?? defaultCompose;

  useEffect(() => {
    if (!enabled) return;

    const credentials = options.credentials ?? createBuddyCredentialStore();
    const keepPushToken = createPushTokenKeeper(relay, credentials);
    let disposed = false;

    // The store already owns the Fajr→Fajr boundary (`setTodayDayResolver`, installed by
    // `useTodayDayResolver`), so this asks it rather than re-deriving a day from the times engine
    // — two answers to "what day is it" is exactly how a mark lands on the wrong one.
    const currentDay = (): PrayerDay | null => {
      try {
        return getTrackingActions().todayDay();
      } catch {
        return null;
      }
    };

    // One sync at a time, with at most one more queued behind it. `pull` is called from the
    // subscriber (per changed prayer), from every foreground, and from every push — without this a
    // day marked in five taps would open five overlapping syncs racing each other's roster.
    let running = false;
    let again = false;

    const pull = () => {
      if (disposed || !useBuddyStore.getState().enabled) return;
      if (running) {
        again = true;
        return;
      }
      const day = currentDay();
      if (!day) return;

      // Roll the day over before anything else. Without this, a phone that hears nothing on a new
      // day keeps yesterday's table in MMKV indefinitely — a record of which buddy prayed which
      // prayer on a past day, which is precisely the history this feature does not keep. Nothing
      // renders it, but "no buddy history" is about what the phone holds, not only what it shows.
      // It is also what keeps the `sent` ledger pointed at the right day.
      useBuddyStore.getState().actions.syncDay(day);

      running = true;
      // What a widget already said goes into the ledger first (D180): a seal tapped on the home
      // screen was sent from the widget's own process, and reconciling without knowing that would
      // send it again — which the relay would swallow, but only because it must.
      const work = takeWidgetSent()
        .then((said) => {
          // Taken whole — the read empties the ledger, which is what keeps a stale line from being
          // absorbed twice — and recorded only for today. A tap on yesterday's widget row that sat
          // there until this morning must not mark today's prayer as already told.
          const today = said.filter((entry) => entry.day === day);
          if (today.length > 0) useBuddyStore.getState().actions.absorbSent(day, today);
        })
        // Own marks out FIRST (D194). A mark is the thing somebody is waiting to see on another
        // phone; nothing about the roster or the inbox should stand in front of it.
        .then(() => pushOutstanding(relay, credentials, day, compose))
        .then(() => syncWithRelay(relay, credentials, day))
        // And once more after the roster, which is free when nothing is outstanding. It is what
        // seeds a buddy the roster has just brought in (so they are not greeted with the morning),
        // and what retries a mark made with no signal: the ledger is a retry, not a record of
        // intentions.
        .then(() => pushOutstanding(relay, credentials, day, compose))
        .catch(() => {
          // Swallowed on purpose: a sync nobody asked for must not surface anything.
        });
      // Never awaited by the sync: a token that hangs must not hold the next mark back.
      void keepPushToken().catch(() => undefined);
      // Every call in here has a bound of its own, or should. This is the bound on the ones that
      // do not (native bridges), so the single-flight flag below can never stay set for good.
      void withTimeout(work, PULL_TIMEOUT_MS, undefined)
        .finally(() => {
          running = false;
          if (again && !disposed) {
            again = false;
            pull();
          }
        });
    };

    // The channel, but only for somebody who actually turned buddy mode on. An Android channel is
    // visible in system notification settings whether or not it is ever used, so creating it for
    // everybody would tell a person who has never opened the Buddies screen that the feature
    // exists — which D174 says must not happen.
    if (useBuddyStore.getState().enabled) {
      void configureBuddyNotifications({
        channelName: i18n.t('buddy.channel.name'),
        channelDescription: i18n.t('buddy.channel.description'),
      }).catch(() => undefined);
    }

    // The nicknames, mirrored where a notification can reach them.
    //
    // A buddy notification is written by the *sending* phone, which knows the language to use but
    // has no idea what we call them — that nickname was chosen here and has never left this phone
    // (D174). So the sender sends the sentence with a hole in it and the hole is filled on arrival,
    // by native code that runs when no JS can: a service extension on iOS, a messaging service on
    // Android. Neither can read MMKV, so the roster's names are copied into storage they can read.
    //
    // Names only, keyed by pair id. Not the marks, not the day, not the log.
    let mirrored = '';
    const mirrorNicknames = () => {
      const state = useBuddyStore.getState();
      const named: Record<string, string> = {};
      for (const pair of state.pairs) {
        if (pair.nickname) named[pair.pairId] = pair.nickname;
      }
      const next = JSON.stringify(named);
      if (next === mirrored) return;
      mirrored = next;
      void setBuddyNicknames(named);
    };

    mirrorNicknames();

    // And everything a process with no JS needs in order to tell the buddies itself (D180): each
    // pair's id, language and preference, and the five sentences in their language. Rewritten
    // whenever any of those inputs change; the widget reads it at the moment of a tap.
    let mirroredOutbox = '';
    const mirrorOutbox = () => {
      const state = useBuddyStore.getState();
      const outbox = buildOutbox({
        pairs: state.pairs,
        lang: i18n.language || 'en',
        notify: state.notify,
        compose: composeForOutbox,
      });
      const next = JSON.stringify(outbox);
      if (next === mirroredOutbox) return;
      mirroredOutbox = next;
      void writeBuddyOutbox(outbox);
    };

    mirrorOutbox();

    const unsubscribeRoster = useBuddyStore.subscribe((state, previous) => {
      if (disposed) return;
      if (state.pairs !== previous.pairs) mirrorNicknames();
      if (state.pairs !== previous.pairs || state.notify !== previous.notify) mirrorOutbox();
    });

    pull();

    // Every return to the foreground. This is the path that catches a notification the person
    // swiped away, or one iOS never woke us for.
    const appState = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') pull();
    });

    // A poll while somebody is actually looking at the app.
    //
    // A buddy undoing a prayer sends a data-only push, and iOS does not reliably hand those to a
    // foregrounded app — so without this the row only corrected on the next background→foreground
    // trip, which is exactly what the first tester saw. The light pass asks for the inbox and
    // nothing else, so it is two requests a minute against a limit of sixty.
    //
    // While an invite is live the question is a different one — has anybody taken it? — and it
    // is being watched: the inviter is sitting with the code on screen. So the poll asks the
    // roster instead, every few seconds, and the acceptance collapses the code in place. The
    // `paired` push does the same job when it arrives, but iOS does not promise it will.
    let ticks = 0;
    const poll = setInterval(() => {
      if (disposed || AppState.currentState !== 'active') return;
      const state = useBuddyStore.getState();
      if (!state.enabled) return;
      ticks += 1;
      if (state.invite !== null) {
        pull();
        return;
      }
      if (ticks % INBOX_EVERY_TICKS !== 0) return;
      const day = currentDay();
      if (!day) return;
      void syncWithRelay(relay, credentials, day, { light: true }).catch(() => undefined);
    }, POLL_TICK_MS);

    // The language this phone reads is carried on every mark, so a buddy learns it eventually. This
    // makes "eventually" mean "now" for the case somebody actually notices: changing the language
    // in Settings and wondering why their buddy is still being written to in English.
    const onLanguageChanged = () => {
      if (disposed) return;
      mirrorOutbox();
      void (async () => {
        const auth = await credentials.read();
        if (!auth) return;
        const me = useBuddyStore.getState();
        for (const pair of me.pairs) {
          await relay.sendPrefs(auth, {
            pairId: pair.pairId,
            lang: i18n.language || 'en',
            notify: me.notify,
          });
        }
      })().catch(() => undefined);
    };
    i18n.on('languageChanged', onLanguageChanged);

    // A push that does reach us, applied at once rather than at the next foreground — and the only
    // place a buddy's own language and notification preference can be learned, since the relay
    // deliberately holds neither and so cannot put them in an inbox row.
    const unsubscribePush = subscribeToBuddyPushes((payload) => {
      if (disposed) return;
      const actions = useBuddyStore.getState().actions;

      if (payload.type === 'unpaired') {
        actions.endPair(payload.pairId);
        return;
      }
      if (payload.type === 'prefs') {
        actions.rememberBuddyPreferences(payload.pairId, payload.lang, payload.notify);
        return;
      }
      if (payload.type !== 'mark') {
        // `paired`. The roster pull records it, and it knows how to pick a free avatar.
        pull();
        return;
      }

      actions.rememberBuddyPreferences(payload.pairId, payload.lang, payload.notify);
      const day = currentDay();
      if (day) {
        actions.receive(
          [{ pairId: payload.pairId, day: payload.day, prayer: payload.prayer, state: payload.state }],
          day
        );
      }
    });

    // A tap's sync waits for the taps to stop (D197): half a second, so marking three prayers in a
    // row sends once, after the third, and nothing of the sync runs between two of the taps.
    let markTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useTrackingStore.subscribe((state, previous) => {
      if (disposed) return;
      if (state.revision === previous.revision) return;
      // Marking a prayer is not handled here beyond noticing that something changed: what to send
      // is decided by comparing the day's record with what actually went out, which is the same
      // question the next foreground asks, and answering it in one place is what makes a failed
      // send recoverable.
      clearTimeout(markTimer);
      markTimer = setTimeout(pull, MARK_SETTLE_MS);
    });

    return () => {
      disposed = true;
      unsubscribe();
      unsubscribeRoster();
      appState.remove();
      unsubscribePush();
      clearInterval(poll);
      clearTimeout(markTimer);
      i18n.off('languageChanged', onLanguageChanged);

      // Only when the feature itself was switched off — which is the one teardown that means the
      // names should stop existing outside MMKV. A teardown that is really a re-subscription must
      // leave them exactly where they are: this hook unmounts at the moment a notification is most
      // likely to arrive, and a cleared map would silently cost the next one its nickname.
      if (!useBuddyStore.getState().enabled) {
        void clearBuddyNicknames();
        void clearBuddyOutbox();
      }
    };
  }, [enabled, relay, compose, options.credentials]);
}
