import type { PropsWithChildren } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

const noiseTile = require('@/assets/images/paper-noise.png');

/**
 * The tile is warm *brown* ink (rgb 107,84,46) at alpha 0…0.11 — grain that works by darkening.
 * On night paper that is grain the same colour as the ground: at best invisible, and the first
 * pass's "turn the opacity down" only made it more so. Lamplight on paper picks fibres out
 * *lighter* than the sheet, so in dark the same tile is re-inked from the palette
 * (`colors.textureInk`) and the ruled lines baked into it come back as laid-paper lines.
 *
 * The strength is a plain number rather than another token: it compensates for the tile's own
 * alpha (which tops out near 0.11), not for anything about the palette. Light is left completely
 * untouched — no tint, no opacity — so the ground renders exactly as drawn. Both were turned down a
 * pinch once (light 0.8, dark 0.5, 2026-10-10) and the owner found that too faint (2026-11-07), so
 * they are back at the earlier strengths (D193).
 */
const DARK_TEXTURE_OPACITY = 0.6;

/**
 * The parchment ground every screen sits on: base paper color + a tiled warm-noise
 * texture (with ruled lines baked in), per docs/DESIGN.md.
 */
export function PaperBackground({ children }: PropsWithChildren) {
  const { colors, scheme } = useTheme();
  const dark = scheme === 'dark';
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <View
        testID="paper-ground"
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        /*
         * Rasterize the ground once instead of re-drawing it every frame of a transition.
         *
         * Every screen mounts one of these full-screen, so a push or a tab change animates two of
         * them at once — each a tiled shader across the whole viewport, and in dark each also
         * carrying a `tintColor` colour filter over that shader. Promoting the ground to a texture
         * makes the animation composite a bitmap rather than re-tile and re-filter per frame.
         * Reported as laggy page transitions on a Xiaomi 15T Pro in dark mode.
         *
         * **Only the ground is rasterized, never the content.** The flags used to sit on the view
         * that also held every screen's content, so anything that moved inside it — a seal opening,
         * a press dipping, the countdown ticking — invalidated the bitmap and re-rendered the whole
         * screen offscreen on every frame of that animation (owner, 2026-10-29: "clicking the seal
         * there's a delay before it opens"). The ground is a sibling layer now: a still image whose
         * only inputs are the theme and the viewport, so its texture is drawn once and reused.
         * `collapsable={false}` is required on Android, or the view is flattened away before it can
         * be given a texture.
         */
        collapsable={false}
        renderToHardwareTextureAndroid
        shouldRasterizeIOS
      >
        {/* A View with an absolute Image rather than `ImageBackground`, deprecated in RN 0.87. The
            explicit size matters: an unsized Image takes its source's own size (one 240pt tile)
            over `absoluteFill`, which is why `ImageBackground` passed width and height through. */}
        <Image
          source={noiseTile}
          resizeMode="repeat"
          style={[
            StyleSheet.absoluteFill,
            styles.fill,
            dark && { tintColor: colors.textureInk, opacity: DARK_TEXTURE_OPACITY },
          ]}
        />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { width: '100%', height: '100%' },
});
