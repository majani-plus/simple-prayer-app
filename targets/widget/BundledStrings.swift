import Foundation

/**
 The words for the two states no snapshot can describe — first install before the app ever
 opened, and a snapshot past its horizon. They are the ONE sanctioned exception to "every string
 travels pre-translated in the snapshot" (they exist precisely when none does), the same
 exception the Android module's `res/values*` strings carry. Keyed to the SYSTEM locale — the
 app language lives in the snapshot we do not have. Authored per docs/TONE.md: short, calm,
 never an error voice. en/ar/tr, mirroring `src/i18n/locales`; anything else reads English,
 which for a user who has not yet opened the app is the store language they installed from.
 */
enum BundledStrings {
  struct Table {
    /// The language these words are in — `ar`, `tr` or `en`, resolved from the SYSTEM locale.
    ///
    /// It has to travel with them. These four strings are the one place on the widget where the
    /// text does NOT come from the snapshot, so their language is whatever the phone is set to,
    /// while `snapshot.language` is whatever the app is set to — and the two disagree often
    /// enough to matter. Pairing the system-locale sentence with the snapshot-language font put
    /// an Arabic line in Lora, which contains no Arabic glyph at all, for anyone running the app
    /// in English on an Arabic phone; the other direction put an English sentence in a serif
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
        emptyBody: "افتح التطبيق لإكمال الإعداد.",
        staleTitle: "الأوقات تحتاج إلى تحديث",
        staleBody: "افتح التطبيق لتحديثها."
      )
    case "tr":
      return Table(
        language: "tr",
        emptyTitle: "Namaz vakitleri",
        emptyBody: "Kurulum için Simple Prayer'ı açın.",
        staleTitle: "Vakitler güncellenmeli",
        staleBody: "Güncellemek için Simple Prayer'ı açın."
      )
    default:
      return Table(
        language: "en",
        emptyTitle: "Prayer times",
        emptyBody: "Open Simple Prayer to set up.",
        staleTitle: "Times need a refresh",
        staleBody: "Open Simple Prayer to update them."
      )
    }
  }
}
