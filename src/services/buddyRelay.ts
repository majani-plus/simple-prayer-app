/**
 * The buddy relay client — **the only module in the app's JavaScript that opens a network
 * connection.** Two native senders (`targets/widget/BuddySender.swift`, the bridge module's
 * `BuddySender.kt`) post the same `/send` payload to the same host from the widget and
 * notification processes (D180); `privacyClaims.test.ts` pins the host in all three.
 *
 * That is not a coincidence or a convenience; it is enforced. `src/__tests__/privacyClaims.test.ts`
 * fails the build if `fetch` appears anywhere else under `src/services/`, and it pins the host
 * below. Before buddy mode there was no such module at all, and the pledge in Settings said so. If
 * you are here to add a second network call to this app, the pledge, the privacy policy and both
 * stores' data-safety answers change in the same commit, or the build stops you. That is working
 * as intended.
 *
 * What crosses: one flag per prayer, `prayed` or `cleared`, for today, to one paired device. The
 * relay stores it until that device collects it, or 24 hours, whichever comes first. It holds no
 * name, no location, no language, no copy and no logs. Source:
 * https://github.com/majani-plus/simple-prayer-relay
 *
 * Everything here **fails quietly**. A relay that is down, slow or unreachable must never be
 * something a person notices while they are trying to mark a prayer: the rows simply stay as they
 * were, and the next sync catches up. No call here ever throws at a caller.
 */

import type { Prayer, PrayerDay } from '../domain/types';
import type { BuddyMark, MarkState } from '../domain/buddies';
import type { BuddyCredentials } from './buddyCredentials';

/** The one host this app talks to. Pinned by `privacyClaims.test.ts`. */
export const RELAY_ORIGIN = 'https://relay.simpleprayer.app';

/** Nobody waits on a buddy. If the relay has not answered by now, the next sync will do. */
const TIMEOUT_MS = 8_000;

export interface RelayDevice {
  deviceId: string;
  secret: string;
}

export interface RelayInvite {
  code: string;
  display: string;
  expiresAt: number;
}

/** What the sending phone asks the relay to hand on. */
export interface SendMarkRequest {
  pairId: string;
  day: PrayerDay;
  prayer: Prayer;
  state: MarkState;
  /** This phone's own language and preference, cached by the buddy so it can address us next time. */
  lang: string;
  notify: boolean;
  /**
   * The notification, already written **by us, in the buddy's language**. One line. Omitted when
   * the buddy has asked not to be told, which is how the relay stays free of both copy and
   * preferences.
   */
  title?: string;
  /**
   * The same sentence with `{}` where a name belongs. The buddy's phone swaps in the nickname *it*
   * chose for us as the notification is delivered — nothing here knows that nickname, and neither
   * does the relay, which is the whole point: a notification can read "Amina prayed Dhuhr" without
   * the name ever having been sent anywhere. See `modules/buddy-nicknames`.
   */
  titleNamed?: string;
}

/**
 * Every call answers one of these. There is no thrown error to catch and no message to show: a
 * caller either got what it asked for, or it did not and will try later.
 *
 * `gone` is the one outcome worth acting on — the relay says this pair or this device no longer
 * exists, so the phone should forget it rather than keep asking.
 */
export type RelayResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'offline' | 'refused' | 'gone' | 'full' };

export interface BuddyRelay {
  register(): Promise<RelayResult<RelayDevice>>;
  setPushToken(credentials: BuddyCredentials, token: string): Promise<RelayResult<null>>;
  createInvite(credentials: BuddyCredentials): Promise<RelayResult<RelayInvite>>;
  redeem(credentials: BuddyCredentials, code: string): Promise<RelayResult<{ pairId: string }>>;
  /** The links this phone has, according to the relay. Ids only — never who they are with. */
  listPairs(credentials: BuddyCredentials): Promise<RelayResult<string[]>>;
  /** Tell one buddy the language to address us in, and whether we want to be told at all. */
  sendPrefs(
    credentials: BuddyCredentials,
    prefs: { pairId: string; lang: string; notify: boolean }
  ): Promise<RelayResult<null>>;
  send(credentials: BuddyCredentials, request: SendMarkRequest): Promise<RelayResult<null>>;
  fetchInbox(credentials: BuddyCredentials): Promise<RelayResult<(BuddyMark & { id: string })[]>>;
  ack(credentials: BuddyCredentials, ids: readonly string[]): Promise<RelayResult<null>>;
  unpair(credentials: BuddyCredentials, pairId: string): Promise<RelayResult<null>>;
  /** Withdraw an invite this phone made, so the code stops working. Idempotent on the relay. */
  withdrawInvite(credentials: BuddyCredentials, code: string): Promise<RelayResult<null>>;
  forgetDevice(credentials: BuddyCredentials): Promise<RelayResult<null>>;
}

interface RelayOptions {
  origin?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function isMark(value: unknown): value is BuddyMark & { id: string } {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.pairId === 'string' &&
    typeof row.day === 'string' &&
    typeof row.prayer === 'string' &&
    (row.state === 'prayed' || row.state === 'cleared')
  );
}

export function createBuddyRelay(options: RelayOptions = {}): BuddyRelay {
  const origin = options.origin ?? RELAY_ORIGIN;
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  // `auth` rather than `credentials`: `RequestInit` already has a `credentials` field, and letting
  // the two share a name silently widened the type rather than erroring at the call sites.
  async function call<T>(
    path: string,
    init: RequestInit & { auth?: BuddyCredentials },
    parse: (body: unknown) => T | undefined
  ): Promise<RelayResult<T>> {
    const { auth, ...rest } = init;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (auth) {
      headers.authorization = `Bearer ${auth.deviceId}.${auth.secret}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await doFetch(`${origin}${path}`, {
        ...rest,
        headers,
        signal: controller.signal,
      });

      // 401 means this phone's registration is gone from the relay — retired after 90 quiet days,
      // or wiped. 404 on a pair means the buddy ended the link. Both mean "stop asking".
      if (response.status === 401 || response.status === 404) return { ok: false, reason: 'gone' };
      if (response.status === 409) return { ok: false, reason: 'full' };
      if (!response.ok) return { ok: false, reason: 'refused' };
      if (response.status === 204) return { ok: true, value: parse(null) as T };

      const text = await response.text();
      const body: unknown = text.length > 0 ? JSON.parse(text) : null;
      const value = parse(body);
      return value === undefined ? { ok: false, reason: 'refused' } : { ok: true, value };
    } catch {
      // No connection, a timeout, or a body that was not what we expected. All the same to a
      // caller: nothing happened, try again later.
      return { ok: false, reason: 'offline' };
    } finally {
      clearTimeout(timer);
    }
  }

  const nothing = () => null;

  return {
    register: () =>
      call<RelayDevice>('/device', { method: 'POST' }, (body) => {
        const row = body as Partial<RelayDevice> | null;
        return typeof row?.deviceId === 'string' && typeof row?.secret === 'string'
          ? { deviceId: row.deviceId, secret: row.secret }
          : undefined;
      }),

    setPushToken: (credentials, token) =>
      call<null>(
        '/device/token',
        { method: 'PUT', auth: credentials, body: JSON.stringify({ pushToken: token }) },
        nothing
      ),

    createInvite: (credentials) =>
      call<RelayInvite>('/invite', { method: 'POST', auth: credentials }, (body) => {
        const row = body as Partial<RelayInvite> | null;
        return typeof row?.code === 'string' && typeof row?.expiresAt === 'number'
          ? { code: row.code, display: row.display ?? row.code, expiresAt: row.expiresAt }
          : undefined;
      }),

    redeem: (credentials, code) =>
      call<{ pairId: string }>(
        '/pair',
        { method: 'POST', auth: credentials, body: JSON.stringify({ code }) },
        (body) => {
          const row = body as { pairId?: unknown } | null;
          return typeof row?.pairId === 'string' ? { pairId: row.pairId } : undefined;
        }
      ),

    listPairs: (credentials) =>
      call<string[]>('/pairs', { auth: credentials }, (body) => {
        const rows = (body as { pairs?: unknown } | null)?.pairs;
        return Array.isArray(rows) ? rows.filter((id): id is string => typeof id === 'string') : undefined;
      }),

    sendPrefs: (credentials, prefs) =>
      call<null>('/prefs', { method: 'POST', auth: credentials, body: JSON.stringify(prefs) }, nothing),

    send: (credentials, request) =>
      call<null>('/send', { method: 'POST', auth: credentials, body: JSON.stringify(request) }, nothing),

    fetchInbox: (credentials) =>
      call<(BuddyMark & { id: string })[]>('/inbox', { auth: credentials }, (body) => {
        const rows = (body as { marks?: unknown } | null)?.marks;
        return Array.isArray(rows) ? rows.filter(isMark) : undefined;
      }),

    ack: (credentials, ids) =>
      call<null>(
        '/inbox/ack',
        { method: 'POST', auth: credentials, body: JSON.stringify({ ids }) },
        nothing
      ),

    unpair: (credentials, pairId) =>
      call<null>(`/pair/${pairId}`, { method: 'DELETE', auth: credentials }, nothing),

    withdrawInvite: (credentials, code) =>
      call<null>(`/invite/${code}`, { method: 'DELETE', auth: credentials }, nothing),

    forgetDevice: (credentials) => call<null>('/device', { method: 'DELETE', auth: credentials }, nothing),
  };
}

let shared: BuddyRelay | null = null;

/** The app-wide client, built on first use. */
export function getBuddyRelay(): BuddyRelay {
  shared ??= createBuddyRelay();
  return shared;
}
