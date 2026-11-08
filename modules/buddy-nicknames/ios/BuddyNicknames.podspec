Pod::Spec.new do |s|
  s.name           = 'BuddyNicknames'
  s.version        = '1.0.0'
  s.summary        = 'What buddy mode leaves for the processes that run when no JS can.'
  s.description    = 'Mirrors { pairId: nickname } into the App Group so the notification ' \
                     'service extension can name a buddy in a push the relay never saw a name ' \
                     'in, and — since D180 — the outbox, the widget-sent ledger and the relay ' \
                     'secret a widget tap needs to tell the buddies by itself.'
  s.author         = 'Simple Prayer'
  s.homepage       = 'https://simpleprayer.app'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
