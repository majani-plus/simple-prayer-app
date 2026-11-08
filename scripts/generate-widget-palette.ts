/**
 * Writes the widgets' native color tables from `src/theme/tokens.ts`. See
 * `scripts/widget-palette-source.ts` (the shared renderer) for why this exists and what pins it.
 *
 * Run with `bun scripts/generate-widget-palette.ts` after any tokens change.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { kotlinPaletteSource, swiftPaletteSource } from './widget-palette-source';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const KOTLIN_OUT = join(
  HERE,
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

const SWIFT_OUT = join(HERE, '..', 'targets', 'widget', 'WidgetPalette.swift');

// The watch targets and the Wear app are additional native readers of the same palette
// (Milestone V). Extensions cannot import each other, so each carries its own generated copy —
// generated twins can never drift the way hand-kept twins can.
const WATCH_SWIFT_OUT = join(HERE, '..', 'targets', 'watch', 'WidgetPalette.swift');
const WATCH_WIDGET_SWIFT_OUT = join(HERE, '..', 'targets', 'watch-widget', 'WidgetPalette.swift');
const WEAR_KOTLIN_OUT = join(
  HERE,
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

writeFileSync(KOTLIN_OUT, kotlinPaletteSource());
console.log(`wrote ${KOTLIN_OUT}`);
writeFileSync(SWIFT_OUT, swiftPaletteSource());
console.log(`wrote ${SWIFT_OUT}`);
writeFileSync(WATCH_SWIFT_OUT, swiftPaletteSource());
console.log(`wrote ${WATCH_SWIFT_OUT}`);
writeFileSync(WATCH_WIDGET_SWIFT_OUT, swiftPaletteSource());
console.log(`wrote ${WATCH_WIDGET_SWIFT_OUT}`);
writeFileSync(WEAR_KOTLIN_OUT, kotlinPaletteSource('app.simpleprayer.wear'));
console.log(`wrote ${WEAR_KOTLIN_OUT}`);
