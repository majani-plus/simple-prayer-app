/**
 * Tripwire for /install's OS detection (docs/DECISIONS.md D156).
 *
 * The detection lives in a `<script is:inline>` inside src/components/InstallPage.astro, because
 * it has to run at parse time and be hashed into that route's CSP. Inline means it cannot be
 * imported, so this reads the component, lifts out the shipped script body, and runs THOSE BYTES
 * in a sandbox against a table of real user agents. Nothing is re-implemented here: if the page's
 * script changes, this checks the change.
 *
 * Same reasoning as scripts/verify-times.ts — a silent wrong answer here sends someone to the
 * wrong store, or sends a crawler anywhere at all.
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const IOS_URL = 'https://apps.apple.com/ios';
const PLAY_URL = 'https://play.google.com/play';

const source = readFileSync(new URL('../src/components/InstallPage.astro', import.meta.url), 'utf8');
const open = source.indexOf('<script is:inline>');
const close = source.indexOf('</script>', open);
if (open === -1 || close === -1) {
  throw new Error(
    'verify-install: no <script is:inline> found in InstallPage.astro. If the redirect moved to a ' +
      'bundled script, import it here instead of lifting it out of the component.',
  );
}
const script = source.slice(open + '<script is:inline>'.length, close);

interface Case {
  name: string;
  ua: string;
  /** Expected value of data-os, or null for "detection deliberately did nothing". */
  os: string | null;
  /** Expected redirect target, or null for "stayed on the page". */
  goes: string | null;
  platform?: string;
  maxTouchPoints?: number;
  coarse?: boolean;
  standalone?: boolean;
  webdriver?: boolean;
  navType?: string;
  search?: string;
  androidUrl?: string;
  iosUrl?: string;
  uaDataPlatform?: string;
}

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad:
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  linux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  chromeos:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  fire: 'Mozilla/5.0 (Linux; Android 9; KFMAWI) AppleWebKit/537.36 (KHTML, like Gecko) Silk/126.1.2 like Chrome/126.0.0.0 Safari/537.36',
  googlebot:
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bingbot:
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  instagramIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 335.0.0.0 (iPhone15,3; iOS 17_5)',
  facebookAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/460.0.0.0;]',
};

const cases: Case[] = [
  { name: 'iPhone Safari', ua: UA.iphone, os: 'ios', goes: IOS_URL },
  { name: 'iPad Safari (mobile mode)', ua: UA.ipad, os: 'ios', goes: IOS_URL },
  {
    name: 'iPadOS desktop-mode Safari (reports a Mac)',
    ua: UA.mac,
    platform: 'MacIntel',
    maxTouchPoints: 5,
    coarse: true,
    os: 'ios',
    goes: IOS_URL,
  },
  {
    name: 'macOS Safari (a real Mac must NOT be taken for an iPad)',
    ua: UA.mac,
    platform: 'MacIntel',
    maxTouchPoints: 0,
    os: 'desktop',
    goes: null,
  },
  { name: 'Android phone', ua: UA.android, os: 'android', goes: PLAY_URL },
  { name: 'Android tablet', ua: UA.androidTablet, os: 'android', goes: PLAY_URL },
  {
    name: 'Android reported only by UA-CH',
    ua: UA.windows,
    uaDataPlatform: 'Android',
    os: 'android',
    goes: PLAY_URL,
  },
  { name: 'Instagram webview on iOS', ua: UA.instagramIos, os: 'ios', goes: IOS_URL },
  { name: 'Facebook webview on Android', ua: UA.facebookAndroid, os: 'android', goes: PLAY_URL },
  { name: 'Windows', ua: UA.windows, os: 'desktop', goes: null },
  { name: 'Linux', ua: UA.linux, os: 'desktop', goes: null },
  { name: 'ChromeOS', ua: UA.chromeos, os: 'desktop', goes: null },
  { name: 'Amazon Fire (Android with no Play Store)', ua: UA.fire, os: 'noplay', goes: null },
  { name: 'Googlebot must never be redirected', ua: UA.googlebot, os: null, goes: null },
  { name: 'Bingbot must never be redirected', ua: UA.bingbot, os: null, goes: null },
  { name: 'WebDriver (Playwright, Lighthouse CI)', ua: UA.iphone, webdriver: true, os: null, goes: null },
  { name: 'Inside the installed PWA', ua: UA.android, standalone: true, os: null, goes: null },
  { name: 'Arrived by Back', ua: UA.iphone, navType: 'back_forward', os: null, goes: null },
  { name: 'The ?stay=1 escape hatch', ua: UA.iphone, search: '?stay=1', os: null, goes: null },
  { name: '?utm=x&stay', ua: UA.android, search: '?utm=x&stay', os: null, goes: null },
  { name: 'A query that merely contains the word "stay" must still redirect', ua: UA.iphone, search: '?from=staytuned', os: 'ios', goes: IOS_URL },
  {
    name: 'Android with no Play URL configured: named, but sent nowhere',
    ua: UA.android,
    androidUrl: '',
    os: 'android',
    goes: null,
  },
  {
    name: 'iOS with no App Store URL configured: named, but sent nowhere',
    ua: UA.iphone,
    iosUrl: '',
    os: 'ios',
    goes: null,
  },
];

function run(c: Case): { os: string | null; goes: string | null; going: boolean } {
  const attrs: Record<string, string> = {};
  const el = {
    dataset: { ios: c.iosUrl ?? IOS_URL, android: c.androidUrl ?? PLAY_URL },
    setAttribute: (k: string, v: string) => {
      attrs[k] = v;
    },
  };
  let goes: string | null = null;
  const frames: (() => void)[] = [];
  const matchMedia = (q: string) => ({
    matches: q.includes('display-mode: standalone')
      ? Boolean(c.standalone)
      : q.includes('pointer: coarse')
        ? Boolean(c.coarse)
        : false,
  });
  const sandbox: Record<string, unknown> = {
    document: { querySelector: (s: string) => (s === '[data-install]' ? el : null) },
    navigator: {
      userAgent: c.ua,
      platform: c.platform ?? '',
      maxTouchPoints: c.maxTouchPoints ?? 0,
      webdriver: c.webdriver ?? false,
      userAgentData: c.uaDataPlatform ? { platform: c.uaDataPlatform } : undefined,
    },
    performance: { getEntriesByType: () => [{ type: c.navType ?? 'navigate' }] },
    location: {
      search: c.search ?? '',
      replace: (u: string) => {
        goes = u;
      },
    },
    matchMedia,
    requestAnimationFrame: (fn: () => void) => frames.push(fn),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  runInContext(script, createContext(sandbox));
  frames.forEach((fn) => fn());
  return { os: attrs['data-os'] ?? null, goes, going: 'data-going' in attrs };
}

let failed = 0;
for (const c of cases) {
  const got = run(c);
  const ok = got.os === c.os && got.goes === c.goes && got.going === (c.goes !== null);
  if (!ok) {
    failed += 1;
    console.error(
      `✗ ${c.name}\n    expected os=${c.os} goes=${c.goes}\n    got      os=${got.os} goes=${got.goes} (data-going ${got.going})`,
    );
  }
}

if (failed > 0) {
  console.error(`\n/install detection: ${failed} of ${cases.length} cases wrong.`);
  process.exit(1);
}
console.log(`/install detection verified — ${cases.length} user agents, and no crawler redirected`);
