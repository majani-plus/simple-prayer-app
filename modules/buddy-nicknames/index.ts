/**
 * `buddy-nicknames` — the bridge between the app and the processes that run when no JS can.
 *
 * ## Why this exists
 *
 * Two things buddy mode needs happen outside the React runtime entirely:
 *
 * 1. **A buddy notification arrives.** It was written by the *sending* phone, which knows the
 *    receiver's language but has no idea what the receiver calls them — the nickname, the icon and
 *    the colour are chosen by the person looking at them and have never crossed a network (D174).
 *    So the relay forwards two sentences: "Your buddy prayed Dhuhr." and the same sentence with
 *    `{}` where a name belongs. The hole is filled on arrival by native code:
 *    - **iOS**: a `UNNotificationServiceExtension` (`targets/notify/`), which the system hands
 *      every `mutable-content` notification before it is displayed — app closed, phone locked.
 *    - **Android**: a `FirebaseMessagingService` that sits in front of Expo's own (which registers
 *      at `android:priority="-1"` precisely so an app can), rewrites the title, and hands it on.
 *
 * 2. **A seal is tapped on a home-screen widget** (D180). That runs in a widget extension on iOS
 *    and a broadcast receiver on Android, and until the app was next opened it only ever appended
 *    to the D92 queue — so a prayer marked from the homescreen told nobody for hours. Now the
 *    tapping process posts to the relay itself, which means it needs the same three things the app
 *    needs: the relay secret, who to tell, and what to say to each of them.
 *
 * None of those processes can read MMKV or `expo-secure-store`. So this module mirrors what they
 * need into storage they *can* read: the App Group `UserDefaults` on iOS (the same container the
 * widgets and the D92 queue use), this module's own `SharedPreferences` plus the Android Keystore
 * on Android.
 *
 * ## The four drawers, and the fence between them
 *
 * - **nicknames** — `{ pairId: nickname }`, and nothing else, read by the notification rewriters.
 * - **outbox** — the pairs to post to, and for each, the sentence to send in their language. It
 *   carries **no nickname, no icon, no colour**: a name is chosen here, used here, and goes
 *   nowhere, and `src/__tests__/privacyClaims.test.ts` fails the build if one ever reaches it.
 * - **widget-sent** — what a widget tap already told the buddies, so the app can fold it into its
 *   own ledger and never announce the same prayer twice.
 * - **secret** — this phone's relay credentials, in the keychain under the App Group access group
 *   (iOS) or under an Android Keystore key (Android). Never in the drawers above.
 *
 * All four are cleared when buddy mode is switched off, so a phone that left the feature holds
 * nothing. None of them is the widget snapshot, which carries initials and a colour and must never
 * carry a name (`privacyClaims.test.ts` pins that too).
 *
 * Resolved lazily and optionally like every sibling module: in Jest, on web, or in a build made
 * before this module existed, every call is a silent no-op — the notification shows the sentence it
 * was sent, and the widget tap waits for the app to do the telling, exactly as it did before D180.
 */

import { requireOptionalNativeModule } from 'expo';

interface BuddyNicknamesNativeModule {
  /** Replace the whole map. Passing an empty object is how the last nickname is removed. */
  setNicknames(json: string): Promise<void>;
  /** Forget every nickname — buddy mode switched off, or the device left. */
  clearNicknames(): Promise<void>;
  /** Replace the whole outbox: who to post to, and the words for each of them. */
  setOutbox(json: string): Promise<void>;
  clearOutbox(): Promise<void>;
  /** Hand back what the widget has already sent, and empty the ledger in the same breath. */
  takeWidgetSent(): Promise<string>;
  setSecret(json: string): Promise<void>;
  getSecret(): Promise<string | null>;
  deleteSecret(): Promise<void>;
}

function native(): BuddyNicknamesNativeModule | null {
  return requireOptionalNativeModule<BuddyNicknamesNativeModule>('BuddyNicknames');
}

/**
 * Mirror the roster's nicknames for the notification rewriters.
 *
 * Pairs with no nickname yet — an inviter who has not named the person who accepted — are simply
 * absent, which is exactly what the rewriters treat as "leave the sentence alone".
 */
export async function setBuddyNicknames(nicknames: Record<string, string>): Promise<void> {
  const module = native();
  if (!module) return;
  try {
    await module.setNicknames(JSON.stringify(nicknames));
  } catch {
    // A nickname that could not be stored costs a notification its warmth, nothing more.
  }
}

/** Forget them all. Called when buddy mode is switched off. */
export async function clearBuddyNicknames(): Promise<void> {
  const module = native();
  if (!module) return;
  try {
    await module.clearNicknames();
  } catch {
    // Same: best-effort. The next write replaces whatever is there.
  }
}

/**
 * Leave the widget everything it needs to tell the buddies by itself.
 *
 * The JSON is built by `src/services/buddyOutbox.ts`, which is also where the shape is documented
 * and pinned. Failure costs the feature nothing it had before: the app still tells them on its
 * next open.
 */
export async function setBuddyOutbox(json: string): Promise<void> {
  const module = native();
  if (!module) return;
  try {
    await module.setOutbox(json);
  } catch {
    // Best-effort, like every write here.
  }
}

/** Forget who to tell. Called when buddy mode is switched off, or the last pair leaves. */
export async function clearBuddyOutbox(): Promise<void> {
  const module = native();
  if (!module) return;
  try {
    await module.clearOutbox();
  } catch {
    // Best-effort.
  }
}

/**
 * What a widget tap already posted, emptied as it is handed over.
 *
 * Returns the raw JSON — validating it is the caller's job, because the caller is the one that
 * knows what a valid entry is. `[]` for every failure, which reads as "the widget told nobody" and
 * has the app tell them itself. Telling a buddy twice is the cost of being wrong here, and it is
 * a smaller cost than not telling them at all.
 */
export async function takeBuddyWidgetSent(): Promise<string> {
  const module = native();
  if (!module) return '[]';
  try {
    return await module.takeWidgetSent();
  } catch {
    return '[]';
  }
}

/**
 * The relay credentials, where every process of this app can reach them.
 *
 * Keychain (iOS, under the App Group access group) / Android Keystore. `null` for every failure,
 * which the credential store reads as "buddy mode is not set up" — see
 * `src/services/buddyCredentials.ts`, which owns the migration off `expo-secure-store`.
 */
export async function getBuddySecret(): Promise<string | null> {
  const module = native();
  if (!module) return null;
  try {
    return await module.getSecret();
  } catch {
    return null;
  }
}

/** @returns false when it could not be stored — buddy mode then stays off rather than unsafe. */
export async function setBuddySecret(json: string): Promise<boolean> {
  const module = native();
  if (!module) return false;
  try {
    await module.setSecret(json);
    return true;
  } catch {
    return false;
  }
}

/** Forget it. Called when buddy mode is switched off. */
export async function deleteBuddySecret(): Promise<void> {
  const module = native();
  if (!module) return;
  try {
    await module.deleteSecret();
  } catch {
    // Best-effort; the pairs it belonged to are already forgotten.
  }
}
