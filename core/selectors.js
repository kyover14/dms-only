/**
 * Instagram Focus — DOM selector map.
 *
 * ============================ THE FILE TO TUNE ============================
 * When Instagram changes its markup, this is (almost always) the only file that
 * needs editing. Keep every selector here so `core/guard.js` stays dumb.
 *
 * Selector strategy, in order of preference:
 *   1. `href` values. Instagram has kept `/reels/`, `/explore/` and `/direct/`
 *      stable for years, and they are the cheapest thing to match on.
 *   2. ARIA roles and labels. Present for accessibility, and therefore far more
 *      stable than the obfuscated, build-hashed class names.
 *   3. Structural selectors (`main[role="main"]`, `article`).
 *   4. Text content, matched in JS and walked up to a bounded ancestor. Used
 *      only for section headings like "Suggested Reels", never for chrome.
 * NEVER class names: Instagram's are hashed and change on every deploy.
 *
 * Safety rule enforced by the engine, not by these selectors: the feed/reels
 * containers below are only emptied when the CURRENT ROUTE IS BLOCKED. That is
 * why `main[role="main"]` can be listed here at all — on `/direct/…` it holds
 * your messages and must never be touched.
 * ==========================================================================
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else if (root) {
    root.IGFocusSelectors = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  return {
    /**
     * Nav entries removed on every page, regardless of route.
     *
     * These match the ANCHOR. Hiding the anchor alone is not enough on the real
     * site: the nav row is a plain <div> that also holds the icon (and, on a
     * collapsed sidebar, a duplicate label), so hiding only the <a> leaves a
     * visible — and tappable — row behind. `guard.js` therefore follows each
     * anchor up to its row (bounded by NAV_ITEM_MAX_HOPS) and hides that too.
     *
     * The `nav …` and `[role="navigation"] …` entries are kept as harmless
     * extras, but do NOT rely on them. Measured on the signed-in site
     * (2026-09-30):
     *   * there is no <nav> element anywhere (`navTags: 0`); and
     *   * the only [role="navigation"] element is the DM "Thread list" panel,
     *     which contains zero anchors.
     * So both of those selectors match nothing in production. The href entries
     * are the ones doing the work.
     */
    REELS_NAV: [
      'a[href="/reels/"]',
      'a[href="/reels"]',
      'nav a[href^="/reels/"]',
      '[role="navigation"] a[href^="/reels/"]'
    ],

    EXPLORE_NAV: [
      'a[href="/explore/"]',
      'a[href="/explore"]',
      'nav a[href^="/explore/"]',
      '[role="navigation"] a[href^="/explore/"]'
    ],

    /**
     * The Search entry, removed only while `blockSearch` is on.
     *
     * Which href it uses is NOT measured yet: the live navigation showed exactly
     * one `/explore/` anchor and no separate `/explore/search/` one, so on the
     * build that was measured this matches nothing and `EXPLORE_NAV` is doing
     * the work. Both are listed because which href Instagram ships has flipped
     * between builds before, and a duplicate entry costs nothing.
     */
    SEARCH_NAV: [
      'a[href^="/explore/search"]',
      'nav a[href^="/explore/search"]',
      '[role="navigation"] a[href^="/explore/search"]'
    ],

    /**
     * How far up from a nav anchor to look for the row that owns it.
     *
     * The real site has no semantic wrapper to aim at, so the engine climbs
     * while the parent still contains no OTHER link, stopping at the first
     * ancestor that holds several (the nav container: a 6-item bottom tab bar on
     * mobile, a 7-item sidebar on desktop). This bound stops a selector that
     * somehow matches a lone link in the middle of the page from walking up into
     * the page furniture.
     */
    NAV_ITEM_MAX_HOPS: 8,

    /**
     * Containers that hold the endless feed. Only used while on a blocked
     * route, and only as a backstop when redirection is disabled.
     */
    FEED_ROOTS: [
      'main[role="main"]'
    ],

    /** Individual feed posts, used to count/replace the feed. */
    POSTS: [
      'main[role="main"] article',
      'article'
    ],

    /** Full-screen Reels viewer. */
    REELS_ROOTS: [
      'div[role="dialog"]',
      'main[role="main"]'
    ],

    /**
     * The results grid on search, the only part of search we hide.
     *
     * Deliberately does NOT include `[role="group"]`: that role also marks the
     * accounts list, and hiding it would turn search off completely instead of
     * leaving you the accounts. We hide the results panel and keep the tabs and
     * the account rows, so searching for a person still works.
     *
     * This is the most likely selector in the file to need tuning against the
     * live DOM — see core/guard.css for the matching route-scoped rule.
     */
    SEARCH_GRID: [
      'main[role="main"] div[role="tabpanel"]'
    ],

    /** Stories tray / rail above the feed. */
    STORIES_TRAY: [
      'main[role="main"] ul',
      '[role="list"] [role="listitem"] a[href^="/stories/"]'
    ],

    /** Anything that can autoplay. Paused (never removed) on blocked routes. */
    VIDEO: [
      'video'
    ],

    /**
     * Elements we must never hide. Checked as "is this node, or an ancestor of
     * it, inside a safe harbour?" before anything is removed — so a sloppy
     * selector can annoy you but cannot lock you out of your messages.
     */
    SAFE_HARBORS: [
      '[href^="/direct/"]',
      'form',
      'input',
      'textarea',
      'div[role="dialog"] [contenteditable]'
    ],

    /**
     * Text triggers for section headings that have no stable selector. Matched
     * case-insensitively against an element's trimmed text content, then walked
     * up at most `MAX_ANCESTOR_HOPS` levels to find the section to remove.
     */
    TEXT_TRIGGERS: {
      suggestedReels: ['Suggested Reels', 'Suggested for you'],
      explore: ['Explore'],
      reels: ['Reels']
    },

    /** How far up the tree a text trigger may walk before giving up. */
    MAX_ANCESTOR_HOPS: 7,

    /** Attribute stamped on anything the engine hides; guard.css styles it. */
    HIDDEN_ATTR: 'data-igfocus-hidden',

    /** Attribute stamped on <html> with the current route kind. */
    ROUTE_ATTR: 'data-igfocus-route',

    /**
     * Attribute stamped on <html> listing the chrome guard.css should hide,
     * e.g. `"reels explore search"`.
     *
     * This exists so the settings are reversible. `guard.css` cannot read the
     * config, so hiding the Reels nav entry in pure CSS used to mean it stayed
     * hidden even after "Hide Reels" was switched off — the CSS beats any
     * JavaScript attempt to undo it. The engine now publishes the decision here
     * and the stylesheet follows it, which costs nothing: the nav is rendered by
     * Instagram's own scripts, long after this is set.
     */
    CHROME_ATTR: 'data-igfocus-hide',

    /**
     * TUNING LOG
     * Keep a short note per change: what Instagram broke, and what fixed it.
     *   2026-09-30  Initial best-effort map. hrefs + roles only. Verified
     *               against the offline fixture; NOT yet verified against the
     *               live DOM (that is Phase 2, see docs/INSTALL-iOS.md).
     *   2026-09-30  Dropped `[role="group"]` from SEARCH_GRID after noticing
     *               the accounts list uses the same role. Hiding it would have
     *               killed search rather than just the grid.
     *   2026-09-30  Measured the signed-in DOM (incognito, desktop 1400x900 and
     *               mobile 513x799). Findings, all of which contradicted the
     *               initial map:
     *                 * no <nav> element exists;
     *                 * the only [role="navigation"] is the DM "Thread list"
     *                   panel and it has zero anchors;
     *                 * the Reels/Explore/Home/Inbox/Profile entries are bare
     *                   <a href="…"> with role="link", inside a chain of
     *                   <div>s — a 6-item bottom bar on mobile, a 7-item
     *                   sidebar on desktop.
     *               Consequence: hiding the <a> hid only the label text and left
     *               the row's icon and its 48px of tappable height on screen.
     *               Fix: `guard.js` climbs from each anchor to the row that owns
     *               it and hides both; NAV_ITEM_ANCESTORS (semantic tag guessing)
     *               was deleted as dead weight, replaced by NAV_ITEM_MAX_HOPS.
     *               The fixture and bare.html were reshaped to match — they had
     *               a <nav>, which is precisely why the tests passed while the
     *               device did not.
     *   2026-10-05  Search is now a blocked ROUTE (was: allowed, with only its
     *               results grid hidden). It is the same one-tap discovery
     *               surface as home and Reels, so leaving the route open made
     *               the app inconsistent. `blockSearchGrid` survives for the
     *               case where the route toggle is switched back off, and
     *               SEARCH_NAV is hidden alongside the other chrome.
     *   2026-10-05  Chrome hiding moved from unconditional CSS to CSS keyed off
     *               CHROME_ATTR. Reason: the old rules made the Settings toggles
     *               one-way — switching "Hide Reels" off could not bring the nav
     *               entry back, because a stylesheet outranks the engine. The
     *               equivalent global rules were dropped from rules.json for the
     *               same reason.
     */
    TUNING_LOG: []
  };
});
