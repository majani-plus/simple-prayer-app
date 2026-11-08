import Svg, { Circle, Path } from 'react-native-svg';

import { useTheme } from '@/theme';

/**
 * The app mark: a mosque silhouette (dome, finial, two minarets, ground line) from the approved
 * brand exploration — see docs/DESIGN.md. It is drawn at one of four OPTICAL SIZES: as the mark
 * gets smaller the strokes get heavier and details drop away, so it stays legible down to 16pt.
 * Raster assets (app icon, splash, adaptive icon) are generated from the same geometry by
 * scripts/generate-brand-assets.py — keep the two in sync if the mark ever changes.
 */
export interface LogoProps {
  size?: number;
  /** Defaults to the theme accent. */
  color?: string;
  /** Force an optical size instead of deriving it from `size` (mostly for previews/tests). */
  variant?: LogoVariant;
}

export type LogoVariant = 'full' | 'medium' | 'small' | 'tiny';

/** Thresholds are the rendered edge length in points. */
export function variantForSize(size: number): LogoVariant {
  if (size >= 40) return 'full';
  if (size >= 28) return 'medium';
  if (size >= 20) return 'small';
  return 'tiny';
}

export function Logo({ size = 40, color, variant }: LogoProps) {
  const { colors } = useTheme();
  const tone = color ?? colors.accent;
  const optical = variant ?? variantForSize(size);

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      {optical === 'full' && (
        <>
          <Path
            d="M18 42A14 14 0 0 1 46 42"
            stroke={tone}
            strokeWidth={3.4}
            strokeLinecap="round"
          />
          <Path d="M32 26v-5" stroke={tone} strokeWidth={2.6} strokeLinecap="round" />
          <Circle cx={32} cy={18} r={2.6} fill={tone} />
          <Path
            d="M10.5 42V29M53.5 42V29"
            stroke={tone}
            strokeWidth={3.4}
            strokeLinecap="round"
          />
          <Circle cx={10.5} cy={25} r={2.6} fill={tone} />
          <Circle cx={53.5} cy={25} r={2.6} fill={tone} />
          <Path d="M7 46h50" stroke={tone} strokeWidth={3.4} strokeLinecap="round" />
        </>
      )}

      {optical === 'medium' && (
        <>
          <Path
            d="M18 42A14 14 0 0 1 46 42"
            stroke={tone}
            strokeWidth={4.2}
            strokeLinecap="round"
          />
          <Path d="M32 26v-4" stroke={tone} strokeWidth={3.2} strokeLinecap="round" />
          <Circle cx={32} cy={18} r={3} fill={tone} />
          <Path
            d="M10.5 42V29M53.5 42V29"
            stroke={tone}
            strokeWidth={4.2}
            strokeLinecap="round"
          />
          <Path d="M7 46h50" stroke={tone} strokeWidth={4.2} strokeLinecap="round" />
        </>
      )}

      {optical === 'small' && (
        <>
          <Path d="M18 42A14 14 0 0 1 46 42" stroke={tone} strokeWidth={6} strokeLinecap="round" />
          <Path d="M11 42V30M53 42V30" stroke={tone} strokeWidth={6} strokeLinecap="round" />
          <Path d="M8 47h48" stroke={tone} strokeWidth={6} strokeLinecap="round" />
        </>
      )}

      {optical === 'tiny' && (
        <>
          <Path d="M19 41A13 13 0 0 1 45 41" stroke={tone} strokeWidth={8} strokeLinecap="round" />
          <Path d="M9 48h46" stroke={tone} strokeWidth={8} strokeLinecap="round" />
        </>
      )}
    </Svg>
  );
}
