import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Writes `dist/_headers` — the header rules Cloudflare Pages applies to the static output.
 *
 * The interesting part is the Content-Security-Policy. Astro inlines small scripts and stylesheets
 * into the HTML, so a policy of `script-src 'self'` would block the page's own code, and the usual
 * escape hatch — `'unsafe-inline'` — would defeat most of the point of having a policy at all. So
 * this hashes every inline block it finds across the built pages and names those hashes in the
 * policy instead. The result allows exactly the code we shipped and nothing else, and it stays
 * correct across rebuilds because the hashes are computed from the output itself.
 *
 * A site whose entire pitch is "no ads, no tracking, nothing leaves your device" should be able to
 * prove it at the transport layer too: no third-party origins are permitted for anything.
 *
 * The three motion features are named rather than left to their defaults (which already allow
 * `self`): /qibla reads the device's heading, and a policy that lists what a page may do should say
 * so out loud. Everything else stays denied.
 *
 * `connect-src 'none'` is the load-bearing one, and it is why the prayer-times page can exist here
 * at all (D147). That page reads a coordinate — from the browser's geolocation, or from a city the
 * visitor picked — and works the times out on the device. It has no way to send that anywhere: not
 * to us, not to anyone. The policy is the proof, not the prose. Anything that would need this
 * directive opened up on a PAGE cannot be built on this site.
 *
 * `/sw.js` is the one exception, and it is sent its own policy below. A service worker's fetches
 * are governed by the CSP delivered with the worker script — not by the page's — and the offline
 * copy exists by fetching our own pages. Shipping it under the page policy is not a theoretical
 * problem: it took the live site down, because the worker intercepted every navigation and then
 * had no way to answer one. Its policy is `connect-src 'self'`: our own origin, nothing else. The
 * pages keep `'none'`, which is the sentence the privacy policy actually makes.
 *
 * Run automatically by `bun run build`.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(HERE, '..', 'dist');

/** Every .html file in the build output. */
function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (entry.endsWith('.html')) out.push(full);
  }
  return out;
}

/** `sha256-<base64>` for a CSP source list. */
function hash(content) {
  return `'sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}'`;
}

/**
 * Collects one page's inline <script> and <style> bodies. Elements carrying a `src`/`href` are
 * external and covered by `'self'`, so they are skipped — hashing them would be meaningless.
 *
 * Per page rather than pooled across the site: a policy that named every page's hashes would let
 * any page run any other page's inline code, and it would repeat 25 hashes in every rule below.
 */
function inlineHashes(html) {
  const scripts = new Set();
  const styles = new Set();
  // Case-insensitive, and tolerant of anything before the closing `>` (`</script foo>`): browsers accept both, so a hash list that
  // missed them would block a script the page really runs. (The input is our own build output,
  // but the match should be as loose as the HTML parser that enforces the CSP.)
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)) {
    if (/\bsrc\s*=/i.test(attrs) || body.trim() === '') continue;
    scripts.add(hash(body));
  }
  for (const [, , body] of html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style\b[^>]*>/gi)) {
    if (body.trim() === '') continue;
    styles.add(hash(body));
  }
  return { scripts: [...scripts], styles: [...styles] };
}

/** `dist/ar/times.html` -> `/ar/times`, `dist/index.html` -> `/`. */
function routeFor(file) {
  const rel = relative(DIST, file).split(sep).join('/');
  if (rel === 'index.html') return '/';
  return '/' + rel.replace(/\.html$/, '');
}

const files = htmlFiles(DIST);
if (files.length === 0) throw new Error('no HTML in dist — run astro build first');

/**
 * The page policy, per page.
 *
 * It is emitted on each route rather than on `/*` for a reason found the hard way: Cloudflare
 * **appends** headers from every matching rule rather than replacing them, so a `/sw.js` rule that
 * sets its own Content-Security-Policy produces *two* policies on that response — and a browser
 * enforces all of them, which is the intersection. The worker stayed blocked by the page's
 * `connect-src 'none'` even though its own policy allowed the fetch. Naming each route keeps the
 * two policies from ever meeting.
 */
function pageCsp(html) {
  const { scripts, styles } = inlineHashes(html);
  return [
    "default-src 'none'",
    `script-src 'self'${scripts.length ? ' ' + scripts.join(' ') : ''}`,
    "worker-src 'self'",
    `style-src 'self'${styles.length ? ' ' + styles.join(' ') : ''}`,
    "img-src 'self' data:",
    "font-src 'self'",
    // The pages make no requests of their own; links out are navigations, not connections.
    "connect-src 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "manifest-src 'self'",
  ].join('; ');
}

/**
 * The worker's own policy. Narrower than a page's in every respect except `connect-src`, which it
 * cannot do its job without: it fetches our pages in order to keep a copy of them.
 */
const workerCsp = ["default-src 'none'", "script-src 'self'", "connect-src 'self'"].join('; ');

/** Headers every response gets. Note that the CSP is NOT among them — see pageCsp above. */
const shared = `  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: geolocation=(self), gyroscope=(self), accelerometer=(self), magnetometer=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
`;

const pageRules = files
  .map((file) => {
    const html = readFileSync(file, 'utf8');
    const csp = pageCsp(html);
    const route = routeFor(file);
    // Both the clean URL and the file behind it: Cloudflare will serve either, and a page that
    // answered on one of them without a policy would be a hole in the wall.
    const paths = [route, '/' + relative(DIST, file).split(sep).join('/')];
    return [...new Set(paths)]
      .map((path) => `${path}\n  Content-Security-Policy: ${csp}\n`)
      .join('\n');
  })
  .join('\n');

const headers = `# GENERATED by scripts/generate-headers.mjs — do not edit by hand.
# Inline script/style hashes are recomputed from the build output on every run.
#
# The Content-Security-Policy is set per page, not on /*, because Cloudflare Pages APPENDS headers
# from every matching rule instead of replacing them. Two matching rules that both set a CSP send
# two policies, and the browser enforces both at once — which is how the service worker ended up
# blocked by the pages' connect-src 'none' despite having a policy of its own.

/*
${shared}
${pageRules}
# The service worker.
#
# A worker's fetches follow the policy sent with the worker script, not the page's, and it cannot
# keep an offline copy without reaching our own origin. Same-origin and nothing else.
#
# It should also never be served stale: a cached worker can pin a cached site, and the result is an
# installed copy nobody can update. Cloudflare's CDN overrides the Cache-Control below with its own
# browser TTL, so Base.astro also registers the worker with updateViaCache: 'none'.
/sw.js
  Content-Security-Policy: ${workerCsp}
  Cache-Control: no-cache
  Service-Worker-Allowed: /

# Astro fingerprints these filenames, so they can be cached forever.
/_astro/*
  Cache-Control: public, max-age=31536000, immutable

# Subset fonts are stable and content-addressed by name.
/fonts/*
  Cache-Control: public, max-age=31536000, immutable

# The two files that let a buddy invite open in the app instead of the browser (D174).
#
# The Apple one has no extension, so without this it is served as a download and iOS ignores it —
# the association silently fails and every invite link opens a web page instead. Both are read by
# the operating systems rather than by a browser, so they are kept fresh rather than cached hard:
# the Android one carries a signing fingerprint, which changes if the signing key ever does.
/.well-known/apple-app-site-association
  Content-Type: application/json
  Cache-Control: public, max-age=3600

/.well-known/assetlinks.json
  Content-Type: application/json
  Cache-Control: public, max-age=3600
`;

writeFileSync(join(DIST, '_headers'), headers);

const bytes = Buffer.byteLength(headers, 'utf8');
console.log(
  `_headers written — a policy per page for ${files.length} page(s), plus the worker's own ` +
    `(${(bytes / 1024).toFixed(1)} KB; Cloudflare's limit is 100 KB)`
);
if (bytes > 90 * 1024) {
  throw new Error(`_headers is ${(bytes / 1024).toFixed(1)} KB, close to Cloudflare's 100 KB limit.`);
}
