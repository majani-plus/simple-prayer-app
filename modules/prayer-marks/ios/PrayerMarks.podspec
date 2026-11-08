Pod::Spec.new do |s|
  s.name           = 'PrayerMarks'
  s.version        = '1.0.0'
  s.summary        = 'The Prayed action on the adhan notification, and the queue it writes to.'
  s.description    = 'Records a prayer marked from a notification while the app is not running, ' \
                     'and hands it to the app to write through the ordinary domain path.'
  s.author         = 'Simple Prayer'
  s.homepage       = 'https://simpleprayer.app'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # The action arrives through expo-notifications' own UNUserNotificationCenter delegate; see
  # PrayerMarksResponder for why that is the seam rather than claiming the delegate ourselves.
  s.dependency 'ExpoNotifications'
  # The app process's buddy sender (D194), so a mark made here tells the buddies without JS.
  s.dependency 'BuddyNicknames'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
