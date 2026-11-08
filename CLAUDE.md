# CLAUDE.md — Simple Prayer

## ⚡ Resume protocol (READ THIS FIRST)

On **"continue"**, or start of ANY session mid-project (also after compaction/context loss):
1. Read `docs/internal/TRACKING.md`. Do what **NEXT ACTION** say. No re-derive state from scratch.
2. Read reference docs at top of TRACKING.md when need (spec → design → architecture).
3. Keep TRACKING.md true always: mark tasks `[~]`/`[x]`, update NEXT ACTION + session log,
   and **commit TRACKING.md with work it describe. Push after every commit.**
4. `docs/internal/` = separate private git repo (gitignored here, no remote): commit TRACKING there
   alongside app commit.

Project run autonomous (owner check in rare): work milestone by milestone per TRACKING.md, spawn
subagents for parallel work + code review, stop only for thing that truly need owner (credentials,
store accounts, product contradictions). Report short when pause.

## What this is

Free, beautiful, ad-free prayer times + prayer tracking app (iOS + Android). React Native / Expo /
TypeScript. Full spec in `docs/PRODUCT_SPEC.md`; decisions log in `docs/DECISIONS.md` (append-only —
never silently break decision); visual language in `docs/DESIGN.md`; architecture + conventions in
`docs/ARCHITECTURE.md`.

## The why — read this before designing anything

Owner words. Tie-breaker when design call close:

> "the app's core purpose isn't to accurately track every single prayer ever. It's more a heuristic
> tracking to motivate. But the core goal here is to encourage prayers and make it very simple and
> fun to open and get that mini reward of clicking prayed. Not to become a ledger of a person's
> prayer history. That's a principle for the app as a whole. Don't forget the why of it."

Feel bar: **"so dumb and easy that an old person or a 7 year old could use"** — despite all options
underneath, which must layer so nobody meet them uninvited.

What this mean in practice, because it change real decisions:

- **Reward loop IS product.** Open, see what due, tap, feel good. Nothing sit between user and that
  tap. Nothing greet them with work before they reach it.
- **App is tool. Least friction win.** Owner, 2026-08-21, verbatim: *"i dont care about time spent in
  product. The app is a tool. It just needs to be useful for people. Everything needs to be simple to
  use. If people are getting the functionality out of it with the least amount of friction then job
  well done."* This settle question that keep coming back, so no raise again: feature that let
  someone get what they came for **without opening app** — mark prayer from notification, widget,
  whatever next — is win, not loss to reward loop. Loop exist to make tap feel good and keep nothing
  blocking it, not to pull people in. Never optimise for engagement, session length, return visits.
  Nothing to sell here, nobody to impress with retention chart.
- **Completeness not goal.** Feature that catch common case in one tap beat one that handle every
  case in four. Drop minor case usually right call, not gap.
- **Never make it audit.** Anything that show user backlog to reconcile, or ask them account for
  themselves, is against point however accurate.
- **Accuracy serve motivation; not product.** Correctness still matter absolutely where wrong would
  harm someone — qada debt they no owe, prayer shown missed when not, wrong times — but precision
  for own sake no reason to add anything.
- **Two first-class audiences, not one.** Tracking is headline feature, get full investment — it is
  reward loop, none of it shrink, hide, or apologise for. It just not *mandatory*. Someone who only
  want prayer times + qibla must find app just as excellent, so no feature assume logging, nag toward
  it, or look broken when log empty. Test not "is tracking prominent" — it should be — but "does
  non-logger ever feel nagged, blocked, or like using it wrong". Qada tracking asked about — not
  assumed — during first-run setup; skip there is how somebody opt out. No qada on/off switch in
  Settings; `qadaSetupCompleted` only stop wizard asking twice.
- **Assume people lazy at logging. Be merciful.** Fill blanks reasonable, no interrogate. Fine to get
  wrong: anyone who care fix it in History, most no care — that the point. Soft beat precise every
  time here. Tracking is encouragement, never chore, never accusation.

## Working alongside other agents (one worktree, one index)

Many agents at once share **one working tree and one git index**. Two consequences, both already cost
real time:

- **Never run whole-tree git command.** `git stash`, `git reset --hard`, `git checkout .`,
  `git restore .`, `git clean` hit *everyone* in-flight work, not yours — and while in effect tree
  LIES to every other agent: `git status` say clean, greps return pre-edit contents, someone
  reasonably conclude their work destroyed. To undo own mistake, revert only specific paths you
  touched.
- **`git add <path>` stage into shared index, and `git commit` ship everything staged** — not just
  your paths. ~1,800 lines of one agent work once land inside another unrelated commit this way. Run
  `git status` right before committing, know exactly what you ship. When file you must touch also
  hold another agent uncommitted work (locale files especially), stage only own hunks, not whole
  file.

Also: never commit file that import untracked module — pass local, die on CI. And leaving tree red on
missing prop or half-applied rename cost every other agent a diagnosis, because all run `typecheck`
against same files. Keep prop + call-site in same edit round.

## Hard rules

- **bun**, never npm/yarn/pnpm: `bun install`, `bun run <script>`, `bunx <cli>`. Jest run via `bun run test` (Node), NOT `bun test`.
- No ads, no analytics SDKs, no accounts, no network dependency for core features. Data never leave device.
- Never request precise or Always location; coarse/while-using only.
- Domain logic live in `src/domain/` — pure TS, no React/RN imports, exhaustive unit-tested.
- Day-boundary logic ONLY in `src/domain/dates.ts` (prayer day = Fajr→next Fajr).
- No hardcoded user-facing strings — all through i18n (en/ar/tr); Arabic/Turkish copy authored, not machine-mirrored.
- **All copy follow `docs/TONE.md`** — app, website, store listings, store screens, notifications.
  Read before writing user-facing word. Short version: no idioms, no catchphrases, no marketing
  voice; short sentences; warm but never childish; readable by ten-year-old or by someone whose
  English is third language — most readers.
- Tip-jar / store copy: "tip"/"support" only — NEVER donate/donation/charity/sadaqah/zakat/bağış/تبرع (Apple 3.2.2(iv)).
- No shaming copy anywhere (streaks/qada hope-framed); exempt days never rendered missed; never interrogate user.
- States never color-only (icon + word, always).
- Commit small and often to `main`, push every time; every commit leave TRACKING.md consistent with code.

## Expo SDK 58

Project on **Expo SDK 58** (RN 0.88, React 19.3). Expo changed a lot — verify APIs against
https://docs.expo.dev/versions/v58.0.0/ instead of trusting prior knowledge. Local facts: router root
is `src/app/`; RNTL v14 `render` is async; jest on 30.x (jest-expo 58 built on it); eslint stay on
9.x (plugin peers cap at 9); TypeScript stay on 6.0 (Expo pins it, typescript-eslint caps <6.1);
`newArchEnabled` no longer exist in app.json. RN 0.87+ types are strict: refs are `ViewInstance`,
style types read-only, `StyleSheet.flatten` may return undefined. Tests take `getAnimatedStyle`
from `@/testing/reanimated`, not from Reanimated directly (its package types point at the web stub).

## Device testing never blocks (D38)

If iOS simulator or Android emulator misbehave, note in `docs/internal/TRACKING.md` Known Issues and
**keep building** — never stall milestone on device verification. Retry later; owner help fix device
testing at end if still broken.

## Commands

- `bun run typecheck` · `bun run lint` · `bun run test` — must be green before mark any task `[x]`.
- **Touched Kotlin?** None of those three see it. Run
  `cd android && ./gradlew :<module>:compileReleaseKotlin` (~90 s) before any release — compile error
  otherwise cost whole EAS build to find.
- **Touched Swift?** Same. Run `bun run typecheck:swift` (in `pre-release`). `swiftc -parse` check
  syntax only — argument that callee no declare pass it, then die in `xcodebuild`. That already cost
  one EAS build.
- `bunx expo start` — dev server (iOS simulator: `i`, Android emulator: `a`).

## Definition of done (per task)

Code + tests + typecheck/lint green + (for UI) verified in simulator against `docs/DESIGN.md` +
TRACKING.md updated + committed + pushed.