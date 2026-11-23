# Usage: ruby asc_release.rb <asc_api_key.json> <notes.json> <version> <build> [submit]
# notes.json: {"en-US": "...", "ar-SA": "...", "tr": "...", "ur-PK": "..."}
require 'json'
require 'spaceship'

key_path, notes_path, version, build_number, submit = ARGV
Spaceship::ConnectAPI.token = Spaceship::ConnectAPI::Token.from_json_file(key_path)
app = Spaceship::ConnectAPI::App.find('app.simpleprayer') or abort('app not found')
platform = Spaceship::ConnectAPI::Platform::IOS

v = app.get_edit_app_store_version(platform: platform)
if v.nil?
  Spaceship::ConnectAPI.post_app_store_version(app_id: app.id, attributes: {
    platform: platform, versionString: version, releaseType: 'AFTER_APPROVAL'
  })
  puts "created version #{version}"
elsif v.version_string != version
  v.update(attributes: { versionString: version, releaseType: 'AFTER_APPROVAL' })
  puts "renamed edit version #{v.version_string} -> #{version}"
else
  puts "version #{version} exists (#{v.app_store_state})"
end
v = app.get_edit_app_store_version(platform: platform)

notes = JSON.parse(File.read(notes_path))
v.get_app_store_version_localizations.each do |loc|
  text = notes[loc.locale]
  if text.nil?
    puts "no notes for #{loc.locale}, left as is"
    next
  end
  loc.update(attributes: { whatsNew: text })
  puts "whatsNew set for #{loc.locale}"
end

build = Spaceship::ConnectAPI::Build.all(app_id: app.id, version: version, build_number: build_number).first
abort("build #{build_number} not found yet") if build.nil?
abort("build #{build_number} is #{build.processing_state}, not VALID yet") unless build.processing_state == 'VALID'
v.select_build(build_id: build.id)
puts "build #{build_number} attached"

if submit == 'submit'
  sub = app.create_review_submission(platform: platform)
  sub.add_app_store_version_to_review_items(app_store_version_id: v.id)
  sub.submit_for_review
  puts 'submitted for review'
end
