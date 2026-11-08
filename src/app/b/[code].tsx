import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { BuddyNameForm } from '@/components/BuddyNameForm';
import { Card } from '@/components/Card';
import { PaperBackground } from '@/components/PaperBackground';
import { PressableScale } from '@/components/PressableScale';
import { useLayout } from '@/hooks/useLayout';
import { firstFreeAvatar, type BuddyAvatar } from '@/domain/buddies';
import { useBuddyActions, useBuddyEnabled, useBuddyPairs } from '@/stores/buddyStore';
import { createBuddyCredentialStore } from '@/services/buddyCredentials';
import { getBuddyRelay } from '@/services/buddyRelay';
import { getBuddyPushToken } from '@/services/buddyPush';
import { radius, spacing, useTheme } from '@/theme';

/**
 * Accepting an invite — reached by tapping a buddy's link, or from the code screen next door.
 *
 * Everything the acceptor chooses here is local: the icon, the colour and the name they will see
 * this person under. The person on the other end never learns any of it, and none of it crosses a
 * network. That is the whole reason this screen has no "profile" to fill in and asks for nothing
 * about the acceptor at all.
 *
 * Somebody can land here having never opened Settings, so this screen turns buddy mode on by itself
 * — accepting an invite *is* the consent, and making them go and find a switch first would be
 * ceremony for its own sake.
 */
export default function AcceptBuddyScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentClampPadding } = useLayout();
  const router = useRouter();

  const params = useLocalSearchParams<{ code?: string }>();
  const code = typeof params.code === 'string' ? params.code : '';

  const enabled = useBuddyEnabled();
  const pairs = useBuddyPairs();
  const actions = useBuddyActions();

  const taken = useMemo(() => pairs.map((pair) => ({ icon: pair.icon, color: pair.color })), [pairs]);
  const [avatar, setAvatar] = useState<BuddyAvatar>(
    () => firstFreeAvatar(taken) ?? { icon: 'crescent', color: 'ocean' }
  );
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<null | 'invalid' | 'full'>(null);

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const accept = useCallback(() => {
    setBusy(true);
    setFailed(null);

    void (async () => {
      const credentials = createBuddyCredentialStore();
      const relay = getBuddyRelay();

      // Accepting is consent, so this is also where a first-time buddy registers.
      let auth = await credentials.read();
      if (!auth) {
        const registered = await relay.register();
        if (!registered.ok || !(await credentials.save(registered.value))) {
          setFailed('invalid');
          return;
        }
        auth = registered.value;
      }

      const result = await relay.redeem(auth, code);
      if (!result.ok) {
        // "Full" is not a bad code. The Buddies screen hides "Have a code?" at the limit, but a
        // deep link never passes through that screen, so this is the only place it can be said.
        setFailed(result.reason === 'full' ? 'full' : 'invalid');
        return;
      }

      actions.setEnabled(true);
      actions.setDeviceId(auth.deviceId);
      actions.addPair(
        {
          pairId: result.value.pairId,
          icon: avatar.icon,
          color: avatar.color,
          nickname,
          pending: false,
        },
        Date.now()
      );

      const token = await getBuddyPushToken();
      if (token) await relay.setPushToken(auth, token);

      router.replace('/settings/buddies');
    })()
      .catch(() => setFailed('invalid'))
      .finally(() => setBusy(false));
  }, [code, avatar, nickname, actions, router]);

  return (
    <PaperBackground>
      <ScrollView
        testID="buddy-accept-scroll"
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
          {t('buddy.accept.title')}
        </AppText>
        <AppText variant="caption" color={colors.muted}>
          {t('buddy.accept.body')}
        </AppText>

        {!enabled ? (
          <AppText variant="caption" color={colors.muted}>
            {t('buddy.settings.explain.sees')}
          </AppText>
        ) : null}

        <Card style={{ gap: spacing.lg, padding: spacing.lg }}>
          <BuddyNameForm
            nickname={nickname}
            onNickname={setNickname}
            avatar={avatar}
            onAvatar={setAvatar}
            taken={taken}
            testID="buddy-accept"
          />
        </Card>

        {failed ? (
          <AppText testID="buddy-accept-failed" variant="caption" color={colors.missed}>
            {t(failed === 'full' ? 'buddy.accept.full' : 'buddy.accept.invalid')}
          </AppText>
        ) : null}

        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <PressableScale
            testID="buddy-accept-confirm"
            accessibilityRole="button"
            accessibilityLabel={t('buddy.accept.confirm')}
            onPress={accept}
            disabled={busy || code.length === 0}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: spacing.md,
              borderRadius: radius.pill,
              backgroundColor: colors.accent,
              opacity: busy || code.length === 0 ? 0.5 : 1,
            }}
          >
            <AppText variant="caption" weight={600} color={colors.sealFg}>
              {t('buddy.accept.confirm')}
            </AppText>
          </PressableScale>

          <PressableScale
            testID="buddy-accept-cancel"
            accessibilityRole="button"
            accessibilityLabel={t('buddy.accept.cancel')}
            onPress={leave}
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
