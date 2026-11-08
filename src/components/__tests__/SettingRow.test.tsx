/**
 * Tests for the settings row vocabulary (`SettingRow`, `SettingNavigationRow`,
 * `SettingSwitchRow`).
 *
 * These rows are the alphabet every settings screen is written in, so what is pinned here is the
 * contract other screens rely on rather than the pixels: what is rendered, what is pressable,
 * what assistive technology is told, and — for the switch row — that the whole row is one target
 * that toggles exactly once.
 *
 * MMKV is mocked because `AppText` pulls in i18next, which the app's settings singleton hydrates
 * alongside; nothing here reads a setting.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { labelLines, SettingNavigationRow, SettingRow, SettingSwitchRow } from '../SettingRow';
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

/** Material Symbols codepoint for `chevron_right` (see components/Icon.tsx). */
const CHEVRON = String.fromCodePoint(0xe5cc);

beforeAll(() => {
  initI18n();
});

describe('SettingRow', () => {
  it('renders the label, description and value it is given', async () => {
    await render(
      <SettingRow label="Calculation" description="Method and madhab" value="Auto (Diyanet)" />
    );

    expect(screen.getByText('Calculation')).toBeTruthy();
    expect(screen.getByText('Method and madhab')).toBeTruthy();
    expect(screen.getByText('Auto (Diyanet)')).toBeTruthy();
  });

  it('is inert and shows no chevron without an onPress', async () => {
    await render(<SettingRow testID="row" label="Version" value="1.0.0" />);

    expect(screen.queryByText(CHEVRON)).toBeNull();
    expect(screen.getByTestId('row').props.onClick).toBeUndefined();
  });

  it('becomes a button with a chevron when it navigates', async () => {
    const onPress = jest.fn();
    await render(<SettingNavigationRow testID="row" label="Location" onPress={onPress} />);

    const row = screen.getByTestId('row');
    expect(row.props.accessibilityRole).toBe('button');
    expect(screen.getByText(CHEVRON)).toBeTruthy();

    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('reads its value out as part of its accessibility label', async () => {
    await render(
      <SettingNavigationRow
        testID="row"
        label="Location"
        value="Istanbul"
        accessibilityHint="Opens location settings"
        onPress={jest.fn()}
      />
    );

    const row = screen.getByTestId('row');
    expect(row.props.accessibilityLabel).toBe('Location, Istanbul');
    expect(row.props.accessibilityHint).toBe('Opens location settings');
  });

  it('refuses presses but stays announced when disabled', async () => {
    const onPress = jest.fn();
    await render(<SettingNavigationRow testID="row" label="Location" disabled onPress={onPress} />);

    const row = screen.getByTestId('row');
    // Still a button, announced as unavailable — not silently dropped out of the tree.
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.press(row);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('SettingSwitchRow', () => {
  it('says the state in words, not only in colour', async () => {
    const { rerender } = await render(
      <SettingSwitchRow
        testID="row"
        label="Exemption mode"
        value={false}
        onValueChange={jest.fn()}
        onLabel="On"
        offLabel="Off"
      />
    );

    expect(screen.getByText('Off')).toBeTruthy();

    await rerender(
      <SettingSwitchRow
        testID="row"
        label="Exemption mode"
        value
        onValueChange={jest.fn()}
        onLabel="On"
        offLabel="Off"
      />
    );
    expect(screen.getByText('On')).toBeTruthy();
  });

  it('exposes itself as a switch with a checked state', async () => {
    await render(
      <SettingSwitchRow
        testID="row"
        label="Exemption mode"
        value
        onValueChange={jest.fn()}
        onLabel="On"
        offLabel="Off"
      />
    );

    const row = screen.getByTestId('row');
    expect(row.props.accessibilityRole).toBe('switch');
    expect(row.props.accessibilityState).toMatchObject({ checked: true });
  });

  it('toggles exactly once from a press anywhere on the row', async () => {
    const onValueChange = jest.fn();
    await render(
      <SettingSwitchRow
        testID="row"
        label="Exemption mode"
        value={false}
        onValueChange={onValueChange}
        onLabel="On"
        offLabel="Off"
      />
    );

    await fireEvent.press(screen.getByTestId('row'));

    // One call, with the new value — the inert `Switch` inside must not fire a second one.
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith(true);
  });
});

/**
 * Regression: at Apple's 200% Dynamic Type bar the Settings label truncated to "Your locati…",
 * with the rest of the word living nowhere — the one thing the Larger Text criterion forbids.
 * Found by rendering Settings on an 11 Pro Max at `accessibility-medium`, because the label
 * column is narrowed by the icon gutter and the value's 45% and no test does layout.
 */
describe('labelLines', () => {
  it('keeps two lines at ordinary text sizes, so short labels do not grow the row', () => {
    expect(labelLines(1)).toBe(2);
    expect(labelLines(1.2)).toBe(2);
  });

  it('gives a label more lines as the type grows, rather than truncating it', () => {
    expect(labelLines(1.5)).toBeGreaterThan(2);
    expect(labelLines(2)).toBeGreaterThanOrEqual(3);
    expect(labelLines(2)).toBeGreaterThan(labelLines(1));
  });

  it('still caps, so one long label cannot push the control off a small screen', () => {
    expect(labelLines(3)).toBeLessThanOrEqual(4);
    expect(labelLines(10)).toBeLessThanOrEqual(4);
  });

  it('never returns fewer than two lines, whatever the platform reports', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(labelLines(bad)).toBeGreaterThanOrEqual(2);
    }
  });
});
