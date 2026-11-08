/**
 * Which region the digits are resolved from — and why entry zero is not enough.
 *
 * D40 says Arabic numerals follow "the device's formatting region … exactly the setting the OS
 * itself uses to choose number, date and currency shapes". That sentence describes iOS. Android has
 * no separate formatting region at all: `getLocales()` is the *language* list, so entry zero's
 * region is whatever country is attached to the top language — which can be a keyboard the owner
 * added years ago, or nothing.
 *
 * The consequence is not cosmetic. A reader in Morocco writes 0123; showing them ٠١٢٣ because their
 * first language entry is a region-less `ar` is precisely the failure D40 exists to prevent, and
 * on Android they had no way to correct it.
 */

const mockGetLocales = jest.fn();

jest.mock('expo-localization', () => ({
  getLocales: () => mockGetLocales(),
}));

/** A fresh module each time, because the answer is memoized for the life of the process. */
const loadRegion = (): string | null => {
  let region: string | null = null;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    region = (require('../numerals') as typeof import('../numerals')).deviceRegionCode();
  });
  return region;
};

afterEach(() => {
  mockGetLocales.mockReset();
});

describe('deviceRegionCode', () => {
  it('takes the first entry when it carries a region — the iOS case, unchanged', async () => {
    mockGetLocales.mockReturnValue([{ languageCode: 'ar', regionCode: 'EG' }]);
    expect(loadRegion()).toBe('EG');
  });

  it('reads past a region-less entry rather than giving up', async () => {
    // The Android shape: a bare `ar` on top, the country only on a later entry.
    mockGetLocales.mockReturnValue([
      { languageCode: 'ar', regionCode: null },
      { languageCode: 'fr', regionCode: 'MA' },
    ]);
    expect(loadRegion()).toBe('MA');
  });

  it('treats an empty string as no region, not as a region', async () => {
    mockGetLocales.mockReturnValue([
      { languageCode: 'ar', regionCode: '' },
      { languageCode: 'ar', regionCode: 'SA' },
    ]);
    expect(loadRegion()).toBe('SA');
  });

  it('answers null when nothing carries a region, so the digits fall back to Western', async () => {
    mockGetLocales.mockReturnValue([{ languageCode: 'ar', regionCode: null }]);
    expect(loadRegion()).toBeNull();
  });

  it('survives a platform that cannot answer at all', async () => {
    mockGetLocales.mockImplementation(() => {
      throw new Error('no locale bridge');
    });
    expect(loadRegion()).toBeNull();
  });
});
