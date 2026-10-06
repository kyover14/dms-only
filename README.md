# Instagram Focus

An iOS app that loads Instagram with **only messages and the useful parts** —
Messages, profiles, notifications and search work; the home feed, Reels and
Explore do not exist.

Not a blocker, and not an Instagram mod. It renders `instagram.com` in a
`WKWebView` it controls, and filters what that web view is allowed to show.

---

## The constraint that shapes everything

**iOS gives no app any way to modify another app.** There is no equivalent of
Android's accessibility services, and Apple's Screen Time API (`FamilyControls`)
can only block *whole* apps and websites — block Instagram that way and your
messages go too. Any app claiming to strip Reels out of the Instagram app itself
is either routing you to the web, or not doing it.

So the achievable design is a different front door: your own app, your own web
view, your own rules. Keep the real Instagram app installed for notifications,
and let a Shortcut bounce you here when you tap it.

| Approach | Selective? | Works on the Instagram app? | Cost |
|---|---|---|---|
| **This app** (WKWebView + filtering) | Yes | No — it *is* the Instagram client | Free |
| Screen Time / FamilyControls | No — whole apps only | Yes | $99/yr + entitlement |
| Safari extension / userscript | Yes | No | Free |
| Guided Access (circling screen regions) | Partially | Yes, but breaks whenever the layout moves | Free |

---

## How it works: three layers, each catching what the last missed

1. **Navigation layer** — `WKNavigationDelegate` cancels a blocked navigation
   *before it loads*. This is the reason for using `WKWebView` instead of Safari:
   no flash of feed, no autoplay, nothing to hide. The rule table is
   **generated from `core/routes.js`**, so native and JS can never disagree.
2. **Declarative layer** — `core/rules.json`, compiled into a `WKContentRuleList`.
   URL-scoped hiding at first paint. URL scoping is what lets the feed container
   be hidden on `/` without also hiding your messages on `/direct/inbox/` — a
   thing plain CSS cannot express.
3. **DOM layer** — `core/guard.js` injected at `documentStart`. Instagram is a
   SPA, so most navigation never fires a navigation event at all; this patches
   `history.pushState`, listens for `popstate`, and re-applies rules on a
   debounced `MutationObserver`.

The third layer is plain, dependency-free JavaScript that also runs as a browser
extension and as a userscript — which is how the whole engine is developed and
tested **from Windows, with no device**.

---

## Layout

```
core/                    the engine — the only code that knows about Instagram
  config.js              every toggle, and the fail-closed defaults
  routes.js              THE source of truth for blocked URLs (generates Swift)
  selectors.js           THE file to edit when Instagram changes its markup
  guard.js               route handling, hiding, observers
  guard.css              static hide rules, injected before first paint
  rules.json             declarative rules → WKContentRuleList
fixtures/
  instagram-mock.html    offline replica of Instagram's DOM + self-test
tests/                   `node --test`, zero dependencies
scripts/
  build.mjs              userscript + extension folders + fixture + iOS resources
  serve.mjs              dev server with SPA fallback for the fixture
ios/
  project.yml            XcodeGen spec (plain text, editable from Windows)
  FocusApp/              SwiftUI app; GeneratedRoutes.swift + Resources/ generated
.github/workflows/
  ios-build.yml          builds the unsigned .ipa on a macOS runner
docs/INSTALL-iOS.md      install walkthrough, on-device checklist, troubleshooting
```

---

## Quick start

```bash
npm test              # everything below; ~4s, no network
npm run test:webkit   # just the WebKit tests
npm run build         # userscript, browser extensions, fixture, iOS resources
npm run serve         # http://127.0.0.1:8123/ — the offline fixture
```

The WebKit tests need Playwright, the project's only dependency and a dev one at
that. Without it they **skip with instructions instead of failing**, so the repo
still works with nothing installed:

```bash
npm i -D playwright && npx playwright install webkit
```

## Developing without an iPhone

The fixture is a hand-built stand-in for Instagram's markup — a nav, a feed with
articles, a Reels viewer in a `[role="dialog"]`, a "Suggested Reels" section, a
search surface, autoplaying video, and a Messages list with a working composer.
It routes with the real History API, exactly like Instagram, so SPA behaviour is
exercised rather than assumed.

It is also a regression harness. Open the console and run:

```js
__igfocusSelfTest()
```

That asserts the invariants that matter, above all this one:

> Hiding a blocked surface must never carry over onto a surface that has to keep
> working.

That is not hypothetical. Instagram reuses its main container across routes, so
an early version hid the feed on `/` and left the *same* container hidden on
`/direct/inbox/` — a blank Messages page. The engine now separates **persistent**
hiding (the Reels nav link, never wanted anywhere) from **route-scoped** hiding
(recomputed from scratch on every route change), and the fixture asserts it on
every run.

There is a second such bug, and it only appeared on a real device:

> A route change must be detectable without any cooperation from the page.

Patching `history.pushState` only works when the script shares a JavaScript
**world** with the page. Under a Safari extension or a userscript manager it may
not: the patch installs against an object the page never calls, reports no error,
and every subsequent in-app navigation is invisible. On iOS Safari the result was
that Messages opened correctly, but tapping Home brought the whole feed back.

The fixes, both of which the fixture now covers via `__igfocusSpaTest()`:

- **Route detection by polling `location`**, which no page can bypass or
disarm. The history patch remains as a faster path when it does work.
- **Hiding is no longer conditional on redirecting.** A blocked route is emptied
  first and redirected second, so a missed or suppressed redirect can no longer
  leave the feed on screen.

Also fixed alongside it: the MutationObserver was attached to
`document.documentElement`, which does not exist at `document-start` — so it
silently gave up and watched nothing for the whole session. It now observes
`document`, which always exists.

A third, found only when the tests were run under **WebKit**: the redirect loop
guard throttled on elapsed time alone, so opening the app and tapping Reels
within 1.2s silently swallowed the redirect. Chromium never caught it because
manual runs always happened later. It now records *where we were* when the
redirect was requested and only suppresses it if the page has not moved since —
the precise "did the last redirect actually take effect?" question, and
self-clearing once it does.

## Tuning against the live DOM

`core/selectors.js` matches on `href` values and ARIA roles, never on
Instagram's hashed class names. It has now been measured against the **live
signed-in DOM** (desktop 1400x900 and mobile 513x799), and the first measurement
was unflattering:

* there is **no `<nav>` element** on the site at all — `navTags: 0`;
* the only `[role="navigation"]` node is the DM **"Thread list"** panel, and it
  contains **zero anchors**;
* the Home/Reels/Explore/Messages/Profile entries are bare `<a href="…">` inside
  a chain of `<div>`s — a 6-item **bottom tab bar** on mobile, a 7-item
  **sidebar** on desktop.

So the original `nav a[href^="/reels/"]` selectors matched nothing, and hiding
the anchor alone removed only the label: the row's icon and its 48px of tappable
height stayed on screen. That is the bug this round fixes. `guard.js` now climbs
from each nav anchor to the row that owns it (`navRowFor`, bounded by
`NAV_ITEM_MAX_HOPS`) and hides **both**, guided by a single rule that holds on
the real site: climb while the parent still contains no other link, and stop at
the first ancestor that does.

The offline fixture and `fixtures/bare.html` were reshaped to the same
no-`<nav>`, div-and-anchor layout, including a decoy "Thread list"
`[role="navigation"]` with no links — because the old fixture had a real `<nav>`,
which is exactly why the tests passed while the device did not.

The workflow, still with no iPhone required:

1. `npm run build`
2. Chrome → `chrome://extensions` → **Developer mode** → **Load unpacked** →
   `dist/chrome`
3. Open `instagram.com` and compare against your expectations.
4. Fix `core/selectors.js` (or `core/guard.css`), rebuild, reload.

Reproduce anything surprising in `fixtures/instagram-mock.html` **first**, so the
fix is covered by the self-test; then change the selectors. Add a line to
`TUNING_LOG` in `core/selectors.js` saying what broke and what fixed it.

Still unverified against the live site: the search results grid selector
(`main[role="main"] div[role="tabpanel"]`). `main[role="main"]` was confirmed to
exist, but the search panel itself has not been re-measured since.

The same `core/` directory also builds a userscript (`dist/userscript/`) that
works in Safari on iOS via the free [Userscripts](https://apps.apple.com/us/app/userscripts/id1463298887)
extension — a useful fallback that needs no build toolchain and no Apple ID.

---

## The iOS app

Requires no Mac and no paid Apple account: GitHub Actions compiles on a macOS
runner, and SideStore or AltStore installs and re-signs the unsigned `.ipa` with
a free Apple ID.

No entitlements, no gated capabilities, no App Review approval — deliberately, so
the cheap install path stays open. **Do not add `FamilyControls` or any other
restricted entitlement** without revisiting that trade-off.

Full walkthrough: [`docs/INSTALL-iOS.md`](docs/INSTALL-iOS.md).

---

## What is and is not verified

**Verified now:**

- 26 Node tests over route classification, config merging and the content rules
- **4 WebKit tests**, the browser family iOS actually uses:
  - the shipped userscript artifact, injected into an engine-free page, hides the
    Reels and Explore entries and refuses the feed
  - the engine passes its own harness (19 assertions) and the SPA suite (4) under
    WebKit, with no page errors
  - **three real iPhone profiles** — iPhone 17 Pro Max, iPhone 17 and iPhone SE
    (3rd gen) — with mobile Safari user agents and 440/402/375pt viewports all
    reach the *identical* verdict, so the filtering is not viewport- or
    UA-dependent
  - WebKit and Chromium return **identical** results for the same input, so the
    behaviour is not engine-specific
- 19 in-browser assertions over the fixture (`__igfocusSelfTest()`), including
  the blank-Messages regression and the redirect path
- 4 SPA assertions (`__igfocusSpaTest()`) covering the case where the history
  patch cannot work
- Route detection **in isolation**: a blocked route reached with an unpatchable
  `pushState` and no DOM mutation is still caught, by the URL poll alone
- `GeneratedRoutes.swift` is generated correctly from `core/routes.js`
- Build integrity: every core file is inlined into the fixture byte-for-byte
- **On iOS Safari the engine loads, classifies and redirects correctly**
  (confirmed on a device, 1.0.1). Check yours with `IGFocus.status().version`.

What the WebKit tests are **not**: Playwright's WebKit is the WebKit engine on
macOS, reporting a macOS Safari user agent. It is the same engine family as the
iPhone, which makes it a genuinely useful proxy — it is how the cooldown bug
above was caught — but it is not iOS Safari, not mobile Safari's user agent, and
not the app's `WKWebView`. Treat it as "unlikely to be engine-specific", not as
"proven on the phone".

**Not yet verified:**

- **Selectors against the live Instagram DOM.** Still the biggest open item.
- **Anything on an actual iPhone.** No device access here, and no iOS Simulator
  without macOS.
- Instagram sign-in inside a `WKWebView`. Mitigated (Safari user agent,
  persistent data store, password login) but unproven until tried on a device.
- The Xcode project builds — XcodeGen and `xcodebuild` only run on macOS, so CI
  is where that gets proved.
- SideStore refresh behaviour on current iOS.

---

## Non-goals

- Modifying or patching the Instagram application.
- Any third-party client, tweak or injected binary. ToS and account-ban risk,
  and you would be handing your credentials to a modified app.
- Hiding Reels *within* DMs. You asked for messages to work, so shared video
  plays. If you want it stricter, that is a selector change in `core/selectors.js`.
- **Handling your credentials, or automating a sign-in.** There is nothing here
  to configure with a username and password, and there never should be. You sign
  in once, manually, through Instagram's own login screen — in the app (which
  keeps the session in a persistent `WKWebView` data store) or in Safari. No
  credential belongs in this repository, in a config file, or in a commit.
