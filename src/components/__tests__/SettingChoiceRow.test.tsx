/**
 * Tests for `SettingChoiceRow` — the two-to-four-option chip row.
 *
 * What matters here is that the selection is legible without colour (a check glyph and a
 * `selected` accessibility state), that picking a chip reports the new value exactly once, and
 * that re-picking the current one reports nothing — a settings screen must never write a value
 * that did not change, because every write reschedules notifications downstream.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { SettingChoiceRow, type SettingChoiceOption } from '../SettingChoiceRow';
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

/** Material Symbols codepoint for `check` (see components/Icon.tsx). */
const CHECK = String.fromCodePoint(0xe668);

type Mode = 'soft' | 'hard';

const OPTIONS: SettingChoiceOption<Mode>[] = [
  { value: 'soft', label: 'Relaxed', description: 'One prayer keeps the day.' },
  { value: 'hard', label: 'Committed', description: 'All five keep the day.' },
];

beforeAll(() => {
  initI18n();
});

describe('SettingChoiceRow', () => {
  it('renders every option and the selected one’s explanation', async () => {
    await render(
      <SettingChoiceRow
        testID="choice"
        label="Streak mode"
        options={OPTIONS}
        value="soft"
        onChange={jest.fn()}
      />
    );

    expect(screen.getByText('Streak mode')).toBeTruthy();
    expect(screen.getByText('Relaxed')).toBeTruthy();
    expect(screen.getByText('Committed')).toBeTruthy();
    expect(screen.getByText('One prayer keeps the day.')).toBeTruthy();
    expect(screen.queryByText('All five keep the day.')).toBeNull();
  });

  it('marks the selection with a glyph and a state, not only a colour', async () => {
    await render(
      <SettingChoiceRow
        testID="choice"
        label="Streak mode"
        options={OPTIONS}
        value="hard"
        onChange={jest.fn()}
      />
    );

    // Exactly one check glyph, and it is inside the selected chip.
    expect(screen.getAllByText(CHECK)).toHaveLength(1);
    expect(screen.getByTestId('choice-option-hard').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByTestId('choice-option-soft').props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('exposes the chips as radios in a labelled group', async () => {
    await render(
      <SettingChoiceRow
        testID="choice"
        label="Streak mode"
        options={OPTIONS}
        value="soft"
        onChange={jest.fn()}
      />
    );

    const group = screen.getByTestId('choice-options');
    expect(group.props.accessibilityRole).toBe('radiogroup');
    expect(group.props.accessibilityLabel).toBe('Streak mode');
    // The group is not itself an accessibility element: the chips have to stay focusable.
    expect(group.props.accessible).toBeUndefined();
    expect(screen.getByTestId('choice-option-hard').props.accessibilityRole).toBe('radio');
    expect(screen.getByTestId('choice-option-soft').props.accessibilityLabel).toBe('Relaxed');
  });

  it('reports a new choice once', async () => {
    const onChange = jest.fn();
    await render(
      <SettingChoiceRow
        testID="choice"
        label="Streak mode"
        options={OPTIONS}
        value="soft"
        onChange={onChange}
      />
    );

    await fireEvent.press(screen.getByTestId('choice-option-hard'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('hard');
  });

  it('reports nothing when the current choice is pressed again', async () => {
    const onChange = jest.fn();
    await render(
      <SettingChoiceRow
        testID="choice"
        label="Streak mode"
        options={OPTIONS}
        value="soft"
        onChange={onChange}
      />
    );

    await fireEvent.press(screen.getByTestId('choice-option-soft'));

    expect(onChange).not.toHaveBeenCalled();
  });
});
