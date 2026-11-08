# simpleprayer.app — what the site must host

The domain is not marketing. It is a **store requirement** and an **in-app promise**, and it has to
exist before either store will accept a submission.

- **Both stores require a privacy-policy URL** on the app record. It must be publicly reachable
  without a login, and it must stay reachable — a dead privacy URL is grounds for removal, not just
  rejection.
- **Google Play additionally requires a support contact.** App Store Connect requires a support URL
  on the listing.
- **The app links to it.** `src/services/appInfo.ts` ships
  `APP_WEBSITE_URL = 'https://simpleprayer.app'`, and Settings → About renders a row labelled
  `simpleprayer.app` whose description reads **"Support and the privacy policy."** (i18n key
  `settings.about.website.description`, in all three languages). Whatever that link opens has to
  make both of those obviously available, or the About screen is lying.

Nothing here needs a framework, a build step or a CMS. Two static HTML pages served over HTTPS is
the whole requirement.

---

## Required pages

### 1. `/` — the landing page

The one page the About screen opens. It must, above the fold:

- Name the app and say what it is, in one line.
- Carry the pledge verbatim, because it is the brand: **"No ads, ever. No account."**
- Link visibly to **Privacy** (`/privacy`) and to **Support** (the contact address).
- Link to the App Store and Google Play listings once they exist.

Suggested content beyond that: three or four screenshots (reuse the store set), a short feature
list mirroring `docs/STORE_LISTINGS.md`, and nothing else. No newsletter signup, no "we use
cookies" banner — see the constraints below.

### 2. `/privacy` — the privacy policy

**Content: `docs/PRIVACY_POLICY.md`, rendered to HTML.** That file is the source of truth; the page
is a rendering of it. Do not fork the text — if the policy changes, it changes in the repo and gets
re-published, so the app, the stores and the site never disagree.

Before first publication, resolve the three bracketed owner items at the top of
`docs/PRIVACY_POLICY.md` (effective date, working mailbox, tip-jar section) and delete that
instruction block — it is repo guidance, not part of the published text.

Requirements for the page itself:

- Reachable at a **stable URL** that never redirects to a login or an interstitial. Register
  exactly this URL in both consoles: `https://simpleprayer.app/privacy`.
- Show the **effective date** at the top.
- Plain HTML, readable on a phone, no JavaScript required to read the text.
- Keep the old version, or a note of what changed, when it is updated. Play in particular will ask
  what changed if a data-safety answer moves.

### 3. Support contact

`privacy@simpleprayer.app` is named in the privacy policy. A single mailbox can serve both
privacy and support, but **it must actually deliver mail before submission** — Google Play sends a
verification to the listed contact address, and Apple's reviewers use it. If support is handled at
a different address, add it to the landing page and use it in the store listings; the privacy
address in the policy still has to work.

---

## Hard constraints

These are not preferences. Breaking any of them makes a sentence in
`docs/PRIVACY_POLICY.md` false.

1. **No analytics on the site.** No Google Analytics, Plausible, Fathom, Umami, Vercel Analytics,
   Cloudflare Web Analytics, or anything else. The policy states: *"`simpleprayer.app` sets no
   cookies, runs no analytics and embeds no third-party trackers. It does not know you visited."*
2. **No cookies.** Not for preferences, not for a theme toggle, not at all. Nothing to consent to
   means no consent banner, and no GDPR/ePrivacy consent surface to get wrong.
3. **No third-party embeds.** No Google Fonts hotlinking (self-host or use system fonts — hotlinked
   fonts send the visitor's IP to Google), no YouTube embeds, no Typeform, no chat widget, no
   social pixels, no CDN-hosted JS.
4. **No forms.** A contact form collects data; a `mailto:` link does not. Use `mailto:`.
5. **HTTPS, and it must not expire.** A privacy URL that fails TLS is a broken privacy URL.

**An ordinary link out is not one of these things (D87).** `/support` links to the public feedback
board at `simpleprayer.featurebase.app`, and that is allowed precisely because it is a link and not
an embed: nothing of that site loads here, nothing runs here, and this site still learns nothing
about the visitor. Rule 3 bans *embedding* someone else's code in these pages; rule 4 bans
*collecting* anything on them. Following a link the visitor chose to click does neither, and the
generated CSP proves it — a board that had to be embedded would have needed `frame-src` and
`connect-src` opened up, and that is the line.

**Working something out on the visitor's own device is not one of these things either (D147).**
`/times` shows today's prayer times: it reads a coordinate, either from the browser's geolocation or
from a city the visitor picked, and computes the times in the page using the same library the app
uses. Nothing is embedded — the code and the city list are ours and are served from here — and
nothing is collected, because `connect-src 'none'` means the page cannot send anything anywhere,
to us least of all. The chosen location is kept in `localStorage`, which is where the theme and
language preferences already live: rule 2 is about a cookie riding on every request to a server, and
this site has no server to ride to.

So the line is not "a link or nothing". The line is the CSP: **no page on this site may have
`connect-src` opened up.** A geocoding API, a timezone service, an analytics beacon and a contact
form all fail that test and always will. Arithmetic does not.

**And sending someone somewhere is not one of these things either (D156).** `/install` reads the
visitor's own browser to work out which phone they are on and then goes to that store's listing.
Going somewhere is a *navigation*, not a connection: it is the same act as clicking the App Store
button that is on the page anyway, and `connect-src 'none'` is untouched on that page as on every
other. Nothing is fetched, nothing is measured, and no crawler is ever redirected. The QR code on
that page is our own file, served from here — not a code generated by somebody else's service,
which would have been an embed and is why it is committed instead.

**The Apple Smart App Banner is ruled out, and this is the record of why.** One meta tag
(`<meta name="apple-itunes-app">`) would put a native "Get the app" bar at the top of every page
in Safari on iPhone. It is rejected because Safari fetches the app's name, icon and price from
Apple in order to draw it. That fails rule 3 by the test this document already sets for the
feedback board — nothing of that site loads here, nothing runs here, and the visitor chose to
click — on all three counts. It is also the one case where **the CSP could not prove us honest**:
the request comes from Safari's own chrome, not from the document, so `connect-src 'none'` would
not stop it, and the policy would no longer back the sentence it exists to back. The tag is
site-wide, so `/privacy` — the URL registered in both store consoles — would be the page carrying
an Apple-fetched banner while saying the site does not know you visited.

There is exactly one thing here that is not a page, and it is worth stating precisely because the
first attempt got it wrong and took the live site down. `/sw.js`, the worker that keeps the offline
copy, is sent **its own** policy with `connect-src 'self'` — a worker's fetches follow the policy
delivered with the worker script, not the page's, and under the page's `'none'` it could not fetch
at all: it intercepted every navigation and then failed every one of them. Its policy permits our
own origin and nothing else, it never sees the visitor's location, and the pages are unchanged at
`'none'`, which is the sentence `docs/PRIVACY_POLICY.md` actually makes. Anything beyond
same-origin, for a page or a worker, still cannot be built here.

If any of these ever has to change, `docs/PRIVACY_POLICY.md` changes in the same commit, and the
"The website" section is what has to be corrected.

---

## Hosting

Any static host will do; the shortlist that satisfies the constraints with no configuration:
Cloudflare Pages, GitHub Pages, or Netlify. Server request logs kept by the host for operational
purposes are ordinary and are not what the "no analytics" claim is about — but do not turn on the
host's own analytics dashboards or edge-analytics add-ons, which are.

Whichever is chosen, point the apex domain and `www` at it, force HTTPS, and verify
`https://simpleprayer.app/privacy` loads in a private window with no login.

---

## Checklist before either store submission

- [ ] `https://simpleprayer.app/` loads over HTTPS and shows the pledge, Privacy and Support
      links.
- [ ] `https://simpleprayer.app/privacy` loads and matches `docs/PRIVACY_POLICY.md`, with the
      repo-guidance block removed and the effective date set.
- [ ] `privacy@simpleprayer.app` receives a test message sent from an outside account.
- [ ] Page source contains no third-party script, font or image host.
- [ ] Both URLs entered into App Store Connect (privacy policy URL + support URL) and Play Console
      (privacy policy URL + support email).
