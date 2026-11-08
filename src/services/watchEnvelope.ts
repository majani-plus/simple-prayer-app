/**
 * The watch envelope (Milestone V) — everything a watch will ever say, resolved in advance.
 *
 * A watch is the third native reader of the app's precomputed world, and the same law that
 * governs widgets (D102) governs it: no domain logic in Swift or Kotlin, ever. The envelope
 * therefore WRAPS the widget snapshot rather than extending it — the widget contract stays at
 * version 1, untouched, and the watch-only extras ride alongside:
 *
 * - **`snapshot`** — the same fully-resolved 14-day timeline the widgets render. The watch app,
 *   the complications, and the Wear tile all draw from it; the pending-marks queue is laid over
 *   statuses at render time under the same contract (`overlay-cases.json`).
 * - **`qibla`** — the bearing to the Kaaba, precomputed here from `domain/qibla`. The watch
 *   compares its OS heading to this one number; that comparison is rendering math, not domain
 *   logic, exactly as a segment lookup is.
 * - **`alerts`** — pre-rendered adhan notifications for the Wear watch's conditional local
 *   alerts (they fire only when the phone is away — checked natively at the alarm's own moment,
 *   so there is never a duplicate buzz; iOS has no such path and relies on mirrored phone
 *   notifications). Every string is final: title, body, and the marked-confirmation line travel
 *   ready to post, composed through the app's own translator from the same keys the phone's
 *   notifications use (D111). The watch composes nothing.
 *
 * Like `widgetSnapshot.ts`, this module is deliberately pure: no store, no platform module, no
 * i18n import — the translator arrives as a dep. The impure edge is `services/watch.ts`.
 */

import { qiblaBearing } from '../domain/qibla';
import type { Coordinates, Prayer, PrayerDay } from '../domain/types';
import { WIDGET_SNAPSHOT_VERSION, type WidgetSnapshot } from './widgetSnapshot';

// ---------------------------------------------------------------------------
// The contract (versioned like the snapshot's — old envelopes are rejected, never guessed at)
// ---------------------------------------------------------------------------

/**
 * Bumped whenever a field changes meaning or shape. A native reader that finds any other version
 * (in the envelope OR in the wrapped snapshot) renders its bundled "open the app" state.
 */
export const WATCH_ENVELOPE_VERSION = 1;

/** One adhan the Wear watch may post locally — but only if the phone is away at that moment. */
export interface WatchAlertEntry {
  day: PrayerDay;
  prayer: Prayer;
  /** The prayer's start — when the alarm fires. Epoch ms. */
  at: number;
  /** "Asr · العصر" — `notifications.adhan.title`, final. */
  title: string;
  /** "It's time to pray · 3:47 pm" — `notifications.adhan.body`, final. */
  body: string;
  /** "Asr marked" — the confirmation posted after the "I prayed" action (D92). */
  markedTitle: string;
}

/** The Wear watch's conditional local-alert plan. Empty entries = nothing to schedule. */
export interface WatchAlerts {
  /**
   * Future adhans within the snapshot horizon, in time order, only for prayers whose adhan the
   * user has on. The watch schedules these and re-checks phone reachability at each fire.
   */
  entries: WatchAlertEntry[];
  /** "I prayed" — the action button (D105). */
  prayedLabel: string;
  /** "Undo" — the confirmation's action. */
  undoLabel: string;
}

/** The compass page's needs: one number, and the words that must never be composed natively.
 * The live degree readout is the one sanctioned native formatting (a number in the app
 * language's numerals — the same class of exception as the widgets' system-rendered countdown).
 */
export interface WatchQibla {
  /** Bearing to the Kaaba in degrees clockwise from TRUE north. */
  bearing: number;
  /** "Qibla" — `tabs.qibla`; names the qibla page in the Today footer's scroll hint. */
  titleLabel: string;
  /** The four cardinal letters (`qibla.cardinal.*`) engraved on the dial (owner, 2026-08-28). */
  north: string;
  east: string;
  south: string;
  west: string;
  /** "Facing the Qibla" — `qibla.status.aligned`, shown only while aligned (D86). */
  alignedLabel: string;
  /** "to the left" / "to the right" — beside the native-rendered degree count. */
  toLeftLabel: string;
  toRightLabel: string;
}

/** The whole envelope, exactly as serialized for the watch. */
export interface WatchEnvelope {
  version: typeof WATCH_ENVELOPE_VERSION;
  snapshot: WidgetSnapshot;
  /** `null` when the bearing cannot be computed (no location). */
  qibla: WatchQibla | null;
  alerts: WatchAlerts;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface WatchEnvelopeInput {
  /** The already-built widget snapshot (one build, many sinks is the caller's business). */
  snapshot: WidgetSnapshot;
  now: Date;
  /** The location the snapshot was built for; `null` yields a `null` qibla. */
  location: Coordinates | null;
  /** Which prayers' adhan is on (`settings.reminders[prayer].adhanEnabled`). */
  adhanEnabled: Record<Prayer, boolean>;
}

export interface WatchEnvelopeDeps {
  /** The app's translator, already bound to the app language. */
  translate: (key: string, params?: Record<string, unknown>) => string;
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/**
 * Wraps a built snapshot into the watch envelope. Never returns `null`: an honest snapshot in
 * means an honest envelope out (the "cannot build" answer lives with the snapshot builder).
 *
 * @param input - The snapshot and the world it was built from.
 * @param deps - The translator.
 */
export function buildWatchEnvelope(
  input: WatchEnvelopeInput,
  deps: WatchEnvelopeDeps
): WatchEnvelope {
  const nowMs = input.now.getTime();

  const entries: WatchAlertEntry[] = [];
  for (const day of input.snapshot.days) {
    for (const prayer of day.prayers) {
      if (!input.adhanEnabled[prayer.prayer]) continue;
      if (prayer.at <= nowMs) continue;
      entries.push({
        day: day.day,
        prayer: prayer.prayer,
        at: prayer.at,
        // The same composition the phone's adhan uses (D111): the name already knows Friday
        // (D77), and in Arabic the template carries no `· {{arabic}}` suffix, so the fallback
        // for a null companion never shows.
        title: deps.translate('notifications.adhan.title', {
          prayer: prayer.name,
          arabic: prayer.arabicName ?? prayer.name,
        }),
        body: deps.translate('notifications.adhan.body', { time: prayer.timeText }),
        markedTitle: deps.translate('notifications.marked.title', { prayer: prayer.name }),
      });
    }
  }
  entries.sort((a, b) => a.at - b.at);

  const bearing = input.location === null ? Number.NaN : qiblaBearing(input.location);

  return {
    version: WATCH_ENVELOPE_VERSION,
    snapshot: input.snapshot,
    qibla: Number.isFinite(bearing)
      ? {
          bearing,
          titleLabel: deps.translate('tabs.qibla'),
          north: deps.translate('qibla.cardinal.n'),
          east: deps.translate('qibla.cardinal.e'),
          south: deps.translate('qibla.cardinal.s'),
          west: deps.translate('qibla.cardinal.w'),
          alignedLabel: deps.translate('qibla.status.aligned'),
          toLeftLabel: deps.translate('watch.qibla.toLeft'),
          toRightLabel: deps.translate('watch.qibla.toRight'),
        }
      : null,
    alerts: {
      entries,
      prayedLabel: deps.translate('notifications.actions.prayed'),
      undoLabel: deps.translate('notifications.actions.undo'),
    },
  };
}

/**
 * Parses what a native bridge stored. Anything that is not this build's version — the envelope's
 * or the wrapped snapshot's — is `null`: the reader shows its bundled state rather than guessing.
 *
 * @param raw - The stored JSON string.
 * @returns The envelope, or `null` when it cannot be trusted.
 */
export function parseWatchEnvelope(raw: string | null | undefined): WatchEnvelope | null {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object') return null;
    const envelope = value as WatchEnvelope;
    if (envelope.version !== WATCH_ENVELOPE_VERSION) return null;
    const snapshot = envelope.snapshot as WidgetSnapshot | undefined;
    if (snapshot === undefined || snapshot === null) return null;
    if (snapshot.version !== WIDGET_SNAPSHOT_VERSION) return null;
    if (!Array.isArray(snapshot.days) || !Array.isArray(snapshot.segments)) return null;
    if (!Array.isArray(envelope.alerts?.entries)) return null;
    return envelope;
  } catch {
    return null;
  }
}
