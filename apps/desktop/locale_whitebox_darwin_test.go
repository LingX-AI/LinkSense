//go:build desktop_whitebox

package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
	"github.com/egoist/mygo"
)

const localeWhiteboxFixture = "LINKSENSE_TEST_LOCALE_WHITEBOX"

func runLocaleWhiteboxChild(t *testing.T, testName string) {
	t.Helper()
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 60*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, "-test.v", "-test.run=^"+testName+"$")
	env := make([]string, 0, len(os.Environ())+2)
	for _, entry := range os.Environ() {
		if strings.HasPrefix(entry, "MYGO_LOCALE=") || strings.HasPrefix(entry, localeWhiteboxFixture+"=") {
			continue
		}
		env = append(env, entry)
	}
	// MYGO_LOCALE keeps the one-run override from being saved as the app's
	// language, so the fixture never writes this Mac's LinkSense preferences.
	cmd.Env = append(env, "MYGO_LOCALE=zh-CN", localeWhiteboxFixture+"=1")
	if result, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%s locale fixture: %v\n%s", testName, err, result)
	}
}

func waitNativeLocale(t *testing.T, want string) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if mygo.App.Locale() == want {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("native app language = %q, want %q", mygo.App.Locale(), want)
}

// TestNativeSavedLanguageSyncsTheApp proves an upgraded install's saved Web
// preference beats the native startup language and is applied to the real
// WKWebView app without being erased or requiring the user to choose again.
func TestNativeSavedLanguageSyncsTheApp(t *testing.T) {
	if os.Getenv(localeWhiteboxFixture) == "" {
		runLocaleWhiteboxChild(t, "TestNativeSavedLanguageSyncsTheApp")
		return
	}
	nativeWhiteboxSession(t, false)
	d := nativeWhitebox.desktop
	// An ephemeral session keeps this fixture's localStorage off both the
	// installed app and the other whitebox pages.
	d.openMainWindowInSession(mygo.NewEphemeralSession())
	win := d.mainWindow()
	if win == nil {
		t.Fatal("the main window did not open")
	}
	t.Cleanup(win.Destroy)
	page := win.Page()
	whiteboxWait(t, page, `location.pathname === "/login" && document.documentElement.lang === "zh-CN"`)
	if _, err := page.Eval(`localStorage.setItem("linksense.language", "en-US")`); err != nil {
		t.Fatal(err)
	}

	whiteboxReload(t, page)

	whiteboxWait(t, page, `location.pathname === "/login" && document.documentElement.lang === "en-US"`)
	waitNativeLocale(t, "en-US")
	stored, err := page.Eval(`localStorage.getItem("linksense.language")`)
	if err != nil {
		t.Fatal(err)
	}
	if stored != "en-US" {
		t.Fatalf("the saved Web preference was erased: %v", stored)
	}
}

// TestNativeLanguageReachesTheSharedUiWithoutPersisting proves a native or
// system language change reaches the logged-out shared UI through MyGo's
// onLocaleChange event without being saved as a user selection, that a
// successful IPC reply already means the app language and the installed app
// menu changed, and that a non-catalog tag is rejected before it can change
// the app.
func TestNativeLanguageReachesTheSharedUiWithoutPersisting(t *testing.T) {
	if os.Getenv(localeWhiteboxFixture) == "" {
		runLocaleWhiteboxChild(t, "TestNativeLanguageReachesTheSharedUiWithoutPersisting")
		return
	}
	nativeWhiteboxSession(t, false)
	d := nativeWhitebox.desktop
	d.openMainWindowInSession(mygo.NewEphemeralSession())
	win := d.mainWindow()
	if win == nil {
		t.Fatal("the main window did not open")
	}
	t.Cleanup(win.Destroy)
	page := win.Page()
	whiteboxWait(t, page, `location.pathname === "/login" && document.documentElement.lang === "zh-CN"`)

	// Install the app's real shell so the menu assertions observe the installed
	// menu MyGo rebuilt, not one this test built directly.
	root, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		t.Fatal(err)
	}
	mygo.RunOnMain(func() { d.installShell(root) })
	installedMenu := func() *mygo.Menu {
		menu := mygo.App.Menu()
		if menu == nil {
			t.Fatal("the app menu was not installed")
		}
		return menu
	}
	zh := locales.In("zh-CN")
	if item := installedMenu().ItemByID("settings"); item == nil || item.Label != zh.Preferences() {
		t.Fatalf("the installed app menu did not start in the app language: %+v", item)
	}

	changed := make(chan string, 2)
	off := mygo.App.OnLocaleChanged(func(locale string) {
		select {
		case changed <- locale:
		default:
		}
	})
	t.Cleanup(off)

	result, err := page.Eval(`mygo.call("Desktop.SetLocale", "ja-JP").then(() => "ok", (error) => String(error))`)
	if err != nil || result != "ok" {
		t.Fatalf("Desktop.SetLocale = %v, %v", result, err)
	}
	// The reply leaves Go only after the main-thread apply, so read the
	// language and the installed menu now: polling would hide a late apply.
	if got := mygo.App.Locale(); got != "ja-JP" {
		t.Fatalf("the IPC reply arrived before the app language applied: %q", got)
	}
	if got := mygo.App.ChosenLocale(); got != "ja-JP" {
		t.Fatalf("the IPC reply arrived before the choice was kept: %q", got)
	}
	ja := locales.In("ja-JP")
	if item := installedMenu().ItemByID("settings"); item == nil || item.Label != ja.Preferences() {
		t.Fatalf("the installed app menu was not replaced on the locale change: %+v", item)
	}
	whiteboxWait(t, page, `document.documentElement.lang === "ja-JP" && mygo.locale === "ja-JP"`)
	select {
	case locale := <-changed:
		if locale != "ja-JP" {
			t.Fatalf("native locale change = %q, want ja-JP", locale)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the native locale change was not observed")
	}
	stored, err := page.Eval(`localStorage.getItem("linksense.language") === null`)
	if err != nil || stored != true {
		t.Fatalf("a native-origin language was persisted: %v, %v", stored, err)
	}

	// A reload starts from the native runtime language, not from Web storage.
	whiteboxReload(t, page)
	whiteboxWait(t, page, `location.pathname === "/login" && document.documentElement.lang === "ja-JP" && localStorage.getItem("linksense.language") === null`)

	result, err = page.Eval(`mygo.call("Desktop.SetLocale", "de-DE").then(() => "accepted", (error) => String(error))`)
	if err != nil {
		t.Fatal(err)
	}
	if text := fmt.Sprint(result); !strings.Contains(text, "VALIDATION_ERROR") {
		t.Fatalf("unsupported language result = %q, want VALIDATION_ERROR", text)
	}
	if got := mygo.App.Locale(); got != "ja-JP" {
		t.Fatalf("an unsupported language changed the app: %q", got)
	}
	whiteboxWait(t, page, `document.documentElement.lang === "ja-JP"`)
}
