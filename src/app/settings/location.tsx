import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Linking, ScrollView, View, type AppStateStatus } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { backChevron } from '@/i18n/direction';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { ClockZoneNote } from '@/components/ClockZoneNote';
import { Icon, type IconName } from '@/components/Icon';
import { PaperBackground } from '@/components/PaperBackground';
import { PressableScale } from '@/components/PressableScale';
import { SectionDivider } from '@/components/SectionDivider';
import { SettingGroup } from '@/components/SettingGroup';
import { SettingRow, SettingSwitchRow } from '@/components/SettingRow';
import {
  useIsResolvingLocation,
  useLocationActions,
  useLocationPermission,
  useLocationStatus,
} from '@/stores/locationStore';
import {
  useLocation,
  useSettingsActions,
  useTimeFormat,
  useUseAutoLocation,
} from '@/stores/settingsStore';
import { useLayout } from '@/hooks/useLayout';
import { radius, spacing, useTheme } from '@/theme';
import { formatTime } from '@/utils/formatTime';

/**
 * Settings → Location (PRODUCT_SPEC §10).
 *
 * The whole screen exists to make "no" a first-class answer. The research is unambiguous that the
 * category's dark pattern is a location prompt that will not take no for an answer, so:
 *
 * - **Nothing here prompts on its own.** The OS dialog can only appear from the switch, which is an
 *   explicit tap. `refresh()` (the launch path) never prompts, and this screen never calls it
 *   without `force`. There is no path to "Always" permission anywhere in the app.
 * - **A refusal is explained once, calmly, and then left alone.** The denied card states the
 *   consequence, offers the system-settings deep link *and* points at the manual row below — and
 *   it never grows, never repeats, and never blocks anything.
 * - **The manual path is equal, not lesser.** It sits in this screen's own rhythm, one row with
 *   the same weight as the device switch above it, and choosing a city turns auto-following off
 *   rather than fighting it. The search itself lives in `app/city` — one picker with four callers
 *   (here, the Today and Qibla prompt cards, and first-run setup), so the app cannot grow two
 *   city searches that drift apart.
 * - **The privacy line is on screen, not in a policy.** Approximate, on-device, never transmitted.
 *
 * It also carries the honest answer to the timezone question (see `ClockZoneNote`): times are
 * always written on the device's clock, and a city that keeps a different one says so out loud.
 *
 * Composition only — every decision is `stores/locationStore`'s, every string is i18n's.
 */
export default function LocationSettingsScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentClampPadding } = useLayout();
  const router = useRouter();

  const location = useLocation();
  const useAuto = useUseAutoLocation();
  const timeFormat = useTimeFormat();
  const { setUseAutoLocation } = useSettingsActions();

  const status = useLocationStatus();
  const busy = useIsResolvingLocation();
  const { permission, canAskAgain } = useLocationPermission();
  const { requestAndResolve, refresh, syncPermission } = useLocationActions();

  // Returning from the system settings screen is the one moment a refusal can become a grant
  // without the app doing anything, so the permission is re-read on every foreground. It only
  // *reads* — `syncPermission` cannot prompt.
  useEffect(() => {
    void syncPermission();
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void syncPermission();
    });
    return () => {
      subscription.remove();
    };
  }, [syncPermission]);

  // Back goes to Settings, not Today: this screen only ever hangs off the Settings tab, so with no
  // history to pop the parent is what "back" means. (`/qada` keeps its `/` fallback — that one is
  // genuinely reached from both Today and Settings.)
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }, [router]);

  const handleAutoChange = useCallback(
    (next: boolean) => {
      if (!next) {
        // Turning it off keeps whatever location is already stored — the user is choosing to stop
        // *following* the device, not to lose their times.
        setUseAutoLocation(false);
        return;
      }
      // The only prompt in the app, behind the only switch that asks for it.
      void requestAndResolve();
    },
    [requestAndResolve, setUseAutoLocation]
  );

  const openSystemSettings = useCallback(() => {
    void Linking.openSettings().catch(() => {
      // Some OEM builds refuse the deep link; choosing a city below is already the way out.
    });
  }, []);

  const lastChecked = useMemo(() => {
    if (location === null || location.source !== 'auto' || location.resolvedAt <= 0) return null;
    return formatTime(new Date(location.resolvedAt), { timeFormat, locale: i18n.language });
  }, [location, timeFormat, i18n.language]);

  // The device path is unavailable, and the user has asked for it (or never turned it off). This
  // is the only condition under which the screen explains a refusal at all.
  const showDenied = useAuto && permission !== 'granted' && status === 'denied';
  const showFailure = useAuto && status === 'error';

  return (
    <PaperBackground>
      <ScrollView
        testID="location-settings-scroll"
        showsVerticalScrollIndicator={false}
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
            testID="location-settings-back"
            accessibilityRole="button"
            accessibilityLabel={t('settings.location.back')}
            onPress={goBack}
            scale={0.9}
            style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name={backChevron()} size={24} color={colors.header} />
          </PressableScale>
          <AppText variant="rowName" weight={600} accessibilityRole="header" style={{ flex: 1 }}>
            {t('settings.location.title')}
          </AppText>
        </View>

        <SettingGroup divider={false} footer={t('settings.location.auto.footer')}>
          <SettingRow
            testID="location-current"
            icon={location === null ? 'my_location' : 'location_on'}
            label={location === null ? t('settings.location.current.none') : location.label}
            description={
              location === null
                ? t('settings.location.current.noneBody')
                : t(
                    location.source === 'auto'
                      ? 'settings.location.current.fromDevice'
                      : 'settings.location.current.chosen'
                  )
            }
            accessibilityRole="text"
            accessibilityLabel={
              location === null
                ? t('settings.location.current.none')
                : t('settings.location.current.a11y', { place: location.label })
            }
          />

          <SettingSwitchRow
            testID="location-auto-switch"
            label={t('settings.location.auto.label')}
            description={t('settings.location.auto.description')}
            value={useAuto}
            onValueChange={handleAutoChange}
            onLabel={t('settings.on')}
            offLabel={t('settings.off')}
            disabled={busy}
            accessibilityHint={t('settings.location.auto.a11yHint')}
          />

          {useAuto && permission === 'granted' ? (
            <SettingRow
              testID="location-refresh"
              icon="refresh"
              label={busy ? t('location.resolving') : t('settings.location.auto.refresh')}
              description={
                lastChecked === null
                  ? undefined
                  : t('settings.location.auto.lastChecked', { time: lastChecked })
              }
              chevron={false}
              disabled={busy}
              onPress={() => void refresh({ force: true })}
              accessibilityState={{ busy }}
            />
          ) : null}
        </SettingGroup>

        {showDenied ? (
          <NoticeCard
            testID="location-denied"
            icon="lock"
            title={t('settings.location.denied.title')}
            // Two different situations, two different sentences: the OS will still ask, or only
            // its settings screen can change the answer now. Saying the first when the second is
            // true is how an app ends up looking like it is nagging.
            body={t(
              canAskAgain ? 'settings.location.denied.body' : 'settings.location.denied.blockedBody'
            )}
            action={
              canAskAgain ? t('location.useMyLocation') : t('settings.location.denied.settings')
            }
            actionIcon={canAskAgain ? 'my_location' : 'open_in_new'}
            onAction={canAskAgain ? () => void requestAndResolve() : openSystemSettings}
            footnote={t('settings.location.denied.chooseInstead')}
          />
        ) : null}

        {showFailure ? (
          <NoticeCard
            testID="location-failed"
            icon="refresh"
            title={t('settings.location.unavailable.title')}
            body={t('settings.location.unavailable.body')}
            action={t('location.retry')}
            actionIcon="refresh"
            onAction={() => void refresh({ force: true })}
          />
        ) : null}

        <ClockZoneNote location={location} />

        <SectionDivider />

        {/* The manual path, as one row. The search itself is `app/city`, presented over this
            screen — the same picker the Today and Qibla cards and first-run setup open, so there
            is exactly one city search in the app. */}
        <SettingGroup
          title={t('settings.location.manual.heading')}
          footer={t('settings.location.manual.description')}
        >
          <SettingRow
            testID="location-choose-city"
            icon="search"
            label={t('location.chooseCity')}
            // No description: the row directly above already names the location in use, and the
            // group's own footer carries the privacy sentence.
            onPress={() => router.push('/city')}
            accessibilityHint={t('settings.location.manual.a11yHint')}
          />
        </SettingGroup>

        <SectionDivider placement="bottom" />

        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
          <Icon name="visibility_off" size={17} variant="outlined" color={colors.faint} />
          <AppText variant="hint" style={{ flex: 1 }}>
            {t('location.privacyNote')}
          </AppText>
        </View>
      </ScrollView>
    </PaperBackground>
  );
}

/**
 * A calm explanation with at most one action. Deliberately not the Today tab's
 * `LocationPromptCard`: that card's job is to *ask*, and this one's job is to explain something
 * the user has already decided and then get out of the way.
 */
function NoticeCard({
  icon,
  title,
  body,
  action,
  actionIcon,
  onAction,
  footnote,
  testID,
}: {
  icon: IconName;
  title: string;
  body: string;
  action?: string;
  actionIcon: IconName;
  onAction: () => void;
  footnote?: string;
  testID: string;
}) {
  const { colors } = useTheme();
  return (
    <Card
      testID={testID}
      variant="bright"
      border="mid"
      style={{ padding: spacing.lg, gap: spacing.sm }}
    >
      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
        <Icon name={icon} size={19} variant="outlined" color={colors.header} />
        <View accessible accessibilityRole="text" style={{ flex: 1, gap: 3 }}>
          <AppText variant="rowName">{title}</AppText>
          <AppText variant="caption" tone="header">
            {body}
          </AppText>
        </View>
      </View>
      {action === undefined ? null : (
        <PressableScale
          testID={`${testID}-action`}
          accessibilityRole="button"
          accessibilityLabel={action}
          onPress={onAction}
          style={{
            alignSelf: 'flex-start',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingVertical: 10,
            paddingHorizontal: spacing.lg,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: colors.borderMid,
            backgroundColor: colors.card,
          }}
        >
          <Icon name={actionIcon} size={15} color={colors.accent} />
          <AppText variant="time" weight={600} tabularNums={false} color={colors.accent}>
            {action}
          </AppText>
        </PressableScale>
      )}
      {footnote === undefined ? null : <AppText variant="hint">{footnote}</AppText>}
    </Card>
  );
}
