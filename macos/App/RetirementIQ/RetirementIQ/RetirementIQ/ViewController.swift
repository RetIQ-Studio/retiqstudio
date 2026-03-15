import Cocoa
import WebKit
import UniformTypeIdentifiers

class ViewController: NSViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {

    var webView: WKWebView!

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.userContentController.add(self, name: "savePlan")
        config.userContentController.add(self, name: "loadPlanRequest")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self

        self.view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        loadApp()
    }

    func loadApp() {
        guard let bundlePath = Bundle.main.path(forResource: "index", ofType: "html") else {
            showError("Could not locate app bundle.")
            return
        }
        let fileURL = URL(fileURLWithPath: bundlePath)
        let appDir = fileURL.deletingLastPathComponent()
        webView.loadFileURL(fileURL, allowingReadAccessTo: appDir)
    }

    func showError(_ message: String) {
        let html = "<html><body style='font-family:system-ui;padding:40px'><h2>RetirementIQ</h2><p>\(message)</p></body></html>"
        webView.loadHTMLString(html, baseURL: nil)
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript("document.body.style.webkitUserSelect = 'auto';", completionHandler: nil)

        // Override exportHTML for macOS native save panel
        let overrideJS = """
        (function() {
            window._origExportHTML = window.exportHTML;
            window.exportHTML = function() {
                var stateJSON = JSON.stringify(state.params).replace(/<\\//g, '<\\\\/');
                var dataBlock = '<script id="retiq-snapshot-data" type="application/json">' + stateJSON + '<\\/script>';
                var html = '<!DOCTYPE html>\\n' + document.documentElement.outerHTML.replace('</head>', dataBlock + '\\n</head>');
                window.webkit.messageHandlers.savePlan.postMessage(html);
            };

            // Override load plan for macOS native open panel
            var importEl = document.getElementById('importFile');
            if (importEl) {
                importEl.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.webkit.messageHandlers.loadPlanRequest.postMessage('');
                }, true);
            }
        })();
        """
        webView.evaluateJavaScript(overrideJS, completionHandler: { _, error in
            if let error = error { print("Override JS error: \\(error)") }
        })
    }

    // MARK: - WKUIDelegate

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "savePlan", let html = message.body as? String {
            DispatchQueue.main.async {
                self.saveHTMLFile(html)
            }
        }
        if message.name == "loadPlanRequest" {
            DispatchQueue.main.async {
                self.showOpenPanel()
            }
        }
    }

    func saveHTMLFile(_ html: String) {
        let savePanel = NSSavePanel()
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        let dateStr = dateFormatter.string(from: Date())
        savePanel.nameFieldStringValue = "retiq-\(dateStr).html"
        savePanel.allowedContentTypes = [.html]
        savePanel.begin { response in
            if response == .OK, let url = savePanel.url {
                do {
                    try html.write(to: url, atomically: true, encoding: .utf8)
                } catch {
                    print("Save failed: \(error)")
                }
            }
        }
    }

    func showOpenPanel() {
        let openPanel = NSOpenPanel()
        openPanel.allowedContentTypes = [.html, .json]
        openPanel.begin { response in
            if response == .OK, let url = openPanel.url {
                do {
                    let content = try String(contentsOf: url, encoding: .utf8)
                    let escaped = content
                        .replacingOccurrences(of: "\\", with: "\\\\")
                        .replacingOccurrences(of: "'", with: "\\'")
                        .replacingOccurrences(of: "\n", with: "\\n")
                        .replacingOccurrences(of: "\r", with: "\\r")
                    let filename = url.lastPathComponent
                    let isJSON = filename.hasSuffix(".json")
                    let loadJS: String
                    if isJSON {
                        loadJS = """
                        try {
                            state.params = JSON.parse('\(escaped)');
                            migrateParams();
                            state.activeExample = null;
                            state.importedPlanInfo = { filename: '\(filename)', date: '' };
                            saveState(); render();
                        } catch(err) { alert('Could not load file: ' + err.message); }
                        """
                    } else {
                        loadJS = """
                        try {
                            var text = '\(escaped)';
                            var dataMatch = text.match(/<script\\s+id="retiq-snapshot-data"\\s+type="application\\/json">([\\s\\S]*?)<\\/script>/);
                            var legacyMatch = !dataMatch && text.match(/state\\.params\\s*=\\s*(\\{[\\s\\S]*?\\});\\s*\\}\\s*catch/);
                            var jsonStr = dataMatch ? dataMatch[1] : legacyMatch ? legacyMatch[1] : null;
                            if (jsonStr) { state.params = JSON.parse(jsonStr); }
                            else { alert('Could not find saved data in this HTML file.'); return; }
                            migrateParams();
                            state.activeExample = null;
                            state.importedPlanInfo = { filename: '\(filename)', date: '' };
                            saveState(); render();
                        } catch(err) { alert('Could not load file: ' + err.message); }
                        """
                    }
                    self.webView.evaluateJavaScript(loadJS, completionHandler: { _, error in
                        if let error = error { print("Load JS error: \(error)") }
                    })
                } catch {
                    print("Load failed: \(error)")
                }
            }
        }
    }
}
