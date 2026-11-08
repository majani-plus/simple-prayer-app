import { render } from '@testing-library/react-native';
import { StyleSheet, Text, type ImageStyle, type ViewStyle } from 'react-native';
import type { ReactTestRendererJSON } from 'react-test-renderer';

import { PaperBackground } from '../PaperBackground';
import { ThemePreferenceContext, nightPaper, paperLight, type ThemePreference } from '@/theme';

/**
 * The ground itself. Two things are worth pinning here and nothing else is: the base colour comes
 * from the active palette, and the noise tile is re-inked in dark.
 *
 * The tile is brown ink that works by *darkening* the sheet. On night paper that is grain the
 * same colour as the ground — invisible — so dark tints it cream and it lightens instead. Losing
 * the tint (or "fixing" it back to a plain lowered opacity, which is what the first pass did)
 * silently returns the dark theme to a flat, textureless brown. That is the regression this
 * guards; the exact values are the theme's business, so only the direction is asserted.
 */

/** Depth-first walk of the rendered tree. */
function* walk(node: ReactTestRendererJSON | string | null): Generator<ReactTestRendererJSON> {
  if (node === null || typeof node === 'string') return;
  yield node;
  for (const child of node.children ?? []) yield* walk(child as ReactTestRendererJSON | string);
}

async function renderGround(preference: ThemePreference) {
  const view = await render(
    <ThemePreferenceContext.Provider value={preference}>
      <PaperBackground>
        <Text>page</Text>
      </PaperBackground>
    </ThemePreferenceContext.Provider>
  );
  const tree = view.toJSON() as ReactTestRendererJSON;
  const nodes = [...walk(tree)];
  const image = nodes.find((node) => node.type === 'Image');
  if (image === undefined) throw new Error('the paper texture is not rendered at all');
  return {
    view,
    root: StyleSheet.flatten(tree.props.style as ViewStyle) ?? {},
    texture: StyleSheet.flatten(image.props.style as ImageStyle) ?? {},
  };
}

describe('PaperBackground', () => {
  it('paints the light paper ground with the brown noise tile, untinted and at full strength', async () => {
    const { view, root, texture } = await renderGround('light');

    expect(view.getByText('page')).toBeTruthy();
    expect(root.backgroundColor).toBe(paperLight.bg);
    // The tile was authored for this ground: no tint, no dimming. Dimmed to 0.8 it read as too
    // faint (owner, 2026-11-07; D193).
    expect(texture.tintColor).toBeUndefined();
    expect(texture.opacity ?? 1).toBe(1);
    // Sized explicitly: unsized, an Image draws one tile at the source's own size, top-left only.
    expect(texture).toMatchObject({ width: '100%', height: '100%' });
  });

  it('rasterizes only the ground layer, never the content drawn over it', async () => {
    // The rasterize flags on a view that also holds the screen re-render the whole screen
    // offscreen on every frame of any animation inside it (the seal's delayed open, 2026-10-29).
    const { view } = await renderGround('light');
    const tree = view.toJSON() as ReactTestRendererJSON;
    const rasterized = [...walk(tree)].filter(
      (node) => node.props.shouldRasterizeIOS || node.props.renderToHardwareTextureAndroid
    );
    expect(rasterized).toHaveLength(1);
    const [ground] = rasterized;
    expect(ground.props.testID).toBe('paper-ground');
    const groundTexts = [...walk(ground)].filter((node) => node.type === 'Text');
    expect(groundTexts).toHaveLength(0);
    expect(view.getByText('page')).toBeTruthy();
  });

  it('re-inks the noise tile so night paper keeps its texture', async () => {
    const { root, texture } = await renderGround('dark');

    expect(root.backgroundColor).toBe(nightPaper.bg);
    expect(texture.tintColor).toBe(nightPaper.textureInk);

    // Cream, not brown: the grain has to lighten the ground it sits on rather than match it, and
    // it has to be lighter than the ink the tile was actually drawn in.
    const channelsOf = (color: string) =>
      [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
    const tint = channelsOf(nightPaper.textureInk);
    channelsOf(nightPaper.bg).forEach((ground, index) => {
      expect(tint[index]).toBeGreaterThan(ground);
    });
    channelsOf(paperLight.textureInk).forEach((authored, index) => {
      expect(tint[index]).toBeGreaterThan(authored);
    });
    // Warm, like everything else on this sheet.
    expect(tint[0]).toBeGreaterThan(tint[2]);
    // Strong enough to be seen at all — the tile's own alpha tops out around 11%. 0.5 was too
    // faint (owner, 2026-11-07; D193).
    expect(texture.opacity).toBeGreaterThanOrEqual(0.6);
  });
});
