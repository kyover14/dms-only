# Getting it onto your iPhone

> **New to this?** Read [GET-IT-ON-YOUR-PHONE.md](GET-IT-ON-YOUR-PHONE.md)
> instead. It is this same process with every click spelled out and nothing
> assumed — including the GitHub account you need to create first. Come back here
> for the reference material and the troubleshooting.

No Mac required. Two things do the work: **GitHub Actions** compiles the app on a
macOS runner, and **SideStore** (or AltStore) installs and re-signs it from your
Windows PC using a free Apple ID.

Read [What this cannot do](#what-this-cannot-do) before you start. It is short
and it matters.

---

## What you are installing

A real iOS app, called **Focus**, with Instagram *inside it*. You tap its icon,
it opens on your Messages, and the home feed, Reels, Explore and Search are not
reachable anywhere in it. Messages, profiles and notifications all work, and
every one of those blocks is a switch in Settings.

It is **not** a blocker. It is a different front door to Instagram. The real
Instagram app stays installed — keep it, so you still get push notifications for
messages — and a Shortcut (step 6) sends you into this app whenever you tap it.

Everything except the `.ipa` file is already built and tested in this repository:
the app's source, its filtering engine, and the tests for both. The `.ipa` itself
needs macOS, which is why GitHub Actions compiles it — that is step 1.

---

## What this cannot do

**iOS gives no app any way to modify another app.** Not yours, not Meta's, not
the ones on the App Store that claim to. There is no equivalent of Android's
accessibility services, and the Screen Time API (`FamilyControls`) can only block
*whole* apps and websites — blocking Instagram that way takes your messages down
with it.

So this works for Instagram **in this app**, not in the Instagram app. That is
the whole reason this project exists in this shape.

Two consequences worth accepting up front:

- **No push notifications from inside this app.** Messages will not buzz unless
  the real Instagram app is also installed and logged in.
- **Some Instagram features need the real app** — posting stories from the
  camera, for instance. Use the real app for those; come back here to read and
  reply.

---

## 1. Get the `.ipa`

All of this is one-time. The repository has already been committed for you, so
there is nothing to stage — you need a GitHub repository to push it to, and the
commands below do the rest.

1. Create an **empty** repository on GitHub (private is fine — the free
   `macos-latest` minutes cover this many times over). Do not add a README,
   licence or `.gitignore`; this checkout already has them.

2. Push, replacing `<you>` and `<repo>`:

   ```bash
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```

3. Watch it build: **Actions** tab → the **iOS** workflow. The `ios` job compiles
   the app on a macOS runner and packages an unsigned `.ipa`.

4. **Tag the version so the `.ipa` gets a permanent URL.** This is the step that
   makes installing and *updating* pleasant, and it is the only difference
   between the two ways of collecting the build:

   ```bash
   git tag v1.0.4
   git push origin v1.0.4
   ```

   The `release` job then attaches the `.ipa` to a GitHub Release. Its URL looks
   like:

   ```
   https://github.com/<you>/<repo>/releases/latest/download/InstagramFocus-unsigned.ipa
   ```

   That link never expires and works without being signed in to GitHub, so it can
   be handed to SideStore directly — see step 3. Without the tag you can still
   grab the file from the workflow run's **Artifacts** section, but artefacts
   expire and need you signed in on the phone.

It is unsigned on purpose: SideStore signs it on install with your own Apple ID,
which means no certificates, no provisioning profiles, and no
`$99`-a-year membership.

> **First run only.** The very first `ios` job takes a few minutes longer while
> Homebrew installs XcodeGen. If the build fails, the workflow prints the
> `xcodebuild` tail and a directory listing — paste that and it can be fixed
> without a Mac.

---

## 2. Set up SideStore or AltStore on Windows

Both are the same idea: a desktop component pairs with your phone once, then the
phone side re-signs apps on its own.

1. Install **iTunes** and **iCloud** from Apple's own website — *not* the
   Microsoft Store versions, which omit the device drivers these tools need.
2. Install [AltServer](https://altstore.io/) (Windows build), or set up
   [SideStore](https://sidestore.io/).
3. Connect your iPhone by USB, unlock it, and tap **Trust**.
4. Install the store app onto your phone from the desktop component, then enable
   **Developer Mode** on the phone: **Settings → Privacy & Security → Developer
   Mode** → on → restart.
5. On the phone, open the store app and sign in with your Apple ID. A free
   Apple ID works. Use an **app-specific password** if the tool offers it — never
   your main password.

**SideStore vs AltStore:** SideStore refreshes the 7-day certificate on-device
over a local VPN, so you do not need the PC every week. AltStore needs the
desktop component running on the same network to refresh. If SideStore's refresh
troubles you, AltStore is the fallback.

---

## 3. Install the app

1. Get the `.ipa` onto the phone. Either open the release URL from step 1.4 in
   Safari (it downloads to **Files**), or AirDrop the file across.
2. In the store app on the phone, use **+ / Install** and pick the `.ipa`. If
   your SideStore build offers **Add Source**, the release URL works there too,
   which means future versions install from inside the app.
3. It appears on your home screen as **Focus**.

**Updating later:** push the change, bump the version in `package.json` and
`ios/project.yml` (the build fails if they disagree), then tag and push the new
tag. The release URL stays the same, so refreshing in the store app picks up the
new build. Reinstalling over the old one keeps you signed in, because the session
lives in the app's persistent web data — deleting the app is what logs you out.

Free-Apple-ID limits to expect: **3 sideloaded apps** at a time, and each
certificate lasts **7 days**.

---

## 4. First run, and signing in

Open **Focus**. It loads `instagram.com/direct/inbox/` and, because the default
data store is persistent, you only sign in once.

Sign-in is the one part of this project that is not fully in our control —
Instagram sometimes treats embedded browsers as suspicious. How this was
mitigated:

- a full mobile Safari user agent (`Version/18.0 Mobile/15E148 Safari/604.1`)
- a persistent `WKWebsiteDataStore`, so the session survives relaunch
- password login rather than a third-party SSO button, which is far more likely
  to work in a web view

**If sign-in fails or loops**, in order of how likely it is to help:

1. **Sign in to the real Instagram app first.** Instagram links the session to
   the account, not the client, and a warmed-up account is treated better.
2. Try **Continue with Facebook/Google** in the web view if password login is
   refused — sometimes the reverse is true.
3. Clear the app's data (delete and reinstall) and try again on a fresh session.
4. As a last resort, set **Settings → Behaviour → Landing path** to a profile
   URL and use this app read-only, keeping messaging in the real app.

A useful trick: once signed in, the giveaway that the engine is alive is that no
**Reels**, **Explore** or **Search** entry appears in the navigation. If those are still
there, the engine loaded but a selector missed — see
[Tuning against the live DOM](../README.md#tuning-against-the-live-dom).

**Want account search back?** Settings → **Hide search entirely** off. Search
then opens with accounts and tabs intact and only the endless results grid
removed; turn **Hide search results grid** off too and you get all of it. People
can also be found from the Messages screen's own recipient search, which is never
touched.

---

## 5. Verify it actually works

Run through this once, on the device, after signing in. Each item maps to
something the offline tests cover, so a failure here means the real Instagram DOM
has moved — fix it in `core/selectors.js`, not in the Swift.

| # | Do this | Expect |
|---|---|---|
| 1 | Open Focus | Lands on Messages, no feed flash |
| 2 | Look at the bottom/side nav | No **Reels** entry, no **Explore** entry |
| 3 | Open a conversation and send a message | Works, keyboard fine |
| 4 | Open your profile, then Tagged | Loads |
| 5 | Tap **Search** | You are bounced back to Messages — search is blocked like the feed |
| 5b | Settings → **Hide search entirely** off | Search opens, accounts appear, the endless grid does not |
| 6 | Type `instagram.com/reels/` in the address bar of a *new* Safari tab | Not applicable — check via a link from a profile instead: tapping a profile's **Reels** tab must not load it |
| 7 | Tap the back button repeatedly from Messages | Never lands on the feed |
| 8 | Kill and relaunch the app | Still signed in, still on Messages |
| 9 | Real Instagram app still installed | Messages still notify you |

Items 6 and 7 are the ones that catch a half-working install: they are the paths
that silently reach the feed if only the CSS layer is doing its job.

---

## 6. Bounce the Instagram app into Focus (optional, recommended)

This is what keeps the habit from leaking back. Keep the real Instagram app for
notifications, and let a Shortcut move you out of it the moment you open it.

1. **Shortcuts** app → **Automation** → **+** → **App**.
2. Choose **Instagram**, tick **Is Opened**, and set it to **Run Immediately**
   (turn off "Ask Before Running").
3. Action: **Open App** → **Focus**.
4. Done.

Now tapping the Instagram icon opens Focus instead. Notifications still arrive
from the real app; if you deliberately want the real app, open it from the App
Library and dismiss the automation.

---

## 7. Keeping it alive

Free Apple IDs last **7 days**. SideStore refreshes on-device automatically over
a local VPN; AltStore needs the desktop component reachable. If the app stops
launching, it has simply expired — open the store app and refresh.

To remove the upkeep entirely: join the Apple Developer Program ($99/yr) and
distribute through **TestFlight**, which lasts a year per build. Change nothing
else — the same unsigned artifact can be re-signed for TestFlight, and this app
needs no entitlements or App Review approvals because it uses no gated APIs.

---

## Not the app: Safari, no PC, no Apple ID

**This is a fallback, not the product.** It is the same filtering engine, but
running as a **userscript inside Safari** instead of inside an app you own. Use it
if you have no Windows PC to sideload from, or if you want to try the filtering
before going through the install.

What you lose by taking this route: there is no Focus app on your home screen, no
toolbar button back to Messages, and every time you open Instagram you are opening
**Safari** — which is the exact arrangement this project exists to avoid.

If that is still useful:

1. Install [Userscripts](https://apps.apple.com/us/app/userscripts/id1463298887)
   from the App Store — free and open source.
2. Open the app, choose a folder for scripts, and pick somewhere in
   **iCloud Drive / Files** so you can drop files in from any device.
3. Run `npm run build`. That also writes
   **`Put-On-Your-Phone/instagram-focus.user.js`** — the same file, copied to a
   shallower path so it is easy to find.

   **Sending that one file to your phone is the whole transfer.** It is a single
   plain-text file; get it there however suits you and it will save into **Files**:

   - **Email it to yourself** as an attachment, then open the message on the
     phone and tap **Share → Save to Files**. The most reliable option.
   - **Message it to yourself** (Messages, WhatsApp, Telegram, Signal) and use
     **Share → Save to Files** on the message.
   - **Any cloud or transfer app you already use** — whatever is synced on the
     phone, or a USB cable with an app that exposes file sharing.

   Once it is in Files, **long-press the `.user.js` → Move** into the script
   folder from step 2, then confirm you can see it in the Userscripts app.

   There is no install step and nothing to sign. Nothing on this route needs
   Apple's permission, which is why it needs no cable and no account.
4. **Settings → Apps → Safari → Extensions → Userscripts** → **Allow**, and set
   it to allow on `instagram.com`.
5. Open `instagram.com` in Safari.

**Updating it:** `npm run build` → send yourself the new `.user.js` (same name)
→ replace the old one → reopen Safari. The engine reloads with the page, so no
reinstall and no re-signing is involved.

**Confirm which build you are running** — in Safari's web inspector, or by
adding a temporary alert, read `IGFocus.status().version`. If it does not match
`package.json`, the old file is still in place and Safari is serving a cache.

Caveats specific to this route:

- **Safari only.** Not the Instagram app, and **not** a Home Screen web app —
iOS does not run extensions inside those.
- Because a userscript manager may inject into an **isolated world**, the history
  patch can silently do nothing. That is why route detection polls the URL as
  well; it is what makes this path work at all.
- Notifications still come from the real Instagram app. Keep it installed.

---

## Troubleshooting

**App installs but immediately closes.**
The certificate expired, or Developer Mode is off. Refresh in the store app;
re-enable Developer Mode in Settings → Privacy & Security.

**Messages list is blank, or the whole page is blank.**
This is the failure mode the engine is most careful about, and it has its own
regression guard in `fixtures/instagram-mock.html` (`__igfocusSelfTest()`). It
almost always means a selector in `core/selectors.js` is matching something on
the Messages page. Narrow that selector, rebuild, reinstall.

**Feed flashes for a moment before the redirect.**
`rules.json` probably failed to compile. The JS and delegate layers still work,
which is why this is cosmetic rather than fatal; check the device console for a
`rule list failed to compile` line.

**Reels still reachable from a profile or a DM share.**
DM shares are intentional — you asked for messages to keep working, so video
inside a conversation is allowed. Profile tabs are not: check that
**Settings → What to hide → Hide Reels** is on.

**Everything worked, then a week later nothing blocks.**
Instagram shipped a markup change and a selector rotted. See
[`README.md` → Tuning against the live DOM](../README.md#tuning-against-the-live-dom).

**Messages opens, but the feed comes back when I tap Home.**
That was a real bug, fixed in **1.0.1**: the script could not see in-app route
changes made through a `pushState` it had not managed to patch, and it only ever
redirected rather than also hiding. Confirm you are running the fix by checking
`IGFocus.status().version`, and make sure the updated file actually got onto the
device.
