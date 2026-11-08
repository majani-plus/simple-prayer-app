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
    esbuild: {
      // The site imports the app's token module from OUTSIDE this directory. When esbuild
      // transforms a file it looks for the nearest tsconfig, which for that file is the REPO
      // ROOT tsconfig.json — and that one extends `expo/tsconfig.base`. The root's node_modules
      // exists on a dev machine but NOT on a CI host that installs only this directory's
      // dependencies (Cloudflare Pages with root `website/`), so the build died there with
      // "Cannot find module 'expo/tsconfig.base/tsconfig.json'" while passing locally.
      //
      // Supplying the config inline stops esbuild discovering (and resolving the `extends` of)
      // any tsconfig at all. Type-checking is unaffected: that is `astro check`'s job, and it
      // uses this project's own tsconfig.
      tsconfigRaw: {
        compilerOptions: {
          target: 'es2022',
          useDefineForClassFields: true,
          verbatimModuleSyntax: false,
        },
      },
    },
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
