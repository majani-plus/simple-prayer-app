/**
 * Settle with `fallback` if `promise` has not settled within `ms`.
 *
 * For calls with no timeout of their own — a native bridge, a library that fetches — where a hang
 * would otherwise hold whatever is waiting on it forever. A rejection still rejects; only silence
 * is turned into the fallback. The original promise keeps running; its result is simply ignored.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
