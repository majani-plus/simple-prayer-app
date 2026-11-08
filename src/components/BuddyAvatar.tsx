import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { useTheme } from '@/theme';
import { buddyDiscLight, buddyDiscNight } from '@/theme/tokens';
import { INITIALS_ICON, buddyInitials, type BuddyColor, type BuddyIcon } from '@/domain/buddies';
import type { BuddyPair } from '@/stores/buddyStore';

/**
 * A buddy, drawn.
 *
 * A filled disc carrying either the first letters of the name you gave them or a small picture, on
 * a colour you chose. **Both halves carry the identity** — never the colour alone. Everything about
 * how a buddy looks is chosen by the person looking at them: the buddy never learns what they were
 * given, and none of it has ever crossed a network (D174).
 *
 * It is drawn as a **badge**: a ring in the paper's own colour with a soft shadow under it, so it
 * reads as something pressed onto the row rather than printed in it. The ring is also what lets
 * several overlap and still be counted, and what keeps a dark disc from dissolving into night paper.
 */

/**
 * Semantic name → the glyph that draws it. Every one is already in the bundled Material Symbols
 * subset, so buddy mode adds no font weight; the indirection exists so that changing which glyph
 * draws a crescent does not rename anybody's buddy, since the semantic name is what is persisted.
 *
 * `initials` has no entry: it is drawn as letters, not as a picture.
 */
export const BUDDY_GLYPH: Record<Exclude<BuddyIcon, typeof INITIALS_ICON>, IconName> = {
  crescent: 'bedtime',
  star: 'star',
  mosque: 'mosque',
  rosette: 'workspace_premium',
  leaf: 'spa',
  drop: 'water_drop',
  sun: 'sunny',
  book: 'menu_book',
  heart: 'favorite',
  dawn: 'wb_twilight',
};

/**
 * Big enough to read a pair of letters at a glance and to look like a sticker rather than a dot —
 * the first device pass found 24 too small everywhere. It sits on the name line beside 18pt type;
 * the row's height is set by the 48pt seal opposite, so it still cannot grow the row.
 */
export const BUDDY_AVATAR_SIZE = 30;

/** How much each disc tucks behind the one before it when several stack. */
const OVERLAP = 9;

/** What an avatar needs in order to draw itself. A whole `BuddyPair` satisfies it structurally. */
export interface BuddyFace {
  icon: BuddyIcon;
  color: BuddyColor;
  /** The name the letters come from, when the icon is `initials`. */
  nickname?: string;
}

export interface BuddyAvatarProps {
  avatar: BuddyFace;
  size?: number;
  /** Letters to show while the name is still empty — the picker's live preview passes one. */
  fallbackInitials?: string;
}

export function BuddyAvatar({
  avatar,
  size = BUDDY_AVATAR_SIZE,
  fallbackInitials,
}: BuddyAvatarProps) {
  const { scheme, colors } = useTheme();
  const discs = scheme === 'dark' ? buddyDiscNight : buddyDiscLight;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: discs[avatar.color],
        alignItems: 'center',
        justifyContent: 'center',
        // The badge: a ring in the paper's colour, and a shadow beneath it. The ring separates one
        // disc from the next where they overlap, and keeps a dark colour from disappearing into
        // night paper.
        borderWidth: size >= 20 ? 1.5 : 1,
        borderColor: colors.bg,
        shadowColor: colors.shadowGold,
        shadowOpacity: 1,
        shadowRadius: 2.5,
        shadowOffset: { width: 0, height: 1 },
        elevation: 2,
      }}
    >
      {avatar.icon === INITIALS_ICON ? (
        <AppText
          variant="caption"
          weight={700}
          color={colors.sealFg}
          numberOfLines={1}
          // Sized from the disc rather than the type scale: the letters have to fit the circle at
          // every size this is drawn at, from the row badge to the picker's larger preview.
          style={{ fontSize: size * 0.42, lineHeight: size * 0.54, letterSpacing: 0.2 }}
        >
          {buddyInitials(avatar.nickname ?? '', fallbackInitials)}
        </AppText>
      ) : (
        <Icon name={BUDDY_GLYPH[avatar.icon]} size={size * 0.58} color={colors.sealFg} />
      )}
    </View>
  );
}

export interface BuddyAvatarsProps {
  /** The buddies who marked this prayer today, in roster order. Empty renders nothing at all. */
  buddies: readonly BuddyPair[];
  size?: number;
  testID?: string;
}

export function BuddyAvatars({ buddies, size, testID }: BuddyAvatarsProps) {
  const { t } = useTranslation();
  // Empty means empty. No placeholder, no "no one yet", no dash — a prayer nothing arrived for is
  // not a prayer anybody failed, and this app never draws an absence (D174).
  if (buddies.length === 0) return null;

  // Spoken as one phrase — "Amina and Yusuf prayed" — because a screen reader walking a row of
  // unlabelled circles says nothing at all. A buddy named on another phone but not yet named on
  // this one falls back to "Your buddy" rather than to a blank.
  const names = buddies.map((buddy) => buddy.nickname || t('buddy.unnamed'));
  const joined =
    names.length === 1
      ? names[0]
      : names.slice(0, -1).join(t('buddy.list.separator')) +
        t('buddy.list.last') +
        names[names.length - 1];

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={t('buddy.row.prayed', { names: joined })}
      style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}
    >
      {buddies.map((buddy, index) => (
        <View
          key={buddy.pairId}
          // Later discs tuck behind earlier ones, so the stack reads left to right in roster
          // order — the same order every row, so a buddy keeps their place.
          style={{ marginStart: index === 0 ? 0 : -OVERLAP, zIndex: buddies.length - index }}
        >
          <BuddyAvatar avatar={buddy} size={size} />
        </View>
      ))}
    </View>
  );
}
