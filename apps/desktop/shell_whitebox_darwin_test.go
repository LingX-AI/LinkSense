//go:build desktop_whitebox

package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
	"github.com/egoist/mygo"
)

func TestNativeMenuReopensSamePageAndHonorsUnsavedChanges(t *testing.T) {
	nativeWhiteboxSession(t, true)
	d := nativeWhitebox.desktop
	d.openMainWindow()
	w := d.mainWindow()
	t.Cleanup(w.Destroy)
	app, tray := d.shellMenus(locales.In("en-US"))
	click := func(menu *mygo.Menu, id string) {
		t.Helper()
		item := menu.ItemByID(id)
		if item == nil || item.Click == nil {
			t.Fatalf("missing menu action %q", id)
		}
		mygo.RunOnMain(func() { item.Click(item, nil) })
	}
	p := w.Page()
	whiteboxWait(t, p, `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli")`)

	toggle := tray.ItemByID("close-to-tray")
	if toggle == nil || toggle.IsChecked() {
		t.Fatal("close-to-tray must be off for a fresh installation")
	}
	// MyGo sets a checkbox's state before calling its menu action.
	toggle.SetChecked(true)
	click(tray, "close-to-tray")
	t.Cleanup(func() {
		toggle.SetChecked(false)
		click(tray, "close-to-tray")
	})
	root, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		t.Fatal(err)
	}
	config, err := os.ReadFile(filepath.Join(root, "preferences.json"))
	var saved map[string]bool
	if err != nil || json.Unmarshal(config, &saved) != nil || !saved[closeToTrayPreference] {
		t.Fatal("close-to-tray was not persisted to app data")
	}
	w.Close()
	if w.IsDestroyed() || w.IsVisible() {
		t.Fatal("close-to-tray must hide the existing window")
	}
	click(tray, "show-window")
	if !w.IsVisible() || d.mainWindow() != w {
		t.Fatal("the menu must restore the original window")
	}
	click(app, "settings")
	whiteboxWait(t, p, `location.pathname === "/settings/general"`)

	if err := p.LoadURL("/settings/personalization"); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, p, `document.querySelector("#custom-instructions")?.disabled === false`)
	if _, err := p.Eval(`(() => {
		const el = document.querySelector("#custom-instructions");
		Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, "Unsaved fixture");
		el.dispatchEvent(new Event("input", { bubbles: true }));
	})()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, p, `document.querySelector("#custom-instructions")?.form.querySelector("button[type=submit]").disabled === false`)
	click(tray, "new-task")
	whiteboxWait(t, p, `location.pathname === "/settings/personalization" && document.querySelector("[role=alertdialog]") !== null`)
}

func TestNativeMenuDoesNotInterruptBrowserSignIn(t *testing.T) {
	nativeWhiteboxSession(t, false)
	d := nativeWhitebox.desktop
	request := make(chan string, 1)
	originalBrowser := d.openBrowser
	d.openBrowser = func(raw string) error {
		select {
		case request <- raw:
			return nil
		default:
			return errors.New("browser sign-in was requested twice")
		}
	}
	t.Cleanup(func() { d.openBrowser = originalBrowser })
	d.openMainWindow()
	w := d.mainWindow()
	defer w.Destroy()
	p := w.Page()
	whiteboxWait(t, p, `location.pathname === "/login" && !!document.querySelector("[data-desktop-sign-in]")`)
	if _, err := p.Eval(`document.querySelector("[data-desktop-sign-in]").click()`); err != nil {
		t.Fatal(err)
	}
	var authorization *url.URL
	select {
	case raw := <-request:
		var err error
		authorization, err = url.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("browser sign-in didn't start")
	}
	mygo.RunOnMain(func() { d.navigateMainWindow("/settings/general") })
	whiteboxWait(t, p, `location.pathname === "/login" && document.querySelector("[data-desktop-sign-in]")?.disabled === true`)
	d.handleOpenURL(desktopLoginRedirectURI + "?" + url.Values{
		"state": {authorization.Query().Get("state")}, "code": {strings.Repeat("c", 43)},
	}.Encode())
	whiteboxWait(t, p, `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli")`)
}

func TestNativeShellRestoresPreferenceAndQuits(t *testing.T) {
	const fixturePath = "LINKSENSE_TEST_SHELL_DATA"
	if dir := os.Getenv(fixturePath); dir != "" {
		d := nativeWhitebox.desktop
		expectHidden := os.Getenv("LINKSENSE_TEST_SHELL_EXPECT_HIDDEN") == "1"
		togglePreference := os.Getenv("LINKSENSE_TEST_SHELL_TOGGLE") == "1"
		quitting := make(chan struct{})
		mygo.RunOnMain(func() {
			mygo.App.SetPath(mygo.PathUserData, dir)
			d.openMainWindow()
			d.installShell(dir)
			mygo.App.OnWillQuit(func(*mygo.QuitEvent) { close(quitting) })
		})
		w := d.mainWindow()
		if togglePreference {
			mygo.RunOnMain(func() {
				_, tray := d.shellMenus(locales.In("en-US"))
				item := tray.ItemByID("close-to-tray")
				item.SetChecked(true)
				item.Click(item, nil)
			})
		}
		w.Close()
		if w.IsDestroyed() == expectHidden || w.IsVisible() {
			t.Fatalf("unexpected close behavior with saved preference: expect hidden=%t", expectHidden)
		}
		mygo.App.Quit()
		select {
		case <-quitting:
			if !w.IsDestroyed() {
				t.Fatal("Quit did not destroy the hidden window")
			}
		case <-t.Context().Done():
			t.Fatal("the explicit Quit did not finish")
		}
		t.Log("native close and quit assertions passed")
		return
	}
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, config, expectHidden string
		toggle                     bool
	}{
		{"first launch", "", "0", false},
		{"truncated preference", `{"desktop.closeToTray":`, "0", false},
		{"saved preference", `{"desktop.closeToTray":true}`, "1", false},
		{"null preference can be changed", "null\n", "1", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			if tc.config != "" {
				if err := os.WriteFile(filepath.Join(dir, "preferences.json"), []byte(tc.config), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			ctx, cancel := context.WithTimeout(t.Context(), 12*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, binary, "-test.v", "-test.run=^TestNativeShellRestoresPreferenceAndQuits$")
			cmd.Env = append(os.Environ(), fixturePath+"="+dir, "LINKSENSE_TEST_SHELL_EXPECT_HIDDEN="+tc.expectHidden)
			if tc.toggle {
				cmd.Env = append(cmd.Env, "LINKSENSE_TEST_SHELL_TOGGLE=1")
			}
			if result, err := cmd.CombinedOutput(); err != nil || !strings.Contains(string(result), "native close and quit assertions passed") {
				t.Fatalf("native quit fixture: %v\n%s", err, result)
			}
		})
	}
}
