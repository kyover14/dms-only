/**
 * WebKit tests — the closest thing to an iPhone that can run off-device.
 *
 * Everything else in `tests/` runs in Node (no DOM) or in the Preview tab
 * (Chromium). Neither is the engine the phone uses. iOS Safari and the app's
 * WKWebView are WebKit, and WebKit differs from Chromium in ways that matter
 * here: CSS support, `MutationObserver` on `document`, `history` semantics,
 * `location.replace` behaviour under a strict CSP.
 *
 * The critical one is the second test: it injects the ACTUAL BUILT USERSCRIPT
 * into an engine-free page and checks the result. That is the closest possible
 * reproduction of what happens on a device — the packaged file, the real
 * engine, at document-start — without the device.
 *
 * Playwright is optional. If it is not installed these tests skip with
 * instructions rather than failing, so the project keeps working with zero
 * dependencies:
 *
 *   npm i -D playwright && npx playwright install webkit
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const FIXTURE = join(ROOT, 'dist', 'instagram-mock.html');
const USERSCRIPT = join(ROOT, 'dist', 'userscript', 'instagram-focus.user.js');
const BARE = join(ROOT, 'fixtures', 'bare.html');

/**
 * Read the version rather than hard-coding it.
 *
 * A literal here drifts silently every time the version is bumped, and the
 * assertion it feeds would then be checking the test file instead of the
 * artifact. The point of this check is that the SHIPPED file is the current
 * one — so the expectation has to come from package.json, which is the source
 * scripts/build.mjs verifies core/guard.js against.
 */
const EXPECTED_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

let webkit = null;
let devices = null;
try {
  ({ webkit, devices } = await import('playwright'));
} catch {
  // Left null; tests below skip with a hint.
}

const NEEDS_PLAYWRIGHT =
  webkit === null
    ? 'playwright is not installed — run: npm i -D playwright && npx playwright install webkit'
    : false;

let browser = null;
let server = null;
let bareServer = null;
let base = '';
let bareBase = '';

/**
 * There is no file:// here on purpose.
 *
 * WebKit treats `file:` origins as unique, and `history.replaceState` to a
 * different path throws a SecurityError on them. The fixture routes with the
 * real History API, so a file:// page would fail in a way that has nothing to
 * do with the engine. Serving over loopback avoids that entirely.
 */
function serve(html) {
  // One page per origin, served for every path. That is deliberate:
  //   - the fixture routes with the real History API, so paths like
  //     /direct/inbox/ must still resolve to it (SPA fallback);
  //   - the bare page needs to BE "the root", because `/` is the route being
  //     tested. Served at /bare it is a profile, and the engine rightly leaves
  //     it alone — which is exactly how the first version of this test failed.
  const s = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  });
  return new Promise((resolve) => {
    s.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${s.address().port}`));
  });
}

async function startServers() {
  server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(readFileSync(FIXTURE, 'utf8'));
  });
  base = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });

  bareServer = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(readFileSync(BARE, 'utf8'));
  });
  bareBase = await new Promise((resolve) => {
    bareServer.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${bareServer.address().port}`));
  });
}

/** The WebKit tests need build output; produce it rather than skipping. */
function ensureBuilt() {
  if (existsSync(FIXTURE) && existsSync(USERSCRIPT)) return;
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, stdio: 'pipe' });
}

/**
 * Run the SHIPPED userscript under one browser-context configuration and report
 * what it did.
 *
 * Shared by the desktop and iPhone tests on purpose: both are measured exactly
 * the same way, so any difference between them is a real difference rather than
 * a difference in how the test was written.
 */
async function probeUserscript(contextOptions, label) {
  let context;
  try {
    context = await browser.newContext(contextOptions);
  } catch (err) {
    // Some engine/config combinations reject parts of a device descriptor.
    // Retry with the emulation flags stripped rather than failing outright —
    // the user agent and viewport are the parts that actually matter here.
    const { isMobile, hasTouch, ...rest } = contextOptions || {};
    console.log(`      ${label}: descriptor rejected (${err.message.split('\n')[0]}); retrying without emulation flags`);
    context = await browser.newContext(rest);
  }

  // Init scripts run in the order added, ahead of the page's own scripts —
  // which is how a userscript's `@run-at document-start` behaves.
  //
  // 1. Capture pushState BEFORE the engine patches it. This is the isolated-world
  //    case: a navigation the engine cannot possibly have intercepted. If the
  //    engine only relied on patching history, this test would fail.
  await context.addInitScript(() => {
    window.__rawPushState = window.history.pushState.bind(window.history);
  });
  // 2. Keep it in-place so the page does not navigate away mid-assertion.
  await context.addInitScript(() => {
    window.IGFocusConfigOverride = { enforceRedirect: false };
  });
  // 3. The actual artifact — the file you would install on the phone.
  await context.addInitScript({ path: USERSCRIPT });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto(bareBase + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.IGFocus, null, { timeout: 5000 });

  const report = await page.evaluate(() => {
    const display = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).display : 'MISSING';
    };
    return {
      version: window.IGFocus.version,
      status: window.IGFocus.status(),
      configLoaded: typeof window.IGFocusConfig === 'object',
      routesLoaded: typeof window.IGFocusRoutes === 'object',
      selectorsLoaded: typeof window.IGFocusSelectors === 'object',
      reelsNav: display('a[href="/reels/"]'),
      exploreNav: display('a[href="/explore/"]'),
      searchNav: display('a[href^="/explore/search"]'),
      messagesNav: display('a[href="/direct/inbox/"]'),
      // The row, not the anchor. On the real site the anchor is only the label;
      // hiding it alone leaves an icon and a tappable row behind.
      reelsRow: display('[data-nav="reels"]'),
      exploreRow: display('[data-nav="explore"]'),
      searchRow: display('[data-nav="search"]'),
      messagesRow: display('[data-nav="inbox"]'),
      feed: display('main[role="main"]'),
      // What guard.css keys its chrome rules off. Read it here so a failure
      // says "the attribute is wrong" rather than "the CSS did not apply".
      hideAttr: document.documentElement.getAttribute('data-igfocus-hide'),
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      hasTouch: 'ontouchstart' in window,
      userAgent: navigator.userAgent
    };
  });

  // The isolated-world case: an unpatchable route change, with no nudge.
  let afterReels;
  try {
    await page.evaluate(() => window.__rawPushState({}, '', '/reels/'));
    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-igfocus-route') === 'reels',
      null,
      { timeout: 3000 }
    );
    afterReels = await page.evaluate(() => ({
      route: document.documentElement.getAttribute('data-igfocus-route'),
      feed: getComputedStyle(document.querySelector('main[role="main"]')).display
    }));
  } catch (err) {
    afterReels = { error: err.message.split('\n')[0] };
  }

  // Search, and whether switching a toggle off actually gives anything back.
  //
  // The reversibility half is a regression guard with a specific history: the
  // Reels entry used to be hidden by an unconditional CSS rule AND stamped by
  // the engine with an attribute nothing ever removed, so "Hide Reels" could
  // only ever be switched one way. Both layers now follow the config.
  //
  // Deliberately no page reload anywhere in here. A fresh DOM would hide the
  // bug, because re-rendering builds unhidden nav rows from scratch.
  let search = null;
  let reversibility = null;
  try {
    await page.evaluate(() => {
      window.IGFocus.setConfig({ blockSearch: false });
      window.__rawPushState({}, '', '/explore/search/keyword/?q=cats');
    });
    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-igfocus-route') === 'search',
      null,
      { timeout: 3000 }
    );
    search = await page.evaluate(() => {
      const display = (sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).display : 'MISSING';
      };
      return {
        surface: window.IGFocus.status().surface,
        main: display('main[role="main"]'),
        grid: display('main[role="main"] [role="tabpanel"]'),
        accounts: display('main[role="main"] [role="group"]'),
        hideAttr: document.documentElement.getAttribute('data-igfocus-hide')
      };
    });

    reversibility = await page.evaluate(() => {
      const display = (sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).display : 'MISSING';
      };
      const snap = () => ({
        anchor: display('a[href="/reels/"]'),
        row: display('[data-nav="reels"]'),
        hideAttr: document.documentElement.getAttribute('data-igfocus-hide')
      });
      window.IGFocus.setConfig({ blockReels: false });
      const off = snap();
      window.IGFocus.setConfig({ blockReels: true, blockSearch: true });
      const on = snap();
      return { off, on };
    });
  } catch (err) {
    search = { error: err.message.split('\n')[0] };
  }

  await context.close();
  return { label, report, afterReels, search, reversibility, errors };
}

/**
 * The invariants, asserted in one place so every profile is held to the same
 * standard. A profile that quietly skipped an assertion would be worse than no
 * profile at all.
 */
function assertUserscriptReport({ report, afterReels, search, reversibility, errors }, label) {
  assert.ok(
    report.configLoaded && report.routesLoaded && report.selectorsLoaded,
    `[${label}] engine modules did not load`
  );
  assert.equal(report.version, EXPECTED_VERSION, `[${label}] wrong engine version shipped`);
  assert.equal(report.status.surface, 'home', `[${label}] route misclassified on /`);
  assert.equal(report.status.blocked, true, `[${label}] the home feed was not blocked`);

  assert.equal(report.reelsNav, 'none', `[${label}] the Reels nav entry is still visible`);
  assert.equal(report.exploreNav, 'none', `[${label}] the Explore nav entry is still visible`);
  assert.equal(report.searchNav, 'none', `[${label}] the Search nav entry is still visible`);
  assert.notEqual(
    report.messagesNav,
    'none',
    `[${label}] Messages was hidden — this is the dangerous failure`
  );

  // The regression that reached the device: hiding the anchor left the row.
  assert.equal(report.reelsRow, 'none', `[${label}] the Reels nav ROW is still visible`);
  assert.equal(report.exploreRow, 'none', `[${label}] the Explore nav ROW is still visible`);
  assert.equal(report.searchRow, 'none', `[${label}] the Search nav ROW is still visible`);
  assert.notEqual(report.messagesRow, 'none', `[${label}] the Messages nav row was hidden`);

  assert.equal(report.feed, 'none', `[${label}] the feed was not hidden`);

  // guard.css follows this attribute. If it is missing, the stylesheet hides
  // nothing and only the engine's own pass is doing any work.
  assert.equal(
    report.hideAttr,
    'reels explore search',
    `[${label}] the chrome attribute guard.css keys off is wrong`
  );

  assert.ok(
    afterReels && !afterReels.error,
    `[${label}] unpatchable route change not detected: ${JSON.stringify(afterReels)}`
  );
  assert.equal(afterReels.route, 'reels', `[${label}] wrong route after the unpatchable change`);
  assert.equal(
    afterReels.feed,
    'none',
    `[${label}] the feed reappeared after an unpatchable route change`
  );

  // Search with `blockSearch` off: the route is allowed, the accounts and tabs
  // survive, and the endless grid does not.
  assert.ok(search && !search.error, `[${label}] search probe failed: ${JSON.stringify(search)}`);
  assert.equal(search.surface, 'search', `[${label}] search route misclassified`);
  assert.notEqual(search.main, 'none', `[${label}] search was emptied entirely`);
  assert.equal(search.grid, 'none', `[${label}] the search results grid is still visible`);
  assert.notEqual(
    search.accounts,
    'none',
    `[${label}] the account rows were hidden — search would be useless`
  );
  assert.equal(
    search.hideAttr,
    'reels explore',
    `[${label}] the chrome attribute did not follow the search toggle`
  );

  // And switching a toggle off has to actually give the entry back.
  assert.ok(
    reversibility && !reversibility.error,
    `[${label}] reversibility probe failed: ${JSON.stringify(reversibility)}`
  );
  assert.notEqual(
    reversibility.off.anchor,
    'none',
    `[${label}] switching Reels off left the nav entry hidden — a one-way setting`
  );
  assert.notEqual(
    reversibility.off.row,
    'none',
    `[${label}] switching Reels off left the nav ROW hidden`
  );
  assert.equal(
    reversibility.off.hideAttr,
    'explore',
    `[${label}] the chrome attribute did not drop reels`
  );
  assert.equal(
    reversibility.on.anchor,
    'none',
    `[${label}] switching Reels back on did not re-hide the nav entry`
  );
  assert.equal(
    reversibility.on.row,
    'none',
    `[${label}] switching Reels back on did not re-hide the nav row`
  );
  assert.equal(
    reversibility.on.hideAttr,
    'reels explore search',
    `[${label}] the chrome attribute was not restored`
  );

  assert.deepEqual(errors, [], `[${label}] the shipped script threw`);
}

before(async () => {
  if (NEEDS_PLAYWRIGHT) return;
  ensureBuilt();
  await startServers();
  browser = await webkit.launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
  if (bareServer) bareServer.close();
});

test('the engine passes its own harness under WebKit', { skip: NEEDS_PLAYWRIGHT }, async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto(base + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.IGFocus, null, { timeout: 5000 });

  const version = await page.evaluate(() => window.IGFocus.version);
  const engine = await page.evaluate(() => navigator.userAgent);

  const self = await page.evaluate(() => window.__igfocusSelfTest());
  assert.equal(
    self.failed,
    0,
    `self-test failures under WebKit: ${JSON.stringify(self.results.filter((r) => !r.pass))}`
  );
  assert.ok(self.passed >= 30, `expected at least 30 assertions, got ${self.passed}`);

  const spa = await page.evaluate(() => window.__igfocusSpaTest());
  assert.equal(
    spa.failed,
    0,
    `SPA failures under WebKit: ${JSON.stringify(spa.results.filter((r) => !r.pass))}`
  );

  assert.deepEqual(errors, [], 'the engine threw under WebKit');

  console.log(
    `      WebKit ${version}: ${self.passed}/${self.passed + self.failed} harness assertions, ` +
      `${spa.passed}/${spa.passed + spa.failed} SPA assertions`
  );
  console.log(`      ua: ${engine}`);

  await page.close();
});

test('the SHIPPED userscript works on a WebKit engine', { skip: NEEDS_PLAYWRIGHT }, async () => {
  const result = await probeUserscript({}, 'desktop');
  assertUserscriptReport(result, 'desktop');

  const { report } = result;
  console.log(
    `      shipped userscript v${report.version} under WebKit: reels=${report.reelsNav}, ` +
      `explore=${report.exploreNav}, messages=${report.messagesNav}, feed=${report.feed}; ` +
      `unpatchable route change detected`
  );
});

/**
 * The same artifact under real iPhone profiles.
 *
 * This is the point of the whole exercise: the phone gets a mobile user agent
 * and a ~393pt viewport, and Instagram ships a different layout to it than to a
 * desktop browser. If the filtering were viewport- or UA-dependent, it would
 * work here in desktop mode and fail on the device — which is the most expensive
 * possible place to find out.
 *
 * Three profiles, spanning a large modern phone and the smallest screen still
 * supported, so a layout that only breaks at one width is caught.
 */
test('iPhone device profiles get the same verdict as desktop', { skip: NEEDS_PLAYWRIGHT }, async () => {
  const profiles = ['iPhone 17 Pro Max', 'iPhone 17', 'iPhone SE (3rd gen)'];
  const results = [];

  for (const name of profiles) {
    const descriptor = devices[name];
    assert.ok(descriptor, `playwright has no device profile named ${name}`);
    const result = await probeUserscript(descriptor, name);
    assertUserscriptReport(result, name);
    results.push(result);

    const { report } = result;
    console.log(
      `      ${name}: ${report.viewport}, touch=${report.hasTouch}, ` +
        `reels=${report.reelsNav} explore=${report.exploreNav} ` +
        `messages=${report.messagesNav} feed=${report.feed}`
    );
    console.log(`        ua: ${report.userAgent}`);
  }

  // Every profile must reach the same conclusion. Divergence here would mean the
  // filtering depends on the device, which is exactly what must not happen.
  const verdicts = results.map((r) =>
    JSON.stringify({
      reels: r.report.reelsNav,
      explore: r.report.exploreNav,
      search: r.report.searchNav,
      messages: r.report.messagesNav,
      feed: r.report.feed,
      surface: r.report.status.surface,
      chrome: r.report.hideAttr
    })
  );
  assert.equal(
    new Set(verdicts).size,
    1,
    `profiles disagreed with each other: ${JSON.stringify(verdicts, null, 1)}`
  );
  assert.equal(
    verdicts[0],
    JSON.stringify({
      reels: 'none',
      explore: 'none',
      search: 'none',
      messages: 'block',
      feed: 'none',
      surface: 'home',
      chrome: 'reels explore search'
    }),
    'profiles agreed with each other but not with the expected verdict'
  );
});

test('WebKit and Chromium agree on the hidden nav entries', { skip: NEEDS_PLAYWRIGHT }, async () => {
  // A cross-engine check: if the CSS or the selector logic were engine-dependent,
  // this is where it would show up. Same input, two engines, same verdict.
  const { chromium } = await import('playwright');

  async function probe(browserType) {
    const context = await browserType.newContext();
    await context.addInitScript(() => {
      window.IGFocusConfigOverride = { enforceRedirect: false };
    });
    await context.addInitScript({ path: USERSCRIPT });
    const page = await context.newPage();
    await page.goto(bareBase + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.IGFocus, null, { timeout: 5000 });
    const result = await page.evaluate(() => {
      const display = (sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).display : 'MISSING';
      };
      return {
        reels: display('a[href="/reels/"]'),
        explore: display('a[href="/explore/"]'),
        search: display('a[href^="/explore/search"]'),
        messages: display('a[href="/direct/inbox/"]'),
        surface: window.IGFocus.status().surface,
        chrome: document.documentElement.getAttribute('data-igfocus-hide')
      };
    });
    await context.close();
    return result;
  }

  // `browser`, not `webkit`: the module has no newContext(), the launched
  // browser does.
  const webkitResult = await probe(browser);

  let chromiumResult = null;
  let chromiumError = null;
  try {
    const chromiumBrowser = await chromium.launch();
    chromiumResult = await probe(chromiumBrowser);
    await chromiumBrowser.close();
  } catch (err) {
    // Chromium binaries are not installed. This test is a bonus, not a gate.
    chromiumError = err.message;
  }

  assert.deepEqual(webkitResult, {
    reels: 'none',
    explore: 'none',
    search: 'none',
    messages: 'block',
    surface: 'home',
    chrome: 'reels explore search'
  });

  if (chromiumError) {
    console.log(`      chromium unavailable, WebKit-only result: ${JSON.stringify(webkitResult)}`);
  } else {
    assert.deepEqual(chromiumResult, webkitResult, 'the engines disagree — the fix is engine-specific');
    console.log(`      both engines agree: ${JSON.stringify(webkitResult)}`);
  }
});
