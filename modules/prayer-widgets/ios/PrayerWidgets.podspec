Pod::Spec.new do |s|
  s.name           = 'PrayerWidgets'
  s.version        = '1.0.0'
  s.summary        = 'The widget snapshot mailbox: the app deposits, the widgets read.'
  s.description    = 'Stores the fully-resolved widget snapshot in the App Group and asks ' \
                     'WidgetKit to redraw. Never schedules a reminder, never writes the log.'
  s.author         = 'Simple Prayer'
  s.homepage       = 'https://simpleprayer.app'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # The app process's buddy sender (D194), so a mark made here tells the buddies without JS.
  s.dependency 'BuddyNicknames'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
