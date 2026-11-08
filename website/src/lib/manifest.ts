/** Builds a locale's web app manifest. See src/pages/manifest.webmanifest.ts for why there are three. */
import { pagePath, t, localeMeta, type Locale } from '../i18n';
import { paperLight, nightPaper } from '../styles/tokens.generated';

export function manifestFor(locale: Locale): Response {
  const dict = t(locale);
  const body = {
    name: 'Simple Prayer',
    short_name: 'Simple Prayer',
    description: dict.pwa.description,
    lang: localeMeta[locale].htmlLang,
    dir: localeMeta[locale].dir,
    start_url: pagePath('times', locale),
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: paperLight.bg,
    // Matches the light theme-color meta; the installed copy still follows the system theme once
    // it is running, exactly as the site does.
    theme_color: paperLight.bg,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: dict.timesPage.navLabel, url: pagePath('times', locale) },
      { name: dict.qiblaPage.navLabel, url: pagePath('qibla', locale) },
    ],
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'Content-Type': 'application/manifest+json' },
  });
}

/** Kept so the dark palette import above is not mistaken for an oversight if it is ever needed. */
export const themeColors = { light: paperLight.bg, dark: nightPaper.bg };
