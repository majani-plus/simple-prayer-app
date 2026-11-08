import SwiftUI

/**
 The Apple Watch app (Milestone V) — a companion renderer of the phone's pre-resolved envelope.
 No domain logic lives here, ever (D102/D92): the phone computes, the watch draws, and a seal tap
 travels back as a queue entry for the app to drain.

 V3 scaffold: the transport and storage are real; the Today/qibla UI lands in V4 against the
 approved V0a canvases.
 */
@main
struct SimplePrayerWatchApp: App {
  init() {
    PhoneSessionClient.shared.activate()
  }

  var body: some Scene {
    WindowGroup {
      ContentView()
    }
  }
}
