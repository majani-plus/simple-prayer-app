import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Linking, ScrollView, View, type AppStateStatus } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { backChevron, forwardChevron } from '@/i18n/direction';
import { AppText } from '@/components/AppText';
import { BuddyAvatar } from '@/components/BuddyAvatar';
import { Card } from '@/components/Card';
import { EditBuddySheet } from '@/components/EditBuddySheet';
import { Icon } from '@/components/Icon';
import { InviteBuddySheet } from '@/components/InviteBuddySheet';
import { PaperBackground } from '@/components/PaperBackground';
import { PressableScale } from '@/components/PressableScale';
import { SettingGroup } from '@/components/SettingGroup';
import { SettingRow, SettingSwitchRow } from '@/components/SettingRow';
import { useLayout } from '@/hooks/useLayout';
import { useNow } from '@/hooks/useNow';
import { canAddBuddy, isInviteLive } from '@/domain/buddies';
import {
  useBuddyActions,
  useBuddyEnabled,
  useBuddyInvite,
  useBuddyNotify,
  useBuddyPairs,
  useEndedPairs,
  useInviteFor,
} from '@/stores/buddyStore';
import { createBuddyCredentialStore } from '@/services/buddyCredentials';
import { getBuddyRelay } from '@/services/buddyRelay';
import { buddyNotificationsAllowed, getBuddyPushToken } from '@/services/buddyPush';
import { formatDuration } from '@/utils/formatTime';
import { radius, spacing, useTheme } from '@/theme';

/**
 * Settings → Buddies (D174, reshaped by D181).
 *
 * The screen answers three questions before it offers anything, in this order, because somebody
 * arriving here is being asked to let a thing about their worship leave their phone for the first
 * time: what a buddy sees, what they never see, and what actually travels. The third names the
 * relay and links to its source, because "trust us" is not an answer this app gets to give.
 *
 * After the switch, the screen is a **list**: your buddies, each a row you tap to rename, re-face
 * or remove; an invite you have made and are waiting on, with the time it has left; and two ways
 * to add somebody. Everything that is a *moment* — inviting, being accepted, editing — happens in
 * a sheet over this list rather than as cards appearing inside it, so the list never rearranges
 * itself under a thumb.
 *
 * Failures here are quiet and recoverable. A relay that will not answer means the invite sheet
 * says to try again; it never blocks the screen, and nothing else in the app notices.
 */

export default function BuddiesScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentClampPadding } = useLayout();
  const router = useRouter();

  const enabled = useBuddyEnabled();
  const notify = useBuddyNotify();
  const pairs = useBuddyPairs();
  const invite = useBuddyInvite();
  const inviteFor = useInviteFor();
  const ended = useEndedPairs();
  const actions = useBuddyActions();

  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notificationsOff, setNotificationsOff] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }, [router]);

  // Buddy mode works without notification permission — marks arrive when the app is opened — but
  // silently, which looks like nothing happening. Checked on every foreground, because returning
  // from system settings is the one moment a refusal becomes a grant without the app doing
  // anything. It only ever *reads* the permission; nothing here prompts.
  useEffect(() => {
    if (!enabled) return;

    const check = () => void buddyNotificationsAllowed().then((ok) => setNotificationsOff(!ok));
    check();
    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') check();
    });
    return () => subscription.remove();
  }, [enabled]);

  // An invite that ran out is just gone: its row leaves the list, and the button offers a new
  // one. Checked once a minute, which is also how often the row's "expires in" line ticks.
  const now = useNow(60_000);
  useEffect(() => {
    if (invite !== null && !isInviteLive(invite, now.getTime())) actions.setInvite(null);
  }, [invite, now, actions]);

  const inviteTimeLeft = useMemo(
    () =>
      invite ? formatDuration(invite.expiresAt - now.getTime(), { style: 'long', countdown: false }) : '',
    [invite, now]
  );

  /**
   * Turning it on registers this phone with the relay and hands over a push token if notifications
   * are already allowed. It never prompts for permission on its own — the row below explains the
   * consequence and offers the system settings instead.
   */
  const handleEnable = useCallback(
    (next: boolean) => {
      if (!next) {
        setFailed(false);
        const credentials = createBuddyCredentialStore();
        void (async () => {
          const auth = await credentials.read();
          if (!auth) return;

          // Tell the relay first: it deletes the device, its pairs and every flag addressed to it.
          const result = await getBuddyRelay().forgetDevice(auth);

          // Only forget the secret once the relay has actually been told, or has told us it no
          // longer knows this phone. Clearing it after a failed call would strand the row there for
          // ninety days with nothing able to authenticate against it again — the buddy's sends
          // would keep succeeding, they would never see the link end, and the privacy policy's
          // "it forgets when either of you leaves" would quietly not have happened.
          if (result.ok || result.reason === 'gone') {
            await credentials.clear();
          }
        })().catch(() => undefined);
        actions.setEnabled(false);
        return;
      }

      setBusy(true);
      setFailed(false);
      void (async () => {
        const credentials = createBuddyCredentialStore();
        const existing = await credentials.read();
        const auth = existing ?? (await registerDevice(credentials));
        if (!auth) {
          setFailed(true);
          return;
        }
        actions.setEnabled(true);
        actions.setDeviceId(auth.deviceId);

        const token = await getBuddyPushToken();
        if (token) await getBuddyRelay().setPushToken(auth, token);
      })()
        .catch(() => setFailed(true))
        .finally(() => setBusy(false));
    },
    [actions]
  );

  const handleRemove = useCallback(
    (pairId: string) => {
      // Local first, so the row goes the moment it is tapped. The relay is told next; if that
      // fails, the other side finds out when their own next send is refused.
      actions.removePair(pairId);
      void (async () => {
        const auth = await createBuddyCredentialStore().read();
        if (auth) await getBuddyRelay().unpair(auth, pairId);
      })().catch(() => undefined);
    },
    [actions]
  );

  const rowStyle = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    padding: spacing.md,
    minHeight: 64,
  };

  return (
    <PaperBackground>
      <ScrollView
        testID="buddies-scroll"
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
            testID="buddies-back"
            accessibilityRole="button"
            accessibilityLabel={t('buddy.settings.back')}
            onPress={goBack}
            scale={0.9}
            style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name={backChevron()} size={24} color={colors.header} />
          </PressableScale>
          <AppText variant="rowName" weight={600} accessibilityRole="header" style={{ flex: 1 }}>
            {t('buddy.settings.title')}
          </AppText>
        </View>

        {/* What a buddy sees, what they never see, and what leaves this phone — before anything
            can be switched on. */}
        <Card style={{ gap: spacing.md, padding: spacing.lg }}>
          <AppText variant="caption" color={colors.ink}>
            {t('buddy.settings.explain.sees')}
          </AppText>
          <AppText variant="caption" color={colors.ink}>
            {t('buddy.settings.explain.never')}
          </AppText>
          <AppText variant="caption" color={colors.muted}>
            {t('buddy.settings.explain.leaves')}
          </AppText>
          <PressableScale
            testID="buddies-source"
            accessibilityRole="link"
            accessibilityLabel={t('buddy.settings.explain.source')}
            onPress={() => {
              void Linking.openURL('https://github.com/majani-plus/simple-prayer-relay').catch(
                () => undefined
              );
            }}
          >
            <AppText variant="caption" color={colors.accent}>
              {t('buddy.settings.explain.source')}
            </AppText>
          </PressableScale>
        </Card>

        <SettingGroup divider={false}>
          <SettingSwitchRow
            testID="buddies-enable"
            icon="favorite"
            label={t('buddy.settings.enable.label')}
            description={t('buddy.settings.enable.body')}
            value={enabled}
            disabled={busy}
            onValueChange={handleEnable}
            onLabel={t('settings.on')}
            offLabel={t('settings.off')}
          />
        </SettingGroup>

        {failed ? (
          <AppText testID="buddies-failed" variant="caption" color={colors.missed}>
            {t('buddy.invite.failed')}
          </AppText>
        ) : null}

        {/* Everything below exists only once buddy mode is on. `SettingGroup` renders nothing when
            empty, so a phone with this switched off shows exactly the card and the switch. */}
        {enabled ? (
          <>
            {/* The list: the people, then the invite still out, in that order — the invite is the
                newest thing and the thing being waited on, so it sits where the eye lands last
                before the Add row. */}
            {pairs.length > 0 || invite ? (
              <View style={{ gap: spacing.sm }}>
                <AppText variant="caption" color={colors.muted}>
                  {t('buddy.settings.list')}
                </AppText>
                {pairs.map((pair) => (
                  <PressableScale
                    key={pair.pairId}
                    testID={`buddies-row-${pair.pairId}`}
                    accessibilityRole="button"
                    accessibilityLabel={pair.nickname || t('buddy.unnamed')}
                    accessibilityHint={t('buddy.edit.hint')}
                    onPress={() => setEditing(pair.pairId)}
                    scale={0.98}
                  >
                    <Card style={rowStyle}>
                      <BuddyAvatar avatar={pair} size={40} />
                      <AppText variant="rowName" weight={500} color={colors.ink} style={{ flex: 1 }}>
                        {pair.nickname || t('buddy.unnamed')}
                      </AppText>
                      <Icon name={forwardChevron()} size={20} color={colors.faint} />
                    </Card>
                  </PressableScale>
                ))}
                {invite ? (
                  <PressableScale
                    testID="buddies-pending-invite"
                    accessibilityRole="button"
                    accessibilityLabel={t('buddy.invite.waiting', { duration: inviteTimeLeft })}
                    accessibilityHint={t('buddy.invite.pendingHint')}
                    onPress={() => setInviting(true)}
                    scale={0.98}
                  >
                    <Card style={{ ...rowStyle, borderStyle: 'dashed', borderWidth: 1, borderColor: colors.borderMid, borderRadius: radius.card }}>
                      <View style={{ opacity: 0.55 }}>
                        <BuddyAvatar
                          avatar={{ icon: inviteFor?.icon ?? 'initials', color: inviteFor?.color ?? 'ocean', nickname: inviteFor?.nickname ?? '' }}
                          size={40}
                        />
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <AppText variant="rowName" weight={500} color={colors.ink}>
                          {inviteFor?.nickname || t('buddy.unnamed')}
                        </AppText>
                        <AppText variant="caption" color={colors.muted}>
                          {t('buddy.invite.waiting', { duration: inviteTimeLeft })}
                        </AppText>
                      </View>
                      <Icon name="schedule" size={20} color={colors.faint} />
                    </Card>
                  </PressableScale>
                ) : null}
              </View>
            ) : null}

            <SettingGroup divider={false}>
              {canAddBuddy(pairs.length) && !invite ? (
                <SettingRow
                  testID="buddies-add"
                  icon="add"
                  label={t('buddy.settings.add')}
                  accessibilityRole="button"
                  onPress={() => setInviting(true)}
                  disabled={busy}
                />
              ) : null}
              {canAddBuddy(pairs.length) ? (
                <SettingRow
                  testID="buddies-have-code"
                  icon="check_circle"
                  label={t('buddy.settings.haveCode')}
                  accessibilityRole="button"
                  onPress={() => router.push('/b/enter')}
                />
              ) : null}
            </SettingGroup>

            {!canAddBuddy(pairs.length) ? (
              <AppText variant="caption" color={colors.muted}>
                {t('buddy.settings.full')}
              </AppText>
            ) : null}

            <SettingGroup divider={false}>
              <SettingSwitchRow
                testID="buddies-notify"
                icon="notifications"
                label={t('buddy.settings.notify.label')}
                description={t('buddy.settings.notify.body')}
                value={notify}
                onValueChange={actions.setNotify}
                onLabel={t('settings.on')}
                offLabel={t('settings.off')}
              />
            </SettingGroup>

            {notificationsOff && enabled ? (
              <Card testID="buddies-permission" style={{ gap: spacing.sm, padding: spacing.lg }}>
                <AppText variant="caption" weight={600} color={colors.ink}>
                  {t('buddy.settings.permission.title')}
                </AppText>
                <AppText variant="caption" color={colors.muted}>
                  {t('buddy.settings.permission.body')}
                </AppText>
                <PressableScale
                  testID="buddies-permission-action"
                  accessibilityRole="button"
                  accessibilityLabel={t('buddy.settings.permission.action')}
                  onPress={() => {
                    void Linking.openSettings().catch(() => undefined);
                  }}
                >
                  <AppText variant="caption" color={colors.accent}>
                    {t('buddy.settings.permission.action')}
                  </AppText>
                </PressableScale>
              </Card>
            ) : null}

            {/* One quiet line, once. Never who ended it, never why: there is nothing to say and
                nobody to appeal to. */}
            {ended.length > 0 ? (
              <Card testID="buddies-ended" style={{ gap: spacing.xs, padding: spacing.lg }}>
                <AppText variant="caption" color={colors.ink}>
                  {t('buddy.ended.title')}
                </AppText>
                <AppText variant="caption" color={colors.muted}>
                  {t('buddy.ended.body')}
                </AppText>
                <PressableScale
                  testID="buddies-ended-ack"
                  accessibilityRole="button"
                  accessibilityLabel={t('buddy.invite.done')}
                  onPress={() => ended.forEach((id) => actions.acknowledgeEnded(id))}
                >
                  <AppText variant="caption" color={colors.accent}>
                    {t('buddy.invite.done')}
                  </AppText>
                </PressableScale>
              </Card>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <InviteBuddySheet visible={inviting} onClose={() => setInviting(false)} />
      <EditBuddySheet pairId={editing} onClose={() => setEditing(null)} onRemove={handleRemove} />
    </PaperBackground>
  );
}

/** Register this phone with the relay and keep the secret in the keychain. */
async function registerDevice(credentials: ReturnType<typeof createBuddyCredentialStore>) {
  const result = await getBuddyRelay().register();
  if (!result.ok) return null;
  // If the keychain will not hold the secret, buddy mode does not start: falling back to ordinary
  // storage for the one value worth stealing would be the wrong trade.
  const saved = await credentials.save(result.value);
  return saved ? result.value : null;
}
