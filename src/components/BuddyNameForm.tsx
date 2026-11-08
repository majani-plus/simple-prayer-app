import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { AppText } from './AppText';
import { BuddyAvatarPicker } from './BuddyAvatarPicker';
import type { BuddyAvatar } from '@/domain/buddies';
import { radius, spacing, useTheme } from '@/theme';

/**
 * The one form buddy mode has: what you call somebody, and what they look like to you.
 *
 * It appears in four places — inviting, accepting, naming somebody who accepted before you had
 * named them, and editing — and it is the same form in all four because it is the same question.
 * Nothing entered here leaves the phone (D174); the field's placeholder says so.
 */

export interface BuddyNameFormProps {
  nickname: string;
  onNickname: (value: string) => void;
  avatar: BuddyAvatar;
  onAvatar: (value: BuddyAvatar) => void;
  /** Faces already worn by other buddies on this phone. */
  taken: readonly BuddyAvatar[];
  /** Focus the field as soon as the form appears — for the sheets, where it is the first thing. */
  autoFocus?: boolean;
  testID: string;
}

export function BuddyNameForm({
  nickname,
  onNickname,
  avatar,
  onAvatar,
  taken,
  autoFocus = false,
  testID,
}: BuddyNameFormProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <View testID={testID} style={{ gap: spacing.lg }}>
      <View style={{ gap: spacing.sm }}>
        <AppText variant="caption" color={colors.muted}>
          {t('buddy.accept.name')}
        </AppText>
        <TextInput
          testID={`${testID}-name`}
          value={nickname}
          onChangeText={onNickname}
          placeholder={t('buddy.accept.placeholder')}
          placeholderTextColor={colors.faint}
          maxLength={24}
          autoFocus={autoFocus}
          autoCapitalize="words"
          returnKeyType="done"
          accessibilityLabel={t('buddy.accept.name')}
          style={{
            borderWidth: 1,
            borderColor: colors.borderMid,
            borderRadius: radius.card,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            color: colors.ink,
            fontSize: 16,
            minHeight: 48,
          }}
        />
      </View>

      <BuddyAvatarPicker
        testID={`${testID}-picker`}
        value={avatar}
        onChange={onAvatar}
        taken={taken}
        nickname={nickname}
      />
    </View>
  );
}
