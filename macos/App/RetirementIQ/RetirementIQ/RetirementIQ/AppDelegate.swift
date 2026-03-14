import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {

    var window: NSWindow!

    func applicationDidFinishLaunching(_ aNotification: Notification) {
        let viewController = ViewController()

        window = NSWindow(
            contentRect: NSMakeRect(0, 0, 1200, 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )

        window.title = "RetirementIQ"
        window.contentViewController = viewController
        window.setFrameAutosaveName("MainWindow")
        window.minSize = NSSize(width: 900, height: 650)
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        buildMenuBar()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        return true
    }

    // MARK: - Menu Bar

    func buildMenuBar() {
        let mainMenu = NSMenu()

        // ── App Menu ──
        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenuItem.submenu = appMenu
        appMenu.addItem(NSMenuItem(title: "About RetirementIQ", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "Hide RetirementIQ", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
        appMenu.addItem(NSMenuItem(title: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: ""))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "Quit RetirementIQ", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))

        // ── File Menu ──
        let fileMenuItem = NSMenuItem()
        mainMenu.addItem(fileMenuItem)
        let fileMenu = NSMenu(title: "File")
        fileMenuItem.submenu = fileMenu

        let newPlan = NSMenuItem(title: "New Plan", action: #selector(menuNewPlan), keyEquivalent: "n")
        newPlan.target = self
        fileMenu.addItem(newPlan)
        fileMenu.addItem(NSMenuItem.separator())

        let savePlan = NSMenuItem(title: "Save Plan", action: #selector(menuSavePlan), keyEquivalent: "s")
        savePlan.target = self
        fileMenu.addItem(savePlan)

        let loadPlan = NSMenuItem(title: "Load Plan", action: #selector(menuLoadPlan), keyEquivalent: "o")
        loadPlan.target = self
        fileMenu.addItem(loadPlan)
        fileMenu.addItem(NSMenuItem.separator())

        let exportSummary = NSMenuItem(title: "Export Summary PDF", action: #selector(menuExportSummary), keyEquivalent: "e")
        exportSummary.target = self
        fileMenu.addItem(exportSummary)

        // ── View Menu ──
        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "View")
        viewMenuItem.submenu = viewMenu

        let simpleMode = NSMenuItem(title: "Simple Mode", action: #selector(menuSimpleMode), keyEquivalent: "1")
        simpleMode.target = self
        viewMenu.addItem(simpleMode)

        let fullMode = NSMenuItem(title: "Full Mode", action: #selector(menuFullMode), keyEquivalent: "2")
        fullMode.target = self
        viewMenu.addItem(fullMode)
        viewMenu.addItem(NSMenuItem.separator())

        let dashboard = NSMenuItem(title: "Dashboard", action: #selector(menuTabDashboard), keyEquivalent: "d")
        dashboard.target = self
        viewMenu.addItem(dashboard)

        let inputs = NSMenuItem(title: "Inputs", action: #selector(menuTabInputs), keyEquivalent: "i")
        inputs.target = self
        viewMenu.addItem(inputs)

        let projection = NSMenuItem(title: "Projection", action: #selector(menuTabProjection), keyEquivalent: "p")
        projection.target = self
        viewMenu.addItem(projection)

        let monteCarlo = NSMenuItem(title: "Monte Carlo", action: #selector(menuTabMonteCarlo), keyEquivalent: "m")
        monteCarlo.target = self
        viewMenu.addItem(monteCarlo)
        viewMenu.addItem(NSMenuItem.separator())

        let todaysDollars = NSMenuItem(title: "Today's Dollars", action: #selector(menuTodaysDollars), keyEquivalent: "t")
        todaysDollars.target = self
        viewMenu.addItem(todaysDollars)

        let futureDollars = NSMenuItem(title: "Future Dollars", action: #selector(menuFutureDollars), keyEquivalent: "")
        futureDollars.target = self
        viewMenu.addItem(futureDollars)
        viewMenu.addItem(NSMenuItem.separator())

        let toggleTheme = NSMenuItem(title: "Toggle Theme", action: #selector(menuToggleTheme), keyEquivalent: "t")
        toggleTheme.keyEquivalentModifierMask = [.command, .shift]
        toggleTheme.target = self
        viewMenu.addItem(toggleTheme)

        // ── Examples Menu ──
        let examplesMenuItem = NSMenuItem()
        mainMenu.addItem(examplesMenuItem)
        let examplesMenu = NSMenu(title: "Examples")
        examplesMenuItem.submenu = examplesMenu

        let clarks = NSMenuItem(title: "The Clarks — The Cost of Simplicity", action: #selector(menuExampleClarks), keyEquivalent: "")
        clarks.target = self
        examplesMenu.addItem(clarks)

        let lees = NSMenuItem(title: "The Lees — The Optimization Gap", action: #selector(menuExampleLees), keyEquivalent: "")
        lees.target = self
        examplesMenu.addItem(lees)

        let washingtons = NSMenuItem(title: "The Washingtons — The Complexity You Didn't Know You Had", action: #selector(menuExampleWashingtons), keyEquivalent: "")
        washingtons.target = self
        examplesMenu.addItem(washingtons)

        // ── Window Menu ──
        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenuItem.submenu = windowMenu
        windowMenu.addItem(NSMenuItem(title: "Minimize", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m"))
        windowMenu.addItem(NSMenuItem(title: "Zoom", action: #selector(NSWindow.zoom(_:)), keyEquivalent: ""))

        // ── Help Menu ──
        let helpMenuItem = NSMenuItem()
        mainMenu.addItem(helpMenuItem)
        let helpMenu = NSMenu(title: "Help")
        helpMenuItem.submenu = helpMenu

        let manual = NSMenuItem(title: "Manual", action: #selector(menuManual), keyEquivalent: "")
        manual.target = self
        helpMenu.addItem(manual)

        let features = NSMenuItem(title: "Features", action: #selector(menuFeatures), keyEquivalent: "")
        features.target = self
        helpMenu.addItem(features)

        let security = NSMenuItem(title: "Security", action: #selector(menuSecurity), keyEquivalent: "")
        security.target = self
        helpMenu.addItem(security)

        let validation = NSMenuItem(title: "Validation", action: #selector(menuValidation), keyEquivalent: "")
        validation.target = self
        helpMenu.addItem(validation)
        helpMenu.addItem(NSMenuItem.separator())

        let website = NSMenuItem(title: "RetirementIQ Website", action: #selector(menuWebsite), keyEquivalent: "")
        website.target = self
        helpMenu.addItem(website)

        NSApp.mainMenu = mainMenu
    }

    // MARK: - Menu Actions

    func callJS(_ js: String) {
        guard let vc = window?.contentViewController as? ViewController else { return }
        vc.webView.evaluateJavaScript(js, completionHandler: nil)
    }

    @objc func menuNewPlan() {
        let alert = NSAlert()
        alert.messageText = "Start a New Plan?"
        alert.informativeText = "This will clear your current plan. Make sure you've saved first."
        alert.addButton(withTitle: "New Plan")
        alert.addButton(withTitle: "Cancel")
        if alert.runModal() == .alertFirstButtonReturn {
            callJS("loadExample('clark');")
        }
    }

    @objc func menuSavePlan() { callJS("exportHTML()") }
    @objc func menuLoadPlan() { callJS("document.getElementById('importFile').click()") }
    @objc func menuExportSummary() { callJS("exportDashboardSummary()") }

    @objc func menuSimpleMode() { callJS("setUIMode('essentials')") }
    @objc func menuFullMode() { callJS("setUIMode('full')") }

    @objc func menuTabDashboard() { callJS("state.tab='dashboard';render()") }
    @objc func menuTabInputs() { callJS("state.tab='inputs';render()") }
    @objc func menuTabProjection() { callJS("state.tab='projection';render()") }
    @objc func menuTabMonteCarlo() { callJS("state.tab='montecarlo';render()") }

    @objc func menuTodaysDollars() { callJS("showRealDollars=true;render()") }
    @objc func menuFutureDollars() { callJS("showRealDollars=false;render()") }
    @objc func menuToggleTheme() { callJS("toggleTheme()") }

    @objc func menuExampleClarks() { callJS("loadExample('clark')") }
    @objc func menuExampleLees() { callJS("loadExample('lee')") }
    @objc func menuExampleWashingtons() { callJS("loadExample('washington')") }

    @objc func menuManual() { callJS("showInfoPage('manual.html','Manual')") }
    @objc func menuFeatures() { callJS("showInfoPage('features.html','Features')") }
    @objc func menuSecurity() { callJS("showInfoPage('security.html','Security')") }
    @objc func menuValidation() { callJS("state.tab='validation';render()") }

    @objc func menuWebsite() { NSWorkspace.shared.open(URL(string: "https://retirementiq.app")!) }
}
