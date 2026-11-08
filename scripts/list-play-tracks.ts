#!/usr/bin/env bun

/**
 * Lists the tracks Google Play will actually accept for an app, by asking Play rather than guessing.
 *
 *   bun scripts/list-play-tracks.ts <service-account.json> [packageName]
 *
 * ## Why this exists
 *
 * A Play track name is a *string with a form-factor prefix* — `alpha` is the phone's closed testing
 * track, `wear:alpha` is Wear OS's. There is no separate form-factor field anywhere: not in the
 * Play API, not in `eas.json`. So the only failure mode is a name that does not exist, and Play
 * reports it identically whether the form factor is missing, the track was never created, or the
 * track simply has a different name — `Track not found: wear:alpha`, five retries, submission dead.
 *
 * That message has now caused three wrong diagnoses in this project (internal notes), and
 * every one of them cost a build to discover, because the submission only runs *after* a green
 * build. This asks the question directly and costs nothing.
 *
 * The catch it exists to catch: Play allows SEVERAL closed testing tracks. Only the built-in one is
 * called "Alpha". A closed track you created yourself has its own name, so a console that plainly
 * shows a Wear OS closed track can coexist with `wear:alpha` genuinely not existing.
 *
 * ## The credential
 *
 * The same Google service-account JSON that EAS submits with — the one created when Play submission
 * was first set up. If it is not on this machine, make a new key for that service account in Google
 * Cloud Console (IAM → Service Accounts → Keys → Add key → JSON). Read-only here: this script only
 * ever opens an edit and deletes it again, never uploads or promotes anything.
 *
 * Nothing is written to the repo, and the key path is never echoed.
 */

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** The app whose tracks are listed when none is named. */
const DEFAULT_PACKAGE = 'app.simpleprayer';

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Signs a JWT and trades it for an access token.
 *
 * Done by hand rather than with `google-auth-library` so this script adds no dependency to the app
 * for the sake of a diagnostic.
 */
async function accessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(account.private_key));

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  });

  const body = (await response.json()) as { access_token?: string; error_description?: string };
  if (!response.ok || body.access_token === undefined) {
    throw new Error(`Could not authenticate: ${body.error_description ?? response.statusText}`);
  }
  return body.access_token;
}

async function main(): Promise<void> {
  const [keyPath, packageName = DEFAULT_PACKAGE] = process.argv.slice(2);
  if (keyPath === undefined) {
    console.error('Usage: bun scripts/list-play-tracks.ts <service-account.json> [packageName]');
    process.exit(1);
  }

  const account = JSON.parse(readFileSync(keyPath, 'utf8')) as ServiceAccount;
  const token = await accessToken(account);
  const auth = { Authorization: `Bearer ${token}` };

  // Tracks are only readable inside an edit. It is discarded again below, so nothing is changed.
  const edit = await fetch(`${API}/${packageName}/edits`, { method: 'POST', headers: auth });
  if (!edit.ok) {
    throw new Error(`Could not open an edit for ${packageName}: ${await edit.text()}`);
  }
  const { id } = (await edit.json()) as { id: string };

  try {
    const response = await fetch(`${API}/${packageName}/edits/${id}/tracks`, { headers: auth });
    if (!response.ok) {
      throw new Error(`Could not list tracks: ${await response.text()}`);
    }
    const { tracks = [] } = (await response.json()) as {
      tracks?: { track: string; releases?: { name?: string; status?: string }[] }[];
    };

    console.log(`\nTracks Play will accept for ${packageName}:\n`);
    for (const { track, releases = [] } of tracks) {
      const latest = releases[0];
      const detail =
        latest === undefined
          ? 'no releases yet'
          : `${latest.name ?? 'unnamed'} — ${latest.status ?? 'unknown status'}`;
      // A `wear:` prefix is the whole of what makes a track a Wear track.
      const factor = track.includes(':') ? track.split(':')[0] : 'phone';
      console.log(`  ${track.padEnd(28)} (${factor})  ${detail}`);
    }
    console.log(`\nPut one of those strings in eas.json's submit profile, exactly as printed.\n`);
  } finally {
    // Leaving an edit open blocks the next one; delete it even if listing threw.
    await fetch(`${API}/${packageName}/edits/${id}`, { method: 'DELETE', headers: auth });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
