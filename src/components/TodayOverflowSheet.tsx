import { useTranslation } from 'react-i18next';

import { AppText } from './AppText';
import { SheetAction, SheetShell } from './SheetKit';
import { spacing } from '@/theme';

/**
 * The sheet behind Today's ⋯ — the app's one menu of states you can put yourself into, and the
 * only place either of them is switched.
 *
 * Two features live here, as siblings rather than as one nested inside the other:
 *
 * - **Excused days** (spec-exemption §2b), the recurring monthly gesture: Today → ⋯ → one tap, no
 *   typing, no dates, no questions.
 * - **Travel** (D115), the same shape: one tap to say you are travelling, one to say you are back.
 *
 * Each shows exactly one action, whichever of begin/end fits the current state, so the menu never
 * grows past four rows and never asks the reader to work out which of two similar lines applies.
 * That this menu is generic rather than excused-days' own is D117.
 *
 * The ⋯ is on Today for everyone, not only for people who already found the switch in Settings,
 * because the owner's own report was that excused days were unfindable: three dots that say nothing
 * are a smaller cost than a feature nobody can reach. What keeps that honest for exemption is the
 * register (P1) — the sheet's words are excused / عذر / özel günler, so a stranger's glance learns
 * nothing — and the fact that beginning from here turns the mode on as a side effect of *using* it,
 * rather than asking anybody to find a switch first. Travel needs no such care: it is nobody's
 * private business, which is also why it has no Settings presence at all.
 *
 * ## The one line this file must never widen
 *
 * The excused-days intro describes what excused days *do*, never who should take them. Widening it
 * to illness or travel would be the single most harmful copy change this app could make: those
 * prayers genuinely are owed, and inviting someone to mark them excused would erase a debt they
 * still carry (D60). Travel sitting one row below it does not change that — travel mode owes every
 * prayer and marks every prayer; what it changes is only *how* they may be prayed. The scope lives
 * in the Settings body, the one place allowed to be explicit.
 */

export interface TodayOverflowSheetProps {
  visible: boolean;
  /**
   * Whether an exempt period is running right now — open-ended, or with an end date still to come.
   * It decides which single action leads that pair (§2b): ending a planned period early is the same
   * offer as ending an open one.
   */
  hasOngoingPeriod: boolean;
  /**
   * Whether the exemption feature has been turned on before. `false` adds the one line that says
   * what excused days are, because this is then somebody's first meeting with the idea.
   */
  modeEnabled: boolean;
  /** Whether travel mode applies to the day on screen. */
  traveling: boolean;
  onBegin: () => void;
  onEndPeriod: () => void;
  /** Opens the travel sheet, which asks how long the journey is. */
  onBeginTravel: () => void;
  /** Ends travel outright — no sheet, because there is nothing to backdate (D117). */
  onEndTravel: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
  testID?: string;
}

/**
 * Today's overflow menu.
 *
 * @param traveling - Whether travel applies today; flips its row between begin and end.
 * @returns The sheet: the excused-days action, the travel action, and the quiet door to settings.
 */
export function TodayOverflowSheet({
  visible,
  hasOngoingPeriod,
  modeEnabled,
  traveling,
  onBegin,
  onEndPeriod,
  onBeginTravel,
  onEndTravel,
  onOpenSettings,
  onClose,
  testID = 'today-overflow',
}: TodayOverflowSheetProps) {
  const { t } = useTranslation();

  return (
    <SheetShell visible={visible} title={t('today.overflow.title')} onClose={onClose} testID={testID}>
      {!modeEnabled && !hasOngoingPeriod ? (
        <AppText
          testID={`${testID}-intro`}
          variant="caption"
          tone="muted"
          style={{ marginBottom: spacing.sm }}
        >
          {t('exemption.overflow.intro')}
        </AppText>
      ) : null}
      {hasOngoingPeriod ? (
        <SheetAction
          testID={`${testID}-end`}
          label={t('exemption.overflow.end')}
          emphasis
          onPress={onEndPeriod}
        />
      ) : (
        <SheetAction
          testID={`${testID}-begin`}
          label={t('exemption.overflow.begin')}
          emphasis
          onPress={onBegin}
        />
      )}
      {traveling ? (
        <SheetAction
          testID={`${testID}-travel-end`}
          label={t('travel.overflow.end')}
          onPress={onEndTravel}
        />
      ) : (
        <SheetAction
          testID={`${testID}-travel-begin`}
          label={t('travel.overflow.begin')}
          onPress={onBeginTravel}
        />
      )}
      <SheetAction
        testID={`${testID}-settings`}
        label={t('exemption.overflow.settings')}
        onPress={onOpenSettings}
      />
    </SheetShell>
  );
}
