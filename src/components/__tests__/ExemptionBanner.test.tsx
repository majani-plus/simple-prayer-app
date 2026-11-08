import { fireEvent, render, screen } from '@testing-library/react-native';

import { ExemptionBanner, STILL_ON_AFTER_DAYS } from '../ExemptionBanner';
import { addDays } from '@/domain/dates';
import i18n, { initI18n } from '@/i18n';

/**
 * The open-period banner (spec-exemption §3): the record, the end control and the
 * forgotten-period defence in one quiet card. What matters here:
 *
 * - the body names the start date and says reminders are paused — prayer-specific wording;
 * - "End" is a real labelled button (the banner IS the end control);
 * - the gentle line appears at exactly {@link STILL_ON_AFTER_DAYS} days, is static, and carries
 *   no number — a door held open, never a count;
 * - there is no dismiss affordance of any kind: dismissing it would recreate the
 *   silent-forever-exempt trap.
 */

const TODAY = '2026-08-19';

beforeAll(() => {
  initI18n();
});

beforeEach(async () => {
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
});

describe('ExemptionBanner', () => {
  it('states the record calmly: since-date, nothing owed, reminders paused', async () => {
    await render(
      <ExemptionBanner testID="banner" sinceDay="2026-08-17" today={TODAY} onEnd={jest.fn()} />
    );

    const body = screen.getByTestId('banner-body');
    expect(body.props.children).toBe(
      'Excused since August 17 — no prayers are owed for these days. Reminders are paused.'
    );
  });

  it('wires the End action, labelled in words', async () => {
    const onEnd = jest.fn();
    await render(
      <ExemptionBanner testID="banner" sinceDay="2026-08-17" today={TODAY} onEnd={onEnd} />
    );

    const end = screen.getByTestId('banner-end');
    expect(end.props.accessibilityLabel).toBe('End excused days');
    fireEvent.press(end);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it(`stays one line below ${STILL_ON_AFTER_DAYS} days, and grows the gentle line at exactly ${STILL_ON_AFTER_DAYS}`, async () => {
    const view = await render(
      <ExemptionBanner
        testID="banner"
        sinceDay={addDays(TODAY, -(STILL_ON_AFTER_DAYS - 1))}
        today={TODAY}
        onEnd={jest.fn()}
      />
    );
    expect(screen.queryByTestId('banner-still-on')).toBeNull();

    await view.rerender(
      <ExemptionBanner
        testID="banner"
        sinceDay={addDays(TODAY, -STILL_ON_AFTER_DAYS)}
        today={TODAY}
        onEnd={jest.fn()}
      />
    );

    const line = screen.getByTestId('banner-still-on');
    expect(line.props.children).toBe(
      'Still excused? End it here whenever you’re ready — there’s no rush.'
    );
    // No count, no number, no escalation — the line is the same on day 5 and day 50.
    expect(String(line.props.children)).not.toMatch(/\d/);
  });

  describe('a period begun with an end date', () => {
    it('says "until" instead of "since", naming the last excused day', async () => {
      await render(
        <ExemptionBanner
          testID="banner"
          sinceDay="2026-08-17"
          untilDay="2026-08-21"
          today={TODAY}
          onEnd={jest.fn()}
        />
      );

      expect(screen.getByTestId('banner-body').props.children).toBe(
        'Excused until August 21 — no prayers are owed for these days. Reminders are paused.'
      );
    });

    it('never grows the gentle line, however long the period is', async () => {
      // The line exists to catch an exemption nobody remembered to end. One that ends itself
      // cannot be forgotten, so asking "still excused?" would be interrogation, not help.
      await render(
        <ExemptionBanner
          testID="banner"
          sinceDay={addDays(TODAY, -(STILL_ON_AFTER_DAYS + 10))}
          untilDay={addDays(TODAY, 3)}
          today={TODAY}
          onEnd={jest.fn()}
        />
      );

      expect(screen.queryByTestId('banner-still-on')).toBeNull();
    });

    it('still offers End, because a plan can be cut short', async () => {
      const onEnd = jest.fn();
      await render(
        <ExemptionBanner
          testID="banner"
          sinceDay="2026-08-17"
          untilDay="2026-08-21"
          today={TODAY}
          onEnd={onEnd}
        />
      );

      fireEvent.press(screen.getByTestId('banner-end'));
      expect(onEnd).toHaveBeenCalledTimes(1);
    });
  });

  it('offers exactly one control — there is nothing to dismiss', async () => {
    await render(
      <ExemptionBanner testID="banner" sinceDay="2026-08-01" today={TODAY} onEnd={jest.fn()} />
    );

    // The banner is the forgotten-period defence; a close affordance would defeat it.
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.props.testID).toBe('banner-end');
  });
});
