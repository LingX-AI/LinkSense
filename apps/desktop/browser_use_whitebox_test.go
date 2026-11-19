//go:build desktop_whitebox

package main

import (
	"encoding/json"
	"net/http"
	"sync/atomic"
	"testing"
	"time"
)

type browserUseWhitebox struct {
	connected atomic.Bool
	revoked   atomic.Int32
	pairing   atomic.Int32
}

func (b *browserUseWhitebox) serve(w http.ResponseWriter, r *http.Request) bool {
	switch r.URL.Path {
	case "/api/v1/browser-use/pairing":
		b.pairing.Add(1)
		w.WriteHeader(http.StatusForbidden)
	case "/api/v1/browser-use":
		if cloudAuthorized(w, r) {
			if r.Method == http.MethodDelete {
				b.connected.Store(false)
				b.revoked.Add(1)
			}
			data := map[string]any{"connected": b.connected.Load()}
			if data["connected"] == true {
				data["browser"] = "chrome"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": data})
		}
	default:
		return false
	}
	return true
}

func verifyNativeBrowserUseSettings(t *testing.T) {
	nativeWhiteboxSession(t, true)
	browser := &browserUseWhitebox{}
	nativeWhitebox.browser.Store(browser)
	defer nativeWhitebox.browser.Store(nil)
	desktop := nativeWhitebox.desktop
	previous := desktop.openBrowser
	opened := make(chan string, 1)
	desktop.openBrowser = func(raw string) error {
		opened <- raw
		return nil
	}
	defer func() { desktop.openBrowser = previous }()

	desktop.openMainWindow()
	win := desktop.mainWindow()
	defer win.Destroy()
	page := win.Page()
	const settingsRoute = "/settings/general#browser-extension"
	if err := page.LoadURL(settingsRoute); err != nil {
		t.Fatal(err)
	}
	const card = `document.getElementById("browser-extension")`
	whiteboxWait(t, page, card+`?.innerText.includes("Browser Use disconnected") === true`)
	if _, err := page.Eval(card + ` && [...` + card + `.querySelectorAll("button")].find(button => button.textContent === "Open setup in system browser")?.click()`); err != nil {
		t.Fatal(err)
	}
	select {
	case url := <-opened:
		if url != nativeWhitebox.server.URL+settingsRoute {
			t.Fatal("native setup opened a different address from the configured settings")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the setup button did not reach the native browser opener")
	}

	browser.connected.Store(true)
	if _, err := page.Eval(`window.dispatchEvent(new Event("focus"))`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, card+`?.innerText.includes("Connected · Chrome") === true`)
	if _, err := page.Eval(`[...` + card + `.querySelectorAll("button")].find(button => button.textContent === "Revoke browser access")?.click()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, card+`?.innerText.includes("Browser Use disconnected") === true`)
	if browser.revoked.Load() != 1 || browser.pairing.Load() != 0 {
		t.Fatal("the Mac window must revoke the existing account connection without pairing in the WebView")
	}
}
