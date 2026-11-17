//go:build desktop_whitebox && desktop_browser_whitebox

package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

// This acceptance check uses the built Web application in an external browser.
func TestNativeBrowserSignInRoundTrip(t *testing.T) {
	desktop := nativeWhitebox.desktop
	dist := os.Getenv("LINKSENSE_DESKTOP_WEB_DIST")
	osDriver := os.Getenv("LINKSENSE_DESKTOP_BROWSER_OS_DRIVER")
	deadline := time.Now().Add(8 * time.Minute)
	if osDriver != "" {
		deadline = time.Now().Add(time.Minute)
	}
	if fatalDeadline, ok := t.Deadline(); ok && fatalDeadline.Add(-15*time.Second).Before(deadline) {
		deadline = fatalDeadline.Add(-15 * time.Second)
	}
	ctx, cancel := context.WithDeadline(t.Context(), deadline)
	defer cancel()
	var browserLogins atomic.Int32
	var nativeRefreshes atomic.Int32
	var browserAuthorizations atomic.Int32
	refreshToken := base64.RawURLEncoding.EncodeToString(randomLoginBytes())
	browserCookieName := "linksense_whitebox_" + refreshToken[:20]
	var grant struct {
		sync.Mutex
		code, state, challenge, redirect string
	}
	saveGrant := func(state, challenge, redirect string) string {
		grant.Lock()
		defer grant.Unlock()
		grant.code = base64.RawURLEncoding.EncodeToString(randomLoginBytes())
		grant.state, grant.challenge, grant.redirect = state, challenge, redirect
		return grant.code
	}
	exchanged := make(chan struct{}, 2)
	files := http.FileServer(http.Dir(dist))
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if osDriver != "" && r.URL.Path == "/desktop/authorize" {
			// The browser supplies the session cookie. The fixture hands the
			// code to Launch Services explicitly instead of publishing a link
			// that a different installed app might open.
			query := r.URL.Query()
			redirect, state, challenge := query.Get("redirect_uri"), query.Get("state"), query.Get("code_challenge")
			if r.Method != http.MethodGet || !strings.Contains(r.Header.Get("Accept"), "text/html") ||
				redirect != desktopLoginRedirectURI || query.Get("code_challenge_method") != "S256" ||
				!loginProof.MatchString(state) || !loginProof.MatchString(challenge) {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			if cookie, err := r.Cookie(browserCookieName); err != nil || cookie.Value != refreshToken {
				browserLogins.Add(1)
				http.SetCookie(w, &http.Cookie{
					Name: browserCookieName, Value: refreshToken, Path: "/desktop/authorize",
					HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 300,
				})
			} else {
				http.SetCookie(w, &http.Cookie{
					Name: browserCookieName, Path: "/desktop/authorize", HttpOnly: true,
					SameSite: http.SameSiteLaxMode, MaxAge: -1,
				})
			}
			browserAuthorizations.Add(1)
			saveGrant(state, challenge, redirect)
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			_, _ = w.Write([]byte("LinkSense browser fixture authorized the isolated test app."))
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			if strings.HasPrefix(r.URL.Path, "/assets/") {
				files.ServeHTTP(w, r)
			} else {
				http.ServeFile(w, r, filepath.Join(dist, "index.html"))
			}
			return
		}
		cookieName := refreshCookieName
		if r.Header.Get("X-Linksense-Desktop-Protocol") == "" {
			cookieName = browserCookieName
			if r.URL.Path == "/api/v1/auth/login" {
				browserLogins.Add(1)
			}
		} else if r.URL.Path == "/api/v1/auth/refresh" {
			if cookie, err := r.Cookie(cookieName); err == nil && cookie.Value == refreshToken {
				nativeRefreshes.Add(1)
			}
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
			code := saveGrant(input.State, input.Challenge, input.Redirect)
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
		serveWhiteboxAPI(w, r, cookieName, refreshToken)
	}))
	defer api.Close()
	server, _ := url.Parse(api.URL)
	var store credentialStore = &memoryCredentialStore{}
	var bundle string
	if osDriver != "" {
		executable, err := os.Executable()
		if err != nil {
			t.Fatal("OS browser whitebox executable is unavailable")
		}
		bundle = filepath.Dir(filepath.Dir(filepath.Dir(executable)))
		if runtime.GOOS != "darwin" || !filepath.IsAbs(osDriver) || !strings.HasSuffix(bundle, ".app") {
			t.Fatal("OS browser whitebox requires a macOS test bundle and an absolute helper path")
		}
		service := os.Getenv("LINKSENSE_DESKTOP_BROWSER_KEYCHAIN_SERVICE")
		if !regexp.MustCompile(`^org\.linksense\.desktop\.browser-whitebox\.[a-f0-9-]{36}\.credentials$`).MatchString(service) {
			t.Fatal("OS browser whitebox requires an isolated parent-owned Keychain service")
		}
		store = mygo.Secrets.Service(service)
		t.Cleanup(mygo.App.OnOpenURL(desktop.handleOpenURL))
	}
	desktop.configure(server, store, t.TempDir())
	t.Cleanup(func() {
		if err := store.Delete(desktop.session.secretKey()); err != nil {
			t.Error("could not remove the isolated whitebox credential")
		}
	})
	urlFile := filepath.Join(t.TempDir(), "authorization-url")
	callbackSignalFile := filepath.Join(filepath.Dir(urlFile), "deliver-callback")
	desktop.openBrowser = func(raw string) error {
		if osDriver != "" {
			return mygo.Shell.OpenExternal(raw)
		}
		return os.WriteFile(urlFile, []byte(raw), 0o600)
	}
	desktop.openMainWindow()
	win := desktop.mainWindow()
	defer win.Destroy()
	page := win.Page()
	if osDriver == "" {
		fmt.Printf("BROWSER_WHITEBOX_URL_FILE=%s\n", urlFile)
	} else {
		fmt.Printf("BROWSER_WHITEBOX_ORIGIN=%s\n", api.URL)
	}
	for attempt := 1; attempt <= 2; attempt++ {
		if attempt == 2 {
			if _, err := page.EvalContext(ctx, `mygo.call("Desktop.ClearSession")`); err != nil {
				t.Fatal(err)
			}
			whiteboxReloadContext(t, ctx, page)
		}
		whiteboxWaitContext(t, ctx, page, `document.querySelector("[data-desktop-sign-in]") !== null`)
		if _, err := page.EvalContext(ctx, `document.querySelector("[data-desktop-sign-in]").click()`); err != nil {
			t.Fatal(err)
		}
		fmt.Printf("BROWSER_WHITEBOX_ATTEMPT=%d\n", attempt)
		var callback string
		for {
			// Pass the callback in memory. In OS mode, Launch Services targets the
			// test bundle explicitly so a user's installed app never receives it.
			_, signalErr := os.Stat(callbackSignalFile)
			grant.Lock()
			if grant.code != "" && (osDriver != "" || signalErr == nil) {
				callback = desktopLoginRedirectURI + "?" + url.Values{"code": {grant.code}, "state": {grant.state}}.Encode()
			}
			grant.Unlock()
			if callback != "" {
				break
			}
			select {
			case <-ctx.Done():
				t.Fatal("the external browser did not provide the app link")
			case <-time.After(100 * time.Millisecond):
			}
		}
		if osDriver == "" {
			_ = os.Remove(callbackSignalFile)
			desktop.handleOpenURL(callback)
		} else {
			dispatchContext, stop := context.WithTimeout(ctx, 10*time.Second)
			command := exec.CommandContext(dispatchContext, osDriver, bundle, strconv.Itoa(os.Getpid()))
			command.Stdin = strings.NewReader(callback)
			err := command.Run()
			stop()
			if err != nil {
				t.Fatal("Launch Services did not deliver to the running test bundle")
			}
		}
		select {
		case <-exchanged:
		case <-ctx.Done():
			t.Fatal("the browser sign-in deadline expired")
		case <-time.After(10 * time.Second):
			t.Fatal("the app link did not complete sign-in")
		}
		whiteboxWaitContext(t, ctx, page, `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli")`)
		if _, err := store.Get(desktop.session.secretKey()); err != nil {
			t.Fatal("browser handoff did not populate the native credential store")
		}
		if osDriver != "" && os.Getenv("LINKSENSE_DESKTOP_BROWSER_FORCE_EXIT_AFTER_STORE") == "1" {
			os.Exit(23) // Bypass t.Cleanup to verify the parent's crash cleanup.
		}
		if logins := browserLogins.Load(); logins != 1 {
			t.Fatalf("sign-in attempt %d: browser session starts=%d, want exactly one across both attempts", attempt, logins)
		}
	}
	if osDriver != "" && browserAuthorizations.Load() != 2 {
		t.Fatal("the system browser did not complete both authorization requests")
	}
	before := nativeRefreshes.Load()
	whiteboxReloadContext(t, ctx, page)
	whiteboxWaitContext(t, ctx, page, `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli")`)
	if nativeRefreshes.Load() <= before {
		t.Fatal("browser sign-in did not leave a reusable native session")
	}
	if osDriver != "" {
		if _, err := page.EvalContext(ctx, `mygo.call("Desktop.ClearSession")`); err != nil {
			t.Fatal("could not sign the isolated test app out")
		}
		if _, err := store.Get(desktop.session.secretKey()); err != mygo.ErrSecretNotFound {
			t.Fatal("sign-out did not remove the Keychain entry")
		}
	}
}
