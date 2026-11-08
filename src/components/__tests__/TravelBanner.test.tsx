import { fireEvent, render, screen } from '@testing-library/react-native';

import { TravelBanner, STILL_TRAVELING_AFTER_DAYS } from '../TravelBanner';
import { addDays } from '@/domain/dates';
import i18n, { initI18n } from '@/i18n';

/**
 * The travel banner (D115). What matters here:
 *
 * - the body says what changed about marking, not the fiqh — the rule was read in the begin sheet;
 * - "End" is a real labelled button, and it ends travel outright: nothing to backdate;
 * - the gentle line appears at exactly {@link STILL_TRAVELING_AFTER_DAYS} days of OPEN-ENDED travel,
 *   is static and carries no number, and never appears at all once an end date exists;
 * - there is no dismiss affordance: a state the user cannot see is a state they cannot end.
 */

const TODAY = '2026-08-19';

beforeAll(() => {
  initI18n();
});

beforeEach(async () => {
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
});

describe('TravelBanner', () => {
  it('states what travel changes, calmly', async () => {
    await render(<TravelBanner testID="banner" sinceDay={TODAY} today={TODAY} onEnd={jest.fn()} />);

    expect(screen.getByTestId('banner-body').props.children).toBe(
      'Travelling — shortened and combined prayers count as on time.'
    );
  });

  it('names the last travel day, weekday included, once one was chosen', async () => {
    await render(
      <TravelBanner
        testID="banner"
        sinceDay={TODAY}
        untilDay="2026-08-22"
        today={TODAY}
        onEnd={jest.fn()}
      />
    );

    // The weekday is the half somebody actually checks against; its place in the phrase is the
    // locale's business, not ours.
    expect(screen.getByTestId('banner-body').props.children).toBe(
      'Travelling until Saturday, August 22 — shortened and combined prayers count as on time.'
    );
  });

  it('wires the End action, labelled in words', async () => {
    const onEnd = jest.fn();
    await render(<TravelBanner testID="banner" sinceDay={TODAY} today={TODAY} onEnd={onEnd} />);

    const end = screen.getByTestId('banner-end');
    expect(end.props.accessibilityLabel).toBe('End travelling');
    fireEvent.press(end);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it(`grows the gentle line at exactly ${STILL_TRAVELING_AFTER_DAYS} days, and not before`, async () => {
    const view = await render(
      <TravelBanner
        testID="banner"
        sinceDay={addDays(TODAY, -(STILL_TRAVELING_AFTER_DAYS - 1))}
        today={TODAY}
        onEnd={jest.fn()}
      />
    );
    expect(screen.queryByTestId('banner-still-on')).toBeNull();

    await view.rerender(
      <TravelBanner
        testID="banner"
        sinceDay={addDays(TODAY, -STILL_TRAVELING_AFTER_DAYS)}
        today={TODAY}
        onEnd={jest.fn()}
      />
    );

    const line = screen.getByTestId('banner-still-on');
    expect(line.props.children).toBe(
      'Still travelling? End it here whenever you’re back — there’s no rush.'
    );
    // No count, no number, no escalation — the same on day 10 and day 100.
    expect(String(line.props.children)).not.toMatch(/\d/);
  });

  it('never grows that line under a journey with an end date', async () => {
    await render(
      <TravelBanner
        testID="banner"
        sinceDay={addDays(TODAY, -(STILL_TRAVELING_AFTER_DAYS + 20))}
        untilDay={addDays(TODAY, 1)}
        today={TODAY}
        onEnd={jest.fn()}
      />
    );

    expect(screen.queryByTestId('banner-still-on')).toBeNull();
  });

  it('offers exactly one control — there is nothing to dismiss', async () => {
    await render(
      <TravelBanner
        testID="banner"
        sinceDay={addDays(TODAY, -2)}
        today={TODAY}
        onEnd={jest.fn()}
      />
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.props.testID).toBe('banner-end');
  });
});
