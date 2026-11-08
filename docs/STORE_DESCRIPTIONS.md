# Store descriptions — paste-ready

Everything on this page is copy you paste into a store console, in console order, nothing else.
The reasoning, keywords, category picks, privacy forms and screenshot plans stay in
`docs/STORE_LISTINGS.md`; the upload steps are in the internal notes. Rewritten 2026-08-28
(owner: plainer voice, and every line true for the store it appears in).

Platform truth, so the split below never drifts:

- iOS has: Home Screen + Lock Screen widgets, StandBy, the Live Activity, the Apple Watch app
  and complications, the iPad layout. Marking from a notification works by **pressing and
  holding** it.
- Android has: home screen widgets, the optional always-on notification with the **"I prayed"
  button visible on it**, the Wear OS app / tile / complications, the Manuscript watch face,
  watch-local adhan, the tablet/foldable layout.
- Both have: times/methods/adjustments, all tracking (streaks, history, insights, excused days,
  travel mode, qada), the tilt-tolerant qibla compass, en/ar/tr.

---

## English

### App Store — name, subtitle, promotional text

```
Simple Prayer: Times & Qibla
```
```
Salah Tracker, Athan & Qada
```
```
Every feature is free. No ads, no account, no tracking. Beautiful prayer times, gentle prayer tracking, accurate Qibla — and nobody watching.
```

> **Why these read the way they do** (checked against Apple's and Google's own guidance, 2026-09-16):
>
> - **Apple does not index the description** — only the name, subtitle and the hidden keywords field
>   feed search. So this is conversion copy, not keyword copy, and Apple's own line is that "the first
>   sentence is the most important" because it is all most people see. The opening paragraph is kept
>   under 200 characters so the whole of it, including "your log stays on your phone unless you add a prayer buddy", lands
>   above the "read more" fold.
> - **Google Play does index the description**, with the short description weighing more than the full
>   one. That is why the Play short description carries the real search words (prayer times, azan,
>   Qibla, salah tracker) in a sentence rather than a keyword list — Google's policy warns that
>   stuffing "will not impact ranking and provides a bad user experience".
> - **No ALL CAPS headers and no emoji**: Play's metadata policy discourages both. No superlatives,
>   no competitor names, no specific prices: Apple guideline 2.3.7.
> - **No em-dash asides, and tricolons only where the thing genuinely has three parts.** An earlier
>   version of this file had nine em-dash asides and a three-item list in fifteen of its
>   thirty-nine sentences, which is what machine-written prose reads like. Sentences are short and
>   deliberately uneven in length. If you edit these, keep that.
> - **ar/tr are authored, not translated** (`docs/TONE.md`). Keyword habits differ by language, and a
>   literal translation of an English phrase is often not what a Turkish or Arabic speaker types.

### App Store — description

```
Simple Prayer shows your five daily prayer times, points you to the Qibla, and records a prayer with one tap. Every feature is free. No ads, no account, and your log stays on your phone unless you add a prayer buddy.

Prayer times
Times are calculated on your phone, so the app works with no internet at all. It picks the method used in your country: Diyanet, ISNA, Umm al-Qura, Egyptian, Karachi, Moonsighting Committee, Jafari and others. You can change it whenever you like. You can also shift any prayer by a few minutes to match your mosque. Choose Hanafi or Shafi Asr. Move the Hijri date if it reads a day out. If you live far north, where the sun barely sets in summer, there is a rule for those months.

Reminders
Each prayer can have three. The adhan as its time comes in. An earlier one to help you wake for Fajr. A last call before the time runs out. Each can be silent, a simple tone, or the adhan itself, with four recitations to choose from. Press and hold a reminder and you can record the prayer from the notification, without opening the app.

Tracking
When you pray, tap the prayer. That is all it takes. A past prayer takes one more tap: prayed, prayed late, or missed. No day is ever locked, so you can open one in History and change it.

The app does not scold you. Keep a streak if you want one; missing a single prayer does not always end it. During menstruation and after childbirth, excused days mark nothing as missed and ask nothing of you. The mode ends by itself after the days you choose. Travel mode understands shortened and joined prayers, so a joined prayer is never called late. If you have prayers to make up, the qada counter goes down as you pray them and shows the day you will be finished.

If you only want times and the Qibla, nothing here will ever ask you to log a prayer.

Qibla
The compass shows the Kaaba on its dial and tells you which way to turn: "38° to the left." It corrects for the difference between magnetic north and the true north where you live. You do not have to hold the phone flat. The compass notices how you hold it and stays steady.

Prayer buddies (optional)
Praying is easier when you know someone else is praying too. Pair with one person or a few: your wife or husband, your brother or sister, a parent, a child, a friend. You see on today's screen that they prayed, and they see the same about you. The point is to encourage each other.

They never see a prayer you missed, or one you have not marked yet. There is no feed, no ranking, no score. It stays off until you turn it on, and either of you can end it whenever you want.

On your Home Screen, Lock Screen and wrist
Home Screen widgets carry a live countdown, and you can mark a prayer straight from the widget. Lock Screen widgets and StandBy show the next prayer, times only, so your record stays private. A Live Activity keeps the current prayer on the Lock Screen with the mark button on it. The Apple Watch app has today's prayers, one-tap marking and the Qibla, and holds two weeks of times for when your phone is not nearby; complications put the countdown on your watch face. On iPad, the app shows two panes side by side.

Our pledge
No ads, ever. No account. No analytics. Your prayer record stays on your phone, and your approximate location only goes to your phone's own map service, to name your city. If you add a prayer buddy, the prayers you mark travel to their phone through a small relay of ours. It deletes each one as soon as their phone has it, and keeps no name, no location and no history. If the app crashes, an anonymous report helps us fix it, and you can switch that off in Settings. If the app helps you, there is an optional tip jar in Settings.

Open source
The app and its relay are open source. Anyone can read the code to see what they do, or build the app themselves.

Simple Prayer is available in English, Arabic and Turkish.
```

### App Store — What's New (1.6.0)

> 1.5.0 was bumped and tagged but never built; 1.6.0 ships its changes too.

```
Choose how you mark prayers. Simple: one tap marks a prayer as prayed. Detailed: prayed, prayed late or missed. You can change it any time in Settings.

The Now widget always counts down to something. After sunrise it counts to Dhuhr, or to Jumaa on Fridays. Once you mark a prayer, it counts quietly to the next one. The widget no longer counts below zero, and its text fits when your text size is large.

Taps answer at once. Today moves to the new day at Fajr. Your buddy's prayers arrive faster.
```

Arabic:

```
اختر طريقة تسجيل صلواتك. البسيطة: لمسة واحدة تسجّل الصلاة على أنها صُلِّيت. المفصّلة: صُلِّيت، أو صُلِّيت متأخّرةً، أو فاتت. ويمكنك تغييرها متى شئت من الإعدادات.

أداة «الآن» تعدّ دائمًا إلى شيء. بعد الشروق تعدّ إلى الظهر، وإلى الجمعة يوم الجمعة. وبعد أن تسجّل صلاة، تعدّ بهدوء إلى الصلاة التالية. ولم تعد الأداة تعدّ إلى ما دون الصفر، ويتّسع نصّها حين يكون حجم الخط كبيرًا.

يستجيب التطبيق لنقراتك فورًا. وتنتقل صفحة اليوم إلى اليوم الجديد عند الفجر. وتصل صلوات رفيقك أسرع.
```

Turkish:

```
Namazları nasıl işaretleyeceğini seç. Basit: tek dokunuş namazı kılındı olarak işaretler. Ayrıntılı: kılındı, geç kılındı ya da kaçırıldı. İstediğin zaman Ayarlar'dan değiştirebilirsin.

Şimdi widget'ı her zaman bir şeye geri sayıyor. Güneş doğduktan sonra Öğle'ye, cuma günleri Cuma'ya sayıyor. Bir namazı işaretleyince bir sonrakine sakin bir şekilde sayıyor. Widget artık sıfırın altına inmiyor ve yazı boyutun büyük olduğunda metni sığıyor.

Dokunuşlar hemen yanıt veriyor. Bugün ekranı sabah namazı vaktinde yeni güne geçiyor. Arkadaşının namazları daha hızlı ulaşıyor.
```

### App Store — What's New (1.5.0)

```
The app now answers your taps at once. The seal opens as soon as you tap it, and a prayer you mark shows as marked right away. A day in History opens faster.
```

Arabic:

```
يستجيب التطبيق الآن لنقراتك فورًا. يُفتح الختم بمجرد أن تنقر عليه، وتظهر الصلاة التي تعلّمها مباشرة. ويُفتح اليوم في السجلّ أسرع من قبل.
```

Turkish:

```
Uygulama artık dokunuşlarına hemen yanıt veriyor. Mühür dokunduğun anda açılıyor ve işaretlediğin namaz hemen işaretli görünüyor. Geçmiş'te bir gün artık daha hızlı açılıyor.
```

### App Store — What's New (1.4.4)

> 1.4.3 was bumped and tagged but never built; 1.4.4 ships its changes plus D185–D186.

```
The medium Next prayer widget now uses its full height: a larger countdown, a larger mark button, and today's five prayers at the top. The paper behind the app is a little lighter.
```

Arabic:

```
أداة «الصلاة القادمة» المتوسطة تستعمل الآن ارتفاعها كله: عدّ تنازلي أكبر، وزر تعليم أكبر، وصلوات اليوم الخمس في الأعلى. وخلفية الورق في التطبيق أخفّ قليلًا.
```

Turkish:

```
Orta boy Sıradaki namaz widget'ı artık tüm yüksekliğini kullanıyor: daha büyük bir geri sayım, daha büyük bir işaretleme düğmesi ve en üstte bugünün beş namazı. Uygulamanın arkasındaki kâğıt dokusu biraz daha hafif.
```

### App Store — What's New (1.4.2)

```
The History tab has a new look. It opens on your streak, with this week drawn as a ring beside it. The month has its own bar under the calendar, and every number in your record is now a bar as well as a figure, so you can read how things are going at a glance. Switching months is smooth again. There is also a new one-row home screen widget: the next prayer, the countdown, your buddies and the mark button, across the full width of the screen.
```

Arabic:

```
صفحة السجل بشكل جديد. تفتح على تتابعك، ومعه حلقة تُظهر هذا الأسبوع. للشهر شريطه الخاص تحت التقويم، وكل رقم في سجلك أصبح شريطًا إلى جانب العدد، لتقرأ كيف تسير الأمور بنظرة واحدة. التنقّل بين الشهور أصبح سلسًا من جديد. وهناك أداة جديدة للشاشة الرئيسية بسطر واحد: الصلاة القادمة والعدّ التنازلي ورفاقك وزر التعليم، بعرض الشاشة كله.
```

Turkish:

```
Geçmiş sekmesi yenilendi. Serinle açılır, yanında bu haftayı gösteren bir halka vardır. Takvimin altında ayın kendi çubuğu bulunur ve kayıttaki her sayı artık rakamın yanında bir çubuk olarak da görünür; böylece gidişatı bir bakışta okursun. Aylar arasında geçiş yeniden akıcı. Ayrıca tek satırlık yeni bir ana ekran widget'ı var: sıradaki namaz, geri sayım, arkadaşların ve işaretleme düğmesi, ekranın tüm genişliğinde.
```

### App Store — What's New (1.4.0)

```
• Prayer buddies. Pair with someone you choose and see on today's screen that they prayed, while they see the same about you.
• They never see a prayer you missed or one you have not marked yet. No history, no streak, no score.
• Off until you turn it on in Settings, and either of you can end it at any time.
• The Qibla screen tells you when the phone is face down and the compass cannot be read the right way round.
```

Single-paragraph form:

```
Prayer buddies: pair with someone you choose — a partner, a sibling, a friend — and see on today's screen that they prayed, while they see the same about you. They never see a prayer you missed or one you have not marked yet, and there is no history, no streak and no score. It is off until you turn it on in Settings, and either of you can end it at any time. The Qibla screen also tells you now when the phone is face down and the compass cannot be read the right way round.
```

### App Store — What's New (1.3.1)

```
• Opens faster and answers your tap at once.
• No buzz when a scroll starts on a prayer.
• Reminders now arrive even in a Focus mode or with Scheduled Summary on. You can turn that off for this app in Settings.
• Reminders keep going even if you do not open the app for days.
• The compass is right when the iPad is on its side or upside down.
• Apple Watch: the qibla is one turn of the crown up from the Today screen.
```

Single-paragraph form (owner's ask, 2026-09-15):

```
The app opens faster and answers your tap at once, and a scroll that starts on a prayer no longer buzzes. Reminders now arrive even in a Focus mode or with Scheduled Summary on (you can turn that off for this app in Settings), and they keep going even if you do not open the app for days. The compass is right when the iPad is on its side or upside down. On Apple Watch, the qibla is now one turn of the crown up from the Today screen.
```

### App Store — What's New (1.3)

```
• Opens faster and answers your tap at once.
• No buzz when a scroll starts on a prayer.
• Reminders now arrive even in a Focus mode or with Scheduled Summary on. You can turn that off for this app in Settings.
• Reminders keep going even if you do not open the app for days.
• The compass is right when the iPad is on its side or upside down.
```

### App Store — What's New (1.1)

```
Simple Prayer now lives beyond the app:
• Home Screen widgets with a live countdown — mark a prayer right from the widget
• An Apple Watch app and watch-face complications: today's prayers, one-tap marking, and the Qibla on your wrist
• A Live Activity keeps the current prayer on the Lock Screen, the mark button on it
• Travel mode understands shortened and joined prayers
• Excused days can end by themselves — set them for as long as you need
• A two-pane layout for iPad
• The compass no longer cares how you hold the phone
```

### Google Play — title, short description

```
Simple Prayer: Times & Qibla
```
```
Prayer times, azan, Qibla & a kind salah tracker. Every feature free. No ads.
```

### Google Play — description

Identical to the App Store description except two sections; paste this full version:

```
Simple Prayer shows your five daily prayer times, points you to the Qibla, and records a prayer with one tap. Every feature is free. No ads, no account, and your log stays on your phone unless you add a prayer buddy.

Prayer times
Times are calculated on your phone, so the app works with no internet at all. It picks the method used in your country: Diyanet, ISNA, Umm al-Qura, Egyptian, Karachi, Moonsighting Committee, Jafari and others. You can change it whenever you like. You can also shift any prayer by a few minutes to match your mosque. Choose Hanafi or Shafi Asr. Move the Hijri date if it reads a day out. If you live far north, where the sun barely sets in summer, there is a rule for those months.

Reminders
Each prayer can have three. The adhan as its time comes in. An earlier one to help you wake for Fajr. A last call before the time runs out. Each can be silent, a simple tone, or the adhan itself, with four recitations to choose from. Press and hold a reminder and you can record the prayer from the notification, without opening the app.

Tracking
When you pray, tap the prayer. That is all it takes. A past prayer takes one more tap: prayed, prayed late, or missed. No day is ever locked, so you can open one in History and change it.

The app does not scold you. Keep a streak if you want one; missing a single prayer does not always end it. During menstruation and after childbirth, excused days mark nothing as missed and ask nothing of you. The mode ends by itself after the days you choose. Travel mode understands shortened and joined prayers, so a joined prayer is never called late. If you have prayers to make up, the qada counter goes down as you pray them and shows the day you will be finished.

If you only want times and the Qibla, nothing here will ever ask you to log a prayer.

Qibla
The compass shows the Kaaba on its dial and tells you which way to turn: "38° to the left." It corrects for the difference between magnetic north and the true north where you live. You do not have to hold the phone flat. The compass notices how you hold it and stays steady.

Prayer buddies (optional)
Praying is easier when you know someone else is praying too. Pair with one person or a few: your wife or husband, your brother or sister, a parent, a child, a friend. You see on today's screen that they prayed, and they see the same about you. The point is to encourage each other.

They never see a prayer you missed, or one you have not marked yet. There is no feed, no ranking, no score. It stays off until you turn it on, and either of you can end it whenever you want.

On your home screen, in your notifications and on your wrist
Home screen widgets carry a live countdown, and you can mark a prayer straight from the widget. An optional always-on notification keeps the current and next prayer in your shade, with the "I prayed" button on it. The Wear OS app has today's prayers, one-tap marking and the Qibla, and holds two weeks of times for when your phone is not nearby. There is a tile one swipe away, complications for any face, and our own watch face, Manuscript, showing the next prayer and a live countdown. When your phone is away, the watch can sound the azan itself. Tablets and foldables get two panes side by side.

Our pledge
No ads, ever. No account. No analytics. Your prayer record stays on your phone, and your approximate location only goes to your phone's own map service, to name your city. If you add a prayer buddy, the prayers you mark travel to their phone through a small relay of ours. It deletes each one as soon as their phone has it, and keeps no name, no location and no history. If the app crashes, an anonymous report helps us fix it, and you can switch that off in Settings. If the app helps you, there is an optional tip jar in Settings.

Open source
The app and its relay are open source. Anyone can read the code to see what they do, or build the app themselves.

Simple Prayer is available in English, Arabic and Turkish.
```

> **Play Console tip:** the release-notes field takes all languages at once in its tagged form —
> `<en-US>…</en-US><ar>…</ar><tr-TR>…</tr-TR>` — 500 characters per language. Keep them
> short: six one-line bullets, about 300 characters, is what the owner settled on for 1.3.

### Google Play — What's New (1.6.0)

> 1.5.0 was never built; these notes cover it too.

```
• Choose how you mark prayers: Simple (one tap) or Detailed (prayed, late, missed). Change it any time in Settings.
• The widget always counts down: to Dhuhr after sunrise (Jumaa on Fridays), and quietly to the next prayer once you mark one.
• The widget no longer counts below zero, and its text fits at large text sizes.
• Taps answer at once. Today moves to the new day at Fajr.
• Your buddy's prayers arrive faster and show as a banner.
```

Arabic:

```
• اختر طريقة تسجيل الصلوات: البسيطة (لمسة واحدة) أو المفصّلة (صُلِّيت، متأخّرة، فاتت). غيّرها متى شئت من الإعدادات.
• الأداة تعدّ دائمًا: إلى الظهر بعد الشروق (والجمعة يوم الجمعة)، وبهدوء إلى الصلاة التالية بعد أن تسجّل صلاة.
• لم تعد الأداة تعدّ إلى ما دون الصفر، ويتّسع نصّها مع الخط الكبير.
• يستجيب التطبيق لنقراتك فورًا، وتنتقل صفحة اليوم إلى اليوم الجديد عند الفجر.
• تصل صلوات رفيقك أسرع، وتظهر في شريط إشعار.
```

Turkish:

```
• Namazları nasıl işaretleyeceğini seç: Basit (tek dokunuş) ya da Ayrıntılı (kılındı, geç, kaçırıldı). Ayarlar'dan değiştirebilirsin.
• Widget hep geri sayıyor: güneş doğunca Öğle'ye (cuma günü Cuma'ya), bir namazı işaretleyince sakince sonrakine.
• Widget artık sıfırın altına inmiyor; metni büyük yazı boyutunda da sığıyor.
• Dokunuşlar hemen yanıt veriyor. Bugün ekranı sabah namazında yeni güne geçiyor.
• Arkadaşının namazları daha hızlı ulaşıyor ve bildirim şeridinde görünüyor.
```

### Google Play — What's New (1.5.0)

```
• The seal opens as soon as you tap it, and a prayer you mark shows at once.
• A day in History opens faster.
```

Arabic:

```
• يُفتح الختم بمجرد أن تنقر عليه، وتظهر الصلاة التي تعلّمها مباشرة.
• يُفتح اليوم في السجلّ أسرع من قبل.
```

Turkish:

```
• Mühür dokunduğun anda açılıyor; işaretlediğin namaz hemen görünüyor.
• Geçmiş'te bir gün daha hızlı açılıyor.
```

### Google Play — What's New (1.4.4)

```
• The one-row widget is clearer: a much bigger countdown and a bigger button to mark the prayer.
• The paper behind the app is a little lighter.
```

Arabic:

```
• الأداة ذات السطر الواحد أوضح: عدّ تنازلي أكبر بكثير، وزر أكبر لتعليم الصلاة.
• خلفية الورق في التطبيق أخفّ قليلًا.
```

Turkish:

```
• Tek satırlık widget daha net: çok daha büyük bir geri sayım ve namazı işaretlemek için daha büyük bir düğme.
• Uygulamanın arkasındaki kâğıt dokusu biraz daha hafif.
```

### Google Play — What's New (1.4.2)

```
• The History tab is redesigned: your streak and this week's ring at the top, the month with its own bar, and every number drawn as a bar.
• Switching months in the calendar is smooth now.
• A new one-row home screen widget: the next prayer, the countdown, your buddies and the mark button, the full width of the screen.
```

Arabic:

```
• تصميم جديد لصفحة السجل: تتابعك وحلقة هذا الأسبوع في الأعلى، والشهر مع شريطه الخاص، وكل رقم مرسوم شريطًا.
• التنقّل بين الشهور في التقويم أصبح سلسًا.
• أداة جديدة للشاشة الرئيسية بسطر واحد: الصلاة القادمة والعدّ التنازلي ورفاقك وزر التعليم، بعرض الشاشة كله.
```

Turkish:

```
• Geçmiş sekmesi yeniden tasarlandı: serin ve bu haftanın halkası en üstte, ayın kendi çubuğu ve her sayı bir çubuk olarak.
• Takvimde aylar arasında geçiş artık akıcı.
• Tek satırlık yeni ana ekran widget'ı: sıradaki namaz, geri sayım, arkadaşların ve işaretleme düğmesi, ekranın tüm genişliğinde.
```

### Google Play — What's New (1.4.1)

```
• Prayer buddies: pair with someone you choose and see on today's screen that they prayed, while they see the same about you. Off until you turn it on.
• Inviting happens in one sheet, and you see the moment they accept.
• Notifications say who prayed what: "Leen prayed Dhuhr". The name never leaves your phone.
• Marking a prayer from the home screen widget tells your buddies straight away.
• Bigger buddy badges. Settings reorganised.
• Fixed a crash when switching between Arabic and English.
```

Arabic:

```
• رفاق الصلاة: اربط تطبيقك بشخص تختاره لترى في شاشة اليوم أنه صلّى، ويرى هو الشيء نفسه عنك. الميزة متوقفة حتى تشغّلها من الإعدادات.
• الدعوة تتم في نافذة واحدة، وترى لحظة قبولها.
• الإشعار يقول من صلّى وماذا: «صلّى لين الظهر». الاسم لا يغادر هاتفك أبدًا.
• تعليم الصلاة من أداة الشاشة الرئيسية يخبر رفاقك فورًا.
• شارات الرفاق أكبر. الإعدادات مرتّبة حسب ما جئت لتفعله.
• إصلاح انهيار عند التبديل بين العربية والإنجليزية.
```

Turkish:

```
• Namaz arkadaşları: seçtiğin biriyle eşleş; bugün ekranında onun namazını kıldığını gör, o da senin hakkında aynısını görsün. Sen açana kadar kapalı.
• Davet tek bir sayfada olur ve kabul ettiği anı görürsün.
• Bildirimler kimin ne kıldığını söyler: "Leen Öğle namazını kıldı". Ad telefonundan hiç çıkmaz.
• Widget'tan namazı işaretlemek arkadaşlarına hemen haber verir.
• Arkadaş rozetleri daha büyük. Ayarlar yeniden düzenlendi.
• Arapça–İngilizce geçişindeki çökme düzeltildi.
```

### Google Play — What's New (1.4.0)

```
• Prayer buddies. Pair with someone you choose and see on today's screen that they prayed, while they see the same about you.
• They never see a prayer you missed or one you have not marked yet. No history, no streak, no score.
• Off until you turn it on in Settings, and either of you can end it at any time.
• The Qibla screen tells you when the phone is face down and the compass cannot be read the right way round.
```

### Google Play — What's New (1.3.1)

```
• Opens and responds faster.
• No buzz when a scroll starts on a prayer.
• Compass right with the phone held upright.
• Reminders arrive on time and clear themselves when the next prayer starts.
• Reminders keep going even if you do not open the app for days.
• Wear OS: black background, clearer text, and the prayer button always on the first screen.
```

### Google Play — What's New (1.3)

```
• Opens and responds faster.
• No buzz when a scroll starts on a prayer.
• Compass right with the phone held upright.
• Reminders arrive on time and clear themselves when the next prayer starts.
• Reminders keep going even if you do not open the app for days.
• Wear OS: clearer text on small watches.
```

### Google Play — What's New (1.1)

```
Simple Prayer now lives beyond the app:
• Home screen widgets with a live countdown — mark a prayer right from the widget
• A Wear OS app, a tile, complications — and our own watch face, Manuscript
• The optional always-on notification carries the "I prayed" button
• Travel mode understands shortened and joined prayers
• Excused days can end by themselves — set them for as long as you need
• A two-pane layout for tablets and foldables
• The compass no longer cares how you hold the phone
```

---

## Türkçe

### App Store — ad, alt başlık, tanıtım metni

```
Namaz Vakitleri, Kıble, Kaza
```
```
Ezan, Cuma, Hicri Takvim
```
```
Her özellik ücretsiz. Reklam yok, hesap yok, izleyici yok. Güzel namaz vakitleri, sade namaz takibi, doğru kıble — ve seni izleyen kimse yok.
```

### App Store — açıklama

```
Simple Prayer doğru namaz vakitlerini gösterir, namazlarını takip etmene yardım eder ve kıbleyi bulur. Ücretsizdir; reklam da hesap da yoktur. Namaz arkadaşı eklemezsen namaz kaydın telefonunda kalır.

Namaz vakitleri
Vakitler telefonunda hesaplanır, bu yüzden uygulama internetsiz çalışır. Hesaplama yöntemi ülkene göre kendiliğinden seçilir: Diyanet, ISNA, Ümmü'l-Kurâ, Mısır, Karaçi, Hilal Gözlem Komitesi, Caferî ve diğerleri. İstediğin zaman değiştirebilirsin. Her namazı camine uysun diye dakika dakika ayarlayabilir, ikindi için Hanefî ya da Şâfiî usulünü seçebilir, hicri tarihi düzeltebilirsin.

Hatırlatmalar
Her namazın üç hatırlatması olabilir: vakit girince ezan, vakitten önce bir uyandırma (çoğu kişi sabah namazı için kullanıyor) ve vakit çıkmadan sessiz bir son hatırlatma. Her biri sessiz, sade bir ses ya da ezan olabilir; birkaç okuyuş arasından seçersin. Bildirimi basılı tutarsan namazı oradan, uygulamayı açmadan kaydedebilirsin.

Takip
Namazını kıldığında dokun, kaydedilsin. Geçmiş bir namaz bir dokunuş daha ister: kılındı, geç kılındı ya da kaçırıldı. Her şeyi sonradan Geçmiş'te değiştirebilirsin. İstersen günlük seri tutar, günlerini takvimde görür, dürüst istatistiklere bakarsın.

Uygulama seni hiç azarlamaz. Adet ya da lohusalık günlerinde özel günler modunu açarsın: hiçbir şey kaçırıldı yazmaz, hiçbir hatırlatma gelmez. İstersen gün sayısını seçersin, süre bitince mod kendiliğinden kapanır. Yolculuktayken yolculuk modu kısaltmayı ve cem etmeyi anlar; cem ettiğin namaz yanlışlıkla geç yazılmaz. Kaza namazın varsa sayaç sen kıldıkça azalır ve bitireceğin günü gösterir. İstersen sayacı bir kenara bırakıp sıfırdan başlarsın.

Takip her yerde isteğe bağlıdır. Yalnızca vakitler ve kıble istiyorsan, hiçbir şey senden kayıt istemez.

Namaz arkadaşları (isteğe bağlı)
Başkasının da kıldığını bilmek namaz kılmayı kolaylaştırır. Ailenden ya da arkadaşlarından bir kişiyle veya birkaç kişiyle eşleşebilirsin: eşinle, kardeşinle, annenle ya da babanla, çocuğunla. Bugünün ekranında onun namazını kıldığını görürsün. O da seninkini görür. Amaç birbirinizi yüreklendirmek. Kaçırdığın ya da henüz işaretlemediğin bir namazı asla görmez; akış yok, sıralama yok, puan yok. Sen açana kadar kapalıdır ve ikinizden biri istediği an bitirebilir.

Kıble
Pusula Kâbe'yi kadranında gösterir ve ne tarafa döneceğini söyler: "38° sola dön." Kıbleye döndüğünde de kuşkuya yer bırakmadan onaylar. Yön, bulunduğun yere göre gerçek kuzeyden hesaplanır, yalnız manyetik kuzeyden değil. Telefonu düz tutman gerekmez: nasıl tuttuğunu fark eder ve doğru kalır.

Ana ekranında, kilit ekranında ve bileğinde
Ana ekran widget'larında canlı geri sayım var; namazı doğrudan widget'tan işaretleyebilirsin. Kilit ekranı widget'ları ve StandBy sonraki namazı gösterir: yalnızca vakitler, kaydın sana özel kalır. Canlı Etkinlik, vakti giren namazı kilit ekranında tutar; işaretleme düğmesi üstündedir. Apple Watch uygulamasında günün namazları, tek dokunuşla işaretleme ve kıble var; telefon yanında olmasa da iki haftalık vakti hazır tutar. Kadran komplikasyonları geri sayımı saatinin yüzüne taşır. iPad'de uygulama iki paneli yan yana gösterir.

Sözümüz
Reklam yok, hiçbir zaman. Hesap yok. Analiz yok. Namaz kaydın telefonunda kalır; yaklaşık konumun yalnızca şehrinin adını bulmak için telefonunun kendi harita servisine gider. Bir namaz arkadaşı eklersen, işaretlediğin namazlar bize ait küçük bir aktarıcı üzerinden onun telefonuna gider; aktarıcı her birini telefonu aldığı anda siler ve isim, konum ya da geçmiş tutmaz. Uygulama çökerse kimliksiz bir çökme raporu düzeltmemize yardım eder; bunu Ayarlar'dan kapatabilirsin. Uygulama işine yaradıysa Ayarlar'da isteğe bağlı bir bahşiş kavanozu var.

Açık kaynak
Uygulamanın ve aktarıcının kodu herkese açıktır. Herkes kodu okuyup ne yaptıklarını görebilir ya da uygulamayı kendisi derleyebilir.

Simple Prayer Türkçe, Arapça ve İngilizce destekler.
```

### App Store — Yenilikler (1.4.0)

```
• Namaz arkadaşları. Seçtiğin biriyle eşleş; bugünün ekranında onun namazını kıldığını gör, o da seninkini görsün.
• Kaçırdığın ya da henüz işaretlemediğin bir namazı asla görmez. Geçmiş yok, seri yok, puan yok.
• Sen Ayarlar'dan açana kadar kapalı; ikinizden biri istediği an bitirebilir.
• Kıble ekranı, telefon yüzü aşağı bakarken pusulanın doğru okunamayacağını söyler.
```

Tek paragraf hâli:

```
Namaz arkadaşları: seçtiğin biriyle — eşinle, kardeşinle, bir arkadaşınla — eşleş ve bugünün ekranında onun namazını kıldığını gör; o da seninkini görsün. Kaçırdığın ya da henüz işaretlemediğin bir namazı asla görmez; geçmiş yok, seri yok, puan yok. Sen Ayarlar'dan açana kadar kapalıdır ve ikinizden biri istediği an bitirebilir. Ayrıca Kıble ekranı artık telefon yüzü aşağı bakarken pusulanın doğru okunamayacağını söylüyor.
```

### App Store — Yenilikler (1.3.1)

```
• Daha hızlı açılıyor ve karşılık veriyor.
• Kaydırma bir namazın üstünde başlayınca titreşim yok.
• Hatırlatmalar artık Odak modunda ve Planlanmış Özet açıkken de geliyor. Ayarlar'dan bu uygulama için kapatılabilir.
• Uygulama günlerce açılmasa da hatırlatmalar sürüyor.
• iPad yan veya ters dururken pusula doğru.
• Apple Watch: kıble, Bugün ekranından tacı bir kez yukarı çevirince açılıyor.
```

Tek paragraf hâli (sahibin isteği, 2026-09-15):

```
Uygulama daha hızlı açılıyor ve dokunuşa hemen karşılık veriyor; bir namazın üstünde başlayan kaydırma artık titreşim vermiyor. Hatırlatmalar artık Odak modunda ve Planlanmış Özet açıkken de geliyor (Ayarlar'dan bu uygulama için kapatılabilir) ve uygulama günlerce açılmasa da sürüyor. iPad yan veya ters dururken pusula doğru. Apple Watch'ta kıble artık Bugün ekranından tacı bir kez yukarı çevirince açılıyor.
```

### App Store — Yenilikler (1.3)

```
• Daha hızlı açılıyor ve karşılık veriyor.
• Kaydırma bir namazın üstünde başlayınca titreşim yok.
• Hatırlatmalar artık Odak modunda ve Planlanmış Özet açıkken de geliyor. Ayarlar'dan bu uygulama için kapatılabilir.
• Uygulama günlerce açılmasa da hatırlatmalar sürüyor.
• iPad yan veya ters dururken pusula doğru.
```

### App Store — Yenilikler (1.1)

```
Simple Prayer artık uygulamanın dışında da yaşıyor:
• Canlı geri sayımlı ana ekran widget'ları — namazı widget'tan işaretle
• Apple Watch uygulaması ve kadran komplikasyonları: günün namazları, tek dokunuşla işaretleme ve bileğinde kıble
• Canlı Etkinlik vakti giren namazı kilit ekranında tutuyor, işaretleme düğmesi üstünde
• Yolculuk modu kısaltmayı ve cem etmeyi anlıyor
• Özel günler kendiliğinden bitebiliyor — dilediğin kadar gün seç
• iPad için çift panelli görünüm
• Pusula artık telefonu nasıl tuttuğuna aldırmıyor
```

### Google Play — başlık, kısa açıklama

```
Namaz Vakitleri, Kıble, Kaza
```
```
Namaz vakitleri, ezan, kıble ve sade takip. Tüm özellikler ücretsiz, reklamsız.
```

### Google Play — açıklama

App Store açıklamasıyla iki bölüm dışında aynı; bu tam sürümü yapıştır:

```
Simple Prayer doğru namaz vakitlerini gösterir, namazlarını takip etmene yardım eder ve kıbleyi bulur. Ücretsizdir; reklam da hesap da yoktur. Namaz arkadaşı eklemezsen namaz kaydın telefonunda kalır.

Namaz vakitleri
Vakitler telefonunda hesaplanır, bu yüzden uygulama internetsiz çalışır. Hesaplama yöntemi ülkene göre kendiliğinden seçilir: Diyanet, ISNA, Ümmü'l-Kurâ, Mısır, Karaçi, Hilal Gözlem Komitesi, Caferî ve diğerleri. İstediğin zaman değiştirebilirsin. Her namazı camine uysun diye dakika dakika ayarlayabilir, ikindi için Hanefî ya da Şâfiî usulünü seçebilir, hicri tarihi düzeltebilirsin.

Hatırlatmalar
Her namazın üç hatırlatması olabilir: vakit girince ezan, vakitten önce bir uyandırma (çoğu kişi sabah namazı için kullanıyor) ve vakit çıkmadan sessiz bir son hatırlatma. Her biri sessiz, sade bir ses ya da ezan olabilir; birkaç okuyuş arasından seçersin. Bildirimin üzerinde "Kıldım" düğmesi var: namaz, uygulamayı açmadan kaydedilir.

Takip
Namazını kıldığında dokun, kaydedilsin. Geçmiş bir namaz bir dokunuş daha ister: kılındı, geç kılındı ya da kaçırıldı. Her şeyi sonradan Geçmiş'te değiştirebilirsin. İstersen günlük seri tutar, günlerini takvimde görür, dürüst istatistiklere bakarsın.

Uygulama seni hiç azarlamaz. Adet ya da lohusalık günlerinde özel günler modunu açarsın: hiçbir şey kaçırıldı yazmaz, hiçbir hatırlatma gelmez. İstersen gün sayısını seçersin, süre bitince mod kendiliğinden kapanır. Yolculuktayken yolculuk modu kısaltmayı ve cem etmeyi anlar; cem ettiğin namaz yanlışlıkla geç yazılmaz. Kaza namazın varsa sayaç sen kıldıkça azalır ve bitireceğin günü gösterir. İstersen sayacı bir kenara bırakıp sıfırdan başlarsın.

Takip her yerde isteğe bağlıdır. Yalnızca vakitler ve kıble istiyorsan, hiçbir şey senden kayıt istemez.

Namaz arkadaşları (isteğe bağlı)
Başkasının da kıldığını bilmek namaz kılmayı kolaylaştırır. Ailenden ya da arkadaşlarından bir kişiyle veya birkaç kişiyle eşleşebilirsin: eşinle, kardeşinle, annenle ya da babanla, çocuğunla. Bugünün ekranında onun namazını kıldığını görürsün. O da seninkini görür. Amaç birbirinizi yüreklendirmek. Kaçırdığın ya da henüz işaretlemediğin bir namazı asla görmez; akış yok, sıralama yok, puan yok. Sen açana kadar kapalıdır ve ikinizden biri istediği an bitirebilir.

Kıble
Pusula Kâbe'yi kadranında gösterir ve ne tarafa döneceğini söyler: "38° sola dön." Kıbleye döndüğünde de kuşkuya yer bırakmadan onaylar. Yön, bulunduğun yere göre gerçek kuzeyden hesaplanır, yalnız manyetik kuzeyden değil. Telefonu düz tutman gerekmez: nasıl tuttuğunu fark eder ve doğru kalır.

Ana ekranında, bildirimlerinde ve bileğinde
Ana ekran widget'larında canlı geri sayım var; namazı doğrudan widget'tan işaretleyebilirsin. İsteğe bağlı kalıcı bildirim, o anki ve sonraki namazı bildirim alanında tutar; "Kıldım" düğmesi üstündedir. Wear OS uygulamasında günün namazları, tek dokunuşla işaretleme ve kıble var; telefon yanında olmasa da iki haftalık vakti hazır tutar. Kadrandan bir kaydırma uzaklıkta bir kart var, her kadran için komplikasyonlar var, bir de kendi kadranımız Manuscript: sonraki namaz ve canlı geri sayım. Telefon uzaktayken ezanı saat kendisi okuyabilir. Tablet ve katlanabilirlerde iki panel yan yana gelir.

Sözümüz
Reklam yok, hiçbir zaman. Hesap yok. Analiz yok. Namaz kaydın telefonunda kalır; yaklaşık konumun yalnızca şehrinin adını bulmak için telefonunun kendi harita servisine gider. Bir namaz arkadaşı eklersen, işaretlediğin namazlar bize ait küçük bir aktarıcı üzerinden onun telefonuna gider; aktarıcı her birini telefonu aldığı anda siler ve isim, konum ya da geçmiş tutmaz. Uygulama çökerse kimliksiz bir çökme raporu düzeltmemize yardım eder; bunu Ayarlar'dan kapatabilirsin. Uygulama işine yaradıysa Ayarlar'da isteğe bağlı bir bahşiş kavanozu var.

Açık kaynak
Uygulamanın ve aktarıcının kodu herkese açıktır. Herkes kodu okuyup ne yaptıklarını görebilir ya da uygulamayı kendisi derleyebilir.

Simple Prayer Türkçe, Arapça ve İngilizce destekler.
```

### Google Play — Yenilikler (1.4.0)

```
• Namaz arkadaşları. Seçtiğin biriyle eşleş; bugünün ekranında onun namazını kıldığını gör, o da seninkini görsün.
• Kaçırdığın ya da henüz işaretlemediğin bir namazı asla görmez. Geçmiş yok, seri yok, puan yok.
• Sen Ayarlar'dan açana kadar kapalı; ikinizden biri istediği an bitirebilir.
• Kıble ekranı, telefon yüzü aşağı bakarken pusulanın doğru okunamayacağını söyler.
```

### Google Play — Yenilikler (1.3.1)

```
• Daha hızlı açılıyor ve karşılık veriyor.
• Kaydırma bir namazın üstünde başlayınca titreşim yok.
• Telefon dik tutulunca pusula doğru.
• Hatırlatmalar zamanında geliyor, sonraki vakit girince kendiliğinden kalkıyor.
• Uygulama günlerce açılmasa da hatırlatmalar sürüyor.
• Wear OS: siyah arka plan, daha okunaklı yazı ve namaz düğmesi hep ilk ekranda.
```

### Google Play — Yenilikler (1.3)

```
• Daha hızlı açılıyor ve karşılık veriyor.
• Kaydırma bir namazın üstünde başlayınca titreşim yok.
• Telefon dik tutulunca pusula doğru.
• Hatırlatmalar zamanında geliyor, sonraki vakit girince kendiliğinden kalkıyor.
• Uygulama günlerce açılmasa da hatırlatmalar sürüyor.
• Wear OS: küçük saatlerde daha okunaklı yazı.
```

### Google Play — Yenilikler (1.1)

```
Simple Prayer artık uygulamanın dışında da yaşıyor:
• Canlı geri sayımlı ana ekran widget'ları — namazı widget'tan işaretle
• Wear OS uygulaması, kart, komplikasyonlar — ve kendi kadranımız Manuscript
• İsteğe bağlı kalıcı bildirimin üstünde artık "Kıldım" düğmesi var
• Yolculuk modu kısaltmayı ve cem etmeyi anlıyor
• Özel günler kendiliğinden bitebiliyor — dilediğin kadar gün seç
• Tabletler ve katlanabilirler için çift panelli görünüm
• Pusula artık telefonu nasıl tuttuğuna aldırmıyor
```

---

## العربية

### App Store — الاسم، العنوان الفرعي، النص الترويجي

```
مواقيت الصلاة، قبلة وقضاء
```
```
أذان، متابعة لطيفة، جمعة
```
```
كل الميزات مجانية. بلا إعلانات، بلا حساب، بلا متتبعات. مواقيت دقيقة، متابعة لطيفة لصلاتك، وقبلة صحيحة — ولا أحد يراقبك.
```

### App Store — الوصف

```
يعرض «مواقيت الصلاة» مواقيت دقيقة، ويعينك على متابعة صلاتك، ويدلّك على القبلة. مجاني، بلا إعلانات وبلا حساب، وسجل صلاتك يبقى على هاتفك ما لم تُضف رفيقًا للصلاة.

المواقيت
تُحسب المواقيت على هاتفك، فيعمل التطبيق دون إنترنت. تُختار طريقة الحساب تلقائيًا حسب بلدك: أم القرى، المصرية، رابطة العالم الإسلامي، كراتشي، لجنة رؤية الهلال، الجعفري وغيرها. ويمكنك تغييرها متى شئت، وضبط كل صلاة بالدقيقة لتوافق مسجدك، واختيار مذهبك في وقت العصر، وتعديل التاريخ الهجري.

التذكيرات
لكل صلاة ثلاثة تذكيرات إن أردتها: الأذان عند دخول الوقت، وتذكير مبكر قبله (يستعمله كثيرون للفجر)، وتنبيه أخير هادئ قبل خروج الوقت. كل تذكير يكون صامتًا أو بصوت بسيط أو بالأذان، مع أكثر من قراءة تختار بينها. وإن ضغطت على الإشعار ضغطة مطوّلة سجّلت الصلاة من مكانك، دون فتح التطبيق.

المتابعة
حين تصلي، انقر على الصلاة فتُسجَّل. الصلاة الماضية تحتاج نقرة أخرى: صُلِّيت، أو صُلِّيت متأخرة، أو فاتت. وكل شيء قابل للتعديل لاحقًا من السجل. هناك تتابع يومي إن أحببته، وتقويم لأيامك، وإحصاءات صادقة.

التطبيق لا يلومك أبدًا. في أيام العذر الشرعي شغّلي وضع العذر: لا يُحتسب شيء فائتًا، ولا يصلك تذكير، وينتهي الوضع من تلقاء نفسه بعد المدة التي تختارينها. وفي السفر، يفهم وضع السفر القصر والجمع، فلا تُسجَّل الصلاة المجموعة متأخرة خطأً. وإن كان عليك فوائت، فعدّاد القضاء يتناقص كلما قضيت صلاة ويريك يوم انتهائك. أو ضع العدد جانبًا وابدأ من جديد.

المتابعة اختيارية في كل مكان. إن أردت المواقيت والقبلة فقط، فلن يطلب منك شيء أن تسجّل صلاة.

رفاق الصلاة (اختياري)
الصلاة أيسر حين تعلم أن غيرك يصلّي أيضًا. يمكنك الارتباط بشخص واحد أو بعدة أشخاص من أهلك وأصدقائك: زوجك، أخاك، أمك أو أباك، ابنك أو ابنتك، صديقًا لك. فترى في شاشة اليوم أنه صلّى، ويرى هو ذلك عنك. والغاية أن يشجّع كلٌّ منكما الآخر، وهذا كل ما يفعله. لا يرى أبدًا صلاة فاتتك ولا صلاة لم تسجّلها بعد، ولا يوجد أي تسلسل أو ترتيب أو نقاط. وهو مغلق حتى تشغّله، ويستطيع أيٌّ منكما إنهاءه في أي وقت.

القبلة
تعرض البوصلة الكعبة على قرصها وتقول لك بوضوح إلى أين تستدير: «استدر 38° إلى اليسار». ثم تؤكد لك بلا لبس أنك صرت مستقبل القبلة. الاتجاه محسوب من الشمال الحقيقي بحسب موقعك، لا من الشمال المغناطيسي وحده. وخلافًا لأكثر تطبيقات الصلاة، لا يلزمك إمساك الهاتف مبسوطًا: يلاحظ التطبيق كيف تمسكه ويبقى ثابتًا ودقيقًا على كل حال.

على شاشتك الرئيسية وشاشة القفل ومعصمك
أدوات الشاشة الرئيسية تحمل عدًّا تنازليًا حيًّا، وتستطيع تسجيل الصلاة من الأداة نفسها. أدوات شاشة القفل ووضع StandBy تعرض الصلاة التالية: المواقيت فقط، وسجلك يبقى خاصًا بك. «النشاط المباشر» يُبقي الصلاة الحاضرة على شاشة القفل وزر التسجيل عليها. تطبيق Apple Watch فيه صلوات اليوم والتسجيل بنقرة والقبلة، ويحفظ مواقيت أسبوعين ليبقى صحيحًا وهاتفك بعيد؛ والمعلومات الحية تضع العدّ التنازلي على واجهة ساعتك. وعلى iPad يستفيد التطبيق من المساحة بواجهة من لوحين.

وعدنا لك
بلا إعلانات أبدًا. بلا حساب. بلا تحليلات. سجل صلاتك يبقى على هاتفك، وموقعك التقريبي لا يذهب إلا إلى خدمة الخرائط في هاتفك نفسه ليعرف اسم مدينتك. وإن أضفت رفيق صلاة، فإن الصلوات التي تسجّلها تصل إلى هاتفه عبر خادم وسيط صغير لنا، يحذف كل إشارة فور وصولها إليه، ولا يحتفظ باسم ولا موقع ولا تاريخ. وإن تعطّل التطبيق، يساعدنا تقرير عطل مجهول الهوية على إصلاحه، ويمكنك إيقافه من الإعدادات. وإن نفعك التطبيق، ففي الإعدادات إكرامية اختيارية.

مفتوح المصدر
شيفرة التطبيق والخادم الوسيط منشورة للجميع. يستطيع أي شخص أن يقرأها ليعرف بنفسه ما يفعلانه، أو أن يبني نسخته من التطبيق بنفسه.

يدعم «مواقيت الصلاة» العربية والتركية والإنجليزية.
```

### App Store — ما الجديد (1.4.0)

```
• رفاق الصلاة. ارتبط بمن تختار، فترى في شاشة اليوم أنه صلّى، ويرى هو ذلك عنك.
• لا يرى أبدًا صلاة فاتتك ولا صلاة لم تسجّلها بعد. بلا تاريخ، بلا تسلسل، بلا نقاط.
• مغلق حتى تشغّله من الإعدادات، ويستطيع أيٌّ منكما إنهاءه في أي وقت.
• وتنبّهك شاشة القبلة حين يكون وجه الهاتف إلى الأسفل، حيث لا تُقرأ البوصلة على وجهها الصحيح.
```

صيغة الفقرة الواحدة:

```
رفاق الصلاة: ارتبط بمن تختار — زوجك، أخاك، صديقًا لك — فترى في شاشة اليوم أنه صلّى، ويرى هو ذلك عنك. لا يرى أبدًا صلاة فاتتك ولا صلاة لم تسجّلها بعد، ولا يوجد تاريخ ولا تسلسل ولا نقاط. وهو مغلق حتى تشغّله من الإعدادات، ويستطيع أيٌّ منكما إنهاءه في أي وقت. كما تنبّهك شاشة القبلة الآن حين يكون وجه الهاتف إلى الأسفل، حيث لا تُقرأ البوصلة على وجهها الصحيح.
```

### App Store — ما الجديد (1.3.1)

```
• يفتح ويستجيب أسرع.
• لا اهتزاز عند بدء التمرير فوق زر الصلاة.
• التذكيرات تصل الآن حتى في وضع التركيز أو مع الملخص المجدول. ويمكن إيقاف ذلك لهذا التطبيق من الإعدادات.
• تستمر التذكيرات حتى لو لم يُفتح التطبيق لأيام.
• البوصلة صحيحة على iPad وهو على جانبه أو مقلوب.
• Apple Watch: القبلة على بُعد لفّة واحدة للتاج إلى الأعلى من شاشة اليوم.
```

صيغة الفقرة الواحدة (طلب المالك، 2026-09-15):

```
يفتح التطبيق أسرع ويستجيب للمسة فورًا، ولم يعد التمرير الذي يبدأ فوق زر الصلاة يهتز. تصل التذكيرات الآن حتى في وضع التركيز أو مع الملخص المجدول (ويمكن إيقاف ذلك لهذا التطبيق من الإعدادات)، وتستمر حتى لو لم يُفتح التطبيق لأيام. البوصلة صحيحة على iPad وهو على جانبه أو مقلوب. وعلى Apple Watch صارت القبلة على بُعد لفّة واحدة للتاج إلى الأعلى من شاشة اليوم.
```

### App Store — ما الجديد (1.3)

```
• يفتح ويستجيب أسرع.
• لا اهتزاز عند بدء التمرير فوق زر الصلاة.
• التذكيرات تصل الآن حتى في وضع التركيز أو مع الملخص المجدول. ويمكن إيقاف ذلك لهذا التطبيق من الإعدادات.
• تستمر التذكيرات حتى لو لم يُفتح التطبيق لأيام.
• البوصلة صحيحة على iPad وهو على جانبه أو مقلوب.
```

### App Store — ما الجديد (1.1)

```
صار «مواقيت الصلاة» يعيش خارج التطبيق أيضًا:
• أدوات للشاشة الرئيسية بعدّ تنازلي حي — سجّل الصلاة من الأداة نفسها
• تطبيق Apple Watch ومعلومات حية للواجهة: صلوات اليوم، تسجيل بنقرة، والقبلة على معصمك
• «النشاط المباشر» يُبقي الصلاة الحاضرة على شاشة القفل، وزر التسجيل عليها
• وضع السفر يفهم القصر والجمع
• أيام العذر تنتهي من تلقاء نفسها — حدديها بالمدة التي تشائين
• واجهة من لوحين للـ iPad
• البوصلة لم تعد تبالي كيف تمسك هاتفك
```

### Google Play — العنوان، الوصف المختصر

```
مواقيت الصلاة، قبلة وقضاء
```
```
مواقيت الصلاة والأذان والقبلة ومتابعة لطيفة. كل الميزات مجانية وبلا إعلانات.
```

### Google Play — الوصف

مطابق لوصف App Store عدا قسمين؛ الصق هذه النسخة الكاملة:

```
يعرض «مواقيت الصلاة» مواقيت دقيقة، ويعينك على متابعة صلاتك، ويدلّك على القبلة. مجاني، بلا إعلانات وبلا حساب، وسجل صلاتك يبقى على هاتفك ما لم تُضف رفيقًا للصلاة.

المواقيت
تُحسب المواقيت على هاتفك، فيعمل التطبيق دون إنترنت. تُختار طريقة الحساب تلقائيًا حسب بلدك: أم القرى، المصرية، رابطة العالم الإسلامي، كراتشي، لجنة رؤية الهلال، الجعفري وغيرها. ويمكنك تغييرها متى شئت، وضبط كل صلاة بالدقيقة لتوافق مسجدك، واختيار مذهبك في وقت العصر، وتعديل التاريخ الهجري.

التذكيرات
لكل صلاة ثلاثة تذكيرات إن أردتها: الأذان عند دخول الوقت، وتذكير مبكر قبله (يستعمله كثيرون للفجر)، وتنبيه أخير هادئ قبل خروج الوقت. كل تذكير يكون صامتًا أو بصوت بسيط أو بالأذان، مع أكثر من قراءة تختار بينها. وعلى الإشعار نفسه زر «صَلَّيْتُ»، فتُسجَّل الصلاة دون فتح التطبيق.

المتابعة
حين تصلي، انقر على الصلاة فتُسجَّل. الصلاة الماضية تحتاج نقرة أخرى: صُلِّيت، أو صُلِّيت متأخرة، أو فاتت. وكل شيء قابل للتعديل لاحقًا من السجل. هناك تتابع يومي إن أحببته، وتقويم لأيامك، وإحصاءات صادقة.

التطبيق لا يلومك أبدًا. في أيام العذر الشرعي شغّلي وضع العذر: لا يُحتسب شيء فائتًا، ولا يصلك تذكير، وينتهي الوضع من تلقاء نفسه بعد المدة التي تختارينها. وفي السفر، يفهم وضع السفر القصر والجمع، فلا تُسجَّل الصلاة المجموعة متأخرة خطأً. وإن كان عليك فوائت، فعدّاد القضاء يتناقص كلما قضيت صلاة ويريك يوم انتهائك. أو ضع العدد جانبًا وابدأ من جديد.

المتابعة اختيارية في كل مكان. إن أردت المواقيت والقبلة فقط، فلن يطلب منك شيء أن تسجّل صلاة.

رفاق الصلاة (اختياري)
الصلاة أيسر حين تعلم أن غيرك يصلّي أيضًا. يمكنك الارتباط بشخص واحد أو بعدة أشخاص من أهلك وأصدقائك: زوجك، أخاك، أمك أو أباك، ابنك أو ابنتك، صديقًا لك. فترى في شاشة اليوم أنه صلّى، ويرى هو ذلك عنك. والغاية أن يشجّع كلٌّ منكما الآخر، وهذا كل ما يفعله. لا يرى أبدًا صلاة فاتتك ولا صلاة لم تسجّلها بعد، ولا يوجد أي تسلسل أو ترتيب أو نقاط. وهو مغلق حتى تشغّله، ويستطيع أيٌّ منكما إنهاءه في أي وقت.

القبلة
تعرض البوصلة الكعبة على قرصها وتقول لك بوضوح إلى أين تستدير: «استدر 38° إلى اليسار». ثم تؤكد لك بلا لبس أنك صرت مستقبل القبلة. الاتجاه محسوب من الشمال الحقيقي بحسب موقعك، لا من الشمال المغناطيسي وحده. وخلافًا لأكثر تطبيقات الصلاة، لا يلزمك إمساك الهاتف مبسوطًا: يلاحظ التطبيق كيف تمسكه ويبقى ثابتًا ودقيقًا على كل حال.

على شاشتك الرئيسية وفي إشعاراتك وعلى معصمك
تطبيقات الشاشة الرئيسية المصغّرة تحمل عدًّا تنازليًا حيًّا، وتستطيع تسجيل الصلاة من الأداة نفسها. إشعار دائم اختياري يُبقي الصلاة الحاضرة والتالية أمامك، وزر «صَلَّيْتُ» عليه. تطبيق Wear OS فيه صلوات اليوم والتسجيل بنقرة والقبلة، ويحفظ مواقيت أسبوعين ليبقى صحيحًا وهاتفك بعيد؛ وهناك بطاقة على بُعد سحبة من واجهة الساعة، ومعلومات حية لأي واجهة، وواجهة ساعة من صنعنا اسمها «مخطوطة» تعرض الصلاة التالية بعدّ تنازلي حي. وحين يبعد هاتفك ترفع الساعة الأذان بنفسها، ولا تكرره أبدًا والهاتف قريب. وعلى الأجهزة اللوحية والقابلة للطي يستفيد التطبيق من المساحة بواجهة من لوحين.

وعدنا لك
بلا إعلانات أبدًا. بلا حساب. بلا تحليلات. سجل صلاتك يبقى على هاتفك، وموقعك التقريبي لا يذهب إلا إلى خدمة الخرائط في هاتفك نفسه ليعرف اسم مدينتك. وإن أضفت رفيق صلاة، فإن الصلوات التي تسجّلها تصل إلى هاتفه عبر خادم وسيط صغير لنا، يحذف كل إشارة فور وصولها إليه، ولا يحتفظ باسم ولا موقع ولا تاريخ. وإن تعطّل التطبيق، يساعدنا تقرير عطل مجهول الهوية على إصلاحه، ويمكنك إيقافه من الإعدادات. وإن نفعك التطبيق، ففي الإعدادات إكرامية اختيارية.

مفتوح المصدر
شيفرة التطبيق والخادم الوسيط منشورة للجميع. يستطيع أي شخص أن يقرأها ليعرف بنفسه ما يفعلانه، أو أن يبني نسخته من التطبيق بنفسه.

يدعم «مواقيت الصلاة» العربية والتركية والإنجليزية.
```

### Google Play — ما الجديد (1.4.0)

```
• رفاق الصلاة. ارتبط بمن تختار، فترى في شاشة اليوم أنه صلّى، ويرى هو ذلك عنك.
• لا يرى أبدًا صلاة فاتتك ولا صلاة لم تسجّلها بعد. بلا تاريخ، بلا تسلسل، بلا نقاط.
• مغلق حتى تشغّله من الإعدادات، ويستطيع أيٌّ منكما إنهاءه في أي وقت.
• وتنبّهك شاشة القبلة حين يكون وجه الهاتف إلى الأسفل، حيث لا تُقرأ البوصلة على وجهها الصحيح.
```

### Google Play — ما الجديد (1.3.1)

```
• يفتح ويستجيب أسرع.
• لا اهتزاز عند بدء التمرير فوق زر الصلاة.
• البوصلة صحيحة والهاتف مرفوع.
• التذكيرات تصل في وقتها وتختفي مع دخول وقت الصلاة التالية.
• تستمر التذكيرات حتى لو لم يُفتح التطبيق لأيام.
• Wear OS: خلفية سوداء ونص أوضح، وزر الصلاة دائمًا في الشاشة الأولى.
```

### Google Play — ما الجديد (1.3)

```
• يفتح ويستجيب أسرع.
• لا اهتزاز عند بدء التمرير فوق زر الصلاة.
• البوصلة صحيحة والهاتف مرفوع.
• التذكيرات تصل في وقتها وتختفي مع دخول وقت الصلاة التالية.
• تستمر التذكيرات حتى لو لم يُفتح التطبيق لأيام.
• Wear OS: نص أوضح على الساعات الصغيرة.
```

### Google Play — ما الجديد (1.1)

```
صار «مواقيت الصلاة» يعيش خارج التطبيق أيضًا:
• تطبيقات مصغّرة للشاشة الرئيسية بعدّ تنازلي حي — سجّل الصلاة من الأداة نفسها
• تطبيق Wear OS وبطاقة ومعلومات حية — وواجهة ساعة من صنعنا اسمها «مخطوطة»
• الإشعار الدائم الاختياري صار يحمل زر «صَلَّيْتُ»
• وضع السفر يفهم القصر والجمع
• أيام العذر تنتهي من تلقاء نفسها — حدديها بالمدة التي تشائين
• واجهة من لوحين للأجهزة اللوحية والقابلة للطي
• البوصلة لم تعد تبالي كيف تمسك هاتفك
```

---

## Google Play — the Manuscript watch face (`app.simpleprayer.face`)

### Title, short descriptions

```
Manuscript · Simple Prayer
```
```
A calm watch face with prayer times: the next prayer, a live countdown, Hijri date.
```
```
Sade bir kadran: sonraki namaz, canlı geri sayım ve hicri tarih.
```
```
واجهة ساعة هادئة: الصلاة التالية، عدّ تنازلي حي، والتاريخ الهجري.
```

### Full description (en)

```
Manuscript is a watch face for people who pray. It shows the time, the Hijri date, the next prayer with a live countdown, and a quiet ring that fills as the prayer's time passes.

It is calm on purpose: warm dark paper, a serif clock, and nothing that flashes or nags. The always-on display keeps just the time and the next prayer.

The prayer data comes from the free Simple Prayer app for Wear OS. Without it, Manuscript still works as a clean watch face — install Simple Prayer on your watch to fill the complications.

No ads. No account. Free.
```
