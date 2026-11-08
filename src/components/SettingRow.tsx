import { createContext, useContext } from 'react';
import {
  I18nManager,
  useWindowDimensions,
  View,
  type AccessibilityRole,
  type AccessibilityState,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { PaperSwitch } from './PaperSwitch';
import { PressableScale } from './PressableScale';
import { spacing, useTheme } from '@/theme';

import type { ReactNode } from 'react';

/**
 * The Settings vocabulary: one row shape every settings screen composes from.
 *
 * A row is deliberately boring — a label, an optional description, an optional value on the
 * trailing edge, an optional control (chevron, switch, stepper buttons) — because Settings is
 * long, and a screen full of bespoke rows reads as noise. Everything special about a setting
 * belongs in its copy, not in its layout.
 *
 * Three things the base row owns so no caller has to think about them:
 *
 * 1. **Touch target.** A row is at least {@link MIN_ROW_HEIGHT} tall, and `PressableScale` grows
 *    a matching `hitSlop` for anything smaller — so even a one-line row clears 44pt.
 * 2. **Direction.** The chevron follows the writing direction (`chevron_right` in LTR,
 *    `chevron_left` in RTL); the row's own flex layout mirrors itself.
 * 3. **State is never colour-only.** The switch row renders the word "On"/"Off" beside the
 *    control, the choice chips carry a check glyph, and every control exposes its
 *    `accessibilityState` — so state survives greyscale, colour-blindness and VoiceOver alike.
 *
 * The row renders no strings of its own: every label, description, value and accessibility
 * string is passed in already localized by the screen.
 *
 * Composition: rows go inside a {@link SettingGroup}, which paints the card and the hairlines
 * between them. A row draws no border and no background of its own.
 */

/** Minimum row height in points. 48 keeps a single-line row clear of the 44pt floor. */
export const MIN_ROW_HEIGHT = 48;

/**
 * Press feedback for a full-width row: a brief dim of the row's content, **no scale**. Even the
 * gentle 0.98 this started at read as the whole card wobbling — the owner called it out on the
 * toggle rows in particular — because a ratio that says "press" on a 48pt seal says "the screen
 * moved" at 350pt wide. The dim is the same ink-lightening a paper button would show under a
 * thumb; on switch rows the knob itself then carries the state change.
 */
const ROW_PRESS_OPACITY = 0.7;

/** Leading icon size, matching the label's optical size. */
const ICON_SIZE = 20;

/**
 * Optical nudge that drops the 20pt glyph onto the 18pt label's line, since the glyph box is
 * shorter than the label's line box and would otherwise ride high.
 */
const ICON_BASELINE_NUDGE = 2;

/**
 * Ceiling on how much of the label line a trailing value may claim. Below half, so the label
 * always keeps enough room for its longest word; a value longer than this wraps instead.
 */
const VALUE_MAX_WIDTH = '45%';

/**
 * Type scale past which the value stops sharing the label's line and sits under it instead.
 *
 * 1.5 is chosen, not tuned: below it the two-column row is comfortable and is what the design
 * asks for, and above it the label column (already narrowed by the icon gutter and the value's
 * 45%) is too tight for an ordinary English word. It is the same size at which the tip-jar
 * tiers stop sitting three across.
 */
const STACK_SCALE = 1.5;

/**
 * How many lines a row label may take, given the OS Dynamic Type multiplier.
 *
 * Two lines is right at ordinary sizes: it lets "Your location" and "Calculation" wrap beside a
 * value without a row growing unboundedly on a mistyped string. But the label column is narrowed
 * by both the icon gutter and the value's 45%, so the same two lines that fit "Your location" at
 * 1x cannot hold it at 2x — it truncated to "Your locati…", with the rest of the word living
 * nowhere. That is precisely what Apple's Larger Text criterion forbids, and it was invisible to
 * every test we had because layout only happens on a device.
 *
 * So the allowance grows with the type instead of being pinned. The cap does not disappear at
 * large sizes — an unbounded label would push the description and control off a small screen —
 * it just tracks the space the words actually need. Verified by rendering Settings at
 * `accessibility-medium` (34pt body, Apple's 200% bar) on an 11 Pro Max.
 */
export function labelLines(fontScale: number): number {
  const scale = Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  return Math.min(4, Math.max(2, Math.ceil(scale * 1.5)));
}

/**
 * Gap between the label and its `leading` content. Tighter than `spacing.md`: the two read as one
 * phrase ("Fajr 05:12"), not as two columns.
 */
const LEADING_GAP = 7;

/**
 * Whether the surrounding group reserves the leading-glyph gutter on every row.
 *
 * Icons are optional per row, but a *card* full of rows reads as one list with one left edge.
 * Letting each row indent itself only when it happens to carry a glyph puts the labels of one
 * card at two different x positions, which is the single most visible flaw in a settings list.
 * {@link SettingGroup} therefore asks whether *any* of its rows has an icon and, when one does,
 * sets this to `true` so the iconless rows reserve the same gutter and every label lines up.
 */
export const SettingIconGutterContext = createContext(false);

export interface SettingRowProps {
  /** The setting's name. One short line; the explanation belongs in `description`. */
  label: string;
  /** One calm sentence under the label explaining what the setting does. */
  description?: string;
  /** The current value, shown on the trailing edge (e.g. "Auto (Diyanet)"). */
  value?: string;
  /** Optional leading glyph. Most rows do without one; use it to anchor a group's first row. */
  icon?: IconName;
  /**
   * Live content belonging to the label, rendered on the label's line and hugging it — the
   * leading half of the row rather than the trailing edge.
   *
   * Use it when what the setting currently *produces* is the point of the row: the offsets screen
   * puts each prayer's resulting time here ("Fajr 05:12 … − +3 min +"), so a user can tap until
   * the app agrees with their mosque's calendar. That is a different thing from `value`, which is
   * pinned to the trailing edge and reads as the setting's own state, and from `icon`, which is
   * the row's static glyph in the gutter.
   */
  leading?: ReactNode;
  /** A control rendered on the trailing edge (a switch, stepper buttons, a badge). */
  trailing?: ReactNode;
  /** Shows the navigation chevron. Defaults to `true` when the row has an `onPress`. */
  chevron?: boolean;
  /**
   * Marks the row as a disclosure that opens content *in place* rather than a new screen.
   * The chevron becomes an up/down caret matching the state, so the glyph never promises a
   * push that will not happen.
   */
  expanded?: boolean;
  /** Makes the whole row pressable. */
  onPress?: () => void;
  /** Greys the row out and stops it accepting taps. */
  disabled?: boolean;
  /** Extra content rendered below the label block (e.g. choice chips). */
  children?: ReactNode;
  /** Defaults to `button` for a pressable row, and to none for a static one. */
  accessibilityRole?: AccessibilityRole;
  /** Defaults to the label (plus the value, when there is one). */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: AccessibilityState;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * One settings row.
 *
 * @param label - The setting's name.
 * @param onPress - Makes the row pressable (and gives it the navigation chevron by default).
 * @returns A row laid out as `[icon] label / description … value [control]`.
 */
export function SettingRow({
  label,
  description,
  value,
  icon,
  leading,
  trailing,
  chevron,
  expanded,
  onPress,
  disabled = false,
  children,
  accessibilityRole,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  style,
  testID,
}: SettingRowProps) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const maxLabelLines = labelLines(fontScale);
  const stacked = Number.isFinite(fontScale) && fontScale >= STACK_SCALE;
  // A disabled row is still rendered as a pressable, just an inert one: it keeps its role and
  // gains `accessibilityState.disabled`, so a screen reader announces "dimmed" rather than
  // silently skipping a row that is on screen. Dropping to a plain `View` would hide the fact.
  const pressable = onPress !== undefined;
  const showChevron = chevron ?? onPress !== undefined;
  const gutterReserved = useContext(SettingIconGutterContext);

  // Two structural rules, both about who gets which width:
  //
  // 1. The **description sits in the same column as the label**, not beside the icon — so it
  //    always starts on the label's left edge, whether or not the row has a glyph, and whether
  //    or not the row was rendered directly by a group.
  // 2. The **value shares only the label's line**. When value and description shared a line the
  //    value won and the sentence lost: "Auto (Moonsighting Committee)" squeezed "Method, madhab,
  //    high latitudes and minute adjustments." into four ragged three-word lines. Now the value
  //    only has to out-argue a two-word label, and the sentence spans the card.
  const body = (
    <View style={{ flexDirection: 'row', gap: spacing.md }}>
      {icon === undefined ? (
        // An iconless row in a card that has icons still reserves the gutter, so one card keeps
        // one left edge. `SettingGroup` decides; a lone row outside a group reserves nothing.
        gutterReserved ? (
          <View style={{ width: ICON_SIZE }} />
        ) : null
      ) : (
        <Icon
          name={icon}
          size={ICON_SIZE}
          color={disabled ? colors.soft : colors.accent}
          // Glyph aligned to the label's line, not to the middle of a wrapped description.
          style={{ marginTop: ICON_BASELINE_NUDGE }}
        />
      )}

      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          {/* Only the label and value stack; `trailing` and the chevron stay on the row's
              trailing edge at every size. Stacking the whole line dropped the chevron onto a line
              of its own underneath the value, where it read as a third item of content rather
              than as the row's affordance. */}
          <View
            style={
              stacked
                ? { flex: 1, gap: 2, alignItems: I18nManager.isRTL ? 'flex-end' : 'flex-start' }
                : { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md }
            }
          >
            {/* The label takes the line and the value takes what is left, never the other way
              round. Letting both shrink proportionally starved the label: "Auto (Moonsighting
              Committee)" squeezed "Calculation" narrower than the word itself, and the layout
              broke it mid-word into "Calculatio / n". `leading` shares that same claim, because
              it belongs to the label rather than to the trailing edge.

              Past {@link STACK_SCALE} the two stop sharing a line at all. Giving the label the
              wider 55% was still not enough at Apple's 200% bar: "Your location" broke into
              "Your / locatio / n", the very mid-word break the rule above exists to prevent.
              Under a stack the label gets the whole width and breaks at a space like a sentence,
              and the value reads as the row's answer sitting under its question — which is what
              a settings row means anyway, and what the tip-jar tiers already do at this size. */}
            {leading === undefined ? (
              <AppText
                variant="rowName"
                weight={500}
                tone={disabled ? 'soft' : 'ink'}
                numberOfLines={maxLabelLines}
                style={{ flex: 1 }}
              >
                {label}
              </AppText>
            ) : (
              <View
                style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: LEADING_GAP }}
              >
                <AppText
                  variant="rowName"
                  weight={500}
                  tone={disabled ? 'soft' : 'ink'}
                  numberOfLines={maxLabelLines}
                >
                  {label}
                </AppText>
                {leading}
              </View>
            )}

            {value === undefined ? null : (
              <AppText
                variant="time"
                weight={500}
                tone={disabled ? 'soft' : 'header'}
                tabularNums={false}
                numberOfLines={3}
                style={
                  stacked
                    ? { textAlign: I18nManager.isRTL ? 'right' : 'left' }
                    : { flexShrink: 0, maxWidth: VALUE_MAX_WIDTH, textAlign: 'right' }
                }
              >
                {value}
              </AppText>
            )}
          </View>

          {/* A control keeps its intrinsic width; the label yields instead.
              Without this the trailing slot shrinks like any other flex child, and when the
              label and the control together want more than the row has — a long Arabic or
              Turkish label, or any label at a large text size — the switch and the On/Off word
              beside it are squeezed until the word is drawn over the switch. Reported from an
              Arabic device: "مفعّل" sitting on top of its own toggle. */}
          {trailing === undefined ? null : <View style={{ flexShrink: 0 }}>{trailing}</View>}

          {showChevron ? (
            <Icon
              name={
                expanded === undefined ? 'chevron_right' : expanded ? 'expand_less' : 'expand_more'
              }
              size={ICON_SIZE}
              color={disabled ? colors.soft : colors.faint}
              // The chevron points the way navigation goes, which mirrors with the writing
              // direction. `isRTL` is read during render (not at module scope) so a direction
              // flip is picked up. A disclosure caret points along the vertical: it does not
              // mirror.
              style={
                expanded === undefined
                  ? { transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }] }
                  : undefined
              }
            />
          ) : null}
        </View>

        {description === undefined ? null : (
          <AppText
            // Named after the row, like the choice chips and the stepper buttons are, so a screen
            // can reach a *live* description (the Hijri preview) without a testID of its own.
            testID={testID === undefined ? undefined : `${testID}-description`}
            variant="caption"
            tone={disabled ? 'soft' : 'muted'}
          >
            {description}
          </AppText>
        )}

        {/* Nested content (choice chips, a stepper) belongs to the label, so it starts on the
            label's edge rather than hanging out to the left of it in a card that has glyphs. */}
        {children === undefined ? null : (
          <View style={{ marginTop: spacing.sm - 3, gap: spacing.sm }}>{children}</View>
        )}
      </View>
    </View>
  );

  const content = body;

  const paddedStyle: ViewStyle = {
    minHeight: MIN_ROW_HEIGHT,
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  };

  const label11y = accessibilityLabel ?? (value === undefined ? label : `${label}, ${value}`);

  if (!pressable) {
    return (
      <View
        testID={testID}
        style={[paddedStyle, style]}
        accessible={accessibilityRole !== undefined}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityRole === undefined ? undefined : label11y}
        accessibilityHint={accessibilityHint}
        accessibilityState={accessibilityState}
      >
        {content}
      </View>
    );
  }

  return (
    <PressableScale
      testID={testID}
      scale={1}
      pressedOpacity={ROW_PRESS_OPACITY}
      minTouchTarget={0}
      disabled={disabled}
      accessibilityRole={accessibilityRole ?? 'button'}
      accessibilityLabel={label11y}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, ...accessibilityState }}
      onPress={onPress}
      style={[paddedStyle, style]}
    >
      {content}
    </PressableScale>
  );
}

export interface SettingNavigationRowProps extends Omit<
  SettingRowProps,
  'onPress' | 'chevron' | 'accessibilityRole'
> {
  /** Where the row goes. Required — a navigation row that goes nowhere is a static row. */
  onPress: () => void;
}

/**
 * A row that opens another screen: label, optional value, chevron.
 *
 * @param onPress - Navigation action (usually `router.push`).
 * @returns A pressable {@link SettingRow} with the navigation chevron.
 */
export function SettingNavigationRow(props: SettingNavigationRowProps) {
  return <SettingRow {...props} chevron accessibilityRole="button" />;
}

export interface SettingSwitchRowProps extends Omit<
  SettingRowProps,
  'onPress' | 'trailing' | 'chevron' | 'value' | 'accessibilityRole' | 'accessibilityState'
> {
  /** Current state. */
  value: boolean;
  /** Called with the new state when the row (or the switch) is tapped. */
  onValueChange: (value: boolean) => void;
  /** Localized word for the on state — shown beside the switch so state is never colour-only. */
  onLabel: string;
  /** Localized word for the off state. */
  offLabel: string;
}

/**
 * A row carrying a switch. The whole row is the touch target.
 *
 * The `Switch` itself is inert (`pointerEvents="none"`) and hidden from assistive technology:
 * the row owns the gesture and exposes itself with the `switch` role, so there is exactly one
 * target, one accessibility node and no chance of a double toggle.
 *
 * @param value - Current state.
 * @param onValueChange - Receives the new state.
 * @returns A pressable row with `switch` role and a `checked` accessibility state.
 */
export function SettingSwitchRow({
  value,
  onValueChange,
  onLabel,
  offLabel,
  disabled = false,
  label,
  accessibilityLabel,
  ...rest
}: SettingSwitchRowProps) {
  return (
    <SettingRow
      {...rest}
      label={label}
      disabled={disabled}
      chevron={false}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked: value, disabled }}
      onPress={() => onValueChange(!value)}
      trailing={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <AppText
            variant="caption"
            tone={disabled ? 'soft' : 'header'}
            numberOfLines={1}
            style={{ flexShrink: 0 }}
          >
            {value ? onLabel : offLabel}
          </AppText>
          <PaperSwitch value={value} disabled={disabled} />
        </View>
      }
    />
  );
}
