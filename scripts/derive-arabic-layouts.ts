/**
 * Derives the Arabic variants of the Android widget layouts.
 *
 * RemoteViews cannot change a TextView's font at runtime, so an Arabic widget needs its own
 * inflated layout. Three families, three different questions about *which* Arabic:
 *
 * - **Live widgets** follow the APP language (D41), which travels in the snapshot — so a
 *   `layout-ar/` qualifier would be wrong (the launcher inflates under the SYSTEM locale) and the
 *   renderer picks `R.layout.widget_*_arabic` itself.
 * - **The empty/stale layout** is drawn precisely when there is no snapshot, so its strings are
 *   the module's own resources keyed to the SYSTEM locale (D103). Its twin is picked by the
 *   renderer from the same `Configuration`, so the sentence and the face always agree.
 * - **The picker previews** are inflated by the launcher before the app has ever run, so they go
 *   into `res/layout-ar/` under the same basename and `previewLayout` needs no edit.
 *
 * Rather than hand-maintaining seven near-identical files, this script rewrites the font
 * attributes and optical sizes (`scripts/arabic-layout-source.ts` is the transform; the drift test
 * `src/__tests__/widgetLayouts.test.ts` pins the output).
 *
 * Run `bun scripts/derive-arabic-layouts.ts` after editing any of the source layouts.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DERIVED_LAYOUTS, deriveArabic } from './arabic-layout-source';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const RES = join(HERE, '..', 'modules', 'prayer-widgets', 'android', 'src', 'main', 'res');

for (const { source, dir, name } of DERIVED_LAYOUTS) {
  const original = readFileSync(join(RES, 'layout', `${source}.xml`), 'utf8');
  mkdirSync(join(RES, dir), { recursive: true });
  const out = join(RES, dir, `${name}.xml`);
  writeFileSync(out, deriveArabic(original));
  console.log(`wrote ${out}`);
}
