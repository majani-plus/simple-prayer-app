import SwiftUI

/**
 The watch app's shell: the Today hero is home, the day's rows wait one crown-turn BELOW it, and
 the qibla is one page ABOVE it (vertical paging, the watchOS 10 idiom) — both on the night-paper
 ground that melts into the bezel (V0a). With nothing to show yet — no envelope, or one past its
 horizon — the whole app is the honest bundled state.

 The qibla used to be the page AFTER the rows, so reaching it meant turning the crown through the
 whole schedule first. Owner, 2026-09-15: *"I'd like the Qibla to be at the top … scroll down for
 schedule, scroll up friction scroll to get to qibla, so I don't have to go through home whole
 list to reach qibla."* So the app opens on Today, a turn down reads the rows, and a turn UP past
 the hero's top snaps one page to the qibla (D171). The Wear twin needs no change: there the
 qibla is one horizontal swipe from anywhere on the Today page.
 */
struct ContentView: View {
  @StateObject private var model = WatchModel()
  @Environment(\.scenePhase) private var scenePhase
  // Screenshot staging only: `simctl launch … -SPQibla` opens on the qibla page, because the
  // simulator offers no way to turn a digital crown. Inert for every real launch.
  @State private var page: Page =
    ProcessInfo.processInfo.arguments.contains("-SPQibla") ? .qibla : .today

  var body: some View {
    ZStack {
      NightPaperGround()
      if let envelope = model.envelope {
        if let qibla = envelope.qibla {
          // Qibla FIRST in the stack so it is the page above Today; `page` starts on Today,
          // so the app still opens on the hero and the qibla is the turn-up away.
          TabView(selection: $page) {
            QiblaView(qibla: qibla, language: envelope.snapshot.language).tag(Page.qibla)
            TodayView(model: model, envelope: envelope).tag(Page.today)
          }
          .tabViewStyle(.verticalPage)
        } else {
          TodayView(model: model, envelope: envelope)
        }
      } else {
        WatchEmptyView(stale: model.hasStoredEnvelope)
      }
    }
    .onChange(of: scenePhase) { _, phase in
      // A foreground is the one moment worth a re-read: the phone may have shipped while this
      // app slept, and WCSession applied it with no view alive.
      if phase == .active {
        model.reload()
      }
    }
  }
}

/// The vertical pager's two pages, top to bottom.
private enum Page: Hashable {
  case qibla
  case today
}
