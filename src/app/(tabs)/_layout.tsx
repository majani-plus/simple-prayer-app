import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Icon, type IconName } from '@/components/Icon';
import { PaperBackground } from '@/components/PaperBackground';
import { useTheme } from '@/theme';

const TAB_ICONS: Record<string, IconName> = {
  index: 'today',
  history: 'calendar_month',
  qibla: 'explore',
  settings: 'settings',
};

/**
 * The bar's content height, ABOVE the home-indicator inset. The stock UIKit 49 sat under 21px
 * icons and 10.5px labels; the owner asked for a bigger bar all round, so the larger icon/label
 * pair below gets matching air. Every tab's touch target is the full content height, so this is
 * also comfortably past the 48pt floor (D55) that 49 only grazed.
 */
const TAB_BAR_CONTENT_HEIGHT = 58;

/** Tab glyph size — raised from 21 with the bar. Sits inside the navigator's 31×28 icon slot. */
const TAB_ICON_SIZE = 25;

export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        // No `freezeOnBlur`: Expo Router 58's tab screens hard-code it off. History hides itself
        // behind an `Activity` instead (history.tsx, D191). Every sync that must keep running
        // lives in the root layout, not in a tab.
        sceneStyle: { backgroundColor: 'transparent' },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.soft,
        // The tab bar is part of the same sheet of paper: a flat `colors.bg` fill under it broke
        // the parchment along a hard seam, because the screen above carries the noise texture and
        // the bar did not. It gets the texture itself instead, and keeps only the top hairline.
        tabBarStyle: {
          // A numeric height replaces the navigator's own `49 + inset` computation outright
          // (`getTabBarHeight` returns a custom height verbatim), while the bar still pads its
          // bottom by the inset — so the inset is counted exactly once here, the content sits
          // fully above the home indicator, and a device without one gets just the content
          // height rather than a phantom inset.
          height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
          backgroundColor: 'transparent',
          borderTopColor: colors.hairline,
          borderTopWidth: 1,
        },
        tabBarBackground: () => <PaperBackground />,
        // Through `AppText` rather than `tabBarLabelStyle`, for two reasons the style prop cannot
        // express: the active label is semibold (Lora, 600 when active), and under Arabic the
        // label must be *set* in Amiri — a bare `fontFamily: Lora` has no Arabic glyphs and would
        // fall back to whatever the OS cascades to.
        tabBarLabel: ({ focused, color, children }) => (
          <AppText
            variant="tabLabel"
            weight={focused ? 600 : 400}
            color={color}
            numberOfLines={1}
            // The stock label is FROZEN on iOS 13+ (the navigator leans on largeContentTitle
            // instead); ours scales with Dynamic Type but capped like the icons (Icon.tsx caps
            // at 1.4), because the bar's height is fixed: at 1.4 the tallest label still fits
            // the content box, and past it the long-press large-content viewer carries the name.
            maxFontSizeMultiplier={1.4}
          >
            {children}
          </AppText>
        ),
        tabBarIcon: ({ color, focused }) => (
          <Icon
            name={TAB_ICONS[route.name] ?? 'circle'}
            size={TAB_ICON_SIZE}
            color={color}
            variant={focused ? 'filled' : 'outlined'}
          />
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.today') }} />
      <Tabs.Screen name="history" options={{ title: t('tabs.history') }} />
      <Tabs.Screen name="qibla" options={{ title: t('tabs.qibla') }} />
      <Tabs.Screen name="settings" options={{ title: t('tabs.settings') }} />
    </Tabs>
  );
}
