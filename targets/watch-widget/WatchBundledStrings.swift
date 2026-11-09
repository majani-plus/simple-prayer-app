import Foundation

/**
 The watch's words for the two states no envelope can describe — first install before the phone
 app ever synced, and an envelope past its horizon. The same sanctioned D103 exception the widget
 targets carry (its amendment is recorded in the Milestone V docs pass), with the watch's own
 wording: the fix is on the PHONE, so the words say so. Keyed to the SYSTEM locale; en/ar/ur/tr
 authored per docs/TONE.md, anything else reads English. Twin of `targets/widget/BundledStrings`.

 BYTE-FOR-BYTE TWIN of `targets/watch/WatchBundledStrings.swift` — the extension cannot import
 the watch app's module. Change one, change both.
 */
enum WatchBundledStrings {
  struct Table {
    /// The language these words are in — `ar`, `ur`, `tr` or `en`, resolved from the SYSTEM locale.
    ///
    /// It has to travel with them. These four strings are the one place on the watch where the
    /// text does NOT come from the envelope, so their language is whatever the watch is set to,
    /// while `snapshot.language` is whatever the app is set to — and the two disagree often
    /// enough to matter. Pairing the system-locale sentence with the snapshot-language font put
    /// an Arabic line in Lora, which contains no Arabic glyph at all, for anyone running the app
    /// in English on an Arabic watch; the other direction put an English sentence in a serif
    /// naskh a point and a half taller than its neighbours. Both halves follow the locale that
    /// chose the words (D103).
    let language: String
    let emptyTitle: String
    let emptyBody: String
    let staleTitle: String
    let staleBody: String
  }

  static func current() -> Table {
    let language = Locale.preferredLanguages.first?.prefix(2) ?? "en"
    switch language {
    case "ar":
      return Table(
        language: "ar",
        emptyTitle: "أوقات الصلاة",
        emptyBody: "افتح التطبيق على هاتفك لإكمال الإعداد.",
        staleTitle: "الأوقات تحتاج إلى تحديث",
        staleBody: "افتح التطبيق على هاتفك لتحديثها."
      )
    case "ur":
      return Table(
        language: "ur",
        emptyTitle: "نماز کے اوقات",
        emptyBody: "ترتیب مکمل کرنے کے لیے اپنے فون پر ایپ کھولیں۔",
        staleTitle: "اوقات کو تازہ کرنا ہے",
        staleBody: "انہیں تازہ کرنے کے لیے اپنے فون پر ایپ کھولیں۔"
      )
    case "tr":
      return Table(
        language: "tr",
        emptyTitle: "Namaz vakitleri",
        emptyBody: "Kurulum için telefonunuzda Simple Prayer'ı açın.",
        staleTitle: "Vakitler güncellenmeli",
        staleBody: "Güncellemek için telefonunuzda Simple Prayer'ı açın."
      )
    default:
      return Table(
        language: "en",
        emptyTitle: "Prayer times",
        emptyBody: "Open Simple Prayer on your phone to set up.",
        staleTitle: "Times need a refresh",
        staleBody: "Open Simple Prayer on your phone."
      )
    }
  }
}
