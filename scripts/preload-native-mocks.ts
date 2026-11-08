/**
 * Bun preload that stands in for the one native module the snapshot path touches
 * (`expo-localization`, reached through `src/i18n/numerals`), so dev tooling like
 * `make-watch-envelope.ts` can run the REAL builders outside React Native.
 *
 * Usage: `bun --preload ./scripts/preload-native-mocks.ts scripts/<tool>.ts …`
 */
// The app's tsconfig carries no Bun type declarations (this file runs under `bun --preload`
// only); the one symbol used is declared here so `tsc --noEmit` stays green.
declare const Bun: { plugin: (config: any) => void };
const plugin = Bun.plugin;

// Bun's plugin types aren't part of the app's tsconfig; the shape used here is tiny.
interface BunPluginBuild {
  onResolve(constraints: { filter: RegExp }, callback: () => { path: string; namespace: string }): void;
  module(specifier: string, callback: () => { exports: Record<string, unknown>; loader: 'object' }): void;
}

plugin({
  name: 'native-mocks',
  setup(build: BunPluginBuild) {
    // Registering the virtual module is not enough when the real package is resolvable — the
    // resolver must be pointed at it explicitly.
    build.onResolve({ filter: /^expo-localization$/ }, () => ({
      path: 'expo-localization',
      namespace: 'native-mocks',
    }));
    build.module('expo-localization', () => ({
      exports: {
        // No device region: `numberingSystemFor` then falls back to the language's own rule,
        // which is exactly what a tool generating per-language fixtures wants.
        getLocales: () => [],
      },
      loader: 'object',
    }));

    // `utils/formatTime` reaches for the live i18n singleton only as a FALLBACK (locale default,
    // duration words); the envelope builders pass every locale explicitly, so a stub suffices —
    // and the real `src/i18n` boots i18next against React Native, which no tool can load.
    build.onResolve({ filter: /^@\/i18n$/ }, () => ({
      path: '@/i18n',
      namespace: 'native-mocks',
    }));
    build.module('@/i18n', () => ({
      exports: {
        default: {
          language: 'en',
          resolvedLanguage: 'en',
          t: (key: string) => key,
        },
      },
      loader: 'object',
    }));
  },
});
