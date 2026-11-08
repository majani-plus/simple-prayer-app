/**
 * Component test for the Today tab's qada card.
 *
 * What matters here is not the layout but the promises the card makes (PRODUCT_SPEC §7):
 *
 * 1. at zero it is not on screen at all — no "0 left to make up" reminder;
 * 2. above zero it says what is left, and that is *all* it says;
 * 3. it is a way through to the qada screen and nothing else — it never writes. The one-tap
 *    "+1 made up" that used to live here (with an undo behind it) was removed by the owner:
 *    making a prayer up is a deliberate act that belongs on the qada screen, where the user can
 *    see which prayer they are settling. Today's one tap is for the prayer in front of them.
 *
 * The tracking store is mocked — it would open SQLite — but the mock is backed by the REAL
 * `domain/qada`, and every mutating action is a spy, so "the card wrote nothing" is checkable
 * rather than assumed.
 */

import { act, configure, fireEvent, render, screen } from '@testing-library/react-native';

import { QadaCard } from '../QadaCard';
import type { Prayer, QadaDebts } from '@/domain/types';
import { initI18n } from '@/i18n';

jest.mock('react-native-mmkv', () => {
  const values = new Map<string, string>();
  return {
    createMMKV: () => ({
      set: (key: string, value: string) => void values.set(key, value),
      getString: (key: string) => values.get(key),
      remove: (key: string) => void values.delete(key),
    }),
  };
});

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

/**
 * A tracking store that persists nothing, in a real zustand store so the card re-renders exactly
 * as it would in the app. Every write is a spy: the card must not use any of them.
 */
jest.mock('@/stores/trackingStore', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  const qada = jest.requireActual<typeof import('@/domain/qada')>('@/domain/qada');

  const writes = {
    tickQada: jest.fn((_prayer: Prayer) => true),
    setQadaDebts: jest.fn((debts: QadaDebts) => debts),
    forgiveQada: jest.fn(() => false),
    undoForgive: jest.fn(() => false),
  };

  const store = create<{
    debts: QadaDebts;
    revision: number;
    hydrated: boolean;
    qadaProgress: () => unknown;
    undoableForgive: () => null;
  }>((_set, get) => ({
    debts: qada.emptyDebts(),
    revision: 0,
    hydrated: true,
    ...writes,
    qadaProgress: () => ({
      debts: get().debts,
      total: qada.totalDebt(get().debts),
      paidInWindow: 0,
      perDay: 0,
      projectedClearDay: null,
    }),
    undoableForgive: () => null,
  }));

  return {
    __store: store,
    __writes: writes,
    useTrackingHydrated: () => store((s) => s.hydrated),
    useQadaDebts: () => store((s) => s.debts),
    useTrackingActions: () => store.getState(),
    useTrackingStore: (selector: (state: unknown) => unknown) => store(selector),
  };
});

const { __store: trackingStore, __writes: writes } = jest.requireMock(
  '@/stores/trackingStore'
) as {
  __store: {
    setState: (partial: { debts: QadaDebts; revision: number }) => void;
    getState: () => { debts: QadaDebts; revision: number };
  };
  __writes: Record<string, jest.Mock>;
};

configure({ defaultIncludeHiddenElements: true });

function seed(debts: Partial<QadaDebts>) {
  const full = { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0, ...debts };
  trackingStore.setState({ debts: full, revision: trackingStore.getState().revision + 1 });
}

async function renderCard(onPress = jest.fn()) {
  const view = await render(<QadaCard onPress={onPress} />);
  return { ...view, onPress };
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  jest.clearAllMocks();
  seed({});
});

describe('QadaCard', () => {
  it('renders nothing at all when nothing is owed', async () => {
    await renderCard();
    expect(screen.queryByTestId('qada-card')).toBeNull();
  });

  it('shows what is left once something is owed', async () => {
    seed({ fajr: 4, dhuhr: 11, isha: 2 });
    await renderCard();

    expect(screen.getByTestId('qada-card-total').props.children).toBe('17');
    expect(screen.getByTestId('qada-card-status').props.children).toBe('Tap to see all five');
    expect(screen.getByTestId('qada-card').props.accessibilityLabel).toBe(
      'Making up prayers — 17 prayers still to go'
    );
  });

  it('opens the qada screen when the card is tapped', async () => {
    seed({ fajr: 3 });
    const { onPress } = await renderCard();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-card'));
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('offers no way to make a prayer up from Today, and writes nothing', async () => {
    seed({ fajr: 4, dhuhr: 11 });
    const { onPress } = await renderCard();

    // The quick button and its undo are gone by the owner's decision — the qada screen owns
    // making prayers up, so the card cannot move a counter at all.
    expect(screen.queryByTestId('qada-card-make-up')).toBeNull();
    expect(screen.queryByTestId('qada-card-undo')).toBeNull();
    expect(screen.queryByTestId('qada-card-action')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('qada-card'));
    });

    expect(onPress).toHaveBeenCalledTimes(1);
    for (const write of Object.values(writes)) {
      expect(write).not.toHaveBeenCalled();
    }
    expect(trackingStore.getState().debts).toEqual({
      fajr: 4,
      dhuhr: 11,
      asr: 0,
      maghrib: 0,
      isha: 0,
    });
  });

  it('follows the counter down and disappears when the debt is cleared elsewhere', async () => {
    seed({ fajr: 1 });
    await renderCard();
    expect(screen.getByTestId('qada-card-total').props.children).toBe('1');

    await act(async () => {
      seed({});
    });

    expect(screen.queryByTestId('qada-card')).toBeNull();
  });
});
