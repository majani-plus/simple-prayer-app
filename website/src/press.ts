/**
 * The press kit's words and facts, in one place, in all three languages. `/press`, `/ar/press` and
 * `/tr/press` render them, and `scripts/build-press-kit.ts` writes the same text into each
 * language's downloadable fact sheet, so a page and its file can never disagree.
 *
 * Every line here is a claim a writer may copy word for word into an article. So each one must be
 * true of the shipped app today (docs/PRIVACY_POLICY.md, README.md), and each follows docs/TONE.md:
 * no superlatives, no comparisons, and "Every feature is free". Arabic and Turkish are written for
 * their readers, reusing the site's own authored words for the app's features (D204).
 */
import { site } from './config';
import type { Locale } from './i18n';

/** The person who makes the app (site.author). */
export const developer = site.author;

export interface PressCopy {
  title: string;
  description: string;
  eyebrow: string;
  h1: string;
  lead: string;
  downloadAll: string;
  factSheet: string;
  /** `{email}` is replaced by the contact address. */
  questions: string;
  describeH2: string;
  describeCaption: string;
  oneLineLabel: string;
  shortLabel: string;
  longLabel: string;
  oneLine: string;
  short: string;
  long: string[];
  factsH2: string;
  /** [label, value, optional link for the value] */
  facts: [string, string, string?][];
  highlightsH2: string;
  highlights: string[];
  /** Around the link to /blog: [before, link text, after]. */
  articles: [string, string, string];
  screenshotsH2: string;
  screenshotsText: string;
  /** Alt text per store screen, keyed by its name (today, watch, history, …). */
  shotAlt: Record<string, string>;
  logoH2: string;
  logosLabel: string;
  iconLabel: string;
  logoRules: string[];
  /** The last rule ends with a link to TRADEMARKS.md: [before, link text, after]. */
  trademarkRule: [string, string, string];
  wrongH2: string;
  /** `{x}` is replaced by the wrong claim. */
  wrongFormat: string;
  accuracy: [string, string][];
  linksH2: string;
  links: [string, string][];
  /** Headings used only in the plain-text fact sheet. */
  sheet: { title: string; contact: string; more: string };
}

const storeLinks = (web: string, src: string, relay: string, privacy: string, articles: string): [string, string][] => [
  [web, 'https://simpleprayer.app'],
  ['App Store', site.appStoreUrl ?? ''],
  ['Google Play', site.playStoreUrl ?? ''],
  [src, site.sourceUrl],
  [relay, site.relayUrl],
  [privacy, 'https://simpleprayer.app/privacy'],
  [articles, 'https://simpleprayer.app/blog'],
];

export const pressCopy: Record<Locale, PressCopy> = {
  en: {
    title: 'Press kit — Simple Prayer',
    description:
      'Facts, descriptions, logos and screenshots of Simple Prayer, free to use in articles, reviews and lists about the app.',
    eyebrow: 'Press kit',
    h1: 'Writing about Simple Prayer?',
    lead: 'Here is everything you need: short and long descriptions, the facts, logos and screenshots in three languages. You may use all of it in articles, reviews and lists about the app.',
    downloadAll: 'Everything in English (zip)',
    factSheet: 'Fact sheet (text)',
    questions: 'Questions, or need something that is not here? Write to {email}.',
    describeH2: 'Describing the app',
    describeCaption: 'Copy any of these as they are.',
    oneLineLabel: 'In one sentence',
    shortLabel: 'In a paragraph',
    longLabel: 'In more detail',
    oneLine:
      'Simple Prayer is a free prayer-times and prayer-tracking app for iPhone and Android, with no ads and no account.',
    short:
      'Simple Prayer shows the five daily prayer times, points to the qibla, and lets you mark each prayer with one tap. It works without internet. Every feature is free, there are no ads and no account, and the whole app is open source. It is in English, Arabic and Turkish.',
    long: [
      'Simple Prayer shows the five daily prayer times with a countdown to the next one, points to the qibla, and lets you mark each prayer as prayed with one tap. You can mark a prayer from the app, a home-screen widget, a notification or a watch.',
      'The times are worked out on the phone, so they work without internet. The app picks the method used in your country, such as Diyanet, ISNA, Umm al-Qura or the Egyptian authority, and you can change it. Prayer tracking is gentle: a missed day is never shown as a failure, and someone who only wants the times and the qibla never has to log anything.',
      'Every feature is free. There are no ads, no account and no analytics, and your prayer log stays on your phone. The app is in English, Arabic and Turkish, each written by a person. It is made by Ronny Majani and owned by Majani Plus, his company in New Cairo, Egypt. Its full source code is public under the MIT licence.',
    ],
    factsH2: 'Facts',
    facts: [
      ['Name', 'Simple Prayer'],
      ['Name in the stores', 'Simple Prayer: Times & Qibla'],
      ['Made by', 'Ronny Majani', 'https://ronnymajani.com'],
      ['Owned by', 'Majani Plus LLC, his company in New Cairo, Egypt'],
      ['Price', 'Free. Every feature is free. An optional tip in Settings unlocks nothing.'],
      ['Ads, account, analytics', 'None'],
      ['Platforms', 'iPhone, iPad and Apple Watch; Android phones and tablets, and Wear OS'],
      ['Languages', 'English, Arabic (right to left) and Turkish'],
      ['Prayer-time methods', 'Diyanet, ISNA, Umm al-Qura, Egyptian, Karachi, Muslim World League and more; Hanafi or Shafi Asr'],
      ['Works offline', 'Yes. Times are worked out on the phone.'],
      ['Licence', 'MIT (the code). The name and the mosque icon are not covered by the licence.'],
      ['Current version', '1.6.0, 7 November 2026'],
      ['Open source since', '8 November 2026'],
    ],
    highlightsH2: 'What stands out',
    highlights: [
      'One tap marks a prayer as prayed, from the app, a widget, a notification or the watch.',
      'Up to three reminders for each prayer, each one silent, a tone or the adhan.',
      'A qibla compass that works without holding the phone flat.',
      'Prayer times that still work above the Arctic Circle, where the sun may not set or rise for weeks.',
      'Prayer buddies: two people who both turn it on can see that the other prayed today. Nothing else is shared with them.',
      'While building it, we found defects in adhan-js, the open-source prayer-time library many Muslim apps use, and sent fixes back. They are now in the library.',
    ],
    articles: [
      'The ',
      'articles',
      ' cover the technical side: the fixes sent to adhan-js, prayer times above the Arctic Circle, widgets and watches from one Expo app, and the buddy relay.',
    ],
    screenshotsH2: 'Screenshots',
    screenshotsText:
      'The store images with their captions, and the app itself with no captions, in the light and dark themes. Full size, one zip for each language:',
    shotAlt: {
      today: 'Today: the five prayers, the next one and a countdown.',
      watch: 'The Apple Watch app.',
      history: 'History: a calendar of the month.',
      qibla: 'The qibla compass.',
      reminders: 'Reminders for each prayer.',
      qada: 'Prayers to make up, counted down.',
      pledge: 'The promise: no ads, no account, every feature free.',
    },
    logoH2: 'Logo and icon',
    logosLabel: 'Logos and app icon (zip)',
    iconLabel: 'App icon, 1024 × 1024 (PNG)',
    logoRules: [
      'Use the files as they are. Please do not redraw, recolour, stretch or add effects to the mark.',
      'Gold on light backgrounds, cream on dark or gold ones.',
      'Write the name as two words, Simple Prayer, with capitals on both.',
    ],
    trademarkRule: [
      'The name and the mosque mark belong to Majani Plus and are not covered by the code’s MIT licence. You may use them to write about the app (',
      'trademarks',
      ').',
    ],
    wrongH2: 'Easy to get wrong',
    wrongFormat: 'Not “{x}”',
    accuracy: [
      ['It is a non-profit', 'Majani Plus is a company, and Simple Prayer is its community project: free, with no ads and no paid features.'],
      ['Nothing ever leaves your phone', 'The prayer log stays on the phone. Five small things do go over the internet, each listed in the privacy policy: the city lookup, update checks, crash reports (on by default, can be switched off), a tip if you leave one, and prayer buddies if you turn them on.'],
      ['Buddy mode is end-to-end encrypted', 'It is not. The relay keeps random IDs and one flag (which prayer, prayed or not) for at most 24 hours, with no names.'],
    ],
    linksH2: 'Links',
    links: storeLinks('Website', 'Source code', 'Buddy relay source', 'Privacy policy', 'Articles'),
    sheet: { title: 'SIMPLE PRAYER: FACT SHEET', contact: 'Contact', more: 'More' },
  },

  ar: {
    title: 'للصحافة — Simple Prayer',
    description:
      'حقائق وأوصاف وشعارات ولقطات شاشة لتطبيق Simple Prayer، يمكنك استخدامها بحرية في المقالات والمراجعات والقوائم التي تتحدث عن التطبيق.',
    eyebrow: 'للصحافة',
    h1: 'تكتب عن Simple Prayer؟',
    lead: 'هنا كل ما تحتاج إليه: أوصاف قصيرة وطويلة، والحقائق، والشعارات، ولقطات الشاشة بثلاث لغات. يمكنك استخدام هذا كله في المقالات والمراجعات والقوائم التي تتحدث عن التطبيق.',
    downloadAll: 'كل شيء بالعربية (zip)',
    factSheet: 'ورقة الحقائق (نص)',
    questions: 'عندك سؤال، أو تحتاج شيئًا غير موجود هنا؟ اكتب إلى {email}.',
    describeH2: 'كيف تصف التطبيق',
    describeCaption: 'انسخ أيًّا منها كما هو.',
    oneLineLabel: 'في جملة واحدة',
    shortLabel: 'في فقرة',
    longLabel: 'بتفصيل أكثر',
    oneLine: 'Simple Prayer تطبيق مجاني لمواقيت الصلاة ومتابعتها على آيفون وأندرويد، بلا إعلانات وبلا حساب.',
    short:
      'يعرض Simple Prayer مواقيت الصلوات الخمس، ويدلّك على القبلة، ويتيح لك تسجيل كل صلاة بنقرة واحدة. يعمل دون إنترنت. كل الميزات مجانية، بلا إعلانات ولا حساب، وشيفرة التطبيق كلها مفتوحة المصدر. وهو متوفر بالعربية والإنجليزية والتركية.',
    long: [
      'يعرض Simple Prayer مواقيت الصلوات الخمس مع عدّ تنازلي للصلاة القادمة، ويدلّك على القبلة، ويتيح لك تسجيل كل صلاة بنقرة واحدة. ويمكنك تسجيل الصلاة من التطبيق، أو من أداة على الشاشة الرئيسية، أو من إشعار، أو من الساعة.',
      'تُحسب المواقيت على الهاتف نفسه، فتعمل دون إنترنت. يختار التطبيق طريقة الحساب المتّبعة في بلدك، مثل ديانت أو الجمعية الإسلامية لأمريكا الشمالية أو أم القرى أو الهيئة المصرية، ويمكنك تغييرها. والمتابعة لطيفة: لا يُعرض يوم فاتك على أنه إخفاق، ومن لا يريد إلا المواقيت والقبلة لا يُطلب منه تسجيل شيء.',
      'كل الميزات مجانية. لا إعلانات ولا حساب ولا تحليلات، وسجلّ صلاتك يبقى على هاتفك. التطبيق بالعربية والإنجليزية والتركية، وكل لغة كتبها إنسان. صنعه روني مجني، وتملكه مجني بلس، شركته في القاهرة الجديدة بمصر. وشيفرته كاملة منشورة للجميع بترخيص MIT.',
    ],
    factsH2: 'الحقائق',
    facts: [
      ['الاسم', 'Simple Prayer'],
      ['الاسم في المتاجر', 'Simple Prayer: Times & Qibla'],
      ['من صنعه', 'روني مجني (Ronny Majani)', 'https://ronnymajani.com'],
      ['المالك', 'مجني بلس (Majani Plus LLC)، شركته في القاهرة الجديدة بمصر'],
      ['السعر', 'مجاني. كل الميزات مجانية. وفي الإعدادات إكرامية اختيارية لا تفتح أي شيء.'],
      ['إعلانات، حساب، تحليلات', 'لا شيء منها'],
      ['الأجهزة', 'آيفون وآيباد وApple Watch؛ وهواتف Android وأجهزته اللوحية، وWear OS'],
      ['اللغات', 'العربية (من اليمين إلى اليسار) والإنجليزية والتركية'],
      ['طرق حساب المواقيت', 'ديانت، والجمعية الإسلامية لأمريكا الشمالية، وأم القرى، والهيئة المصرية، وكراتشي، ورابطة العالم الإسلامي، وغيرها؛ وعصر الحنفية أو الشافعية'],
      ['يعمل دون إنترنت', 'نعم. المواقيت تُحسب على الهاتف.'],
      ['الترخيص', 'MIT للشيفرة. الاسم وشعار المسجد لا يشملهما الترخيص.'],
      ['الإصدار الحالي', '1.6.0، بتاريخ 7 نوفمبر 2026'],
      ['مفتوح المصدر منذ', '8 نوفمبر 2026'],
    ],
    highlightsH2: 'ما يميّزه',
    highlights: [
      'نقرة واحدة تسجّل الصلاة، من التطبيق أو الأداة أو الإشعار أو الساعة.',
      'حتى ثلاثة تذكيرات لكل صلاة، وكل منها صامت أو بصوت بسيط أو بالأذان.',
      'بوصلة قبلة لا تحتاج إلى إمساك الهاتف مبسوطًا.',
      'مواقيت تبقى صالحة فوق الدائرة القطبية الشمالية، حيث قد لا تغيب الشمس أو لا تشرق أسابيع.',
      'رفاق الصلاة: إذا شغّله شخصان، يرى كلٌّ منهما أن الآخر صلّى اليوم، ولا يُشارَك معه شيء غير ذلك.',
      'أثناء بناء التطبيق وجدنا أخطاء في adhan-js، وهي مكتبة مفتوحة المصدر لحساب المواقيت تستخدمها تطبيقات إسلامية كثيرة، فأرسلنا إليها إصلاحاتها. وهي الآن جزء من المكتبة.',
    ],
    articles: [
      'وتشرح ',
      'المقالات',
      ' (بالإنجليزية) الجانب التقني: الإصلاحات المرسلة إلى adhan-js، والمواقيت فوق الدائرة القطبية، والأدوات والساعات من تطبيق Expo واحد، وخادم رفاق الصلاة.',
    ],
    screenshotsH2: 'لقطات الشاشة',
    screenshotsText:
      'صور المتاجر مع تعليقاتها، والتطبيق نفسه دون تعليقات، بالمظهر الفاتح والداكن. بالحجم الكامل، وملف zip لكل لغة:',
    shotAlt: {
      today: 'اليوم: الصلوات الخمس، والصلاة القادمة، وعدّ تنازلي.',
      watch: 'تطبيق Apple Watch.',
      history: 'السجل: تقويم الشهر.',
      qibla: 'بوصلة القبلة.',
      reminders: 'التذكيرات لكل صلاة.',
      qada: 'الفوائت، وعدّادها ينقص.',
      pledge: 'وعدنا: بلا إعلانات، بلا حساب، كل الميزات مجانية.',
    },
    logoH2: 'الشعار والأيقونة',
    logosLabel: 'الشعارات وأيقونة التطبيق (zip)',
    iconLabel: 'أيقونة التطبيق، 1024 × 1024 (PNG)',
    logoRules: [
      'استخدم الملفات كما هي. من فضلك لا تُعِد رسم الشعار، ولا تغيّر لونه، ولا تمطّه، ولا تضف إليه مؤثرات.',
      'الذهبي على الخلفيات الفاتحة، والكريمي على الداكنة أو الذهبية.',
      'اكتب الاسم كما هو بالحروف اللاتينية: Simple Prayer، كلمتين، وأول كل منهما حرف كبير.',
    ],
    trademarkRule: [
      'الاسم وشعار المسجد ملك لمجني بلس، ولا يشملهما ترخيص MIT الخاص بالشيفرة. ويمكنك استخدامهما للكتابة عن التطبيق (',
      'العلامات التجارية، بالإنجليزية',
      ').',
    ],
    wrongH2: 'أخطاء شائعة',
    wrongFormat: 'ليس صحيحًا: «{x}»',
    accuracy: [
      ['إنه منظمة غير ربحية', 'مجني بلس شركة، وSimple Prayer مشروعها المجتمعي: مجاني، بلا إعلانات وبلا ميزات مدفوعة.'],
      ['لا شيء يغادر هاتفك أبدًا', 'سجلّ الصلاة يبقى على الهاتف. وخمسة أشياء صغيرة تمر عبر الإنترنت، وكلها مذكورة في سياسة الخصوصية: البحث عن المدينة، والتحقق من التحديثات، وتقارير الأعطال (مفعّلة افتراضيًا ويمكن إيقافها)، والإكرامية إن تركتها، ورفاق الصلاة إن شغّلته.'],
      ['رفاق الصلاة مشفّر من طرف إلى طرف', 'ليس كذلك. يحتفظ الخادم بمعرّفات عشوائية وعلامة واحدة (أي صلاة، صُلّيت أم لا) لمدة 24 ساعة على الأكثر، دون أي أسماء.'],
    ],
    linksH2: 'روابط',
    links: storeLinks('الموقع', 'الشيفرة المصدرية', 'شيفرة خادم رفاق الصلاة', 'سياسة الخصوصية (بالإنجليزية)', 'المقالات (بالإنجليزية)'),
    sheet: { title: 'Simple Prayer: ورقة الحقائق', contact: 'للتواصل', more: 'المزيد' },
  },

  tr: {
    title: 'Basın kiti — Simple Prayer',
    description:
      'Simple Prayer hakkında bilgiler, tanıtım metinleri, logolar ve ekran görüntüleri. Uygulama hakkındaki yazılarda, incelemelerde ve listelerde serbestçe kullanabilirsiniz.',
    eyebrow: 'Basın kiti',
    h1: 'Simple Prayer hakkında mı yazıyorsunuz?',
    lead: 'İhtiyacınız olan her şey burada: kısa ve uzun tanıtım metinleri, temel bilgiler, logolar ve üç dilde ekran görüntüleri. Hepsini uygulama hakkındaki yazılarda, incelemelerde ve listelerde kullanabilirsiniz.',
    downloadAll: 'Türkçe her şey (zip)',
    factSheet: 'Bilgi notu (metin)',
    questions: 'Sorunuz mu var, ya da burada olmayan bir şeye mi ihtiyacınız var? {email} adresine yazın.',
    describeH2: 'Uygulamayı anlatmak için',
    describeCaption: 'Bunlardan birini olduğu gibi kopyalayabilirsiniz.',
    oneLineLabel: 'Tek cümlede',
    shortLabel: 'Bir paragrafta',
    longLabel: 'Daha ayrıntılı',
    oneLine:
      'Simple Prayer, iPhone ve Android için ücretsiz bir namaz vakitleri ve namaz takibi uygulamasıdır. Reklam yok, hesap yok.',
    short:
      'Simple Prayer günün beş vaktini gösterir, kıbleyi bulur ve her namazı tek dokunuşla işaretlemenizi sağlar. İnternetsiz çalışır. Bütün özellikler ücretsizdir; reklam yok, hesap yok ve uygulamanın tamamı açık kaynaktır. Türkçe, Arapça ve İngilizce kullanılabilir.',
    long: [
      'Simple Prayer günün beş vaktini sıradaki vakte geri sayımla gösterir, kıbleyi bulur ve her namazı tek dokunuşla kılındı olarak işaretlemenizi sağlar. Namazı uygulamadan, ana ekrandaki bir widget’tan, bir bildirimden ya da saatten işaretleyebilirsiniz.',
      'Vakitler telefonda hesaplanır, bu yüzden internetsiz çalışır. Uygulama ülkenizde kullanılan yöntemi seçer: Diyanet, ISNA, Ümmü’l-Kurâ ya da Mısır gibi. İsterseniz değiştirebilirsiniz. Namaz takibi naziktir: kaçırılan bir gün asla başarısızlık olarak gösterilmez. Yalnızca vakitleri ve kıbleyi isteyen biri hiçbir şey işaretlemek zorunda kalmaz.',
      'Bütün özellikler ücretsizdir. Reklam yok, hesap yok, analiz yok; namaz kaydınız telefonunuzda kalır. Uygulama Türkçe, Arapça ve İngilizcedir ve her dil bir insan tarafından yazıldı. Uygulamayı Ronny Majani yaptı; sahibi, onun Mısır’ın Yeni Kahire şehrindeki şirketi Majani Plus’tır. Kaynak kodunun tamamı MIT lisansıyla herkese açıktır.',
    ],
    factsH2: 'Temel bilgiler',
    facts: [
      ['Adı', 'Simple Prayer'],
      ['Mağazalardaki adı', 'Simple Prayer: Times & Qibla'],
      ['Yapan', 'Ronny Majani', 'https://ronnymajani.com'],
      ['Sahibi', 'Majani Plus LLC, onun Yeni Kahire’deki (Mısır) şirketi'],
      ['Fiyat', 'Ücretsiz. Bütün özellikler ücretsiz. Ayarlar’daki isteğe bağlı bahşiş hiçbir şeyin kilidini açmaz.'],
      ['Reklam, hesap, analiz', 'Hiçbiri yok'],
      ['Cihazlar', 'iPhone, iPad ve Apple Watch; Android telefon ve tabletler; Wear OS'],
      ['Diller', 'Türkçe, Arapça (sağdan sola) ve İngilizce'],
      ['Hesaplama yöntemleri', 'Diyanet, ISNA, Ümmü’l-Kurâ, Mısır, Karaçi, Muslim World League ve daha fazlası; ikindi için Hanefî ya da Şâfiî'],
      ['İnternetsiz çalışır', 'Evet. Vakitler telefonda hesaplanır.'],
      ['Lisans', 'Kod için MIT. Ad ve cami işareti lisansa dahil değildir.'],
      ['Güncel sürüm', '1.6.0, 7 Kasım 2026'],
      ['Açık kaynak olduğu tarih', '8 Kasım 2026'],
    ],
    highlightsH2: 'Öne çıkanlar',
    highlights: [
      'Tek dokunuş bir namazı kılındı olarak işaretler: uygulamadan, widget’tan, bildirimden ya da saatten.',
      'Her namaz için en fazla üç hatırlatma; her biri sessiz, sade bir ses ya da ezan olabilir.',
      'Telefonu düz tutmanızı istemeyen bir kıble pusulası.',
      'Güneşin haftalarca batmadığı ya da doğmadığı Kuzey Kutup Dairesi’nin ötesinde de çalışan vakitler.',
      'Namaz arkadaşları: ikisi de açan iki kişi, diğerinin bugün namazını kıldığını görür. Başka hiçbir şey paylaşılmaz.',
      'Uygulamayı yaparken, pek çok İslami uygulamanın kullandığı açık kaynak vakit kütüphanesi adhan-js’te hatalar bulduk ve düzeltmelerini kütüphaneye gönderdik. Bu düzeltmeler artık kütüphanede.',
    ],
    articles: [
      '',
      'Yazılar',
      ' (İngilizce) teknik tarafı anlatıyor: adhan-js’e gönderilen düzeltmeler, kutup bölgelerinde namaz vakitleri, tek bir Expo uygulamasından widget’lar ve saatler, ve namaz arkadaşları sunucusu.',
    ],
    screenshotsH2: 'Ekran görüntüleri',
    screenshotsText:
      'Mağaza görselleri açıklamalarıyla, uygulamanın kendisi ise açıklamasız; açık ve koyu temada. Tam boyutta, her dil için bir zip:',
    shotAlt: {
      today: 'Bugün: beş vakit, sıradaki vakit ve geri sayım.',
      watch: 'Apple Watch uygulaması.',
      history: 'Geçmiş: ayın takvimi.',
      qibla: 'Kıble pusulası.',
      reminders: 'Her namaz için hatırlatmalar.',
      qada: 'Kaza namazları, azalan sayaçla.',
      pledge: 'Sözümüz: reklam yok, hesap yok, bütün özellikler ücretsiz.',
    },
    logoH2: 'Logo ve simge',
    logosLabel: 'Logolar ve uygulama simgesi (zip)',
    iconLabel: 'Uygulama simgesi, 1024 × 1024 (PNG)',
    logoRules: [
      'Dosyaları olduğu gibi kullanın. Lütfen işareti yeniden çizmeyin, rengini değiştirmeyin, germeyin, efekt eklemeyin.',
      'Açık zeminlerde altın rengi, koyu ya da altın zeminlerde krem.',
      'Adı iki kelime olarak ve ikisi de büyük harfle başlayarak yazın: Simple Prayer.',
    ],
    trademarkRule: [
      'Ad ve cami işareti Majani Plus’a aittir ve kodun MIT lisansına dahil değildir. Uygulama hakkında yazmak için kullanabilirsiniz (',
      'markalar, İngilizce',
      ').',
    ],
    wrongH2: 'Sık yapılan yanlışlar',
    wrongFormat: 'Yanlış: “{x}”',
    accuracy: [
      ['Kâr amacı gütmeyen bir kuruluş', 'Majani Plus bir şirkettir ve Simple Prayer onun topluluk projesidir: ücretsiz, reklamsız ve ücretli özelliği yok.'],
      ['Telefonunuzdan hiçbir şey çıkmaz', 'Namaz kaydı telefonda kalır. İnternet üzerinden geçen beş küçük şey var ve hepsi gizlilik politikasında yazılı: şehir araması, güncelleme kontrolü, çökme raporları (varsayılan olarak açık, kapatılabilir), bırakırsanız bahşiş ve açarsanız namaz arkadaşları.'],
      ['Namaz arkadaşları uçtan uca şifreli', 'Değil. Sunucu rastgele kimlikleri ve tek bir işareti (hangi namaz, kılındı mı) en fazla 24 saat tutar; hiçbir isim tutmaz.'],
    ],
    linksH2: 'Bağlantılar',
    links: storeLinks('Web sitesi', 'Kaynak kodu', 'Namaz arkadaşları sunucusunun kodu', 'Gizlilik politikası (İngilizce)', 'Yazılar (İngilizce)'),
    sheet: { title: 'SIMPLE PRAYER: BİLGİ NOTU', contact: 'İletişim', more: 'Daha fazlası' },
  },
};

/** The press contact: the general inbox, not the privacy one. */
export const pressContact = site.email;

/** The downloads `scripts/build-press-kit.ts` writes into public/press/files/. */
export const pressFiles = {
  all: (l: Locale) => `/press/files/simple-prayer-press-kit-${l}.zip`,
  factSheet: (l: Locale) => `/press/files/simple-prayer-fact-sheet-${l}.txt`,
  logos: '/press/files/simple-prayer-logos.zip',
  icon: '/press/files/simple-prayer-icon-1024.png',
  screenshots: [
    { lang: 'en', label: 'English', href: '/press/files/simple-prayer-screenshots-en.zip' },
    { lang: 'ar', label: 'العربية', href: '/press/files/simple-prayer-screenshots-ar.zip' },
    { lang: 'tr', label: 'Türkçe', href: '/press/files/simple-prayer-screenshots-tr.zip' },
  ],
} as const;
