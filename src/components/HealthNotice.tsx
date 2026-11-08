import { View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { radius, spacing, useTheme } from '@/theme';

/**
 * A verdict card: one plain-language answer, its severity, and at most a couple of ways to act on
 * it. The reminder-health screen is built almost entirely out of these.
 *
 * ## Why severity is never a colour
 *
 * The whole screen exists to answer "will my next adhan actually fire?", and an answer that only
 * a sighted user with unimpaired colour vision can read is not an answer. Every level therefore
 * carries **three** signals: a distinct glyph, a localized status word beside the title, and the
 * tint. Turn the screen greyscale and the card still says "Needs attention".
 *
 * The palette deliberately stays in the paper family — gold for good, burnt orange for attention,
 * red-brown for a real problem. The design's green is reserved for Qibla alignment and appears
 * nowhere else (docs/DESIGN.md), so "everything is fine" reads as warm gold rather than as a
 * dashboard's success state.
 *
 * ## Tone
 *
 * `body` should be one or two calm, factual sentences. This card is shown to someone who may have
 * missed a prayer because their phone stayed silent; the copy that goes in it is never alarming,
 * never blames them, and always ends in something they can do.
 *
 * Renders no strings of its own — every label, including the status word, arrives localized.
 */

/** How serious the card's answer is. */
export type HealthLevel = 'ok' | 'attention' | 'problem' | 'info';

/** The glyph for each level. Distinct shapes, not just distinct colours. */
const LEVEL_ICONS: Record<HealthLevel, IconName> = {
  ok: 'task_alt',
  attention: 'warning',
  problem: 'error',
  info: 'info',
};

/** One thing the user can do about the card's subject. */
export interface HealthNoticeAction {
  label: string;
  icon: IconName;
  onPress: () => void;
  /** Renders the action as the emphasised one (filled, gold). Use for at most one action. */
  primary?: boolean;
  /** Greys the action out; use while its work is in flight. */
  disabled?: boolean;
  testID?: string;
}

export interface HealthNoticeProps {
  level: HealthLevel;
  /** The verdict, as a short sentence. */
  title: string;
  /** The localized word for `level` ("All set", "Needs attention"…) — the non-colour signal. */
  statusLabel: string;
  /** One or two calm sentences: what is happening, and what it means. */
  body?: string;
  /** Overrides the level's glyph, e.g. `notifications_off` for a permission card. */
  icon?: IconName;
  actions?: readonly HealthNoticeAction[];
  /** A quieter line under the actions, for a caveat rather than an instruction. */
  footnote?: string;
  /** Extra content inside the card, below the body (a list, a switch row). */
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A severity-tinted verdict card.
 *
 * @param level - How serious the answer is; picks the glyph and the tint.
 * @param statusLabel - The localized word for `level`, so severity survives greyscale.
 * @returns The card, announced to assistive technology as a single node reading
 * "status · title · body".
 */
export function HealthNotice({
  level,
  title,
  statusLabel,
  body,
  icon,
  actions = [],
  footnote,
  children,
  style,
  testID,
}: HealthNoticeProps) {
  const { colors } = useTheme();

  const tints: Record<HealthLevel, string> = {
    ok: colors.accent,
    attention: colors.late,
    problem: colors.missed,
    info: colors.header,
  };
  const tint = tints[level];

  return (
    <Card
      testID={testID}
      variant="bright"
      border="mid"
      style={[{ padding: spacing.lg, gap: spacing.md }, style]}
    >
      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
        <Icon name={icon ?? LEVEL_ICONS[level]} size={21} color={tint} />
        <View
          accessible
          accessibilityRole="text"
          // One node, read in the order the eye takes it: severity, verdict, explanation.
          accessibilityLabel={[statusLabel, title, body].filter(Boolean).join('. ')}
          style={{ flex: 1, gap: 3 }}
        >
          <AppText variant="caption" weight={600} color={tint} style={{ letterSpacing: 0.3 }}>
            {statusLabel}
          </AppText>
          <AppText variant="rowName" weight={600}>
            {title}
          </AppText>
          {body === undefined ? null : (
            <AppText variant="caption" tone="header">
              {body}
            </AppText>
          )}
        </View>
      </View>

      {children}

      {actions.length === 0 ? null : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {actions.map((action) => (
            <PressableScale
              key={action.label}
              testID={action.testID}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              accessibilityState={{ disabled: action.disabled === true }}
              disabled={action.disabled}
              onPress={action.onPress}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                minHeight: 44,
                paddingVertical: 10,
                paddingHorizontal: spacing.lg,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: action.primary === true ? colors.accent : colors.borderMid,
                backgroundColor: action.primary === true ? colors.accent : colors.card,
                opacity: action.disabled === true ? 0.5 : 1,
              }}
            >
              <Icon
                name={action.icon}
                size={15}
                color={action.primary === true ? colors.sealFg : colors.accent}
              />
              <AppText
                variant="time"
                weight={600}
                tabularNums={false}
                color={action.primary === true ? colors.sealFg : colors.accent}
              >
                {action.label}
              </AppText>
            </PressableScale>
          ))}
        </View>
      )}

      {footnote === undefined ? null : <AppText variant="hint">{footnote}</AppText>}
    </Card>
  );
}
