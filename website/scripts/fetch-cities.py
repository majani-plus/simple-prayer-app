#!/usr/bin/env python3
"""Rebuilds `data/cities.tsv` from GeoNames. Needs network; run by hand, not by the build.

The build deliberately reads only the committed TSV. Downloading 194 MB of alternate names on every
Cloudflare Pages build would make our deploys depend on someone else's uptime, for data that changes
about as often as national capitals do.

Usage:  uv run --with requests python3 scripts/fetch-cities.py
   or:  python3 scripts/fetch-cities.py          (uses urllib, no dependencies)

Source: GeoNames, CC BY 4.0 — https://www.geonames.org/. The site credits GeoNames on /support.
"""
import collections
import datetime
import io
import pathlib
import urllib.request
import zipfile

DUMP = 'https://download.geonames.org/export/dump/'
HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / 'data' / 'cities.tsv'

# Every capital, the five largest places per country, and the 2000 largest worldwide.
PER_COUNTRY = 5
GLOBAL_TOP = 2000


def fetch(name: str) -> bytes:
    print(f'  downloading {name} …')
    with urllib.request.urlopen(DUMP + name) as r:
        return r.read()


def member(blob: bytes, name: str) -> io.TextIOWrapper:
    z = zipfile.ZipFile(io.BytesIO(blob))
    return io.TextIOWrapper(z.open(name), encoding='utf-8')


def main() -> None:
    cities = []
    for line in member(fetch('cities15000.zip'), 'cities15000.txt'):
        c = line.rstrip('\n').split('\t')
        if len(c) < 19:
            continue
        cities.append({
            'id': c[0], 'name': c[1], 'ascii': c[2], 'lat': round(float(c[4]), 4),
            'lon': round(float(c[5]), 4), 'fc': c[7], 'cc': c[8],
            'pop': int(c[14] or 0), 'tz': c[17],
        })

    by_country = collections.defaultdict(list)
    for r in cities:
        by_country[r['cc']].append(r)
    for v in by_country.values():
        v.sort(key=lambda r: -r['pop'])

    keep = {r['id'] for r in cities if r['fc'] == 'PPLC'}
    for v in by_country.values():
        keep |= {r['id'] for r in v[:PER_COUNTRY]}
    keep |= {r['id'] for r in sorted(cities, key=lambda r: -r['pop'])[:GLOBAL_TOP]}
    chosen = {r['id']: r for r in cities if r['id'] in keep}
    print(f'  selected {len(chosen)} cities in {len({r["cc"] for r in chosen.values()})} countries')

    # Best Arabic and Turkish name per city: prefer the flagged preferred name, then a short name,
    # and never a colloquial or historic one.
    best: dict[tuple[str, str], tuple[int, str]] = {}
    for line in member(fetch('alternateNamesV2.zip'), 'alternateNamesV2.txt'):
        c = line.rstrip('\n').split('\t')
        if len(c) < 4 or c[2] not in ('ar', 'tr') or c[1] not in chosen:
            continue
        if len(c) > 7 and (c[6] == '1' or c[7] == '1'):
            continue
        score = (2 if len(c) > 4 and c[4] == '1' else 0) + (1 if len(c) > 5 and c[5] == '1' else 0)
        key = (c[1], c[2])
        if key not in best or score > best[key][0]:
            best[key] = (score, c[3])

    rows = sorted(chosen.values(), key=lambda r: (-r['pop'], r['ascii']))
    header = [
        '# Cities the website offers for manual location choice.',
        '#',
        '# Source: GeoNames (https://www.geonames.org/), cities15000 + alternateNamesV2,',
        '# licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). The site credits',
        '# GeoNames on /support, which is what the licence asks for.',
        '#',
        '# Selection: every national capital, the five largest places in every country, and the',
        '# 2000 largest places worldwide. That mix keeps small countries usable without letting',
        '# the file grow past what a phone should download.',
        '#',
        '# Regenerate with scripts/fetch-cities.py (needs network); the build only reads this file,',
        '# so a Cloudflare build never depends on GeoNames being up.',
        '#',
        '# Columns: geonameid, name (local), ascii, country, lat, lon, tz, name_ar, name_tr',
        '# Empty ar/tr means no distinct localized name exists; the site falls back to `name`.',
        f'# Retrieved {datetime.date.today().isoformat()} — {len(rows)} cities.',
    ]
    body = [
        '\t'.join([
            r['id'], r['name'], r['ascii'], r['cc'], f'{r["lat"]:.4f}', f'{r["lon"]:.4f}', r['tz'],
            best.get((r['id'], 'ar'), (0, ''))[1], best.get((r['id'], 'tr'), (0, ''))[1],
        ])
        for r in rows
    ]
    OUT.write_text('\n'.join(header + body) + '\n', encoding='utf-8')
    print(f'  wrote {OUT} ({OUT.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
