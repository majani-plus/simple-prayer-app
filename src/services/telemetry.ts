/**
 * Telemetry service — the only module in the app that knows Sentry exists.
 *
 * ## What this is, and what it is not
 *
 * This app's entire positioning is that it collects nothing about the user (docs/DECISIONS.md
 * D31, our market research). Crash reporting ships anyway, on one explicit basis: a crash
 * report is DIAGNOSTIC data about the *code*, not behavioural data about the *person*. Every
 * configuration choice in {@link buildTelemetryOptions} exists to hold that line, and each one
 * says why inline. The user can turn the whole thing off in Settings → Support → Crash reports
 * (`crashReportingEnabled`, read once at startup by `app/_layout.tsx`).
 *
 * What a crash report contains: the stack trace, the app version and release, the device model
 * and OS version, and Sentry's anonymous per-install event metadata. What it must NEVER contain:
 * the prayer log, the location, any settings value, screenshots or screen recordings, an IP
 * address kept on file, or any identifier tying events to a person. `services/telemetry.test.ts`
 * pins the configuration so that turning any of that on requires consciously breaking a test
 * that explains why it was off.
 *
 * ## Why the adapter is injectable
 *
 * `@sentry/react-native` is a native module; importing it eagerly breaks plain Jest runs.
 * Everything goes through {@link TelemetryAdapter} — the app uses
 * {@link createSentryTelemetryAdapter} (which `require`s the SDK lazily on first use, the same
 * trick `services/heading.ts` and `services/notifications.ts` use) and tests use
 * {@link createFakeTelemetryAdapter}. A client without the module — Jest, Expo Go, a build that
 * stripped it — degrades silently: {@link TelemetryService.start} swallows the failure and the
 * app runs exactly as if reporting were off.
 *
 * ## Failure policy
 *
 * Nothing here throws, ever. Telemetry exists to observe failures; a failure *in* telemetry
 * white-screening the prayer app it observes would be absurd. Every adapter call is wrapped.
 *
 * Dependency rule: `services → domain`. No React Native, no stores, no i18n, no user-facing
 * strings. (The one `react` import is type-only, for the root-component wrapper's signature.)
 */

import type { ComponentType } from 'react';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * The Sentry DSN, from `app.json` → `extra.sentryDsn` (read back through `expo-constants`). Ours
 * points at the **EU** ingest region (`.de.`), which keeps crash data under EU jurisdiction. A DSN
 * is a publishable client key: it can only submit events, never read them, so shipping it in the
 * binary is by design.
 *
 * No DSN — a FOSS build (`FOSS_BUILD=1`, docs/BUILD_YOURSELF.md) or a fork — means no crash
 * reporting at all: Sentry never starts, and the Settings toggle and the pledge's crash-report
 * sentence are not shown.
 *
 * @param extra - `expo.extra`; defaults to the running app's config.
 * @returns The DSN, or `null` when none is configured.
 */
export function sentryDsn(extra?: unknown): string | null {
  let source = extra;
  if (source === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      source = (require('expo-constants') as typeof import('expo-constants')).default.expoConfig
        ?.extra;
    } catch {
      // No expo-constants (a node script): no DSN.
    }
  }
  const dsn =
    typeof source === 'object' && source !== null
      ? (source as { sentryDsn?: unknown }).sentryDsn
      : undefined;
  return typeof dsn === 'string' && dsn.trim() !== '' ? dsn.trim() : null;
}

/**
 * The subset of a Sentry event {@link scrubTelemetryEvent} cares about. Typed by us rather than
 * imported from the SDK so this module (and its tests) never need the SDK's types at runtime.
 */
export interface TelemetryEvent {
  /** Any user identity the SDK or a future integration attached. Always removed. */
  user?: unknown;
  /** The trail of what the user was doing before the event. Always removed. */
  breadcrumbs?: unknown;
  /** HTTP request context (headers, cookies). Never applicable here; removed anyway. */
  request?: unknown;
}

/** The option bag handed to `Sentry.init`, typed as exactly what this app decided to send. */
export interface TelemetryInitOptions {
  dsn: string;
  sendDefaultPii: boolean;
  replaysSessionSampleRate: number;
  replaysOnErrorSampleRate: number;
  enableAutoSessionTracking: boolean;
  maxBreadcrumbs: number;
  attachScreenshot: boolean;
  attachViewHierarchy: boolean;
  environment: string;
  beforeSend: (event: TelemetryEvent) => TelemetryEvent;
}

/**
 * The last line of defence: strips anything user-identifying from an outgoing event, whatever
 * put it there. The options above should mean these fields are never populated in the first
 * place; this makes "never sent" true even if a future SDK default or integration disagrees.
 *
 * @param event - The event Sentry is about to send. Mutated in place, as `beforeSend` allows.
 * @returns The same event, with identity, breadcrumbs and request context removed.
 */
export function scrubTelemetryEvent<T extends TelemetryEvent>(event: T): T {
  // Nothing in this codebase ever assigns a Sentry user identity (telemetry.test.ts pins that
  // against this file's source), so `user` should always be empty — but an SDK default (or a
  // future "let's enrich events" change) must not be able to sneak one out.
  delete event.user;
  // Belt and braces with `maxBreadcrumbs: 0` below: breadcrumbs are a record of what the person
  // was doing, which is exactly the data this app pledges not to collect.
  delete event.breadcrumbs;
  delete event.request;
  return event;
}

/**
 * Builds the full `Sentry.init` configuration. Exported (and unit-tested) so that every privacy
 * decision here is a named, pinned fact rather than an implicit SDK default.
 *
 * @param dsn - Where events go; see {@link sentryDsn}.
 * @returns The options {@link createSentryTelemetryAdapter} passes to the SDK.
 */
export function buildTelemetryOptions(dsn: string): TelemetryInitOptions {
  return {
    dsn,

    // Never attach IP addresses, device identifiers or anything else Sentry classes as
    // "default PII". Events stay anonymous; two crashes from the same phone are just two crashes.
    sendDefaultPii: false,

    // NO session replay, ever. Replay records the screen — and this app's screens show a
    // person's prayer history and menstruation-exemption days. Recording that would be a
    // serious privacy breach and would make the pledge (D31) indefensible. Both rates are
    // pinned to 0 (and the replay integration is never added) so that even an SDK that ships
    // replay-by-default sends nothing.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // NO performance tracing for 1.0 — `tracesSampleRate` is deliberately ABSENT, which is the
    // SDK's "tracing entirely off". This is a decision, not an oversight: tracing transmits
    // spans about screens visited and requests made, for a performance-tuning value this app
    // does not need yet. If 1.x ever wants it, add the rate here and update telemetry.test.ts,
    // which pins its absence.

    // Anonymous session start/end markers ARE sent. This is a considered trade: sessions are
    // what turn raw crashes into a crash-free-sessions rate — release health, which is most of
    // the reason to have crash reporting at all. A session carries timestamps, release and
    // device class; with `sendDefaultPii: false` and no user it identifies nobody.
    enableAutoSessionTracking: true,

    // No breadcrumbs: they are a timeline of what the user did (taps, navigation, console
    // lines) leading up to the crash — behavioural data. The stack trace has to be enough.
    maxBreadcrumbs: 0,

    // Never photograph the screen on an error — same reasoning as replay, one frame at a time.
    attachScreenshot: false,
    // The view hierarchy embeds rendered text (prayer names, dates, the log). Not sent.
    attachViewHierarchy: false,

    // Keeps dev-client noise out of the release-health numbers the owner acts on.
    environment: __DEV__ ? 'development' : 'production',

    beforeSend: scrubTelemetryEvent,
  };
}

// ---------------------------------------------------------------------------
// Adapter contract
// ---------------------------------------------------------------------------

/** Everything the service needs from the SDK. */
export interface TelemetryAdapter {
  /** Starts the SDK. May throw when the module or its native side is unavailable. */
  init(options: TelemetryInitOptions): void;
  /** Reports one handled error. */
  captureException(error: unknown): void;
  /**
   * Wraps the root component with the SDK's instrumentation boundary, per the expo-router
   * guidance (`Sentry.wrap` around the root layout's default export).
   */
  wrapRoot<P extends Record<string, unknown>>(component: ComponentType<P>): ComponentType<P>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** The surface the app consumes. Deliberately small: initialise, report, wrap. Nothing else. */
export interface TelemetryService {
  /**
   * Starts crash reporting — once, and only when `enabled` (the persisted
   * `crashReportingEnabled` setting, read by the caller). Never throws: an unavailable SDK
   * leaves the service inert and the app indistinguishable from reporting-off.
   *
   * @param enabled - The user's setting. `false` initialises nothing at all.
   * @returns Whether the SDK is running afterwards.
   */
  start(enabled: boolean): boolean;
  /** Whether {@link start} has successfully initialised the SDK. */
  isStarted(): boolean;
  /**
   * Reports an error the app caught and survived (e.g. a failed database migration). A no-op
   * when reporting is off or unavailable; never throws.
   */
  reportError(error: unknown): void;
  /**
   * The SDK's root wrapper when reporting is running; the component unchanged otherwise — so
   * an opted-out user's tree contains no Sentry component at all.
   */
  wrapRoot<P extends Record<string, unknown>>(component: ComponentType<P>): ComponentType<P>;
}

/**
 * Builds a {@link TelemetryService} over an adapter.
 *
 * @param adapter - SDK access; the app passes {@link createSentryTelemetryAdapter}.
 * @param dsn - Where events go. `null` (no DSN configured) means the service never starts.
 * @returns A service whose methods never throw.
 */
export function createTelemetryService(
  adapter: TelemetryAdapter,
  dsn: string | null = sentryDsn()
): TelemetryService {
  let started = false;

  return {
    start(enabled) {
      if (!enabled || started || dsn === null) return started;
      try {
        adapter.init(buildTelemetryOptions(dsn));
        started = true;
      } catch {
        // The SDK or its native module is absent (Jest, Expo Go, a stripped build). Crash
        // reporting is an extra; the app must run identically without it, in silence.
      }
      return started;
    },

    isStarted: () => started,

    reportError(error) {
      if (!started) return;
      try {
        adapter.captureException(error);
      } catch {
        // Reporting a failure must never become a failure.
      }
    },

    wrapRoot(component) {
      if (!started) return component;
      try {
        return adapter.wrapRoot(component);
      } catch {
        return component;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Sentry adapter
// ---------------------------------------------------------------------------

type SentryModule = typeof import('@sentry/react-native');

/**
 * The real adapter, over `@sentry/react-native`.
 *
 * The SDK is `require`d lazily on first use — the same trick `services/heading.ts` uses — so
 * importing this file stays safe under Jest and in node scripts, and a client without the
 * module fails inside the service's try/catch instead of at import.
 *
 * @returns A {@link TelemetryAdapter} bound to the Sentry SDK.
 */
export function createSentryTelemetryAdapter(): TelemetryAdapter {
  let module: SentryModule | null = null;
  const load = (): SentryModule => {
    if (module === null) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      module = require('@sentry/react-native') as SentryModule;
    }
    return module;
  };

  return {
    init(options) {
      // Our option bag is the privacy-scoped subset typed above; the SDK's own option type is
      // far wider (and every field we set is a documented `Sentry.init` option).
      load().init(options as unknown as Parameters<SentryModule['init']>[0]);
    },

    captureException(error) {
      load().captureException(error);
    },

    wrapRoot(component) {
      return load().wrap(component);
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory adapter (tests, and any environment without the SDK)
// ---------------------------------------------------------------------------

/** Scripted behaviour for {@link createFakeTelemetryAdapter}; mutable on the returned adapter. */
export interface FakeTelemetryConfig {
  /** Method names that should throw, to exercise the degrade-silently paths. */
  failing?: Set<keyof TelemetryAdapter>;
}

/** A {@link TelemetryAdapter} backed by arrays, plus call counters. */
export interface FakeTelemetryAdapter extends TelemetryAdapter {
  config: FakeTelemetryConfig;
  /** Every option bag `init` received. */
  readonly initOptions: TelemetryInitOptions[];
  /** Every error `captureException` received. */
  readonly captured: unknown[];
  calls: Record<'init' | 'captureException' | 'wrapRoot', number>;
}

/**
 * Builds an in-memory {@link TelemetryAdapter} — the test double for the whole telemetry layer.
 * Exported from the production module for the same reason `createFakeHeadingAdapter` is: the
 * seam has to be reachable without importing a test file.
 *
 * @param config - Initial scripted behaviour; mutable afterwards via `adapter.config`.
 * @returns A fake adapter with call counters and inspectable state.
 */
export function createFakeTelemetryAdapter(config: FakeTelemetryConfig = {}): FakeTelemetryAdapter {
  const initOptions: TelemetryInitOptions[] = [];
  const captured: unknown[] = [];

  const adapter: FakeTelemetryAdapter = {
    config: { ...config },
    initOptions,
    captured,
    calls: { init: 0, captureException: 0, wrapRoot: 0 },

    init(options) {
      adapter.calls.init += 1;
      fail('init');
      initOptions.push(options);
    },

    captureException(error) {
      adapter.calls.captureException += 1;
      fail('captureException');
      captured.push(error);
    },

    wrapRoot(component) {
      adapter.calls.wrapRoot += 1;
      fail('wrapRoot');
      return component;
    },
  };

  function fail(method: keyof TelemetryAdapter): void {
    if (adapter.config.failing?.has(method) === true) {
      throw new Error(`fake telemetry adapter: ${method} failed`);
    }
  }

  return adapter;
}

// ---------------------------------------------------------------------------
// App-wide singleton
// ---------------------------------------------------------------------------

let defaultService: TelemetryService | null = null;

/**
 * The app-wide service, created on first use so that no SDK code is touched at import.
 *
 * @returns The singleton {@link TelemetryService} over {@link createSentryTelemetryAdapter}.
 */
export function getTelemetryService(): TelemetryService {
  if (defaultService === null) {
    defaultService = createTelemetryService(createSentryTelemetryAdapter());
  }
  return defaultService;
}

/**
 * Replaces the app-wide service. Tests use this; the app itself never calls it.
 *
 * @param service - The service to install, or `null` to fall back to the real one.
 */
export function setTelemetryService(service: TelemetryService | null): void {
  defaultService = service;
}

/**
 * Starts crash reporting when the user's setting allows it. Called once, from the root layout's
 * module scope, before the first render — the setting is readable synchronously because the
 * settings store hydrates from MMKV during `create()` (D13).
 *
 * @param enabled - The persisted `crashReportingEnabled` setting.
 * @returns Whether the SDK is running afterwards.
 */
export function initTelemetry(enabled: boolean): boolean {
  return getTelemetryService().start(enabled);
}

/** Reports a handled error. See {@link TelemetryService.reportError}. */
export function reportHandledError(error: unknown): void {
  getTelemetryService().reportError(error);
}

/** Wraps the root component. See {@link TelemetryService.wrapRoot}. */
export function wrapRootWithTelemetry<P extends Record<string, unknown>>(
  component: ComponentType<P>
): ComponentType<P> {
  return getTelemetryService().wrapRoot(component);
}
