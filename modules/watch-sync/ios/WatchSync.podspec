Pod::Spec.new do |s|
  s.name           = 'WatchSync'
  s.version        = '1.0.0'
  s.summary        = 'The watch envelope mailbox: the app deposits, the paired watch reads.'
  s.description    = 'Ships the pre-resolved watch envelope over WCSession and receives the ' \
                     'watch\'s pending marks into the D92 queue. Never schedules a reminder, ' \
                     'never writes the prayer log.'
  s.author         = 'Simple Prayer'
  s.homepage       = 'https://simpleprayer.app'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WatchConnectivity'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
