/**
 * @jest-environment <rootDir>/src/testing/fixedTimezoneEnvironment.js
 * @jest-environment-options {"timezone": "Europe/Istanbul"}
 */

/**
 * The list of reminders the OS is holding.
 *
 * This component is where the reliability screen's central claim becomes visible: it renders the
 * *platform's* answer, in the platform's order, and it stays honest about how much of it fits.
 * The behaviours worth pinning are the ones a user would notice being wrong at 04:50:
 *
 * - Chronological order, whatever order the OS returned.
 * - Day grouping, with today and tomorrow named rather than dated.
 * - Anything without one of our payloads dropped — the test notification is not a reminder, and a
 *   row we cannot name is not information.
 */

import { render, screen } from '@testing-library/react-native';

import { ScheduledReminderList } from '../ScheduledReminderList';
import { DEFAULT_ADHAN_VOICE } from '@/domain/adhanVoices';
import { initI18n } from '@/i18n';

import type { NotificationKind, Prayer } from '@/domain/types';
import type { ScheduledNotification } from '@/services/notifications';

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

const TODAY = '2026-08-19';

function entry(
  kind: NotificationKind,
  day: string,
  prayer: Prayer,
  iso: string
): ScheduledNotification {
  const key = `${kind}:${day}:${prayer}`;
  return {
    identifier: key,
    fireAt: new Date(iso),
    payload: {
      key,
      kind,
      prayer,
      day,
      fireAt: new Date(iso).getTime(),
      sound: 'system',
      voice: DEFAULT_ADHAN_VOICE,
      lang: 'en',
      url: '/',
    },
    title: null,
    body: null,
  };
}

/** A notification of somebody else's — or of ours without a payload we can read. */
const FOREIGN: ScheduledNotification = {
  identifier: 'test',
  fireAt: null,
  payload: null,
  title: 'Reminders are working',
  body: null,
};

beforeAll(() => {
  initI18n();
});

describe('ScheduledReminderList', () => {
  it('renders the OS list in time order, whatever order it arrived in', async () => {
    await render(
      <ScheduledReminderList
        testID="list"
        todayDay={TODAY}
        entries={[
          entry('adhan', '2026-08-20', 'fajr', '2026-08-20T02:10:00.000Z'),
          entry('adhan', TODAY, 'maghrib', '2026-08-19T16:40:00.000Z'),
          entry('nudge', TODAY, 'maghrib', '2026-08-19T18:00:00.000Z'),
        ]}
      />
    );

    const rows = screen.getAllByLabelText(/Maghrib|Fajr/);
    expect(rows.map((row) => row.props.accessibilityLabel)).toEqual([
      'Maghrib, At the time, 7:40 pm',
      'Maghrib, Last call, 9:00 pm',
      'Fajr, At the time, 5:10 am',
    ]);
  });

  it('names today and tomorrow, and dates anything further out', async () => {
    await render(
      <ScheduledReminderList
        testID="list"
        todayDay={TODAY}
        entries={[
          entry('adhan', TODAY, 'isha', '2026-08-19T18:30:00.000Z'),
          entry('adhan', '2026-08-20', 'fajr', '2026-08-20T02:10:00.000Z'),
          entry('adhan', '2026-08-22', 'fajr', '2026-08-22T02:12:00.000Z'),
        ]}
      />
    );

    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Tomorrow')).toBeTruthy();
    // The third day is a date, formatted by Intl in the UI language.
    expect(screen.queryByText(/Sat/)).toBeTruthy();
  });

  it('collapses the tail into a count rather than growing without limit', async () => {
    const entries = Array.from({ length: 9 }, (_, index) =>
      entry('adhan', TODAY, 'fajr', `2026-08-19T0${index}:00:00.000Z`)
    ).map((row, index) => ({
      ...row,
      identifier: `adhan:${index}`,
      payload: { ...row.payload!, key: `adhan:${index}` },
    }));

    await render(
      <ScheduledReminderList testID="list" todayDay={TODAY} entries={entries} limit={4} />
    );

    expect(screen.getByTestId('reminder-health-scheduled-adhan:0')).toBeTruthy();
    expect(screen.queryByTestId('reminder-health-scheduled-adhan:8')).toBeNull();
    expect(screen.getByText('and 5 more further ahead')).toBeTruthy();
  });

  it('drops notifications it cannot name', async () => {
    await render(
      <ScheduledReminderList
        testID="list"
        todayDay={TODAY}
        entries={[FOREIGN, entry('adhan', TODAY, 'asr', '2026-08-19T13:20:00.000Z')]}
      />
    );

    expect(screen.queryByText('Reminders are working')).toBeNull();
    expect(screen.getByTestId(`reminder-health-scheduled-adhan:${TODAY}:asr`)).toBeTruthy();
  });

  it('renders nothing at all when the OS holds none of ours', async () => {
    await render(<ScheduledReminderList testID="list" todayDay={TODAY} entries={[FOREIGN]} />);

    // "The OS is holding nothing" is a verdict; the screen renders it, not this list.
    expect(screen.queryByTestId('list')).toBeNull();
  });
});
