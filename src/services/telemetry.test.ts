/**
 * Tests for the telemetry service — and, more importantly, for its PRIVACY CONTRACT.
 *
 * The configuration block below is not ordinary coverage: it pins every "we do not send that"
 * decision so that a future "let's turn on more Sentry features" change has to consciously break
 * a test that explains why the feature was off. This app's positioning is that it collects
 * nothing about the user (D31); crash reporting ships only as diagnostic data about the code.
 * If you are here to relax one of these assertions, the copy in `settings.diagnostics.*`, the
 * pledge footnote, docs/PRIVACY_POLICY.md and the store privacy answers all have to move with
 * you — that is what these tests exist to force.
 *
 * `@sentry/react-native` is mocked to THROW at require time, which does double duty: it proves
 * the real adapter's lazy `require` degrades silently when the module is absent (Jest, Expo Go,
 * a stripped build), and it guarantees this suite can never touch the SDK.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import appJson from '../../app.json';
import {
  buildTelemetryOptions,
  createFakeTelemetryAdapter,
  createSentryTelemetryAdapter,
  createTelemetryService,
  scrubTelemetryEvent,
  sentryDsn,
  type TelemetryAdapter,
} from './telemetry';

/** The DSN app.json ships. A FOSS build strips it; this suite tests the configured build. */
const DSN = sentryDsn(appJson.expo.extra) as string;

jest.mock('@sentry/react-native', () => {
  // Simulates the module being absent entirely — the service must swallow this.
  throw new Error('native module missing');
});

// ---------------------------------------------------------------------------
// The configuration contract
// ---------------------------------------------------------------------------

describe('the configuration', () => {
  const options = buildTelemetryOptions(DSN);

  it('points at the EU ingest region', () => {
    // The owner chose EU data residency; a DSN swap that silently moved crash data out of it
    // should fail a test, not pass a review.
    expect(options.dsn).toBe(DSN);
    expect(options.dsn).toContain('.ingest.de.sentry.io');
  });

  it('never attaches default PII', () => {
    // IP addresses and device identifiers turn "a crash happened" into "this person's phone
    // crashed". Diagnostic data only.
    expect(options.sendDefaultPii).toBe(false);
  });

  it('never records the screen: session replay is OFF and must stay off', () => {
    // Replay records the screen — and this app's screens show a person's prayer history and
    // menstruation-exemption days. Recording that would be a serious privacy breach and would
    // make the pledge indefensible. Both rates are pinned to zero; the integration is never
    // added (asserted against the source below).
    expect(options.replaysSessionSampleRate).toBe(0);
    expect(options.replaysOnErrorSampleRate).toBe(0);
  });

  it('never photographs the screen on an error either', () => {
    // `attachScreenshot` is replay's little sibling: one frame instead of a stream, the same
    // breach. The view hierarchy embeds rendered text (prayer names, dates), so it stays off too.
    expect(options.attachScreenshot).toBe(false);
    expect(options.attachViewHierarchy).toBe(false);
  });

  it('ships no performance tracing in 1.0', () => {
    // A decision, not an oversight: tracing transmits which screens were visited and when, for
    // performance value this app does not need yet. The option is ABSENT (the SDK's "tracing
    // entirely off"), and no sampler sneaks it back in.
    expect('tracesSampleRate' in options).toBe(false);
    expect('tracesSampler' in options).toBe(false);
  });

  it('sends no breadcrumbs', () => {
    // Breadcrumbs are a timeline of what the user DID (taps, navigation, console lines) before
    // the crash — behavioural data. The stack trace has to be enough.
    expect(options.maxBreadcrumbs).toBe(0);
  });

  it('keeps anonymous session tracking on — the release-health trade', () => {
    // Sessions are what turn raw crash counts into a crash-free rate, which is most of the
    // reason to have crash reporting at all. With no user and no PII they identify nobody.
    expect(options.enableAutoSessionTracking).toBe(true);
  });

  it('wires the scrubber in as beforeSend', () => {
    expect(options.beforeSend).toBe(scrubTelemetryEvent);
  });
});

describe('scrubTelemetryEvent', () => {
  it('strips identity, breadcrumbs and request context, and keeps the diagnostics', () => {
    const event = {
      user: { id: 'someone' },
      breadcrumbs: [{ message: 'tapped Fajr' }],
      request: { headers: {} },
      exception: { values: [{ type: 'Error' }] },
      release: '1.0.0',
    };

    const scrubbed = scrubTelemetryEvent(event);

    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.breadcrumbs).toBeUndefined();
    expect(scrubbed.request).toBeUndefined();
    // What makes a crash debuggable survives.
    expect(scrubbed.exception).toEqual({ values: [{ type: 'Error' }] });
    expect(scrubbed.release).toBe('1.0.0');
  });
});

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

const Component = () => null;

describe('sentryDsn', () => {
  it('reads extra.sentryDsn and treats a missing or blank one as none', () => {
    expect(sentryDsn({ sentryDsn: ' https://k@x.ingest.de.sentry.io/1 ' })).toBe(
      'https://k@x.ingest.de.sentry.io/1'
    );
    expect(sentryDsn({})).toBeNull();
    expect(sentryDsn({ sentryDsn: '  ' })).toBeNull();
    expect(sentryDsn({ sentryDsn: 42 })).toBeNull();
    expect(sentryDsn(null)).toBeNull();
  });
});

describe('createTelemetryService', () => {
  it('initialises nothing at all when the setting is off', () => {
    const adapter = createFakeTelemetryAdapter();
    const service = createTelemetryService(adapter, DSN);

    expect(service.start(false)).toBe(false);

    expect(adapter.calls.init).toBe(0);
    expect(service.isStarted()).toBe(false);
    // Off means off everywhere: no reports, and no Sentry component in the tree.
    service.reportError(new Error('ignored'));
    expect(adapter.calls.captureException).toBe(0);
    expect(service.wrapRoot(Component)).toBe(Component);
    expect(adapter.calls.wrapRoot).toBe(0);
  });

  it('initialises once, with exactly the pinned configuration, when the setting is on', () => {
    const adapter = createFakeTelemetryAdapter();
    const service = createTelemetryService(adapter, DSN);

    expect(service.start(true)).toBe(true);
    expect(service.start(true)).toBe(true);

    expect(adapter.calls.init).toBe(1);
    expect(adapter.initOptions[0]).toEqual(buildTelemetryOptions(DSN));
    expect(service.isStarted()).toBe(true);
  });

  it('reports handled errors once started, and swallows a failing SDK call', () => {
    const adapter = createFakeTelemetryAdapter();
    const service = createTelemetryService(adapter, DSN);
    service.start(true);

    const failure = new Error('migration exploded');
    service.reportError(failure);
    expect(adapter.captured).toEqual([failure]);

    adapter.config.failing = new Set(['captureException']);
    expect(() => service.reportError(new Error('again'))).not.toThrow();
  });

  it('wraps the root only while running, and falls back to the bare component on failure', () => {
    const adapter = createFakeTelemetryAdapter();
    const service = createTelemetryService(adapter, DSN);
    service.start(true);

    expect(service.wrapRoot(Component)).toBe(Component);
    expect(adapter.calls.wrapRoot).toBe(1);

    adapter.config.failing = new Set(['wrapRoot']);
    // A Sentry failure must never white-screen the app: the un-wrapped component still renders.
    expect(service.wrapRoot(Component)).toBe(Component);
  });

  it('never starts without a DSN (a FOSS build), whatever the setting says', () => {
    const adapter = createFakeTelemetryAdapter();
    const service = createTelemetryService(adapter, null);

    expect(service.start(true)).toBe(false);
    expect(adapter.calls.init).toBe(0);
    expect(service.wrapRoot(Component)).toBe(Component);
  });

  it('degrades silently when the adapter cannot initialise', () => {
    const adapter = createFakeTelemetryAdapter({ failing: new Set<keyof TelemetryAdapter>(['init']) });
    const service = createTelemetryService(adapter, DSN);

    expect(() => service.start(true)).not.toThrow();
    expect(service.isStarted()).toBe(false);
    expect(service.wrapRoot(Component)).toBe(Component);
  });
});

describe('the real adapter without its module', () => {
  it('degrades silently when @sentry/react-native cannot be required', () => {
    // The jest.mock at the top makes the require itself throw — the exact shape of Jest, Expo
    // Go, or a build the module was stripped from. The lazy `require` means the failure lands
    // inside `start`'s try/catch instead of at import, and the app runs as if reporting were off.
    const service = createTelemetryService(createSentryTelemetryAdapter(), DSN);

    expect(() => service.start(true)).not.toThrow();
    expect(service.isStarted()).toBe(false);
    service.reportError(new Error('nobody is listening'));
    expect(service.wrapRoot(Component)).toBe(Component);
  });
});

// ---------------------------------------------------------------------------
// Source guards — the assertions no runtime test can make
// ---------------------------------------------------------------------------

describe('the telemetry source keeps its promises', () => {
  const source = readFileSync(join(__dirname, 'telemetry.ts'), 'utf8');

  it('never identifies the user', () => {
    // `Sentry.setUser` is the API that ties events to a person. It must not exist anywhere in
    // this module — and this module is the only one allowed to know Sentry exists, which the
    // architecture suite's import rules keep true for the rest of the tree.
    expect(source).not.toMatch(/setUser/);
  });

  it('never mounts the replay, feedback or user-interaction integrations', () => {
    // Zero sample rates keep replay silent; never constructing the integration keeps it
    // impossible. Both lines of defence stay.
    expect(source).not.toMatch(/mobileReplayIntegration|replayIntegration|feedbackIntegration/i);
    expect(source).not.toMatch(/userInteractionIntegration/i);
  });

  it('builds the singleton from the real adapter, never the fake', () => {
    const factory = /export function getTelemetryService\(\)[\s\S]*?\n}/.exec(source)?.[0] ?? '';
    expect(factory).toContain('createSentryTelemetryAdapter');
    expect(factory).not.toContain('createFakeTelemetryAdapter');
  });
});
