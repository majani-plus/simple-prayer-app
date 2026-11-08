import ExpoModulesCore
import ExpoNotifications
import Foundation

/**
 Registers [PrayerMarksResponder] at the only moment early enough to be useful.

 When the user presses **Prayed** with the app force-quit, iOS launches it into the background and
 calls `application(_:didFinishLaunchingWithOptions:)` before delivering the response. Registering
 here means the handler is in place by then, natively, whether or not the JavaScript runtime ever
 finishes starting.

 Registering from the Expo module instead would be too late: modules are built with the React
 context, which in a background launch may not exist at all.

 Touching `NotificationCenterManager.shared` is also what makes it claim the
 `UNUserNotificationCenter` delegate, which must happen inside `didFinishLaunching` for a response
 that launched the app to be delivered at all. `expo-notifications`' own subscriber does the same;
 doing it twice is harmless, and doing it here means we do not depend on which subscriber runs
 first.
 */
public final class PrayerMarksAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    NotificationCenterManager.shared.addDelegate(PrayerMarksResponder.shared)
    return true
  }
}
