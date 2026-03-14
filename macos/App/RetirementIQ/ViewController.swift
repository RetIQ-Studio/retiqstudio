import Cocoa
import WebKit

class ViewController: NSViewController, WKNavigationDelegate, WKUIDelegate {

    var webView: WKWebView!

    override func loadView() {
        let config = WKWebViewConfiguration()

        // Allow local file access
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

        // Disable developer extras in production
        #if DEBUG
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        #endif

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self

        // Suppress right-click context menu in production
        #if !DEBUG
        webView.configuration.preferences.setValue(false, forKey: "developerExtrasEnabled")
        #endif

        self.view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        loadApp()
    }

    func loadApp() {
        guard let bundlePath = Bundle.main.path(forResource: "index", ofType: "html", inDirectory: "app") else {
            // Fallback: try loading retiq-deploy/app/index.html directly
            showError("Could not locate app bundle. Please reinstall RetirementIQ.")
            return
        }

        let fileURL = URL(fileURLWithPath: bundlePath)
        let appDir = fileURL.deletingLastPathComponent()
        webView.loadFileURL(fileURL, allowingReadAccessTo: appDir)
    }

    func showError(_ message: String) {
        let html = """
        <html><body style="font-family:system-ui;padding:40px;color:#333;">
        <h2>RetirementIQ</h2><p>\(message)</p>
        </body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Inject CSS to suppress text selection cursor (optional, makes it feel more native)
        let js = "document.body.style.webkitUserSelect = 'auto';"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showError("Failed to load: \(error.localizedDescription)")
    }

    // MARK: - WKUIDelegate

    // Open all target="_blank" links in the default browser, not in-app
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil {
            if let url = navigationAction.request.url {
                NSWorkspace.shared.open(url)
            }
        }
        return nil
    }
}
