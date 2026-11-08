/**
 * Tests for `services/tilt` — the accelerometer seam under the Qibla tilt hint.
 */

import {
  createFakeTiltAdapter,
  createTiltService,
  type RawAccelerometerSample,
  type TiltAdapter,
} from './tilt';

/** Lets every promise chained inside the service settle (macrotask: the chain is >3 deep). */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createTiltService', () => {
  it('delivers finite samples and drops the rest silently', async () => {
    const adapter = createFakeTiltAdapter();
    const service = createTiltService(adapter);
    const samples: RawAccelerometerSample[] = [];

    service.watch((sample) => samples.push(sample));
    await flush();

    adapter.emit({ x: 0, y: 0.5, z: 0.8 });
    adapter.emit({ x: Number.NaN, y: 0, z: 1 });
    adapter.emit({ x: 0, y: Number.POSITIVE_INFINITY, z: 1 });
    adapter.emit({ x: 0.1, y: 0.1, z: 0.9 });

    expect(samples).toEqual([
      { x: 0, y: 0.5, z: 0.8 },
      { x: 0.1, y: 0.1, z: 0.9 },
    ]);
  });

  it('reports an absent accelerometer and never starts the stream', async () => {
    const adapter = createFakeTiltAdapter();
    adapter.setUnavailable();
    const service = createTiltService(adapter);
    const listener = jest.fn();
    const onUnavailable = jest.fn();

    service.watch(listener, { onUnavailable });
    await flush();

    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
    expect(adapter.startCount).toBe(0);
  });

  it('reports a stream that refuses to start', async () => {
    const adapter = createFakeTiltAdapter();
    adapter.failNextStart(new Error('sensor is on fire'));
    const service = createTiltService(adapter);
    const onUnavailable = jest.fn();

    service.watch(jest.fn(), { onUnavailable });
    await flush();

    expect(onUnavailable).toHaveBeenCalledWith('sensor is on fire');
    expect(adapter.isWatching).toBe(false);
  });

  it('never starts the sensor when unsubscribed during the availability probe', async () => {
    const adapter = createFakeTiltAdapter();
    const service = createTiltService(adapter);
    const listener = jest.fn();

    const subscription = service.watch(listener);
    subscription.remove(); // before isAvailable() has answered
    await flush();

    expect(adapter.startCount).toBe(0);
    expect(adapter.isWatching).toBe(false);
    adapter.emit({});
    expect(listener).not.toHaveBeenCalled();
  });

  it('survives an unsubscribe while the platform stream is still starting up', async () => {
    const adapter = createFakeTiltAdapter();
    const service = createTiltService(adapter);
    const listener = jest.fn();

    adapter.deferStart();
    const subscription = service.watch(listener);
    await flush(); // past the availability probe, into the held start
    subscription.remove();
    adapter.releaseStart();
    await flush();

    // The stream that materialised after the unsubscribe was stopped immediately.
    expect(adapter.startCount).toBe(1);
    expect(adapter.removeCount).toBe(1);
    expect(adapter.isWatching).toBe(false);
    adapter.emit({});
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not even probe availability results after an immediate unsubscribe', async () => {
    const adapter = createFakeTiltAdapter();
    const service = createTiltService(adapter);
    const onUnavailable = jest.fn();

    const subscription = service.watch(jest.fn(), { onUnavailable });
    subscription.remove();
    await flush();

    expect(adapter.startCount).toBe(0);
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it('remove() is idempotent', async () => {
    const adapter = createFakeTiltAdapter();
    const service = createTiltService(adapter);

    const subscription = service.watch(jest.fn());
    await flush();
    subscription.remove();
    subscription.remove();

    expect(adapter.removeCount).toBe(1);
    expect(adapter.isWatching).toBe(false);
  });

  it('never lets an adapter that throws synchronously escape into the caller', async () => {
    const adapter: TiltAdapter = {
      isAvailable() {
        throw new Error('bang');
      },
      watchAcceleration() {
        throw new Error('bang');
      },
    };
    const service = createTiltService(adapter);
    const onUnavailable = jest.fn();

    expect(() => service.watch(jest.fn(), { onUnavailable })).not.toThrow();
    await flush();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it('reports unavailability at most once per subscription', async () => {
    const adapter: TiltAdapter = {
      async isAvailable() {
        return false;
      },
      async watchAcceleration() {
        throw new Error('unreachable');
      },
    };
    const service = createTiltService(adapter);
    const onUnavailable = jest.fn();

    service.watch(jest.fn(), { onUnavailable });
    await flush();

    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });
});
