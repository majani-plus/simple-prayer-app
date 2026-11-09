/**
 * Site-wide facts that will change at launch. Everything else on the site is derived from the
 * repo's audited sources (docs/PRIVACY_POLICY.md, src/theme/tokens.ts, docs/screenshots).
 */
export const site = {
  name: 'Simple Prayer',
  tagline: 'five a day · never missed',
  domain: 'simpleprayer.app',
  /** The person who makes the app. Majani Plus LLC owns it; he takes the credit (owner, 2026-11-09). */
  author: { name: 'Ronny Majani', url: 'https://ronnymajani.com' },
  /** The general inbox: support, press and anything that is not about privacy. */
  email: 'hello@simpleprayer.app',
  /** Privacy questions only. The privacy policy names it, and so do the store listings. */
  privacyEmail: 'privacy@simpleprayer.app',
  /**
   * The public feedback board (docs/DECISIONS.md D87). Linked to, never embedded: the rules in
   * docs/WEBSITE.md forbid third-party embeds and forms, and the deployed CSP enforces it.
   */
  feedbackUrl: 'https://simpleprayer.featurebase.app/' as string | null,
  /** The app's source code: MIT, © Majani Plus LLC. */
  sourceUrl: 'https://github.com/majani-plus/simple-prayer-app',
  /** The buddy relay's source code. */
  relayUrl: 'https://github.com/majani-plus/simple-prayer-relay',
  /** The guide for people who want to help translate the app. */
  translatingUrl: 'https://github.com/majani-plus/simple-prayer-app/blob/main/docs/TRANSLATING.md',
  /**
   * Store URLs. Both listings are live. `null` is still honoured everywhere it is read — it
   * renders the dashed "coming soon" badge in StoreButtons.astro, and /install simply does not
   * redirect for that platform — so a store can be taken down by setting one field back to null.
   */
  /**
   * The two Android app files, on GitHub Releases (Cloudflare Pages caps a file at 25 MiB, so no
   * APK lives in public/). `latest/download/<name>` always points at the newest release's asset.
   */
  // The Google Play-signed APK. `null` while Play's automatic integrity protection is on: Google
  // then adds a licence check to the APKs it builds, and a downloaded copy only opens the Play
  // Store. Turn protection off in Play Console › App integrity, upload the APK to the GitHub
  // release, and set this back to
  // 'https://github.com/majani-plus/simple-prayer-app/releases/latest/download/simple-prayer-play.apk'.
  apkPlayUrl: null as string | null,
  apkFossUrl: 'https://github.com/majani-plus/simple-prayer-app/releases/latest/download/simple-prayer-foss.apk',
  releasesUrl: 'https://github.com/majani-plus/simple-prayer-app/releases',
  appStoreUrl: 'https://apps.apple.com/us/app/simple-prayer-times-qibla/id6803004652' as string | null,
  playStoreUrl: 'https://play.google.com/store/apps/details?id=app.simpleprayer' as string | null,
} as const;
