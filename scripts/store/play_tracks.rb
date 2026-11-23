# Usage: ruby play_tracks.rb <key.json> <package>   (read-only: opens an edit, lists tracks, deletes the edit)
require 'googleauth'
require 'google/apis/androidpublisher_v3'

key, pkg = ARGV
svc = Google::Apis::AndroidpublisherV3::AndroidPublisherService.new
svc.authorization = Google::Auth::ServiceAccountCredentials.make_creds(
  json_key_io: File.open(key), scope: 'https://www.googleapis.com/auth/androidpublisher'
)
edit = svc.insert_edit(pkg)
svc.list_edit_tracks(pkg, edit.id).tracks.each do |t|
  (t.releases || []).each do |r|
    puts "#{t.track}: #{r.status} #{r.version_codes&.join(',')} #{r.name} fraction=#{r.user_fraction}"
  end
end
svc.delete_edit(pkg, edit.id)
