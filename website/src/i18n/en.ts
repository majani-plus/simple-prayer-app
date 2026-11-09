/** English — the reference dictionary; its shape types the other locales. */
import { site } from '../config';

/** A common question. `links` render after the answer; the answer text alone goes into JSON-LD. */
type FaqItem = { q: string; a: string; links?: { text: string; href: string }[] };

export const en = {
  chrome: {
    skipToContent: 'Skip to content',
    nav: {
      features: 'Features',
      how: 'How it works',
      support: 'Support',
      privacy: 'Privacy',
      getApp: 'Get the app',
      siteNav: 'Site',
      menu: 'Menu',
    },
    theme: {
      group: 'Theme',
      system: 'System theme',
      light: 'Light theme',
      dark: 'Dark theme',
    },
    language: 'Language',
    footer: {
      pledge:
        'The app is free, with no ads, no account, and no tracking. This site keeps the same promise: it loads nothing from anyone else and does not know you visited.',
      privacyPolicy: 'Privacy policy',
      terms: 'Terms of use',
      support: 'Support',
      feedback: 'Feedback',
      source: 'Source code',
      articles: 'Articles',
      press: 'Press kit',
      madeBy: 'Made by {author} at Majani Plus. Every feature is free.',
      author: 'Ronny Majani',
    },
    stores: {
      downloadOn: 'Download on',
      comingSoonTo: 'Coming soon to',
    },
  },

  home: {
    title: 'Simple Prayer: Prayer Times, Qibla & Salah Tracker — Free, No Ads',
    description:
      'Accurate prayer times, gentle prayer tracking, and a qibla compass. Works offline. Every feature is free: no ads, no account, no tracking. Open source.',
    hero: {
      h1Pre: 'Prayer times, the qibla, and ',
      h1Accent: 'gentle prayer tracking',
      h1Post: '.',
      sub: "Simple Prayer shows today's five prayers and counts down to the next one. When you pray, tap the round mark beside it — its seal — and the prayer is recorded. You can do that in the app, on your home screen, from a notification, or on your watch. It works offline, and it will never show you an ad. The whole app is open source, so anyone can check what it does.",
      chips: ['No ads, ever', 'No account', 'No tracking', 'Works offline', 'Open source'],
      chipsLabel: 'What we promise',
      storeHint:
        'For iPhone and Android — phones, tablets, and watches. Out now on the App Store and on Google Play.',
    heroBrowser: 'Or use it in your browser',
    heroBrowserHint: 'Today’s times and the qibla, with nothing to install.',
      shotAlt:
        "Simple Prayer's Today screen in the light paper theme: Hijri and Gregorian dates, the day streak, a live countdown to the next prayer, and the five prayer rows — with Fajr's seal open on its three choices.",
    },
    how: {
      eyebrow: 'How it works',
      h2: 'How you mark a prayer',
      steps: [
        {
          title: "See today's five prayers",
          body: 'Today shows all five prayers. The prayer you are in is highlighted, with a countdown to the end of its time. The times are calculated on your phone, so you never need an internet connection.',
        },
        {
          title: 'Mark it when you pray',
          body: 'Tap a prayer’s seal and choose missed, late, or prayed. Prayed is the last choice, in the seal’s own place, so the answer you use most is right under your finger. Tap the same answer again to clear it.',
        },
        {
          title: 'Check past days in History',
          body: 'History shows each day as a ring of five parts. Open any past day to look at it or change it. No day is ever locked.',
        },
      ],
      demoCaption:
        'This works exactly like the real app. Try it: tap the seal, then pick an answer. Picking the same answer again clears it.',
    },
    sealDemo: {
      name: 'Maghrib',
      arabic: 'المغرب',
      /** Hide the Arabic sidekick when the name itself is already Arabic. */
      showArabic: true,
      time: '8:47 pm',
      captions: {
        unlogged: '· not marked',
        prayed: '· prayed',
        late: '· prayed late',
        missed: '· missed',
      },
      options: { prayed: 'Prayed', late: 'Late', missed: 'Missed' },
      hint: 'tap the seal to choose · tap again to close',
      ariaLabel: 'Log Maghrib',
    },
    /**
     * The "everywhere" section: the app's surfaces beyond the app itself. The frame is the
     * product's own principle — you get what you came for without opening the app. No counts,
     * no engagement talk. Facts per surface are pinned by decisions D100–D112 (widgets, lock
     * screen, notifications, Live Activity), D123–D124 (tablets), D126–D129 (watches).
     */
    everywhere: {
      eyebrow: 'Everywhere',
      h2: 'You don’t have to open the app',
      lead: 'The times, and the tap that marks a prayer, are also on your home screen, your lock screen, your notifications, and your watch. They all work the same simple way. Whatever you mark lands in the app.',
      cards: [
        {
          plat: 'iPhone and Android',
          title: 'Widgets on your home screen',
          body: 'On iPhone and Android, a widget shows today’s prayers or a countdown to the next one. The seal is on the widget: tap it, and the prayer is marked without opening the app.',
        },
        {
          plat: 'iPhone only',
          title: 'Your lock screen and StandBy',
          body: 'On iPhone, the next prayer can sit on your lock screen, and on the bedside StandBy screen at night. These show times only. Other people can see a lock screen, so what you track never appears there.',
        },
        {
          plat: 'iPhone and Android',
          title: 'The “I prayed” button on reminders',
          body: 'On Android, every reminder carries an “I prayed” button, and you can also keep an always-on notification in your shade showing the current and next prayer. On iPhone, press and hold the reminder and the same button appears. Either way the prayer is recorded without opening the app, and a short confirmation follows, with Undo.',
        },
        {
          plat: 'iPhone only',
          title: 'A countdown on your lock screen',
          body: 'On iPhone, open the app a little before a prayer and a card stays on your lock screen, counting down — with the seal right on it, so you can mark the prayer without unlocking. You choose how early it appears and how long it stays.',
        },
        {
          plat: 'iPad and Android tablets',
          title: 'Tablets and folding phones',
          body: 'On a tablet, or a folding phone opened flat, the screen splits in two: today’s prayers on one side, the month and a small qibla dial on the other.',
        },
      ],
      watchAlt: 'The watch app in the dark theme: Maghrib named in Arabic and English, a live countdown, the time it runs until, and the prayer’s round seal below.',
    },
    wrist: {
      eyebrow: 'The watch',
      h2: 'On your wrist',
      lead: 'The app is on your watch too: today’s prayers, the seal you tap once, and the qibla. On the watch face itself, a small dial shows the prayer you are in, and its ring fills as its time passes. Slide up from the face and a card counts down to the next prayer. Tap either one and the app opens. On Wear OS there is also a card one swipe from the face. A watch face of our own, called Manuscript, is coming soon. The watch keeps two weeks of times, so it stays right even when your phone is in another room — and when the phone is away, it can sound the adhan itself. A prayer you mark on the watch lands in the app.',
      items: [
        'The app on Apple Watch',
        'The dial on your watch face',
        'The card under your watch face',
        'The app on Wear OS',
        'The Wear OS card',
        'The Manuscript watch face — coming soon',
      ],
      hint: 'slide for more',
    },
    features: {
      eyebrow: 'Features',
      h2: "What's in the app",
      lead: 'Four tabs: Today, History, Qibla, and Settings. None of them ask you to create an account.',
      /**
       * The photogenic features, each beside a phone-shaped screenshot slot. The captures live in
       * `docs/screenshots/{locale}/light/6.5/` and are imported by `Landing.astro`, in this order:
       * `01-today-seal`, `02-history`, `03-qibla`, `05-qada`.
       *
       * A band whose capture is missing renders the labelled placeholder instead
       * (`features.shotPending`), so its copy is live either way. The `alt` is authored now, which
       * is the whole point: the screenshot drops straight in with no copy to write.
       */
      bands: [
        {
          title: 'The seal',
          body: 'Tap the seal and it opens into three choices: missed, late, or prayed. Prayed sits exactly where the seal was, so the answer you use most is right under your finger. Pick one and the seal closes and turns gold. If you pick the wrong one, tap it again and choose another.',
          alt: "The Today screen with a prayer's seal expanded into its three choices — Missed, Late, and Prayed, with Prayed last, in the seal's own place.",
        },
        {
          title: 'The History tab',
          body: 'Each day in History is a ring with five parts, one for each prayer. Under the calendar you can see your streak, how often you pray on time, and which prayer you miss most. Days you did not mark are kept separate from days you missed.',
          alt: 'The History tab: a month calendar where each day is a ring of five segments, above streak and completion statistics.',
        },
        {
          title: 'The qibla compass',
          body: 'The dial shows the Kaaba on its ring, and the instruction is written underneath: “Turn 38° to the left.” When you are facing the right way, the dial turns green and says so. A compass points at magnetic north, which is not quite the real north; the app corrects for the difference where you live. The needle stays steady while you turn, even if your hand is not. And unlike most prayer apps, it does not need the phone held flat: it notices how you are holding it and stays accurate anyway. It also tells you how sure it is, and shows you how to hold the phone for the steadiest reading.',
          alt: 'The Qibla compass aligned: the dial and Makkah badge turned green, with the message “Aligned — you may begin”.',
        },
        {
          title: 'Missed prayers (qada)',
          body: 'When you mark a prayer as missed, the app adds it to a count for that prayer. The count goes down as you make the prayers up. The screen shows how fast you are going and the date you should be finished. You can also clear the whole count and start again, and you have 30 days to change your mind.',
          alt: 'The qada screen: descending per-prayer counters with progress, recent pace, and a projected debt-free date.',
        },
      ],
      /** Shown inside the phone frame of a band whose screenshot has not been taken yet. */
      shotPending: 'App screenshot coming soon',
      /** Compact cards; the icons live in the markup (SealIcon.astro), not here. */
      iconCards: [
        {
          title: 'How the times are calculated',
          body: 'The app picks the calculation method used in your country, and always shows its name: Diyanet, ISNA, Umm al-Qura, Egyptian, Karachi, and others. You can change it yourself, choose Hanafi or Shafi Asr, and move each prayer by up to 30 minutes to match your mosque. Today shows the Hijri date beside the ordinary one, and on Friday the midday prayer carries both its names: Jumu’ah · Dhuhr. If you live far north, where the sun barely sets in summer, you can pick a rule for those months.',
        },
        {
          title: 'Reminders',
          body: 'Each prayer can have three reminders: one when its time comes in, an earlier one to help you wake up for Fajr, and a last one before its time runs out. Each can be silent, a simple tone, or the adhan — there are four recitations to choose from. If you have already marked the prayer, the last reminder is cancelled. A separate screen shows you exactly which reminders are set.',
        },
        {
          title: 'Excused days',
          body: 'For menstruation and the days after childbirth. On an excused day the app asks nothing from you: your streak keeps going, and nothing is shown as missed. No prayers need to be made up for those days. Reminders pause while it lasts — and if you would rather keep hearing the adhan, you can leave them on. Turn it on for as long as you need — until you end it, or for a number of days, and then it ends by itself. The app is not a period tracker and does not predict anything.',
        },
        {
          title: 'Your data',
          body: 'Your prayer log is stored on your phone and nowhere else. You can export it as a CSV or JSON file at any time. If you delete the app, the data is deleted with it.',
        },
        {
          title: 'Prayer buddies',
          body: 'Praying is easier when you know someone else is praying too. You can pair with someone you choose — a partner, a sibling, a friend — and see on today\u2019s screen that they prayed, while they see the same about you. The point is to encourage each other. They never see a prayer you missed, or one you have not marked yet. There is no feed, no ranking and no score. It is off until you turn it on, and either of you can end it at any time.',
        },
      ],
    },
    gentle: {
      h2: 'If you miss a day',
      /** Segments; `b: true` renders bold (the two streak-mode names, as the app labels them). */
      p1: [
        { t: 'When you mark a prayer, its seal turns gold, and the app counts the days you keep up. Missing one prayer does not always end your streak. In ' },
        { t: 'Relaxed', b: true },
        { t: ' mode, one prayer keeps the day. In ' },
        { t: 'Committed', b: true },
        { t: ' mode, you need all five. Excused days do not end a streak. A day you forgot to mark is never turned into a day you missed. You can open any past day and change it, so a wrong tap is easy to fix.' },
      ] as { t: string; b?: boolean }[],
      p2: 'There are no leaderboards, and the app never tells you that you broke your streak. It shows a small note at 3, 7, 30, 100, and 365 days. Nobody can see your log except you — unless you add a prayer buddy, and then they see that you prayed today, and nothing else.',
      note: "This section shows the app's dark theme. The app follows your phone's light or dark setting, and you can also pick one in Settings. This page works the same way. The switch is at the top of the page.",
      shotAlt:
        'The Today screen in the dark theme: the same layout on deep warm parchment with lit gold accents.',
    },
    optional: {
      h2: 'You don’t have to track anything',
      p1: 'Many people only want the prayer times and the qibla. The app is built to do that well on its own. It never asks you to start marking prayers, and nothing looks unfinished if you never do.',
      p2: 'If you do mark your prayers, the app is here to encourage you, not to judge you. It does not grade you, and it is not trying to be a complete record of every prayer you have prayed.',
    },

    access: {
      h2: 'Made to be easy to read and easy to tap',
      lead: 'Many people who pray five times a day are older, or do not see well, or use a screen reader. The app is built for them too.',
      langs:
        'The app comes in English, العربية, Türkçe and اردو. Urdu was written with AI help and has not yet been checked by a native speaker, so corrections are welcome. Arabic and Urdu are fully right-to-left, each in a font made for its script.',
      translate: {
        pre: 'If you speak another language and would like to help translate the app, ',
        linkText: 'read how to help',
        post: '.',
      },
      bullets: [
        'The buttons are large and easy to press, even if your hands are not steady.',
        'If you use a screen reader like VoiceOver or TalkBack, every button and setting is read out by name.',
        'You never need to tell colours apart. A prayed, a late, and a missed prayer each has its own icon and its own word.',
        "If you make the text bigger in your phone's settings, the text in the app gets bigger too.",
        'The app works before it asks you for anything. There is no sign-up. You can type your city instead of sharing your location, and the app will not keep asking.',
        'In the dark theme, everything stays easy to read, even the smallest line of text.',
      ],
      shotAlt:
        'The Today screen in Arabic: the entire interface mirrored right-to-left, in Arabic script.',
    },
    pledge: {
      h2: 'What we promise',
      body: "No ads, ever. No account. No tracking. Your prayer log stays on your phone. Your rough location is sent only to your phone's own map service, so it can name your city. If the app crashes, we get a report that says the app broke and nothing about who you are, and you can turn that off in Settings. The app is free and will stay free. If it helps you, you can leave a tip in Settings. That is the only money in it.",
      more: 'says all of this in plain words, including the five cases where anything at all leaves your phone. This website keeps the same promise: no cookies, nothing that counts visitors, and nothing loaded from anyone else.',
      privacyLink: 'The privacy policy',
      openSource: {
        pre: 'You can check all of this yourself. The whole app is ',
        linkText: 'open source',
        post: ': anyone can read the code.',
      },
    },
    faq: {
      h2: 'Common questions',
      qas: [
        {
          q: 'Is it really free? How do you make money?',
          a: 'The app is free, complete, and has no ads. If it helps you, there is an optional tip in Settings. That is the only money in it, and it unlocks nothing.',
        },
        {
          q: 'Do I need an account?',
          a: 'No. There is nothing to sign up for and no password to remember. You open the app and it works.',
        },
        {
          q: 'Does it work without internet?',
          a: 'Yes. Prayer times are calculated on your phone, so the times, the tracking, and the reminders all work offline.',
        },
        {
          q: 'Will the times match my mosque?',
          a: 'Usually, yes. The app starts with the calculation method your country uses, such as Diyanet or ISNA. If your mosque is different, you can change the method, choose Hanafi or Shafi Asr, and move any prayer by up to 30 minutes.',
        },
        {
          q: 'Does it track me or sell my data?',
          a: 'No. There are no ads, no analytics, and no account. Your prayer log stays on your phone, so there is nothing about you for anyone to sell.',
        },
        {
          q: "What happens on days I can't pray?",
          a: 'Excused days are for menstruation and the days after childbirth. On those days the app asks nothing from you: nothing is shown as missed, and your streak continues. Reminders pause by default, and you can choose to keep them on. No prayers need to be made up for those days.',
        },
        {
          q: 'Does it work on my watch?',
          a: 'Yes. On Apple Watch the app shows today’s prayers, the one-tap seal, and the qibla, and the next prayer can sit on your watch face. On Wear OS there is the same app and a tile; a watch face of our own, called Manuscript, is coming soon. A prayer you mark on the watch is recorded in the app.',
        },
        {
          q: 'Can I mark a prayer without opening the app?',
          a: 'Yes, in three ways. Press “I prayed” on the reminder notification. Tap the seal on a home-screen widget. Or mark it on your watch. Each one records the prayer just as if you had opened the app.',
        },
        {
          q: 'What is the tip for?',
          a: 'It is a thank-you, nothing more. Every feature is free for everyone, tip or no tip.',
        },
        {
          q: 'Is it open source?',
          a: 'Yes, under the MIT license. The app is free, with no ads and no paid features, and it is open for anyone to build and copy. You can read the code, build the app yourself, or publish a copy under your own name and icon. The small server behind prayer buddies is open source too.',
          links: [
            { text: 'The app’s code', href: site.sourceUrl },
            { text: 'The server’s code', href: site.relayUrl },
          ],
        },
        {
          q: 'How do prayer buddies work, and what does the server see?',
          a: 'When you mark a prayer, your phone sends a random ID and which prayer you marked. Our server keeps this until your buddy’s phone collects it, for 24 hours at most, and then deletes it. Your names never leave your phones.',
          links: [{ text: 'The privacy policy explains it in full.', href: '/privacy' }],
        },
      ] as FaqItem[],
      more: {
        pre: 'Longer answers, on reminders, qada, and exporting your data, are on ',
        linkText: 'the support page',
        post: '.',
      },
    },
    cta: {
      arabic: 'حافظوا على الصلاة',
      translation: '“Guard the prayer.”',
      showTranslation: true,
      h2: 'Get Simple Prayer',
      sub: 'Free on iPhone and Android. Works offline, no account needed. Open source.',
      langsLine: 'Every feature is free · English · العربية · Türkçe · اردو',
      apkLink: 'Android without Google Play? Download the APK.',
    },
  },

  support: {
    title: 'Support & Help — Simple Prayer',
    description:
      'Answers about Simple Prayer: why a reminder did not arrive, matching times to your mosque, widgets, the watch, excused days, qada, exporting your data, and how to contact us.',
    h1: 'Support',
    intro:
      'Everything on this page describes what the app really does. If this page and the app ever disagree, please tell us. One of the two has a mistake in it.',
    introLinkText: 'tell us',
    onThisPage: 'On this page',
    toc: {
      reminders: "Why didn't my reminder arrive?",
      times: 'How do I match the times to my mosque?',
      widgets: 'How do the widgets work?',
      watch: 'What does the watch app do?',
      exemption: "What about days I can't pray?",
      qada: 'How do missed prayers (qada) work?',
      streaks: 'How do streaks work? Can I fix past days?',
      location: 'Does the app need my location?',
      export: 'How do I export or back up my data?',
      contact: 'How do I get in touch?',
    },
    reminders: {
      p1: "The app calculates the prayer times on your phone and asks the phone itself to show a reminder at each time. No server is involved. That is why reminders work offline. It is also why your phone's own settings are almost always the reason a reminder does not appear.",
      kindsIntro: 'There are four kinds. The first three can be set for each prayer in Settings → Reminders:',
      kinds: [
        'At the prayer time — silent, the normal phone sound, or a short adhan clip. You choose.',
        'Before the prayer — a set number of minutes early. This one is made for waking up for Fajr.',
        'Before the time runs out — a last reminder, and only if you have not marked that prayer yet. Mark it and this reminder is cancelled straight away. For Isha it is timed by Islamic midnight, so it never wakes you at 3 in the morning.',
        'The sunrise note — Fajr is the only prayer whose time ends at sunrise instead of at the next prayer. If Fajr is still unmarked, a silent note at sunrise tells you its time has ended and when Dhuhr is.',
      ],
      scheduling:
        'The app schedules reminders about five days ahead (iOS allows an app at most 64 waiting notifications). It refreshes this schedule every time you open the app, change a related setting, or change your location.',
      healthH: 'Start with the Reminder reliability screen',
      health:
        'Settings → Reminders → Reminder reliability shows exactly what is scheduled on your phone right now. It warns you if the system has deleted the schedule, and it has a “send a test notification” button. If the test arrives, delivery works, and the cause is one of the settings below.',
      iosH: 'On iPhone',
      ios: [
        'Focus and Do Not Disturb block notifications unless the app is allowed: Settings → Focus → your Focus → Allowed Notifications.',
        "Check the app's notification permissions: iOS Settings → Notifications → Simple Prayer. Allow notifications, and turn on sound and banners.",
        'The adhan sound is short on purpose. iOS limits every notification sound to 30 seconds, so the included recording is a short part of the adhan, not the full adhan. This is an Apple limit, not a setting.',
        'Silent mode and the Ring/Silent switch also apply to notification sounds.',
      ],
      androidH: 'On Android',
      android: [
        'Battery settings are usually the cause. Android can freeze apps that are not open and forget their reminders. Set Simple Prayer\'s battery use to “Unrestricted” (Settings → Apps → Simple Prayer → Battery).',
        'Some phone makers add their own tools that close background apps: Samsung (“Sleeping apps”), Xiaomi (Autostart), Huawei (App launch), Oppo and OnePlus (Battery optimisation). The reminder health screen shows the steps for your phone.',
        'On Android 14 and later, your phone does not let an app set a reminder for an exact minute until you allow it. The app offers this once during setup, and the reminder health screen has the same button at any time. Without it reminders still arrive, but they can be a few minutes late. The app also uses a run-at-startup permission, so reminders keep working after a restart. These are scheduling permissions only — they read nothing.',
        'Android 16 can sort notifications into groups such as Promotions or Suggested, and a reminder placed in a group arrives without a sound. If that happens, open Settings → Notifications → Notification organizer on your phone, and leave Simple Prayer out of it.',
        'An optional ongoing notification (off unless you turn it on) can keep the current and next prayer visible in your notification area.',
      ],
    },
    times: {
      p1: 'Prayer times are calculated on your phone, from your approximate location. From the start, the app picks the calculation method used in your country. The name is always shown, for example “Auto (Diyanet)”, and you can change it at any time.',
      steps: [
        'Settings → Prayer times → Calculation method. The full list includes Diyanet (Turkey), ISNA (North America), Umm al-Qura, Egyptian, Karachi, Moonsighting Committee, Dubai, Kuwait, Qatar, Singapore, Tehran, Jafari, and Muslim World League.',
        'Asr madhab: Auto (the default) follows your country, so Hanafi in Pakistan, India, Bangladesh and Afghanistan, and Shafi elsewhere. You can also choose Shafi or Hanafi yourself. This is the most common reason an Asr time looks wrong.',
        'Per-prayer adjustments: each prayer can be moved from −30 to +30 minutes. If your mosque follows a printed calendar with safety margins (temkin), match it here, one prayer at a time.',
        'A high-latitude rule for summers in the far north, and a Hijri date offset (±2 days) if your community sees the new moon on a different day.',
      ],
      note: 'Settings always shows which method is being used and any changes you have made, so you can always see where a time comes from.',
    },
    widgets: {
      p1: 'A widget shows the times on your home screen, on iPhone and Android. To add one, touch and hold an empty spot on the home screen, then look for Simple Prayer: on iPhone under Edit → Add Widget, on Android under Widgets. To remove one, touch and hold the widget itself.',
      bullets: [
        'The seal on a widget is the real seal. Tap it and the current prayer is marked as prayed. Tap it again to undo. A widget never marks a prayer late or missed — those choices stay in the app, where a wrong touch is harder to make.',
        'Widgets read from a schedule of times the app prepares about two weeks ahead. Opening the app renews it.',
        'If the app has not been opened for a long time, a widget says “Times need a refresh” instead of showing times it cannot promise. Open the app once and the widget is current again.',
      ],
    },
    watch: {
      p1: 'On Apple Watch and Wear OS, the app shows today’s prayers with the one-tap seal, and the qibla. On Apple Watch, the next prayer can sit on your watch face. On Wear OS there is also a tile. A watch face of our own, called Manuscript, is coming soon.',
      bullets: [
        'Your watch keeps up to two weeks of times, so it stays right even when your phone is far away.',
        'A prayer you mark on the watch is kept on the watch, and lands in the app the next time the watch and the phone are near each other.',
        'On Wear OS, when the phone is away, the watch itself can sound the adhan at prayer time. When the phone is near, the phone’s own reminder appears on the watch instead — you never get the same reminder twice.',
        'The watch works together with the phone app: the phone calculates the times and the watch shows them, so the two always agree.',
      ],
    },
    exemption: {
      p1: 'Excused days are for menstruation and the days after childbirth. Turn them on in Settings → Tracking. No prayers are owed for those days. This is the agreed ruling, and the app follows it. When you begin, you choose how long: until you end it yourself, or a number of days — and then it ends by itself, and you never need to remember it.',
      bullets: [
        'An excused day is shown with a plain seal and the words “not required”. It is never shown as missed and never counted in your statistics. Reminders pause while excused days last, and you can choose to keep them on when you turn the mode on.',
        'A streak continues through excused days. It does not end.',
        'When the app estimates how many prayers you owe, you can tell it how many excused days you usually have in a month. It takes those days out of the estimate, so the number is not larger than it should be.',
        'This is not a period tracker. It predicts nothing and stores no health data. Like everything else in the app, excused days stay on your phone and nowhere else.',
      ],
    },
    qada: {
      p1: 'Qada means the prayers you still owe. The app keeps a count for each prayer, and the count goes down as you make them up.',
      bullets: [
        'Starting out: the first time you open the qada screen, a short setup asks how you want to begin. You can estimate a past period — it asks from when to when you missed prayers, works out a count for each prayer, and lets you change the numbers by hand. Or you can start from zero, and count only the prayers you mark as missed from now on. You can skip this setup.',
        'Day to day: marking a prayer as missed adds one to the count for that prayer. While you still owe prayers, a small card under the Today list shows how many are left. Tap it to open the full screen, with a count for each prayer, how fast you are going, and the date you should be finished. Making a prayer up is done on that screen, not from Today.',
        'From History: open any past day and mark a missed prayer as “made up”. It then shows as missed but made up, and the count goes down by one.',
        'Start fresh: on the qada screen you can clear the whole count at once. Your history is kept, the counts go back to zero, and you have 30 days to undo it in the same place.',
      ],
    },
    streaks: {
      bullets: [
        'There are two modes in Settings → Tracking. In Relaxed, a day counts when you have prayed at least one prayer, on time or late. In Committed, a day counts only when all five are marked.',
        'You can change any day, at any time. Open History, tap a past day, and change any prayer. A wrong tap or a forgotten evening is never permanent.',
        'Excused days do not end a streak. A day you did not mark is never turned into a day you missed.',
        "Today's streak is not final until the day ends at the next Fajr. A day runs from one Fajr to the next, so an Isha you mark after midnight still counts for the right day.",
      ],
    },
    location: {
      bullets: [
        '“Use my location” asks for your rough position only. Never your exact position, and never while the app is closed. It only asks when you tap it.',
        'Or type a city in Settings → Location. The app works completely with a city you picked yourself and no location permission at all, and it will not keep asking.',
        "Naming your city is the one time your rough position leaves the phone. It goes to your phone's own map service, made by Apple or Google, and never to us. The privacy policy explains this in detail.",
      ],
      privacyLink: 'privacy policy',
    },
    export: {
      p1: 'Settings → Data saves everything the app has recorded — your prayer log, your qada counts, your excused days and your settings — as a CSV or JSON file, and hands it to your phone to share. Save it, send it, or open it anywhere you like. The app never uploads it. Because everything is kept on your phone, this file is also your backup before you move to a new phone.',
    },
    contact: {
      p1: 'Write to {email} for help or for anything else. If a prayer time looks wrong, please tell us your city and the times your mosque uses. A crash report only tells us that the app broke. It never tells us who you are, or what went wrong for you, so we really do depend on people writing to us.',
      privacy: 'For privacy questions, write to {email}.',
      feedbackLink: 'Send feedback or ask for a feature',
      feedbackAfter:
        ' — see what other people have asked for, add your own, and see what is planned next. No account needed. That page is not part of this site.',
    },
    credits: {
      h2: 'What the app is built on',
      intro: 'The app uses work that other people share openly. Thank you to all of them.',
      items: {
        adhan: 'Calculates the prayer times. By Batoul Apps, MIT license.',
        amiri: 'The Arabic font for prayer names, and for Arabic on this site. By Khaled Hosny, SIL Open Font License.',
        naskh: 'The Arabic font for the rest of the app. By Google, SIL Open Font License.',
        nastaliq: 'The Urdu font, in the app and on this site. By Google, SIL Open Font License.',
        lora: 'The font for English and Turkish, in the app and on this site. By Cyreal, SIL Open Font License.',
        icu: 'Calendar data for the Hijri date. By the Unicode Consortium, Unicode License.',
        geonames: 'The list of cities. CC BY 4.0 license.',
        expo: 'The tools the app is built with. MIT license.',
      },
    },
  },

  /** Short line shown on the English-only /privacy page in this language (null for English). */
  privacyNotice: null as string | null,
  termsNotice: null as string | null,

  /** The prayer-times tool: a section on the home page, and the whole of /times. */
  timesPage: {
    navLabel: 'Prayer times',
    title: 'Prayer times today — Simple Prayer',
    description:
      "Today's five prayer times and the next one, worked out in your browser. No account, no ads, and your location never leaves your device.",
    heading: "Today's prayer times",
    lead: 'Let your browser say where you are, or choose a city. The times are worked out on your device, and your location is not sent anywhere.',
    orChooseCity: 'Or choose a city',
    searchLabel: 'City name',
    change: 'Change',
    locating: 'Finding your location…',
    denied:
      'Your browser did not share your location. You can choose a city instead, or allow location for this site and try again.',
    unavailable: 'Your browser could not work out where you are. Choose a city instead.',
    unsupported: 'This browser cannot give a location. Choose a city instead.',
    calculatedWith: 'Times follow {method}.',
    howCalculated: 'How the times are calculated',
    zoneNote: 'These are {city} times. Your device clock is on a different one.',
    inApp:
      'The app does the rest: it reminds you before each prayer, and you can mark the ones you have prayed.',
    noScript:
      'This page needs JavaScript to work out the times, because it does the whole calculation on your device instead of asking a server.',
    credit: 'City list from GeoNames.',
    about: {
      heading: "About these times",
      items: [
        {
          q: "How are prayer times calculated?",
          a: "Each time comes from where the sun is in the sky at your location. Dhuhr is just after midday, when the sun is highest. Maghrib is at sunset. Fajr and Isha begin when the sun is a set angle below the horizon, and that angle depends on the calculation method. Asr begins when a shadow reaches a set length.",
        },
        {
          q: "Which calculation method does this page use?",
          a: "The one used in your country: Diyanet in Türkiye, ISNA in North America, Umm al-Qura in Saudi Arabia, and so on. The name of the method is shown under the times. Asr follows your country too. In Pakistan, India, Bangladesh and Afghanistan it follows the Hanafi rule: it begins when a shadow is twice as long as the thing itself. Everywhere else it follows the Shafi, Maliki and Hanbali rule: it begins when the shadow is as long as the thing.",
        },
        {
          q: "Why are the times different from my mosque?",
          a: "A mosque may use a different method, the Hanafi rule for Asr (about an hour later), or add a few minutes to be careful. In the Simple Prayer app you can change the method, choose Hanafi or Shafi Asr, and move each prayer by up to 30 minutes to match your mosque.",
        },
        {
          q: "What about places far north?",
          a: "In summer, in places such as northern Europe, the sky may not get dark enough for the usual Fajr and Isha angles. A special rule then sets those two times. In the app you can choose the rule yourself.",
        },
        {
          q: "Does this page work offline?",
          a: "Yes. After you open it once and choose a place, it works without a connection.",
        },
        {
          q: "Does this page send my location anywhere?",
          a: "No. The times are worked out on your device. Your location is not sent to us or to anyone else.",
        },
      ],
    },
  },

  /** The qibla tool at /qibla. */
  qiblaPage: {
    navLabel: 'Qibla',
    title: 'Qibla direction from your location — Simple Prayer',
    description:
      'Which way to face for prayer, and how far Makkah is, worked out in your browser. Your location never leaves your device.',
    heading: 'Qibla direction',
    lead: 'The direction is worked out from where you are. It is correct on any device, whether or not the dial can turn.',
    enableCompass: 'Turn on the compass',
    compassBlocked:
      'Your browser did not allow the compass. The direction below is still correct. Turn until north on the dial matches north on your own compass.',
    faceDirection: 'Makkah is {{degrees}}° from north — {{cardinal}} on a compass.',
    flatHint: 'Lay the phone flat. A web compass has no way to correct for tilt, so a phone held upright will read wrong.',
    inApp: 'The app has a steadier compass, and it does not need the phone flat.',
    tabTimes: 'Prayer times',
    tabQibla: 'Qibla',
    toolNav: 'Prayer times and qibla',
    about: {
      heading: "About the qibla",
      items: [
        {
          q: "What is the qibla?",
          a: "The qibla is the direction of the Kaaba in Makkah. Muslims face it in every prayer, wherever they are in the world.",
        },
        {
          q: "How is the direction worked out?",
          a: "From your position and the position of the Kaaba (about 21.42° N, 39.83° E). The page follows the shortest path over the round earth, called a great circle. The number is measured clockwise from true north.",
        },
        {
          q: "Why does the qibla point north-east from North America?",
          a: "On a flat map, Makkah looks south-east of North America. But the earth is round, and the shortest path from there to Makkah goes over the Atlantic toward the north-east. From New York, for example, the qibla is about 58° from north. Some communities use the south-east direction from a flat map. This page follows the shortest path.",
        },
        {
          q: "How do I get a good compass reading?",
          a: "Hold the phone flat, away from metal, magnets and electrical devices. If the reading jumps, move the phone slowly in a figure eight a few times so it can correct itself. If your browser has no compass, use the number in degrees with any compass you trust.",
        },
        {
          q: "Does this page send my location anywhere?",
          a: "No. The direction is worked out on your device. Your location is not sent to us or to anyone else.",
        },
        {
          q: "Is there an app?",
          a: "Yes. Simple Prayer is free on iPhone, Android, Apple Watch and Wear OS, with no ads and no account, and it is open source. Its compass is steadier and does not need the phone flat.",
        },
      ],
    },
  },

  /** The /install shortcut: one URL that sends each visitor to their own store (D156). */
  install: {
    title: 'Get the app — Simple Prayer',
    description:
      'Open the App Store or Google Play page for Simple Prayer. The app is free, with no ads and no account.',
    heading: 'Get Simple Prayer',
    lead: 'Simple Prayer is free, with no ads and no account. Choose the store for your phone.',
    onIos: 'The App Store should open by itself. If it does not, use the button below.',
    onAndroid: 'Google Play should open by itself. If it does not, use the button below.',
    onDesktop: 'You are on a computer. Scan this code with your phone, or use the buttons below.',
    noPlay: 'This device does not have Google Play.',
    qrAlt: 'A code you can scan with your phone camera. It opens this page.',
    goingIos: 'Opening the App Store…',
    goingAndroid: 'Opening Google Play…',
    /** Direct Android downloads, below the store badges. Both files live on GitHub Releases. */
    apk: {
      heading: 'Android app files (APK)',
      lead: 'You can also download the Android app as a file and install it yourself. For most people Google Play is the better choice, because it keeps the app up to date.',
      fossTitle: 'The version without Google',
      fossBody: 'Built from the open-source code, with no Google services. It sends no crash reports and has no tip. Three things are different:',
      fossDiffs: [
        'Your prayer buddies’ prayers show up when you open the app. You get no notification when they pray.',
        'There is no Wear OS watch app, and nothing is shared with a watch.',
        'The adhan voices are different recordings, with free licences.',
      ],
      fossWarning: 'It is signed with a different key. It cannot update the Google Play version, and the Google Play version cannot update it. To switch between them, you must uninstall the app first, and uninstalling deletes the prayer log on your phone. To keep a copy, export it first in Settings · Data.',
      fossButton: 'Download the version without Google',
      releases: 'All releases and checksums',
    },
  },

  /** Strings for the installable copy. The name and mark stay the app's; the description is where
   *  the limit is stated, before anyone installs rather than after. */
  pwa: {
    description:
      "Today's prayer times and the qibla, offline, in your browser. Marking prayers and reminders are in the app.",
  },
};
