/**
 * The FOSS build's stand-ins (`src/foss/`, swapped in by metro.config.js when `FOSS_BUILD=1`).
 *
 * The real risk with a stand-in is drift: the app starts calling a function the stand-in does not
 * have, nothing notices in the normal build, and the FOSS app crashes on that call. So the names
 * are not written down here. They are derived: every value the real package exports (read from its
 * type declarations) that appears as `.name` in a file importing the package must also be exported
 * by the stand-in.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import * as ts from 'typescript';

/* eslint-disable @typescript-eslint/no-require-imports -- stand-ins are loaded the way Metro loads them. */

const ROOT = resolve(__dirname, '..', '..');

/** Package → stand-in, as in metro.config.js. */
const STAND_INS: Record<string, string> = {
  '@sentry/react-native': 'sentry-react-native',
  'expo-application': 'expo-application',
  'expo-location': 'expo-location',
  'expo-store-review': 'expo-store-review',
  'react-native-purchases': 'react-native-purchases',
};

/**
 * Names that match a real export but are read off the package's default export, not off the
 * package. The stand-in's default export is `undefined`, which `services/purchases.ts` checks first,
 * so these are never reached.
 */
const THROUGH_DEFAULT: Record<string, string[]> = {
  'react-native-purchases': ['LOG_LEVEL', 'PRODUCT_CATEGORY'],
};

/** Library code that imports a stubbed package, and so gets the stand-in too. */
const LIBRARY_IMPORTERS = [
  'node_modules/expo-notifications/build/getExpoPushTokenAsync.js',
  'node_modules/expo-notifications/build/utils/updateDevicePushTokenAsync.js',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return ['node_modules', 'android', 'ios', '__tests__', 'foss'].includes(name)
        ? []
        : sourceFiles(path);
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const APP_FILES = [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'modules'))];

function importers(pkg: string): string[] {
  const pattern = new RegExp(`(from |require\\(|import\\()'${pkg.replace('/', '\\/')}'`);
  return [...APP_FILES, ...LIBRARY_IMPORTERS.map((f) => join(ROOT, f))].filter((file) =>
    pattern.test(readFileSync(file, 'utf8'))
  );
}

/** The value exports of each real package, from its type declarations. */
const realExports: Record<string, Set<string>> = (() => {
  const options: ts.CompilerOptions = {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  };
  const entries = Object.keys(STAND_INS).map((pkg) => {
    const resolved = ts.resolveModuleName(pkg, join(ROOT, 'index.ts'), options, ts.sys);
    const file = resolved.resolvedModule?.resolvedFileName;
    if (file === undefined) throw new Error(`Cannot resolve the types of ${pkg}`);
    return [pkg, file] as const;
  });
  const program = ts.createProgram(
    entries.map(([, file]) => file),
    options
  );
  const checker = program.getTypeChecker();
  return Object.fromEntries(
    entries.map(([pkg, file]) => {
      const module = checker.getSymbolAtLocation(program.getSourceFile(file)!)!;
      const values = checker.getExportsOfModule(module).filter((symbol) => {
        const target =
          symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        return (target.flags & ts.SymbolFlags.Value) !== 0;
      });
      return [pkg, new Set(values.map((symbol) => symbol.name))];
    })
  );
})();

describe.each(Object.entries(STAND_INS))('the %s stand-in', (pkg, standIn) => {
  const files = importers(pkg);

  it('is aliased by metro.config.js', () => {
    expect(readFileSync(join(ROOT, 'metro.config.js'), 'utf8')).toContain(
      `'${pkg}': foss('${standIn}.ts')`
    );
  });

  it('has every name the app (and any library) reads from the real package', () => {
    expect(files.length).toBeGreaterThan(0);
    const exported = new Set(Object.keys(require(`./${standIn}`) as object));
    const used = new Set<string>();
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(/\.([A-Za-z_$][\w$]*)/g)) {
        const name = match[1];
        if (realExports[pkg].has(name) && !(THROUGH_DEFAULT[pkg] ?? []).includes(name)) {
          used.add(name);
        }
      }
    }
    const missing = [...used].filter((name) => !exported.has(name));
    expect({ files: files.map((f) => relative(ROOT, f)), missing }).toEqual({
      files: files.map((f) => relative(ROOT, f)),
      missing: [],
    });
  });
});

describe('the inert stand-ins', () => {
  it('never offer a review, a tip jar or a crash report', async () => {
    const review = require('./expo-store-review') as typeof import('./expo-store-review');
    await expect(review.isAvailableAsync()).resolves.toBe(false);
    await expect(review.requestReview()).rejects.toThrow();

    expect(
      (require('./react-native-purchases') as typeof import('./react-native-purchases')).default
    ).toBeUndefined();

    const sentry = require('./sentry-react-native') as typeof import('./sentry-react-native');
    const Component = () => null;
    expect(sentry.wrap(Component)).toBe(Component);
    expect(() => sentry.init({ dsn: 'x' })).not.toThrow();
  });

  it('report no native build number, so appInfo falls back to the config', () => {
    const application = require('./expo-application') as typeof import('./expo-application');
    expect(application.nativeBuildVersion).toBeNull();
    expect(application.applicationId).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// expo-location → modules/foss-location
// ---------------------------------------------------------------------------------------------

const mockNative = {
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  geocodeAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
  startHeading: jest.fn(),
  stopHeading: jest.fn(),
  addListener: jest.fn(),
};

jest.mock('expo', () => ({
  requireNativeModule: (name: string) => {
    if (name !== 'FossLocation') throw new Error(`unexpected native module ${name}`);
    return mockNative;
  },
}));

describe('the expo-location stand-in', () => {
  const Location = require('./expo-location') as typeof import('./expo-location');

  beforeEach(() => {
    for (const fn of Object.values(mockNative)) fn.mockReset();
  });

  it('uses the same Accuracy numbers as expo-location', () => {
    // By path: the package's `exports` hides this file, and the package itself would load its
    // native module.
    const { LocationAccuracy } = require(
      join(ROOT, 'node_modules/expo-location/build/Location.types.js')
    ) as {
      LocationAccuracy: Record<string, number | string>;
    };
    for (const [name, value] of Object.entries(Location.Accuracy)) {
      expect({ name, value: LocationAccuracy[name] }).toEqual({ name, value });
    }
  });

  it('passes permissions and the current fix straight through', async () => {
    const permission = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
    const fix = { coords: { latitude: 1, longitude: 2, accuracy: 3000 }, timestamp: 5 };
    mockNative.getForegroundPermissionsAsync.mockResolvedValue(permission);
    mockNative.requestForegroundPermissionsAsync.mockResolvedValue(permission);
    mockNative.getCurrentPositionAsync.mockResolvedValue(fix);

    await expect(Location.getForegroundPermissionsAsync()).resolves.toBe(permission);
    await expect(Location.requestForegroundPermissionsAsync()).resolves.toBe(permission);
    await expect(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest })
    ).resolves.toBe(fix);
  });

  it('hands maxAge to the native side, and null when there is none', async () => {
    mockNative.getLastKnownPositionAsync.mockResolvedValue(null);
    await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
    await Location.getLastKnownPositionAsync();
    expect(mockNative.getLastKnownPositionAsync.mock.calls).toEqual([[60_000], [null]]);
  });

  it('geocodes both ways', async () => {
    mockNative.geocodeAsync.mockResolvedValue([{ latitude: 41, longitude: 29 }]);
    mockNative.reverseGeocodeAsync.mockResolvedValue([{ city: 'Istanbul' }]);
    await expect(Location.geocodeAsync('Istanbul')).resolves.toEqual([
      { latitude: 41, longitude: 29 },
    ]);
    await expect(Location.reverseGeocodeAsync({ latitude: 41, longitude: 29 })).resolves.toEqual([
      { city: 'Istanbul' },
    ]);
    expect(mockNative.geocodeAsync).toHaveBeenCalledWith('Istanbul');
    expect(mockNative.reverseGeocodeAsync).toHaveBeenCalledWith(41, 29);
  });

  it('delivers heading events and stops the sensors on remove', async () => {
    const subscription = { remove: jest.fn() };
    mockNative.addListener.mockReturnValue(subscription);
    mockNative.startHeading.mockReturnValue(true);
    const onHeading = jest.fn();

    const watch = await Location.watchHeadingAsync(onHeading);
    expect(mockNative.addListener).toHaveBeenCalledWith('onHeading', onHeading);
    watch.remove();
    expect(subscription.remove).toHaveBeenCalled();
    expect(mockNative.stopHeading).toHaveBeenCalled();
  });

  it('rejects on a phone with no compass, and leaves no listener behind', async () => {
    const subscription = { remove: jest.fn() };
    mockNative.addListener.mockReturnValue(subscription);
    mockNative.startHeading.mockReturnValue(false);

    await expect(Location.watchHeadingAsync(jest.fn())).rejects.toThrow();
    expect(subscription.remove).toHaveBeenCalled();
  });
});
