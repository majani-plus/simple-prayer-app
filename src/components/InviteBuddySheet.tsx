import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, View } from 'react-native';

import { AppText } from './AppText';
import { BuddyNameForm } from './BuddyNameForm';
import { PairedContent, usePairedHaptic } from './BuddyPairedSheet';
import { InviteCode } from './InviteCode';
import { SheetAction, SheetShell } from './SheetKit';
import { useNow } from '@/hooks/useNow';
import { firstFreeAvatar, formatInviteCode, type BuddyAvatar } from '@/domain/buddies';
import { createBuddyCredentialStore } from '@/services/buddyCredentials';
import { getBuddyRelay } from '@/services/buddyRelay';
import {
  useBuddyActions,
  useBuddyInvite,
  useBuddyPairs,
  useInviteFor,
  useJustPaired,
} from '@/stores/buddyStore';
import { formatDuration } from '@/utils/formatTime';
import { spacing, useTheme } from '@/theme';

/**
 * Inviting somebody, start to finish, in one sheet.
 *
 * Three steps and no navigation: who is this for (name + face, chosen now because the person is
 * in the room or about to be messaged) → the code, shown as a QR, as letters to read aloud and as
 * a link to share, with the time it has left → and, the moment they accept, the code collapses
 * into "Amina is your buddy now" **in place**. The whole point of a sheet is that the inviter can
 * sit with it open while they wait; `useBuddySync` polls the roster every few seconds while an
 * invite is live, so "the moment" is a few seconds at most.
 *
 * Closing the sheet early loses nothing: the invite and the name are in the store, the Buddies
 * screen shows an *invite pending* row with the time left, and tapping that row reopens this
 * sheet at the code. Cancelling withdraws the code on the relay, so it stops working.
 */

export const PAIR_LINK_BASE = 'https://simpleprayer.app/b/';

export interface InviteBuddySheetProps {
  visible: boolean;
  onClose: () => void;
}

export function InviteBuddySheet({ visible, onClose }: InviteBuddySheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const invite = useBuddyInvite();
  const inviteFor = useInviteFor();
  const pairs = useBuddyPairs();
  const justPaired = useJustPaired();
  const actions = useBuddyActions();

  const taken = useMemo(() => pairs.map((pair) => ({ icon: pair.icon, color: pair.color })), [pairs]);
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState<BuddyAvatar | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // The global "new buddy" sheet stays out of the way while this one is open: an acceptance that
  // arrives now is shown here, where the person is already looking.
  useEffect(() => {
    actions.setInviteSheetOpen(visible);
    return () => actions.setInviteSheetOpen(false);
  }, [visible, actions]);

  const paired = useMemo(() => {
    const id = justPaired[0];
    return id === undefined ? null : (pairs.find((pair) => pair.pairId === id && !pair.pending) ?? null);
  }, [justPaired, pairs]);

  const step: 'naming' | 'code' | 'paired' = paired ? 'paired' : invite ? 'code' : 'naming';
  usePairedHaptic(visible && step === 'paired');

  // Once a minute is enough for a number of hours; the row on the Buddies screen ticks the same.
  const now = useNow(60_000);
  const timeLeft = invite
    ? formatDuration(invite.expiresAt - now.getTime(), { style: 'long', countdown: false })
    : '';

  const chosen = useMemo<BuddyAvatar>(
    () => avatar ?? firstFreeAvatar(taken) ?? { icon: 'initials', color: 'ocean' },
    [avatar, taken]
  );

  const makeInvite = useCallback(() => {
    setBusy(true);
    setFailed(false);
    actions.setInviteFor({ ...chosen, nickname });
    void (async () => {
      const auth = await createBuddyCredentialStore().read();
      if (!auth) {
        setFailed(true);
        return;
      }
      const result = await getBuddyRelay().createInvite(auth);
      if (!result.ok) {
        setFailed(true);
        return;
      }
      actions.setInvite({ code: result.value.code, expiresAt: result.value.expiresAt });
    })()
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  }, [actions, chosen, nickname]);

  const share = useCallback(() => {
    if (!invite) return;
    // The OS sheet is what makes AirDrop and Quick Share work for two people in a room, without
    // this app asking for a single new permission.
    void Share.share({ message: `${PAIR_LINK_BASE}${invite.code}` }).catch(() => undefined);
  }, [invite]);

  const cancel = useCallback(() => {
    const code = invite?.code;
    // Local first, so the row is gone the moment it is tapped; the relay is told next, and a code
    // that could not be withdrawn simply runs out on its own within the day.
    actions.setInvite(null);
    onClose();
    if (!code) return;
    void (async () => {
      const auth = await createBuddyCredentialStore().read();
      if (auth) await getBuddyRelay().withdrawInvite(auth, code);
    })().catch(() => undefined);
  }, [invite, actions, onClose]);

  const finish = useCallback(() => {
    if (paired) actions.acknowledgePaired(paired.pairId);
    setNickname('');
    setAvatar(null);
    onClose();
  }, [paired, actions, onClose]);

  const name = (inviteFor?.nickname || nickname) || t('buddy.unnamed');

  if (step === 'paired' && paired) {
    return (
      <SheetShell visible={visible} title={t('buddy.settings.title')} onClose={finish} testID="buddy-invite-sheet">
        <PairedContent pair={paired} onDone={finish} testID="buddy-invite-paired" />
      </SheetShell>
    );
  }

  if (step === 'code' && invite) {
    return (
      <SheetShell
        visible={visible}
        title={t('buddy.invite.titleFor', { name })}
        onClose={onClose}
        testID="buddy-invite-sheet"
      >
        <View style={{ gap: spacing.lg, alignItems: 'center' }}>
          <AppText variant="caption" color={colors.muted} style={{ textAlign: 'center' }}>
            {t('buddy.invite.body')}
          </AppText>
          <InviteCode
            testID="buddies-invite"
            link={`${PAIR_LINK_BASE}${invite.code}`}
            display={formatInviteCode(invite.code)}
          />
          <AppText testID="buddies-invite-expiry" variant="caption" color={colors.faint}>
            {t('buddy.invite.expiresIn', { duration: timeLeft })}
          </AppText>
          <View style={{ alignSelf: 'stretch' }}>
            <SheetAction label={t('buddy.invite.share')} onPress={share} emphasis testID="buddies-share" />
            <SheetAction label={t('buddy.invite.done')} onPress={onClose} testID="buddies-invite-done" />
            <SheetAction label={t('buddy.invite.cancel')} onPress={cancel} testID="buddies-invite-cancel" />
          </View>
        </View>
      </SheetShell>
    );
  }

  return (
    <SheetShell
      visible={visible}
      title={t('buddy.naming.title')}
      onClose={onClose}
      keyboard
      testID="buddy-invite-sheet"
    >
      <View style={{ gap: spacing.lg }}>
        <AppText variant="caption" color={colors.muted}>
          {t('buddy.naming.body')}
        </AppText>
        <BuddyNameForm
          nickname={nickname}
          onNickname={setNickname}
          avatar={chosen}
          onAvatar={setAvatar}
          taken={taken}
          autoFocus
          testID="buddies-naming"
        />
        {failed ? (
          <AppText testID="buddies-failed" variant="caption" color={colors.missed}>
            {t('buddy.invite.failed')}
          </AppText>
        ) : null}
        <View>
          {busy ? null : (
            <SheetAction label={t('buddy.naming.next')} onPress={makeInvite} emphasis testID="buddies-naming-next" />
          )}
          <SheetAction label={t('buddy.accept.cancel')} onPress={onClose} testID="buddies-naming-cancel" />
        </View>
      </View>
    </SheetShell>
  );
}
