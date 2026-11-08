/**
 * Tests for the heading service.
 *
 * `expo-location` is never imported here: every case runs the real service over
 * `createFakeHeadingAdapter`, which is the same seam the app uses in production (with the
 * expo-backed adapter swapped in).
 *
 * Three behaviours are product requirements rather than implementation details, and are asserted
 * as such:
 *
 * - the needle takes the SHORT arc across the 0/360 wrap, and the value handed to the animation
 *   never wraps at all (PRODUCT_SPEC §9 — "shortest-arc interpolation");
 * - jitter is damped (the single most-cited flaw in competing compasses);
 * - the magnetic fallback is flagged, because the Qibla bearing is true-north referenced and a
 *   silently-magnetic needle is a confident lie.
 */

import {
  CALIBRATION_CONFIDENCES,
  createFakeHeadingAdapter,
  createHeadingService,
  createHeadingSmoother,
  needsCalibration,
  normalizeHeadingSample,
  toHeadingConfidence,
  type HeadingConfidence,
  type HeadingErrorCode,
  type HeadingSample,
} from './heading';

const NOW = 1_700_000_000_000;

function makeService() {
  const adapter = createFakeHeadingAdapter();
  const service = createHeadingService(adapter, { now: () => NOW });
  return { adapter, service };
}

/** Collects samples from a live subscription. */
function watch(service: ReturnType<typeof makeService>['service']) {
  const samples: HeadingSample[] = [];
  const errors: { code: HeadingErrorCode; message?: string }[] = [];
  const subscription = service.watch((sample) => samples.push(sample), {
    onError: (code, message) => errors.push({ code, message }),
  });
  return { samples, errors, subscription };
}

/** Lets the service's internal promise chain settle. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------------------
// Accuracy mapping — the two platforms mean different things by the same integer
// ---------------------------------------------------------------------------

describe('toHeadingConfidence', () => {
  /**
   * Android hands `SensorManager`'s magnetometer calibration constant straight through
   * (`onAccuracyChanged`); there are no degrees involved.
   */
  const SENSOR_STATUS_NO_CONTACT = -1;
  const SENSOR_STATUS_UNRELIABLE = 0;
  const SENSOR_STATUS_ACCURACY_LOW = 1;
  const SENSOR_STATUS_ACCURACY_MEDIUM = 2;
  const SENSOR_STATUS_ACCURACY_HIGH = 3;

  it('maps the Android SensorManager constants', () => {
    expect(toHeadingConfidence(SENSOR_STATUS_ACCURACY_HIGH)).toBe('high');
    expect(toHeadingConfidence(SENSOR_STATUS_ACCURACY_MEDIUM)).toBe('medium');
    expect(toHeadingConfidence(SENSOR_STATUS_ACCURACY_LOW)).toBe('low');
    expect(toHeadingConfidence(SENSOR_STATUS_UNRELIABLE)).toBe('unavailable');
    expect(toHeadingConfidence(SENSOR_STATUS_NO_CONTACT)).toBe('unavailable');
  });

  /**
   * iOS measures `CLHeading.headingAccuracy` in DEGREES of maximum deviation, which
   * `expo-location` buckets onto Android's scale before it reaches JS. Replicated from
   * `expo-location/ios/LocationUtils.swift` (`normalizeAccuracy`) so the degree → confidence
   * chain the module header documents is asserted end to end, not just its second half.
   */
  function expoNormalizeIosAccuracy(degrees: number): number {
    if (degrees > 50 || degrees < 0) return 0;
    if (degrees > 35) return 1;
    if (degrees > 20) return 2;
    return 3;
  }
  const iosConfidence = (degrees: number): HeadingConfidence =>
    toHeadingConfidence(expoNormalizeIosAccuracy(degrees));

  it('maps the iOS degree buckets', () => {
    expect(iosConfidence(0)).toBe('high');
    expect(iosConfidence(20)).toBe('high');
    expect(iosConfidence(20.5)).toBe('medium');
    expect(iosConfidence(35)).toBe('medium');
    expect(iosConfidence(35.5)).toBe('low');
    expect(iosConfidence(50)).toBe('low');
    expect(iosConfidence(50.5)).toBe('unavailable');
    // CLHeading reports a negative accuracy when the heading is invalid.
    expect(iosConfidence(-1)).toBe('unavailable');
  });

  it('treats an unrecognised claim as no claim', () => {
    expect(toHeadingConfidence(4)).toBe('unavailable');
    expect(toHeadingConfidence(2.5)).toBe('unavailable');
    expect(toHeadingConfidence(Number.NaN)).toBe('unavailable');
  });
});

describe('needsCalibration', () => {
  it('asks for the figure-8 only when the compass is not to be trusted', () => {
    expect(needsCalibration('high')).toBe(false);
    expect(needsCalibration('medium')).toBe(false);
    expect(needsCalibration('low')).toBe(true);
    expect(needsCalibration('unavailable')).toBe(true);
  });

  it('agrees with the exported list', () => {
    expect([...CALIBRATION_CONFIDENCES]).toEqual(['low', 'unavailable']);
  });
});

// ---------------------------------------------------------------------------
// Sample normalisation
// ---------------------------------------------------------------------------

describe('normalizeHeadingSample', () => {
  it('prefers the true heading and says so', () => {
    const sample = normalizeHeadingSample({ trueHeading: 96, magHeading: 91, accuracy: 3 }, NOW);
    expect(sample).toEqual({
      heading: 96,
      reference: 'true',
      trueHeading: 96,
      magneticHeading: 91,
      confidence: 'high',
      rawAccuracy: 3,
      needleOffset: 0,
      needsCalibration: false,
      timestamp: NOW,
    });
  });

  describe('the Android drift correction', () => {
    it('carries the degrees the platform already applied', () => {
      // Android only, and already inside every angle in the sample. It is reported so the one
      // consumer that bypasses this service — the UI-thread needle, which reads the fused sensor
      // itself — can apply the same correction and land on the same heading.
      const sample = normalizeHeadingSample(
        { trueHeading: 96, magHeading: 91, accuracy: 3, driftOffset: -14.5 },
        NOW
      );
      expect(sample?.needleOffset).toBeCloseTo(-14.5, 10);
      // The heading is untouched by it: the platform corrected the angle before sending it.
      expect(sample?.heading).toBe(96);
    });

    it('reads a missing or unusable correction as none', () => {
      // iOS never sets it, and a build older than the correction does not either.
      expect(
        normalizeHeadingSample({ trueHeading: 96, magHeading: 91, accuracy: 3 }, NOW)?.needleOffset
      ).toBe(0);
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(
          normalizeHeadingSample(
            { trueHeading: 96, magHeading: 91, accuracy: 3, driftOffset: bad },
            NOW
          )?.needleOffset
        ).toBe(0);
      }
    });
  });

  it('falls back to magnetic and FLAGS it when there is no true heading', () => {
    const sample = normalizeHeadingSample({ trueHeading: -1, magHeading: 91, accuracy: 2 }, NOW);
    expect(sample?.reference).toBe('magnetic');
    expect(sample?.heading).toBe(91);
    expect(sample?.trueHeading).toBeNull();
    expect(sample?.magneticHeading).toBe(91);
  });

  it('keeps an Android westerly-declination true heading instead of dropping to magnetic', () => {
    // Android computes (magHeading + declination) % 360, which is negative wherever declination
    // is west. -8 is 352°, not a "no heading" sentinel.
    const sample = normalizeHeadingSample({ trueHeading: -8, magHeading: 5, accuracy: 3 }, NOW);
    expect(sample?.reference).toBe('true');
    expect(sample?.heading).toBe(352);
  });

  it('wraps out-of-range angles into [0, 360)', () => {
    expect(
      normalizeHeadingSample({ trueHeading: 720.5, magHeading: 0, accuracy: 3 }, NOW)?.heading
    ).toBeCloseTo(0.5, 10);
  });

  it('carries the calibration flag from the confidence', () => {
    const sample = normalizeHeadingSample({ trueHeading: 10, magHeading: 10, accuracy: 1 }, NOW);
    expect(sample?.confidence).toBe('low');
    expect(sample?.needsCalibration).toBe(true);
  });

  it('drops a sample that carries no usable angle at all', () => {
    expect(
      normalizeHeadingSample({ trueHeading: -1, magHeading: -1, accuracy: 0 }, NOW)
    ).toBeNull();
    expect(
      normalizeHeadingSample({ trueHeading: Number.NaN, magHeading: Number.NaN, accuracy: 3 }, NOW)
    ).toBeNull();
    expect(normalizeHeadingSample(null, NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Smoothing — the differentiator
// ---------------------------------------------------------------------------

describe('createHeadingSmoother', () => {
  it('adopts the first sample outright rather than easing in from north', () => {
    const smoother = createHeadingSmoother(0.2);
    expect(smoother.hasFix).toBe(false);
    expect(smoother.push(96)).toEqual({ heading: 96, continuous: 96 });
    expect(smoother.hasFix).toBe(true);
  });

  it('takes the SHORT arc across the 359 -> 1 wrap', () => {
    const smoother = createHeadingSmoother(0.5);
    smoother.push(359);
    const { heading } = smoother.push(1);
    // Half of a +2° step, not half of a -358° one.
    expect(heading).toBe(0);
  });

  it('never lets the animated value wrap, so a rotation cannot spin the long way round', () => {
    const smoother = createHeadingSmoother(1); // no smoothing: isolate the unwrapping
    smoother.push(350);
    const readings = [355, 359, 3, 8, 12].map((deg) => smoother.push(deg));

    // Wrapped values do wrap...
    expect(readings.map((r) => r.heading)).toEqual([355, 359, 3, 8, 12]);
    // ...the continuous ones never do: every step is a small positive delta.
    expect(readings.map((r) => r.continuous)).toEqual([355, 359, 363, 368, 372]);
    for (let i = 1; i < readings.length; i += 1) {
      expect(readings[i].continuous - readings[i - 1].continuous).toBeGreaterThan(0);
      expect(readings[i].continuous - readings[i - 1].continuous).toBeLessThan(180);
    }
  });

  it('unwraps downwards too', () => {
    const smoother = createHeadingSmoother(1);
    smoother.push(5);
    // 5 → 358 is a -7° step, 358 → 350 another -8°.
    expect(smoother.push(358).continuous).toBe(-2);
    expect(smoother.push(350).continuous).toBe(-10);
  });

  it('damps jitter around a held heading', () => {
    const noise = [92, 88, 93, 87, 91, 89, 92, 88, 90, 91, 89, 90];
    const smoother = createHeadingSmoother(0.2);
    smoother.push(90);

    const smoothed = noise.map((deg) => smoother.push(deg).heading);
    const spread = (values: number[]) => Math.max(...values) - Math.min(...values);

    // The raw stream swings 6°; the filtered one must be a fraction of that, and must stay
    // centred on the true heading rather than lagging away from it.
    expect(spread(noise)).toBe(6);
    expect(spread(smoothed)).toBeLessThan(2);
    for (const value of smoothed) expect(Math.abs(value - 90)).toBeLessThan(2);
  });

  it('still tracks a real turn without visible lag', () => {
    const smoother = createHeadingSmoother(0.2);
    smoother.push(0);
    // ~20 samples is one second at the rate the platforms deliver.
    for (let i = 0; i < 20; i += 1) smoother.push(90);
    expect(smoother.heading).toBeGreaterThan(80);
  });

  it('holds the last value when a sample is dropped, instead of poisoning the needle', () => {
    const smoother = createHeadingSmoother(0.5);
    smoother.push(120);
    expect(smoother.push(Number.NaN)).toEqual({ heading: 120, continuous: 120 });
    expect(smoother.heading).toBe(120);
  });

  it('clamps a nonsense factor rather than producing a nonsense needle', () => {
    expect(createHeadingSmoother(Number.NaN).push(42).heading).toBe(42);
    const frozen = createHeadingSmoother(-1);
    frozen.push(10);
    expect(frozen.push(200).heading).toBe(10);
  });

  it('forgets everything on reset', () => {
    const smoother = createHeadingSmoother(0.2);
    smoother.push(300);
    smoother.reset();
    expect(smoother.hasFix).toBe(false);
    expect(smoother.push(10)).toEqual({ heading: 10, continuous: 10 });
  });
});

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

describe('createHeadingService', () => {
  it('delivers normalised samples from the platform stream', async () => {
    const { adapter, service } = makeService();
    const { samples } = watch(service);
    await settle();

    adapter.emit({ trueHeading: 96.4, magHeading: 91, accuracy: 3 });
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      heading: 96.4,
      reference: 'true',
      confidence: 'high',
      timestamp: NOW,
    });
  });

  it('drops unusable events without disturbing the stream', async () => {
    const { adapter, service } = makeService();
    const { samples } = watch(service);
    await settle();

    adapter.emit({ trueHeading: -1, magHeading: -1, accuracy: 0 });
    expect(samples).toHaveLength(0);

    adapter.emit({ trueHeading: 12, magHeading: 12, accuracy: 3 });
    expect(samples).toHaveLength(1);
  });

  it('stops the sensor on remove and never calls back again', async () => {
    const { adapter, service } = makeService();
    const { samples, subscription } = watch(service);
    await settle();
    expect(adapter.isWatching).toBe(true);

    adapter.emit({ trueHeading: 10, magHeading: 10, accuracy: 3 });
    subscription.remove();

    expect(adapter.isWatching).toBe(false);
    expect(adapter.removeCount).toBe(1);
    adapter.emit({ trueHeading: 200, magHeading: 200, accuracy: 3 });
    expect(samples).toHaveLength(1);
  });

  it('is idempotent about removal', async () => {
    const { adapter, service } = makeService();
    const { subscription } = watch(service);
    await settle();

    subscription.remove();
    subscription.remove();
    expect(adapter.removeCount).toBe(1);
  });

  it('tears the sensor down when it is unsubscribed before the platform has started', async () => {
    const { adapter, service } = makeService();
    adapter.deferStart();
    const { samples, subscription } = watch(service);

    // The screen went away while `watchHeadingAsync` was still resolving.
    subscription.remove();
    adapter.releaseStart();
    await settle();

    // The subscription materialised and was immediately stopped: no sensor left running.
    expect(adapter.startCount).toBe(1);
    expect(adapter.removeCount).toBe(1);
    expect(adapter.isWatching).toBe(false);

    adapter.emit({ trueHeading: 10, magHeading: 10, accuracy: 3 });
    expect(samples).toHaveLength(0);
  });

  it('reports a refused permission as such', async () => {
    const { adapter, service } = makeService();
    adapter.failNextStart(new Error('Missing location permissions'));
    const { errors } = watch(service);
    await settle();

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('permissionDenied');
    expect(errors[0].message).toMatch(/permission/i);
  });

  it('reports any other start-up failure as an unavailable sensor', async () => {
    const { adapter, service } = makeService();
    adapter.failNextStart(new Error('No compass on this device'));
    const { errors } = watch(service);
    await settle();

    expect(errors).toEqual([{ code: 'sensorUnavailable', message: 'No compass on this device' }]);
  });

  it('reports a stream that dies after it started', async () => {
    const { adapter, service } = makeService();
    const { samples, errors } = watch(service);
    await settle();

    adapter.emitError('sensor detached');
    expect(errors).toEqual([{ code: 'sensorUnavailable', message: 'sensor detached' }]);

    // The subscription is dead; nothing else arrives.
    adapter.emit({ trueHeading: 10, magHeading: 10, accuracy: 3 });
    expect(samples).toHaveLength(0);
  });

  it('does not report an error after the caller unsubscribed', async () => {
    const { adapter, service } = makeService();
    const { errors, subscription } = watch(service);
    await settle();

    subscription.remove();
    adapter.emitError('sensor detached');
    expect(errors).toEqual([]);
  });

  it('never throws out of watch, even when the adapter throws synchronously', async () => {
    const service = createHeadingService(
      {
        watchHeading() {
          throw new Error('boom');
        },
      },
      { now: () => NOW }
    );
    const errors: HeadingErrorCode[] = [];
    expect(() => service.watch(() => {}, { onError: (code) => errors.push(code) })).not.toThrow();
    await settle();
    expect(errors).toEqual(['sensorUnavailable']);
  });
});
