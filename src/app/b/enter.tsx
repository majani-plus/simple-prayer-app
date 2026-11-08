import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { PaperBackground } from '@/components/PaperBackground';
import { PressableScale } from '@/components/PressableScale';
import { useLayout } from '@/hooks/useLayout';
import { radius, spacing, useTheme } from '@/theme';

/**
 * Typing a code in, for the two people who are on the phone to each other rather than in the same
 * room. It does nothing but tidy what was typed and hand it to the accept screen.
 *
 * The tidying matters more than it looks: somebody reading a code aloud says "oh" for zero and
 * "ell" for one, and the alphabet the codes are drawn from leaves those letters out precisely so
 * that hearing them wrong is recoverable. The relay applies the same substitutions, so a code
 * mis-heard both ways still lands.
 *
 * This is a static route and the codes are eight characters, so it can never be shadowed by
 * `/b/[code]`.
 */
export default function EnterCodeScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentClampPadding } = useLayout();
  const router = useRouter();

  const [code, setCode] = useState('');
  const cleaned = code.toUpperCase().replace(/[^0-9A-Z]/g, '');

  const submit = useCallback(() => {
    if (cleaned.length !== 8) return;
    router.replace({ pathname: '/b/[code]', params: { code: cleaned } });
  }, [cleaned, router]);

  return (
    <PaperBackground>
      <ScrollView
        testID="buddy-enter-scroll"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + spacing.xxl,
          paddingHorizontal: spacing.xl,
          paddingBottom: insets.bottom + spacing.xxl,
          gap: spacing.lg,
          ...contentClampPadding(spacing.xl),
        }}
      >
        <AppText variant="rowName" weight={600} accessibilityRole="header">
          {t('buddy.settings.haveCode')}
        </AppText>

        <View style={{ gap: spacing.sm }}>
          <AppText variant="caption" color={colors.muted}>
            {t('buddy.accept.codeLabel')}
          </AppText>
          <TextInput
            testID="buddy-enter-code"
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={9}
            accessibilityLabel={t('buddy.accept.codeLabel')}
            style={{
              borderWidth: 1,
              borderColor: colors.borderMid,
              borderRadius: radius.card,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              color: colors.ink,
              minHeight: 48,
              letterSpacing: 3,
            }}
          />
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <PressableScale
            testID="buddy-enter-submit"
            accessibilityRole="button"
            accessibilityLabel={t('buddy.accept.confirm')}
            onPress={submit}
            disabled={cleaned.length !== 8}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: spacing.md,
              borderRadius: radius.pill,
              backgroundColor: colors.accent,
              opacity: cleaned.length === 8 ? 1 : 0.5,
            }}
          >
            <AppText variant="caption" weight={600} color={colors.sealFg}>
              {t('buddy.accept.confirm')}
            </AppText>
          </PressableScale>

          <PressableScale
            testID="buddy-enter-cancel"
            accessibilityRole="button"
            accessibilityLabel={t('buddy.accept.cancel')}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings/buddies'))}
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: spacing.md,
              paddingHorizontal: spacing.lg,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: colors.borderMid,
            }}
          >
            <AppText variant="caption" color={colors.muted}>
              {t('buddy.accept.cancel')}
            </AppText>
          </PressableScale>
        </View>
      </ScrollView>
    </PaperBackground>
  );
}
