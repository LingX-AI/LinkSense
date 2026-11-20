//go:build desktop_whitebox

package main

import (
	"context"
	"fmt"
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
	if err := page.LoadURL("/settings/personalization"); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.querySelector("#custom-instructions")?.disabled === false`)
	if _, err := page.Eval(`(() => {
		const field = document.querySelector("#custom-instructions");
		Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, "Unsaved fixture");
		field.dispatchEvent(new Event("input", { bubbles: true }));
	})()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.querySelector("#custom-instructions")?.form.querySelector("button[type=submit]").disabled === false`)

	// Put both clicks through the native bridge. Only the current account may
	// reach the draft blocker; a valid UUID for another account must be ignored.
	otherID := d.completionNotificationPrefix() + "10000000-0000-4000-8000-000000000002:" + cloudConversation + ":" + cloudTurn
	d.handleNotificationClick(otherID)
	mygo.RunOnMain(func() {}) // Flush scheduling before checking the WebView.
	whiteboxWait(t, page, `new Promise(resolve => setTimeout(() => resolve(location.pathname === "/settings/personalization" && !document.querySelector("[role=alertdialog]")), 100))`)
	d.handleNotificationClick(notification.ID)
	whiteboxWait(t, page, `location.pathname === "/settings/personalization" && !!document.querySelector("[role=alertdialog]") && document.querySelector("#custom-instructions").value === "Unsaved fixture"`)
}
