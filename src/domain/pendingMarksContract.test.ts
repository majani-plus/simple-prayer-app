/**
 * Holds the TypeScript overlay to the cross-language contract in
 * `modules/prayer-widgets/contract/overlay-cases.json` — the cases the Kotlin and Swift widget
 * renderers must agree with. There is no native test infrastructure, so this fixture IS the
 * contract: change it only together with both native implementations.
 */

import { overlayPendingMarks, resolvePendingMarks } from './pendingMarks';
import type { Prayer, PrayerDay, PrayerStatus } from './types';

import contract from '../../modules/prayer-widgets/contract/overlay-cases.json';

interface ContractCase {
  name: string;
  day: PrayerDay;
  statuses: Record<Prayer, PrayerStatus>;
  entries: unknown[];
  effective: Record<Prayer, PrayerStatus>;
}

describe('the widget overlay contract', () => {
  it.each((contract.cases as ContractCase[]).map((c) => [c.name, c] as const))(
    '%s',
    (_name, testCase) => {
      const { intents } = resolvePendingMarks(testCase.entries);
      const effective = overlayPendingMarks(testCase.day, testCase.statuses, intents);
      expect(effective).toEqual(testCase.effective);
    }
  );

  it('is versioned, so a native reviewer knows which contract they matched', () => {
    expect(contract.version).toBe(1);
    expect(contract.cases.length).toBeGreaterThanOrEqual(9);
  });
});
