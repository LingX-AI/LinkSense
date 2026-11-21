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

// presentMainWindow runs on the main thread and keeps the existing WebView
// when reopening a hidden window.
func (d *Desktop) presentMainWindow() *mygo.Window {
	win := d.mainWindow()
	if win == nil || d.quitting {
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
	tray, err := mygo.NewTray(mygo.TrayOptions{
		ID: "linksense-main", Icon: trayIcon, ToolTip: "LinkSense",
	})
	if err != nil {
		d.closeToTray = false
		log.Print("DESKTOP_TRAY_UNAVAILABLE")
	} else {
		mygo.App.OnQuit(tray.Destroy)
	}
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
	mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) { d.quitting = true })
	mygo.App.OnQuitCanceled(func() { d.quitting = false })
}

func (d *Desktop) shellMenus(tx locales.Messages) (*mygo.Menu, *mygo.Menu) {
	show := func(*mygo.MenuItem, *mygo.Window) { d.presentMainWindow() }
	openSettings := func(*mygo.MenuItem, *mygo.Window) { d.navigateMainWindow("/settings/general") }
	newTask := func(*mygo.MenuItem, *mygo.Window) { d.navigateMainWindow("/conversations/new") }
	app := mygo.NewMenu([]*mygo.MenuItem{
		{Role: mygo.RoleAppMenu, Submenu: []*mygo.MenuItem{
			{Role: mygo.RoleAbout},
			{ID: "desktop-updates", Label: tx.DesktopUpdates(), Click: openSettings},
			mygo.Separator(),
			{ID: "settings", Label: tx.Preferences(), Accelerator: "Cmd+,", Click: openSettings},
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
		{Role: mygo.RoleViewMenu},
		{Role: mygo.RoleWindowMenu},
	})
	tray := mygo.NewMenu([]*mygo.MenuItem{
		{ID: "show-window", Label: tx.ShowWindow(), Click: show},
		{ID: "new-task", Label: tx.NewTask(), Click: newTask},
		{ID: "settings", Label: tx.Preferences(), Click: openSettings},
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
