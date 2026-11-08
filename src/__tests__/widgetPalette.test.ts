/**
 * Pins the generated native color tables to `src/theme/tokens.ts`.
 *
 * The widgets' Kotlin (and later Swift) render with color literals the architecture test cannot
 * see, so this test regenerates the expected file text from the live tokens and fails on any
 * byte of drift. The fix is never to edit the generated file: run
 * `bun scripts/generate-widget-palette.ts` after changing the tokens.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { argb, kotlinPaletteSource, swiftPaletteSource } from '../../scripts/widget-palette-source';

const KOTLIN_PATH = join(
  __dirname,
  '..',
  '..',
  'modules',
  'prayer-widgets',
  'android',
  'src',
  'main',
  'java',
  'expo',
  'modules',
  'prayerwidgets',
  'WidgetPalette.kt'
);

const SWIFT_PATH = join(__dirname, '..', '..', 'targets', 'widget', 'WidgetPalette.swift');
const WATCH_SWIFT_PATH = join(__dirname, '..', '..', 'targets', 'watch', 'WidgetPalette.swift');
const WATCH_WIDGET_SWIFT_PATH = join(
  __dirname,
  '..',
  '..',
  'targets',
  'watch-widget',
  'WidgetPalette.swift'
);
const WEAR_KOTLIN_PATH = join(
  __dirname,
  '..',
  '..',
  'wear',
  'src',
  'main',
  'java',
  'app',
  'simpleprayer',
  'wear',
  'WidgetPalette.kt'
);

describe('the generated widget palette', () => {
  it('Kotlin matches tokens.ts byte for byte (regenerate, never edit)', () => {
    expect(readFileSync(KOTLIN_PATH, 'utf8')).toBe(kotlinPaletteSource());
  });

  it('Swift matches tokens.ts byte for byte (regenerate, never edit)', () => {
    expect(readFileSync(SWIFT_PATH, 'utf8')).toBe(swiftPaletteSource());
  });

  it('the watch targets match too (Milestone V — generated twins never drift)', () => {
    expect(readFileSync(WATCH_SWIFT_PATH, 'utf8')).toBe(swiftPaletteSource());
    expect(readFileSync(WATCH_WIDGET_SWIFT_PATH, 'utf8')).toBe(swiftPaletteSource());
  });

  it('the Wear app matches, in its own package', () => {
    expect(readFileSync(WEAR_KOTLIN_PATH, 'utf8')).toBe(
      kotlinPaletteSource('app.simpleprayer.wear')
    );
  });
});

describe('argb', () => {
  it('renders opaque hex as 0xFF-alpha ARGB', () => {
    expect(argb('#ece1c5')).toBe(0xffece1c5);
  });

  it('renders rgba with its own alpha', () => {
    expect(argb('rgba(255,252,242,0.45)')).toBe(0x73fffcf2);
  });

  it('refuses a color it cannot parse rather than guessing', () => {
    expect(() => argb('oklch(0.7 0.1 80)')).toThrow('Unparseable');
  });
});
