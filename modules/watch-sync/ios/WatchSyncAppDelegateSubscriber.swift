import ExpoModulesCore
import Foundation

/**
 Activates the WCSession at the only moment early enough to be useful.

 A `transferUserInfo` from the watch (an "I prayed" pressed with the phone in a pocket) can wake
 the app into the background; the session's delegate must already be set when that delivery
 arrives, whether or not the JavaScript runtime ever finishes starting. Registering from the Expo
 module would be too late — modules are built with the React context, which a background launch
 may never create. The same reasoning, and the same shape, as `PrayerMarksAppDelegateSubscriber`.
 */
public final class WatchSyncAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    WatchSessionManager.shared.activate()
    return true
  }
}
