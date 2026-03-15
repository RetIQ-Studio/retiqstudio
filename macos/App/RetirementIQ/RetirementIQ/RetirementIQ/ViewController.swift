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
        config.userContentController.add(self, name: "printSummary")
        config.userContentController.add(self, name: "saveCSV")

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
        
        let overrideJS = """
        (function() {
            window._origExportHTML = window.exportHTML;
            window.exportHTML = function() {
                var stateJSON = JSON.stringify(state.params).replace(/<\\//g, '<\\\\/');
                var dataBlock = '<script id="retiq-snapshot-data" type="application/json">' + stateJSON + '<\\/script>';
                var html = '<!DOCTYPE html>\\n' + document.documentElement.outerHTML.replace('</head>', dataBlock + '\\n</head>');
                window.webkit.messageHandlers.savePlan.postMessage(html);
            };
        
            var importEl = document.getElementById('importFile');
            if (importEl) {
                importEl.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.webkit.messageHandlers.loadPlanRequest.postMessage('');
                }, true);
            }
        
            window._retiqNav = function(tab) {
                var ov = document.getElementById('infoPageOverlay');
                if(ov) ov.remove();
                if(tab) { state.tab = tab; render(); }
            };
        
            window._origExportDashboardSummary = window.exportDashboardSummary;
            window.exportDashboardSummary = function() {
                var origOpen = window.open;
                window.open = function(url, target) {
                    return {
                        document: {
                            write: function(html) { window._pendingSummaryHTML = html; },
                            close: function() {
                                if(window._pendingSummaryHTML) {
                                    window.webkit.messageHandlers.printSummary.postMessage(window._pendingSummaryHTML);
                                    window._pendingSummaryHTML = null;
                                }
                            }
                        }
                    };
                };
                window._origExportDashboardSummary();
                window.open = origOpen;
            };

            window.exportProjectionCSV = function() {
                var p = state.params;
                var proj = runProjection(p);
                var curYear = new Date().getFullYear();
                var allCols = [
                    {head:'Age',key:'age',isCurrency:false},
                    {head:'Year',key:'year',isCurrency:false},
                    {head:'Earned Income',key:'earned',isCurrency:true},
                    {head:'Employer Match',key:'employerMatch',isCurrency:true},
                    {head:'Social Security',key:'ss',isCurrency:true},
                    {head:'SSDI',key:'ssdi',isCurrency:true},
                    {head:'Pension',key:'pension',isCurrency:true},
                    {head:'Pension (Taxable)',key:'pensionTaxable',isCurrency:true},
                    {head:'Other Income',key:'other',isCurrency:true},
                    {head:'Expenses',key:'expenses',isCurrency:true},
                    {head:'Federal Tax',key:'fedTax',isCurrency:true},
                    {head:'State Tax',key:'stateTax',isCurrency:true},
                    {head:'Cap Gains Tax',key:'cgTax',isCurrency:true},
                    {head:'NIIT',key:'niitTax',isCurrency:true},
                    {head:'Total Tax',key:'tax',isCurrency:true},
                    {head:'Withdrawals',key:'withdrawal',isCurrency:true},
                    {head:'RMD',key:'rmd',isCurrency:true},
                    {head:'Roth Conversions',key:'rothConv',isCurrency:true},
                    {head:'IRMAA Surcharge',key:'irmaa',isCurrency:true},
                    {head:'Healthcare',key:'healthcare',isCurrency:true},
                    {head:'ACA Subsidy',key:'acaSubsidy',isCurrency:true},
                    {head:'ACA Benchmark',key:'acaBenchmark',isCurrency:true},
                    {head:'Charity (QCD)',key:'qcd',isCurrency:true},
                    {head:'Charity (Total)',key:'charityTotal',isCurrency:true},
                    {head:'Capital Gains',key:'capGains',isCurrency:true},
                    {head:'Cash Interest',key:'cashInterest',isCurrency:true},
                    {head:'Income (MAGI)',key:'magi',isCurrency:true},
                    {head:'Pre-Tax Balance',key:'preTax',isCurrency:true},
                    {head:'Roth Balance',key:'roth',isCurrency:true},
                    {head:'Cash/HYS Balance',key:'cash',isCurrency:true},
                    {head:'Brokerage Balance',key:'taxableInv',isCurrency:true},
                    {head:'Taxable Balance',key:'taxable',isCurrency:true},
                    {head:'Net Worth',key:'netWorth',isCurrency:true}
                ];
                var alwaysShow = {age:1,year:1,netWorth:1,expenses:1};
                var cols = allCols.filter(function(c){
                    return alwaysShow[c.key] || proj.some(function(y){ return (y[c.key]||0)!==0; });
                });
                var header = cols.map(function(c){ return '"'+c.head+'"'; }).join(',');
                var rows = proj.map(function(y){
                    return cols.map(function(c){
                        var v = y[c.key]||0;
                        return c.isCurrency ? Math.round(showRealDollars ? deflate(v,y.year-curYear) : v) : v;
                    }).join(',');
                }).join('\\n');
                var csv = header+'\\n'+rows;
                window.webkit.messageHandlers.saveCSV.postMessage(csv);
            };
        })();
        """
        webView.evaluateJavaScript(overrideJS, completionHandler: { _, error in
            if let error = error { print("Override JS error: \(error)") }
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
    
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = "RetirementIQ"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }
    
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = "RetirementIQ"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
        completionHandler()
    }
    
    // MARK: - WKScriptMessageHandler
    
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "savePlan", let html = message.body as? String {
            DispatchQueue.main.async { self.saveHTMLFile(html) }
        }
        if message.name == "loadPlanRequest" {
            DispatchQueue.main.async { self.showOpenPanel() }
        }
        if message.name == "printSummary", let html = message.body as? String {
            DispatchQueue.main.async { self.printHTMLContent(html) }
        }
        if message.name == "saveCSV", let csv = message.body as? String {
            DispatchQueue.main.async { self.saveCSVFile(csv) }
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
                        (function() {
                            try {
                                state.params = JSON.parse('\(escaped)');
                                migrateParams();
                                state.activeExample = null;
                                state.importedPlanInfo = { filename: '\(filename)', date: '' };
                                saveState(); render();
                            } catch(err) { alert('Could not load file: ' + err.message); }
                        })();
                        """
                    } else {
                        loadJS = """
                        (function() {
                            try {
                                var text = '\(escaped)';
                                var dataMatch = text.match(/<script[^>]+id="retiq-snapshot-data"[^>]*>([\\s\\S]*?)<\\/script>/);
                                var jsonStr = dataMatch ? dataMatch[1] : null;
                                if (!jsonStr) { alert('Could not find saved data in this HTML file.'); return; }
                                state.params = JSON.parse(jsonStr);
                                migrateParams();
                                state.activeExample = null;
                                state.importedPlanInfo = { filename: '\(filename)', date: '' };
                                saveState(); render();
                            } catch(err) { alert('Could not load file: ' + err.message); }
                        })();
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
    
    func saveCSVFile(_ csv: String) {
        let savePanel = NSSavePanel()
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        let dateStr = dateFormatter.string(from: Date())
        savePanel.nameFieldStringValue = "retiq-projection-\(dateStr).csv"
        if #available(macOS 12.0, *) {
            savePanel.allowedContentTypes = [.commaSeparatedText]
        }
        savePanel.begin { response in
            if response == .OK, let url = savePanel.url {
                do {
                    try csv.write(to: url, atomically: true, encoding: .utf8)
                } catch {
                    print("CSV save failed: \(error)")
                }
            }
        }
    }

    func printCurrentView() {
        webView.evaluateJavaScript("document.documentElement.outerHTML") { result, error in
            guard let html = result as? String else { return }
            let tempDir = FileManager.default.temporaryDirectory
            let tempFile = tempDir.appendingPathComponent("retiq-print.html")
            do {
                try html.write(to: tempFile, atomically: true, encoding: .utf8)
                DispatchQueue.main.async {
                    NSWorkspace.shared.open(tempFile)
                }
            } catch {
                print("❌ Print failed: \(error)")
            }
        }
    }
    
    func printHTMLContent(_ html: String) {
        let tempDir = FileManager.default.temporaryDirectory
        let tempFile = tempDir.appendingPathComponent("retiq-summary.html")
        do {
            try html.write(to: tempFile, atomically: true, encoding: .utf8)
            NSWorkspace.shared.open(tempFile)
        } catch {
            print("Print failed: \(error)")
        }
    }
}
