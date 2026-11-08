/**
 * The press kit's words and facts, in one place. `/press` renders them and
 * `scripts/build-press-kit.ts` writes the same text into the downloadable fact sheet, so the page
 * and the file can never disagree.
 *
 * Every line here is a claim a writer may copy word for word into an article. So each one must be
 * true of the shipped app today (docs/PRIVACY_POLICY.md, README.md), and each follows docs/TONE.md:
 * no superlatives, no comparisons, "Every feature is free" and never "free forever".
 */
import { site } from './config';

export const press = {
  version: '1.6.0',
  versionDate: '7 November 2026',
  openSourceDate: '8 November 2026',

  oneLine:
    'Simple Prayer is a free prayer-times and prayer-tracking app for iPhone and Android, with no ads and no account.',

  short:
    'Simple Prayer shows the five daily prayer times, points to the qibla, and lets you mark each prayer with one tap. ' +
    'It works without internet. Every feature is free, there are no ads and no account, and the whole app is open source. ' +
    'It is in English, Arabic and Turkish.',

  long: [
    'Simple Prayer shows the five daily prayer times with a countdown to the next one, points to the qibla, and lets you mark each prayer as prayed with one tap. You can mark a prayer from the app, a home-screen widget, a notification or a watch.',
    'The times are worked out on the phone, so they work without internet. The app picks the method used in your country, such as Diyanet, ISNA, Umm al-Qura or the Egyptian authority, and you can change it. Prayer tracking is gentle: a missed day is never shown as a failure, and someone who only wants the times and the qibla never has to log anything.',
    'Every feature is free. There are no ads, no account and no analytics, and your prayer log stays on your phone. The app is in English, Arabic and Turkish, each written by a person. It is made by Majani Plus, a company in New Cairo, Egypt, and its full source code is public under the MIT licence.',
  ],

  facts: [
    ['Name', 'Simple Prayer'],
    ['Name in the stores', 'Simple Prayer: Times & Qibla'],
    ['Made by', 'Majani Plus LLC, New Cairo, Egypt'],
    ['Price', 'Free. Every feature is free. An optional tip in Settings unlocks nothing.'],
    ['Ads, account, analytics', 'None'],
    ['Platforms', 'iPhone, iPad and Apple Watch; Android phones and tablets, and Wear OS'],
    ['Languages', 'English, Arabic (right to left) and Turkish'],
    ['Prayer-time methods', 'Diyanet, ISNA, Umm al-Qura, Egyptian, Karachi, Muslim World League and more; Hanafi or Shafi Asr'],
    ['Works offline', 'Yes. Times are worked out on the phone.'],
    ['Licence', 'MIT (the code). The name and the mosque icon are not covered by the licence.'],
    ['Current version', '1.6.0, 7 November 2026'],
    ['Open source since', '8 November 2026'],
  ] as [string, string][],

  links: [
    ['Website', 'https://simpleprayer.app'],
    ['App Store', site.appStoreUrl ?? ''],
    ['Google Play', site.playStoreUrl ?? ''],
    ['Source code', site.sourceUrl],
    ['Buddy relay source', site.relayUrl],
    ['Privacy policy', 'https://simpleprayer.app/privacy'],
    ['Articles', 'https://simpleprayer.app/blog'],
  ] as [string, string][],

  /** What a reviewer would notice, in plain sentences. */
  highlights: [
    'One tap marks a prayer as prayed, from the app, a widget, a notification or the watch.',
    'Up to three reminders for each prayer, each one silent, a tone or the adhan.',
    'A qibla compass that works without holding the phone flat.',
    'Prayer times that still work above the Arctic Circle, where the sun may not set or rise for weeks.',
    'Prayer buddies: two people who both turn it on can see that the other prayed today. Nothing else is shared with them.',
    'While building it, we found defects in adhan-js, the open-source prayer-time library many Muslim apps use, and sent fixes back. They are now in the library.',
  ],

  /** Facts that are easy to get wrong, with the true version. */
  accuracy: [
    ['It is a non-profit', 'Majani Plus is a company. The app is free, with no ads and no paid features.'],
    ['Nothing ever leaves your phone', 'The prayer log stays on the phone. Five small things do go over the internet, each listed in the privacy policy: the city lookup, update checks, crash reports (on by default, can be switched off), a tip if you leave one, and prayer buddies if you turn them on.'],
    ['Buddy mode is end-to-end encrypted', 'It is not. The relay keeps random IDs and one flag (which prayer, prayed or not) for at most 24 hours, with no names.'],
    ['It is free forever', 'Write "every feature is free". There is nothing to buy, and a tip unlocks nothing.'],
  ] as [string, string][],

  // The general inbox; privacy@ stays the address the privacy policy and the stores name.
  contact: 'hello@simpleprayer.app',
} as const;

/** The downloads `scripts/build-press-kit.ts` writes into public/press/files/. */
export const pressFiles = {
  all: { href: '/press/files/simple-prayer-press-kit.zip', label: 'Everything in English (zip)' },
  logos: { href: '/press/files/simple-prayer-logos.zip', label: 'Logos and app icon (zip)' },
  screenshots: [
    { lang: 'en', label: 'English', href: '/press/files/simple-prayer-screenshots-en.zip' },
    { lang: 'ar', label: 'العربية', href: '/press/files/simple-prayer-screenshots-ar.zip' },
    { lang: 'tr', label: 'Türkçe', href: '/press/files/simple-prayer-screenshots-tr.zip' },
  ],
  icon: { href: '/press/files/simple-prayer-icon-1024.png', label: 'App icon, 1024 × 1024 (PNG)' },
  factSheet: { href: '/press/files/simple-prayer-fact-sheet.txt', label: 'Fact sheet (text)' },
} as const;
