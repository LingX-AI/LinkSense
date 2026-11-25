package main

import (
	"bytes"
	_ "embed"
	"log"
	"os"
	"path/filepath"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/preferences"
)

const closeToTrayPreference = "desktop.closeToTray"

// trayIcon is the shared LinkSense app mark rasterized for the menu bar.
//
//go:embed tray.png
var trayIcon []byte

var desktopNavigate = mygo.NewEvent[string]("desktop:navigate")

var (
	openCrashReportsPath    = mygo.Shell.OpenPath
	showCrashReportsMessage = mygo.Dialog.Message
)

// presentMainWindow runs on the main thread and keeps the existing WebView
// when reopening a hidden window.
func (d *Desktop) presentMainWindow() *mygo.Window {
	win := d.mainWindow()
	if win == nil || d.quitting.Load() {
		return nil
	}
	if win.IsDestroyed() {
		d.openMainWindow()
		win = d.mainWindow()
	}
	if win.IsMinimized() {
		win.Restore()
	}
	win.Show()
	win.Focus()
	return win
}

func (d *Desktop) navigateMainWindow(route string) {
	if win := d.presentMainWindow(); win != nil {
		if err := desktopNavigate.Emit(win, route); err != nil {
			log.Print("DESKTOP_NAVIGATION_UNAVAILABLE")
		}
	}
}

// stepMainWindowHistory drives the existing WebView's own history. History
// commands must never present, reopen, or focus a window, so a missing or
// destroyed main window and a WebView without the requested entry are no-ops.
func (d *Desktop) stepMainWindowHistory(forward bool) {
	win := d.mainWindow()
	if win == nil || win.IsDestroyed() {
		return
	}
	page := win.Page()
	if page == nil {
		return
	}
	if forward {
		if page.CanGoForward() {
			page.GoForward()
		}
		return
	}
	if page.CanGoBack() {
		page.GoBack()
	}
}

func (d *Desktop) installShell(dataRoot string) {
	// shortcut: mygo 0.10.0 leaves a nil preference map for JSON null; remove this once upstream handles null.
	canSave := true
	config := filepath.Join(dataRoot, "preferences.json")
	if data, err := os.ReadFile(config); err == nil && bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		canSave = os.Remove(config) == nil
	}
	if canSave {
		preferences.Get(closeToTrayPreference, &d.closeToTray)
	} else {
		log.Print("DESKTOP_PREFERENCES_SAVE_FAILED")
	}
	d.preferencesWritable = canSave
	// The background emergency controls exist only where this build can
	// construct the signed computer driver, only while a selection can still be
	// paused or stopped, and only while the app is backgrounded. The menu/tray
	// items below stay the app-local fallback, and both global bindings are
	// released whenever the app is active or quitting so one press can never
	// fire both paths.
	shortcut := newComputerEmergencyShortcut(
		func() { d.emergencyPauseComputer() },
		func() { d.emergencyStopComputer() },
	)
	d.computerShortcut = shortcut
	if desktopComputerShortcutEligible(d) {
		shortcut.setEligible(true)
		shortcut.setForeground(mygo.App.IsActive())
	}
	mygo.App.OnDidBecomeActive(func() { shortcut.setForeground(true) })
	mygo.App.OnDidResignActive(func() { shortcut.setForeground(false) })
	mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) { shortcut.quitBinding() })
	mygo.App.OnQuitCanceled(shortcut.restore)
	tray, err := mygo.NewTray(mygo.TrayOptions{
		ID: "linksense-main", Icon: trayIcon, ToolTip: "LinkSense",
	})
	if err != nil {
		d.closeToTray = false
		log.Print("DESKTOP_TRAY_UNAVAILABLE")
	} else {
		mygo.App.OnQuit(tray.Destroy)
	}
	mygo.App.OnQuit(shortcut.quitBinding)
	setMenus := func(locale string) {
		appMenu, trayMenu := d.shellMenus(locales.In(locale))
		mygo.App.SetMenu(appMenu)
		if tray != nil {
			trayMenu.ItemByID("close-to-tray").SetEnabled(canSave)
			tray.SetMenu(trayMenu)
		}
	}
	setMenus(mygo.App.Locale())
	mygo.App.OnLocaleChanged(setMenus)
	mygo.App.OnActivate(func(hasVisibleWindows bool) {
		if !hasVisibleWindows {
			d.presentMainWindow()
		}
	})
	mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) { d.quitting.Store(true) })
	mygo.App.OnQuitCanceled(func() { d.quitting.Store(false) })
}

func (d *Desktop) shellMenus(tx locales.Messages) (*mygo.Menu, *mygo.Menu) {
	show := func(*mygo.MenuItem, *mygo.Window) { d.presentMainWindow() }
	openSettings := func(*mygo.MenuItem, *mygo.Window) { d.navigateMainWindow("/settings/general") }
	newTask := func(*mygo.MenuItem, *mygo.Window) { d.navigateMainWindow("/conversations/new") }
	// Emergency pause and stop must not block the main thread on the
	// acknowledgement.
	pauseComputer := func(*mygo.MenuItem, *mygo.Window) { go d.emergencyPauseComputer() }
	stopComputer := func(*mygo.MenuItem, *mygo.Window) { go d.emergencyStopComputer() }
	exportDiagnostics := func(*mygo.MenuItem, *mygo.Window) { d.startDiagnosticsExport(tx) }
	goBack := func(*mygo.MenuItem, *mygo.Window) { d.stepMainWindowHistory(false) }
	goForward := func(*mygo.MenuItem, *mygo.Window) { d.stepMainWindowHistory(true) }
	viewCrashReports := func(*mygo.MenuItem, *mygo.Window) {
		if d.quitting.Load() || openCrashReportsPath("/System/Applications/Utilities/Console.app") == nil {
			return
		}
		log.Print("DESKTOP_CRASH_REPORTS_OPEN_FAILED")
		go func() {
			if !d.quitting.Load() {
				_, _ = showCrashReportsMessage(mygo.MessageOptions{
					Parent:  d.mainWindow(),
					Type:    mygo.MessageError,
					Message: tx.CrashReportsOpenFailedHeading(),
					Detail:  tx.CrashReportsOpenFailedDetail(),
				})
			}
		}()
	}
	app := mygo.NewMenu([]*mygo.MenuItem{
		{Role: mygo.RoleAppMenu, Submenu: []*mygo.MenuItem{
			{Role: mygo.RoleAbout},
			{ID: "desktop-updates", Label: tx.DesktopUpdates(), Click: openSettings},
			{ID: "export-diagnostics", Label: tx.ExportDiagnostics(), Click: exportDiagnostics},
			{ID: "view-crash-reports", Label: tx.ViewCrashReports(), Click: viewCrashReports},
			mygo.Separator(),
			{ID: "settings", Label: tx.Preferences(), Accelerator: "Cmd+,", Click: openSettings},
			{ID: "pause-computer", Label: tx.PauseComputerControl(), Accelerator: computerEmergencyPauseAccelerator, Click: pauseComputer},
			{ID: "stop-computer", Label: tx.StopComputerControl(), Accelerator: computerEmergencyStopAccelerator, Click: stopComputer},
			mygo.Separator(),
			{Role: mygo.RoleServices},
			mygo.Separator(),
			{Role: mygo.RoleHide},
			{Role: mygo.RoleHideOthers},
			{Role: mygo.RoleUnhide},
			mygo.Separator(),
			{Role: mygo.RoleQuit},
		}},
		{Role: mygo.RoleFileMenu, Submenu: []*mygo.MenuItem{
			{ID: "new-task", Label: tx.NewTask(), Accelerator: "Cmd+N", Click: newTask},
			mygo.Separator(),
			{Role: mygo.RoleClose},
		}},
		{Role: mygo.RoleEditMenu},
		// The native View role keeps its localized label, but MyGo would expand
		// a bare role into page-zoom commands. Back and Forward use the WebView's
		// own history; the fixed page scale keeps reload, developer tools and
		// full screen, while RoleWindowMenu keeps native window management.
		{Role: mygo.RoleViewMenu, Submenu: []*mygo.MenuItem{
			{ID: "history-back", Label: tx.GoBack(), Accelerator: "Cmd+[", Click: goBack},
			{ID: "history-forward", Label: tx.GoForward(), Accelerator: "Cmd+]", Click: goForward},
			mygo.Separator(),
			{Role: mygo.RoleReload},
			{Role: mygo.RoleForceReload},
			{Role: mygo.RoleToggleDevTools},
			mygo.Separator(),
			{Role: mygo.RoleToggleFullScreen},
		}},
		{Role: mygo.RoleWindowMenu},
	})
	tray := mygo.NewMenu([]*mygo.MenuItem{
		{ID: "show-window", Label: tx.ShowWindow(), Click: show},
		{ID: "new-task", Label: tx.NewTask(), Click: newTask},
		{ID: "settings", Label: tx.Preferences(), Click: openSettings},
		{ID: "pause-computer", Label: tx.PauseComputerControl(), Click: pauseComputer},
		{ID: "stop-computer", Label: tx.StopComputerControl(), Click: stopComputer},
		{ID: "close-to-tray", Label: tx.CloseToTray(), Type: mygo.MenuItemCheckbox, Checked: d.closeToTray,
			Click: func(item *mygo.MenuItem, _ *mygo.Window) {
				enabled := item.IsChecked()
				if err := preferences.Set(closeToTrayPreference, enabled); err != nil {
					item.SetChecked(d.closeToTray)
					log.Print("DESKTOP_PREFERENCES_SAVE_FAILED")
					return
				}
				d.closeToTray = enabled
			}},
		mygo.Separator(),
		{Role: mygo.RoleQuit, Label: tx.Quit()},
	})
	return app, tray
}
