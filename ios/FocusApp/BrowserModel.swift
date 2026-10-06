// Combine is imported explicitly rather than borrowed from SwiftUI: this file
// does not import SwiftUI, and `ObservableObject` is declared in Combine.
import Combine
import Foundation
import WebKit

/// Holds the live web view so SwiftUI chrome (the toolbar) can drive it.
/// Splitting this out keeps `WebView` a plain representable and gives the
/// toolbar a handle that outlives view updates.
final class BrowserModel: ObservableObject {
    weak var webView: WKWebView?

    /// Open a path on instagram.com in the running web view.
    func open(path: String) {
        guard let webView = webView else { return }
        webView.load(URLRequest(url: BrowserModel.url(for: path)))
    }

    static let fallbackURL = URL(string: "https://www.instagram.com/direct/inbox/")!

    static func url(for path: String) -> URL {
        let trimmed = path.hasPrefix("/") ? path : "/" + path
        return URL(string: "https://www.instagram.com" + trimmed) ?? fallbackURL
    }
}
