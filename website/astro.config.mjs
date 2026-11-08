// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://simpleprayer.app',
  output: 'static',
  trailingSlash: 'never',
  integrations: [
    // sitemap-index.xml + sitemap-0.xml. The i18n option annotates each entry with its
    // xhtml:link hreflang alternates — only for pages that really exist in every locale
    // (the integration groups by locale-stripped path, so English-only /privacy stays bare).
    // /404 is excluded automatically. robots.txt points crawlers at the index.
    sitemap({
      i18n: {
        defaultLocale: 'en',
        locales: { en: 'en', tr: 'tr', ar: 'ar' },
      },
      // /install is served `noindex` (D156) — it is a shortcut to a store, not a page worth
      // finding in search. A noindex URL listed in a sitemap is a Search Console warning, so it
      // is dropped here instead. robots.txt is deliberately NOT used: a Disallow would stop
      // Googlebot fetching the page and therefore stop it ever seeing the noindex.
      filter: (page) => !/\/install\/?$/.test(page),
      lastmod: new Date(),
    }),
  ],
  markdown: {
    // Shiki colours code with inline style="" attributes, which the per-page CSP (style-src with
    // hashes only) blocks. Plain <pre><code>, styled by the article page, needs no exception.
    syntaxHighlight: false,
  },
  build: {
    // No host assumed (Cloudflare Pages / EAS Hosting both serve plain static output).
    format: 'file',
    // 'always' inlines the site's ~6 KB of CSS into each page, removing both render-blocking
    // stylesheet fetches (Lighthouse render-blocking-insight; spec-website §8.3). The CSP
    // hash generator already covers inline <style> bodies.
    inlineStylesheets: 'always',
  },
  vite: {
    // The site imports files from OUTSIDE this directory (screenshots, the privacy policy, the
    // app's domain code via the generated copy). Left alone, Vite looks up the nearest tsconfig
    // for each file, which for anything at the repo root is the APP's tsconfig.json — and that
    // extends `expo/tsconfig.base`. Expo is installed on a dev machine but NOT on a host that
    // installs only this directory (Cloudflare Pages with root `website/`), so the build died
    // there with "Tsconfig not found expo/tsconfig.base" while passing locally. Vite 8 (Astro 7)
    // transforms with Oxc, so the old `esbuild.tsconfigRaw` override no longer applies; this
    // pins every file to this project's own tsconfig instead. Type-checking is `astro check`'s job.
    tsconfig: './tsconfig.json',
    server: {
      fs: {
        // The site imports the app's design tokens, the audited privacy policy markdown, and the
        // real store screenshots from the repo root — that single-source-of-truth coupling is the
        // point of hosting the site in this repo (docs/DECISIONS.md D50).
        allow: ['..'],
      },
    },
  },
});
