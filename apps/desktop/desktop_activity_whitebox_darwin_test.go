//go:build desktop_whitebox

package main

import (
	"encoding/json"
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/egoist/mygo"
)

const desktopActivityWhiteboxRoute = "/api/v1/desktop/activity"

// desktopActivityTrigger finds the real disclosure button by its visible
// title. The Web build owns its ids, so this test does not read them.
const desktopActivityTrigger = `Array.from(document.querySelectorAll("button")).find((button) =>
	button.getAttribute("aria-expanded") !== null &&
	(button.textContent || "").trim() === "Recent desktop activity")`

// TestNativeDesktopActivityDisclosureLoadsOnExpand drives the real AppKit and
// WKWebView Settings page through the account-scoped recent desktop activity
// disclosure. Only the synthetic API response is new: opening the disclosure
// must issue one authenticated, queryless read and render the localized row.
func TestNativeDesktopActivityDisclosureLoadsOnExpand(t *testing.T) {
	nativeWhiteboxSession(t, true)

	var gets, unauthorized, unexpected atomic.Int32
	api := nativeWhiteboxAPI(func(w http.ResponseWriter, r *http.Request) bool {
		if r.URL.Path != desktopActivityWhiteboxRoute {
			return false
		}
		if r.Method != http.MethodGet || r.URL.RawQuery != "" || r.URL.ForceQuery {
			unexpected.Add(1)
			w.WriteHeader(http.StatusNotFound)
			return true
		}
		if !cloudAuthorized(w, r) {
			unauthorized.Add(1)
			return true
		}
		gets.Add(1)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true,
			"data": map[string]any{"items": []any{map[string]any{
				"id":         "12345678-1234-4234-8234-123456789abc",
				"created_at": "2026-11-26T08:00:00.000Z",
				"action":     "desktop_device_paired",
				"result":     "success",
			}}},
		})
		return true
	})
	nativeWhitebox.api.Store(&api)
	t.Cleanup(func() { nativeWhitebox.api.Store(nil) })

	desktop := nativeWhitebox.desktop
	desktop.openMainWindowInSession(mygo.NewEphemeralSession())
	win := desktop.mainWindow()
	if win == nil {
		t.Fatal("the native main window was not created")
	}
	t.Cleanup(win.Destroy)
	page := win.Page()
	whiteboxWait(t, page, `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli")`)
	if err := page.LoadURL("/settings/general"); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `location.pathname === "/settings/general" && `+
		`document.querySelector("#desktop-devices-heading") !== null && `+
		`(`+desktopActivityTrigger+`) !== undefined && `+
		`!document.body.innerText.includes("Desktop device paired")`)
	whiteboxWait(t, page, `(`+desktopActivityTrigger+`)?.getAttribute("aria-expanded") === "false"`)
	if got := gets.Load(); got != 0 {
		t.Fatalf("the collapsed disclosure issued %d activity reads", got)
	}
	if got := unauthorized.Load(); got != 0 {
		t.Fatalf("the collapsed disclosure issued %d unauthenticated activity reads", got)
	}
	if got := unexpected.Load(); got != 0 {
		t.Fatalf("the collapsed disclosure issued %d unsupported activity requests", got)
	}

	clicked, err := page.Eval(`(() => {
		const trigger = ` + desktopActivityTrigger + `;
		if (!trigger) return false;
		trigger.click();
		return true;
	})()`)
	if err != nil || clicked != true {
		t.Fatalf("expanding Recent desktop activity: %v (%v)", clicked, err)
	}
	whiteboxWait(t, page, `(() => {
		const trigger = `+desktopActivityTrigger+`;
		if (!trigger || trigger.getAttribute("aria-expanded") !== "true") return false;
		const panel = document.getElementById(trigger.getAttribute("aria-controls") || "");
		return panel !== null && panel.getClientRects().length > 0 &&
			panel.innerText.includes("Desktop device paired") &&
			panel.querySelectorAll("li").length === 1;
	})()`)
	if got := gets.Load(); got != 1 {
		t.Fatalf("the expanded disclosure issued %d authenticated activity reads, want 1", got)
	}
	if got := unauthorized.Load(); got != 0 {
		t.Fatalf("the disclosure issued %d unauthenticated activity reads", got)
	}
	if got := unexpected.Load(); got != 0 {
		t.Fatalf("the disclosure issued %d activity requests with a query or non-GET method", got)
	}
}
