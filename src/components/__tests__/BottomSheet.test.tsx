/**
 * `BottomSheet` — the shell under every sheet in the app.
 *
 * What is asserted here is only what this component decides: that a closed sheet renders nothing
 * at all, that the paper, the grabber and the labelled backdrop are on screen when it is open, and
 * that the ways out reach the caller.
 *
 * The **drag** is no longer asserted here, and that is deliberate. It used to be this component's
 * own pan gesture, so its thresholds were ours to test; the sheet now sits on
 * `@gorhom/bottom-sheet`, whose pan is internal, carries no test id, and whose dismiss thresholds
 * are the library's business and covered by its own suite. What remains ours is that a dismissal
 * — however it started — reaches `onClose` exactly once, which is what the tests below check
 * through the two routes this component still owns: the backdrop and Android back.
 */

import { render, screen, fireEvent } from '@testing-library/react-native';
import { BackHandler, Dimensions, StyleSheet, Text } from 'react-native';

import { BottomSheet } from '../BottomSheet';
import { maxContentWidth } from '@/theme';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

let mockReduceMotion = false;
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => mockReduceMotion,
}));

async function renderSheet(props: Partial<Parameters<typeof BottomSheet>[0]> = {}) {
  const onClose = jest.fn();
  return {
    onClose,
    ...(await render(
      <BottomSheet
        visible
        onClose={onClose}
        dismissLabel="Close"
        testID="sheet"
        header={<Text>A title</Text>}
        {...props}
      >
        <Text>Body</Text>
      </BottomSheet>
    )),
  };
}

/** Whatever is currently listening for the hardware back button, most recent last. */
let backHandlers: (() => boolean)[] = [];

/** The hardware back press, as Android delivers it: to the most recent listener first. */
function pressAndroidBack(): void {
  const handler = backHandlers.at(-1);
  if (handler === undefined) throw new Error('nothing is listening for Android back');
  handler();
}

beforeEach(() => {
  mockReduceMotion = false;
  backHandlers = [];
  // Registration is intercepted rather than the platform being simulated: what matters is that
  // the sheet listens while it is open, stops when it closes, and answers the press itself.
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    const listener = handler as () => boolean;
    backHandlers.push(listener);
    return {
      remove: () => {
        backHandlers = backHandlers.filter((candidate) => candidate !== listener);
      },
    };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('BottomSheet', () => {
  it('renders nothing at all while closed', async () => {
    await render(
      <BottomSheet visible={false} onClose={jest.fn()} dismissLabel="Close" testID="sheet">
        <Text>Body</Text>
      </BottomSheet>
    );

    expect(screen.queryByTestId('sheet-sheet')).toBeNull();
    expect(screen.queryByText('Body')).toBeNull();
  });

  it('shows the paper, the header and the grabber when open', async () => {
    await renderSheet();

    expect(screen.getByTestId('sheet-sheet')).toBeTruthy();
    expect(screen.getByTestId('sheet-drag')).toBeTruthy();
    expect(screen.getByText('A title')).toBeTruthy();
    expect(screen.getByText('Body')).toBeTruthy();
  });

  it('closes from the backdrop, which screen readers reach as a labelled button', async () => {
    const { onClose } = await renderSheet();

    const backdrop = screen.getByTestId('sheet-backdrop');
    expect(backdrop.props.accessibilityLabel).toBe('Close');
    fireEvent.press(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Android back, which the sheet library does not handle itself', async () => {
    const { onClose } = await renderSheet();

    pressAndroidBack();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tells the caller once even when two ways out race', async () => {
    const { onClose } = await renderSheet();

    fireEvent.press(screen.getByTestId('sheet-backdrop'));
    pressAndroidBack();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides the grabber from screen readers, which have the backdrop instead', async () => {
    await renderSheet();

    const grabber = screen.getByTestId('sheet-drag').props.children[0];
    expect(grabber.props.accessible).toBe(false);
    expect(grabber.props.accessibilityElementsHidden).toBe(true);
    expect(grabber.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('still opens when the user asked for reduced motion', async () => {
    mockReduceMotion = true;
    await renderSheet();

    expect(screen.getByText('Body')).toBeTruthy();
  });

  it('wraps the sheet in a seal-dismiss boundary when asked', async () => {
    await renderSheet({ sealDismissTestID: 'sheet-seal-dismiss' });
    expect(screen.getByTestId('sheet-seal-dismiss')).toBeTruthy();
  });

  it('has no seal-dismiss boundary for a sheet that renders no seals', async () => {
    await renderSheet();
    expect(screen.queryByTestId('sheet-seal-dismiss')).toBeNull();
  });

  /**
   * A sheet answers the page above it, so on a window wider than a phone it keeps that page's
   * measure instead of spanning the glass (D123); it stays bottom-anchored either way.
   *
   * The clamp is a style handed to the sheet library, which owns the view it lands on — so this
   * looks for the measure anywhere in the rendered tree rather than naming an element the library
   * is free to rearrange.
   */
  describe('on a window wider than a phone', () => {
    /** Every `maxWidth` in the rendered tree. */
    function maxWidths(): unknown[] {
      const found: unknown[] = [];
      const walk = (node: unknown) => {
        if (node === null || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        const element = node as { props?: { style?: unknown }; children?: unknown };
        if (element.props?.style !== undefined) {
          const flat = StyleSheet.flatten(element.props.style) as { maxWidth?: unknown };
          if (flat?.maxWidth !== undefined) found.push(flat.maxWidth);
        }
        if (element.children !== undefined) walk(element.children);
      };
      walk(screen.toJSON());
      return found;
    }

    it('clamps itself to the content column', async () => {
      jest
        .spyOn(Dimensions, 'get')
        .mockImplementation(() => ({ width: 1024, height: 1366, scale: 2, fontScale: 1 }));
      await renderSheet();

      expect(maxWidths()).toContain(maxContentWidth);
    });

    it('spans the full width of a phone', async () => {
      jest
        .spyOn(Dimensions, 'get')
        .mockImplementation(() => ({ width: 390, height: 844, scale: 3, fontScale: 1 }));
      await renderSheet();

      expect(maxWidths()).not.toContain(maxContentWidth);
    });
  });
});
