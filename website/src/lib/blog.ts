/** '2026-11-08' → '8 November 2026'. UTC, so the build machine's zone cannot shift the day. */
export function formatPostDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', dateStyle: 'long' });
}
