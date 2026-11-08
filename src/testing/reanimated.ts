/**
 * Reanimated's `getAnimatedStyle`, typed as the function Jest actually runs.
 *
 * Reanimated 4.7's published types resolve the package entry to the web build of its Jest utils,
 * where `getAnimatedStyle` is declared `() => void`. Jest resolves the native build
 * (`jestUtils/index.native`), which takes the rendered node and returns its animated style. Tests
 * import it from here so they type-check against the one that runs.
 */
import { getAnimatedStyle as untyped } from 'react-native-reanimated';
import type { getAnimatedStyle as NativeGetAnimatedStyle } from 'react-native-reanimated/lib/typescript/jestUtils/index.native';

export const getAnimatedStyle = untyped as unknown as typeof NativeGetAnimatedStyle;
