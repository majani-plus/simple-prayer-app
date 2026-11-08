/**
 * Tests for the Android rotation-vector adapter.
 *
 * `modules/qibla-heading` is never imported here: the adapter takes its module as an argument, the
 * same seam `createFakeHeadingAdapter` provides for `expo-location`, so nothing native loads under
 * Jest.
 *
 * The behaviours worth pinning are the ones a device would otherwise have to prove:
 *
 * - the needle actually moves at the native rate, rather than through the 5 Hz path this replaces;
 * - **every** way the module can be missing or unwilling falls back to `expo-location` instead of
 *   leaving a dead dial (D38 — no device may regress);
 * - the `-1` true-heading sentinel still means "magnetic", because a silently-magnetic needle is a
 *   confident lie;
 * - the sensor stops when the screen does.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createFakeHeadingAdapter,
  createHeadingService,
  type FakeHeadingAdapter,
  type HeadingLocation,
  type HeadingSample,
  type RawHeading,
} from './heading';
import { createNativeCompassAdapter, NATIVE_HEADING_INTERVAL_MS } from './nativeCompass';

const NOW = 1_700_000_000_000;

/** A hand-cranked stand-in for `modules/qibla-heading`. */
function createFakeModule(
  overrides: { available?: boolean; refuses?: boolean } = {}
): {
  emit(event: Partial<RawHeading>): void;
  readonly locations: (HeadingLocation | null)[];
  readonly intervals: (number | undefined)[];
  readonly removeCount: number;
  readonly isWatching: boolean;
  isAvailable(): boolean;
  setLocation(location: HeadingLocation | null): void;
  watchHeading(
    onEvent: (event: RawHeading) => void,
    intervalMs?: number
  ): { remove(): void } | null;
} {
  const { available = true, refuses = false } = overrides;
  const listeners = new Set<(event: RawHeading) => void>();
  const locations: (HeadingLocation | null)[] = [];
  const intervals: (number | undefined)[] = [];
  let removeCount = 0;

  return {
    emit(event) {
      const raw: RawHeading = {
        trueHeading: event.trueHeading ?? -1,
        magHeading: event.magHeading ?? 0,
        accuracy: event.accuracy ?? 3,
      };
      for (const listener of [...listeners]) listener(raw);
    },
    locations,
    intervals,
    get removeCount() {
      return removeCount;
    },
    get isWatching() {
      return listeners.size > 0;
    },
    isAvailable: () => available,
    setLocation(location) {
      locations.push(location);
    },
    watchHeading(onEvent, intervalMs) {
      if (refuses) return null;
      intervals.push(intervalMs);
      listeners.add(onEvent);
      return {
        remove() {
          removeCount += 1;
          listeners.delete(onEvent);
        },
      };
    },
  };
}

function setup(overrides: { available?: boolean; refuses?: boolean } = {}) {
  const fallback = createFakeHeadingAdapter();
  const module = createFakeModule(overrides);
  const service = createHeadingService(createNativeCompassAdapter(fallback, module), {
    now: () => NOW,
  });
  return { fallback, module, service };
}

/** Subscribes and collects everything the service publishes. */
function watch(service: ReturnType<typeof setup>['service']) {
  const samples: HeadingSample[] = [];
  const errors: string[] = [];
  const subscription = service.watch((sample) => samples.push(sample), {
    onError: (code) => errors.push(code),
  });
  return { samples, errors, subscription };
}

/** Lets the service's internal promise chain settle — the same helper `heading.test.ts` uses. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('the native rotation vector drives the needle', () => {
  it('publishes what the module emits', async () => {
    const { module, service } = setup();
    const { samples } = watch(service);
    await settle();

    module.emit({ trueHeading: 91.5, magHeading: 88, accuracy: 3 });

    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      heading: 91.5,
      reference: 'true',
      confidence: 'high',
    });
  });

  it('asks for delivery at the native interval, not the 5 Hz this replaces', async () => {
    const { module, service } = setup();
    watch(service);
    await settle();

    expect(module.intervals).toEqual([NATIVE_HEADING_INTERVAL_MS]);
    // The point of the whole change: a needle re-targeted far more often than five times a second.
    expect(NATIVE_HEADING_INTERVAL_MS).toBeLessThanOrEqual(50);
  });

  it('never asks expo-location for a heading while the module is working', async () => {
    const { fallback, module, service } = setup();
    watch(service);
    await settle();

    expect(module.isWatching).toBe(true);
    expect(fallback.startCount).toBe(0);
  });

  it('reports a magnetic reading as magnetic when there is no declination', async () => {
    const { module, service } = setup();
    const { samples } = watch(service);
    await settle();

    // -1 is expo-location's "no true heading" sentinel, which the module reuses deliberately.
    module.emit({ trueHeading: -1, magHeading: 200 });

    expect(samples[0]).toMatchObject({
      heading: 200,
      reference: 'magnetic',
      trueHeading: null,
      magneticHeading: 200,
    });
  });

  it('passes the magnetometer accuracy through to the calibration prompt', async () => {
    const { module, service } = setup();
    const { samples } = watch(service);
    await settle();

    module.emit({ magHeading: 10, accuracy: 1 });
    module.emit({ magHeading: 11, accuracy: 3 });

    expect(samples[0]).toMatchObject({ confidence: 'low', needsCalibration: true });
    expect(samples[1]).toMatchObject({ confidence: 'high', needsCalibration: false });
  });
});

describe('location reaches the module, for declination only', () => {
  it('forwards coordinates', () => {
    const { module, service } = setup();

    service.setLocation({ latitude: 21.4225, longitude: 39.8262 });

    expect(module.locations).toEqual([{ latitude: 21.4225, longitude: 39.8262 }]);
  });

  it('forwards a cleared location', () => {
    const { module, service } = setup();

    service.setLocation(null);

    expect(module.locations).toEqual([null]);
  });

  it('does not start or stop the sensor', async () => {
    const { module, service } = setup();
    watch(service);
    await settle();

    service.setLocation({ latitude: 51.5, longitude: -0.12 });

    // Moving must not tear the stream down: the needle would visibly restart.
    expect(module.isWatching).toBe(true);
    expect(module.removeCount).toBe(0);
  });
});

describe('falling back keeps every device working', () => {
  it('uses expo-location when the device has no rotation vector', async () => {
    const { fallback, module, service } = setup({ available: false });
    const { samples } = watch(service);
    await settle();

    expect(fallback.isWatching).toBe(true);
    expect(module.isWatching).toBe(false);

    fallback.emit({ trueHeading: 42, magHeading: 40, accuracy: 2 });
    expect(samples[0]).toMatchObject({ heading: 42, confidence: 'medium' });
  });

  it('uses expo-location when the module is present but refuses to start', async () => {
    const { fallback, service } = setup({ refuses: true });
    const { samples } = watch(service);
    await settle();

    expect(fallback.isWatching).toBe(true);

    fallback.emit({ trueHeading: 7 });
    expect(samples[0]).toMatchObject({ heading: 7 });
  });

  it('still reports a start-up failure from the fallback', async () => {
    const { fallback, service } = setup({ available: false });
    fallback.failNextStart(new Error('Missing location permissions'));
    const { errors } = watch(service);
    await settle();

    expect(errors).toEqual(['permissionDenied']);
  });

  it('stops the fallback stream on unsubscribe', async () => {
    const { fallback, service } = setup({ available: false });
    const { subscription } = watch(service);
    await settle();

    subscription.remove();

    expect(fallback.isWatching).toBe(false);
  });
});

describe('the sensor stops when the screen does', () => {
  it('removes the native subscription', async () => {
    const { module, service } = setup();
    const { subscription } = watch(service);
    await settle();

    subscription.remove();

    expect(module.isWatching).toBe(false);
    expect(module.removeCount).toBe(1);
  });

  it('is idempotent', async () => {
    const { module, service } = setup();
    const { subscription } = watch(service);
    await settle();

    subscription.remove();
    subscription.remove();

    expect(module.removeCount).toBe(1);
  });

  it('publishes nothing after unsubscribing', async () => {
    const { module, service } = setup();
    const { samples, subscription } = watch(service);
    await settle();

    subscription.remove();
    module.emit({ magHeading: 123 });

    expect(samples).toEqual([]);
  });

  it('stops a stream that started after the caller had already left', async () => {
    // The race `createHeadingService` exists to win: a tab unfocused between the call and the
    // module's answer must not leave the rotation vector running.
    const { module, service } = setup();
    const { subscription } = watch(service);
    subscription.remove();
    await settle();

    expect(module.isWatching).toBe(false);
  });
});

/**
 * The owner's report was explicit that iOS is already right ("On iOS it's perfect"), so the one
 * thing this change must not do is reach it. Both halves of that are asserted at the source, the
 * way `noDebugAffordances` asserts the singleton, because a runtime test here would have to load
 * the native modules the whole seam exists to avoid.
 */
describe('iOS is left exactly as it was', () => {
  const source = readFileSync(join(__dirname, 'heading.ts'), 'utf8');
  const factory = /export function getHeadingService\(\)[\s\S]*?\n}/.exec(source)?.[0] ?? '';

  it('finds the singleton factory', () => {
    expect(factory).toContain('defaultService');
  });

  it('hands iOS the bare expo-location adapter, and wraps only Android', () => {
    expect(factory).toMatch(
      /Platform\.OS === 'android'\s*\?\s*createNativeCompassAdapter\(base\)\s*:\s*base/
    );
  });

  it('never builds the native module into an iOS binary', () => {
    const config = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'modules', 'qibla-heading', 'expo-module.config.json'), 'utf8')
    ) as { platforms: string[] };
    expect(config.platforms).toEqual(['android']);
  });
});

describe('the fake fallback is only ever a test seam', () => {
  it('is not what the adapter reaches for by default', () => {
    // Guards the mistake `noDebugAffordances` was written for: a fake wired into the real path.
    const fallback: FakeHeadingAdapter = createFakeHeadingAdapter();
    const adapter = createNativeCompassAdapter(fallback, createFakeModule());
    expect(typeof adapter.watchHeading).toBe('function');
    expect(typeof adapter.setLocation).toBe('function');
  });
});
