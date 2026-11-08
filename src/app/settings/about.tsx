import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { backChevron } from '@/i18n/direction';
import { AppText } from '@/components/AppText';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { PaperBackground } from '@/components/PaperBackground';
import { PressableScale } from '@/components/PressableScale';
import { FeedbackRow } from '@/components/FeedbackRow';
import { RateAppRow } from '@/components/RateAppRow';
import { SectionDivider } from '@/components/SectionDivider';
import { SettingGroup } from '@/components/SettingGroup';
import { SettingNavigationRow, SettingRow } from '@/components/SettingRow';
import { TipJar } from '@/components/TipJar';
import { useAnnounceChange } from '@/hooks/useAnnounceChange';
import { useLayout } from '@/hooks/useLayout';
import {
  APP_WEBSITE_URL,
  BUNDLED_FONTS,
  UNKNOWN_VERSION,
  appBuild,
  appVersion,
  displayHost,
} from '@/services/appInfo';
import { spacing, useTheme } from '@/theme';

/**
 * Settings → About (PRODUCT_SPEC §12).
 *
 * Two of the things on this screen are obligations rather than features, and they are the reason
 * it exists at all:
 *
 * 1. **The adhan attribution.** Four recitations ship, each of a named reciter, and naming them
 *    here is the whole of what the app offers in return (D36, D81). `assets/audio/CREDITS.md`
 *    specifies the exact sentence and records why it is the *only* form of credit available: no
 *    licence document was located for any of the four, so there is no source page and no
 *    dedication to link to — unlike the CC0 recording that shipped until 2026-08-20, whose links
 *    used to live here. A test reads CREDITS.md and fails if the English string on this screen
 *    ever drifts from it.
 * 2. **The typeface licences.** Lora and Amiri ship under the SIL Open Font License 1.1 and the
 *    Material Symbols glyphs under Apache 2.0; all three are named, with who made them.
 *
 * The rest is the plain answer to "what is this?": the mark, the name, the version, and where to
 * find the app on the web. Typeface names and their designers come from `services/appInfo` as
 * data, because a translated name stops being a name you can check. The reciters are the one
 * exception, and for the same reason rather than in spite of it: three of the four have a real
 * Arabic spelling, so they live in the locale files and the Arabic bundle renders
 * "ناصر القطامي" where English renders "Nasser Alqatami" — the same name written properly.
 *
 * "Rate the app" is here as well as in Support, and it is a **store deep link** in both places,
 * never `expo-store-review` — see `components/RateAppRow` for why that distinction matters.
 */

export default function AboutScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentClampPadding } = useLayout();
  const router = useRouter();

  const [linkFailed, setLinkFailed] = useState(false);

  // The failure line appears at the bottom of the screen while the reader's focus is still on the
  // row that was tapped, and its `accessibilityLiveRegion` is Android-only — so on iOS the tap
  // that opened nothing also said nothing, which is the exact failure the line exists to prevent.
  useAnnounceChange(linkFailed ? t('settings.about.linkFailed') : null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }, [router]);

  const openLink = useCallback((url: string) => {
    setLinkFailed(false);
    void Linking.openURL(url).catch(() => {
      // A device with no browser at all is rare but real (kiosk builds, stripped ROMs). Saying so
      // beats a tap that appears to do nothing.
      setLinkFailed(true);
    });
  }, []);

  const version = appVersion();
  const build = appBuild();
  const versionLine =
    version === UNKNOWN_VERSION
      ? t('settings.about.versionUnknown')
      : build === null
        ? t('settings.about.version', { version })
        : t('settings.about.versionWithBuild', { version, build });

  return (
    <PaperBackground>
      <ScrollView
        testID="about-scroll"
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
            testID="about-back"
            accessibilityRole="button"
            accessibilityLabel={t('settings.about.back')}
            onPress={goBack}
            scale={0.9}
            style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name={backChevron()} size={24} color={colors.header} />
          </PressableScale>
          <AppText variant="rowName" weight={600} accessibilityRole="header" style={{ flex: 1 }}>
            {t('settings.about.title')}
          </AppText>
        </View>

        {/* ------------------------------------------------------------------ IDENTITY */}
        <View style={{ alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.lg }}>
          <Logo size={56} />
          <AppText variant="hero" weight={600} style={{ marginTop: spacing.sm }}>
            {t('app.name')}
          </AppText>
          <AppText variant="caption">{t('settings.about.tagline')}</AppText>
          <AppText testID="about-version" variant="caption" tone="header" tabularNums>
            {versionLine}
          </AppText>
        </View>

        {/* --------------------------------------------------------------------- AUDIO */}
        <SettingGroup
          testID="about-group-audio"
          title={t('settings.about.audio.title')}
          divider={false}
        >
          {/*
            A paragraph, not a setting: it keeps the row's padding so the group's hairlines line
            up, but it is set in the prose voice rather than as a bold row label.
          */}
          <View
            testID="about-audio-attribution"
            accessible
            accessibilityRole="text"
            accessibilityLabel={`${t('settings.about.audio.attribution')} ${t('settings.about.audio.choose')}`}
            style={{ paddingVertical: spacing.md, paddingHorizontal: spacing.lg }}
          >
            <AppText variant="caption" tone="muted">
              {t('settings.about.audio.attribution')}
            </AppText>
            {/* Where the choice lives, said once and quietly. This screen is a colophon: it
                credits the recordings, it does not offer to change them. */}
            <AppText variant="caption" tone="muted" style={{ marginTop: spacing.xs }}>
              {t('settings.about.audio.choose')}
            </AppText>
          </View>
        </SettingGroup>

        {/* --------------------------------------------------------------------- FONTS */}
        <SettingGroup
          testID="about-group-fonts"
          title={t('settings.about.fonts.title')}
          footer={t('settings.about.fonts.footer')}
        >
          {BUNDLED_FONTS.map((font) => (
            <SettingRow
              key={font.name}
              testID={`about-font-${font.name.toLowerCase().replace(/\s+/g, '-')}`}
              label={font.name}
              value={font.author}
              accessibilityRole="text"
              chevron={false}
            />
          ))}
        </SettingGroup>

        {/* ------------------------------------------------------------------- THE WEB */}
        <SettingGroup testID="about-group-web" title={t('settings.about.website.title')}>
          <SettingNavigationRow
            testID="about-website"
            icon="explore"
            label={displayHost(APP_WEBSITE_URL)}
            description={t('settings.about.website.description')}
            accessibilityHint={t('settings.about.website.a11yHint')}
            onPress={() => openLink(`${APP_WEBSITE_URL}/support`)}
          />
          {/* Free and open: anyone can read, build and copy it (docs/BUILD_YOURSELF.md). */}
          <SettingNavigationRow
            testID="about-source"
            icon="menu_book"
            label={t('settings.about.source.label')}
            description={t('settings.about.source.description')}
            accessibilityHint={t('settings.about.website.a11yHint')}
            onPress={() => openLink('https://github.com/majani-plus/simple-prayer-app')}
          />
          <RateAppRow testID="about-rate" />
          {/*
            The second home of the feedback row, on the same reasoning that already puts
            "Rate the app" in both places: someone hunting for a way to reach the developer looks
            in Settings, and then in About. Neither is the wrong answer, so both have it.
          */}
          <FeedbackRow testID="about-feedback" />
        </SettingGroup>

        {linkFailed ? (
          <AppText testID="about-link-failed" variant="hint" accessibilityLiveRegion="polite">
            {t('settings.about.linkFailed')}
          </AppText>
        ) : null}

        {/*
          The tip jar (PRODUCT_SPEC §14): three fixed consumables priced by the store (D57), below
          the web links and above the closing rule. It is a full card here rather than a row —
          nothing else on this screen is a place to *do* something, so it needs its own frame —
          and it carries its own "no ads, and never will be" line, because the pledge card that
          says so lives on Settings → Support, not here.

          It renders `null` until a RevenueCat public key is configured, which is the state of the
          world today: the products cannot exist before the owner's App Store Connect and Play
          Console accounts do. `docs/TIP_JAR_RUNBOOK.md` is the switch-on procedure.
        */}
        <TipJar testID="about-tip" />

        {/*
          The closing mark. It carries the ◆ where the other screens' bottom rules do not, because
          theirs bound a footnote below them — a bare rule reads as "and then this". Nothing
          follows this one, so a bare rule would read as an unfinished section instead of the end
          of the colophon.
        */}
        <SectionDivider placement="bottom" ornament />
      </ScrollView>
    </PaperBackground>
  );
}
