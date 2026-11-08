import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import {
  BUDDY_COLORS,
  BUDDY_ICONS,
  INITIALS_ICON,
  buddyInitials,
  isAvatarTaken,
  type BuddyAvatar,
} from '@/domain/buddies';
import { buddyDiscLight, buddyDiscNight } from '@/theme/tokens';
import { spacing, useTheme } from '@/theme';
import { BUDDY_GLYPH, BuddyAvatar as AvatarDisc } from './BuddyAvatar';

/**
 * Choosing what a buddy looks like — to you, on this phone, and nowhere else.
 *
 * They never learn what you picked, and nothing about it crosses a network. Two people who paired
 * with each other may well picture each other completely differently, which is the correct outcome
 * of a feature that has no profiles in it.
 *
 * Combinations already in use are dimmed and unselectable rather than hidden, so the grid never
 * reshuffles as buddies are added, and a choice stays where it was last time.
 */

const SWATCH = 34;

/**
 * What the initials swatch shows before a name has been typed. Two letters rather than a dash or an
 * empty circle, so the option looks like what it is: a disc with letters on it.
 */
const SAMPLE_INITIALS = 'AB';

export interface BuddyAvatarPickerProps {
  value: BuddyAvatar;
  onChange: (avatar: BuddyAvatar) => void;
  /** Avatars already worn by other buddies on this phone. */
  taken: readonly BuddyAvatar[];
  /** The name being typed. The initials swatch and the preview follow it, letter by letter. */
  nickname?: string;
  testID?: string;
}

export function BuddyAvatarPicker({
  value,
  onChange,
  taken,
  nickname = '',
  testID,
}: BuddyAvatarPickerProps) {
  const { t } = useTranslation();
  const { scheme, colors } = useTheme();
  const discs = scheme === 'dark' ? buddyDiscNight : buddyDiscLight;

  return (
    <View testID={testID} style={{ gap: spacing.lg }}>
      <View style={{ gap: spacing.sm }}>
        <AppText variant="caption" color={colors.muted}>
          {t('buddy.picker.icon')}
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {BUDDY_ICONS.map((icon) => {
            const selected = value.icon === icon;
            const blocked = isAvatarTaken({ icon, color: value.color }, taken);
            return (
              <PressableScale
                key={icon}
                testID={`buddy-icon-${icon}`}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: blocked }}
                accessibilityLabel={t(`buddy.icons.${icon}`)}
                disabled={blocked}
                onPress={() => onChange({ ...value, icon })}
                style={{
                  width: SWATCH,
                  height: SWATCH,
                  borderRadius: SWATCH / 2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: blocked ? 0.3 : 1,
                  borderWidth: selected ? 2 : 1,
                  borderColor: selected ? colors.accent : colors.borderFaint,
                }}
              >
                {icon === INITIALS_ICON ? (
                  <AppText
                    variant="caption"
                    weight={700}
                    color={selected ? colors.accent : colors.muted}
                    style={{ fontSize: 12 }}
                  >
                    {buddyInitials(nickname, SAMPLE_INITIALS)}
                  </AppText>
                ) : (
                  <Icon name={BUDDY_GLYPH[icon]} size={18} color={selected ? colors.accent : colors.muted} />
                )}
              </PressableScale>
            );
          })}
        </View>
      </View>

      <View style={{ gap: spacing.sm }}>
        <AppText variant="caption" color={colors.muted}>
          {t('buddy.picker.color')}
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {BUDDY_COLORS.map((color) => {
            const selected = value.color === color;
            const blocked = isAvatarTaken({ icon: value.icon, color }, taken);
            return (
              <PressableScale
                key={color}
                testID={`buddy-color-${color}`}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: blocked }}
                accessibilityLabel={t(`buddy.colors.${color}`)}
                disabled={blocked}
                onPress={() => onChange({ ...value, color })}
                style={{
                  width: SWATCH,
                  height: SWATCH,
                  borderRadius: SWATCH / 2,
                  backgroundColor: discs[color],
                  opacity: blocked ? 0.3 : 1,
                  borderWidth: selected ? 2 : 0,
                  borderColor: colors.ink,
                }}
              />
            );
          })}
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <AvatarDisc avatar={{ ...value, nickname }} size={40} fallbackInitials={SAMPLE_INITIALS} />
        <AppText variant="caption" color={colors.muted}>
          {t('buddy.picker.preview')}
        </AppText>
      </View>
    </View>
  );
}
