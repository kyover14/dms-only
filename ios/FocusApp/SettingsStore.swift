import Foundation
import SwiftUI

/// The toggles the app exposes. Raw values are spelled identically to the keys
/// in `core/config.js`, on purpose: the JSON handed to the page needs no
/// translation layer, and `Config.merge` on the JavaScript side validates the
/// same strings. Anything it does not recognise is ignored, so a typo here
/// degrades to "that toggle does nothing" rather than a crash.
enum SettingKey: String, CaseIterable, Identifiable {
    case blockHome
    case blockReels
    case blockExplore
    case blockSearch
    case blockSearchGrid
    case stripSuggestedReels
    case blockStoriesTray
    case enforceRedirect
    case debug

    var id: String { rawValue }

    /// Must match `DEFAULTS` in core/config.js.
    var defaultValue: Bool {
        switch self {
        case .blockStoriesTray, .debug:
            return false
        default:
            return true
        }
    }

    var title: String {
        switch self {
        case .blockHome: return "Hide the home feed"
        case .blockReels: return "Hide Reels"
        case .blockExplore: return "Hide Explore"
        case .blockSearch: return "Hide search entirely"
        case .blockSearchGrid: return "Hide search results grid"
        case .stripSuggestedReels: return "Remove “Suggested Reels”"
        case .blockStoriesTray: return "Hide the stories tray"
        case .enforceRedirect: return "Send blocked pages to Messages"
        case .debug: return "Log routing decisions"
        }
    }

    var footer: String? {
        switch self {
        case .blockHome:
            return "Instagram has no setting for this. It is what makes the app worth having."
        case .blockReels:
            return "Removes the Reels tab, single Reels, and the Reels tab on profiles."
        case .blockExplore:
            return "Explore, tags, locations and people. Search stays available."
        case .blockSearch:
            return "Search is the same one-tap discovery surface as the feed. Turn it off and the grid toggle below decides how much of search you get back."
        case .blockSearchGrid:
            return "Only used while \u{201C}Hide search entirely\u{201D} is off. Keeps search usable — accounts still appear, only the scrollable grid goes."
        case .stripSuggestedReels:
            return "Removes the “Suggested Reels” and “Suggested for you” carousels."
        case .blockStoriesTray:
            return "Stories are not the endless feed, so this is off by default."
        case .enforceRedirect:
            return "When off, the page is emptied in place and a note is shown instead of navigating."
        case .debug:
            return "Prints every routing decision to the web inspector."
        }
    }
}

/// UserDefaults-backed settings, and the single source of the config override
/// injected into the page.
final class SettingsStore: ObservableObject {
    static let defaultLandingPath = "/direct/inbox/"

    private let defaults: UserDefaults
    private let prefix = "igfocus."

    @Published private(set) var values: [SettingKey: Bool] = [:]
    @Published var landingPath: String

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults

        var loaded: [SettingKey: Bool] = [:]
        for key in SettingKey.allCases {
            // `object(forKey:)` rather than `bool(forKey:)`: the latter cannot
            // tell "never set" from "explicitly false".
            if let stored = defaults.object(forKey: prefix + key.rawValue) as? Bool {
                loaded[key] = stored
            } else {
                loaded[key] = key.defaultValue
            }
        }
        self.values = loaded
        self.landingPath = defaults.string(forKey: prefix + "landingPath") ?? Self.defaultLandingPath
    }

    func binding(for key: SettingKey) -> Binding<Bool> {
        Binding(
            get: { [weak self] in self?.values[key] ?? key.defaultValue },
            set: { [weak self] newValue in self?.set(key, newValue) }
        )
    }

    func set(_ key: SettingKey, _ value: Bool) {
        values[key] = value
        defaults.set(value, forKey: prefix + key.rawValue)
    }

    func resetToDefaults() {
        for key in SettingKey.allCases {
            set(key, key.defaultValue)
        }
        landingPath = Self.defaultLandingPath
        defaults.set(Self.defaultLandingPath, forKey: prefix + "landingPath")
    }

    /// Mirrors the JavaScript rule `config[key] !== false`: unknown keys are
    /// treated as enabled, matching the fail-closed default in core/config.js.
    func isEnabled(_ configKey: String) -> Bool {
        guard let key = SettingKey(rawValue: configKey) else { return true }
        return values[key] ?? key.defaultValue
    }

    /// JSON for `window.IGFocusConfigOverride`.
    ///
    /// JSON is a subset of a JavaScript object literal, so this can be injected
    /// verbatim — no manual escaping, no string building.
    var overrideJSON: String {
        var payload: [String: Any] = [:]
        for key in SettingKey.allCases {
            payload[key.rawValue] = values[key] ?? key.defaultValue
        }
        payload["landingPath"] = landingPath

        guard
            let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
            let json = String(data: data, encoding: .utf8)
        else {
            return "{}"
        }
        return json
    }
}
