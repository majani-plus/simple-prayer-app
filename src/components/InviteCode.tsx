import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import QRCode from 'qrcode';

import { AppText } from './AppText';
import { radius, spacing, useTheme } from '@/theme';

/**
 * A pairing invite, shown three ways at once.
 *
 * There is no one way two people are in the same situation: sometimes they are side by side and a
 * camera is quickest, sometimes they are on the phone to each other and the code has to be read
 * aloud, sometimes they are countries apart and it is a link in a message. So all three are on
 * screen together and none is presented as the main one.
 *
 * The QR is drawn here rather than pulled from a library so it can be the app's own ink on the
 * app's own paper — a stark black-on-white square in the middle of this design would look like a
 * screenshot of another app. `qrcode` gives the matrix; the drawing is ours.
 */

export interface InviteCodeProps {
  /** The full link the QR encodes, e.g. https://simpleprayer.app/b/ABCD2345 */
  link: string;
  /** The same code, grouped for reading aloud: ABCD-EFGH. */
  display: string;
  size?: number;
  testID?: string;
}

export function InviteCode({ link, display, size = 180, testID }: InviteCodeProps) {
  const { colors } = useTheme();

  const matrix = useMemo(() => {
    try {
      // Medium correction: enough that a thumb over one corner still scans, without making the
      // modules so small that a phone held at arm's length struggles.
      const qr = QRCode.create(link, { errorCorrectionLevel: 'M' });
      return { size: qr.modules.size, data: qr.modules.data };
    } catch {
      // A code that cannot be drawn is not an error worth a screen: the digits below it are the
      // same invite, and they are what somebody reads out anyway.
      return null;
    }
  }, [link]);

  return (
    <View testID={testID} style={{ alignItems: 'center', gap: spacing.md }}>
      {matrix ? (
        <View
          style={{
            padding: spacing.md,
            borderRadius: radius.card,
            // A quiet ground rather than pure white: the quiet zone a scanner needs, without a
            // rectangle that looks pasted on.
            backgroundColor: colors.cardElevated,
          }}
        >
          <Svg width={size} height={size} viewBox={`0 0 ${matrix.size} ${matrix.size}`}>
            {Array.from({ length: matrix.size * matrix.size }, (_, index) =>
              matrix.data[index] ? (
                <Rect
                  key={index}
                  x={index % matrix.size}
                  y={Math.floor(index / matrix.size)}
                  // A hair over one module, so neighbouring squares meet rather than leaving
                  // hairlines the scanner has to work through.
                  width={1.02}
                  height={1.02}
                  fill={colors.ink}
                />
              ) : null
            )}
          </Svg>
        </View>
      ) : null}

      <AppText
        variant="time"
        weight={700}
        tone="strong"
        // Grouped, spaced and large: this is the half that gets read down a phone line.
        style={{ letterSpacing: 3, fontVariant: ['tabular-nums'] }}
        accessibilityLabel={display.split('').join(' ')}
      >
        {display}
      </AppText>
    </View>
  );
}
