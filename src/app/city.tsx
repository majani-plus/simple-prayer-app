import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { CitySearch } from '@/components/CitySearch';
import { Icon } from '@/components/Icon';
import { PaperBackground } from '@/components/PaperBackground';
import { PressableScale } from '@/components/PressableScale';
import { useLocationActions } from '@/stores/locationStore';
import { useLocation } from '@/stores/settingsStore';
import { useLayout } from '@/hooks/useLayout';
import { spacing, useTheme } from '@/theme';

import type { AppLocation } from '@/domain/types';

/**
 * The city picker — one screen, presented over whatever the user was already looking at.
 *
 * ## Why it is a route rather than four inline searches
 *
 * "Choose a city" used to push Settings → Location with `?focus=city`, so answering a prompt on
 * Today or Qibla dropped the user into a *different tab*, mid-task, with no obvious way back to
 * what they had been doing. Choosing a city is not a settings errand; it is the answer to a
 * question the current screen just asked. So it presents as a full-screen modal over that screen
 * and dismisses straight back to it — Today, Qibla, Settings → Location, and the first-run setup
 * flow all reach the same picker and all get returned exactly where they were.
 *
 * The choice needs no callback plumbing: `selectManualLocation` writes to the one store every
 * caller already reads, so by the time this screen is gone the caller is already showing the new
 * city. That is also what lets it be a route at all.
 *
 * ## The keyboard rule
 *
 * The one hard requirement (owner): **the results are never hidden behind the keyboard.** The
 * field is anchored at the top with the results scrolling beneath it, and the scroll view is
 * inset by the keyboard's own height — `automaticallyAdjustKeyboardInsets` on iOS, Expo's default
 * `softwareKeyboardLayoutMode: 'resize'` on Android. A field *pinned above* the keyboard was the
 * other candidate and was rejected: the iOS keyboard changes height when the suggestion bar
 * appears, hardware and floating keyboards report differently again, Android IME heights vary by
 * keyboard app, and the whole arrangement has to mirror under RTL. This one has none of those
 * failure modes and leaves more room for five results.
 *
 * Searching itself is `CitySearch`'s job, unchanged — the debounce, the last-write-wins guard,
 * the marker on the city already in use and the three distinct failure states all come with it.
 */
export default function CityPickerScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentClampPadding } = useLayout();
  const router = useRouter();

  const location = useLocation();
  const { selectManualLocation } = useLocationActions();

  /**
   * Back to whatever presented this. The fallback matters: a process restart or a deep link can
   * leave this screen with no history behind it, and Today is the only sane place to land.
   */
  const dismiss = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const handleSelect = useCallback(
    (candidate: AppLocation) => {
      selectManualLocation(candidate);
      dismiss();
    },
    [selectManualLocation, dismiss]
  );

  return (
    <PaperBackground>
      <ScrollView
        testID="city-picker-scroll"
        showsVerticalScrollIndicator={false}
        // Load-bearing: with the keyboard up, the first tap on a result would otherwise be spent
        // dismissing the keyboard rather than choosing the city.
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        // Tighter than the app's usual section rhythm, and deliberately so: this screen is only
        // ever seen with the keyboard covering the bottom half, and the five results have to fit
        // in what is left. Measured on the 6.5" simulator — at the looser spacing the fifth row
        // cleared the keyboard in English but was clipped in Arabic, where every row is taller
        // because Latin-designed sizes set in Amiri carry the ×1.15 language scale.
        contentContainerStyle={{
          paddingTop: insets.top + spacing.xs,
          paddingHorizontal: spacing.xl,
          paddingBottom: insets.bottom + spacing.xxl,
          gap: spacing.sm,
          ...contentClampPadding(spacing.xl),
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <PressableScale
            testID="city-picker-close"
            accessibilityRole="button"
            accessibilityLabel={t('location.picker.close')}
            onPress={dismiss}
            scale={0.9}
            style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="close" size={24} color={colors.header} />
          </PressableScale>
          <AppText variant="rowName" weight={600} accessibilityRole="header" style={{ flex: 1 }}>
            {t('location.chooseCity')}
          </AppText>
        </View>

        <CitySearch
          testID="city-picker-search"
          autoFocus
          onSelect={handleSelect}
          // The marker is only honest for a city the user picked: an `auto` location is the
          // device's answer, and the search cannot claim to be "in use" for it.
          selectedLabel={location !== null && location.source === 'manual' ? location.label : null}
        />

        <AppText variant="hint" style={{ paddingHorizontal: spacing.xs }}>
          {t('settings.location.manual.description')}
        </AppText>
      </ScrollView>
    </PaperBackground>
  );
}
