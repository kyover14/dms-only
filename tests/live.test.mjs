/**
 * Live smoke test — the built extension, in a real browser, against the real
 * instagram.com.
 *
 * Everything else in `tests/` runs against markup this repository wrote. That is
 * what makes those tests fast and deterministic, and it is also their blind spot:
 * a fixture can only confirm that the engine does what we *believe* Instagram
 * does. This file is the one thing that can contradict that belief.
 *
 * It is opt-in, because it needs the network, it depends on a site nobody here
 * controls, and hammering Instagram on every `npm test` would be rude:
 *
 *   IGFOCUS_LIVE=1 npm test          # every suite, including this one
 *   IGFOCUS_LIVE=1 node --test tests/live.test.mjs
 *
 * EXPECT IT TO FAIL SOMETIMES. A logged-out Instagram serves a login wall, and a
 * tested-too-often one serves a challenge. Both are reported as findings rather
 * than treated as engine bugs — the assertions below are written to hold in any
 * of those states, and to fail only when the engine itself did not do its job.
 *
 * What it can prove while logged out:
 *   * the extension loads into a real browser at all (a broken manifest or a
 *     module that throws means the attribute is never set);
 *   * the engine runs on Instagram's own markup, not just ours;
 *   * the nav entries it targets are hidden *if they exist* — reported as a
 *     vacuous pass when the page serves no nav, never as a silent success;
 *   * a blocked route does not stay on screen.
 *
 * What it cannot prove: anything behind a login. Sign-in, the DM list, the feed
 * itself and the search panel are all invisible from here.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = join(ROOT, 'dist', 'chrome');

const LIVE = process.env.IGFOCUS_LIVE === '1';
const SKIP = LIVE
  ? false
  : 'hits the real instagram.com — set IGFOCUS_LIVE=1 to include it';

let chromium = null;
try {
  ({ chromium } = await import('playwright'));
} catch {
  // Left null; skipped below like the WebKit suite.
}
const NEEDS_PLAYWRIGHT = chromium ? false : 'playwright is not installed';

/** The chrome rules guard.css scopes to this attribute. */
const EXPECTED_CHROME = 'reels explore search';

let context = null;
let profileDir = null;
let mode = null;

/**
 * Load the unpacked extension the way a person would.
 *
 * Extensions need the full Chromium build rather than the headless shell, and
 * they need the new headless mode. Old headless silently ignores
 * `--load-extension`, which is why the probe below checks that the engine
 * actually ran instead of assuming the flag worked: a flag that is quietly
 * dropped would otherwise make this whole file pass while testing nothing.
 */
async function launch() {
  if (!existsSync(EXTENSION)) {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, stdio: 'pipe' });
  }
  profileDir = mkdtempSync(join(tmpdir(), 'igfocus-live-'));

  const args = [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`];
  const attempts = [
    { label: 'headless (new)', options: { headless: true, args } },
    { label: 'headed', options: { headless: false, args } }
  ];

  const failures = [];
  for (const attempt of attempts) {
    let candidate = null;
    try {
      candidate = await chromium.launchPersistentContext(profileDir, attempt.options);
      const page = candidate.pages()[0] || (await candidate.newPage());
      await page.goto('https://www.instagram.com/robots.txt', {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      });
      await page.waitForTimeout(1500);

      // The real proof that the extension loaded: the engine writes this
      // attribute on <html>, and attributes are visible across the isolated
      // world a content script runs in.
      const chromeAttr = await page.evaluate(() =>
        document.documentElement.getAttribute('data-igfocus-hide')
      );
      if (chromeAttr) {
        mode = attempt.label;
        return candidate;
      }
      failures.push(`${attempt.label}: extension did not load (data-igfocus-hide absent)`);
      await candidate.close();
    } catch (err) {
      failures.push(`${attempt.label}: ${err.message.split('\n')[0]}`);
      if (candidate) await candidate.close().catch(() => {});
    }
  }

  throw new Error(`could not load the extension in any mode:\n  ${failures.join('\n  ')}`);
}

/**
 * Visit a URL and report what the engine did to it.
 *
 * Reads only things shared across the isolated world: the route attributes, the
 * number of nodes the engine stamped, and computed styles (our stylesheet is
 * injected into the page itself, so it affects them). `window.IGFocus` is
 * deliberately NOT expected here — a content script's globals belong to its own
 * world, and reaching for them from the page would be testing the harness.
 */
/**
 * Observe the navigation chain for the main frame.
 *
 * This exists because of a subtlety that made the first version of this file lie:
 * while logged out, Instagram **302s** some URLs straight to the login wall. No
 * document is ever served for them, so a content script cannot run on them at
 * all — and an assertion about what the engine did to such a URL can never fail,
 * which makes it worse than useless. A `302` as the first main-frame response is
 * the flag for "the engine never had a chance here".
 */
function watchNavigations(page) {
  const chain = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) chain.push({ type: 'nav', url: frame.url() });
  });
  page.on('response', (response) => {
    const request = response.request();
    if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
    chain.push({ type: 'http', status: response.status(), url: response.url() });
  });
  return chain;
}

/** Did Instagram answer the requested URL with a redirect, before any script ran? */
function serverBouncedBeforeScripts(url, chain) {
  const first = chain.find((entry) => entry.type === 'http' && entry.url === url);
  return Boolean(first && first.status >= 300);
}

/** Shape the page state this file asserts on. Shared by both page helpers. */
const SNAPSHOT = () => {
    const displays = (selector) =>
      [...document.querySelectorAll(selector)].map((node) => getComputedStyle(node).display);

    return {
      href: location.href,
      title: document.title,
      route: document.documentElement.getAttribute('data-igfocus-route'),
      chrome: document.documentElement.getAttribute('data-igfocus-hide'),
      hiddenNodes: document.querySelectorAll('[data-igfocus-hidden]').length,
      mainWorldHasIGFocus: typeof window.IGFocus === 'object',
      hrefCounts: {
        home: document.querySelectorAll('a[href="/"]').length,
        reels: document.querySelectorAll('a[href^="/reels"]').length,
        explore: document.querySelectorAll('a[href="/explore/"], a[href="/explore"]').length,
        search: document.querySelectorAll('a[href^="/explore/search"]').length,
        inbox: document.querySelectorAll('a[href^="/direct/inbox"]').length
      },
      displays: {
        reels: displays('a[href^="/reels"]'),
        explore: displays('a[href="/explore/"], a[href="/explore"]'),
        search: displays('a[href^="/explore/search"]'),
        inbox: displays('a[href^="/direct/inbox"]')
      },
      visibleText: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      hasLoginForm: !!document.querySelector('input[name="username"], input[name="password"]'),

      // Does the stylesheet actually apply on Instagram's own document? A
      // synthetic anchor answers it even on a page that ships no nav at all: the
      // rule is scoped to `html[data-igfocus-hide~="reels"]`, so this is a
      // simultaneous test of the attribute the engine writes AND the CSS the
      // extension injects. The Messages control proves it is scoped rather than
      // hiding every link on the page.
      cssProbe: (() => {
        const target = document.createElement('a');
        target.setAttribute('href', '/reels/');
        const control = document.createElement('a');
        control.setAttribute('href', '/direct/inbox/');
        document.body.appendChild(target);
        document.body.appendChild(control);
        const result = {
          targeted: getComputedStyle(target).display,
          control: getComputedStyle(control).display
        };
        target.remove();
        control.remove();
        return result;
      })()
    };
};

/** Open a real Instagram page, hand it to `fn`, and always clean up. */
async function withPage(url, fn, { settleMs = 4000, config = null } = {}) {
  const page = await context.newPage();
  const errors = [];
  const chain = watchNavigations(page);
  page.on('pageerror', (err) => errors.push(String(err).split('\n')[0]));

  // Settings live in localStorage, so the origin has to exist before they can be
  // written. Visiting once and then setting them is reliable; an init script is
  // not, because a content script at document_start may run before it.
  if (config) {
    await page.goto('https://www.instagram.com/robots.txt', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.evaluate(
      (payload) => localStorage.setItem('igfocus.config.v1', JSON.stringify(payload)),
      config
    );
  }

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(settleMs);

  const report = await page.evaluate(SNAPSHOT);
  const full = {
    ...report,
    errors,
    chain,
    serverBounced: serverBouncedBeforeScripts(url, chain)
  };

  try {
    return await fn(page, full);
  } finally {
    await page.close();
  }
}

/** Visit a URL and report what the engine did to it. */
async function probe(url, options = {}) {
  return withPage(url, (_page, report) => report, options);
}

/** The query Instagram appends when it bounces you to the login wall. */
function loginNext(href) {
  try {
    return new URL(href).searchParams.get('next');
  } catch {
    return null;
  }
}

/**
 * The invariants that hold no matter what Instagram decides to serve.
 *
 * `label` colours the failures so a logged-out login wall is not mistaken for a
 * broken engine.
 */
function assertEngineRan(report, label) {
  assert.equal(
    report.chrome,
    EXPECTED_CHROME,
    `[${label}] the engine did not run on the real site — the extension is not ` +
      `reaching instagram.com (data-igfocus-hide was ${
        report.chrome === null ? 'never set' : JSON.stringify(report.chrome)
      })`
  );
  assert.equal(
    typeof report.route,
    'string',
    `[${label}] the engine ran but did not classify the route`
  );
}

/** Nothing the engine targets for hiding may still be on screen. */
function assertNothingTargetedIsVisible(report, label) {
  for (const [name, list] of Object.entries(report.displays)) {
    if (name === 'inbox') continue;
    for (const [index, display] of list.entries()) {
      assert.equal(
        display,
        'none',
        `[${label}] a ${name} nav entry (${index + 1} of ${list.length}) is still visible on the ` +
          `real site, so the selector missed it`
      );
    }
  }
}

before(async () => {
  if (SKIP || NEEDS_PLAYWRIGHT) return;
  context = await launch();
});

after(async () => {
  if (context) await context.close().catch(() => {});
  if (profileDir) rmSync(profileDir, { recursive: true, force: true });
});

test('the extension loads into a real browser and runs on real Instagram', { skip: SKIP || NEEDS_PLAYWRIGHT }, async () => {
  console.log(`      loaded in ${mode} mode: ${EXTENSION}`);

  const report = await probe('https://www.instagram.com/');
  console.log(`      / -> ${report.href}`);
  console.log(`      route=${report.route} chrome=${report.chrome} hiddenNodes=${report.hiddenNodes}`);
  console.log(`      nav anchors: ${JSON.stringify(report.hrefCounts)}`);
  console.log(`      login wall: ${report.hasLoginForm}, text: ${JSON.stringify(report.visibleText.slice(0, 90))}`);

  // If Instagram had answered `/` with a redirect, no document would have been
  // served and this test could not fail. Pin that down before asserting anything.
  assert.equal(
    report.serverBounced,
    false,
    '[home] Instagram answered / with a redirect, so no document was served and this test proves nothing'
  );
  assertEngineRan(report, 'home');
  assertNothingTargetedIsVisible(report, 'home');

  // A blocked route must not be left on screen. Logged out, Instagram sends `/`
  // to a login wall rather than to Messages — so the assertion is that we are not
  // still at the bare root, not that we landed somewhere specific.
  assert.notEqual(
    new URL(report.href).pathname,
    '/',
    '[home] the home route was left on screen instead of being redirected away from'
  );
  assert.ok(report.visibleText.length > 0, '[home] the page came back empty');

  if (report.mainWorldHasIGFocus) {
    console.log('      note: IGFocus is visible from the page world (the engine runs in the page, not isolated)');
  }
});

test('/reels/ does not survive on the real site', { skip: SKIP || NEEDS_PLAYWRIGHT }, async () => {
  const report = await probe('https://www.instagram.com/reels/');
  console.log(`      /reels/ -> ${report.href} (route=${report.route})`);
  console.log(`      navigation chain: ${report.chain.map((e) => (e.type === 'http' ? `http:${e.status}` : 'nav')).join(' -> ')}`);

  assert.equal(report.serverBounced, false, '[reels] Instagram redirected before a document was served');
  assertEngineRan(report, 'reels');
  assertNothingTargetedIsVisible(report, 'reels');

  assert.notEqual(
    new URL(report.href).pathname,
    '/reels/',
    '[reels] the engine left the Reels route on screen'
  );
});

test('the stylesheet is live on real Instagram, and is scoped rather than blanket', { skip: SKIP || NEEDS_PLAYWRIGHT }, async () => {
  // This is the check a fixture cannot make. The real page usually serves no nav
  // while logged out, so instead of hoping for one, plant a synthetic anchor and
  // ask the browser what the injected stylesheet does to it.
  const report = await probe('https://www.instagram.com/');
  assertEngineRan(report, 'css');

  assert.equal(
    report.cssProbe.targeted,
    'none',
    '[css] a Reels link injected into the real page is NOT hidden, so the extension stylesheet is ' +
      'not applying — the engine runs, but the pre-paint layer that stops a flash does not'
  );
  assert.notEqual(
    report.cssProbe.control,
    'none',
    '[css] a Messages link was hidden too, so the stylesheet is blanket rather than scoped — ' +
      'this would break messaging'
  );

  console.log(
    `      injected probe: reels=${report.cssProbe.targeted}, messages=${report.cssProbe.control}`
  );

  const total = Object.values(report.hrefCounts).reduce((sum, n) => sum + n, 0);
  if (total === 0) {
    console.log(
      '      the served page has no navigation anchors (logged out / login wall), so the row ' +
        'climb itself is still unverified against the live DOM'
    );
    return;
  }

  console.log(`      nav anchors found: ${JSON.stringify(report.hrefCounts)}`);
  assertNothingTargetedIsVisible(report, 'nav');

  if (report.hrefCounts.inbox > 0) {
    assert.equal(
      report.displays.inbox.some((display) => display !== 'none'),
      true,
      '[nav] a Messages entry exists but was hidden — this is the dangerous one'
    );
  }
});

test('search is blocked on the real site, by the same mechanism as Reels', { skip: SKIP || NEEDS_PLAYWRIGHT }, async () => {
  const SEARCH = '/explore/search/keyword/?q=cats';

  // A direct GET of the search URL is NOT a usable test while logged out, and it
  // took a control run without the extension to establish that: Instagram answers
  // it with a 302 to the login wall, so no document is ever served for it and a
  // content script cannot run on it. An assertion here would pass no matter what
  // the engine did. Detect that, say so, and test the route a way that is
  // actually possible.
  const direct = await probe('https://www.instagram.com' + SEARCH);
  console.log(`      direct GET ${SEARCH} -> ${direct.href}`);
  if (direct.serverBounced) {
    console.log(
      '      Instagram 302s this URL logged out, so no document reaches a content script. ' +
        'Exercising the route on a real Instagram document instead, by moving the URL the way ' +
        'the site itself does.'
    );
  } else {
    assertEngineRan(direct, 'search-direct');
    assertNothingTargetedIsVisible(direct, 'search-direct');
  }

  const LOGIN = 'https://www.instagram.com/accounts/login/';

  // Direction 1: search blocked (the default). Changing the URL in place is what
  // Instagram's own router does, and it leaves the engine as the only thing that
  // can react to it — so whatever happens next is attributable to the engine.
  const moved = await withPage(LOGIN, async (page) => {
    const before = await page.evaluate(() => location.href);
    await page.evaluate((path) => window.history.pushState({}, '', path), SEARCH);
    await page.waitForTimeout(3000);
    return { before, after: await page.evaluate(() => location.href) };
  });
  console.log(`      pushState ${SEARCH} with search blocked -> ${moved.after}`);

  const bounced = loginNext(moved.after);
  assert.ok(
    bounced,
    `[search] the engine did not redirect: the URL stayed at ${moved.after} instead of reaching ` +
      'Messages, so search is reachable on the real site'
  );
  // The `next=` parameter is the strongest available evidence: it is Instagram
  // recording which URL it was asked for, so it reports what the redirect did
  // rather than what the page looked like at the moment we happened to look.
  const decoded = decodeURIComponent(bounced);
  console.log(`      Instagram was asked for: ${decoded}`);
  assert.match(decoded, /\/direct\/inbox\//, '[search] search was not redirected to Messages');
  assert.doesNotMatch(decoded, /\/explore\/search/, '[search] the redirect left us on the search URL');

  // Direction 2: the same URL with search allowed. Nothing should rewrite it.
  const stayed = await withPage(
    LOGIN,
    async (page) => {
      await page.evaluate((path) => window.history.pushState({}, '', path), SEARCH);
      await page.waitForTimeout(3000);
      return await page.evaluate(() => location.href);
    },
    { config: { blockSearch: false } }
  );
  const stayedTarget = loginNext(stayed) ? decodeURIComponent(loginNext(stayed)) : stayed;
  console.log(`      pushState ${SEARCH} with search allowed -> ${stayedTarget}`);

  assert.doesNotMatch(
    stayedTarget,
    /\/direct\/inbox\//,
    '[search] the engine still redirected to Messages with the search toggle off'
  );
  assert.match(
    stayedTarget,
    /\/explore\/search/,
    '[search] the search URL was rewritten even though search was allowed'
  );
});

test('a stored setting is read and honoured on the real site', { skip: SKIP || NEEDS_PLAYWRIGHT }, async () => {
  // Narrow on purpose. The URL-level half of "search off gives search back" is
  // asserted in the test above, on a document the engine can actually act on.
  // What is left, and what this covers, is that the engine reads the persisted
  // config on Instagram's real origin and lets it change what it hides — the
  // mechanism behind every toggle, not just this one.
  const report = await probe('https://www.instagram.com/', {
    config: { blockSearch: false, blockExplore: false }
  });

  console.log(`      with search and explore off, chrome attr = ${JSON.stringify(report.chrome)}`);

  assert.equal(
    report.chrome,
    'reels',
    '[toggle] the engine did not read the stored settings on the real site — data-igfocus-hide ' +
      'must list only the blocks that are still on'
  );

  // And the stylesheet has to follow it: the two layers agreeing is the whole
  // mechanism, and a Reels link is the control that proves the rest was dropped
  // rather than the attribute simply failing to update.
  assert.equal(report.cssProbe.targeted, 'none', '[toggle] a Reels link is no longer hidden, but it should be');
  assert.notEqual(report.cssProbe.control, 'none', '[toggle] the Messages control was hidden');
});
