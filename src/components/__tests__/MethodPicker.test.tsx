/**
 * Component test for the calculation-method picker.
 *
 * The picker is the app's credibility instrument (PRODUCT_SPEC §3, our market research): the
 * authority has to be **nameable**, which means `Auto` may never be a shrug. What is tested is
 * exactly that contract:
 *
 * 1. Every authority `domain/methods` offers gets a row, in the domain's order, `auto` first.
 * 2. The `auto` row spells out what it currently resolves to for the user's country — the same
 *    answer the engine will compute, because it comes from the same `resolveMethod`.
 * 3. Selection is announced, not merely coloured.
 * 4. Choosing a row reports the method id and nothing else; the component stores nothing.
 */

import { act, configure, fireEvent, render, screen } from '@testing-library/react-native';

import { MethodPicker } from '../MethodPicker';
import { listMethods } from '@/domain/methods';
import { initI18n } from '@/i18n';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

configure({ defaultIncludeHiddenElements: true });

beforeAll(() => {
  initI18n();
});

async function renderPicker(props: Partial<React.ComponentProps<typeof MethodPicker>> = {}) {
  const onChange = jest.fn();
  await render(
    <MethodPicker
      value="auto"
      countryCode="TR"
      countryName="Türkiye"
      onChange={onChange}
      {...props}
    />
  );
  return { onChange };
}

describe('the list', () => {
  it('offers every method the domain knows, with auto first', async () => {
    await renderPicker();
    const options = listMethods();
    expect(options[0].id).toBe('auto');
    for (const option of options) {
      expect(screen.getByTestId(`method-option-${option.id}`)).toBeTruthy();
    }
  });

  it('announces itself as a radio group', async () => {
    await renderPicker();
    expect(screen.getByTestId('method-picker').props.accessibilityRole).toBe('radiogroup');
  });
});

describe('naming what auto means', () => {
  it('spells out the authority resolved from the country', async () => {
    await renderPicker({ countryCode: 'TR', countryName: 'Türkiye' });
    // "Auto · Diyanet" — the country map's answer, not the word "Auto" on its own. (The Diyanet
    // row itself also says "Diyanet", which is why this reads the auto row specifically.)
    const autoRow = screen.getByTestId('method-option-auto');
    expect(autoRow.props.accessibilityLabel).toMatch(/Diyanet/);
    expect(autoRow.props.accessibilityLabel).toMatch(/Türkiye/);
  });

  it('resolves a different country to a different authority', async () => {
    await renderPicker({ countryCode: 'US', countryName: 'United States' });
    const autoRow = screen.getByTestId('method-option-auto');
    expect(autoRow.props.accessibilityLabel).toMatch(/ISNA/);
  });

  it('falls back to the global default when no country is known', async () => {
    await renderPicker({ countryCode: undefined, countryName: undefined });
    const autoRow = screen.getByTestId('method-option-auto');
    expect(autoRow.props.accessibilityLabel).toMatch(/Muslim World League/);
  });
});

describe('choosing', () => {
  it('marks the selected row for assistive technology, not only in colour', async () => {
    await renderPicker({ value: 'ummAlQura' });
    expect(screen.getByTestId('method-option-ummAlQura').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByTestId('method-option-auto').props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('reports the chosen method id', async () => {
    const { onChange } = await renderPicker();
    await act(async () => {
      fireEvent.press(screen.getByTestId('method-option-jafari'));
    });
    expect(onChange).toHaveBeenCalledWith('jafari');
  });

  it('can go back to auto', async () => {
    const { onChange } = await renderPicker({ value: 'karachi' });
    await act(async () => {
      fireEvent.press(screen.getByTestId('method-option-auto'));
    });
    expect(onChange).toHaveBeenCalledWith('auto');
  });
});
