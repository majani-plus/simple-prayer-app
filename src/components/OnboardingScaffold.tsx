import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { PaperBackground } from './PaperBackground';
import { PressableScale } from './PressableScale';
import { useLayout } from '@/hooks/useLayout';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { backChevron } from '@/i18n/direction';
import { motion, radius, spacing, useTheme } from '@/theme';

/**
 * The page every first-run setup step is drawn on.
 *
 * Its whole job is to make each step look the same, so the only thing that changes between them
 * is the question. One page holds: where you are in the flow, one heading, one sentence, one
 * control, and at most two actions — the one that moves forward and, where the step has a real
 * cost, the one that declines it.
 *
 * ## Why the shape is this strict
 *
 * The owner's acceptance criterion for the whole flow is that it "should feel so dumb and easy
 * that an old person or a 7 year old could use". That is a constraint on *variety* more than on
 * wording: a person who has understood one of these pages has understood all of them, and every
 * extra affordance is another thing to rule out before answering. So the scaffold offers exactly
 * one slot for the control and refuses to grow a second column, a header action or a menu.
 *
 * Two consequences worth naming:
 *
 * - **The quiet action is optional, and its absence is deliberate.** A step that costs nothing to
 *   accept (the theme, the streak) carries only "Continue" — a second button that does the same
 *   thing as the first is a decision, not a kindness. A step that asks for a permission, for a
 *   backlog of missed prayers, or for the whole flow gets an explicit way to decline.
 * - **Type is set large.** Titles use the design's largest Latin role and bodies use the row-name
 *   size rather than the caption size: this audience skews older, and a setup screen is the one
 *   place with room to be generous.
 *
 * The step change cross-fades with a 6px rise, so a page that answers itself (the location step
 * turning into a confirmation) explains what happened. The rise is dropped under reduced motion.
 */

export interface OnboardingAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}

export interface OnboardingScaffoldProps {
  /** 1-based position of this step, for the progress dots. */
  step: number;
  /** How many steps this run of the flow has (Android has one more than iOS). */
  total: number;
  /** Goes back one step. Omitted on the first step, where there is nowhere to go. */
  onBack?: () => void;
  /** Glyph above the title. Ignored when `ornament` is given. */
  icon?: IconName;
  /** Rendered above the title in place of `icon` — the welcome step puts the app mark here. */
  ornament?: ReactNode;
  title: string;
  /** One sentence under the title. */
  body?: string;
  /** The step's control: option cards, a card, a search field. */
  children?: ReactNode;
  /** One quiet italic line under the control — an aside, never an instruction. */
  footnote?: string;
  /** The action that moves forward. */
  primary?: OnboardingAction;
  /** The action that declines this step and moves on anyway. */
  quiet?: OnboardingAction;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Diameter of one progress dot. */
const DOT_SIZE = 7;

/** How far the page rises as it fades in. */
const RISE = 6;

/**
 * One first-run setup page.
 *
 * @param step - 1-based position, shown as dots and announced as "Step 2 of 6".
 * @param quiet - The decline action; omit it on steps that cost nothing to accept.
 * @returns A full-screen paper page with the step's content between a progress header and the
 * action footer.
 */
export function OnboardingScaffold({
  step,
  total,
  onBack,
  icon,
  ornament,
  title,
  body,
  children,
  footnote,
  primary,
  quiet,
  style,
  testID = 'onboarding',
}: OnboardingScaffoldProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentClampStyle } = useLayout();
  const reduceMotion = useReduceMotion();

  // Re-run on every step change: the page is one animated surface, so the content swapping under
  // it is what the cross-fade describes.
  const appear = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) {
      appear.set(1);
      return;
    }
    appear.set(0);
    appear.set(
      withTiming(1, { duration: motion.state, easing: Easing.bezier(0.4, 0, 0.2, 1) })
    );
  }, [step, appear, reduceMotion]);

  const pageStyle = useAnimatedStyle(() => ({
    opacity: appear.get(),
    transform: [{ translateY: (1 - appear.get()) * RISE }],
  }));

  return (
    <PaperBackground>
      <View style={[{ flex: 1, paddingTop: insets.top + spacing.md }, style]}>
        {/* ------------------------------------------------------------------ PROGRESS */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            minHeight: 44,
            paddingHorizontal: spacing.lg,
          }}
        >
          <View style={{ width: 32 }}>
            {onBack === undefined ? null : (
              <PressableScale
                testID={`${testID}-back`}
                accessibilityRole="button"
                accessibilityLabel={t('onboarding.back')}
                onPress={onBack}
                scale={0.9}
                style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name={backChevron()} size={24} color={colors.header} />
              </PressableScale>
            )}
          </View>

          {/* Announced as one value ("Step 2 of 6") rather than as six unlabelled dots. */}
          <View
            testID={`${testID}-progress`}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={t('onboarding.progress', { step, total })}
            accessibilityValue={{ min: 1, max: total, now: step }}
            style={{
              flex: 1,
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {Array.from({ length: total }, (_, index) => index + 1).map((index) => (
              <View
                key={index}
                style={{
                  width: DOT_SIZE,
                  height: DOT_SIZE,
                  borderRadius: radius.pill,
                  backgroundColor: index <= step ? colors.accent : 'transparent',
                  borderWidth: index <= step ? 0 : 1,
                  borderColor: colors.borderMid,
                }}
              />
            ))}
          </View>

          {/* Balances the back chevron so the dots stay centred on the page. */}
          <View style={{ width: 32 }} />
        </View>

        {/* -------------------------------------------------------------------- CONTENT */}
        <ScrollView
          testID={`${testID}-scroll`}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          // The location step raises a keyboard for the city search; without this its results
          // sit under it (the same fix Settings → Location and the qada wizard carry).
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{
            flexGrow: 1,
            // Optically centred, not geometrically: the extra bottom padding lifts the block
            // above the true middle, which is where the eye reads a title page as sitting. On
            // the geometric centre the same block looks like it has slipped down the page.
            justifyContent: 'center',
            paddingHorizontal: spacing.xl,
            paddingTop: spacing.xl,
            paddingBottom: spacing.xxl * 3,
            gap: spacing.lg,
          }}
        >
          {/* The clamp belongs on this view, not on the `contentContainerStyle` above.
              A ScrollView sizes its content container itself, so the `alignSelf: 'center'` in the
              clamp means nothing there — `maxWidth` still applied, which left the column the right
              width and pinned to the START edge: hard left in English, hard right in Arabic, while
              the buttons below (a plain flex child, where `alignSelf` does work) sat centred. On a
              tablet that reads as a page that has slipped sideways, and it is what the owner saw
              on the Arabic onboarding (2026-08-30). `marginHorizontal: 'auto'` does not rescue it
              either: auto margins need free space to distribute, and the scroll host has already
              fixed the container's width.
              Here the view is an ordinary flex child of that container, so the clamp works as
              written — and the scroll surface stays full-width, so a drag anywhere on an iPad
              still scrolls the page. */}
          <Animated.View style={[{ gap: spacing.lg }, contentClampStyle, pageStyle]}>
            <View style={{ alignItems: 'center', gap: spacing.sm }}>
              {ornament ?? (icon === undefined ? null : (
                <Icon name={icon} size={34} color={colors.accent} />
              ))}
              {/* Heading and its sentence are one spoken unit; the controls announce themselves.
                  `alignSelf: 'stretch'` is load-bearing: inside the centred column this view
                  otherwise takes its content width, and a body longer than the screen ran off
                  the edge unwrapped instead of breaking (seen on the welcome step, 2026-08-24).
                  Stretched, the texts are bounded by the page padding and wrap. */}
              <View
                accessible
                accessibilityRole="header"
                style={{ alignSelf: 'stretch', alignItems: 'center', gap: 6 }}
              >
                <AppText variant="hero" style={{ textAlign: 'center' }}>
                  {title}
                </AppText>
                {body === undefined ? null : (
                  <AppText
                    variant="rowName"
                    weight={400}
                    tone="header"
                    style={{ textAlign: 'center' }}
                  >
                    {body}
                  </AppText>
                )}
              </View>
            </View>

            {children === undefined ? null : <View style={{ gap: spacing.sm }}>{children}</View>}

            {footnote === undefined ? null : (
              <AppText variant="hint" style={{ textAlign: 'center' }}>
                {footnote}
              </AppText>
            )}
          </Animated.View>
        </ScrollView>

        {/* --------------------------------------------------------------------- ACTIONS */}
        {/* Clamped with the page above it (D123): the buttons belong to that column, and left
            unclamped they would stretch the width of an iPad while the words they answer sat in
            a 600pt measure. */}
        <View
          style={{
            paddingHorizontal: spacing.xl,
            paddingBottom: insets.bottom + spacing.lg,
            gap: spacing.xs,
            alignItems: 'center',
            ...contentClampStyle,
          }}
        >
          {primary === undefined ? null : (
            <PressableScale
              testID={primary.testID ?? `${testID}-primary`}
              accessibilityRole="button"
              accessibilityLabel={primary.label}
              accessibilityState={{ disabled: primary.disabled ?? false }}
              disabled={primary.disabled ?? false}
              haptics
              onPress={primary.onPress}
              style={{
                alignSelf: 'stretch',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 52,
                paddingVertical: 14,
                paddingHorizontal: spacing.xxl,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: colors.accent,
                backgroundColor: (primary.disabled ?? false) ? colors.card : colors.accent,
                opacity: (primary.disabled ?? false) ? 0.6 : 1,
              }}
            >
              <AppText
                variant="rowName"
                weight={600}
                color={(primary.disabled ?? false) ? colors.header : colors.sealFg}
              >
                {primary.label}
              </AppText>
            </PressableScale>
          )}

          {quiet === undefined ? null : (
            <PressableScale
              testID={quiet.testID ?? `${testID}-quiet`}
              accessibilityRole="button"
              accessibilityLabel={quiet.label}
              onPress={quiet.onPress}
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 48,
                paddingVertical: spacing.md,
                paddingHorizontal: spacing.xl,
              }}
            >
              {/* Declining is a normal answer, so it is set in the same size as the body — quiet
                  by weight and colour, never by being too small to hit or read. */}
              <AppText variant="rowName" weight={400} tone="header">
                {quiet.label}
              </AppText>
            </PressableScale>
          )}
        </View>
      </View>
    </PaperBackground>
  );
}
