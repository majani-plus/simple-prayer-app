/**
 * Pins the derived Arabic widget layouts to their Lora originals — the same regenerate-never-edit
 * contract as `widgetPalette.test.ts`. Fix a drift failure with `bun scripts/derive-arabic-layouts.ts`.
 *
 * The drift check alone is not the point, and used not to be enough: it only ever looked at the
 * three layouts someone had remembered to list, so `widget_empty` and all three widget-picker
 * previews drew Arabic in Lora for a whole release (AR-06, AR-18). Lora contains no Arabic letter
 * and no Arabic-Indic digit — measured, not assumed — so "Arabic in Lora" is never a style
 * preference, it is text the brand face never draws. The suite therefore also asserts the two
 * structural facts a list cannot forget:
 *
 *   1. every layout in `res/layout/` is accounted for — a source with an Arabic twin, a twin, or
 *      an explicit entry in `NO_ARABIC_VARIANT`;
 *   2. no Arabic text can be paired with a Latin font, following the strings through the locale
 *      tables the layout will actually be resolved against.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  DERIVED_LAYOUTS,
  NO_ARABIC_VARIANT,
  WEIGHT_BUMP_BELOW_SP,
  deriveArabic,
} from '../../scripts/arabic-layout-source';

const RES = join(
  __dirname,
  '..',
  '..',
  'modules',
  'prayer-widgets',
  'android',
  'src',
  'main',
  'res'
);

const read = (dir: string, name: string) => readFileSync(join(RES, dir, `${name}.xml`), 'utf8');
const xmlNames = (dir: string) =>
  readdirSync(join(RES, dir))
    .filter((f) => f.endsWith('.xml'))
    .map((f) => f.replace(/\.xml$/, ''))
    .sort();

/** Faces that actually contain Arabic. Anything else on Arabic text is a defect, not a choice. */
const ARABIC_CAPABLE = /^(noto_naskh_arabic|amiri)_/;
/** Arabic letters, Arabic-Indic digits and the presentation forms, in one class. */
const ARABIC_TEXT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

type Element = { tag: string; attrs: Record<string, string>; raw: string };

/** Every start tag with its attributes. Quoted values are consumed atomically, comments skipped. */
function elements(xml: string): Element[] {
  const out: Element[] = [];
  for (const match of xml.matchAll(/<([A-Za-z][\w.]*)((?:"[^"]*"|[^<>"])*)>/g)) {
    const attrs: Record<string, string> = {};
    for (const attr of match[2].matchAll(/([\w:.]+)="([^"]*)"/g)) attrs[attr[1]] = attr[2];
    out.push({ tag: match[1], attrs, raw: match[0] });
  }
  return out;
}

function strings(qualifier: string): Record<string, string> {
  const xml = readFileSync(join(RES, qualifier, 'strings.xml'), 'utf8');
  const table: Record<string, string> = {};
  for (const match of xml.matchAll(/<string name="([^"]+)"\s*>([\s\S]*?)<\/string>/g)) {
    table[match[1]] = match[2];
  }
  return table;
}

const fontFile = (family: string | undefined) =>
  family?.startsWith('@font/') ? family.slice('@font/'.length) : undefined;

const sizeSp = (value: string | undefined) =>
  value !== undefined && value.endsWith('sp') ? Number(value.slice(0, -2)) : null;

const SOURCES = DERIVED_LAYOUTS.map((layout) => layout.source);
/** Layouts that draw Arabic: the derived twins in layout/, plus everything in layout-ar/. */
const ARABIC_LAYOUTS = DERIVED_LAYOUTS.map((layout) => ({ dir: layout.dir, name: layout.name }));

describe('the derived Arabic layouts', () => {
  it.each(DERIVED_LAYOUTS.map((l) => [`${l.dir}/${l.name}`, l] as const))(
    '%s is exactly what the transform produces from its Lora original',
    (_label, layout) => {
      expect(read(layout.dir, layout.name)).toBe(deriveArabic(read('layout', layout.source)));
    }
  );

  it('leaves no live layout without an Arabic counterpart', () => {
    const derivedInLayout = DERIVED_LAYOUTS.filter((l) => l.dir === 'layout').map((l) => l.name);
    const accounted = new Set([...SOURCES, ...derivedInLayout, ...NO_ARABIC_VARIANT]);
    // `widget_empty` was the file this assertion did not exist to catch: it had no twin, no
    // language branch, and its Arabic drew in Lora. A new layout must join the pipeline or say
    // in NO_ARABIC_VARIANT why it never shows Arabic.
    expect(xmlNames('layout').filter((name) => !accounted.has(name))).toEqual([]);
  });

  it('puts exactly the picker previews in layout-ar/', () => {
    const expected = DERIVED_LAYOUTS.filter((l) => l.dir === 'layout-ar')
      .map((l) => l.name)
      .sort();
    expect(xmlNames('layout-ar')).toEqual(expected);
  });

  it('pairs no Arabic text with a Latin font', () => {
    for (const { dir, name } of ARABIC_LAYOUTS) {
      const xml = read(dir, name);
      expect(`${dir}/${name}: ${xml.includes('@font/lora')}`).toBe(`${dir}/${name}: false`);
      for (const element of elements(xml)) {
        const font = fontFile(element.attrs['android:fontFamily']);
        if (font === undefined) continue;
        expect(`${dir}/${name}: ${font} draws Arabic: ${ARABIC_CAPABLE.test(font)}`).toBe(
          `${dir}/${name}: ${font} draws Arabic: true`
        );
      }
    }
  });

  it('pairs no Arabic sample string with a Latin font, in any locale a layout is resolved under', () => {
    // A layout in `layout/` is only ever inflated under a non-Arabic configuration once its
    // `layout-ar/` twin exists — so it answers for values/ and values-tr/, and the twin answers
    // for values-ar/.
    const tables = {
      layout: [strings('values'), strings('values-tr')],
      'layout-ar': [strings('values-ar')],
    };
    for (const dir of ['layout', 'layout-ar'] as const) {
      for (const name of xmlNames(dir)) {
        for (const element of elements(read(dir, name))) {
          const ref = /^@string\/(.+)$/.exec(element.attrs['android:text'] ?? '');
          if (!ref) continue;
          const font = fontFile(element.attrs['android:fontFamily']);
          for (const table of tables[dir]) {
            if (!ARABIC_TEXT.test(table[ref[1]] ?? '')) continue;
            const capable = font !== undefined && ARABIC_CAPABLE.test(font);
            expect(`${dir}/${name} draws @string/${ref[1]} in ${font} — Arabic-capable: ${capable}`).toBe(
              `${dir}/${name} draws @string/${ref[1]} in ${font} — Arabic-capable: true`
            );
          }
        }
      }
    }
  });

  it('gives every layout whose Arabic strings exist a layout-ar twin', () => {
    const arabicTable = strings('values-ar');
    const twins = new Set(
      DERIVED_LAYOUTS.filter((l) => l.dir === 'layout-ar').map((l) => l.source)
    );
    for (const name of xmlNames('layout')) {
      const usesArabicResource = elements(read('layout', name)).some((element) => {
        const ref = /^@string\/(.+)$/.exec(element.attrs['android:text'] ?? '');
        return ref ? ARABIC_TEXT.test(arabicTable[ref[1]] ?? '') : false;
      });
      // The previews slipped through for exactly this reason: they read `@string/preview_*`,
      // whose values-ar entries are Arabic names and Arabic-Indic times, out of a Lora TextView.
      expect(`${name} draws values-ar strings: ${usesArabicResource}, has twin: ${twins.has(name)}`)
        .toBe(`${name} draws values-ar strings: ${usesArabicResource}, has twin: ${usesArabicResource}`);
    }
  });

  it('steps Arabic up a weight below 13sp, and never below (D54 as amended by D135)', () => {
    for (const { dir, name } of ARABIC_LAYOUTS) {
      for (const element of elements(read(dir, name))) {
        const font = fontFile(element.attrs['android:fontFamily']);
        if (font === undefined || !font.startsWith('noto_naskh_arabic')) continue;
        const sizes = [
          sizeSp(element.attrs['android:textSize']),
          sizeSp(element.attrs['android:autoSizeMinTextSize']),
        ].filter((size): size is number => size !== null);
        if (sizes.length === 0) continue;
        const smallest = Math.min(...sizes);
        if (smallest >= WEIGHT_BUMP_BELOW_SP) continue;
        expect(`${dir}/${name} at ${smallest}sp: ${font}`).not.toContain('400regular');
      }
    }
  });

  it('keeps direction explicit — rtl on the twins the renderer picks, locale on the previews', () => {
    for (const { dir, name, source } of DERIVED_LAYOUTS) {
      const declared = /android:layoutDirection="(\w+)"/.exec(read(dir, name))?.[1];
      // The previews pin "locale" and the transform's regex only rewrites "ltr", so mirroring in
      // layout-ar/ survives by construction. Pinned here so it cannot stop being true quietly.
      const expected = /android:layoutDirection="locale"/.test(read('layout', source))
        ? 'locale'
        : 'rtl';
      expect(`${dir}/${name}: ${declared}`).toBe(`${dir}/${name}: ${expected}`);
    }
  });

  it('bundles exactly the fonts the layouts reference — no missing face, no dead weight', () => {
    const bundled = readdirSync(join(RES, 'font'))
      .map((f) => f.replace(/\.(ttf|otf|xml)$/, ''))
      .sort();
    const referenced = new Set<string>();
    for (const dir of ['layout', 'layout-ar'] as const) {
      for (const name of xmlNames(dir)) {
        for (const element of elements(read(dir, name))) {
          const font = fontFile(element.attrs['android:fontFamily']);
          if (font === undefined) continue;
          expect(`${dir}/${name}: ${font} bundled: ${bundled.includes(font)}`).toBe(
            `${dir}/${name}: ${font} bundled: true`
          );
          referenced.add(font);
        }
      }
    }
    // Every face ships in every APK whether or not anything draws with it: `amiri_700bold.ttf`
    // was 404 KB of it the moment the derive stopped mapping Lora's bold onto Amiri.
    expect(bundled).toEqual([...referenced].sort());
  });
});
