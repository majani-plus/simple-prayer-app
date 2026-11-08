/**
 * The restart protocol.
 *
 * Turning the layout around is the one setting in this app that cannot take effect where the user
 * is standing, and every way of handling that badly is a way of looking broken:
 *
 * - restarting without asking reads as a crash,
 * - asking and then failing to restart, silently, reads as a setting that does nothing,
 * - and refusing to change the language until a restart happens reads as a setting that is stuck.
 *
 * What is pinned here is the narrow path between them: warn, apply either way, reload when the
 * runtime can, and say so plainly when it cannot. Plus the case that must stay boring — English to
 * Turkish, which changes no direction and must therefore ask for nothing.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert, I18nManager } from 'react-native';

import { useLanguageSwitch } from '../useLanguageSwitch';
import i18n, { initI18n } from '../index';
import * as reload from '../reload';

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

const mockSetLanguage = jest.fn();
let mockStoredLanguage = 'en';

jest.mock('@/stores/settingsStore', () => ({
  useLanguagePreference: () => mockStoredLanguage,
  useSettingsActions: () => ({ setLanguage: mockSetLanguage }),
}));

/** One button of the alert React Native was asked to show. */
interface AlertButton {
  text?: string;
  style?: string;
  onPress?: () => void;
}

const originalIsRTL = I18nManager.isRTL;

function layOutAs(direction: 'ltr' | 'rtl'): void {
  Object.defineProperty(I18nManager, 'isRTL', {
    value: direction === 'rtl',
    configurable: true,
  });
}

/** The arguments of the nth `Alert.alert` call: title, body, buttons. */
function alertCall(
  alert: jest.SpyInstance,
  index = 0
): { title: string; body: string; buttons: AlertButton[] } {
  const call = alert.mock.calls[index] as [string, string, AlertButton[] | undefined];
  return { title: call[0], body: call[1], buttons: call[2] ?? [] };
}

function button(buttons: AlertButton[], text: string): AlertButton {
  const found = buttons.find((candidate) => candidate.text === text);
  if (found === undefined)
    throw new Error(`No "${text}" button in [${buttons.map((b) => b.text).join(', ')}]`);
  return found;
}

let alert: jest.SpyInstance;
let allowRTL: jest.SpyInstance;
let forceRTL: jest.SpyInstance;

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  mockStoredLanguage = 'en';
  mockSetLanguage.mockClear();
  layOutAs('ltr');
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  allowRTL = jest.spyOn(I18nManager, 'allowRTL').mockImplementation(() => undefined);
  forceRTL = jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => undefined);
});

afterEach(() => {
  alert.mockRestore();
  allowRTL.mockRestore();
  forceRTL.mockRestore();
  layOutAs(originalIsRTL ? 'rtl' : 'ltr');
});

describe('a change that keeps the direction', () => {
  it('just happens, with nothing to confirm', async () => {
    const { result } = await renderHook(() => useLanguageSwitch());

    await act(() => {
      result.current.chooseLanguage('tr');
    });

    expect(mockSetLanguage).toHaveBeenCalledWith('tr');
    expect(alert).not.toHaveBeenCalled();
    expect(forceRTL).not.toHaveBeenCalled();
  });

  it('ignores re-picking the language that is already selected', async () => {
    const { result } = await renderHook(() => useLanguageSwitch());

    await act(() => {
      result.current.chooseLanguage('en');
    });

    expect(mockSetLanguage).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });
});

describe('a change that turns the layout around', () => {
  it('warns before anything happens, and names both ways out', async () => {
    const { result } = await renderHook(() => useLanguageSwitch());

    await act(() => {
      result.current.chooseLanguage('ar');
    });

    expect(alert).toHaveBeenCalledTimes(1);
    const { body, buttons } = alertCall(alert);
    // The sentence names the language in its own script, and the dialog offers a real "later".
    expect(body).toContain('العربية');
    expect(buttons.map((b) => b.text)).toEqual(['Later', 'Reopen now']);
    // Nothing has been applied yet: the user has not answered.
    expect(mockSetLanguage).not.toHaveBeenCalled();
    expect(forceRTL).not.toHaveBeenCalled();
  });

  it('changes nothing at all while the dialog is still open', async () => {
    const { result } = await renderHook(() => useLanguageSwitch());
    await act(() => {
      result.current.chooseLanguage('ar');
    });

    // Dismissing without choosing (the `cancelable` backdrop tap) fires no handler.
    expect(mockSetLanguage).not.toHaveBeenCalled();
    expect(allowRTL).not.toHaveBeenCalled();
  });

  it('reopens the app when the user says so', async () => {
    const reloadApp = jest.spyOn(reload, 'reloadApp').mockResolvedValue(true);
    const { result } = await renderHook(() => useLanguageSwitch());

    await act(() => {
      result.current.chooseLanguage('ar');
    });
    await act(async () => {
      button(alertCall(alert).buttons, 'Reopen now').onPress?.();
    });

    expect(mockSetLanguage).toHaveBeenCalledWith('ar');
    // The direction is persisted *before* the reload is attempted, so a reload that never happens
    // still leaves the next launch correct.
    expect(allowRTL).toHaveBeenCalledWith(true);
    expect(forceRTL).toHaveBeenCalledWith(true);

    // NOT in the same tick as the commit above. Tearing the runtime down while that re-render and
    // the native direction flip are still being mounted is an EXC_BAD_ACCESS in Fabric's scheduler,
    // which is what a tester hit on 1.4.0. The reload waits on a short timer instead.
    expect(reloadApp).not.toHaveBeenCalled();
    await waitFor(() => expect(reloadApp).toHaveBeenCalled());
    // A successful reload says nothing further — the app is on its way out.
    expect(alert).toHaveBeenCalledTimes(1);

    reloadApp.mockRestore();
  });

  it('says plainly that it applies next launch when it cannot reopen', async () => {
    // A dev client, Expo Go, web, or any build without `expo-updates` configured.
    const reloadApp = jest.spyOn(reload, 'reloadApp').mockResolvedValue(false);
    const { result } = await renderHook(() => useLanguageSwitch());

    await act(() => {
      result.current.chooseLanguage('ar');
    });
    await act(async () => {
      button(alertCall(alert).buttons, 'Reopen now').onPress?.();
    });

    // The language and the direction both landed; only the relaunch did not.
    expect(mockSetLanguage).toHaveBeenCalledWith('ar');
    expect(forceRTL).toHaveBeenCalledWith(true);

    // The reload is deferred past the commit, so the follow-up it triggers is too.
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
    const followUp = alertCall(alert, 1);
    // Spoken in the language just chosen — the app is already rendering it — down to the button,
    // because the OS default would say "OK" in English.
    expect(followUp.title).toBe('تغيّرت اللغة');
    expect(followUp.body).toContain('المرة القادمة');
    expect(followUp.buttons[0]?.text).toBe('حسنًا');

    reloadApp.mockRestore();
  });

  it('still applies the change when the user picks "Later"', async () => {
    const reloadApp = jest.spyOn(reload, 'reloadApp').mockResolvedValue(true);
    const { result } = await renderHook(() => useLanguageSwitch());

    await act(() => {
      result.current.chooseLanguage('ar');
    });
    await act(() => {
      button(alertCall(alert).buttons, 'Later').onPress?.();
    });

    // A setting that visibly does nothing until you restart is worse than one that half-applies
    // and has already told you so. The flag is written, so the next launch comes up right.
    expect(mockSetLanguage).toHaveBeenCalledWith('ar');
    expect(forceRTL).toHaveBeenCalledWith(true);
    // And nothing is relaunched behind the user's back.
    expect(reloadApp).not.toHaveBeenCalled();

    reloadApp.mockRestore();
  });
});

describe('leaving Arabic', () => {
  it('warns in exactly the same way, in the direction the user can still read', async () => {
    mockStoredLanguage = 'ar';
    layOutAs('rtl');
    // The app is *rendering* Arabic at this point, which is what the warning has to be written in.
    await act(async () => {
      await i18n.changeLanguage('ar');
    });
    const { result } = await renderHook(() => useLanguageSwitch());

    await act(() => {
      result.current.chooseLanguage('en');
    });

    expect(alert).toHaveBeenCalledTimes(1);
    // The warning is written in the language on screen — Arabic — because that is the one the user
    // has been reading up to this tap.
    // The maṣdar, not the imperative it used to be («أعد فتح التطبيق»): the app-wide
    // gender-neutral rule retires second-person commands, which are masculine unvowelled.
    expect(alertCall(alert).title).toBe('إعادة الفتح تقلب اتجاه الواجهة');
    expect(alertCall(alert).body).toContain('English');

    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });
});

describe('awaitingRestart', () => {
  it('is false while the strings and the layout agree', async () => {
    const { result } = await renderHook(() => useLanguageSwitch());
    expect(result.current.awaitingRestart).toBe(false);
  });

  it('is true when the user declined the restart, so the app can keep saying so', async () => {
    mockStoredLanguage = 'ar';
    layOutAs('ltr');
    const { result } = await renderHook(() => useLanguageSwitch());
    expect(result.current.awaitingRestart).toBe(true);
  });
});
