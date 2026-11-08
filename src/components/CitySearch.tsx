import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText, useTextFieldStyle } from './AppText';
import { Card } from './Card';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { useAnnounceChange } from '@/hooks/useAnnounceChange';
import { useLocationActions } from '@/stores/locationStore';
import { radius, spacing, useTheme } from '@/theme';

import type { AppLocation } from '@/domain/types';
import type { LocationErrorCode } from '@/services/location';

/**
 * The manual-city path (PRODUCT_SPEC §10): a text field, a debounced OS-geocoder lookup, and the
 * candidates as tappable rows.
 *
 * This is the fallback that makes refusing the location permission a *free* choice rather than a
 * degraded one, so it is built to never punish the user for a slow or absent geocoder:
 *
 * - **Debounced.** {@link DEBOUNCE_MS} of quiet before a query goes out, so typing "Istanbul" is
 *   one geocoder round-trip rather than eight.
 * - **No spinner flash.** The busy line only appears once a lookup has been running for
 *   {@link BUSY_AFTER_MS}. A geocoder that answers in 80 ms therefore shows results appearing,
 *   not a spinner blinking — while a genuinely slow one still explains itself.
 * - **Last write wins.** Every lookup carries a sequence number and a stale answer is dropped, so
 *   a slow "Ist" can never overwrite the results for "Istanbul".
 * - **Every failure has words.** No results, geocoder unavailable and offline are three different
 *   sentences, and the last one offers a retry rather than a dead end.
 * - **Nothing is kept.** The query is local component state; only the location the user actually
 *   picks is ever stored.
 *
 * The component owns searching and presentation only — the caller decides what "choosing" means
 * (the Location screen calls `locationStore.selectManualLocation`).
 */

/** Quiet time after the last keystroke before a lookup is issued. */
export const DEBOUNCE_MS = 400;

/** How long a lookup must run before the "Searching…" line appears. Prevents spinner flashing. */
export const BUSY_AFTER_MS = 450;

/** Below this many characters a geocoder returns noise, so nothing is sent. */
export const MIN_QUERY_LENGTH = 2;

/** What the results area is currently showing. */
type SearchPhase =
  /** Nothing typed yet, or too little to search on. */
  | 'idle'
  /** A lookup is running and has been long enough to say so. */
  | 'busy'
  /** `results` holds candidates. */
  | 'results'
  /** The geocoder answered, but knows no such place. */
  | 'empty'
  /** The geocoder could not be reached. */
  | 'failed';

export interface CitySearchProps {
  /** Called with the candidate the user taps. */
  onSelect: (location: AppLocation) => void;
  /** Label of the city already in use, marked in the results so the current choice is obvious. */
  selectedLabel?: string | null;
  /** Focus the field on mount. Off by default — a screen should not raise the keyboard by itself. */
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The debounced city search field and its results.
 *
 * @param onSelect - Receives the chosen candidate; the caller stores it.
 * @param selectedLabel - The currently active city's label, if any.
 * @returns A paper text field with the result rows (or the relevant explanation) beneath it.
 */
export function CitySearch({
  onSelect,
  selectedLabel = null,
  autoFocus = false,
  style,
  testID = 'city-search',
}: CitySearchProps) {
  const { t } = useTranslation();
  const fieldStyle = useTextFieldStyle();
  const { colors } = useTheme();
  const { searchCity } = useLocationActions();

  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<SearchPhase>('idle');
  const [results, setResults] = useState<AppLocation[]>([]);
  const [failure, setFailure] = useState<LocationErrorCode | null>(null);
  /** The query the current `results`/`empty` state belongs to, for the "nothing found" line. */
  const [answered, setAnswered] = useState('');

  // Monotonic id of the newest lookup. An answer whose id is not the newest is dropped, which is
  // the whole race guard — no cancellation API exists on the OS geocoder.
  const sequence = useRef(0);
  /** Bumped by the retry button to re-run the effect with an unchanged query. */
  const [attempt, setAttempt] = useState(0);

  /**
   * Typing is where the reset belongs, not the effect.
   *
   * Emptying the field has to abandon whatever is in flight (its answer would otherwise land on a
   * blank field and re-populate it) and clear any leftover failure line. Doing that in the effect
   * would be a synchronous `setState` inside an effect body — a cascading render the React
   * Compiler's lint rule rejects, and rightly: this is a reaction to a user event, so it lives in
   * the event handler and the effect is left to do nothing but search.
   */
  const handleChangeText = useCallback((next: string) => {
    setQuery(next);
    if (next.trim().length >= MIN_QUERY_LENGTH) return;
    sequence.current += 1;
    setPhase('idle');
    setResults([]);
    setFailure(null);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    // Too short to ask the geocoder anything useful; `handleChangeText` has already reset the
    // visible state, so there is nothing to do here.
    if (trimmed.length < MIN_QUERY_LENGTH) return;

    let cancelled = false;
    let busyTimer: ReturnType<typeof setTimeout> | null = null;

    const debounce = setTimeout(() => {
      const id = (sequence.current += 1);
      busyTimer = setTimeout(() => {
        // Only claim to be searching if the answer is genuinely taking a while.
        if (!cancelled && sequence.current === id) setPhase('busy');
      }, BUSY_AFTER_MS);

      void searchCity(trimmed)
        .then((outcome) => {
          if (cancelled || sequence.current !== id) return;
          setAnswered(trimmed);
          if (outcome.error !== null && outcome.results.length === 0) {
            setResults([]);
            setFailure(outcome.error);
            setPhase(outcome.error === 'noResults' ? 'empty' : 'failed');
            return;
          }
          setFailure(null);
          setResults(outcome.results);
          setPhase(outcome.results.length === 0 ? 'empty' : 'results');
        })
        .catch(() => {
          // The service contract says it never rejects; if a future one does, the UI still has
          // to say something rather than sit on an eternal "Searching…".
          if (cancelled || sequence.current !== id) return;
          setAnswered(trimmed);
          setResults([]);
          setFailure('geocodeUnavailable');
          setPhase('failed');
        })
        .finally(() => {
          if (busyTimer !== null) clearTimeout(busyTimer);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(debounce);
      if (busyTimer !== null) clearTimeout(busyTimer);
    };
  }, [query, attempt, searchCity]);

  const clear = useCallback(() => {
    handleChangeText('');
  }, [handleChangeText]);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  // The search answers while the reader's focus is still in the text field, so on iOS — where
  // `accessibilityLiveRegion` does nothing — the three status lines below appeared in total
  // silence. They are announced instead, in exactly the words they display. `results` is
  // deliberately not announced: the rows themselves are the answer, and a count read over the
  // typing would be the chatter this whole screen avoids.
  useAnnounceChange(
    phase === 'busy'
      ? t('location.searching')
      : phase === 'empty'
        ? t('location.noResults', { query: answered })
        : phase === 'failed'
          ? t(failure === 'noResults' ? 'location.noResults' : 'location.searchUnavailable', {
              query: answered,
            })
          : null
  );

  return (
    <View testID={testID} style={[{ gap: spacing.sm }, style]}>
      <Card
        variant="bright"
        border="mid"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          minHeight: 46,
        }}
      >
        <Icon name="search" size={19} variant="outlined" color={colors.faint} />
        <TextInput
          testID={`${testID}-input`}
          accessibilityLabel={t('location.searchPlaceholder')}
          value={query}
          onChangeText={handleChangeText}
          autoFocus={autoFocus}
          autoCorrect={false}
          autoCapitalize="words"
          returnKeyType="search"
          placeholder={t('location.searchPlaceholder')}
          placeholderTextColor={colors.faint}
          style={{
            flex: 1,
            paddingVertical: 11,
            ...fieldStyle,
            color: colors.ink,
          }}
        />
        {query.length > 0 ? (
          <PressableScale
            testID={`${testID}-clear`}
            accessibilityRole="button"
            accessibilityLabel={t('settings.location.search.clear')}
            onPress={clear}
            scale={0.9}
            style={{ padding: 4 }}
          >
            <Icon name="close" size={18} color={colors.header} />
          </PressableScale>
        ) : null}
      </Card>

      {phase === 'idle' && query.trim().length > 0 ? (
        <AppText variant="hint" style={{ paddingHorizontal: spacing.xs }}>
          {t('settings.location.search.hint')}
        </AppText>
      ) : null}

      {phase === 'busy' ? (
        <AppText
          testID={`${testID}-busy`}
          variant="caption"
          tone="header"
          accessibilityLiveRegion="polite"
          style={{ paddingHorizontal: spacing.xs }}
        >
          {t('location.searching')}
        </AppText>
      ) : null}

      {phase === 'empty' ? (
        <AppText
          testID={`${testID}-empty`}
          variant="caption"
          tone="header"
          accessibilityLiveRegion="polite"
          style={{ paddingHorizontal: spacing.xs }}
        >
          {t('location.noResults', { query: answered })}
        </AppText>
      ) : null}

      {phase === 'failed' ? (
        <View
          testID={`${testID}-failed`}
          style={{ gap: spacing.xs, paddingHorizontal: spacing.xs }}
        >
          <AppText variant="caption" tone="header" accessibilityLiveRegion="polite">
            {t(failure === 'noResults' ? 'location.noResults' : 'location.searchUnavailable', {
              query: answered,
            })}
          </AppText>
          <PressableScale
            testID={`${testID}-retry`}
            accessibilityRole="button"
            accessibilityLabel={t('location.retry')}
            onPress={retry}
            style={{ alignSelf: 'flex-start', paddingVertical: 8, paddingEnd: spacing.md }}
          >
            <AppText variant="time" weight={600} tabularNums={false} color={colors.accent}>
              {t('location.retry')}
            </AppText>
          </PressableScale>
        </View>
      ) : null}

      {phase === 'results' ? (
        <View testID={`${testID}-results`} style={{ gap: spacing.xs }}>
          {results.map((candidate) => (
            <CityResultRow
              key={`${candidate.label}|${candidate.latitude.toFixed(3)}|${candidate.longitude.toFixed(3)}`}
              location={candidate}
              current={selectedLabel !== null && selectedLabel === candidate.label}
              onPress={() => onSelect(candidate)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * One candidate. The coordinates are shown at two decimals — the same ~1 km precision the app
 * actually collects, so the row never implies a house number.
 */
function CityResultRow({
  location,
  current,
  onPress,
}: {
  location: AppLocation;
  current: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <PressableScale
      testID={`city-result-${location.label}`}
      accessibilityRole="button"
      accessibilityLabel={t('settings.location.search.resultA11y', { place: location.label })}
      accessibilityState={{ selected: current }}
      haptics
      onPress={onPress}
      style={{ borderRadius: radius.card }}
    >
      <Card
        variant={current ? 'bright' : 'normal'}
        border={current ? 'strong' : 'faint'}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          // 48 is the touch floor (D55) and the rows reach it on their content alone; the tighter
          // padding buys the fifth result its place above the keyboard in Arabic, where every row
          // is ~1.15× taller. `PressableScale` guarantees the tap target regardless.
          minHeight: 48,
          paddingVertical: 6,
          paddingHorizontal: spacing.md,
        }}
      >
        <Icon
          name={current ? 'check' : 'location_on'}
          size={18}
          variant={current ? 'filled' : 'outlined'}
          color={current ? colors.accent : colors.faint}
        />
        <View style={{ flex: 1, gap: 1 }}>
          <AppText variant="rowName">{location.label}</AppText>
          <AppText variant="time">
            {t('settings.location.current.coordinates', {
              latitude: location.latitude.toFixed(2),
              longitude: location.longitude.toFixed(2),
            })}
          </AppText>
        </View>
        {current ? (
          <AppText variant="caption" tone="accent">
            {t('settings.location.search.selected')}
          </AppText>
        ) : null}
      </Card>
    </PressableScale>
  );
}
