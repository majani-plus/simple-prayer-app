import { useTranslation } from 'react-i18next';

import { AppText } from './AppText';
import { SheetAction, SheetShell } from './SheetKit';
import { spacing } from '@/theme';

/**
 * The sheet behind Today's ⋯ — the app's menu of states you can put yourself into.
 *
 * Today it holds **excused days** (spec-exemption §2b), the recurring monthly gesture: Today → ⋯ →
 * one tap, no typing, no dates, no questions. It shows exactly one action, whichever of begin/end
 * fits the current state, so the reader never works out which of two similar lines applies. The
 * menu is generic rather than excused-days' own (D117); travel mode lived here until D211.
 *
 * The ⋯ is on Today for everyone, not only for people who already found the switch in Settings,
 * because the owner's own report was that excused days were unfindable: three dots that say nothing
 * are a smaller cost than a feature nobody can reach. What keeps that honest for exemption is the
 * register (P1) — the sheet's words are excused / عذر / özel günler, so a stranger's glance learns
 * nothing — and the fact that beginning from here turns the mode on as a side effect of *using* it,
 * rather than asking anybody to find a switch first.
 *
 * ## The one line this file must never widen
 *
 * The excused-days intro describes what excused days *do*, never who should take them. Widening it
 * to illness or travel would be the single most harmful copy change this app could make: those
 * prayers genuinely are owed, and inviting someone to mark them excused would erase a debt they
 * still carry (D60). The scope lives in the Settings body, the one place allowed to be explicit.
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
  onBegin: () => void;
  onEndPeriod: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
  testID?: string;
}

/**
 * Today's overflow menu.
 *
 * @returns The sheet: the excused-days action and the quiet door to settings.
 */
export function TodayOverflowSheet({
  visible,
  hasOngoingPeriod,
  modeEnabled,
  onBegin,
  onEndPeriod,
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
      <SheetAction
        testID={`${testID}-settings`}
        label={t('exemption.overflow.settings')}
        onPress={onOpenSettings}
      />
    </SheetShell>
  );
}
