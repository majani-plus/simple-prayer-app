import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { BuddyNameForm } from './BuddyNameForm';
import { SheetAction, SheetShell } from './SheetKit';
import type { BuddyAvatar } from '@/domain/buddies';
import { useBuddyActions, useBuddyPairs, type BuddyPair } from '@/stores/buddyStore';
import { spacing } from '@/theme';

/**
 * Editing a buddy: their nickname, their face, or removing them.
 *
 * Everything here is about how *you* see them (D174) — they never learn any of it, so there is
 * nothing to confirm with anybody. Removing is one tap and takes effect at once, as it did when
 * it sat on the row; it is in here rather than on the row so that a thumb scrolling the list
 * cannot end a link by accident.
 */

export interface EditBuddySheetProps {
  /** Which buddy, or `null` for closed. */
  pairId: string | null;
  onClose: () => void;
  onRemove: (pairId: string) => void;
}

export function EditBuddySheet({ pairId, onClose, onRemove }: EditBuddySheetProps) {
  const { t } = useTranslation();
  const pairs = useBuddyPairs();
  const pair = useMemo(() => pairs.find((entry) => entry.pairId === pairId) ?? null, [pairs, pairId]);
  const taken = useMemo(
    () => pairs.filter((entry) => entry.pairId !== pairId).map((entry) => ({ icon: entry.icon, color: entry.color })),
    [pairs, pairId]
  );

  if (!pair) return null;

  return (
    <SheetShell
      visible={pairId !== null}
      title={pair.nickname || t('buddy.unnamed')}
      onClose={onClose}
      keyboard
      testID="buddy-edit-sheet"
    >
      {/* Keyed on the buddy, so the form starts from *their* name each time one is opened and a
          background sync touching another pair cannot undo what is being typed. */}
      <EditForm key={pair.pairId} pair={pair} taken={taken} onClose={onClose} onRemove={onRemove} />
    </SheetShell>
  );
}

function EditForm({
  pair,
  taken,
  onClose,
  onRemove,
}: {
  pair: BuddyPair;
  taken: readonly BuddyAvatar[];
  onClose: () => void;
  onRemove: (pairId: string) => void;
}) {
  const { t } = useTranslation();
  const actions = useBuddyActions();
  const [nickname, setNickname] = useState(pair.nickname);
  const [avatar, setAvatar] = useState<BuddyAvatar>({ icon: pair.icon, color: pair.color });

  return (
    <View style={{ gap: spacing.lg }}>
      <BuddyNameForm
        nickname={nickname}
        onNickname={setNickname}
        avatar={avatar}
        onAvatar={setAvatar}
        taken={taken}
        testID="buddies-edit"
      />
      <View>
        <SheetAction
          label={t('buddy.edit.save')}
          emphasis
          testID="buddies-edit-save"
          onPress={() => {
            actions.namePair(pair.pairId, { ...avatar, nickname });
            onClose();
          }}
        />
        <SheetAction
          label={t('buddy.edit.remove')}
          testID={`buddies-remove-${pair.pairId}`}
          onPress={() => {
            onRemove(pair.pairId);
            onClose();
          }}
        />
      </View>
    </View>
  );
}
