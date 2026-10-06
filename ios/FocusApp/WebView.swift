import SwiftUI
import UIKit
import WebKit

/// The app's one and only web view.
///
/// Three filtering layers, in the order they take effect:
///   1. `WKNavigationDelegate` — refuses blocked navigations before they load.
///   2. `WKContentRuleList`    — declarative, URL-scoped hiding at first paint.
///   3. `WKUserScript`         — the shared JS engine, handling SPA route
///      changes and re-renders that never touch the network at all.
///
/// Layer 3 is literally `core/guard.js`, the same file the offline fixture and
/// the browser extension run.
struct WebView: UIViewRepresentable {
    @ObservedObject var settings: SettingsStore
    @ObservedObject var browser: BrowserModel

    func makeCoordinator() -> Coordinator {
        Coordinator(settings: settings, browser: browser)
    }

    func makeUIView(context: Context) -> WKWebView {
        let controller = WKUserContentController()

        // 1. The config override must exist before guard.js reads it, so it is
        //    injected first. JSON is a subset of a JavaScript object literal.
        controller.addUserScript(
            WKUserScript(
                source: "window.IGFocusConfigOverride = \(settings.overrideJSON);",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )

        // 2. guard.css as a <style> element at document start. The content rule
        //    list covers URL-scoped hiding; this covers the route-attribute
        //    rules and keeps working if the rule list ever fails to compile.
        if let css = WebView.readResource("guard", ext: "css") {
            controller.addUserScript(
                WKUserScript(
                    source: WebView.styleBootstrapScript(css: css),
                    injectionTime: .atDocumentStart,
                    forMainFrameOnly: true
                )
            )
        }

        // 3. The engine, in its required order. guard.js consumes the other
        //    three, and WKUserScript ordering is deterministic.
        for name in ["config", "routes", "selectors", "guard"] {
            guard let source = WebView.readResource(name, ext: "js") else {
                NSLog("[InstagramFocus] missing bundled script: \(name).js")
                continue
            }
            controller.addUserScript(
                WKUserScript(
                    source: source,
                    injectionTime: .atDocumentStart,
                    // Frames never own the route; only the top document does.
                    forMainFrameOnly: true
                )
            )
        }

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        // The default data store is persistent, so the login survives relaunch.
        // A non-persistent one would mean signing in every single launch.
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        // Present a full mobile Safari user agent. Instagram is considerably
        // more willing to serve a real session — and to accept a sign-in — when
        // the client does not look like a bare embedded browser.
        configuration.applicationNameForUserAgent = "Version/18.0 Mobile/15E148 Safari/604.1"

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        context.coordinator.attach(webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Settings changed: push them into the running page. No reload needed.
        context.coordinator.syncSettings()
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    /// Read a file the build script copied into the app bundle.
    static func readResource(_ name: String, ext: String) -> String? {
        guard let url = Bundle.main.url(forResource: name, withExtension: ext) else {
            NSLog("[InstagramFocus] bundled resource missing: \(name).\(ext)")
            return nil
        }
        return try? String(contentsOf: url, encoding: .utf8)
    }

    /// Wrap a CSS string in a small script that installs it as a <style>.
    ///
    /// `encoding: .utf8` above can in principle fail and yield nil; the guard
    /// here means a broken stylesheet degrades to "no CSS" rather than a script
    /// that throws on every page.
    static func styleBootstrapScript(css: String) -> String {
        """
        (function () {
          'use strict';
          var css = \(jsStringLiteral(css));
          function inject() {
            if (document.getElementById('igfocus-style')) return;
            var style = document.createElement('style');
            style.id = 'igfocus-style';
            style.textContent = css;
            var host = document.head || document.documentElement;
            if (host) host.appendChild(style);
          }
          inject();
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', inject, { once: true });
          }
        })();
        """
    }

    /// Produce a correctly escaped JavaScript string literal.
    ///
    /// Round-tripping through `JSONSerialization` is the trick: a one-element
    /// JSON array renders as `["…"]`, and stripping the brackets leaves a
    /// properly escaped JS string — quotes, newlines, backslashes and all. Doing
    /// this by hand is how CSS containing a quote silently breaks the page.
    static func jsStringLiteral(_ value: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [value], options: [])) ?? Data()
        let json = String(data: data, encoding: .utf8) ?? #"[""]"#
        return String(json.dropFirst().dropLast())
    }

    // ---------------------------------------------------------------------
    // Coordinator
    // ---------------------------------------------------------------------

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        private let settings: SettingsStore
        private let browser: BrowserModel
        private let guardRail = NavigationGuard()

        private weak var webView: WKWebView?
        private var lastAppliedConfig: String?

        /// Loop protection for automatic redirects. Without this, a landing path
        /// that is itself blocked would bounce forever.
        private var lastAutoRedirect: Date?
        private var consecutiveAutoRedirects = 0

        init(settings: SettingsStore, browser: BrowserModel) {
            self.settings = settings
            self.browser = browser
        }

        func attach(_ webView: WKWebView) {
            self.webView = webView
            browser.webView = webView
            lastAppliedConfig = settings.overrideJSON

            compileRuleList()
            loadLanding()
        }

        private func compileRuleList() {
            RuleListCompiler.compile { [weak self] list in
                guard let self = self, let list = list, let webView = self.webView else { return }
                webView.configuration.userContentController.add(list)
            }
        }

        private var landingURL: URL {
            BrowserModel.url(for: settings.landingPath)
        }

        private func loadLanding() {
            let now = Date()
            if let last = lastAutoRedirect, now.timeIntervalSince(last) < 1.5 {
                consecutiveAutoRedirects += 1
            } else {
                consecutiveAutoRedirects = 0
            }
            lastAutoRedirect = now

            if consecutiveAutoRedirects > 3 {
                NSLog("[InstagramFocus] redirect loop detected; using the safe default instead")
                consecutiveAutoRedirects = 0
                webView?.load(URLRequest(url: BrowserModel.fallbackURL))
                return
            }

            webView?.load(URLRequest(url: landingURL))
        }

        /// Push current settings into the live page without reloading it.
        func syncSettings() {
            let json = settings.overrideJSON
            guard json != lastAppliedConfig else { return }
            lastAppliedConfig = json

            let script = "window.IGFocus ? JSON.stringify(IGFocus.setConfig(\(json))) : null"
            webView?.evaluateJavaScript(script)
        }

        // -----------------------------------------------------------------
        // WKNavigationDelegate
        // -----------------------------------------------------------------

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }

            // Subframes are not routes; leave them alone.
            if let target = navigationAction.targetFrame, !target.isMainFrame {
                decisionHandler(.allow)
                return
            }

            guard url.scheme == "http" || url.scheme == "https" else {
                // instagram://, mailto:, tel:. A WKWebView cannot handle these
                // and would show an error page, so cancel quietly.
                decisionHandler(.cancel)
                return
            }

            guard let host = url.host, host == "instagram.com" || host.hasSuffix(".instagram.com") else {
                // A genuine link out to the wider web — Safari's job, not ours.
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            let path = NavigationGuard.path(from: url)
            // The closure is non-escaping, so no capture list is needed — and
            // `self.` is spelled out because a bare `settings` would not resolve
            // inside a capture list.
            let verdict = guardRail.verdict(for: path) { key in
                self.settings.isEnabled(key)
            }

            guard verdict.blocked else {
                decisionHandler(.allow)
                return
            }

            decisionHandler(.cancel)

            // If the blocked URL *is* the landing path, redirecting would just
            // reload the same page forever. Let the in-page engine handle it
            // instead, which falls back to hiding in place.
            if path == NavigationGuard.path(from: landingURL) {
                NSLog("[InstagramFocus] blocked URL equals the landing path; leaving it to the engine")
                return
            }

            NSLog("[InstagramFocus] cancelled blocked navigation (\(verdict.kind)): \(path)")
            loadLanding()
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            // Cancelled navigations arrive here too, and are expected.
            let nsError = error as NSError
            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
            NSLog("[InstagramFocus] provisional load failed: \(error.localizedDescription)")
        }

        // -----------------------------------------------------------------
        // WKUIDelegate
        // -----------------------------------------------------------------

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            // target="_blank". Load it in this web view instead of silently
            // dropping the tap, so the destination is still subject to the
            // guard above. Returning nil means "no new web view".
            if let url = navigationAction.request.url {
                webView.load(URLRequest(url: url))
            }
            return nil
        }
    }
}
