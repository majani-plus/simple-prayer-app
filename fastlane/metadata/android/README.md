# Android store metadata

These folders serve two readers:

- **Google Play** reads only `changelogs/<versionCode>.txt` from here, through
  `fastlane supply ... --skip_upload_metadata true --skip_upload_images true --skip_upload_screenshots true`.
  The Play listing text itself lives in `docs/STORE_DESCRIPTIONS.md` and is pasted in the console.
- **F-Droid and IzzyOnDroid** read everything: `title.txt`, `short_description.txt`,
  `full_description.txt`, the changelogs and `images/`. The text describes the version **without
  Google services** (`FOSS_BUILD=1`, D212): no push, no crash reports, no tip jar, no Wear OS.

So never run `fastlane supply` against Play without the three `--skip_upload_*` flags above, or the
Play listing would be overwritten with the F-Droid text.
