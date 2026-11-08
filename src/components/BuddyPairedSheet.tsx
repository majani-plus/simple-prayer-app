import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from './AppText';
import { BuddyAvatar } from './BuddyAvatar';
import { BuddyNameForm } from './BuddyNameForm';
import { SheetAction, SheetShell } from './SheetKit';
import { firstFreeAvatar, type BuddyAvatar as BuddyAvatarShape } from '@/domain/buddies';
import {
  useBuddyActions,
  useBuddyPairs,
  useInviteSheetOpen,
  useJustPaired,
  type BuddyPair,
} from '@/stores/buddyStore';
import { spacing, useTheme } from '@/theme';

/**
 * "Amina is your buddy now."
 *
 * The moment an invite is accepted, wherever the inviter happens to be. It can be discovered
 * while they watch their code — the invite sheet then shows this in place, and this sheet stays
 * out of the way — or on a cold launch days later, from the root layout, over whatever screen
 * opened. Either way it is one sheet, one sentence, one Done: not a badge in a list to hunt for.
 *
 * A buddy who arrived before the inviter had named them (an older flow, or a code shared before
 * the naming step existed) is named here instead, with the same form as everywhere else.
 */

/** The badge, the sentence and the Done. Shared with the invite sheet's last step. */
export function PairedContent({
  pair,
  onDone,
  testID,
}: {
  pair: BuddyPair;
  onDone: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const name = pair.nickname || t('buddy.unnamed');

  return (
    <View testID={testID} style={{ gap: spacing.lg, alignItems: 'center' }}>
      <BuddyAvatar avatar={pair} size={64} />
      <AppText
        variant="rowName"
        weight={600}
        tone="strong"
        accessibilityRole="header"
        style={{ textAlign: 'center' }}
      >
        {t('buddy.paired.title', { name })}
      </AppText>
      <AppText variant="caption" color={colors.muted} style={{ textAlign: 'center' }}>
        {t('buddy.paired.body')}
      </AppText>
      <View style={{ alignSelf: 'stretch', paddingTop: spacing.sm }}>
        <SheetAction label={t('buddy.paired.done')} onPress={onDone} emphasis testID={`${testID}-done`} />
      </View>
    </View>
  );
}

/** A success tap the moment the sentence appears. Same feedback as the seal. */
export function usePairedHaptic(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }, [active]);
}

export function BuddyPairedSheet() {
  const { t } = useTranslation();
  const pairs = useBuddyPairs();
  const justPaired = useJustPaired();
  const inviteSheetOpen = useInviteSheetOpen();
  const actions = useBuddyActions();

  const pair = useMemo(() => {
    const id = justPaired[0];
    return id === undefined ? null : (pairs.find((entry) => entry.pairId === id) ?? null);
  }, [justPaired, pairs]);

  // The invite sheet shows this same moment in place while it is open; two sheets saying it
  // would be a stutter. An id whose pair has gone (removed before it was seen) is dropped.
  useEffect(() => {
    const id = justPaired[0];
    if (id !== undefined && pair === null) actions.acknowledgePaired(id);
  }, [justPaired, pair, actions]);

  const visible = pair !== null && !inviteSheetOpen;
  usePairedHaptic(visible);

  const taken = useMemo(
    () =>
      pairs
        .filter((entry) => entry.pairId !== pair?.pairId)
        .map((entry) => ({ icon: entry.icon, color: entry.color })),
    [pairs, pair]
  );
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState<BuddyAvatarShape | null>(null);

  const done = () => {
    if (pair) actions.acknowledgePaired(pair.pairId);
    setNickname('');
    setAvatar(null);
  };

  if (pair === null) return null;

  if (pair.pending) {
    const chosen = avatar ?? firstFreeAvatar(taken) ?? { icon: pair.icon, color: pair.color };
    return (
      <SheetShell
        visible={visible}
        title={t('buddy.pending.title')}
        onClose={done}
        keyboard
        testID="buddy-paired-sheet"
      >
        <View style={{ gap: spacing.lg }}>
          <BuddyNameForm
            nickname={nickname}
            onNickname={setNickname}
            avatar={chosen}
            onAvatar={setAvatar}
            taken={taken}
            testID="buddy-paired-form"
          />
          <SheetAction
            label={t('buddy.pending.save')}
            emphasis
            testID="buddy-paired-save"
            onPress={() => {
              actions.namePair(pair.pairId, { ...chosen, nickname });
              done();
            }}
          />
        </View>
      </SheetShell>
    );
  }

  return (
    <SheetShell visible={visible} title={t('buddy.settings.title')} onClose={done} testID="buddy-paired-sheet">
      <PairedContent pair={pair} onDone={done} testID="buddy-paired" />
    </SheetShell>
  );
}
