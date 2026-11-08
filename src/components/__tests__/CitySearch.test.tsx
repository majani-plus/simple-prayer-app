/**
 * Component test for the manual-city search.
 *
 * The city search is the whole reason refusing the location permission is a free choice
 * (PRODUCT_SPEC §10), so the behaviours worth pinning are the ones that make it feel *good*
 * rather than the ones that make it work:
 *
 * 1. It does not pester the geocoder — nothing below the minimum query length, one lookup per
 *    settled query, not one per keystroke.
 * 2. **No spinner flash.** A geocoder that answers quickly never paints a "Searching…" line; a
 *    genuinely slow one does.
 * 3. Every outcome has words: candidates, "no places found", and a reachable retry when the
 *    geocoder itself is unavailable.
 * 4. A stale answer cannot overwrite a fresh one.
 * 5. Choosing a row hands the caller the candidate, unchanged.
 */

import { act, configure, fireEvent, render, screen } from '@testing-library/react-native';

import { BUSY_AFTER_MS, CitySearch, MIN_QUERY_LENGTH } from '../CitySearch';
import type { CitySearchResult } from '@/services/location';
import type { AppLocation } from '@/domain/types';
import { initI18n } from '@/i18n';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

const mockSearchCity = jest.fn<Promise<CitySearchResult>, [string]>();

// The real store would construct the expo-location adapter; the component only ever uses this
// one action, and driving it by hand is what makes the timing assertions possible at all.
jest.mock('@/stores/locationStore', () => {
  // One stable object, as the real store's `useShallow` selector guarantees. Handing back a fresh
  // function every render would restart the component's debounce on every state change — which is
  // a property of the fake, not of the component.
  const actions = { searchCity: (query: string) => mockSearchCity(query) };
  return { useLocationActions: () => actions };
});

configure({ defaultIncludeHiddenElements: true });

function city(label: string, latitude: number, longitude: number): AppLocation {
  return { label, latitude, longitude, source: 'manual', resolvedAt: 1, countryCode: 'TR' };
}

const ISTANBUL = city('Istanbul, Türkiye', 41.01, 28.98);
const IZMIR = city('Izmir, Türkiye', 38.42, 27.14);

/** A promise the test resolves by hand, so "slow geocoder" is a thing that can be tested. */
function deferred<T>() {
  let settle: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/** Types into the field and lets the debounce elapse (but nothing else). */
async function type(text: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('city-search-input'), text);
  });
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
}

async function renderSearch() {
  const onSelect = jest.fn();
  await render(<CitySearch onSelect={onSelect} />);
  return { onSelect };
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  jest.useFakeTimers();
  mockSearchCity.mockReset();
  mockSearchCity.mockResolvedValue({ results: [ISTANBUL, IZMIR], error: null });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('asking the geocoder', () => {
  it('sends nothing for a query below the minimum length', async () => {
    await renderSearch();
    await type('I'.repeat(MIN_QUERY_LENGTH - 1));
    expect(mockSearchCity).not.toHaveBeenCalled();
  });

  it('debounces a burst of keystrokes into a single lookup', async () => {
    await renderSearch();
    const input = screen.getByTestId('city-search-input');
    await act(async () => {
      fireEvent.changeText(input, 'Is');
      fireEvent.changeText(input, 'Ist');
      fireEvent.changeText(input, 'Istan');
      fireEvent.changeText(input, 'Istanbul');
    });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(mockSearchCity).toHaveBeenCalledTimes(1);
    expect(mockSearchCity).toHaveBeenCalledWith('Istanbul');
  });

  it('trims the query before sending it', async () => {
    await renderSearch();
    await type('  Istanbul  ');
    expect(mockSearchCity).toHaveBeenCalledWith('Istanbul');
  });
});

describe('the busy line', () => {
  it('never appears for a geocoder that answers quickly', async () => {
    await renderSearch();
    await type('Istanbul');
    expect(screen.queryByTestId('city-search-busy')).toBeNull();
    expect(screen.getByTestId('city-search-results')).toBeTruthy();
  });

  it('appears once a lookup has been running long enough', async () => {
    const slow = deferred<CitySearchResult>();
    mockSearchCity.mockReturnValue(slow.promise);
    await renderSearch();
    await type('Istanbul');

    expect(screen.queryByTestId('city-search-busy')).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(BUSY_AFTER_MS + 50);
    });
    expect(screen.getByTestId('city-search-busy')).toBeTruthy();

    await act(async () => {
      slow.settle({ results: [ISTANBUL], error: null });
    });
    expect(screen.queryByTestId('city-search-busy')).toBeNull();
  });
});

describe('outcomes', () => {
  it('renders one row per candidate and hands the tapped one back', async () => {
    const { onSelect } = await renderSearch();
    await type('Istanbul');

    expect(screen.getByText(ISTANBUL.label)).toBeTruthy();
    expect(screen.getByText(IZMIR.label)).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId(`city-result-${IZMIR.label}`));
    });
    expect(onSelect).toHaveBeenCalledWith(IZMIR);
  });

  it('says so, naming the query, when the geocoder knows no such place', async () => {
    mockSearchCity.mockResolvedValue({ results: [], error: 'noResults' });
    await renderSearch();
    await type('Atlantis');

    expect(screen.getByTestId('city-search-empty')).toBeTruthy();
    expect(screen.queryByTestId('city-search-results')).toBeNull();
    expect(screen.getByText(/Atlantis/)).toBeTruthy();
  });

  it('offers a retry when the geocoder itself is unavailable', async () => {
    mockSearchCity.mockResolvedValue({ results: [], error: 'geocodeUnavailable' });
    await renderSearch();
    await type('Istanbul');

    expect(screen.getByTestId('city-search-failed')).toBeTruthy();
    expect(mockSearchCity).toHaveBeenCalledTimes(1);

    mockSearchCity.mockResolvedValue({ results: [ISTANBUL], error: null });
    await act(async () => {
      fireEvent.press(screen.getByTestId('city-search-retry'));
    });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(mockSearchCity).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('city-search-results')).toBeTruthy();
  });

  it('degrades to the failure line if the service ever rejects', async () => {
    mockSearchCity.mockRejectedValue(new Error('boom'));
    await renderSearch();
    await type('Istanbul');
    expect(screen.getByTestId('city-search-failed')).toBeTruthy();
  });
});

describe('races and resets', () => {
  it('drops a slow answer that lands after a newer one', async () => {
    const slow = deferred<CitySearchResult>();
    mockSearchCity.mockReturnValueOnce(slow.promise);
    await renderSearch();
    await type('Ist');

    mockSearchCity.mockResolvedValue({ results: [IZMIR], error: null });
    await type('Izmir');
    expect(screen.getByText(IZMIR.label)).toBeTruthy();

    // The abandoned "Ist" lookup finally answers — and must change nothing.
    await act(async () => {
      slow.settle({ results: [ISTANBUL], error: null });
    });
    expect(screen.queryByText(ISTANBUL.label)).toBeNull();
    expect(screen.getByText(IZMIR.label)).toBeTruthy();
  });

  it('clears the results when the field is emptied', async () => {
    await renderSearch();
    await type('Istanbul');
    expect(screen.getByTestId('city-search-results')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('city-search-clear'));
    });
    expect(screen.queryByTestId('city-search-results')).toBeNull();
    expect(screen.queryByTestId('city-search-busy')).toBeNull();
  });
});

describe('the city already in use', () => {
  it('is marked in the results', async () => {
    await render(<CitySearch onSelect={jest.fn()} selectedLabel={ISTANBUL.label} />);
    await type('Istanbul');

    const current = screen.getByTestId(`city-result-${ISTANBUL.label}`);
    expect(current.props.accessibilityState).toMatchObject({ selected: true });
    const other = screen.getByTestId(`city-result-${IZMIR.label}`);
    expect(other.props.accessibilityState).toMatchObject({ selected: false });
  });
});
