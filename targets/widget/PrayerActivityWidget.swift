import ActivityKit
import SwiftUI
import WidgetKit

/**
 The prayer Live Activity (D27, D112): one card, three faces, a native countdown. Night-paper in
 both system themes — an Activity sits on wallpaper like a notification, and the app's
 notifications wear the dark card there too.

 - **due** — the open window's countdown, the seal as the "I prayed" button (D109's idiom).
 - **upcoming** — the lead card: the next prayer approaching while the current one is still
   unprayed; the countdown runs to the subject's START, and the seal marks the CURRENT prayer
   (`markDay`/`markPrayer`). When the subject's start passes, `staleDate` re-renders the card
   (`isStale`) and it draws the subject's own due face — no process involved.
 - **prayed** — the seal answered; set by `MarkPrayedActivityIntent` on its way out.

 Everything shown is pre-rendered text from the attributes; the only living element is the
 timer, whose numerals follow the system locale — the accepted caveat the widgets share.
 */

/// Which face to draw. A lead card past its subject's start is that prayer's due card now.
private func face(
  _ state: PrayerActivityAttributes.ContentState, isStale: Bool
) -> String {
  if state.status == "prayed" { return "prayed" }
  if state.status == "upcoming" && !isStale { return "upcoming" }
  return "due"
}

/// The instant the visible countdown runs to: the subject's start on the lead face, the
/// window's end everywhere else.
private func countdownEnd(_ a: PrayerActivityAttributes, face: String) -> Date {
  Date(timeIntervalSince1970: (face == "upcoming" ? a.startAt : a.endAt) / 1000)
}

/// What the seal asserts: the due face marks the card's subject; the lead face marks the
/// CURRENT prayer it is holding the door for.
private func markTarget(_ a: PrayerActivityAttributes, face: String) -> (day: String, prayer: String) {
  face == "upcoming" ? (a.markDay, a.markPrayer) : (a.day, a.prayer)
}

struct PrayerActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: PrayerActivityAttributes.self) { context in
      PrayerActivityCard(
        attributes: context.attributes,
        face: face(context.state, isStale: context.isStale)
      )
      .environment(\.layoutDirection, context.attributes.rtl ? .rightToLeft : .leftToRight)
    } dynamicIsland: { context in
      let a = context.attributes
      let f = face(context.state, isStale: context.isStale)
      let end = countdownEnd(a, face: f)
      // The Island needs the direction said out loud, exactly as the card above does.
      //
      // A widget extension takes its layoutDirection from the SYSTEM, and this app's direction
      // follows the APP language (D41) — which is precisely why the snapshot carries an explicit
      // `rtl` flag at all. The lock-screen closure has always attached it; the Island's expanded
      // regions never did, and every one of them is direction-sensitive (`VStack(alignment:)`,
      // `.multilineTextAlignment(.trailing)`). For an Arabic user on an English-language phone
      // that meant the card mirrored and the expanded Island did not, inside one feature at one
      // moment. It goes on the region CONTENTS: `DynamicIsland`'s builder is not a view and
      // takes no modifiers. compactLeading/compactTrailing/minimal are left alone — those are
      // physical slots either side of the cutout, not a layout that can mirror.
      let rtl: LayoutDirection = a.rtl ? .rightToLeft : .leftToRight
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 10) {
            ActivitySeal(attributes: a, face: f, size: 30)
            VStack(alignment: .leading, spacing: 0) {
              Text(f == "prayed" ? a.markedText : a.name)
                .font(WidgetFonts.ui(a.language, 16, weight: .semibold))
                .foregroundStyle(WidgetPalette.color("ink", night: true))
              if f != "prayed" {
                Text(f == "upcoming" ? (a.startsCaption ?? a.untilText) : a.untilText)
                  .font(WidgetFonts.ui(a.language, 11, italic: true))
                  .foregroundStyle(WidgetPalette.color("muted", night: true))
                  .lineLimit(1)
                  .minimumScaleFactor(0.75)
              }
            }
          }
          .environment(\.layoutDirection, rtl)
        }
        DynamicIslandExpandedRegion(.trailing) {
          if f != "prayed" {
            VStack(alignment: .trailing, spacing: 0) {
              Text(timerInterval: countdownRange(to: end), countsDown: true)
                .font(WidgetFonts.ui(a.language, 22, weight: .bold))
                .foregroundStyle(WidgetPalette.color("accentDeep", night: true))
                .frame(maxWidth: 90)
                .multilineTextAlignment(.trailing)
              Text(f == "upcoming" ? (a.untilStartLabel ?? a.leftToPray) : a.leftToPray)
                .font(WidgetFonts.ui(a.language, 10, italic: true))
                .foregroundStyle(WidgetPalette.color("accent", night: true))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            }
            .environment(\.layoutDirection, rtl)
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          if f == "due" {
            WindowProgress(startAt: a.startAt, endAt: a.endAt)
              .environment(\.layoutDirection, rtl)
          } else if f == "upcoming", let still = a.stillToPray {
            Text(still)
              .font(WidgetFonts.ui(a.language, 11, italic: true))
              .foregroundStyle(WidgetPalette.color("muted", night: true))
              .lineLimit(1)
              .minimumScaleFactor(0.75)
              .environment(\.layoutDirection, rtl)
          }
        }
      } compactLeading: {
        SealView(skin: f == "prayed" ? .prayed : .unloggedCurrent, size: 16, night: true)
      } compactTrailing: {
        if f == "prayed" {
          EmptyView()
        } else {
          // The one line in this family that used to name its face instead of taking the
          // language, and the one that could least afford to: `Text(timerInterval:)` is drawn by
          // the system in the SYSTEM locale's numerals, so on an Arabic-locale phone it emits
          // U+0660-range digits — and Lora contains no Arabic-Indic digit at all (measured from
          // the shipped TTF). The compact view is the one a Live Activity is seen in all day.
          //
          // The width had been sized for Lora's digit advance, and the new face is wider in the
          // hour form: Noto Naskh SemiBold at the resolved 13.8pt draws every digit at 6.555pt
          // and the colon at 3.464, so "١:٥٩:٥٩" measures 46.3pt against this 44pt frame, and
          // compactTrailing's own width is capped by the system — widening the frame is not
          // something the slot would necessarily honour. So the countdown is told to SHRINK
          // rather than truncate: a clipped countdown is unreadable, a slightly smaller one is
          // not. Arabic only — `nil`/`1` are the defaults, so en/tr render byte-identically.
          Text(timerInterval: countdownRange(to: end), countsDown: true)
            .font(WidgetFonts.ui(a.language, 12, weight: .semibold))
            .foregroundStyle(WidgetPalette.color("accentDeep", night: true))
            .frame(maxWidth: 44)
            .multilineTextAlignment(.trailing)
            // One line in every language: at large text sizes en/tr wrapped to two lines and
            // clipped in the 44pt slot. Shrinking never kicks in unless it would overflow.
            .lineLimit(1)
            .minimumScaleFactor(0.8)
        }
      } minimal: {
        SealView(skin: f == "prayed" ? .prayed : .unloggedCurrent, size: 14, night: true)
      }
    }
  }
}

/// The seal as the button (D109's idiom) — everywhere a face invites a mark; a plain seal on
/// the marked face. `Button(intent:)` in an Activity needs iOS 17, which this extension is.
private struct ActivitySeal: View {
  let attributes: PrayerActivityAttributes
  let face: String
  let size: CGFloat

  var body: some View {
    if face == "prayed" {
      SealView(skin: .prayed, size: size, night: true)
    } else {
      let target = markTarget(attributes, face: face)
      Button(intent: MarkPrayedActivityIntent(day: target.day, prayer: target.prayer)) {
        SealView(skin: .unloggedCurrent, size: size, night: true)
      }
      .buttonStyle(.plain)
      .accessibilityLabel(attributes.prayedLabel)
    }
  }
}

struct PrayerActivityCard: View {
  let attributes: PrayerActivityAttributes
  let face: String

  var body: some View {
    let a = attributes
    let end = countdownEnd(a, face: face)
    VStack(spacing: 12) {
      HStack(spacing: 13) {
        ActivitySeal(attributes: a, face: face, size: 40)
        VStack(alignment: .leading, spacing: 1) {
          if face == "prayed" {
            Text(a.markedText)
              .font(WidgetFonts.ui(a.language, 19, weight: .semibold))
              .foregroundStyle(WidgetPalette.color("ink", night: true))
          } else {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
              Text(a.name)
                .font(WidgetFonts.ui(a.language, 19, weight: .semibold))
                .foregroundStyle(WidgetPalette.color("ink", night: true))
              if let arabic = a.arabicName {
                Text(arabic)
                  .font(WidgetFonts.amiri(17.25))
                  .foregroundStyle(WidgetPalette.color("muted", night: true))
              }
            }
            Text(face == "upcoming" ? (a.startsCaption ?? a.untilText) : a.untilText)
              .font(WidgetFonts.ui(a.language, 12, italic: true))
              .foregroundStyle(WidgetPalette.color("muted", night: true))
              .lineLimit(1)
              .minimumScaleFactor(0.75)
          }
        }
        Spacer(minLength: 8)
        if face != "prayed" {
          VStack(alignment: .trailing, spacing: 0) {
            Text(timerInterval: countdownRange(to: end), countsDown: true)
              .font(WidgetFonts.ui(a.language, 26, weight: .bold))
              .foregroundStyle(WidgetPalette.color("accentDeep", night: true))
              .frame(maxWidth: 110)
              .multilineTextAlignment(.trailing)
            Text(face == "upcoming" ? (a.untilStartLabel ?? a.leftToPray) : a.leftToPray)
              .font(WidgetFonts.ui(a.language, 11, italic: true))
              .foregroundStyle(WidgetPalette.color("accent", night: true))
              .lineLimit(1)
              .minimumScaleFactor(0.75)
          }
        }
      }
      if face == "due" {
        WindowProgress(startAt: a.startAt, endAt: a.endAt)
      } else if face == "upcoming", let still = a.stillToPray {
        Text(still)
          .font(WidgetFonts.ui(a.language, 12, italic: true))
          .foregroundStyle(WidgetPalette.color("accent", night: true))
          .lineLimit(1)
          .minimumScaleFactor(0.75)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .padding(.init(top: 15, leading: 17, bottom: 14, trailing: 17))
    .activityBackgroundTint(composite(WidgetPalette.color("bg", night: true), WidgetPalette.color("cardBright", night: true)))
    .activitySystemActionForegroundColor(WidgetPalette.color("accentDeep", night: true))
  }
}

/// The window filling as it passes — it empties nothing and counts nothing against anyone.
struct WindowProgress: View {
  let startAt: Double
  let endAt: Double

  var body: some View {
    ProgressView(
      timerInterval: Date(timeIntervalSince1970: startAt / 1000)...Date(timeIntervalSince1970: endAt / 1000),
      countsDown: false
    ) { EmptyView() } currentValueLabel: { EmptyView() }
      .progressViewStyle(.linear)
      .tint(WidgetPalette.color("accent", night: true))
      .frame(height: 5)
  }
}
