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

func TestNativeConversationDeepLinkHonorsUnsavedSettingsOnce(t *testing.T) {
	const target = "71000000-0000-4000-8000-000000000901"
	link := "linksense-desktop://conversation/" + target
	nativeDeepLinkHonorsUnsavedSettingsOnce(t, link, `location.pathname === "/conversations/`+target+`"`, link+"?token=fixture")
}

func nativeDeepLinkHonorsUnsavedSettingsOnce(t *testing.T, link, arrived, invalidLink string) {
	t.Helper()
	nativeWhiteboxSession(t, true)
	d := nativeWhitebox.desktop
	d.openMainWindow()
	w := d.mainWindow()
	defer w.Destroy()
	p := w.Page()
	whiteboxWait(t, p, `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli")`)

	if err := p.LoadURL("/settings/personalization"); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, p, `document.querySelector("#custom-instructions")?.disabled === false`)
	if _, err := p.Eval(`(() => {
		window.__conversationDeepLinkSentinel = "retained";
		const field = document.querySelector("#custom-instructions");
		Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, "Unsaved fixture");
		field.dispatchEvent(new Event("input", { bubbles: true }));
	})()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, p, `document.querySelector("#custom-instructions")?.form.querySelector("button[type=submit]").disabled === false`)

	d.handleOpenURL(link)
	whiteboxWait(t, p, `location.pathname === "/settings/personalization" && !!document.querySelector("[role=alertdialog]")`)
	if _, err := p.Eval(`(() => {
		const dialog = document.querySelector("[role=alertdialog]");
		const stay = [...dialog.querySelectorAll("button")].find(button => button.textContent.trim() === "Stay on Page");
		if (!stay) throw new Error("Stay on Page is missing");
		stay.click();
	})()`); err != nil {
		t.Fatal(err)
	}
	// Canceling the built-in unsaved dialog must neither replay the target nor
	// reload the document that holds the draft.
	whiteboxWait(t, p, `new Promise(resolve => setTimeout(() => resolve(
		location.pathname === "/settings/personalization" &&
		!document.querySelector("[role=alertdialog]") &&
		window.__conversationDeepLinkSentinel === "retained"), 200))`)

	d.handleOpenURL(link)
	whiteboxWait(t, p, `location.pathname === "/settings/personalization" && !!document.querySelector("[role=alertdialog]")`)
	if _, err := p.Eval(`(() => {
		const dialog = document.querySelector("[role=alertdialog]");
		const discard = [...dialog.querySelectorAll("button")].find(button => button.textContent.trim() === "Discard Changes");
		if (!discard) throw new Error("Discard Changes is missing");
		discard.click();
	})()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, p, `(`+arrived+`) && window.__conversationDeepLinkSentinel === "retained"`)

	// The same current target is a no-op, and an invalid link cannot reload or
	// replace the document either.
	d.handleOpenURL(link)
	whiteboxWait(t, p, `new Promise(resolve => setTimeout(() => resolve(
		(`+arrived+`) &&
		window.__conversationDeepLinkSentinel === "retained"), 200))`)
	d.handleOpenURL(invalidLink)
	whiteboxWait(t, p, `new Promise(resolve => setTimeout(() => resolve(
		(`+arrived+`) &&
		window.__conversationDeepLinkSentinel === "retained"), 200))`)
}

func TestNativeConversationDeepLinkSurvivesBrowserSignIn(t *testing.T) {
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

	const target = "71000000-0000-4000-8000-000000000902"
	link := "linksense-desktop://conversation/" + target
	// Deliver before React mounts. The initial page must stay the login handoff,
	// and the target waits for the protected router after a successful callback.
	d.handleOpenURL(link)
	whiteboxWait(t, p, `location.pathname === "/login" && !!document.querySelector("[data-desktop-sign-in]")`)
	if _, err := p.Eval(`window.__conversationDeepLinkSentinel = "login"`); err != nil {
		t.Fatal(err)
	}
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

	// A conversation link during the cancellable browser handoff must not reload
	// the WebView or bypass the authenticated route guard.
	d.handleOpenURL(link)
	whiteboxWait(t, p, `location.pathname === "/login" && document.querySelector("[data-desktop-sign-in]")?.disabled === true && window.__conversationDeepLinkSentinel === "login"`)
	d.handleOpenURL(desktopLoginRedirectURI + "?" + url.Values{
		"state": {authorization.Query().Get("state")}, "code": {strings.Repeat("c", 43)},
	}.Encode())
	whiteboxWait(t, p, `location.pathname === "/conversations/`+target+`" && window.__conversationDeepLinkSentinel === "login"`)
}

func TestNativeSignedInConversationDeepLinkReplacesPublicPasswordPage(t *testing.T) {
	nativeWhiteboxSession(t, true)
	d := nativeWhitebox.desktop
	d.openMainWindow()
	w := d.mainWindow()
	defer w.Destroy()
	p := w.Page()
	whiteboxWait(t, p, `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli")`)

	// Settings -> Security -> Set up password opens an authenticated public
	// page through a same-document React Router transition.
	if err := p.LoadURL("/settings/security"); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, p, `document.querySelector('a[href="/forgot-password"]') !== null`)
	if _, err := p.Eval(`window.__conversationDeepLinkSentinel = "security"`); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Eval(`document.querySelector('a[href="/forgot-password"]').click()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, p, `location.pathname === "/forgot-password" && window.__conversationDeepLinkSentinel === "security"`)

	const target = "71000000-0000-4000-8000-000000000914"
	link := "linksense-desktop://conversation/" + target
	d.handleOpenURL(link)
	// The link must open at once without reloading the document, and it must
	// not remain queued for a later protected route.
	whiteboxWait(t, p, `location.pathname === "/conversations/`+target+`" && window.__conversationDeepLinkSentinel === "security"`)

	// Leaving the conversation must not replay the delivered link.
	mygo.RunOnMain(func() { d.navigateMainWindow("/conversations/new") })
	whiteboxWait(t, p, `location.pathname === "/conversations/new" && window.__conversationDeepLinkSentinel === "security"`)
	whiteboxWait(t, p, `new Promise(resolve => setTimeout(() => resolve(
		location.pathname === "/conversations/new" &&
		window.__conversationDeepLinkSentinel === "security"), 200))`)
}

func TestNativeConversationDeepLinkSurvivesCancelledSignIn(t *testing.T) {
	const target = "71000000-0000-4000-8000-000000000915"
	nativeDeepLinkSurvivesCancelledSignIn(t, "linksense-desktop://conversation/"+target, `location.pathname === "/conversations/`+target+`"`)
}

func nativeDeepLinkSurvivesCancelledSignIn(t *testing.T, link, arrived string) {
	t.Helper()
	nativeWhiteboxSession(t, false)
	d := nativeWhitebox.desktop
	requests := make(chan string, 4)
	originalBrowser := d.openBrowser
	d.openBrowser = func(raw string) error {
		select {
		case requests <- raw:
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

	d.handleOpenURL(link)
	mygo.RunOnMain(func() {})
	if _, err := p.Eval(`window.__conversationDeepLinkSentinel = "login"`); err != nil {
		t.Fatal(err)
	}
	select {
	case <-requests:
		t.Fatal("the deep link opened a browser without a sign-in action")
	default:
	}
	startSignIn := func() *url.URL {
		if _, err := p.Eval(`(() => {
			const button = document.querySelector("[data-desktop-sign-in]");
			if (!button || button.disabled) throw new Error("sign-in is unavailable");
			button.click();
		})()`); err != nil {
			t.Fatal(err)
		}
		select {
		case raw := <-requests:
			authorization, err := url.Parse(raw)
			if err != nil {
				t.Fatal(err)
			}
			return authorization
		case <-time.After(5 * time.Second):
			t.Fatal("browser sign-in didn't start")
			return nil
		}
	}
	const cancel = `[...document.querySelectorAll("button")].find(button => !button.hasAttribute("data-desktop-sign-in") && ["Cancel", "取消"].includes(button.textContent.trim()))`

	startSignIn()
	whiteboxWait(t, p, cancel+` !== undefined`)
	if _, err := p.Eval(`(() => {
		const button = ` + cancel + `;
		if (!button) throw new Error("Cancel is missing");
		button.click();
	})()`); err != nil {
		t.Fatal(err)
	}
	// Cancel signs out while the browser is still anonymous. The waiting link
	// and the document must survive so the restarted sign-in can open it.
	whiteboxWait(t, p, `location.pathname === "/login" && window.__conversationDeepLinkSentinel === "login" && document.querySelector("[data-desktop-sign-in]")?.disabled === false && `+cancel+` === undefined`)

	authorization := startSignIn()
	d.handleOpenURL(desktopLoginRedirectURI + "?" + url.Values{
		"state": {authorization.Query().Get("state")}, "code": {strings.Repeat("c", 43)},
	}.Encode())
	whiteboxWait(t, p, `(`+arrived+`) && window.__conversationDeepLinkSentinel === "login"`)
}

func TestNativeAuthenticatedConversationDeepLinkSurvivesIndexRedirect(t *testing.T) {
	nativeWhiteboxSession(t, true)
	d := nativeWhitebox.desktop
	d.openMainWindow()
	w := d.mainWindow()
	defer w.Destroy()
	p := w.Page()

	const target = "71000000-0000-4000-8000-000000000903"
	link := "linksense-desktop://conversation/" + target
	// The initial "*/" route redirects to New Task after React mounts. A launch
	// link delivered before that point must still win over the redirect.
	d.handleOpenURL(link)
	whiteboxWait(t, p, `location.pathname === "/conversations/`+target+`"`)
	if _, err := p.Eval(`window.__conversationDeepLinkSentinel = "ready"`); err != nil {
		t.Fatal(err)
	}
	d.handleOpenURL(link)
	whiteboxWait(t, p, `new Promise(resolve => setTimeout(() => resolve(
		location.pathname === "/conversations/`+target+`" &&
		window.__conversationDeepLinkSentinel === "ready"), 200))`)
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

// TestNativeMenuRolesUseTheAppLanguage proves the app catalogs replace MyGo's
// English labels for the menu roles of the three languages MyGo does not
// translate, keeping MyGo's shortcuts. MYGO_LOCALE chooses the language of
// one disposable child process and is never saved; the child asserts on
// Desktop.shellMenus directly. The fixed-scale test above owns zoom roles.
func TestNativeMenuRolesUseTheAppLanguage(t *testing.T) {
	const fixturePath = "LINKSENSE_TEST_MENU_LOCALE"
	if locale := os.Getenv(fixturePath); locale != "" {
		name := mygo.App.Name()
		want := map[string]struct{ file, undo, quit string }{
			"es-ES": {"Archivo", "Deshacer", "Salir de " + name},
			"fr-FR": {"Fichier", "Annuler", "Quitter " + name},
			"pt-BR": {"Arquivo", "Desfazer", "Encerrar " + name},
		}[locale]
		if want.file == "" {
			t.Fatalf("no expected menu labels for %q", locale)
		}
		app, _ := (&Desktop{}).shellMenus(locales.In(locale))
		var file, undo, quit *mygo.MenuItem
		for _, menu := range app.Items() {
			switch menu.Role {
			case mygo.RoleFileMenu:
				file = menu
			case mygo.RoleEditMenu:
				for _, item := range menu.Submenu {
					if item.Role == mygo.RoleUndo {
						undo = item
					}
				}
			case mygo.RoleAppMenu:
				for _, item := range menu.Submenu {
					if item.Role == mygo.RoleQuit {
						quit = item
					}
				}
			}
		}
		if file == nil {
			t.Fatal("the File menu is missing")
		}
		if file.Label != want.file {
			t.Errorf("File menu label = %q, want %q", file.Label, want.file)
		}
		if undo == nil {
			t.Fatal("the Undo menu item is missing")
		}
		if undo.Label != want.undo || undo.Accelerator != "CmdOrCtrl+Z" {
			t.Errorf("Undo = %q %q, want %q with CmdOrCtrl+Z", undo.Label, undo.Accelerator, want.undo)
		}
		if quit == nil {
			t.Fatal("the Quit menu item is missing")
		}
		if quit.Label != want.quit || quit.Accelerator != "Cmd+Q" {
			t.Errorf("Quit = %q %q, want %q with Cmd+Q", quit.Label, quit.Accelerator, want.quit)
		}
		return
	}

	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, locale := range []string{"es-ES", "fr-FR", "pt-BR"} {
		t.Run(locale, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, binary, "-test.v", "-test.run=^TestNativeMenuRolesUseTheAppLanguage$")
			env := make([]string, 0, len(os.Environ())+2)
			for _, entry := range os.Environ() {
				if strings.HasPrefix(entry, "MYGO_LOCALE=") || strings.HasPrefix(entry, fixturePath+"=") {
					continue
				}
				env = append(env, entry)
			}
			cmd.Env = append(env, "MYGO_LOCALE="+locale, fixturePath+"="+locale)
			if result, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("%s menu labels: %v\n%s", locale, err, result)
			}
		})
	}
}
