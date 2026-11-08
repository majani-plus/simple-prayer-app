/**
 * The behaviour behind `LocationPicker.astro`, shared by the times card and the qibla dial.
 *
 * Both pages ask the same question and write the same answer to the same `localStorage` key, so
 * choosing a city on one means the other already knows it. Keeping the interaction here rather
 * than in either component is what makes that true rather than nearly true.
 */
import type { AppStrings } from './appStrings.generated';
import { cityLabel, clearLocation, loadCities, loadLocation, nearestCity, requestGeolocation, saveLocation, searchCities, type City, type StoredLocation } from './location';
import { localeTag, type Locale } from './format';

export interface PickerStrings {
  denied: string;
  unavailable: string;
  unsupported: string;
}

export interface PickerOptions {
  locale: Locale;
  app: AppStrings;
  strings: PickerStrings;
  /** Called with a chosen location, and again if its name is later corrected for this locale. */
  onLocation: (loc: StoredLocation) => void;
  /** Called when the visitor asks to choose again, so the page can stop whatever it was showing. */
  onCleared: () => void;
}

export interface Picker {
  /** Shows the chosen label and hides the prompt. */
  showChosen: (loc: StoredLocation) => void;
  /** Returns to the prompt. */
  showChooser: () => void;
  /** Reports a failure in the status line, e.g. when the times could not be computed. */
  setStatus: (message: string) => void;
  /** Re-names a stored location into this page's language, in the background. */
  relabelIfNeeded: (loc: StoredLocation) => Promise<void>;
}

export function setupLocationPicker(root: HTMLElement, opts: PickerOptions): Picker {
  const { locale, app, strings, onLocation, onCleared } = opts;
  const tag = localeTag(locale);

  const el = {
    choose: root.querySelector<HTMLElement>('[data-loc-choose]')!,
    chosen: root.querySelector<HTMLElement>('[data-loc-chosen]')!,
    name: root.querySelector<HTMLElement>('[data-loc-name]')!,
    change: root.querySelector<HTMLButtonElement>('[data-loc-change]')!,
    locate: root.querySelector<HTMLButtonElement>('[data-locate]')!,
    input: root.querySelector<HTMLInputElement>('[data-city-input]')!,
    status: root.querySelector<HTMLElement>('[data-city-status]')!,
    results: root.querySelector<HTMLUListElement>('[data-city-results]')!,
  };

  /**
   * `data-has-location` on <html> is what the pre-paint script in Base.astro stamps so a returning
   * visitor never sees the prompt flash. It is kept in step here so the CSS and the `hidden`
   * attributes never disagree — the CSS carries `!important` to win before the script runs, which
   * means leaving the attribute set after a "Change" would pin the prompt shut.
   */
  function showChosen(loc: StoredLocation) {
    el.name.textContent = loc.label;
    el.chosen.hidden = false;
    el.choose.hidden = true;
    document.documentElement.setAttribute('data-has-location', '');
    el.results.replaceChildren();
    el.status.textContent = '';
  }

  function showChooser() {
    el.chosen.hidden = true;
    el.choose.hidden = false;
    document.documentElement.removeAttribute('data-has-location');
  }

  function setStatus(message: string) {
    el.status.textContent = message;
  }

  /**
   * Re-names a stored location into this page's language.
   *
   * The name is stored rather than re-derived so a return visit renders instantly without waiting
   * on a 50 KB city list — which leaves it in the language it was chosen in. This corrects that,
   * always after the page is already usable: nobody should wait on a download to read their Fajr.
   */
  async function relabelIfNeeded(loc: StoredLocation) {
    if (loc.labelLocale === locale) return;
    const near = nearestCity(await loadCities(locale), loc.lat, loc.lon);
    if (!near) return;
    const updated: StoredLocation = {
      ...loc,
      label: cityLabel(near, locale, tag),
      city: near.name,
      labelLocale: locale,
    };
    saveLocation(updated);
    el.name.textContent = updated.label;
    onLocation(updated);
  }

  el.change.addEventListener('click', () => {
    clearLocation();
    onCleared();
    showChooser();
    el.input.focus();
  });

  el.locate.addEventListener('click', async () => {
    el.locate.disabled = true;
    setStatus(app.location.resolving);
    const outcome = await requestGeolocation();
    el.locate.disabled = false;

    if (!outcome.ok) {
      setStatus(
        outcome.reason === 'denied'
          ? strings.denied
          : outcome.reason === 'unsupported'
            ? strings.unsupported
            : strings.unavailable
      );
      el.input.focus();
      return;
    }

    const near = nearestCity(await loadCities(locale), outcome.lat, outcome.lon);
    if (!near) {
      setStatus(strings.unavailable);
      return;
    }
    // The browser's own coordinates drive the computation — they are better than the city's. The
    // city supplies only the name and the country, and the device supplies the zone, since someone
    // standing here is on this clock.
    const loc: StoredLocation = {
      lat: outcome.lat,
      lon: outcome.lon,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || near.tz,
      countryCode: near.countryCode,
      label: cityLabel(near, locale, tag),
      city: near.name,
      labelLocale: locale,
      source: 'auto',
    };
    saveLocation(loc);
    setStatus('');
    onLocation(loc);
  });

  let cities: City[] | null = null;
  let searchToken = 0;

  el.input.addEventListener('input', async () => {
    const query = el.input.value;
    const token = ++searchToken;
    if (query.trim().length < 2) {
      el.results.replaceChildren();
      setStatus('');
      return;
    }
    if (!cities) {
      setStatus(app.location.searching);
      cities = await loadCities(locale);
    }
    // The list arrives asynchronously the first time; a slower answer must not overwrite a newer one.
    if (token !== searchToken) return;

    const matches = searchCities(cities, query);
    setStatus(matches.length === 0 ? app.location.noResults : '');
    el.results.replaceChildren(
      ...matches.map((city) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = cityLabel(city, locale, tag);
        button.addEventListener('click', () => {
          const loc: StoredLocation = {
            lat: city.lat,
            lon: city.lon,
            tz: city.tz,
            countryCode: city.countryCode,
            label: cityLabel(city, locale, tag),
            city: city.name,
            labelLocale: locale,
            source: 'city',
          };
          saveLocation(loc);
          el.input.value = '';
          onLocation(loc);
        });
        li.append(button);
        return li;
      })
    );
  });

  return { showChosen, showChooser, setStatus, relabelIfNeeded };
}

export { loadLocation };
