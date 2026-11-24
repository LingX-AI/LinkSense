//go:build desktop_whitebox

package main

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

func TestNativeNotificationsDeliverWhileHiddenAndGuardClick(t *testing.T) {
	nativeWhiteboxSession(t, true)
	d := nativeWhitebox.desktop
	supported, show := desktopNativeNotifications, showSystemNotification
	delivered := make(chan mygo.NotificationOptions, 4)
	desktopNativeNotifications = func() bool { return true }
	showSystemNotification = func(ctx context.Context, options mygo.NotificationOptions) error {
		select {
		case delivered <- options:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	defer func() {
		nativeWhitebox.completion.Store(false)
		desktopNativeNotifications, showSystemNotification = supported, show
	}()

	d.openMainWindow()
	win := d.mainWindow()
	defer win.Destroy()
	page := win.Page()
	whiteboxWait(t, page, `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli")`)
	mygo.RunOnMain(func() { d.navigateMainWindow("/settings/general") })
	const toggle = `document.querySelector('[role="switch"][aria-label="Enable macOS notifications"]')`
	whiteboxWait(t, page, toggle+` !== null`)

	select {
	case <-delivered:
		t.Fatal("macOS notification was attempted before the user enabled it")
	default:
	}
	if _, err := page.Eval(toggle + `.click()`); err != nil {
		t.Fatal(err)
	}
	select {
	case notification := <-delivered:
		if notification.ID != testNotificationID {
			t.Fatal("enable did not show the explicit test notification")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("test notification did not reach the native binding")
	}
	whiteboxWait(t, page, toggle+`?.getAttribute("aria-checked") === "true"`)

	win.Hide()
	if win.IsVisible() {
		t.Fatal("the fixture window is still visible")
	}
	nativeWhitebox.completion.Store(true)
	var notification mygo.NotificationOptions
	select {
	case notification = <-delivered:
	case <-time.After(15 * time.Second):
		t.Fatal("hidden WKWebView did not deliver the completed task")
	}
	wantID := d.completionNotificationPrefix() + notificationUserID + ":" + cloudConversation + ":" + cloudTurn
	if notification.ID != wantID || notification.Title != mygo.App.Name() || notification.Body != "Processed successfully" {
		t.Fatalf("unexpected OS notification: %+v", notification)
	}

	// Simulate a second launch opening its initial page, before React mounts.
	win.Destroy()
	d.openMainWindow()
	launchWin := d.mainWindow()
	defer launchWin.Destroy()
	d.handleNotificationClick(notification.ID)
	page = launchWin.Page()
	whiteboxWait(t, page, fmt.Sprintf(`location.pathname === %q`, "/conversations/"+cloudConversation))
	nativePersonalizationDraft(t, page, "Unsaved fixture")

	// Put both clicks through the native bridge. Only the current account may
	// reach the draft blocker; a valid UUID for another account must be ignored.
	otherID := d.completionNotificationPrefix() + "10000000-0000-4000-8000-000000000002:" + cloudConversation + ":" + cloudTurn
	d.handleNotificationClick(otherID)
	mygo.RunOnMain(func() {}) // Flush scheduling before checking the WebView.
	whiteboxWait(t, page, `new Promise(resolve => setTimeout(() => resolve(location.pathname === "/settings/personalization" && !document.querySelector("[role=alertdialog]")), 100))`)
	d.handleNotificationClick(notification.ID)
	whiteboxWait(t, page, `location.pathname === "/settings/personalization" && !!document.querySelector("[role=alertdialog]") && document.querySelector("#custom-instructions").value === "Unsaved fixture"`)
}

// TestNativeUpdateAvailabilityNotificationOpensSettings exercises the real
// WKWebView update notice path. The only synthetic boundary is MyGo's system
// delivery, exactly as the completion-notification fixture above.
func TestNativeUpdateAvailabilityNotificationOpensSettings(t *testing.T) {
	d := nativeWhitebox.desktop
	u, _, _ := newUpdateUI(t, d, true, "")
	supported, show := desktopNativeNotifications, showSystemNotification
	delivered := make(chan mygo.NotificationOptions, 4)
	desktopNativeNotifications = func() bool { return true }
	showSystemNotification = func(ctx context.Context, options mygo.NotificationOptions) error {
		select {
		case delivered <- options:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	defer func() {
		desktopNativeNotifications, showSystemNotification = supported, show
	}()

	page := updateUIOpenSettings(t, d)
	win := d.mainWindow()
	toggle := `document.querySelector('[role="switch"][aria-label="Enable macOS notifications"]')`
	whiteboxWait(t, page, toggle+` !== null`)
	// The completion fixture above can enable notifications in this WebView's
	// persistent storage. Start this fixture from the real opt-out state so the
	// toggle performs the activation and test notice this test asserts. A
	// fresh single-test run usually needs no reload.
	enabled, err := page.Eval(toggle + `?.getAttribute("aria-checked") === "true"`)
	if err != nil {
		t.Fatal(err)
	}
	if enabled == true {
		nativeClearNotificationPreferences(t, page)
		whiteboxReload(t, page)
		whiteboxWait(t, page, `location.pathname === "/settings/general" && document.querySelector("#desktop-update-heading") !== null`)
		whiteboxWait(t, page, toggle+` !== null`)
	}
	if _, err := page.Eval(toggle + `.click()`); err != nil {
		t.Fatal(err)
	}
	select {
	case notification := <-delivered:
		if notification.ID != testNotificationID {
			t.Fatalf("opt-in delivered %q before the update notice", notification.ID)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("enabling notifications did not show its test notification")
	}
	whiteboxWait(t, page, toggle+`?.getAttribute("aria-checked") === "true"`)

	// The WebView keeps running while hidden, as it does when the window is
	// closed to the menu bar. The React path must run with the window genuinely
	// hidden, not with the foreground it reported when opt-in completed.
	win.Hide()
	whiteboxWait(t, page, `document.visibilityState === "hidden" || document.hasFocus() === false`)
	// Test-only, non-sensitive probe: records whether the native event reached
	// the page and whether the page asked the host to show the update notice.
	if _, err := page.Eval(`
		window.__updateNoticeProbe = { events: [], calls: [], results: [] };
		window.__updateNoticeProbeOff = mygo.on("desktop:update-changed", value =>
			window.__updateNoticeProbe.events.push(value));
		try {
			const runtime = window.mygo;
			const callWith = runtime.callWith;
			runtime.callWith = function (method, args, options) {
				const result = callWith.call(runtime, method, args, options);
				if (method === "Desktop.ShowUpdateNotification") {
					window.__updateNoticeProbe.calls.push(args);
					if (result && typeof result.then === "function") {
						result.then(
							() => window.__updateNoticeProbe.results.push("shown"),
							error => window.__updateNoticeProbe.results.push(String(error?.message ?? error)));
					}
				}
				return result;
			};
		} catch {}
		true;
	`); err != nil {
		t.Fatal(err)
	}
	u.check = func(context.Context) (*mygo.Update, error) {
		return &mygo.Update{Version: "0.2.0", Notes: "Do not announce these release notes"}, nil
	}
	result, err := u.checkRequest(context.Background())
	if err != nil || result.State != UpdateAvailable || result.Revision == 0 {
		t.Fatalf("the update fixture did not offer a candidate: %+v, %v", result, err)
	}
	var notification mygo.NotificationOptions
	select {
	case notification = <-delivered:
	case <-time.After(15 * time.Second):
		probe, _ := page.Eval(`JSON.stringify({
			events: window.__updateNoticeProbe?.events ?? [],
			calls: window.__updateNoticeProbe?.calls ?? [],
			results: window.__updateNoticeProbe?.results ?? [],
			visibility: document.visibilityState,
			focused: document.hasFocus(),
		})`)
		t.Fatalf("the hidden WKWebView did not deliver the update notice; probe: %v", probe)
	}
	if notification.ID != updateNotificationID || !notification.Silent ||
		notification.Title != mygo.App.Name() ||
		!strings.Contains(notification.Body, "0.2.0") ||
		strings.Contains(notification.Body, "Do not announce") {
		t.Fatalf("unexpected update notification: %+v", notification)
	}

	// A click on a notification that outlived its run opens only the fixed
	// update section, through the protected launch intent.
	win.Destroy()
	d.openMainWindow()
	launchWin := d.mainWindow()
	defer launchWin.Destroy()
	d.handleNotificationClick(updateNotificationID)
	page = launchWin.Page()
	whiteboxWait(t, page, `location.pathname === "/settings/general" && location.hash === "#desktop-update-heading"`)

	// The same benign action still passes through the existing unsaved-draft
	// blocker; it must not discard the draft or open an installer.
	nativePersonalizationDraft(t, page, "Unsaved update fixture")
	d.handleNotificationClick(updateNotificationID)
	whiteboxWait(t, page, `location.pathname === "/settings/personalization" && !!document.querySelector("[role=alertdialog]") && document.querySelector("#custom-instructions").value === "Unsaved update fixture"`)
}

// nativeClearNotificationPreferences removes only the shared notification
// switch and delivery history, leaving auth and theme storage untouched.
func nativeClearNotificationPreferences(t *testing.T, page *mygo.Page) {
	t.Helper()
	if _, err := page.Eval(`(() => {
		for (const key of Object.keys(localStorage)) {
			if (key.startsWith("linksense.browserNotifications.")) localStorage.removeItem(key);
		}
		return true;
	})()`); err != nil {
		t.Fatal(err)
	}
}

// nativePersonalizationDraft opens the real Settings page and leaves an
// unsaved controlled draft, the same helper path both notification fixtures
// use to exercise the shared navigation blocker.
func nativePersonalizationDraft(t *testing.T, page *mygo.Page, value string) {
	t.Helper()
	if err := page.LoadURL("/settings/personalization"); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.querySelector("#custom-instructions")?.disabled === false`)
	if _, err := page.Eval(fmt.Sprintf(`(() => {
		const field = document.querySelector("#custom-instructions");
		Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, %q);
		field.dispatchEvent(new Event("input", { bubbles: true }));
	})()`, value)); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.querySelector("#custom-instructions")?.form.querySelector("button[type=submit]").disabled === false`)
}
