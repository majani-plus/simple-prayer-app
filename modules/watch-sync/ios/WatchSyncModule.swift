import ExpoModulesCore

/**
 The JS face of the watch bridge — a mailbox, nothing more (`modules/watch-sync/index.ts`
 documents the contract). Never schedules a reminder, never writes the prayer log; marks from the
 watch arrive through `WatchSessionManager`, not through here.
 */
public class WatchSyncModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WatchSync")

    AsyncFunction("pushEnvelope") { (json: String) in
      WatchSessionManager.shared.push(envelope: json)
    }

    AsyncFunction("clearEnvelope") {
      WatchSessionManager.shared.clear()
    }

    AsyncFunction("hasWatch") { () -> Bool in
      WatchSessionManager.shared.hasWatch()
    }

    AsyncFunction("watchState") { () -> [String: Bool] in
      let state = WatchSessionManager.shared.watchState()
      return ["paired": state.paired, "appInstalled": state.appInstalled]
    }
  }
}
