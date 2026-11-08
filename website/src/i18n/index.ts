/**
 * Site localisation: en (default, at /), tr (/tr/), ar (/ar/, RTL).
 *
 * Terminology rule: concepts the app already names use the app's exact words
 * (src/i18n/locales/*.json at the repo root) — Kaza namazları / Özel günler / Esnek / Kararlı,
 * قضاء الفوائت / وضع العذر / ميسَّر / ملتزم — so the site and the product never disagree.
 * Never use donate/charity/sadaqah/zakat/bağış/تبرع in any language (Apple 3.2.2(iv)).
 *
 * The privacy policy is a deliberate exception: docs/PRIVACY_POLICY.md is the legally-operative
 * text and exists only in English, guarded by the app's own tests — so /privacy stays
 * English-only and the tr/ar navigation links to it (with a short localized note on the page).
 */
import { en } from './en';
import { tr } from './tr';
import { ar } from './ar';

export type Locale = 'en' | 'tr' | 'ar';
export type SiteDict = typeof en;

const dicts: Record<Locale, SiteDict> = { en, tr, ar };

export function t(locale: Locale): SiteDict {
  return dicts[locale];
}

export const localeMeta: Record<
  Locale,
  { htmlLang: string; dir: 'ltr' | 'rtl'; name: string }
> = {
  en: { htmlLang: 'en', dir: 'ltr', name: 'English' },
  tr: { htmlLang: 'tr', dir: 'ltr', name: 'Türkçe' },
  ar: { htmlLang: 'ar', dir: 'rtl', name: 'العربية' },
};

export const locales: Locale[] = ['en', 'tr', 'ar'];

/**
 * Pages that exist per locale, and where each lives. Privacy AND terms are English-only: both
 * are operative text (see the note above), so the tr/ar pages link to the English ones.
 *
 * `install` exists in all three, but it is a shortcut rather than a destination: it is in no nav
 * list and is served `noindex` (docs/DECISIONS.md D156). It still needs a path per locale so the
 * language switcher on it works and so the hreflang alternates are honest.
 */
export type PageId = 'home' | 'times' | 'qibla' | 'install' | 'support' | 'privacy' | 'terms';

export function pagePath(page: PageId, locale: Locale): string {
  if (page === 'privacy') return '/privacy';
  if (page === 'terms') return '/terms';
  if (page === 'home') return locale === 'en' ? '/' : `/${locale}`;
  if (page === 'times') return locale === 'en' ? '/times' : `/${locale}/times`;
  if (page === 'qibla') return locale === 'en' ? '/qibla' : `/${locale}/qibla`;
  if (page === 'install') return locale === 'en' ? '/install' : `/${locale}/install`;
  return locale === 'en' ? '/support' : `/${locale}/support`;
}

/** hreflang alternates for a page (privacy has no translations). */
export function alternatesFor(page: PageId): { hreflang: string; path: string }[] {
  if (page === 'privacy' || page === 'terms') {
    const only = pagePath(page, 'en');
    return [
      { hreflang: 'en', path: only },
      { hreflang: 'x-default', path: only },
    ];
  }
  return [
    ...locales.map((l) => ({ hreflang: localeMeta[l].htmlLang, path: pagePath(page, l) })),
    { hreflang: 'x-default', path: pagePath(page, 'en') },
  ];
}
