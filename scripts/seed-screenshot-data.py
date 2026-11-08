#!/usr/bin/env python3
"""
Seeds the iOS simulator's on-device SQLite database with plausible, dignified tracking data
for the App Store / Play screenshot run (M10).

This touches ONLY the simulator container — never the repo, never src/. It is here so a
screenshot pass is reproducible: re-run it and you get byte-identical data.

Run:  python3 scripts/seed-screenshot-data.py [--udid <SIMULATOR_UDID>]

The story it tells (all of it internally consistent, nothing exaggerated):
  * ~4.5 months of history ending today
  * a current soft-mode streak of 46 days, which is also the all-time best
  * a realistic mix: mostly prayed, a regular sprinkle of "late", occasional misses,
    a few jama'ah days
  * today: Fajr prayed, the rest still upcoming (the honest mid-morning state)
  * a qada debt of 52 that is visibly being paid down — 46 make-ups in the last 30 days,
    which projects a debt-free date about five weeks out

Numbers are generated from a fixed RNG seed, so the calendar looks organic but never moves.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import random
import sqlite3
import subprocess
import sys

BUNDLE_ID = "app.simpleprayer"
DB_RELATIVE = "Documents/SQLite/simple-prayer-times.db"

PRAYERS = ["fajr", "dhuhr", "asr", "maghrib", "isha"]

# --- the shape of the story -------------------------------------------------------------------
HISTORY_DAYS = 140  # how far back logs go
CURRENT_STREAK = 46  # days, soft mode (>=1 prayed/late). Day -46 is the break.
# Earlier breaks, as offsets back from today. They keep every earlier run shorter than
# CURRENT_STREAK, so "best" and "current" agree — the user is on their best run ever.
EARLIER_BREAKS = [60, 78, 95, 110, 125, 138]
QADA_DEBTS = {"fajr": 14, "dhuhr": 9, "asr": 11, "maghrib": 6, "isha": 12}  # total 52
QADA_TICKS_IN_WINDOW = 46  # make-ups logged in the last 30 days (drives the projection)
RNG_SEED = 20260819


def resolve_db_path(udid: str | None) -> str:
    cmd = ["xcrun", "simctl", "get_app_container", udid or "booted", BUNDLE_ID, "data"]
    container = subprocess.check_output(cmd, text=True).strip()
    return os.path.join(container, DB_RELATIVE)


def day_str(d: dt.date) -> str:
    return d.isoformat()


def epoch_ms(d: dt.date, hour: int = 12, minute: int = 0) -> int:
    return int(dt.datetime(d.year, d.month, d.day, hour, minute).timestamp() * 1000)


def build_rows(today: dt.date) -> tuple[list[tuple], list[tuple]]:
    rng = random.Random(RNG_SEED)
    breaks = {CURRENT_STREAK, *EARLIER_BREAKS}
    logs: list[tuple] = []

    for offset in range(HISTORY_DAYS, 0, -1):
        d = today - dt.timedelta(days=offset)
        if offset in breaks:
            # A broken day: a couple of honest misses, the rest simply never logged.
            for prayer in rng.sample(PRAYERS, rng.choice([2, 3])):
                logs.append(
                    (
                        day_str(d),
                        prayer,
                        "missed",
                        None,
                        epoch_ms(d, 22),
                        epoch_ms(d, 22),
                    )
                )
            continue

        statuses: dict[str, str | None] = {}
        for prayer in PRAYERS:
            roll = rng.random()
            if roll < 0.78:
                statuses[prayer] = "prayed"
            elif roll < 0.92:
                statuses[prayer] = "late"
            elif roll < 0.97:
                statuses[prayer] = "missed"
            else:
                statuses[prayer] = None  # never logged
        if not any(s in ("prayed", "late") for s in statuses.values()):
            statuses["maghrib"] = "prayed"

        for prayer, status in statuses.items():
            if status is None:
                continue
            logged = epoch_ms(d, 6 + PRAYERS.index(prayer) * 3)
            logs.append((day_str(d), prayer, status, None, logged, logged))

    # Today: Fajr prayed, everything else still ahead of the clock.
    logs.append(
        (
            day_str(today),
            "fajr",
            "prayed",
            None,
            epoch_ms(today, 5),
            epoch_ms(today, 5),
        )
    )

    # --- qada -------------------------------------------------------------------------------
    events: list[tuple] = []
    setup_day = today - dt.timedelta(days=HISTORY_DAYS - 2)
    initial_total = sum(QADA_DEBTS.values()) + QADA_TICKS_IN_WINDOW + 38
    events.append(
        (
            "estimateSet",
            None,
            initial_total,
            epoch_ms(setup_day, 20),
            json.dumps({"source": "estimate"}),
        )
    )
    # Make-ups before the pace window (not counted by computeProgress, but they are the truth
    # of how the debt got down to where it is).
    for i in range(38):
        d = today - dt.timedelta(days=31 + (i * 3) % (HISTORY_DAYS - 35))
        events.append(("tick", PRAYERS[i % 5], -1, epoch_ms(d, 19), None))
    # Make-ups inside the 30-day pace window — these drive the projected debt-free date.
    for i in range(QADA_TICKS_IN_WINDOW):
        d = today - dt.timedelta(days=(i * 29) // QADA_TICKS_IN_WINDOW)
        events.append(("tick", PRAYERS[i % 5], -1, epoch_ms(d, 19), None))
    events.sort(key=lambda e: e[3])

    return logs, events


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--udid", default=None)
    parser.add_argument("--date", default=None, help="override 'today' (YYYY-MM-DD)")
    args = parser.parse_args()

    db_path = resolve_db_path(args.udid)
    if not os.path.exists(db_path):
        print(
            f"database not found: {db_path}\nLaunch the app once so it runs its migrations.",
            file=sys.stderr,
        )
        return 1

    today = dt.date.fromisoformat(args.date) if args.date else dt.date.today()
    logs, events = build_rows(today)

    con = sqlite3.connect(db_path)
    con.execute("PRAGMA journal_mode = WAL;")
    with con:
        con.execute("DELETE FROM prayer_logs;")
        con.execute("DELETE FROM qada_debts;")
        con.execute("DELETE FROM qada_events;")
        con.execute("DELETE FROM exempt_periods;")
        con.executemany(
            "INSERT INTO prayer_logs (day, prayer, status, made_up_at, logged_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?);",
            logs,
        )
        now_ms = int(dt.datetime.now().timestamp() * 1000)
        con.executemany(
            "INSERT INTO qada_debts (prayer, count, updated_at) VALUES (?, ?, ?);",
            [(p, c, now_ms) for p, c in QADA_DEBTS.items()],
        )
        con.executemany(
            "INSERT INTO qada_events (type, prayer, delta, at, meta) VALUES (?, ?, ?, ?, ?);",
            events,
        )
    con.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    con.close()

    print(
        f"seeded {len(logs)} prayer logs and {len(events)} qada events into {db_path}"
    )
    print(
        f"today={today}  streak={CURRENT_STREAK}  qada total={sum(QADA_DEBTS.values())}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
