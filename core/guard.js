/**
 * Instagram Focus — the blocking engine.
 *
 * Injected at documentStart (WKUserScript on iOS, a content script in a browser
 * extension, or a userscript on the desktop). It is deliberately dependency-free
 * and idempotent: `handleRoute()` can be called as often as you like.
 *
 * Responsibilities, in the order they matter:
 *   1. Redirect blocked routes to the landing path (DMs) as early as possible.
 *   2. Remove the Reels / Explore chrome on every page.
 *   3. When redirection is off, empty the blocked surface in place and say so.
 *   4. Keep doing all of that as Instagram's SPA navigates without reloading.
 *
 * What it must NEVER do is break messaging. Every destructive action goes
 * through `hide()`, which refuses to touch anything inside a safe harbour, and
 * the feed/reels containers are only ever emptied while the current route is
 * actually blocked.
 */
(function (root) {
  'use strict';

  // Also loaded by Node's build script; there is nothing to do without a DOM.
  if (!root || !root.document || !root.location) return;

  var Config = root.IGFocusConfig;
  var Routes = root.IGFocusRoutes;
  var Sel = root.IGFocusSelectors;
  if (!Config || !Routes || !Sel) return;

  // Kept in step with package.json by scripts/build.mjs, which fails the build
  // if the two drift — a version you cannot trust is worse than none.
  var VERSION = '1.0.5';
  var isMainFrame = root.top === root;

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  /** localStorage throws in some privacy modes; a missing store is fine. */
  function safeStorage() {
    try {
      var s = root.localStorage;
      if (!s) return null;
      s.getItem(Config.STORAGE_KEY); // touch it — Safari throws on first access
      return s;
    } catch (err) {
      return null;
    }
  }

  var storage = safeStorage();

  /**
   * `IGFocusConfigOverride` is injected by the iOS shell from UserDefaults, so
   * the native settings screen always beats whatever is cached in localStorage.
   */
  var config = Config.resolve(storage, root.IGFocusConfigOverride || null);

  function log() {
    if (!config.debug) return;
    try {
      var args = ['[igfocus]'].concat(Array.prototype.slice.call(arguments));
      (root.console && root.console.info ? root.console.info : root.console.log).apply(root.console, args);
    } catch (err) {
      /* logging must never break the page */
    }
  }

  function copyConfig() {
    return Config.merge(config, null);
  }

  // ---------------------------------------------------------------------------
  // Hiding primitives
  // ---------------------------------------------------------------------------

  /**
   * Would hiding this element risk locking the user out of messaging?
   * Checked via `closest`, so an ancestor match also protects the node.
   */
  function isInSafeHarbor(el) {
    if (!el || typeof el.closest !== 'function') return false;
    for (var i = 0; i < Sel.SAFE_HARBORS.length; i++) {
      try {
        if (el.closest(Sel.SAFE_HARBORS[i])) return true;
      } catch (err) {
        /* unsupported selector — skip it rather than throw */
      }
    }
    return false;
  }

  /**
   * Two kinds of hiding, and the distinction is critical.
   *
   * PERSISTENT — chrome that is never wanted (the Reels and Explore nav links).
   *   Applied on every route and never undone.
   *
   * ROUTE — the feed, the Reels viewer, suggested carousels, the search grid.
   *   Recomputed from scratch on every route change, because these surfaces
   *   share containers with the parts of the app that must keep working. This is
   *   what stops "hide the feed once" from turning Messages into a blank page.
   */
  var HIDE_PERSISTENT = '1';
  var HIDE_ROUTE = 'route';

  /**
   * Stamp the element as hidden. We set an attribute instead of writing inline
   * styles so that guard.css owns the presentation, and so repeated calls are
   * free. Returns true if the element is hidden afterwards.
   *
   * Note this also makes the change invisible to our own MutationObserver,
   * which only watches childList — so hiding cannot trigger a re-scan loop.
   */
  function hide(el, scope) {
    if (!el || typeof el.setAttribute !== 'function') return false;
    if (isInSafeHarbor(el)) return false;

    var want = scope || HIDE_PERSISTENT;
    var current = el.getAttribute(Sel.HIDDEN_ATTR);
    if (current === want) return true;
    // Never downgrade: something permanently gone should not come back just
    // because a route asked for a weaker kind of hiding.
    if (current === HIDE_PERSISTENT) return true;

    el.setAttribute(Sel.HIDDEN_ATTR, want);
    return true;
  }

  /** `querySelectorAll` that never throws on a selector the engine rejects. */
  function queryAll(selector) {
    try {
      return document.querySelectorAll(selector);
    } catch (err) {
      return [];
    }
  }

  /** Hide everything matching any selector. Returns how many nodes were hit. */
  function hideMatching(selectors, scope) {
    var count = 0;
    for (var i = 0; i < selectors.length; i++) {
      // A selector Chrome/WebKit rejects must not abort the whole run.
      var nodes = queryAll(selectors[i]);
      for (var j = 0; j < nodes.length; j++) {
        if (hide(nodes[j], scope)) count++;
      }
    }
    return count;
  }

  /**
   * Does this element contain at most one link?
   *
   * Used to find the edge of a nav row. A child count would not work: the real
   * row holds an icon, the label anchor and sometimes a duplicate label, so it
   * has several children. What makes it "one row" is that it holds exactly one
   * link; what makes its parent "the nav container" is that it holds several.
   */
  function containsAtMostOneAnchor(el) {
    try {
      return el.querySelectorAll('a').length <= 1;
    } catch (err) {
      return false;
    }
  }

  /**
   * Follow a nav anchor up to the row that owns it.
   *
   * The real site has no <nav>: the Reels entry is a bare <a href="/reels/">
   * buried in a chain of <div>s. Hiding the anchor alone removes the label and
   * leaves the icon and the row's tappable height on screen — which is exactly
   * what shipped. So we climb while the parent still contains only this one
   * link, and stop at the first ancestor that holds others (the tab bar or
   * sidebar). Bounded by NAV_ITEM_MAX_HOPS, and it refuses to hand back the page
   * furniture itself, so a selector that happened to match a lone link in the
   * middle of a page cannot take out <main>.
   *
   * @returns {Element|null} the row, or null when the anchor already is the row.
   */
  function navRowFor(anchor) {
    if (!anchor || !anchor.parentElement) return null;

    var node = anchor;
    var hops = Sel.NAV_ITEM_MAX_HOPS || 8;

    while (hops-- > 0) {
      var parent = node.parentElement;
      if (!parent) break;
      var tag = parent.tagName;
      if (tag === 'BODY' || tag === 'HTML' || tag === 'MAIN' || tag === 'SECTION' || tag === 'ARTICLE') break;
      if (!containsAtMostOneAnchor(parent)) break;
      node = parent;
    }

    return node === anchor ? null : node;
  }

  /**
   * Release persistent chrome that is no longer wanted.
   *
   * Chrome is the one thing that has to be *un*-hideable. Route-scoped hiding
   * is recomputed from scratch every pass, so it cannot get stuck; chrome used
   * to be hidden once and never revisited, which made the Settings toggles
   * one-way — switching "Hide Reels" off left the entry gone until the app was
   * relaunched, because the attribute was already stamped and nothing took it
   * back.
   *
   * Chrome is therefore treated as a pure function of the config: work out
   * everything that should be hidden right now, then release anything stamped
   * persistent that is not in that list.
   */
  function revealPersistentExcept(wanted) {
    var nodes = queryAll('[' + Sel.HIDDEN_ATTR + '="' + HIDE_PERSISTENT + '"]');
    for (var i = 0; i < nodes.length; i++) {
      if (wanted.indexOf(nodes[i]) === -1) nodes[i].removeAttribute(Sel.HIDDEN_ATTR);
    }
  }

  /**
   * Undo route-scoped hiding. Called at the start of every route evaluation so
   * each pass decides from a clean slate; persistent chrome is left alone.
   */
  function revealRouteScoped() {
    var nodes;
    try {
      nodes = document.querySelectorAll('[' + Sel.HIDDEN_ATTR + '="' + HIDE_ROUTE + '"]');
    } catch (err) {
      return;
    }
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].removeAttribute(Sel.HIDDEN_ATTR);
    }
  }

  function matchesAnyText(text, needles) {
    var haystack = String(text).toLowerCase();
    for (var i = 0; i < needles.length; i++) {
      if (haystack === String(needles[i]).toLowerCase()) return true;
    }
    return false;
  }

  /**
   * Walk up from a heading to the section it labels. Refuses to return `main`
   * or `body`, so a text trigger can never take out the whole page.
   */
  function climbToSection(el) {
    var node = el;
    var hops = Sel.MAX_ANCESTOR_HOPS || 7;
    while (node && hops-- > 0) {
      node = node.parentElement;
      if (!node) return null;
      var tag = node.tagName;
      if (tag === 'MAIN' || tag === 'BODY' || tag === 'HTML') return null;
      var role = node.getAttribute && node.getAttribute('role');
      if (tag === 'ARTICLE' || tag === 'SECTION' || role === 'group' || role === 'feed') return node;
    }
    return null;
  }

  /**
   * Remove "Suggested Reels" / "Suggested for you" carousels. Text matching is
   * the least precise tool we have, so it only runs on blocked routes — i.e.
   * never on your messages, where "Suggested" sections also appear.
   */
  function stripTextSections(surface) {
    if (surface === 'allowed') return 0;
    if (!config.stripSuggestedReels) return 0;

    var needles = Sel.TEXT_TRIGGERS.suggestedReels;
    var candidates;
    try {
      candidates = document.querySelectorAll('span, h1, h2, h3, div[role="heading"]');
    } catch (err) {
      return 0;
    }

    var removed = 0;
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (el.children && el.children.length) continue; // leaf text only
      var text = (el.textContent || '').trim();
      if (!text || text.length > 60) continue;
      if (!matchesAnyText(text, needles)) continue;
      var section = climbToSection(el);
      if (section && hide(section, HIDE_ROUTE)) removed++;
    }
    return removed;
  }

  /**
   * Everything a blocked route needs: no feed, no autoplaying video, and a
   * brief explanation of what just happened.
   */
  function clearBlockedSurface(surface) {
    // Only ever called for a blocked route. `search` is not special-cased here:
    // when search is blocked it must be emptied like any other blocked route,
    // and when it is allowed this function is never reached at all.
    if (surface === 'allowed') return;
    hideMatching(Sel.FEED_ROOTS, HIDE_ROUTE);
    if (config.blockReels) {
      pauseVideos();
      if (surface === 'reels' || surface === 'profile-reels') hideMatching(Sel.REELS_ROOTS, HIDE_ROUTE);
    }
    stripTextSections(surface);
    if (!config.enforceRedirect) showNotice();
  }

  /**
   * Pause rather than remove: ripping a <video> out of the tree is the kind of
   * thing that makes a React app throw, and pausing is enough to stop autoplay.
   */
  function pauseVideos() {
    var videos;
    try {
      videos = document.querySelectorAll(Sel.VIDEO.join(','));
    } catch (err) {
      return;
    }
    for (var i = 0; i < videos.length; i++) {
      var v = videos[i];
      try {
        if (!v.paused) v.pause();
      } catch (err) {
        /* not a media element yet — harmless */
      }
    }
  }

  var noticeShown = false;

  /** Shown only in in-place mode (redirection switched off). */
  function showNotice() {
    if (noticeShown || document.querySelector('.igfocus-notice')) return;
    if (!document.body) return;
    noticeShown = true;

    var box = document.createElement('div');
    box.className = 'igfocus-notice';
    box.setAttribute('role', 'status');
    box.style.position = 'fixed';
    box.style.top = '12px';
    box.style.left = '50%';
    box.style.transform = 'translateX(-50%)';
    box.style.zIndex = '2147483647';

    var title = document.createElement('h2');
    title.textContent = 'Feed hidden';
    var body = document.createElement('p');
    body.textContent = 'Reels and the home feed are switched off. Messages and profiles still work.';

    box.appendChild(title);
    box.appendChild(body);
    document.body.appendChild(box);
  }

  /** The notice is route-scoped too: it must disappear once you are in DMs. */
  function removeNotice() {
    var existing = document.querySelector('.igfocus-notice');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    noticeShown = false;
  }

  // ---------------------------------------------------------------------------
  // Route handling
  // ---------------------------------------------------------------------------

  /**
   * Loop guard.
   *
   * Records where we were when we asked for a redirect, not merely when. A
   * redirect is only suppressed if we are STILL at that exact URL within the
   * cooldown — i.e. the previous request visibly did not take effect.
   *
   * A time-only throttle is wrong: it silently swallows genuine moves. Tapping
   * Reels within 1.2s of opening the app is a real thing to do, and the earlier
   * version ignored the redirect entirely. Only in-place hiding covered for it,
   * which is luck rather than design.
   *
   * Self-clearing by construction: once the page moves, `lastRedirectFrom` no
   * longer matches and the next redirect is allowed immediately.
   */
  var lastRedirectAt = 0;
  var lastRedirectFrom = null;

  function setSurfaceAttr(surface) {
    var el = document.documentElement;
    if (!el || typeof el.setAttribute !== 'function') return;
    if (el.getAttribute(Sel.ROUTE_ATTR) !== surface) el.setAttribute(Sel.ROUTE_ATTR, surface);
  }

  /**
   * Publish the chrome decision to guard.css, so the stylesheet hides exactly
   * what the settings say and nothing more.
   *
   * Runs on every route pass, which is also how a settings change takes effect:
   * `IGFocus.setConfig()` re-runs `handleRoute()`, and the attribute is rewritten
   * here. Because the attribute is set before Instagram's own scripts have
   * rendered anything, there is no flash of chrome to trade off against this.
   */
  function setChromeAttr() {
    var el = document.documentElement;
    if (!el || typeof el.setAttribute !== 'function') return;

    var want = [];
    if (config.blockReels) want.push('reels');
    if (config.blockExplore) want.push('explore');
    if (config.blockSearch) want.push('search');

    var value = want.join(' ');
    if (el.getAttribute(Sel.CHROME_ATTR) !== value) el.setAttribute(Sel.CHROME_ATTR, value);
  }

  /**
   * Name the current surface. This drives both the `data-igfocus-route`
   * attribute in guard.css and the route-scoped half of `applyChrome`.
   *
   * The search surface is only named while the results grid is actually meant
   * to be hidden. Naming it unconditionally would let the stylesheet hide the
   * grid even after `blockSearchGrid` was switched off — the same one-way-rule
   * trap that the nav chrome used to be in. Keeping the name and the decision
   * together means they cannot disagree.
   */
  function surfaceFor(result) {
    if (result.blocked) return result.kind;
    if (config.blockSearchGrid && /^\/explore\/search(?:\/|$)/.test(result.path)) return 'search';
    return 'allowed';
  }

  /**
   * Redirect to the landing path (DMs by default).
   *
   * Loops are the one thing that can make this useless, so we check three
   * things before navigating: that the landing path is not itself blocked, that
   * we are not already there, and that we have not just redirected.
   */
  function redirectToLanding(result) {
    var landing = config.landingPath || '/direct/inbox/';

    if (!Routes.isSafeLandingPath(landing, config)) {
      // Misconfigured (or the landing path got blocked). Never bounce forever:
      // give up on redirecting for this session and hide in place instead.
      config.enforceRedirect = false;
      log('landing path is itself blocked; falling back to in-place hiding');
      clearBlockedSurface(result.kind);
      return;
    }
    if (Routes.normalizePath(root.location.pathname) === Routes.normalizePath(landing)) return;

    var now = Date.now();
    var cooldown = config.redirectCooldownMs || 1200;
    var here = root.location.href;

    if (lastRedirectFrom === here && now - lastRedirectAt < cooldown) {
      log('redirect from', here, 'has not taken effect yet; not repeating it');
      return;
    }
    lastRedirectAt = now;
    lastRedirectFrom = here;

    log('redirecting', result.path, '->', landing);
    try {
      // replace, not assign: a blocked page should not be in the back stack,
      // or the back button becomes a way to reach the feed again.
      // `IGFocusNavigate` is a seam for the offline fixture and the tests, which
      // need to observe redirects without actually leaving the page.
      if (typeof root.IGFocusNavigate === 'function') {
        root.IGFocusNavigate(landing);
      } else {
        root.location.replace(landing);
      }
    } catch (err) {
      log('redirect failed', err);
    }
  }

  /** Chrome that is removed on every page, blocked or not. */
  function applyChrome(surface) {
    var wanted = [];
    var groups = [];
    if (config.blockReels) groups.push(Sel.REELS_NAV);
    if (config.blockExplore) groups.push(Sel.EXPLORE_NAV);
    if (config.blockSearch) groups.push(Sel.SEARCH_NAV);
    if (config.blockStoriesTray) groups.push(Sel.STORIES_TRAY);

    for (var g = 0; g < groups.length; g++) {
      for (var s = 0; s < groups[g].length; s++) {
        var nodes = queryAll(groups[g][s]);
        for (var n = 0; n < nodes.length; n++) {
          var anchor = nodes[n];
          if (wanted.indexOf(anchor) === -1) wanted.push(anchor);
          // Nav chrome is hidden as anchor + owning row, never anchor alone —
          // see navRowFor() for why the real site makes that necessary.
          var row = navRowFor(anchor);
          if (row && wanted.indexOf(row) === -1) wanted.push(row);
        }
      }
    }

    revealPersistentExcept(wanted);
    for (var i = 0; i < wanted.length; i++) hide(wanted[i], HIDE_PERSISTENT);

    // `surfaceFor` only names the search surface while the grid is actually
    // meant to go, so this needs no config check of its own.
    if (surface === 'search') hideMatching(Sel.SEARCH_GRID, HIDE_ROUTE);
  }

  /** The single entry point. Safe to call as often as you like. */
  function handleRoute() {
    var result = Routes.classifyRoute(root.location.pathname, config);
    var surface = surfaceFor(result);
    setChromeAttr();
    setSurfaceAttr(surface);

    log(result.path, '->', surface, result.blocked ? '(blocked: ' + result.reason + ')' : '(allowed)');

    // Undo the previous pass's route-scoped hiding BEFORE deciding this pass's.
    // Instagram reuses its main container across routes, so without this,
    // hiding the feed on `/` leaves that same container hidden on
    // `/direct/inbox/` — a blank Messages page. Reveal and re-hide happen in
    // the same synchronous pass, so nothing ever paints in between.
    revealRouteScoped();

    if (result.blocked) {
      // Hide FIRST, unconditionally — then redirect.
      //
      // Hiding used to happen only when redirection was switched off, so a
      // redirect that failed to fire left the feed completely visible. That is
      // exactly what happened on iOS Safari: the route change was never seen,
      // so nothing was hidden and the feed simply stayed on screen. Hiding and
      // redirecting are now independent, so the surface is emptied even if the
      // navigation is suppressed by the loop guard, arrives late, or is
      // swallowed by the page's own router.
      clearBlockedSurface(result.kind);
      if (config.enforceRedirect && isMainFrame) redirectToLanding(result);
    } else {
      removeNotice();
    }

    applyChrome(surface);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Watching for changes
  // ---------------------------------------------------------------------------

  var scheduled = false;

  function raf(fn) {
    if (typeof root.requestAnimationFrame === 'function') return root.requestAnimationFrame(fn);
    return root.setTimeout(fn, 16);
  }

  /**
   * Coalesce every trigger (DOM mutation, popstate, pushState) into at most one
   * `handleRoute()` per frame. Instagram mutates the DOM constantly while you
   * type or scroll, so this is what keeps the engine cheap.
   */
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    raf(function () {
      scheduled = false;
      handleRoute();
    });
  }

  /**
   * Instagram is a SPA: clicking a link usually calls pushState rather than
   * loading a document, so no navigation event ever fires. Wrapping the history
   * API is the only way to catch those route changes in time.
   */
  function wrapHistory(method) {
    var history = root.history;
    if (!history || typeof history[method] !== 'function') return;
    var original = history[method];
    history[method] = function () {
      var ret = original.apply(this, arguments);
      schedule();
      return ret;
    };
  }

  var lastKnownHref = null;

  /**
   * World-agnostic route detection — the fix for the iOS Safari failure.
   *
   * `wrapHistory` below only works when we share a JavaScript world with
   * Instagram's own code. Under a Safari web extension, or a userscript manager
   * that injects into an isolated world, our patched `pushState` is a *different
   * object* from the one the page calls: the patch installs successfully, does
   * nothing, and reports no error. The app then navigates to the feed with no
   * event we can hear.
   *
   * Polling `location` cannot be bypassed by any of that, and neither can it be
   * defeated by the page capturing `history.pushState` before we load. It is one
   * string comparison every 250ms, which is far beneath noticing.
   */
  function pollRoute() {
    var href = root.location.pathname + root.location.search;
    if (href === lastKnownHref) return;
    lastKnownHref = href;
    log('url changed ->', href);
    handleRoute();
  }

  function startObservers() {
    // The history patch is a fast path, kept because it reacts within the same
    // frame when it does work.
    wrapHistory('pushState');
    wrapHistory('replaceState');
    root.addEventListener('popstate', schedule);
    root.addEventListener('hashchange', schedule);
    root.addEventListener('focus', schedule);
    document.addEventListener('visibilitychange', schedule);

    // Poll for route changes. This is the reliable path.
    lastKnownHref = root.location.pathname + root.location.search;
    root.setInterval(pollRoute, 250);

    if (root.MutationObserver) {
      // Observe `document`, NOT `document.documentElement`.
      //
      // At document-start the <html> element does not exist yet, and the old
      // code checked for it and then silently gave up — leaving DOM changes
      // unwatched for the entire session, with no error to show for it.
      // `document` always exists, and observing it with `subtree` also picks up
      // documentElement itself appearing later.
      //
      // childList only: watching attributes would re-trigger our own hiding.
      var observer = new root.MutationObserver(schedule);
      observer.observe(document, { childList: true, subtree: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Public API — also what makes the on-device checklist testable
  // ---------------------------------------------------------------------------

  var IGFocus = {
    version: VERSION,

    /** Exposed so the harness can simulate an unpatchable route change. */
    handleRoute: handleRoute,

    /** A copy, so callers cannot mutate engine state by accident. */
    getConfig: copyConfig,

    /**
     * Merge + persist a partial config and re-apply.
     *
     * The injected override is passed back in so it survives the write: the
     * native settings screen must keep winning, and a caller patching one key
     * must not reset every other key it did not mention.
     */
    setConfig: function (partial) {
      config = Config.save(storage, partial, root.IGFocusConfigOverride || null);
      log('config updated', config);
      handleRoute();
      return copyConfig();
    },

    /** Where are we, and what does the engine think about it? */
    status: function () {
      var result = Routes.classifyRoute(root.location.pathname, config);
      var docEl = document.documentElement;
      return {
        version: VERSION,
        path: result.path,
        kind: result.kind,
        surface: docEl ? docEl.getAttribute(Sel.ROUTE_ATTR) : null,
        blocked: result.blocked,
        reason: result.reason,
        hiddenCount: document.querySelectorAll('[' + Sel.HIDDEN_ATTR + '="1"]').length,
        enforceRedirect: config.enforceRedirect
      };
    },

    /** Force a full re-scan. Returns the resulting status. */
    scan: function () {
      handleRoute();
      return IGFocus.status();
    },

    classify: Routes.classifyRoute
  };

  root.IGFocus = IGFocus;

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  // Run immediately: at documentStart this is the earliest possible moment to
  // redirect, and it means a blocked page never renders.
  handleRoute();

  function onReady() {
    startObservers();
    handleRoute();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
