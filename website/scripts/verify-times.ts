/**
 * Proves the website computes what the app computes.
 *
 * It checks the **vendored** modules against `data/prayer-goldens.json` — values frozen from the
 * app under a patched install (see generate-goldens.ts). Nothing here imports the app, and nothing
 * here depends on how the repo root happened to be installed.
 *
 * That independence is the point, and it was learned the hard way. The first version of this file
 * compared the vendored copy against the app's own modules live, which passed locally and failed
 * the Cloudflare deploy with 99 disagreements: `patchedDependencies` is a bun feature, Cloudflare
 * installs the repo-root `package.json` with **npm**, and npm ignores it. The "app" side of that
 * comparison was an unpatched adhan, so the check was measuring the deploy environment rather than
 * our code — and reporting rows like "app 08:07 vs site 08:07", which differ only in the
 * sub-second residue the patch clears.
 *
 * Two things are therefore asserted here, in this order:
 *   1. The website's own adhan really is patched (D121/D122). Unpatched, it disagrees with the app
 *      by a minute in ordinary places and by a quarter of an hour above the Arctic Circle.
 *   2. Every frozen value still reproduces, to the millisecond.
 *
 * Run by `bun run build`, so a site that would disagree with the app never gets built.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeDayTimes } from '../src/lib/domain/prayerTimes';
import { distanceToKaabaKm, qiblaBearing } from '../src/lib/domain/qibla';
import { CASES, DAYS, key, MADHABS, MARKERS, settingsFor } from './goldens-matrix';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PATCH_MARKER = 'already on an exact minute is its own ceiling';

/* 1. The patch ------------------------------------------------------------------------------- */

const dateUtils = join(HERE, '..', 'node_modules', 'adhan', 'lib', 'esm', 'DateUtils.js');
let installed: string;
try {
  installed = readFileSync(dateUtils, 'utf8');
} catch {
  throw new Error(`adhan is not installed in website/ — run \`bun install\` here first.`);
}
if (!installed.includes(PATCH_MARKER)) {
  throw new Error(
    `website/node_modules/adhan is NOT patched.\n\n` +
      `patches/adhan@4.4.6.patch repairs two real defects (D121/D122) and is applied by\n` +
      `\`bun install\` reading "patchedDependencies" in website/package.json. npm ignores that\n` +
      `field entirely, so installing this directory with npm produces a site whose prayer times\n` +
      `disagree with the app — by a minute in ordinary places, and by about fifteen above the\n` +
      `Arctic Circle. Install with bun.`
  );
}

/* 2. The values ------------------------------------------------------------------------------ */

interface Goldens {
  _markers: string[];
  times: Record<string, number[]>;
  qibla: Record<string, [number, number]>;
}

const goldens = JSON.parse(
  readFileSync(join(HERE, '..', 'data', 'prayer-goldens.json'), 'utf8')
) as Goldens;

if (goldens._markers.join() !== MARKERS.join()) {
  throw new Error(
    `data/prayer-goldens.json was frozen against a different marker list — regenerate it with ` +
      `\`bun run goldens\`.`
  );
}

const failures: string[] = [];
let compared = 0;

const zoneOf = new Map(CASES.map((c) => [c.city, c.zone]));
const hhmm = (ms: number, zone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));

for (const madhab of MADHABS) {
  for (const c of CASES) {
    for (const day of DAYS) {
      const expected = goldens.times[key(c.city, day, madhab)];
      if (!expected) {
        failures.push(`${c.city} ${day} ${madhab}: missing from the goldens`);
        continue;
      }

      let actual: number[];
      try {
        const computed = computeDayTimes(day, c.location, settingsFor(madhab));
        actual = MARKERS.map((m) => computed.times[m].getTime());
      } catch {
        actual = [];
      }

      if (expected.length === 0 || actual.length === 0) {
        // Both sides must refuse together: answering where the app declines to is as wrong as
        // answering differently.
        if (expected.length !== actual.length) {
          failures.push(
            `${c.city} ${day} ${madhab}: ${actual.length === 0 ? 'site refused, app did not' : 'site answered, app refused'}`
          );
        }
        compared++;
        continue;
      }

      for (let i = 0; i < MARKERS.length; i++) {
        compared++;
        if (actual[i] === expected[i]) continue;
        const zone = zoneOf.get(c.city)!;
        const drift = Math.round((actual[i] - expected[i]) / 1000);
        failures.push(
          `${c.city} ${day} ${madhab} ${MARKERS[i]}: expected ${hhmm(expected[i], zone)} ` +
            `got ${hhmm(actual[i], zone)} (${drift > 0 ? '+' : ''}${drift}s)`
        );
      }
    }
  }
}

for (const c of CASES) {
  const expected = goldens.qibla[c.city];
  if (!expected) {
    failures.push(`${c.city}: missing from the qibla goldens`);
    continue;
  }
  compared += 2;
  if (Math.abs(qiblaBearing(c.location) - expected[0]) > 1e-9) {
    failures.push(`${c.city} qibla bearing: expected ${expected[0]}, got ${qiblaBearing(c.location)}`);
  }
  if (Math.abs(distanceToKaabaKm(c.location) - expected[1]) > 1e-9) {
    failures.push(`${c.city} qibla distance: expected ${expected[1]}, got ${distanceToKaabaKm(c.location)}`);
  }
}

if (failures.length > 0) {
  console.error(`\nThe site no longer reproduces the app's times in ${failures.length} place(s):\n`);
  for (const f of failures.slice(0, 40)) console.error(`  ${f}`);
  if (failures.length > 40) console.error(`  … and ${failures.length - 40} more`);
  console.error(
    `\nSomething changed in src/domain/, in the adhan version, or in the patch. That may well be\n` +
      `correct — but it moves times people pray by, so confirm the new values against the\n` +
      `authority's published timetable before running \`bun run goldens\` to accept them.\n` +
      `Never widen a tolerance to make this pass.\n`
  );
  process.exit(1);
}

console.log(
  `site reproduces the app's times — ${compared} frozen values across ${CASES.length} cities × ` +
    `${DAYS.length} days × ${MADHABS.length} madhabs, on a patched adhan`
);
