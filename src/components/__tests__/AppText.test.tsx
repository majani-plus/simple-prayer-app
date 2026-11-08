import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import { AppText } from '../AppText';
import i18n, { initI18n } from '@/i18n';
import { ThemePreferenceContext, fonts, nightPaper, paperLight } from '@/theme';

function styleOf(text: string): TextStyle {
  return StyleSheet.flatten(screen.getByText(text).props.style) as TextStyle;
}

beforeAll(() => {
  initI18n();
});

afterEach(async () => {
  if (i18n.language !== 'en') {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  }
});

describe('AppText', () => {
  it('renders its children', async () => {
    await render(<AppText>Maghrib</AppText>);
    expect(screen.getByText('Maghrib')).toBeTruthy();
  });

  it('applies the variant’s family, size and tone', async () => {
    await render(<AppText variant="rowName">Maghrib</AppText>);
    expect(styleOf('Maghrib')).toMatchObject({
      fontFamily: fonts.semiBold,
      fontSize: 18, // raised from the design's 17 (D74)
      color: paperLight.ink,
    });
  });

  it('uses an italic Lora file for captions and hints — never a synthetic slant', async () => {
    await render(
      <>
        <AppText variant="caption">prayed late</AppText>
        <AppText variant="hint">tap a seal to choose</AppText>
      </>
    );
    expect(styleOf('prayed late')).toMatchObject({
      fontFamily: fonts.regularItalic,
      fontSize: 13.5, // raised from the design's 12 (D74)
      color: paperLight.muted,
    });
    expect(styleOf('prayed late').fontStyle).toBeUndefined();
    expect(styleOf('tap a seal to choose')).toMatchObject({
      fontFamily: fonts.regularItalic,
      color: paperLight.faint,
    });
  });

  it('sets Arabic variants in Amiri', async () => {
    await render(
      <>
        <AppText variant="heroArabic">المغرب</AppText>
        <AppText variant="rowArabic">العصر</AppText>
      </>
    );
    expect(styleOf('المغرب')).toMatchObject({
      fontFamily: fonts.arabic,
      fontSize: 30,
      color: paperLight.accent,
      lineHeight: 34,
    });
    expect(styleOf('العصر')).toMatchObject({ fontFamily: fonts.arabic, fontSize: 16 });
  });

  it('gives the time variant tabular figures', async () => {
    await render(<AppText variant="time">8:47 pm</AppText>);
    expect(styleOf('8:47 pm')).toMatchObject({ fontSize: 14 }); // raised from 12.5 (D74)
    // Lora's `tnum` widens the space to a full figure width, so the feature is applied to the
    // runs either side of it rather than to the whole node — the digits stay fixed-width while
    // the space keeps its natural width.
    expect(styleOf('8:47')).toMatchObject({ fontVariant: ['tabular-nums'] });
    expect(styleOf('pm')).toMatchObject({ fontVariant: ['tabular-nums'] });
    expect(styleOf('8:47 pm').fontVariant).toBeUndefined();
  });

  it('takes tabular figures on the node itself when there is no space to protect', async () => {
    await render(
      <AppText variant="time" tabularNums>
        20:47
      </AppText>
    );
    // A lone token needs no splitting, so it is never wrapped in a span of its own.
    expect(styleOf('20:47')).toMatchObject({
      fontSize: 14,
      fontVariant: ['tabular-nums'],
    });
  });

  it('tracks the header meta line like the design', async () => {
    await render(<AppText variant="headerMeta">16 Muharram · July 2</AppText>);
    expect(styleOf('16 Muharram · July 2')).toMatchObject({
      fontFamily: fonts.medium,
      fontSize: 14, // raised from the design's 13 (D74)
      color: paperLight.header,
      letterSpacing: 0.28, // .02em of the new size
    });
  });

  it('drops the tracking when the same line is set in Arabic', async () => {
    await act(async () => {
      await i18n.changeLanguage('ar');
    });
    await render(<AppText variant="headerMeta">٦ ربيع الأول · ١٩ أغسطس</AppText>);
    const style = styleOf('٦ ربيع الأول · ١٩ أغسطس');
    expect(style.fontFamily).toBe(fonts.arabicUiMedium);
    // Arabic is cursive: tracking would prise the joined letters apart.
    expect(style.letterSpacing).toBeUndefined();
  });

  it('drops tracking a CALL SITE asked for, not only the variant’s own', async () => {
    // The guard used to read `spec.letterSpacing` only, so a `style={{ letterSpacing }}` merged in
    // afterwards sailed past it — which is how the compass's Makkah badge and the reminder-health
    // notice ended up with their Arabic joins prised open.
    await act(async () => {
      await i18n.changeLanguage('ar');
    });
    await render(<AppText style={{ letterSpacing: 0.42 }}>مكة</AppText>);
    expect(styleOf('مكة').letterSpacing).toBeUndefined();
  });

  it('keeps a call site’s tracking in Latin', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    await render(<AppText style={{ letterSpacing: 0.42 }}>Makkah</AppText>);
    expect(styleOf('Makkah').letterSpacing).toBe(0.42);
  });

  it('states its alignment rather than leaving iOS to guess "natural"', async () => {
    // `left`, never `right`: Fabric rewrites it to the leading edge on an RTL surface, and a
    // hand-flipped `right` would be swapped a second time back to the wrong edge.
    await render(<AppText>Maghrib</AppText>);
    expect(styleOf('Maghrib').textAlign).toBe('left');
  });

  it('lets a call site override the alignment', async () => {
    await render(<AppText style={{ textAlign: 'center' }}>Maghrib</AppText>);
    expect(styleOf('Maghrib').textAlign).toBe('center');
  });

  it('lets weight select the Lora file, without emitting fontWeight', async () => {
    await render(
      <AppText variant="hero" weight={700} tone="strong" tabularNums>
        8:47 pm
      </AppText>
    );
    const style = styleOf('8:47 pm');
    expect(style).toMatchObject({
      fontFamily: fonts.bold,
      fontSize: 23,
      color: paperLight.inkStrong,
    });
    expect(styleOf('8:47')).toMatchObject({ fontVariant: ['tabular-nums'] });
    expect(style.fontWeight).toBeUndefined();
  });

  it('rounds an italic request down to the nearest italic Lora', async () => {
    await render(
      <AppText variant="rowName" italic>
        emphasis
      </AppText>
    );
    expect(styleOf('emphasis').fontFamily).toBe(fonts.mediumItalic);
  });

  it('ignores italic for Arabic, which has none', async () => {
    await render(
      <AppText variant="rowArabic" italic>
        العصر
      </AppText>
    );
    expect(styleOf('العصر').fontFamily).toBe(fonts.arabic);
  });

  it('resolves tone from the palette and lets an explicit colour win', async () => {
    await render(
      <>
        <AppText tone="diamond">24</AppText>
        <AppText tone="muted" color={paperLight.late}>
          late
        </AppText>
      </>
    );
    expect(styleOf('24').color).toBe(paperLight.diamond);
    expect(styleOf('late').color).toBe(paperLight.late);
  });

  it('lets the style prop override the variant', async () => {
    await render(
      <AppText variant="rowName" style={{ fontSize: 20 }}>
        Maghrib
      </AppText>
    );
    expect(styleOf('Maghrib').fontSize).toBe(20);
  });

  it('follows the night-paper palette in dark mode', async () => {
    await render(
      <ThemePreferenceContext.Provider value="dark">
        <AppText variant="rowName">Maghrib</AppText>
      </ThemePreferenceContext.Provider>
    );
    expect(styleOf('Maghrib').color).toBe(nightPaper.ink);
  });

  it('sets Arabic UI text in the UI face, not the calligraphic one', async () => {
    // `rowName` asks for 600. Under the old two-file mapping (`>= 600 ? bold : regular`) that made
    // the app's DEFAULT variant Amiri Bold, so every line of Arabic body copy came out bold while
    // English read as a semibold serif.
    await act(async () => {
      await i18n.changeLanguage('ar');
    });
    await render(<AppText variant="rowName">المغرب</AppText>);
    expect(styleOf('المغرب').fontFamily).toBe(fonts.arabicUiSemiBold);
  });

  it('gives Arabic the same four-weight ladder as Latin', async () => {
    // The reason the UI face exists. Amiri has two files, so 400 and 500 both landed on Regular
    // and 600 and 700 both on Bold: two rungs where Latin has four, and the eight `weight={500}`
    // call sites that carry the quiet tier simply vanished.
    await act(async () => {
      await i18n.changeLanguage('ar');
    });
    const expected = [
      [400, fonts.arabicUi],
      [500, fonts.arabicUiMedium],
      [600, fonts.arabicUiSemiBold],
      [700, fonts.arabicUiBold],
    ] as const;
    for (const [weight, family] of expected) {
      const label = `وزن${weight}`;
      await render(
        <AppText variant="rowName" weight={weight}>
          {label}
        </AppText>
      );
      expect(styleOf(label).fontFamily).toBe(family);
    }
  });

  it('never sets Arabic in a synthesized italic', async () => {
    // Arabic has no italic; a slanted naskh is a Latin habit imposed on a script that rejects it.
    await act(async () => {
      await i18n.changeLanguage('ar');
    });
    await render(
      <AppText variant="caption" italic>
        وصف
      </AppText>
    );
    const style = styleOf('وصف');
    expect(style.fontFamily).toBe(fonts.arabicUi);
    expect(style.fontStyle).toBeUndefined();
  });

  it('applies the per-language type scale when Arabic sets a Latin-designed size', async () => {
    // Amiri renders optically smaller than Lora at the same nominal size (x-height 433 vs 500
    // per 1000 units), so every Latin-designed size gains ×1.15 once it is set in Amiri.
    await act(async () => {
      await i18n.changeLanguage('ar');
    });
    await render(<AppText variant="rowName">المغرب</AppText>);
    expect(styleOf('المغرب').fontSize).toBeCloseTo(18 * 1.15);
  });

  it('scales a call site’s own size override the same way', async () => {
    // The scale multiplies the *merged* style, so "this row is 20, not 17" stays proportional in
    // Arabic without the call site knowing the language — and a generous explicit lineHeight keeps
    // its ratio rather than being flattened.
    await act(async () => {
      await i18n.changeLanguage('ar');
    });
    await render(
      <AppText variant="rowName" style={{ fontSize: 20, lineHeight: 34 }}>
        العشاء
      </AppText>
    );
    expect(styleOf('العشاء').fontSize).toBeCloseTo(20 * 1.15);
    expect(styleOf('العشاء').lineHeight).toBeCloseTo(34 * 1.15);
  });

  it('will not let a Latin leading squeeze an Arabic line', async () => {
    // 24/20 is 1.2 em — a normal Latin ratio and far too tight for a script that stacks marks above
    // the letter and drops tails below the baseline. RN clamps the glyph box to exactly the line
    // height it is given, so this is what put the tails of ج and غ outside the compass cardinals'
    // box and the kasra outside the qibla title's. The floor is 1.45 em of the RESOLVED size.
    await act(async () => {
      await i18n.changeLanguage('ar');
    });
    await render(
      <AppText variant="rowName" style={{ fontSize: 20, lineHeight: 24 }}>
        العشاء
      </AppText>
    );
    expect(styleOf('العشاء').lineHeight).toBeCloseTo(20 * 1.15 * 1.45);
  });

  it('leaves the same tight leading alone in Latin', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    await render(
      <AppText variant="rowName" style={{ fontSize: 20, lineHeight: 24 }}>
        Isha
      </AppText>
    );
    expect(styleOf('Isha').lineHeight).toBe(24);
  });

  it('does not inflate a leading the Arabic variants chose for themselves', async () => {
    // `heroArabic` is 30/34. That 1.13 em is a design decision about the one piece of Arabic the
    // app already got right, not a Latin value nobody re-derived — the floor must not touch it.
    await act(async () => {
      await i18n.changeLanguage('ar');
    });
    await render(<AppText variant="heroArabic">المغرب</AppText>);
    expect(styleOf('المغرب').lineHeight).toBe(34);
  });

  it('leaves the Arabic-designed variants at their designed sizes', async () => {
    // heroArabic/rowArabic picked their sizes *for* Amiri — scaling them would double-compensate.
    await act(async () => {
      await i18n.changeLanguage('ar');
    });
    await render(<AppText variant="heroArabic">المغرب</AppText>);
    expect(styleOf('المغرب').fontSize).toBe(30);
    expect(styleOf('المغرب').lineHeight).toBe(34);
  });

  it('keeps the raised tab label in the Regular file — it clears the sub-13px rule', async () => {
    // The tab label was raised to 12 for the owner (12 × 1.15 = 13.8 ≥ 13), so it no longer
    // falls under the D54 bold rule: inactive Arabic tabs regain the Regular/Bold contrast
    // against the active tab that Latin always had. The rule itself is still enforced — the
    // "final size, after a call-site override" test below pins the sub-13 branch.
    await act(async () => {
      await i18n.changeLanguage('ar');
    });
    await render(<AppText variant="tabLabel">اليوم</AppText>);
    expect(styleOf('اليوم').fontSize).toBeCloseTo(12 * 1.15);
    expect(styleOf('اليوم').fontFamily).toBe(fonts.arabicUi);
  });

  it('keeps 13px-and-up Arabic UI text in the regular file', async () => {
    // A caption resolves to 13.5 × 1.15 = 15.5 — over the threshold, so weight stays as asked.
    await act(async () => {
      await i18n.changeLanguage('ar');
    });
    await render(<AppText variant="caption">تقريبًا</AppText>);
    expect(styleOf('تقريبًا').fontFamily).toBe(fonts.arabicUi);
  });

  it('judges the threshold on the final size, after a call-site override', async () => {
    await act(async () => {
      await i18n.changeLanguage('ar');
    });
    await render(
      <AppText variant="caption" style={{ fontSize: 10 }}>
        صغير
      </AppText>
    );
    // 10 × 1.15 = 11.5 < 13, so the override pulls the text under the rule. D54 asked for the
    // Bold file because Amiri had no rung between; Noto Naskh does, and SemiBold reads as
    // definition where Bold reads as shouting. Crucially it stays in the SAME face — stepping to
    // Amiri Bold here would drop a caption in a different typeface under every row.
    expect(styleOf('صغير').fontFamily).toBe(fonts.arabicUiSemiBold);
  });

  it('never bolds the calligraphy variants — their elegance is the brand', async () => {
    // rowArabic (16) and heroArabic (30) sit above the threshold by design.
    await render(
      <>
        <AppText variant="rowArabic">العصر</AppText>
        <AppText variant="heroArabic">المغرب</AppText>
      </>
    );
    expect(styleOf('العصر').fontFamily).toBe(fonts.arabic);
    expect(styleOf('المغرب').fontFamily).toBe(fonts.arabic);
  });

  it('never scales Latin languages', async () => {
    await act(async () => {
      await i18n.changeLanguage('tr');
    });
    await render(<AppText variant="rowName">Akşam</AppText>);
    expect(styleOf('Akşam').fontSize).toBe(18);
  });

  it('forwards accessibility props', async () => {
    await render(
      <AppText accessibilityRole="header" accessibilityLabel="section">
        Today
      </AppText>
    );
    expect(screen.getByLabelText('section')).toBeTruthy();
  });
});
