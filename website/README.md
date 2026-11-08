# simpleprayer.app — the website

The marketing + legal site for Simple Prayer. Astro, TypeScript, fully static, zero client-side
frameworks. It lives in the app's repo on purpose (docs/DECISIONS.md D50): the pages that matter
are **rendered from the repo's audited sources**, so they cannot drift from the app they describe.

## Routes

| Route | What it is |
|---|---|
| `/` | Landing page — Paper & Seal design language, real screenshots, an interactive replica of the seal interaction |
| `/times` | Today's prayer times, computed in the visitor's own browser from a coordinate they choose (D147–D149) |
| `/qibla` | The qibla direction and the distance to Makkah, from the same location (D150). Both tool pages are installable (D151) |
| `/install` | Detects the OS and goes to that store's listing (D156). `noindex`, out of the sitemap, in no nav list — it exists to be printed on things and put behind a QR code |
| `/privacy` | **Rendered at build time from `../docs/PRIVACY_POLICY.md`** — the URL both app stores require. Never edit the page; edit the policy |
| `/terms` | **Rendered at build time from `../docs/TERMS_OF_USE.md`.** English-only, like `/privacy`: both are operative text |
| `/support` | The support URL both stores require: reminders troubleshooting, calculation methods, exemption mode, qada, export, contact |
| `/blog`, `/blog/<slug>` | Articles, **English-only** (no `/tr` or `/ar` copies, no language switcher, no hreflang). One markdown file per article in `src/content/blog/`; the filename is the slug. Frontmatter: `title`, `description`, `date` (`'YYYY-MM-DD'`), optional `tags`, optional `canonical` (only if first published elsewhere — by default each article is its own canonical, so cross-posts point here). Schema in `src/content.config.ts` |
| `/404` | Not-found page (`404.html`, picked up automatically by most static hosts) |

Everything except `/privacy` and `/terms` exists in three languages: English at the root, Turkish
under `/tr`, Arabic (RTL) under `/ar`.

## Single sources of truth (do not duplicate these)

- **Palette** — `scripts/generate-tokens.ts` copies the app's `src/theme/tokens.ts` into
  `src/styles/tokens.generated.ts` on every build (never edit the generated file); `theme.ts` turns
  it into CSS custom properties for both themes. The site follows `prefers-color-scheme` by
  default, with a System / Light / Dark switch in the header (`ThemeSwitch.astro`): an explicit
  choice stamps `data-theme` on `<html>` and persists in localStorage; a blocking inline script in
  `Base.astro`'s `<head>` re-applies it before first paint (it's static, so the CSP hash generator
  covers it — keep it that way).
- **Privacy policy** — `src/pages/privacy.astro` reads `../../docs/PRIVACY_POLICY.md` at build
  time. Two mechanical transforms only: the maintainer preamble above the first `---` and
  `*[Owner: …]*` editorial notes are stripped. The app's `privacyClaims.test.ts` guards the text.
- **Screenshots** — imported directly from `../../docs/screenshots/…` (the real store captures);
  Astro resizes and converts them to WebP at build.
- **The mark** — `src/components/Logo.astro` mirrors `src/components/Logo.tsx` geometry exactly
  (all four optical sizes). If the mark ever changes, change both.
- **Store links** — `src/config.ts`. Both are `null` today, which renders honest "coming soon"
  badges; paste the real URLs at launch and every button on the site goes live.

## Local development

```sh
cd website
bun install
bun run dev        # http://localhost:4321
```

Requires the repo root's `node_modules` to exist (`bun install` at the root) only if you
regenerate fonts — the site build itself needs nothing from the app's dependencies.

```sh
bun run check      # astro type/template check
bun run build      # static output → dist/
bun run preview    # serve dist/ locally
```

## Fonts

Lora and Amiri are **self-hosted and subsetted** (`public/fonts/*.woff2`, ~120 KB total) so the
site makes no third-party requests — the privacy pledge must be true of the site itself. They are
generated from the same `@expo-google-fonts` packages the app bundles:

```sh
bun run fonts      # needs uv; sources come from the repo root's node_modules
```

Re-run only if you add Arabic strings not covered by the subset (see `scripts/build-fonts.py`,
which pins the exact Arabic text rendered) or the app upgrades its font packages. Output is
committed.

## No trackers — keep it that way

The site sets no cookies, loads nothing from any third-party origin, and includes no analytics.
`/privacy` promises this of the site in so many words ("simpleprayer.app is a plain static page…
It does not know you visited"), and the footer repeats it. Any PR that adds an external script,
font CDN, embed, or analytics snippet makes the published privacy policy false.

## Deploying

**Host: Cloudflare Pages**, serving plain static files. Settings, as configured:

| Setting | Value |
|---|---|
| Root directory | `website` |
| Build command | `bun install --frozen-lockfile && bun run build` |
| Output directory | `dist` (relative to the root directory) |
| Node version | 24.22.2 (pinned by `.node-version`; Astro 7 needs ≥ 22.23.4) |

No environment variables, no server runtime, no redirects. `dist/404.html` is picked up
automatically, and `build.format: 'file'` plus `trailingSlash: 'never'` means `/privacy` serves
`privacy.html` — Cloudflare resolves that without configuration.

### Two things that will bite anyone changing the build

1. **Nothing outside `website/` may be imported by Vite.** Cloudflare installs only this
   directory's dependencies, but Vite still transforms any file it bundles and looks up that
   file's *nearest* tsconfig — for anything at the repo root that is the app's `tsconfig.json`,
   which `extends: "expo/tsconfig.base"`. Expo is not installed there on CI, so the build fails
   with `Cannot find module 'expo/tsconfig.base/tsconfig.json'` while passing locally, where the
   root `node_modules` happens to exist. Since Astro 7 (Vite 8, which transforms with Oxc),
   `vite.tsconfig` in `astro.config.mjs` pins every file to this project's own tsconfig, which
   covers files Vite merely transforms; anything Vite would have to *resolve* types from at the
   root still must not be imported.
   The palette therefore crosses the boundary at **build** time — `scripts/generate-tokens.ts`
   runs under Bun (which reads TypeScript natively and consults no tsconfig) and writes
   `src/styles/tokens.generated.ts` inside this project. Markdown and images are safe to read
   across the boundary because they are not TypeScript: `fs.readFileSync` and asset imports never
   trigger a tsconfig lookup.
   To verify a change survives CI without pushing: `mv ../node_modules/expo /tmp/ && bun run build`
   (then move it back).

2. **Bun is the package manager; `bun.lock` is the only lockfile.** Cloudflare detects the package
   manager from the lockfile. If a deploy log ever reads
   `Detected the following tools from environment: npm@…` followed by `npm install`, Bun was *not*
   detected on that build image and the install ran unpinned — the 2026-08-19 deploy did exactly
   that. It still builds (Bun is on PATH, so `bun run build` works either way), but to get a
   reproducible install either bump the Pages build image or set the build command to
   `bun install --frozen-lockfile && bun run build`.

Security headers (including a CSP with hashes for the inline script and styles, recomputed each
build) are emitted to `dist/_headers` by `scripts/generate-headers.mjs`.

CI builds the site via `.github/workflows/website.yml`, which triggers on `website/**` *and* on
the sources the site renders from (`docs/PRIVACY_POLICY.md`, `docs/screenshots/**`,
`src/theme/tokens.ts`). The app's workflow ignores `website/**`. That workflow only *builds* — it
deliberately does not deploy, because Cloudflare Pages deploys from its own Git integration; the
GitHub job exists to fail a PR before Cloudflare would.

## Launch checklist (owner)

1. Confirm the effective date in `docs/PRIVACY_POLICY.md` and resolve its bracketed RevenueCat
   note (the site strips the note from the rendered page either way, but the §3 tip-jar section
   text itself must match whether the release ships a RevenueCat key).
2. Make `hello@simpleprayer.app` (general) and `privacy@simpleprayer.app` (privacy only) deliver mail
   (Play sends a verification to the support address).
3. Point simpleprayer.app DNS at the chosen host; serve over HTTPS.
4. Paste the store URLs into `src/config.ts` once the listings are live.
