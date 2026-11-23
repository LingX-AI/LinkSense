package main

import (
	"errors"
	"testing"
	"time"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
	"github.com/egoist/mygo"
)

// TestShellMenusKeepViewActionsWithoutPageZoom inspects the prepared MyGo menu
// tree. A bare RoleViewMenu expands to page zoom roles and their Cmd+Plus,
// Cmd+- and Cmd+0 accelerators, which the fixed-scale Mac window must not install.
func TestShellMenusKeepViewActionsWithoutPageZoom(t *testing.T) {
	app, tray := (&Desktop{}).shellMenus(locales.In("en-US"))

	pageZoomRoles := map[mygo.MenuRole]bool{
		mygo.RoleResetZoom: true,
		mygo.RoleZoomIn:    true,
		mygo.RoleZoomOut:   true,
	}
	pageZoomAccelerators := map[string]bool{
		"CmdOrCtrl+0":    true,
		"CmdOrCtrl+Plus": true,
		"CmdOrCtrl+=":    true,
		"CmdOrCtrl+-":    true,
	}
	wanted := []struct {
		role        mygo.MenuRole
		accelerator string
	}{
		{mygo.RoleReload, "CmdOrCtrl+R"},
		{mygo.RoleForceReload, "Shift+CmdOrCtrl+R"},
		{mygo.RoleToggleDevTools, "Alt+Cmd+I"},
		{mygo.RoleToggleFullScreen, "Ctrl+Cmd+F"},
		{mygo.RoleMinimize, "CmdOrCtrl+M"},
		{mygo.RoleZoom, ""},
	}
	seen := map[mygo.MenuRole]bool{}
	viewLabel := ""
	var inspect func([]*mygo.MenuItem)
	inspect = func(items []*mygo.MenuItem) {
		for _, item := range items {
			if pageZoomRoles[item.Role] {
				t.Errorf("page zoom menu entry installed: role=%q accelerator=%q label=%q", item.Role, item.Accelerator, item.Label)
			}
			if pageZoomAccelerators[item.Accelerator] {
				t.Errorf("page zoom shortcut installed: role=%q accelerator=%q label=%q", item.Role, item.Accelerator, item.Label)
			}
			if item.Role == mygo.RoleViewMenu {
				viewLabel = item.Label
			}
			for _, want := range wanted {
				if item.Role != want.role {
					continue
				}
				seen[item.Role] = true
				if item.Accelerator != want.accelerator {
					t.Errorf("menu role %q has accelerator %q, want %q", item.Role, item.Accelerator, want.accelerator)
				}
			}
			inspect(item.Submenu)
		}
	}
	inspect(app.Items())
	inspect(tray.Items())

	if viewLabel == "" || viewLabel == string(mygo.RoleViewMenu) {
		t.Fatalf("the native View menu lost its localized label: %q", viewLabel)
	}
	for _, want := range wanted {
		if !seen[want.role] {
			t.Errorf("menu role %q is missing", want.role)
		}
	}
}

func TestShellMenusPlaceCrashReportsAfterExportInAllLanguages(t *testing.T) {
	for locale, label := range map[string]string{
		"zh-CN": "查看崩溃报告…",
		"en-US": "View Crash Reports…",
		"es-ES": "Ver informes de errores…",
		"pt-BR": "Ver relatórios de falha…",
		"fr-FR": "Afficher les rapports de blocage…",
		"ja-JP": "クラッシュレポートを表示…",
	} {
		t.Run(locale, func(t *testing.T) {
			app, tray := (&Desktop{}).shellMenus(locales.In(locale))
			item := app.ItemByID("view-crash-reports")
			if item == nil || item.Click == nil {
				t.Fatal("the native menu has no crash reports action")
			}
			if item.Label != label || item.Accelerator != "" {
				t.Fatalf("crash reports label=%q shortcut=%q, want %q without a shortcut", item.Label, item.Accelerator, label)
			}
			if tray.ItemByID("view-crash-reports") != nil {
				t.Fatal("crash reports action must not appear in the tray menu")
			}
			for _, menu := range app.Items() {
				if menu.Role != mygo.RoleAppMenu {
					continue
				}
				for i, child := range menu.Submenu {
					if child.ID == "view-crash-reports" && i > 0 && menu.Submenu[i-1].ID == "export-diagnostics" {
						return
					}
				}
			}
			t.Fatal("crash reports action must directly follow diagnostics export in the LinkSense menu")
		})
	}
}

func TestShellMenusCrashReportsOpenConsoleOnlyOnClick(t *testing.T) {
	originalOpen, originalMessage := openCrashReportsPath, showCrashReportsMessage
	t.Cleanup(func() { openCrashReportsPath, showCrashReportsMessage = originalOpen, originalMessage })
	var opened []string
	var openErr error
	openCrashReportsPath = func(path string) error {
		opened = append(opened, path)
		return openErr
	}
	shown := make(chan mygo.MessageOptions, 2)
	showCrashReportsMessage = func(options mygo.MessageOptions) (mygo.MessageResult, error) {
		shown <- options
		return mygo.MessageResult{}, nil
	}

	d := &Desktop{window: &mygo.Window{}}
	app, _ := d.shellMenus(locales.In("zh-CN"))
	if len(opened) != 0 {
		t.Fatal("constructing the menu launched an application")
	}
	item := app.ItemByID("view-crash-reports")
	if item == nil || item.Click == nil {
		t.Fatal("the native menu has no crash reports action")
	}

	const console = "/System/Applications/Utilities/Console.app"
	item.Click(item, nil)
	if len(opened) != 1 || opened[0] != console {
		t.Fatalf("menu click opened %q, want only the system Console", opened)
	}
	select {
	case got := <-shown:
		t.Fatalf("successful launch showed an error dialog: %+v", got)
	default:
	}

	openErr = errors.New("native error with a private path")
	item.Click(item, nil)
	if len(opened) != 2 || opened[1] != console {
		t.Fatalf("failed click opened %q, want one more attempt to open Console", opened)
	}
	select {
	case got := <-shown:
		if got.Parent != d.window || got.Type != mygo.MessageError || got.Title != "" ||
			got.Message != "无法打开控制台" || got.Detail != "请从「应用程序」>「实用工具」打开「控制台」，再在边栏选择「崩溃报告」。" {
			t.Fatalf("launch failure must display only the localized manual fallback: %+v", got)
		}
	case <-time.After(time.Second):
		t.Fatal("failed launch did not show a fallback dialog")
	}

	d.quitting.Store(true)
	item.Click(item, nil)
	if len(opened) != 2 {
		t.Fatalf("quitting app launched another application: %q", opened)
	}
}
