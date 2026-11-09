/**
 * `plugins/withKeepNotificationSounds`: release builds shrink resources, and the adhan notification
 * sounds are found only by name (`getIdentifier`), so without this keep rule the shrinker deletes
 * them and reminders play the default sound. Both voice sets must match the rule.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';

import appJson from '../../app.json';
import { freeAdhanSounds } from '../../app.config';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../../plugins/withKeepNotificationSounds') as {
  writeKeepFile(androidRoot: string): string;
};

function normalSounds(): string[] {
  for (const entry of appJson.expo.plugins as unknown[]) {
    if (Array.isArray(entry) && entry[0] === 'expo-notifications') {
      return (entry[1] as { sounds: string[] }).sounds;
    }
  }
  throw new Error('expo-notifications has no sounds in app.json');
}

describe('withKeepNotificationSounds', () => {
  const file = plugin.writeKeepFile(mkdtempSync(join(tmpdir(), 'keep-sounds-')));
  const xml = readFileSync(file, 'utf8');
  const pattern = /tools:keep="([^"]+)"/.exec(xml)?.[1] ?? '';

  it('writes a tools:keep file into res/raw', () => {
    expect(file).toMatch(/app\/src\/main\/res\/raw\/keep_notification_sounds\.xml$/);
    expect(xml).toContain('xmlns:tools="http://schemas.android.com/tools"');
    expect(pattern).toBe('@raw/adhan_*');
  });

  it('covers every notification sound of both voice sets', () => {
    const prefix = pattern.replace('@raw/', '').replace('*', '');
    for (const sound of [...normalSounds(), ...freeAdhanSounds()]) {
      const resource = basename(sound, extname(sound));
      expect({ resource, kept: resource.startsWith(prefix) }).toEqual({ resource, kept: true });
    }
  });

  it('is in app.json, so the Play build keeps them too', () => {
    expect(appJson.expo.plugins).toContain('./plugins/withKeepNotificationSounds');
  });
});
