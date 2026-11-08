import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, ScrollView, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { backChevron } from '@/i18n/direction';
import { markHaptic } from '@/utils/haptics';
import { formatDate as localizedDate, formatNumber } from '@/i18n/numerals';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { PaperBackground } from '@/components/PaperBackground';
import { PressableScale } from '@/components/PressableScale';
import { QadaSetupWizard } from '@/components/QadaSetupWizard';
import { SectionDivider } from '@/components/SectionDivider';
import { StepButton } from '@/components/StepButton';
import { parseDay } from '@/domain/dates';
import { PRAYERS, type Prayer, type PrayerDay } from '@/domain/types';
import { useLayout } from '@/hooks/useLayout';
import { useQada } from '@/hooks/useQada';
import { useTrackingStore } from '@/stores/trackingStore';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { motion, radius, spacing, type as typeScale, useTheme } from '@/theme';

/**
 * The qada screen (PRODUCT_SPEC §7) — pushed from the Today card and from Settings.
 *
 * The whole screen is built around one idea: **the numbers descend, and the screen is on the
 * user's side while they do.** Concretely that means:
 *
 * - The hero is what is *left*, never what was accumulated, and it is set in the same gold as a
 *   streak — not in a warning colour. Nothing on this screen is red, and nothing counts up.
 * - Each prayer gets a ring that shrinks as its counter does, so a glance says which one needs
 *   attention without reading five numbers. The ring is proportional to the **largest** counter,
 *   not to some historical starting point the app does not store; the numeral is the fact, the
 *   ring is the shape of it.
 * - **The five counters are always here**, including at zero and before the wizard has ever
 *   run. The screen used to open the wizard over itself on a first visit, so someone who only
 *   wanted to add the two prayers they owe met a setup flow instead of the list; and at zero it
 *   showed no counters at all, so there was nothing to correct a mistap on. Every row can be
 *   nudged up as well as down (`useQada.putBack`), which is also the undo for a "made up" tapped
 *   by accident. The wizard is now something you *choose*, from the header.
 * - The pace and the projected clear day are shown **only when they mean something**. `domain/qada`
 *   withholds a date it cannot stand behind (one tick is not a pace), and this screen still says
 *   what was made up recently when there is no date to give — encouragement without a number that
 *   would be wrong.
 * - "Start fresh" is a quiet warm line, not a destructive button: it archives (never deletes),
 *   asks once, and then offers the undo in the same place for thirty days.
 * - At zero the screen is a relief state, not an empty state. Nothing asks for anything — the
 *   counters below it sit at zero and offer, rather than request.
 *
 * Composition only: every number comes from `hooks/useQada` (i.e. from `domain/qada` through the
 * tracking store), and the wizard is its own component.
 */

/** Diameter of a per-prayer progress ring, in points. */
const RING_SIZE = 54;

/** Ring stroke weight — thin, per DESIGN.md ("thin progress rings"). */
const RING_STROKE = 4;

/**
 * How much of the circle the *largest* outstanding counter is allowed to draw.
 *
 * A closed ring is reserved for a cleared prayer. Without this cap the biggest debt drew one too:
 * `count / largest` is exactly 1 for the worst prayer, so the prayer most in need and the prayer
 * already finished wore the same shape, distinguishable only by a numeral. Every debt therefore
 * keeps a visible gap, and the arc stays honestly proportional to the count within that range.
 */
const MAX_DEBT_ARC = 0.86;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export default function QadaScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentClampPadding } = useLayout();
  const router = useRouter();
  const qada = useQada();

  // The wizard never opens itself. Someone arriving here for the first time gets the five
  // counters, which is what they came for; counting a backlog is an offer in the header, not a
  // gate in front of the screen.
  //
  // The one exception is a caller who *asked* for it on the way in — today that is first-run
  // setup's last step, whose button says "Count them with me" and which would otherwise land the
  // user on five zeroes and a small header link they just pressed a button to avoid. It is read
  // once, as the initial state, so dismissing the wizard is final for this visit even though the
  // param is still sitting on the route.
  const params = useLocalSearchParams<{ setup?: string }>();
  const [wizardOpen, setWizardOpen] = useState(() => params.setup === '1');
  // Whether *this visit* began as first-run setup's hand-over, kept separately because the state
  // above consumes the param on the first render and is then free to be turned off. It decides
  // where closing the wizard leaves the user: see `handleWizardDone`.
  const cameFromSetup = useRef(params.setup === '1');
  // The store's own "today" (Fajr→Fajr via the installed resolver), so the wizard's range agrees
  // with every other surface about which day it currently is — see where it is passed below.
  const today = useTrackingStore((state) => state.todayDay());
  const [confirmingForgive, setConfirmingForgive] = useState(false);

  const { total, debts, progress, undoableForgive } = qada;

  const formatDate = useCallback(
    (day: PrayerDay) =>
      localizedDate(parseDay(day), i18n.language, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    [i18n.language]
  );

  const numbers = useMemo(
    () => (value: number) => formatNumber(value, i18n.language),
    [i18n.language]
  );

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  /**
   * Closing the wizard. On an ordinary visit it just closes — the user came here for the counters
   * and the counters are what is underneath.
   *
   * On a visit that first-run setup handed over, it also leaves. Counting a backlog was the last
   * thing setup offered, not a destination, and a user reported what happens without this: they
   * finished the estimate, were left on a full-screen counter list with no tab bar, and concluded
   * that this was the app's main screen and that prayers get marked here. Today is where setup
   * ends. What they just entered is waiting for them there as the qada card, one tap from here.
   */
  const handleWizardDone = useCallback(() => {
    setWizardOpen(false);
    if (!cameFromSetup.current) return;
    cameFromSetup.current = false;
    goBack();
  }, [goBack]);

  const handleMakeUp = useCallback(
    (prayer: Prayer) => {
      if (qada.makeUp(prayer)) markHaptic();
    },
    [qada]
  );

  // Owing one more. Its first job is undoing a "made up" tapped by mistake — the counters can
  // only descend, so without this a mistap was unfixable from here — and its second is the
  // person who simply knows they owe another Asr. `putBack` is the same audited write the rest
  // of the feature uses, and `applyMiss` underneath it can only ever add one.
  // `StepButton` brings its own tap feedback, so this adds none of its own.
  const handleAddBack = useCallback(
    (prayer: Prayer) => {
      qada.putBack(prayer);
    },
    [qada]
  );

  const handleForgive = useCallback(() => {
    setConfirmingForgive(false);
    qada.forgive();
  }, [qada]);

  const handleRestore = useCallback(() => {
    qada.restoreForgiven();
  }, [qada]);

  // A confirmation left open while the debt disappears underneath it — the last counter ticked
  // off while the card is up — needs no reset: the whole branch it lives in only exists above
  // zero, so the relief state replaces it and `handleForgive` closes it on the other path.
  const largest = useMemo(
    () => PRAYERS.reduce((max, prayer) => Math.max(max, debts[prayer]), 0),
    [debts]
  );

  // Whether a date may be shown is `domain/qada`'s decision, not this screen's: it withholds one
  // whenever the pace is too thin, the debt too small or the answer too far to stand behind. The
  // recent-pace line is a separate question — it is true whenever anything was made up at all,
  // and it is worth saying on its own.
  const projectedClearDay = progress.projectedClearDay;
  const madeUpRecently = progress.paidInWindow > 0;

  // The wizard is an offer, and its label depends on whether it has ever been taken up.
  const setupLabel = t(qada.setupCompleted ? 'qada.setup.rerun' : 'qada.setup.backtrack.title');

  return (
    <PaperBackground>
      <ScrollView
        testID="qada-scroll"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // Same fix as Settings → Location: the setup wizard's date and count fields would otherwise
        // sit under the keyboard. iOS insets the scroll view by the keyboard's height; Android
        // resizes the window via Expo's default `softwareKeyboardLayoutMode: 'resize'`.
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{
          paddingTop: insets.top + spacing.lg,
          paddingHorizontal: spacing.xl,
          paddingBottom: insets.bottom + spacing.xxl,
          gap: spacing.lg,
          ...contentClampPadding(spacing.xl),
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <PressableScale
            testID="qada-back"
            accessibilityRole="button"
            accessibilityLabel={t('qada.back')}
            onPress={goBack}
            scale={0.9}
            style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
          >
            {/* "Back" points the way the language runs, as it does in CalendarMonth's month
                stepper. RTL is switched on in M8; mirroring here now means the audit has one
                fewer wrong-facing glyph to find. */}
            <Icon name={backChevron()} size={24} color={colors.header} />
          </PressableScale>
          <AppText variant="rowName" weight={600} accessibilityRole="header" style={{ flex: 1 }}>
            {t('qada.title')}
          </AppText>
          {!wizardOpen ? (
            <PressableScale
              testID="qada-rerun-setup"
              accessibilityRole="button"
              accessibilityLabel={setupLabel}
              onPress={() => setWizardOpen(true)}
              style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.sm }}
            >
              <AppText variant="caption" tone="header">
                {setupLabel}
              </AppText>
            </PressableScale>
          ) : null}
        </View>

        <SectionDivider />

        {wizardOpen ? (
          // The PRAYER day, not the calendar date. The wizard's range stops at *yesterday*
          // because today's prayers belong to the Today screen, and between midnight and Fajr the
          // two dates differ: left to its own `todayDay()` default the wizard would offer the
          // current, still-open prayer day as the last countable one, charging five prayers the
          // user can still go and pray (PRODUCT_SPEC §3 — the day runs Fajr→Fajr).
          <QadaSetupWizard today={today} onDone={handleWizardDone} />
        ) : (
          <>
            {total === 0 ? (
              <ReliefState
                onCount={() => setWizardOpen(true)}
                undoAvailable={undoableForgive !== null}
                undoDays={qada.undoWindowDays}
                onUndo={handleRestore}
              />
            ) : (
              <>
                <View
                  testID="qada-hero"
                  accessible
                  accessibilityRole="text"
                  accessibilityLabel={t('qada.screen.a11yTotal', {
                    total: t('qada.count', { count: total }),
                  })}
                  style={{ alignItems: 'center', gap: 2 }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 7 }}>
                    <AppText
                      testID="qada-total"
                      variant="hero"
                      weight={700}
                      tone="diamond"
                      tabularNums
                      style={{ fontSize: typeScale.heroArabic }}
                    >
                      {numbers(total)}
                    </AppText>
                    <AppText variant="rowName" tone="muted">
                      {t('qada.unit', { count: total })}
                    </AppText>
                  </View>
                  <AppText variant="caption" tone="header">
                    {t('qada.screen.remaining')}
                  </AppText>
                </View>

                <Card
                  testID="qada-pace"
                  variant="bright"
                  border={projectedClearDay === null ? 'faint' : 'strong'}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.md,
                    padding: spacing.lg,
                  }}
                >
                  <Icon
                    name={projectedClearDay === null ? 'schedule' : 'done_all'}
                    size={20}
                    // Outlined: `schedule` at FILL=1 is a solid disc, and a coin of accent next to
                    // one calm sentence reads as a warning badge — the one thing this card must
                    // not be.
                    variant="outlined"
                    color={colors.accent}
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    {/* What was made up recently is always true and always worth saying, even
                        when the domain refuses to name a date for it. */}
                    {madeUpRecently ? (
                      <AppText testID="qada-pace-recent" variant="caption" tone="header">
                        {t('qada.pace.recent', {
                          value: numbers(progress.paidInWindow),
                          days: qada.paceWindowDays,
                        })}
                      </AppText>
                    ) : null}
                    {projectedClearDay !== null ? (
                      <AppText testID="qada-projection" variant="rowName">
                        {t('qada.pace.projected', { date: formatDate(projectedClearDay) })}
                      </AppText>
                    ) : (
                      <AppText variant="caption" tone="header">
                        {t('qada.pace.none')}
                      </AppText>
                    )}
                  </View>
                </Card>
              </>
            )}

            <SectionDivider />
            <AppText variant="caption" tone="header" style={{ textAlign: 'center' }}>
              {t('qada.screen.perPrayer')}
            </AppText>

            {/* Always here — at zero, and before the wizard has ever been run. This list *is* the
                screen; someone who owes two Fajrs can add them from here and never meet a wizard. */}
            <View testID="qada-counters" style={{ gap: spacing.sm }}>
              {PRAYERS.map((prayer) => (
                <CounterRow
                  key={prayer}
                  prayer={prayer}
                  count={debts[prayer]}
                  largest={largest}
                  onMakeUp={() => handleMakeUp(prayer)}
                  onAdd={() => handleAddBack(prayer)}
                />
              ))}
            </View>

            <SectionDivider placement="bottom" />

            {total > 0 ? (
              <>
                {/* The undo belongs to the forgiveness, not to the zero: "you can bring them back
                    for 30 days" is a promise made before the counters were cleared, and a single
                    prayer logged as missed the next morning must not quietly take it away. It
                    therefore lives here as well as in the relief state — the two branches are
                    exclusive, so it is still only ever on screen once (PRODUCT_SPEC §7). */}
                {!confirmingForgive && undoableForgive !== null ? (
                  <ForgiveUndoCard days={qada.undoWindowDays} onUndo={handleRestore} />
                ) : null}

                {confirmingForgive ? (
                  <Card
                    testID="qada-forgive-confirm"
                    variant="elevated"
                    border="strong"
                    style={{ padding: spacing.lg, gap: spacing.sm }}
                  >
                    <AppText variant="rowName">{t('qada.forgive.confirmTitle')}</AppText>
                    <AppText variant="caption" tone="header">
                      {t('qada.forgive.confirmBody', {
                        total: t('qada.count', { count: total }),
                        days: qada.undoWindowDays,
                      })}
                    </AppText>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'center',
                        gap: spacing.md,
                        marginTop: spacing.xs,
                      }}
                    >
                      <SoftButton
                        testID="qada-forgive-cancel"
                        label={t('qada.forgive.cancel')}
                        onPress={() => setConfirmingForgive(false)}
                      />
                      <SoftButton
                        testID="qada-forgive-confirm-action"
                        label={t('qada.forgive.confirm')}
                        emphasis
                        onPress={handleForgive}
                      />
                    </View>
                  </Card>
                ) : (
                  <View style={{ alignItems: 'center', gap: spacing.xs }}>
                    <PressableScale
                      testID="qada-forgive"
                      accessibilityRole="button"
                      accessibilityLabel={t('qada.forgive.action')}
                      accessibilityHint={t('qada.forgive.explain')}
                      onPress={() => setConfirmingForgive(true)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingVertical: 10,
                        paddingHorizontal: spacing.lg,
                      }}
                    >
                      <Icon name="spa" size={17} color={colors.header} />
                      <AppText variant="rowName" tone="header">
                        {t('qada.forgive.action')}
                      </AppText>
                    </PressableScale>
                    <AppText variant="hint" style={{ textAlign: 'center' }}>
                      {t('qada.forgive.explain')}
                    </AppText>
                  </View>
                )}

                <AppText variant="hint" style={{ textAlign: 'center' }}>
                  {t('qada.screen.footerHint')}
                </AppText>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </PaperBackground>
  );
}

/* -------------------------------------------------------------------------------------------- */

/**
 * One prayer's line: the ring with its number, the name, a quiet `+`, and the button that makes
 * the number smaller. A cleared prayer keeps its line — it is the visible proof of what has been
 * done — and says "cleared" in words as well as in colour instead of offering the make-up button.
 *
 * The `+` stays on a cleared row on purpose: it is how someone adds a prayer they know they owe
 * without going near the wizard, and how a "made up" tapped by mistake is put back. It is the
 * smaller, quieter control of the two — this screen is for the number going down.
 */
function CounterRow({
  prayer,
  count,
  largest,
  onMakeUp,
  onAdd,
}: {
  prayer: Prayer;
  count: number;
  largest: number;
  onMakeUp: () => void;
  onAdd: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const name = t(`prayers.${prayer}`);
  const cleared = count === 0;

  return (
    <Card
      testID={`qada-row-${prayer}`}
      variant={cleared ? 'quiet' : 'normal'}
      border="faint"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
      }}
    >
      <CounterRing
        count={count}
        largest={largest}
        locale={i18n.language}
        testID={`qada-ring-${prayer}`}
      />

      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 7 }}>
        <AppText variant="rowName">{name}</AppText>
        {/* Only when it differs — in Arabic the two are the same word (see PrayerRow). */}
        {t(`prayers.arabic.${prayer}`) === name ? null : (
          <AppText variant="rowArabic">{t(`prayers.arabic.${prayer}`)}</AppText>
        )}
      </View>

      <StepButton
        testID={`qada-add-${prayer}`}
        icon="add"
        accessibilityLabel={t('qada.screen.addA11y', { prayer: name })}
        onPress={onAdd}
      />

      {cleared ? (
        <View
          testID={`qada-cleared-${prayer}`}
          accessible
          accessibilityRole="text"
          accessibilityLabel={t('qada.screen.clearedA11y', { prayer: name })}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 6 }}
        >
          <Icon name="check_circle" size={17} color={colors.accent} />
          <AppText variant="caption" tone="muted">
            {t('qada.screen.cleared')}
          </AppText>
        </View>
      ) : (
        <PressableScale
          testID={`qada-make-up-${prayer}`}
          accessibilityRole="button"
          accessibilityLabel={t('qada.screen.makeUpA11y', { prayer: name })}
          onPress={onMakeUp}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            minHeight: 38,
            paddingVertical: 8,
            paddingHorizontal: spacing.md,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: colors.accent,
            backgroundColor: colors.card,
          }}
        >
          <Icon name="check" size={16} color={colors.accent} />
          <AppText variant="time" weight={600} tabularNums={false} color={colors.accent}>
            {t('qada.screen.makeUp')}
          </AppText>
        </PressableScale>
      )}
    </Card>
  );
}

/**
 * The thin ring around a counter.
 *
 * The arc is `count / largest`, i.e. relative to the biggest outstanding counter — the app does
 * not store what any counter *started* at, and inventing a baseline to draw a "% done" arc would
 * be a number the screen cannot stand behind. What it can promise is honest and is what the eye
 * actually uses: the fullest ring is the prayer to reach for, and every ring shrinks over time.
 *
 * The arc is animated on the UI thread, so it eases down as the number drops even while the
 * write is hitting SQLite.
 */
function CounterRing({
  count,
  largest,
  locale,
  testID,
}: {
  count: number;
  largest: number;
  locale: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const radiusPx = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radiusPx;
  const cleared = count === 0;
  // A cleared prayer gets a CLOSED circle in the accent — the shape says "complete", which is the
  // one place on this screen where a full ring is good news rather than a big number. Every other
  // ring stops short of closing (see {@link MAX_DEBT_ARC}) so the two can never be confused.
  const fraction = cleared ? 1 : largest > 0 ? Math.min(1, count / largest) * MAX_DEBT_ARC : 0;

  // Reduced motion: the arc renders at its final value instead of easing there (§2.7) — the
  // numeral inside the ring already carries the change.
  const reduceMotion = useReduceMotion();
  const filled = useSharedValue(fraction);
  useEffect(() => {
    filled.set(
      reduceMotion
        ? fraction
        : withTiming(fraction, { duration: motion.dial, easing: Easing.bezier(0.3, 0.7, 0.3, 1) })
    );
  }, [fraction, filled, reduceMotion]);

  const arc = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - filled.get()),
  }));

  return (
    <View
      style={{
        width: RING_SIZE,
        height: RING_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Svg
        width={RING_SIZE}
        height={RING_SIZE}
        // The arc is a **gauge**: it starts at twelve and fills clockwise as the debt grows, which
        // reads as "forward" — so in Arabic it fills the other way, exactly as a progress bar does.
        // Mirroring the drawing surface (not the numeral, which is a sibling) is the whole change.
        //
        // Deliberately *unlike* the History calendar's five-slot ring, which stays put in both
        // directions: that one is a clock face — Fajr at twelve, running through the day — and a
        // day does not run backwards in Arabic any more than a clock does.
        style={{ position: 'absolute', transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }] }}
        pointerEvents="none"
        testID={testID}
      >
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={radiusPx}
          fill="none"
          stroke={colors.borderFaint}
          strokeWidth={RING_STROKE}
        />
        <AnimatedCircle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={radiusPx}
          fill="none"
          // A closed ring in the accent is an achievement *against* something still outstanding.
          // With nothing owed anywhere — the relief state, and every first visit — five gold
          // circles under a gold check would be a fanfare for a debt that never existed, so the
          // shape stays and the colour steps back.
          stroke={cleared ? (largest === 0 ? colors.borderMid : colors.accent) : colors.diamond}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={circumference}
          animatedProps={arc}
          // Start the arc at twelve o'clock rather than at three.
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      </Svg>
      <AppText
        variant="rowName"
        weight={600}
        // A cleared counter recedes, but not to the point where its own ring outshouts it:
        // `soft` is the inactive-tab gold and sat at ~3:1 inside a full accent circle.
        tone={cleared ? 'muted' : 'strong'}
        tabularNums
        // The numeral is the fact and the ring only shapes it, so it is set large (DESIGN.md) and
        // only steps down when a four-figure count would otherwise overflow the ring.
        style={{ fontSize: count >= 1000 ? typeScale.rowTime : typeScale.streakNumber }}
      >
        {formatNumber(count, locale)}
      </AppText>
    </View>
  );
}

/** Zero owed: relief, not absence. Nothing here asks for anything. */
function ReliefState({
  onCount,
  undoAvailable,
  undoDays,
  onUndo,
}: {
  onCount: () => void;
  undoAvailable: boolean;
  undoDays: number;
  onUndo: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <View testID="qada-relief" style={{ alignItems: 'center', gap: spacing.md }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.accent,
        }}
      >
        <Icon name="check" size={30} color={colors.sealFg} />
      </View>
      <AppText variant="hero" style={{ textAlign: 'center' }}>
        {t('qada.screen.relief.title')}
      </AppText>
      <AppText variant="caption" tone="header" style={{ textAlign: 'center' }}>
        {t('qada.screen.relief.body')}
      </AppText>

      {undoAvailable ? <ForgiveUndoCard days={undoDays} onUndo={onUndo} /> : null}

      <PressableScale
        testID="qada-relief-count"
        accessibilityRole="button"
        accessibilityLabel={t('qada.screen.relief.setup')}
        onPress={onCount}
        style={{ paddingVertical: 10, paddingHorizontal: spacing.lg }}
      >
        <AppText variant="caption" tone="header">
          {t('qada.screen.relief.setup')}
        </AppText>
      </PressableScale>
    </View>
  );
}

/**
 * The standing offer to bring a forgiven debt back, for as long as the window lasts.
 *
 * It is one component rather than two so the wording, the weight and the affordance cannot drift
 * apart between the relief state (nothing owed since) and the counters (something owed again).
 */
function ForgiveUndoCard({ days, onUndo }: { days: number; onUndo: () => void }) {
  const { t } = useTranslation();
  return (
    <Card
      testID="qada-forgive-undo"
      variant="bright"
      border="mid"
      style={{ padding: spacing.lg, gap: spacing.sm, alignSelf: 'stretch' }}
    >
      <AppText variant="rowName">{t('qada.forgive.doneTitle')}</AppText>
      <AppText variant="caption" tone="header">
        {t('qada.forgive.doneBody', { days })}
      </AppText>
      <SoftButton
        testID="qada-forgive-undo-action"
        label={t('qada.forgive.undo')}
        onPress={onUndo}
      />
    </Card>
  );
}

/**
 * A warm pill. Even the affirmative half of "Start fresh" is outlined rather than filled and
 * carries no destructive colour: the design language has no red button and this screen least
 * of all (DESIGN.md, PRODUCT_SPEC §7).
 */
function SoftButton({
  label,
  onPress,
  emphasis = false,
  testID,
  icon,
}: {
  label: string;
  onPress: () => void;
  emphasis?: boolean;
  testID: string;
  icon?: IconName;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      haptics
      onPress={onPress}
      style={{
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 10,
        paddingHorizontal: spacing.xl,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: emphasis ? colors.accent : colors.borderMid,
        backgroundColor: emphasis ? colors.cardElevated : colors.card,
      }}
    >
      {icon === undefined ? null : (
        <Icon name={icon} size={16} color={emphasis ? colors.accent : colors.header} />
      )}
      <AppText
        variant="time"
        weight={600}
        tabularNums={false}
        color={emphasis ? colors.accent : colors.header}
      >
        {label}
      </AppText>
    </PressableScale>
  );
}
