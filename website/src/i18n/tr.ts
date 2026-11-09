import type { SiteDict } from './index';
import { site } from '../config';

/**
 * Türkçe — authored, not machine-mirrored (spec-website §9). Terminology follows the app's own
 * strings (src/i18n/locales/tr.json): Kaza namazları, Özel günler, Esnek / Kararlı, Kılındı /
 * Geç / Kaçtı, "38° sola dön", "gerekmiyor", Sistem / Aydınlık / Karanlık.
 * The landing copy was written anew from the English *intent* — the hero idiom, section heads
 * and rhythms are Turkish, not renderings. Facts (method names, −30…+30, ring of five, CSV,
 * 30-day undo, 3/7/30/100/365) are kept identical to en.ts. D44: bahşiş only, never the d-word.
 */
export const tr: SiteDict = {
  chrome: {
    skipToContent: 'İçeriğe atla',
    nav: {
      features: 'Özellikler',
      how: 'Nasıl çalışır',
      support: 'Destek',
      privacy: 'Gizlilik',
      getApp: 'Uygulamayı edin',
      siteNav: 'Site',
      menu: 'Menü',
    },
    theme: {
      group: 'Tema',
      system: 'Sistem teması',
      light: 'Aydınlık tema',
      dark: 'Karanlık tema',
    },
    language: 'Dil',
    footer: {
      pledge:
        'Uygulama ücretsizdir; içinde reklam, hesap ya da izleme yoktur. Bu site de aynı sözü tutar: başka hiçbir yerden bir şey yüklemez ve ziyaret ettiğini bilmez.',
      privacyPolicy: 'Gizlilik politikası',
      terms: 'Kullanım koşulları',
      support: 'Destek',
      feedback: 'Geri bildirim',
      source: 'Kaynak kodu',
      articles: 'Yazılar (İngilizce)',
      press: 'Basın kiti',
      madeBy: 'Majani Plus’ta {author} yaptı. Bütün özellikler ücretsiz.',
      author: 'Ronny Majani',
    },
    stores: {
      downloadOn: 'İndir:',
      comingSoonTo: 'Çok yakında:',
      apkLabel: 'Ya da Android kurulum dosyasını doğrudan indir',
      apkHint: 'Sürüm {version} · {size} MB · Google Play’siz Android telefonlar için',
    },
  },

  home: {
    title: 'Simple Prayer: Namaz Vakitleri, Kıble ve Namaz Takibi — Reklamsız, Ücretsiz',
    description:
      'Doğru namaz vakitleri (Diyanet dahil), nazik bir namaz takibi ve bir kıble pusulası. İnternetsiz çalışır. Bütün özellikler ücretsiz: reklam yok, hesap yok, izleme yok. Açık kaynak.',
    hero: {
      h1Pre: 'Namaz vakitleri, kıble ve ',
      h1Accent: 'nazik bir namaz takibi',
      h1Post: '.',
      sub: 'Simple Prayer bugünün beş vaktini gösterir ve sıradaki vakte geri sayar. Namazını kıldığında yanındaki yuvarlak işarete — mührüne — dokunursun, namaz kaydedilir. Bunu uygulamadan, ana ekranından, bir bildirimden ya da saatinden yapabilirsin. İnternetsiz çalışır ve sana asla reklam göstermez. Uygulamanın tamamı açık kaynaktır; ne yaptığını herkes kontrol edebilir.',
      chips: ['Reklam yok, hiçbir zaman', 'Hesap yok', 'İzleme yok', 'Çevrimdışı çalışır', 'Açık kaynak'],
      chipsLabel: 'Verdiğimiz söz',
      storeHint:
        'iPhone ve Android için — telefonlar, tabletler ve akıllı saatler. App Store ve Google Play’de yayında.',
    heroBrowser: 'Ya da tarayıcında kullan',
    heroBrowserHint: 'Bugünün vakitleri ve kıble, hiçbir şey kurmadan.',
      shotAlt:
        "Simple Prayer'ın aydınlık kâğıt temasındaki Bugün ekranı: hicri ve miladi tarih, günlük seri, sıradaki vakte canlı geri sayım ve beş namaz satırı — Sabah'ın mührü üç seçeneğine açılmış hâlde.",
    },
    how: {
      eyebrow: 'Nasıl çalışır',
      h2: 'Namazını nasıl işaretlersin',
      steps: [
        {
          title: 'Bugünün beş vaktini gör',
          body: 'Bugün ekranı beş vaktin hepsini gösterir. İçinde bulunduğun vakit vurgulanır ve vaktin sonuna kadar geri sayım işler. Vakitler telefonunda hesaplanır; internet gerekmez.',
        },
        {
          title: 'Kıldığında işaretle',
          body: 'Namazın mührüne dokun; kaçtı, geç ya da kılındı seç. Kılındı en sonda, mührün kendi yerinde durur; en sık verdiğin cevap parmağının hemen altındadır. Aynı seçeneğe yeniden dokunursan işaret kalkar.',
        },
        {
          title: 'Geçmişteki günlere bak',
          body: 'Geçmiş, her günü beş dilimli bir halka olarak gösterir. Geçmişteki herhangi bir günü açıp bakabilir ya da değiştirebilirsin. Hiçbir gün kilitlenmez.',
        },
      ],
      demoCaption:
        'Bu, gerçek uygulamadakiyle birebir aynı çalışır. Dene: mühre dokun, sonra bir cevap seç. Aynı cevaba tekrar dokunursan işaret silinir.',
    },
    sealDemo: {
      name: 'Akşam',
      arabic: 'المغرب',
      showArabic: true,
      time: '20:47',
      captions: {
        unlogged: '· işaretlenmedi',
        prayed: '· kılındı',
        late: '· geç kılındı',
        missed: '· kaçırıldı',
      },
      options: { prayed: 'Kılındı', late: 'Geç', missed: 'Kaçtı' },
      hint: 'seçmek için mühre dokun · kapatmak için tekrar dokun',
      ariaLabel: 'Akşam namazını işaretle',
    },
    everywhere: {
      eyebrow: 'Her yerde',
      h2: 'Uygulamayı açman bile gerekmez',
      lead: 'Vakitler ve namazı işaretleyen o dokunuş yalnızca uygulamada değil: ana ekranında, kilit ekranında, bildirimlerinde ve saatinde de var. Hepsi aynı sade yolla çalışır. Nerede işaretlersen işaretle, uygulamaya işlenir.',
      cards: [
        {
          plat: 'iPhone ve Android',
          title: 'Ana ekranında widget’lar',
          body: 'iPhone ve Android’de bir widget, bugünün vakitlerini ya da sıradaki vakte geri sayımı gösterir. Mühür widget’ın üstündedir: dokunursun, namaz uygulama açılmadan işaretlenir.',
        },
        {
          plat: 'Yalnızca iPhone',
          title: 'Kilit ekranı ve StandBy',
          body: 'iPhone’da sıradaki vakit kilit ekranında, geceleri de başucundaki StandBy ekranında durabilir. Buralarda yalnızca vakitler görünür. Kilit ekranını herkes görebilir; işaretlediklerin orada asla görünmez.',
        },
        {
          plat: 'iPhone ve Android',
          title: 'Bildirimlerdeki “Kıldım” düğmesi',
          body: 'Android’de her hatırlatmanın üstünde “Kıldım” düğmesi vardır; istersen o anki ve sıradaki vakti gösteren kalıcı bir bildirimi de açık tutabilirsin. iPhone’da bildirimi basılı tutunca aynı düğme açılır. İki yolda da namaz uygulama açılmadan kaydedilir; ardından kısa bir onay gelir, yanındaki Geri Al ile.',
        },
        {
          plat: 'Yalnızca iPhone',
          title: 'Kilit ekranında geri sayım',
          body: 'iPhone’da vaktin az öncesinde uygulamayı açarsan, kilit ekranında bir kart kalır ve geri sayar — mühür de üstündedir, yani telefonu açmadan namazı işaretleyebilirsin. Ne kadar erken belireceğini ve ne kadar kalacağını sen seçersin.',
        },
        {
          plat: 'iPad ve Android tabletler',
          title: 'Tabletler ve katlanabilir telefonlar',
          body: 'Tablette ya da açılmış katlanabilir bir telefonda ekran ikiye bölünür: bir yanda bugünün vakitleri, öbür yanda ay takvimi ve küçük bir kıble kadranı.',
        },
      ],
      watchAlt: 'Saat uygulaması karanlık temada: Akşam namazının Arapça ve Türkçe adı, canlı geri sayım, vaktin sonu ve altında namazın yuvarlak mührü.',
    },
    wrist: {
      eyebrow: 'Saat',
      h2: 'Bileğinde',
      lead: 'Uygulama saatinde de var: bugünün vakitleri, tek dokunuşla mühür ve kıble. Kadranın üzerinde küçük bir gösterge içinde bulunduğun vakti yazar; halkası vakit geçtikçe dolar. Kadranın altından yukarı kaydırırsan bir kart sıradaki vakte geri sayar. İkisine de dokununca uygulama açılır. Wear OS’ta kadrandan bir kaydırma uzaklıkta bir kart var. Kendi yaptığımız kadran, Manuscript, çok yakında. Saat iki haftalık vakti hazır tutar; telefonun başka odada olsa da doğru kalır — telefon uzaktayken ezanı kendisi de okuyabilir. Saatte işaretlediğin namaz uygulamaya işlenir.',
      items: [
        'Apple Watch’ta uygulama',
        'Kadrandaki gösterge',
        'Kadranın altındaki kart',
        'Wear OS’ta uygulama',
        'Wear OS kartı',
        'Manuscript kadranı — çok yakında',
      ],
      hint: 'devamı için kaydır',
    },
    features: {
      eyebrow: 'Özellikler',
      h2: 'Uygulamada neler var',
      lead: 'Dört sekme var: Bugün, Geçmiş, Kıble ve Ayarlar. Hiçbiri senden hesap açmanı istemez.',
      bands: [
        {
          title: 'Mühür',
          body: 'Mühre dokununca üç seçenek açılır: kaçtı, geç ya da kılındı. Kılındı, mührün tam yerinde durur; en sık verdiğin cevap parmağının hemen altındadır. Birini seçince mühür kapanır ve altın rengine döner. Yanlış seçtiysen tekrar dokunur, başka birini seçersin.',
          alt: 'Bugün ekranında bir namazın mührü üç seçeneğe açılmış: Kaçtı, Geç ve Kılındı — Kılındı en sonda, mührün kendi yerinde.',
        },
        {
          title: 'Geçmiş sekmesi',
          body: "Geçmiş'te her gün, her dilimi bir namaz olan beş dilimli bir halkadır. Takvimin altında serini, namazlarını ne sıklıkla vaktinde kıldığını ve en çok hangi vakti kaçırdığını görürsün. İşaretlemediğin günler, kaçırdığın günlerden ayrı tutulur.",
          alt: 'Geçmiş sekmesi: her günün beş dilimli bir halka olduğu ay takvimi, altında seri ve tamamlama istatistikleri.',
        },
        {
          title: 'Kıble pusulası',
          body: "Kadran, halkasının üzerinde Kâbe'yi gösterir. Ne yapacağın altında yazar: “38° sola dön.” Doğru yöne döndüğünde kadran yeşile döner ve doğru yöne baktığını söyler. Pusula manyetik kuzeyi gösterir, ama gerçek kuzey tam orada değildir; uygulama bulunduğun yere göre bu farkı düzeltir. Sen dönerken ibre sakin kalır; elin titrese bile. Ve çoğu namaz uygulamasının aksine telefonu düz tutmanı istemez: nasıl tuttuğunu fark eder, yine de doğru kalır. Ölçümden ne kadar emin olduğunu da söyler ve en sağlam okuma için telefonu nasıl tutacağını gösterir.",
          alt: 'Hizalanmış kıble pusulası: kadran ve Mekke rozeti yeşile dönmüş, altında “Hizalandın — başlayabilirsin” yazısı.',
        },
        {
          title: 'Kaza namazları',
          body: 'Bir namazı kaçtı diye işaretlediğinde, uygulama onu o vaktin sayacına ekler. Kaza ettikçe sayaç azalır. Ekran ne kadar hızlı gittiğini ve hangi tarihte bitireceğini gösterir. İstersen bütün sayacı silip yeniden başlayabilirsin; fikrini değiştirmek için 30 günün olur.',
          alt: 'Kaza ekranı: azalan vakit başına sayaçlar, son hız ve öngörülen bitiş tarihi.',
        },
        {
          title: 'Yolculuk modu',
          body: 'Yolculukta öğle, ikindi ve yatsıyı iki rekât kılabilirsin. Öğleyi ikindiyle, akşamı da yatsıyla birlikte kılabilirsin. Yolculuk modunu Bugün ekranının üstündeki menüden açarsın. Açıkken uygulama, birleştirdiğin namazı geç saymaz. Namaz vakitleri değişmez; beş namazın hepsi yine senin işaretlemen için orada. Kaç gün süreceğini seçebilirsin; süresi dolunca kendiliğinden kapanır.',
          alt: 'Bugün ekranı, yolculuk modu açık: geri sayımın altında namazların kısaltılıp birleştirilebileceğini söyleyen sakin bir şerit.',
        },
      ],
      /** Ekran görüntüsü henüz çekilmemiş bir bandın telefon çerçevesinde görünür. */
      shotPending: 'Ekran görüntüsü yakında',
      iconCards: [
        {
          title: 'Vakitler nasıl hesaplanır',
          body: "Hesaplama yöntemi ülkene göre seçilir ve her zaman adıyla gösterilir: Diyanet, ISNA, Ümmü'l-Kurâ, Mısır, Karaçi ve daha fazlası. İstersen değiştirirsin: ikindi için Hanefî ya da Şâfiî'yi seçebilir, her vakti caminin takvimine uydurmak için 30 dakikaya kadar kaydırabilirsin. Bugün ekranı hicri tarihi de miladi tarihin yanında gösterir; cuma günü öğle namazı iki adını birden taşır: Cuma · Öğle. Güneşin yazın neredeyse batmadığı kuzey bölgelerde yaşıyorsan, o aylar için bir kural seçebilirsin.",
        },
        {
          title: 'Hatırlatmalar',
          body: 'Her namazın üç hatırlatması olabilir: vakit girince bir bildirim, Sabah namazına uyanmak için daha erken bir hatırlatma ve vakit çıkmadan son bir hatırlatma. Her biri sessiz olabilir, sade bir ses çalabilir ya da ezan okuyabilir — dört okuyuş arasından seçersin. Namazı zaten işaretlediysen son hatırlatma iptal olur. Ayrı bir ekran, hangi hatırlatmaların kurulu olduğunu tek tek gösterir.',
        },
        {
          title: 'Özel günler',
          body: 'Âdet ve lohusalık günleri için. Özel bir gün senden hiçbir şey istemez: serin bozulmaz, hiçbir şey kaçırılmış görünmez. O günler için kaza namazı gerekmez. Hatırlatmalar bu süre boyunca durur — ezanı duymaya devam etmek istersen açık bırakabilirsin. İstediğin kadar açık kalır: sen kapatana dek, ya da verdiğin gün sayısı dolunca kendiliğinden kapanır. Uygulama bir regl takipçisi değildir ve hiçbir tahminde bulunmaz.',
        },
        {
          title: 'Verilerin',
          body: 'Kaydın telefonunda yaşar, başka hiçbir yerde değil. İstediğin an CSV ya da JSON olarak dışa aktarabilirsin. Uygulamayı silersen veri de onunla gider.',
        },
        {
          title: 'Namaz arkadaşları',
          body: 'Başkasının da kıldığını bilmek namaz kılmayı kolaylaştırır. Seçtiğin biriyle — eşinle, kardeşinle, bir arkadaşınla — eşleşebilir ve bugünün ekranında onun namazını kıldığını görebilirsin; o da seninkini görür. Amaç birbirinizi yüreklendirmek. Kaçırdığın ya da henüz işaretlemediğin bir namazı asla görmez. Akış yok, sıralama yok, puan yok. Sen açana kadar kapalıdır ve ikinizden biri istediği an bitirebilir.',
        },
      ],
    },
    gentle: {
      h2: 'Bir günü kaçırırsan',
      p1: [
        { t: 'Bir namazı işaretlediğinde mührü altın olur ve uygulama üst üste geçen günleri sayar. Tek bir namazı kaçırmak seriyi her zaman bitirmez: ' },
        { t: 'Esnek', b: true },
        { t: ' modda bir namaz bile günü kurtarır; ' },
        { t: 'Kararlı', b: true },
        { t: ' modda beşi de gerekir. Özel günler seriyi bozmaz. İşaretlemeyi unuttuğun bir gün, hiçbir zaman kaçırılmış bir güne çevrilmez. Geçmişteki her günü açıp değiştirebilirsin; yanlış bir dokunuşu düzeltmek kolaydır.' },
      ] as { t: string; b?: boolean }[],
      p2: 'Sıralama listesi yok; uygulama sana hiçbir zaman “serin bozuldu” demez. 3, 7, 30, 100 ve 365. günlerde küçük bir not gösterir. Kaydını senden başka kimse göremez — bir namaz arkadaşı eklemediğin sürece; eklersen o, bugün namazını kıldığını görür, başka hiçbir şeyi değil.',
      note: "Bu bölüm, uygulamanın karanlık temasıyla gösteriliyor. Uygulama telefonunun aydınlık/karanlık ayarına uyar; Ayarlar'dan elle de seçebilirsin. Bu sayfa da aynısını yapar; düğmesi üst çubukta.",
      shotAlt:
        'Gece kâğıdı temasında Bugün ekranı: aynı düzen, koyu sıcak parşömen üzerinde aydınlatılmış altın vurgularla.',
    },
    optional: {
      h2: 'Hiçbir şeyi işaretlemek zorunda değilsin',
      p1: 'Birçok kişi yalnızca namaz vakitlerini ve kıbleyi ister. Uygulama, tek başına bunu da iyi yapsın diye kuruldu. Seni namaz işaretlemeye hiçbir zaman zorlamaz; hiç işaretlemesen de hiçbir yeri eksik görünmez.',
      p2: 'Namazlarını işaretlersen, uygulama seni yargılamak için değil, yüreklendirmek için orada. Sana not vermez. Unuttuğun bir gün kaçırdığın bir güne dönüşmez; istediğin zaman geri dönüp düzeltebilirsin. Uygulama, kıldığın her namazın eksiksiz bir kaydı olmaya çalışmıyor.',
    },

    access: {
      h2: 'Okunması ve dokunması kolay olsun diye',
      lead: 'Günde beş vakit namaz kılan pek çok insan ya yaşça büyük, ya az görüyor ya da ekran okuyucu kullanıyor. Uygulama onlar düşünülerek yapıldı.',
      langs:
        'Uygulama İngilizce, العربية ve Türkçe konuşur. Her çeviri o dilde elle yazıldı; makine çevirisi değil. Arapça baştan sona sağdan sola, Arapça için yapılmış bir yazıyla.',
      translate: {
        pre: 'Başka bir dil konuşuyorsan ve uygulamanın çevirisine yardım etmek istersen, ',
        linkText: 'nasıl yardım edebileceğini oku',
        post: '.',
      },
      bullets: [
        'Düğmeler büyük ve basması kolay; elin titrese bile.',
        'VoiceOver ya da TalkBack gibi bir ekran okuyucu kullanıyorsan, her düğme ve her ayar adını sesli söyler.',
        'Hiçbir şey renkleri ayırt etmene bağlı değil. Kılınan, geç kılınan ve kaçan namazın her birinin kendi simgesi ve kendi sözcüğü var.',
        'Telefonunun ayarlarında yazıyı büyütürsen uygulamanın yazısı da büyür.',
        'Uygulama, senden bir şey istemeden önce çalışır. Kayıt olmak yok. Konumunu paylaşmak yerine şehrini elle yazabilirsin; uygulama da bir daha sorup durmaz.',
        'Karanlık temada her şey rahat okunur; en küçük yazı bile.',
      ],
      shotAlt: 'Arapça Bugün ekranı: arayüzün tamamı sağdan sola, Arap harfleriyle.',
    },
    pledge: {
      h2: 'Verdiğimiz söz',
      body: "Reklam yok, hiçbir zaman. Hesap yok. İzleme yok. Namaz kaydın telefonunda kalır. Yaklaşık konumun yalnızca telefonunun kendi harita servisine gider; o da şehrinin adını bulmak içindir. Uygulama çökerse bize yalnızca uygulamanın bozulduğunu söyleyen bir rapor gelir; senin kim olduğuna dair hiçbir şey söylemez ve bunu Ayarlar'dan kapatabilirsin. Uygulama ücretsizdir ve ücretsiz kalacak. İşine yaradıysa Ayarlar'dan bir bahşiş bırakabilirsin. İçindeki tek para budur.",
      more: 'bunların hepsini düz bir dille anlatır; telefonundan herhangi bir şeyin çıktığı beş durum da orada yazar. Bu site de aynı sözü tutar: çerez yok, ziyaretçi sayan hiçbir şey yok, başka hiçbir yerden yüklenen bir şey yok.',
      privacyLink: 'Gizlilik politikası',
      openSource: {
        pre: 'Bunların hepsini kendin de kontrol edebilirsin. Uygulamanın tamamı ',
        linkText: 'açık kaynaklı',
        post: ': kodunu herkes okuyabilir.',
      },
    },
    faq: {
      h2: 'Sık sorulanlar',
      qas: [
        {
          q: 'Gerçekten ücretsiz mi? Karşılığında ne var?',
          a: "Bir karşılığı yok. Uygulama ücretsiz, eksiksiz ve reklamsız. İşine yararsa Ayarlar'da isteğe bağlı bir bahşiş var; içindeki tek para bu ve hiçbir şeyin kilidini açmaz.",
        },
        {
          q: 'Hesap açmam gerekiyor mu?',
          a: 'Hayır. Kaydolacağın bir şey, hatırlayacağın bir şifre yok. Uygulamayı açarsın, çalışır.',
        },
        {
          q: 'İnternetsiz çalışıyor mu?',
          a: 'Evet. Vakitler telefonunda hesaplanır; vakitler de, takip de, hatırlatmalar da internetsiz çalışır.',
        },
        {
          q: 'Vakitler camimle uyuşur mu?',
          a: "Çoğunlukla evet: uygulama, ülkende kullanılan hesap kurumuyla başlar — Türkiye'de Diyanet. Camin farklıysa yöntemi değiştirebilir, ikindi için Hanefî ya da Şâfiî'yi seçebilir, her vakti 30 dakikaya kadar kaydırabilirsin.",
        },
        {
          q: 'Beni izliyor mu, verimi satıyor mu?',
          a: 'Hayır. Reklam yok, analiz yok, hesap yok. Namaz kaydın telefonunda kalır; bu yüzden kimsenin satabileceği bir verin yok.',
        },
        {
          q: 'Namaz kılamadığım günlerde ne olur?',
          a: 'Özel günler modu âdet ve lohusalık günleri içindir. O günler senden bir şey istemez: hiçbir şey kaçırılmış görünmez, serin bozulmadan devam eder. Hatırlatmalar durur; istersen açık da bırakabilirsin. O günler için kaza namazı gerekmez.',
        },
        {
          q: 'Yolculuktayken ne olur?',
          a: 'Yolculuk modunu açarsın, uygulama da yolcunun ruhsatına uyar: öğle, ikindi ve yatsı iki rekât kılınabilir; öğle ikindiyle, akşam yatsıyla birlikte kılınabilir. Birleştirdiğin namaz geç sayılmaz. Bu namazlar yine borcundur ve yine işaretlenir — yolculuk, özel günlerle aynı şey değildir. Modun ne zaman başlayıp biteceğine sen karar verirsin; uygulama nerede olduğuna hiç bakmaz.',
        },
        {
          q: 'Saatimde çalışıyor mu?',
          a: 'Evet. Apple Watch’ta uygulama bugünün vakitlerini, tek dokunuşlu mührü ve kıbleyi gösterir; sıradaki vakit saat kadranına eklenebilir. Wear OS’te aynı uygulama ve bir kart var; kendi yaptığımız Manuscript kadranı çok yakında. Saatte işaretlediğin namaz uygulamaya işlenir.',
        },
        {
          q: 'Uygulamayı açmadan namaz işaretleyebilir miyim?',
          a: 'Evet, üç yolla: bildirimdeki “Kıldım” düğmesine bas, ana ekrandaki widget’ın mührüne dokun ya da saatinden işaretle. Üçü de namazı, uygulamayı açmışsın gibi kaydeder.',
        },
        {
          q: 'Bahşiş ne için?',
          a: 'Bir teşekkür, o kadar. Her özellik, bahşiş versen de vermesen de herkes için ücretsiz.',
        },
        {
          q: 'Açık kaynaklı mı?',
          a: 'Evet, MIT lisansıyla. Uygulama ücretsizdir; reklam yoktur, ücretli özellik yoktur. Herkes onu derleyebilir ve kopyalayabilir. Kodu okuyabilir, uygulamayı kendin derleyebilir ya da kendi adın ve simgenle bir kopyasını yayımlayabilirsin. Namaz arkadaşları için çalışan küçük sunucu da açık kaynaklıdır.',
          links: [
            { text: 'Uygulamanın kodu', href: site.sourceUrl },
            { text: 'Sunucunun kodu', href: site.relayUrl },
          ],
        },
        {
          q: 'Namaz arkadaşları nasıl çalışır? Sunucu neyi görür?',
          a: 'Bir namazı işaretlediğinde telefonun rastgele bir kimlik ve hangi namazı işaretlediğini gönderir. Sunucumuz bunu, arkadaşının telefonu alana kadar tutar; en fazla 24 saat. Sonra siler. İsimleriniz telefonlarınızdan hiç çıkmaz.',
          links: [{ text: 'Gizlilik politikası bunu ayrıntısıyla anlatır (İngilizce).', href: '/privacy' }],
        },
      ],
      more: {
        pre: 'Hatırlatmalar, kaza namazları ve verini dışa aktarma gibi konuların daha uzun cevapları ',
        linkText: 'destek sayfasında',
        post: '.',
      },
    },
    cta: {
      arabic: 'حافظوا على الصلاة',
      translation: '“Namazları koruyun.”',
      showTranslation: true,
      h2: "Simple Prayer'ı edin",
      sub: "iPhone ve Android'de ücretsiz. İnternetsiz çalışır, hesap gerekmez. Açık kaynak.",
      langsLine: 'Bütün özellikler ücretsiz · English · العربية · Türkçe',
    },
  },

  support: {
    title: 'Destek — Simple Prayer',
    description:
      'Simple Prayer yardımı: hatırlatıcı neden gelmedi, vakitleri caminize göre ayarlama, widget’lar, saat, özel günler modu, kaza namazları, verileri dışa aktarma ve iletişim.',
    h1: 'Destek',
    intro:
      'Buradaki her şey uygulamanın gerçek davranışını anlatır. Bu sayfayla uygulama bir gün uyuşmazsa bize söyle — ikisinden birinde hata var demektir.',
    introLinkText: 'bize söyle',
    onThisPage: 'Bu sayfada',
    toc: {
      reminders: 'Hatırlatmam neden gelmedi?',
      times: 'Vakitleri camime nasıl uydururum?',
      widgets: 'Widget’lar nasıl çalışır?',
      watch: 'Saat uygulaması ne yapar?',
      exemption: 'Özel günler modu nedir?',
      qada: 'Kaza namazları nasıl işler?',
      streaks: 'Seri nasıl işliyor — geçmişi düzeltebilir miyim?',
      location: 'Uygulamanın konumuma ihtiyacı var mı?',
      export: 'Verimi nasıl dışa aktarır ya da yedeklerim?',
      contact: 'Size nasıl ulaşırım?',
    },
    reminders: {
      p1: 'Uygulama namaz vakitlerini telefonunda hesaplar ve her vakitte bir hatırlatma göstermesini telefonun kendisinden ister. İşin içinde sunucu yoktur. Hatırlatmaların internetsiz çalışmasının sebebi budur. Bir hatırlatma gelmediğinde de sebep neredeyse her zaman telefonun kendi ayarlarıdır.',
      kindsIntro: 'Dört tür hatırlatma vardır. İlk üçünü her namaz için Ayarlar → Hatırlatmalar altından ayarlayabilirsin:',
      kinds: [
        'Namaz vaktinde — sessiz, telefonun normal sesi ya da kısa bir ezan kaydıyla. Seçim senin.',
        'Namazdan önce — belirlediğin kadar dakika erken. Bu, Sabah namazına uyanmak için yapıldı.',
        'Vakit çıkmadan — son bir hatırlatma; yalnızca o namazı henüz işaretlemediysen gelir. İşaretlediğin anda iptal olur. Yatsı için İslami gece yarısına göre kurulur; seni gece 3’te uyandırmaz.',
        "Güneş doğdu bildirimi — Sabah, vakti sıradaki namazla değil güneşin doğmasıyla çıkan tek namazdır. Sabah hâlâ işaretlenmemişse, güneş doğarken gelen sessiz bir bildirim vaktin çıktığını ve Öğle'nin saatini söyler.",
      ],
      scheduling:
        'Uygulama yaklaşık beş gün ilerisine kadar bildirim kurar (iOS bir uygulamaya en fazla 64 bekleyen bildirim tanır). Uygulamayı her açtığında, ilgili bir ayarı ya da konumunu değiştirdiğinde plan yenilenir.',
      healthH: 'Hatırlatma güvenilirliği ekranından başla',
      health:
        'Ayarlar → Hatırlatmalar → Hatırlatma güvenilirliği, telefonunda şu an tam olarak nelerin kurulu olduğunu gösterir; sistem planı silmişse uyarır. Bir de “deneme bildirimi gönder” düğmesi vardır. Deneme bildirimi geliyorsa iletim çalışıyor demektir; sebep aşağıdaki ayarlardan biridir.',
      iosH: "iPhone'da",
      ios: [
        'Odak ve Rahatsız Etme, uygulamaya izin verilmedikçe bildirimleri susturur: Ayarlar → Odak → senin Odağın → İzin Verilen Bildirimler.',
        'Uygulamanın bildirim izinlerini kontrol et: iOS Ayarlar → Bildirimler → Simple Prayer — bildirimlere izin ver; sesi ve afişleri aç.',
        'Ezan kaydı bilerek kısadır. iOS her bildirim sesini 30 saniyeyle sınırlar; bu yüzden pakete konan kayıt tam ezan değil kısa bir bölümdür. Bu bir Apple sınırı, bir ayar değil.',
        'Sessiz mod ve Sesli/Sessiz anahtarı bildirim sesleri için de geçerlidir.',
      ],
      androidH: "Android'de",
      android: [
        "Sebep genellikle pil ayarlarıdır. Android, açık olmayan uygulamaları dondurabilir ve hatırlatmalarını unutabilir. Simple Prayer'ın pil kullanımını “Kısıtlamasız” yap (Ayarlar → Uygulamalar → Simple Prayer → Pil).",
        'Bazı telefon üreticileri, arka plandaki uygulamaları kapatan kendi araçlarını da ekler: Samsung (“Uyuyan uygulamalar”), Xiaomi (Otomatik başlatma), Huawei (Uygulama başlatma), Oppo ve OnePlus (Pil optimizasyonu). Hatırlatma güvenilirliği ekranı, senin telefonun için gereken adımları gösterir.',
        'Android 14 ve sonrasında bir uygulama, sen izin vermeden hatırlatmayı tam dakikasına kuramaz. Uygulama bunu kurulum sırasında bir kez önerir; aynı düğme Hatırlatma güvenilirliği ekranında her zaman durur. İzin vermezsen hatırlatmalar yine gelir ama birkaç dakika gecikebilir. Uygulama ayrıca, telefon yeniden başladığında hatırlatmalar kaybolmasın diye açılışta çalışma iznini kullanır. Bunlar zamanlama izinleridir; hiçbir şey okumazlar.',
        "Android 16, bildirimleri Promosyonlar veya Öneriler gibi gruplara ayırabilir; bir gruba konan hatırlatma sessiz gelir. Böyle olursa telefonunda Ayarlar → Bildirimler → Bildirim düzenleyici'yi aç ve Simple Prayer'ı grupların dışında bırak.",
        'İsteğe bağlı bir kalıcı bildirim (varsayılan olarak kapalı), içinde bulunduğun vakti ve sıradaki vakti bildirim alanında tutabilir.',
      ],
    },
    times: {
      p1: 'Vakitler, yaklaşık konumundan telefonunda hesaplanır. Uygulama başlangıçta ülkende kullanılan hesap kurumunu seçer ve bunu açıkça gösterir; örneğin “Otomatik (Diyanet)”. İstediğin zaman değiştirebilirsin.',
      steps: [
        "Ayarlar → Namaz vakitleri → Hesaplama yöntemi. Tam listede Diyanet (Türkiye), ISNA (Kuzey Amerika), Ümmü'l-Kurâ, Mısır, Karaçi, Moonsighting Committee, Dubai, Kuveyt, Katar, Singapur, Tahran, Caferî ve Muslim World League var.",
        'İkindi mezhebi: varsayılan “Otomatik” ülkene uyar. Pakistan, Hindistan, Bangladeş ve Afganistan’da Hanefî, diğer yerlerde Şâfiî olur. İstersen Şâfiî ya da Hanefî’yi kendin seç. Bir ikindi vaktinin “yanlış görünmesinin” en yaygın sebebi budur.',
        'Vakit başına düzeltme: her vakit −30 ile +30 dakika arasında kaydırılabilir. Camin, güvenlik payı (temkin) eklenmiş basılı bir takvim kullanıyorsa, burada vakit vakit ona uydur.',
        'Kuzey yazları için yüksek enlem kuralı; topluluğunun hilal görmesi farklıysa hicri tarih düzeltmesi (±2 gün).',
      ],
      note: 'Ayarlar, hangi kurumun kullanıldığını ve yaptığın değişiklikleri her zaman gösterir; bir vaktin neden o vakit olduğunu her zaman görebilirsin.',
    },
    widgets: {
      p1: 'Widget, vakitleri ana ekranında gösterir; iPhone’da da Android’de de. Eklemek için ana ekranda boş bir yere basılı tut ve Simple Prayer’ı bul: iPhone’da Düzenle → Widget Ekle altında, Android’de Widget’lar altında. Kaldırmak için widget’ın kendisine basılı tut.',
      bullets: [
        'Widget’taki mühür gerçek mühürdür. Dokununca içinde bulunduğun vakit kılındı olarak işaretlenir; tekrar dokununca geri alınır. Widget bir namazı asla geç ya da kaçtı yapmaz — o seçimler, yanlış dokunuşun daha zor olduğu uygulamada kalır.',
        'Widget’lar, uygulamanın yaklaşık iki hafta ilerisi için hazırladığı bir vakit çizelgesinden okur. Uygulamayı açmak çizelgeyi yeniler.',
        'Uygulama uzun süre açılmadıysa widget, söz veremeyeceği vakitleri göstermek yerine “Vakitler güncellenmeli” der. Uygulamayı bir kez aç; widget yeniden günceldir.',
      ],
    },
    watch: {
      p1: 'Apple Watch ve Wear OS’te uygulama, bugünün vakitlerini tek dokunuşlu mührüyle ve kıbleyi gösterir. Apple Watch’ta sıradaki vakit saat kadranına eklenebilir. Wear OS’te ayrıca bir kart var. Kendi yaptığımız Manuscript kadranı çok yakında.',
      bullets: [
        'Saatin, iki haftaya kadar vakti üzerinde taşır; telefonun uzakta olsa bile vakitler doğru kalır.',
        'Saatte işaretlediğin namazı saat aklında tutar; saatle telefon yeniden yan yana geldiğinde işaret uygulamaya geçer.',
        'Wear OS’te telefon uzaktayken ezanı saatin kendisi okuyabilir. Telefon yakındayken telefonun kendi hatırlatması saatte görünür — aynı hatırlatma iki kez gelmez.',
        'Saat uygulaması telefondaki uygulamayla birlikte çalışır: vakitleri telefon hesaplar, saat gösterir; böylece ikisi hiç ayrışmaz.',
      ],
    },
    exemption: {
      p1: 'Özel günler modu, âdet ve lohusalık günleri içindir. Ayarlar → Takip altından açılır. Özel günler için kaza namazı gerekmez. Bu, üzerinde görüş birliği olan hükümdür ve uygulama buna uyar. Açarken ne kadar süreceğini de seçersin: sen kapatana dek, ya da bir gün sayısı — süre dolunca kendiliğinden kapanır, hatırlaman gerekmez.',
      bullets: [
        'Özel bir gün, düz bir mühürle ve “gerekmiyor” sözüyle gösterilir. Hiçbir zaman kaçırılmış görünmez ve istatistiklerine sayılmaz. Özel günler sürerken hatırlatmalar durur; modu açarken açık bırakmayı da seçebilirsin.',
        'Seri, özel günlerin üzerinden bozulmadan devam eder.',
        'Uygulama kaç namaz borcun olduğunu tahmin ederken, ayda ortalama kaç özel günün olduğunu ona söyleyebilirsin. O günleri hesabın dışında bırakır, böylece sayı olması gerekenden büyük çıkmaz.',
        'Bu bir regl takipçisi değildir: hiçbir tahminde bulunmaz, sağlık verisi tutmaz. Özel günler de, uygulamadaki her şey gibi, yalnızca telefonunda kalır.',
      ],
    },
    qada: {
      p1: 'Kaza, hâlâ borcun olan namazlar demektir. Uygulama her vakit için bir sayaç tutar; namazlarını kaza ettikçe sayaç azalır.',
      bullets: [
        'Başlarken: kaza ekranını ilk açtığında kısa bir kurulum, nasıl başlamak istediğini sorar. Geçmiş bir dönemi tahmin edebilirsin: ne zamandan ne zamana namaz kaçırdığını sorar, her vakit için bir sayı çıkarır ve sayıları elle değiştirmene izin verir. Ya da sıfırdan başlarsın; o zaman yalnızca bundan sonra kaçtı diye işaretlediğin namazlar sayılır. Bu kurulumu atlayabilirsin.',
        'Günden güne: bir namazı kaçtı diye işaretlemek, o vaktin sayacına bir ekler. Borcun olduğu sürece Bugün listesinin altında küçük bir kart kaç namaz kaldığını gösterir. Karta dokununca tam ekran açılır: her vaktin sayacı, ne hızda gittiğin ve bitireceğin tarih. Bir namazı kaza etmek o ekranda yapılır, Bugün ekranında değil.',
        'Geçmişten: geçmişteki herhangi bir günü aç ve kaçırdığın bir namazı “kaza edildi” olarak işaretle. O namaz kaçırılmış ama kaza edilmiş görünür ve sayaç bir azalır.',
        'Sıfırdan başla: kaza ekranında bütün sayacı tek seferde temizleyebilirsin. Geçmişin korunur, sayaçlar sıfıra döner ve aynı yerden 30 gün içinde geri alabilirsin.',
      ],
    },
    streaks: {
      bullets: [
        'Ayarlar → Takip altında iki mod var. Esnek modda, vaktinde ya da geç en az bir namaz kıldıysan gün sayılır. Kararlı modda gün ancak beşi de işaretliyse sayılır.',
        'Her günü, her zaman değiştirebilirsin. Geçmişi aç, geçmişteki bir güne dokun ve istediğin namazı değiştir. Yanlış bir dokunuş ya da işaretlemeyi unuttuğun bir akşam hiçbir zaman kalıcı değildir.',
        'Özel günler seriyi bitirmez. İşaretlemediğin bir gün, hiçbir zaman kaçırdığın bir güne çevrilmez.',
        'Bugünün serisi, gün ertesi Sabah vaktinde bitene kadar kesinleşmez. Bir gün, bir Sabah namazından ertesi Sabah namazına kadar sürer; bu yüzden gece yarısından sonra işaretlediğin Yatsı yine doğru güne yazılır.',
      ],
    },
    location: {
      bullets: [
        '“Konumumu kullan” yalnızca yaklaşık konumunu ister. Hiçbir zaman tam konumunu istemez ve uygulama kapalıyken hiçbir zaman konum almaz. Yalnızca sen dokununca sorar.',
        'İstersen Ayarlar → Konum altından bir şehir yaz. Uygulama, kendi seçtiğin bir şehirle ve hiç konum izni olmadan eksiksiz çalışır; bir daha da sorup durmaz.',
        'Şehrinin adını bulmak, yaklaşık konumunun telefondan çıktığı tek andır. Konum, telefonunun kendi harita servisine gider — Apple ya da Google yapımı — bize hiçbir zaman gelmez. Gizlilik politikası bunu ayrıntısıyla anlatır.',
      ],
      privacyLink: 'Gizlilik politikası',
    },
    export: {
      p1: 'Ayarlar → Veri, uygulamanın kaydettiği her şeyi — namaz kaydını, kaza sayaçlarını, özel günlerini ve ayarlarını — CSV ya da JSON dosyası olarak kaydeder ve paylaşman için telefonuna verir. Dosyayı sakla, gönder ya da istediğin yerde aç. Uygulama onu hiçbir yere yüklemez. Her şey telefonunda durduğu için, yeni telefona geçmeden önceki yedeğin de bu dosyadır.',
    },
    contact: {
      p1: 'Yardım ya da başka her şey için {email} adresine yaz. Bir vakit yanlış görünüyorsa lütfen şehrini ve caminin kullandığı vakitleri de yaz. Çökme raporu bize yalnızca uygulamanın bozulduğunu söyler. Kim olduğunu ya da senin için neyin ters gittiğini söylemez; bu yüzden bize yazan insanlara gerçekten ihtiyacımız var.',
      privacy: 'Gizlilik soruları için {email} adresine yaz.',
      feedbackLink: 'Geri bildirim gönder ya da bir özellik iste',
      feedbackAfter:
        ' — başkalarının ne istediğini gör, kendi isteğini ekle, sırada ne olduğunu öğren. Hesap gerekmez. O sayfa bu sitenin parçası değil.',
    },
    credits: {
      h2: 'Uygulamanın kullandığı açık çalışmalar',
      intro: 'Uygulama, başka insanların herkesle paylaştığı çalışmaları kullanır. Hepsine teşekkür ederiz.',
      items: {
        adhan: 'Namaz vakitlerini hesaplar. Batoul Apps, MIT lisansı.',
        amiri: 'Namaz adları için Arapça yazı tipi. Bu sitedeki Arapça da onunla yazılır. Khaled Hosny, SIL Open Font License.',
        naskh: 'Uygulamadaki diğer Arapça yazılar için yazı tipi. Google, SIL Open Font License.',
        lora: 'İngilizce ve Türkçe için yazı tipi; hem uygulamada hem bu sitede. Cyreal, SIL Open Font License.',
        icu: 'Hicri tarih için takvim verisi. Unicode Consortium, Unicode lisansı.',
        geonames: 'Şehir listesi. CC BY 4.0 lisansı.',
        expo: 'Uygulamanın yapıldığı araçlar. MIT lisansı.',
      },
    },
  },

  privacyNotice:
    'Bu politika yalnızca İngilizce olarak yayımlanır; bağlayıcı metin İngilizcesidir.',
  termsNotice:
    'Bu koşullar yalnızca İngilizce olarak yayımlanır; bağlayıcı metin İngilizcesidir.',

  timesPage: {
    navLabel: 'Namaz vakitleri',
    title: 'Bugünün namaz vakitleri — Simple Prayer',
    description:
      'Bugünün beş vakti ve sıradaki vakit, tarayıcında hesaplanır. Hesap yok, reklam yok. Konumun cihazından çıkmaz.',
    heading: 'Bugünün namaz vakitleri',
    lead: 'Tarayıcın konumunu versin ya da bir şehir seç. Vakitler cihazında hesaplanır, konumun hiçbir yere gönderilmez.',
    orChooseCity: 'Ya da bir şehir seç',
    searchLabel: 'Şehir adı',
    change: 'Değiştir',
    locating: 'Konumun bulunuyor…',
    denied:
      'Tarayıcın konumunu paylaşmadı. Bir şehir seçebilir ya da bu siteye konum izni verip yeniden deneyebilirsin.',
    unavailable: 'Tarayıcın konumunu bulamadı. Bunun yerine bir şehir seç.',
    unsupported: 'Bu tarayıcı konum veremiyor. Bunun yerine bir şehir seç.',
    calculatedWith: 'Vakitler {method} esas alınarak hesaplanır.',
    howCalculated: 'Vakitler nasıl hesaplanıyor',
    zoneNote: 'Bunlar {city} saatidir. Cihazının saati farklı bir dilimde.',
    inApp:
      'Gerisini uygulama yapar: her vakitten önce hatırlatır ve kıldığın namazları işaretleyebilirsin.',
    noScript:
      'Bu sayfa vakitleri hesaplamak için JavaScript gerektirir, çünkü hesabı bir sunucuya sormak yerine senin cihazında yapar.',
    credit: 'Şehir listesi: GeoNames.',
    about: {
      heading: "Bu vakitler hakkında",
      items: [
        {
          q: "Namaz vakitleri nasıl hesaplanıyor?",
          a: "Her vakit, bulunduğun yerde güneşin gökyüzündeki konumundan hesaplanır. Öğle, güneşin en yüksek noktayı geçtiği andan hemen sonradır. Akşam, güneş batınca girer. Sabah ve yatsı, güneş ufkun belirli bir açı altına inince başlar; bu açı hesaplama yöntemine göre değişir. İkindi, gölge belirli bir uzunluğa ulaşınca başlar.",
        },
        {
          q: "Bu sayfa hangi hesaplama yöntemini kullanıyor?",
          a: "Ülkende kullanılan yöntemi: Türkiye’de Diyanet İşleri Başkanlığı, Kuzey Amerika’da ISNA, Suudi Arabistan’da Ümmü’l-Kurâ gibi. Yöntemin adı vakitlerin altında yazar. İkindi Şâfiî, Mâlikî ve Hanbelî ölçüsüne göredir: bir şeyin gölgesi kendi boyuna ulaştığında girer.",
        },
        {
          q: "Vakitler neden camimdekinden farklı?",
          a: "Cami farklı bir yöntem, ikindi için Hanefî ölçüsü (yaklaşık bir saat sonra) kullanabilir ya da ihtiyat için birkaç dakika ekleyebilir. Simple Prayer uygulamasında yöntemi değiştirebilir, Hanefî ya da Şâfiî ikindiyi seçebilir ve her vakti 30 dakikaya kadar kaydırarak caminle eşleştirebilirsin.",
        },
        {
          q: "Çok kuzeydeki yerlerde ne oluyor?",
          a: "Yazın, Kuzey Avrupa gibi yerlerde gökyüzü, alışılmış sabah ve yatsı açıları için yeterince kararmayabilir. O zaman bu iki vakti özel bir kural belirler. Uygulamada bu kuralı kendin seçebilirsin.",
        },
        {
          q: "Bu sayfa internetsiz çalışır mı?",
          a: "Evet. Bir kez açıp bir yer seçtikten sonra bağlantı olmadan da çalışır.",
        },
        {
          q: "Bu sayfa konumumu bir yere gönderiyor mu?",
          a: "Hayır. Vakitler cihazında hesaplanır. Konumun ne bize ne de başka birine gönderilir.",
        },
      ],
    },
  },

  qiblaPage: {
    navLabel: 'Kıble',
    title: 'Bulunduğun yerden kıble yönü — Simple Prayer',
    description:
      'Namaz için hangi yöne döneceğin ve Mekke’nin ne kadar uzakta olduğu, tarayıcında hesaplanır. Konumun cihazından çıkmaz.',
    heading: 'Kıble yönü',
    lead: 'Yön, bulunduğun yere göre hesaplanır. Kadran dönebilsin ya da dönemesin, her cihazda doğrudur.',
    enableCompass: 'Pusulayı aç',
    compassBlocked:
      'Tarayıcın pusulaya izin vermedi. Aşağıdaki yön yine de doğru — kadrandaki kuzey ile kendi pusulandaki kuzey çakışana kadar dön.',
    faceDirection: 'Mekke kuzeyden {{degrees}}° — pusulada {{cardinal}}.',
    flatHint: 'Telefonu düz tut. Web pusulası eğimi düzeltemez; dik tutulan telefon yanlış gösterir.',
    inApp: 'Uygulamadaki pusula daha kararlıdır ve telefonun düz durmasını gerektirmez.',
    tabTimes: 'Namaz vakitleri',
    tabQibla: 'Kıble',
    toolNav: 'Namaz vakitleri ve kıble',
    about: {
      heading: "Kıble hakkında",
      items: [
        {
          q: "Kıble nedir?",
          a: "Kıble, Mekke’deki Kâbe’nin yönüdür. Müslümanlar dünyanın neresinde olurlarsa olsunlar her namazda bu yöne döner.",
        },
        {
          q: "Yön nasıl hesaplanıyor?",
          a: "Senin konumundan ve Kâbe’nin konumundan (yaklaşık 21,42° K, 39,83° D). Sayfa, yuvarlak dünya üzerindeki en kısa yolu izler; buna büyük daire denir. Sayı, coğrafi kuzeyden saat yönünde ölçülür.",
        },
        {
          q: "Kuzey Amerika’da kıble neden kuzeydoğuyu gösteriyor?",
          a: "Düz bir haritada Mekke, Kuzey Amerika’nın güneydoğusunda görünür. Ama dünya yuvarlaktır ve oradan Mekke’ye en kısa yol Atlas Okyanusu’nun üzerinden kuzeydoğuya gider. Örneğin New York’tan kıble, kuzeyden yaklaşık 58°’dir. Bazı topluluklar düz haritadaki güneydoğu yönünü kullanır. Bu sayfa en kısa yolu izler.",
        },
        {
          q: "Pusuladan nasıl doğru bir değer alırım?",
          a: "Telefonu düz tut; metalden, mıknatıstan ve elektrikli cihazlardan uzak dur. Değer zıplıyorsa telefonu birkaç kez yavaşça 8 çizer gibi hareket ettir, böylece kendini düzeltir. Tarayıcında pusula yoksa, derece cinsinden sayıyı güvendiğin bir pusulayla kullanın.",
        },
        {
          q: "Bu sayfa konumumu bir yere gönderiyor mu?",
          a: "Hayır. Yön cihazında hesaplanır. Konumun ne bize ne de başka birine gönderilir.",
        },
        {
          q: "Uygulaması var mı?",
          a: "Evet. Simple Prayer; iPhone, Android, Apple Watch ve Wear OS’ta ücretsizdir. Reklam ve hesap yoktur, açık kaynaktır. Pusulası daha kararlıdır ve telefonun düz durmasını gerektirmez.",
        },
      ],
    },
  },


  /** /install kısayolu: herkesi kendi mağazasına götüren tek adres (D156). */
  install: {
    title: 'Uygulamayı edinin — Simple Prayer',
    description:
      'Simple Prayer’ın App Store veya Google Play sayfasını açar. Uygulama ücretsizdir: reklam yok, hesap yok.',
    heading: 'Simple Prayer’ı edinin',
    lead: 'Simple Prayer ücretsizdir: reklam yok, hesap yok. Telefonunuza uygun mağazayı seçin.',
    onIos: 'App Store kendiliğinden açılacak. Açılmazsa aşağıdaki düğmeyi kullanın.',
    onAndroid: 'Google Play kendiliğinden açılacak. Açılmazsa aşağıdaki düğmeyi kullanın.',
    onDesktop: 'Bilgisayardasınız. Bu kodu telefonunuzla okutun ya da aşağıdaki düğmeleri kullanın.',
    noPlay: 'Bu cihazda Google Play yok.',
    qrAlt: 'Telefon kameranızla okutabileceğiniz bir kod. Bu sayfayı açar.',
    goingIos: 'App Store açılıyor…',
    goingAndroid: 'Google Play açılıyor…',
  },

  pwa: {
    description:
      'Bugünün namaz vakitleri ve kıble, çevrimdışı, tarayıcında. Namazları işaretlemek ve hatırlatmalar uygulamada.',
  },
};
