# Getting Focus onto your iPhone, click by click

This is the whole path, from nothing to an app on your home screen. It assumes
you have never used GitHub and do not want to learn it — every command is written
out in full, nothing is skipped.

**Read [Before you start](#before-you-start) first.** It lists the five things you
need to have, and the one step people get stuck on.

Roughly 30–45 minutes end to end, most of it waiting for downloads.

> **Nothing exists to download yet.** An iOS app can only be compiled on macOS,
> and you are on Windows, so the `.ipa` file does not exist until Part 1 puts this
> code on GitHub — Part 2 is where it gets built, and Part 4 is where you download
> it. Everything on this machine is already finished and tested; the missing piece
> is that one build.

---

## Before you start

Have these ready:

| # | What | Notes |
|---|---|---|
| 1 | This Windows PC | You are on it. It already has git and this repository. |
| 2 | Your iPhone and its charging cable | The cable is only needed once. |
| 3 | A free Apple ID | The same one you use on the phone is fine. **No $99 developer account needed.** |
| 4 | A free GitHub account | [github.com/signup](https://github.com/signup) — 2 minutes, no card. |
| 5 | iTunes and iCloud for Windows | From **Apple's own website** (`apple.com/itunes`, `apple.com/icloud`), **not** the Microsoft Store — the Store versions leave out the drivers the phone link needs. |

**The step people get stuck on** is step 1.4 below, where git asks you to sign in
to GitHub. Read that one carefully; it explains the password trap.

---

## Part 1 — Put the code on GitHub

GitHub is not optional here. It is the machine that does the compiling, because
building an iOS app requires macOS and you do not have a Mac. It is free and
private.

**1.1** Sign in at [github.com](https://github.com).

**1.2** Go to [github.com/new](https://github.com/new) and fill in:

- **Repository name**: `dms-only` (or anything you like)
- **Private**: select this
- Leave **Add a README file**, **Add .gitignore** and **Choose a license** all
  **unticked**. This repository already has those files, and adding them here
  creates a conflict on your first push.
- Click **Create repository**.

**1.3** GitHub now shows you a page with a URL. It looks like
`https://github.com/YOURNAME/dms-only.git`. Copy it.

**1.4** Back on this PC, in this folder, run these two commands — replacing the
URL with yours:

```bash
git remote add origin https://github.com/YOURNAME/dms-only.git
git push -u origin main
```

A browser window will open asking you to sign in to GitHub and authorise
"Git Credential Manager". Approve it, and the push completes.

> **If it asks for a password in the terminal instead**, that is the trap: GitHub
> stopped accepting account passwords for git years ago. You need a token.
> Go to [github.com/settings/tokens](https://github.com/settings/tokens) →
> **Generate new token (classic)** → tick the top-level **`repo`** box → set an
> expiry → **Generate**. Copy the token and paste it **as the password**. Your
> username is your GitHub username. You only do this once.

**1.5** Tag the version, so the built app gets a permanent download link instead
of a file that expires in a month:

```bash
git tag v1.0.4
git push origin v1.0.4
```

---

## Part 2 — Let GitHub build the app

**2.1** Open your repository on github.com and click the **Actions** tab.

**2.2** You will see a run called **iOS** with an amber dot, then a green tick.
It takes **about 5 minutes the first time**. Leave it alone.

It is doing three things: running the tests, compiling the app with Xcode, and
packaging the result as an unsigned `.ipa`.

**2.3** When it finishes, ignore the red X on the **WebKit engine check** job if
there is one. That job downloads browser binaries and is deliberately set not to
block the build.

**2.4** If the job called **iOS app (unsigned .ipa)** shows a red X, the build
failed. Open it, scroll to the last step that has output, and copy the last ~30
lines to whoever is helping you. **This has not happened yet** — the app's Swift
has never been compiled at all, because that requires macOS, so this run is the
first real test of it. A failure here is expected to be fixable, not fatal.

---

## Part 3 — Install the store app on your iPhone

This is the piece that lets a free Apple ID install an app that Apple never
approved. You do it once.

Pick one:

- **SideStore** ([sidestore.io](https://sidestore.io/)) — refreshes the app on the
  phone itself over a local VPN, so the PC is needed only for the first install.
  **Recommended.**
- **AltStore** ([altstore.io](https://altstore.io/)) — needs the PC on the same
  network every 7 days to refresh.

**3.1** Install **iTunes** and **iCloud** for Windows from Apple's website, and
sign in to neither. They are only there for the device drivers.

**3.2** Install AltServer (the Windows desktop component, from either site above).

**3.3** Connect the iPhone by cable. Unlock it and tap **Trust** on the phone, then
enter your passcode.

**3.4** Through AltServer, install the store app onto the phone. It will ask for
your **Apple ID** — a free one is fine. If the tool offers an **app-specific
password**, use that rather than your main password.

**3.5** On the phone: **Settings → Privacy & Security → Developer Mode → on**,
then restart the phone when it asks. The setting only appears after step 3.4.

---

## Part 4 — Install Focus

**4.1** Get the `.ipa`. Two ways — the PC is easier:

- **On the PC:** open
  `https://github.com/YOURNAME/dms-only/releases/latest` and download
  **`InstagramFocus-unsigned.ipa`**.
- **On the phone:** open the same URL in Safari; it saves to **Files**.

If there is no release there (because the tag in step 1.5 failed): go to
**Actions** → the finished **iOS** run → scroll to **Artifacts** → download
**`InstagramFocus-unsigned-ipa`**. That arrives as a **`.zip`** — unzip it first,
the file inside is the `.ipa`. This works, but the download expires after 30 days
and needs you signed in to GitHub, which is why the tag is worth getting right.

> **You cannot install the app by sending the `.ipa` to your phone.** Unlike the
> userscript, an `.ipa` is not something iOS opens — tapping it in Files offers
> nothing, because the app is unsigned and iOS will only install signed apps. It
> has to go through the store app from Part 3, which signs it on the way in. This
> is the one place where Apple's rules cannot be worked around.

**4.2** Install it:

- **On the phone:** open the store app → **+** → choose the `.ipa` → install.
- **Or over the cable:** with the phone plugged in, open AltServer's menu and use
  **Install .ipa**, picking the downloaded file.

**4.3** It appears on your home screen as **Focus**.

Free Apple ID limits, so they are not a surprise: **3 sideloaded apps at a time**,
and the install lasts **7 days**.

---

## Part 5 — First run

Open **Focus**. It loads `instagram.com/direct/inbox/`, so you land on Messages.
Sign in with Instagram's own login screen — once. The session is kept in the
app's persistent storage, so relaunching does not log you out.

Then check the four things that matter:

1. **No Reels, Explore or Search** in the bottom bar.
2. Open a conversation and send a message — works, keyboard fine.
3. Open your profile, then Tagged — loads.
4. Tap **Messages** in the toolbar — always returns you to the inbox.

If Reels or Search is still there, the engine loaded but a selector missed on the
real site — see the tuning section in [README.md](../README.md). If the app
crashes on launch, the certificate expired or Developer Mode is off.

---

## Part 6 — Every 7 days

A free Apple ID's certificate expires after 7 days and the app stops opening. It
has not been deleted; it has expired.

- **SideStore:** open it and refresh. It does this on-device over a local VPN.
- **AltStore:** connect the PC to the same Wi-Fi with AltServer running.

This is the price of not paying Apple $99 a year. Paying removes it and hands you
TestFlight builds that last a year — nothing else about the app changes.

---

## Part 7 — Optional: make the Instagram icon open Focus

Keeps the habit from leaking back, without deleting the real Instagram app (which
you want, for message notifications).

1. **Shortcuts** → **Automation** → **+** → **App**
2. Choose **Instagram**, tick **Is Opened**, set **Run Immediately**
3. Action: **Open App** → **Focus**

---

## If you would rather not use GitHub at all

There is one route that needs no PC, no GitHub and no Apple ID: the same
filtering engine as a **userscript inside Safari**, via the free
[Userscripts](https://apps.apple.com/us/app/userscripts/id1463298887) app.

It is **not the app** — no Focus icon, no toolbar, and you would be opening
Safari every time, which is the arrangement this project exists to avoid. But it
works in ten minutes if you want something today. Full steps are at the bottom of
[INSTALL-iOS.md](INSTALL-iOS.md).
