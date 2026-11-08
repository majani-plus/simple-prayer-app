/**
 * Tests for `SettingGroup` — the card that holds a block of settings rows.
 *
 * Two behaviours other screens actually depend on:
 *
 * 1. an empty group renders **nothing** (no rule, no title, no empty card), which is what makes
 *    it safe to leave a group in the Settings tab as a slot for rows that do not exist yet;
 * 2. conditional children (`null`, `false`) count as no content, so a platform-specific group
 *    disappears on the other platform without the caller writing a second condition.
 */

import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { SettingGroup } from '../SettingGroup';
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

beforeAll(() => {
  initI18n();
});

describe('SettingGroup', () => {
  it('renders its title, rows and footnote', async () => {
    await render(
      <SettingGroup testID="group" title="Reminders" footer="Reminders are local to this device.">
        <Text>First row</Text>
        <Text>Second row</Text>
      </SettingGroup>
    );

    expect(screen.getByTestId('group')).toBeTruthy();
    expect(screen.getByText('Reminders')).toBeTruthy();
    expect(screen.getByText('First row')).toBeTruthy();
    expect(screen.getByText('Second row')).toBeTruthy();
    expect(screen.getByText('Reminders are local to this device.')).toBeTruthy();
  });

  it('announces its title as a heading', async () => {
    await render(
      <SettingGroup title="Tracking">
        <Text>Row</Text>
      </SettingGroup>
    );

    expect(screen.getByText('Tracking').props.accessibilityRole).toBe('header');
  });

  it('renders nothing at all when it has no rows — the slot case', async () => {
    await render(<SettingGroup testID="group" title="Data" footer="Nothing here yet" />);

    expect(screen.queryByTestId('group')).toBeNull();
    expect(screen.queryByText('Data')).toBeNull();
    expect(screen.queryByText('Nothing here yet')).toBeNull();
  });

  it('treats conditional children that render nothing as no rows', async () => {
    const androidOnly = false;
    await render(
      <SettingGroup testID="group" title="Data">
        {androidOnly ? <Text>Ongoing notification</Text> : null}
        {null}
      </SettingGroup>
    );

    expect(screen.queryByTestId('group')).toBeNull();
  });

  it('keeps the group when at least one conditional row survives', async () => {
    await render(
      <SettingGroup testID="group" title="Data">
        {null}
        <Text>Export</Text>
      </SettingGroup>
    );

    expect(screen.getByTestId('group')).toBeTruthy();
    expect(screen.getByText('Export')).toBeTruthy();
  });
});
