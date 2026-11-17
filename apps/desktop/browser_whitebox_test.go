//go:build desktop_whitebox && desktop_browser_whitebox

package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// This acceptance check is driven through the Codex browser, independently of the native WebView.
func TestNativeBrowserSignInRoundTrip(t *testing.T) {
	desktop := nativeWhitebox.desktop
	dist := os.Getenv("LINKSENSE_DESKTOP_WEB_DIST")
	var browserLogins atomic.Int32
	refreshToken := base64.RawURLEncoding.EncodeToString(randomLoginBytes())
	var grant struct {
		sync.Mutex
		code, state, challenge, redirect string
	}
	exchanged := make(chan struct{}, 2)
	files := http.FileServer(http.Dir(dist))
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			if strings.HasPrefix(r.URL.Path, "/assets/") {
				files.ServeHTTP(w, r)
			} else {
				http.ServeFile(w, r, filepath.Join(dist, "index.html"))
			}
			return
		}
		if r.URL.Path == "/api/v1/auth/login" {
			browserLogins.Add(1)
		}
		if r.URL.Path == "/api/v1/auth/desktop/authorize" {
			var input struct {
				Redirect  string `json:"redirect_uri"`
				State     string `json:"state"`
				Challenge string `json:"code_challenge"`
				Method    string `json:"code_challenge_method"`
			}
			if r.Method != http.MethodPost ||
				r.Header.Get("Authorization") != "Bearer browser-test-access-token-0000000000000000" ||
				json.NewDecoder(r.Body).Decode(&input) != nil || input.Method != "S256" || input.Redirect != desktopLoginRedirectURI ||
				!loginProof.MatchString(input.State) || !loginProof.MatchString(input.Challenge) {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			grant.Lock()
			grant.code = base64.RawURLEncoding.EncodeToString(randomLoginBytes())
			grant.state, grant.challenge, grant.redirect = input.State, input.Challenge, input.Redirect
			code := grant.code
			grant.Unlock()
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("x-linksense-build", r.Header.Get("x-linksense-client-build"))
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": map[string]string{"code": code}})
			return
		}
		if r.URL.Path == "/api/v1/auth/desktop/exchange" {
			var input struct {
				Code     string `json:"code"`
				Verifier string `json:"code_verifier"`
				Redirect string `json:"redirect_uri"`
			}
			if json.NewDecoder(r.Body).Decode(&input) != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			hash := sha256.Sum256([]byte(input.Verifier))
			grant.Lock()
			valid := input.Code == grant.code && grant.code != "" && input.Redirect == grant.redirect &&
				base64.RawURLEncoding.EncodeToString(hash[:]) == grant.challenge
			grant.code = ""
			grant.Unlock()
			if !valid {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			defer func() { exchanged <- struct{}{} }()
		}
		serveWhiteboxAPI(w, r, refreshToken)
	}))
	defer api.Close()
	server, _ := url.Parse(api.URL)
	store := &memoryCredentialStore{}
	desktop.configure(server, store, t.TempDir())
	urlFile := filepath.Join(t.TempDir(), "authorization-url")
	callbackSignalFile := filepath.Join(filepath.Dir(urlFile), "deliver-callback")
	desktop.openBrowser = func(raw string) error {
		return os.WriteFile(urlFile, []byte(raw), 0o600)
	}
	desktop.openMainWindow()
	win := desktop.mainWindow()
	defer win.Destroy()
	page := win.Page()
	fmt.Printf("BROWSER_WHITEBOX_URL_FILE=%s\n", urlFile)
	for attempt := 1; attempt <= 2; attempt++ {
		if attempt == 2 {
			if _, err := page.Eval(`mygo.call("Desktop.ClearSession")`); err != nil {
				t.Fatal(err)
			}
			whiteboxReload(t, page)
		}
		whiteboxWait(t, page, `document.querySelector("[data-desktop-sign-in]") !== null`)
		if _, err := page.Eval(`document.querySelector("[data-desktop-sign-in]").click()`); err != nil {
			t.Fatal(err)
		}
		fmt.Printf("BROWSER_WHITEBOX_ATTEMPT=%d\n", attempt)
		// After observing the link in the browser, the driver simulates OS delivery.
		// Never copy the authorization code to the filesystem or change app associations.
		deadline := time.Now().Add(4 * time.Minute)
		for {
			if _, err := os.Stat(callbackSignalFile); err == nil {
				_ = os.Remove(callbackSignalFile)
				grant.Lock()
				callback := url.Values{"code": {grant.code}, "state": {grant.state}}.Encode()
				grant.Unlock()
				desktop.handleOpenURL(desktopLoginRedirectURI + "?" + callback)
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("the external browser did not provide the app link")
			}
			time.Sleep(100 * time.Millisecond)
		}
		select {
		case <-exchanged:
		case <-time.After(10 * time.Second):
			t.Fatal("the app link did not complete sign-in")
		}
		whiteboxWait(t, page, `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli")`)
		if !storeHasSession(store) {
			t.Fatal("browser handoff did not populate the native credential store")
		}
		if logins := browserLogins.Load(); logins != 1 {
			t.Fatalf("sign-in attempt %d: password submissions=%d, want exactly one across both attempts", attempt, logins)
		}
	}
}
