package main

import (
	"testing"

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
