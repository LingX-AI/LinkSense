//go:build desktop_whitebox

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/fetch"
)

var nativeWhitebox struct {
	desktop  *Desktop
	store    *memoryCredentialStore
	server   *httptest.Server
	logins   atomic.Int32
	refresh  atomic.Int32
	protocol atomic.Int32
	cloud    atomic.Pointer[cloudWhitebox]
	browser  atomic.Pointer[browserUseWhitebox]
}

// The real platform WebView runs on the main thread; fixtures never use an account or a GUI automation permission.
func TestMain(m *testing.M) {
	dist := os.Getenv("LINKSENSE_DESKTOP_WEB_DIST")
	if !filepath.IsAbs(dist) {
		fmt.Fprintln(os.Stderr, "LINKSENSE_DESKTOP_WEB_DIST must select a built shared Web UI")
		os.Exit(1)
	}
	if _, err := os.Stat(filepath.Join(dist, "index.html")); err != nil {
		fmt.Fprintln(os.Stderr, "Shared Web build is missing")
		os.Exit(1)
	}
	mygo.App.SetName("LinkSense Desktop Whitebox")
	mygo.App.OnWindowAllClosed(func() {})
	mygo.SetFrontend(os.DirFS(dist))
	dataRoot, err := os.MkdirTemp("", "linksense-native-whitebox-")
	if err != nil {
		fmt.Fprintln(os.Stderr, "Native whitebox data directory is unavailable")
		os.Exit(1)
	}
	mygo.App.SetPath(mygo.PathUserData, dataRoot)
	nativeWhitebox.store = &memoryCredentialStore{}
	nativeWhitebox.protocol.Store(1)
	nativeWhitebox.server = httptest.NewServer(http.HandlerFunc(whiteboxAPI))
	server, _ := url.Parse(nativeWhitebox.server.URL)
	nativeWhitebox.desktop = &Desktop{}
	nativeWhitebox.desktop.configure(server, nativeWhitebox.store, dataRoot)
	nativeWhitebox.desktop.openBrowser = func(raw string) error {
		authorization, err := url.Parse(raw)
		if err != nil || authorization.Path != "/desktop/authorize" || authorization.Query().Get("redirect_uri") != desktopLoginRedirectURI {
			return fmt.Errorf("unexpected browser authorization destination")
		}
		callback := url.Values{
			"state": {authorization.Query().Get("state")},
			"code":  {strings.Repeat("c", 43)},
		}.Encode()
		nativeWhitebox.desktop.handleOpenURL(desktopLoginRedirectURI + "?" + callback)
		return nil
	}
	mygo.Bind(nativeWhitebox.desktop)
	mygo.Use(fetch.New(fetch.Options{
		Client: &http.Client{
			Transport:     &configuredTransport{desktop: nativeWhitebox.desktop},
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		Allow: func(request *http.Request) bool {
			return nativeWhitebox.desktop.checkCaller(request.Context()) == nil &&
				request.URL.Path != desktopLoginExchangePath &&
				allowsAPIRequest(nativeWhitebox.desktop.server, request)
		},
	}))
	exitCode := make(chan int, 1)
	mygo.App.WhenReady(func() {
		go func() {
			exitCode <- m.Run()
			mygo.App.Quit()
		}()
	})
	err = mygo.App.Run()
	nativeWhitebox.server.Close()
	_ = os.RemoveAll(dataRoot)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Native whitebox application failed")
		os.Exit(1)
	}
	os.Exit(<-exitCode)
}

func whiteboxAPI(w http.ResponseWriter, r *http.Request) {
	serveWhiteboxAPI(w, r, refreshCookieName, strings.Repeat("a", 64))
}

func serveWhiteboxAPI(w http.ResponseWriter, r *http.Request, cookieName, refreshToken string) {
	if r.URL.Path == "/api/v1/desktop/devices/socket" {
		socket, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer socket.CloseNow()
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		_, data, err := socket.Read(ctx)
		var hello struct {
			Type            string `json:"type"`
			Token           string `json:"token"`
			ProtocolVersion int    `json:"protocol_version"`
		}
		if err != nil || json.Unmarshal(data, &hello) != nil ||
			hello.Type != "hello" || hello.Token != deviceFixtureCredential().Token || hello.ProtocolVersion != 1 {
			_ = socket.Close(websocket.StatusCode(4401), "")
			return
		}
		if sendDeviceReady(ctx, socket, deviceFixtureCredential().DeviceID) != nil {
			return
		}
		for {
			_, data, err = socket.Read(ctx)
			if err != nil || string(data) != `{"type":"ping"}` {
				return
			}
			if socket.Write(ctx, websocket.MessageText, []byte(`{"type":"pong"}`)) != nil {
				return
			}
		}
	}
	if r.URL.Path == "/native-frame-probe" {
		w.Header().Set("Content-Type", "text/html")
		_, _ = fmt.Fprint(w, `<!doctype html><script>
			let parentBlocked = false;
			try { parent.mygo.call("Desktop.ClearSession"); } catch { parentBlocked = true; }
			parent.postMessage({type: "native-frame-probe", hostAvailable: !!window.mygo, parentBlocked}, "*");
		</script>`)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("x-linksense-build", strings.Repeat("b", 64))
	protocol := fmt.Sprint(nativeWhitebox.protocol.Load())
	w.Header().Set("x-linksense-desktop-protocol", protocol)
	if r.Header.Get("x-linksense-desktop-protocol") == "" {
		w.Header().Set("x-linksense-build", r.Header.Get("x-linksense-client-build"))
	} else if r.Header.Get("x-linksense-desktop-protocol") != protocol || r.Header.Get("x-linksense-client-build") != strings.Repeat("0", 64) {
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]any{"success": false, "error_code": "DESKTOP_UPDATE_REQUIRED"})
		return
	}
	if cloud := nativeWhitebox.cloud.Load(); cloud != nil && cloud.serve(w, r) {
		return
	}
	if browser := nativeWhitebox.browser.Load(); browser != nil && browser.serve(w, r) {
		return
	}
	data := any(map[string]any{"items": []any{}, "next_cursor": nil})
	user := map[string]any{
		"id": "10000000-0000-4000-8000-000000000001", "name": "Eli", "email": "eli@example.com",
		"role": "admin", "status": "active", "avatar_url": nil, "avatar_object_key": nil,
		"preferred_locale": "en-US", "language": "en-US", "running_message_action": "queue",
		"registration_source": "organization_invitation",
		"last_login_at":       "2026-07-11T08:00:00Z", "last_login_method": "password",
		"password_updated_at": "2026-07-11T08:00:00Z",
		"created_at":          "2026-07-11T08:00:00Z", "updated_at": "2026-07-11T08:00:00Z",
	}
	switch r.URL.Path {
	case "/api/v1/system/bootstrap":
		data = map[string]any{"initialized": true, "system_name": "LinkSense", "default_language": "en-US"}
	case "/api/v1/auth/login", desktopLoginExchangePath, "/api/v1/auth/refresh":
		if r.URL.Path == "/api/v1/auth/refresh" {
			cookie, err := r.Cookie(cookieName)
			if err != nil || cookie.Value != refreshToken {
				w.WriteHeader(http.StatusUnauthorized)
				_ = json.NewEncoder(w).Encode(map[string]any{"success": false, "error_code": "AUTH_SESSION_EXPIRED"})
				return
			}
			nativeWhitebox.refresh.Add(1)
		} else {
			nativeWhitebox.logins.Add(1)
		}
		http.SetCookie(w, &http.Cookie{
			Name: cookieName, Value: refreshToken,
			Path: "/api/v1/auth", HttpOnly: true, MaxAge: 3600,
		})
		if r.URL.Path == desktopLoginExchangePath {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		authUser := maps.Clone(user)
		for _, key := range []string{"avatar_url", "language", "registration_source"} {
			delete(authUser, key)
		}
		data = map[string]any{
			"access_token":               "browser-test-access-token-0000000000000000",
			"access_token_expires_at":    time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
			"refresh_session_expires_at": time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339),
			"user":                       authUser,
		}
	case "/api/v1/me":
		data = user
	case "/api/v1/auth/social/providers":
		data = map[string]any{"providers": []any{}}
	case "/api/v1/desktop/devices/pair":
		var input struct {
			Code         string             `json:"code"`
			Name         string             `json:"name"`
			Platform     string             `json:"platform"`
			Arch         string             `json:"arch"`
			AppVersion   string             `json:"app_version"`
			Capabilities deviceCapabilities `json:"capabilities"`
		}
		if json.NewDecoder(r.Body).Decode(&input) != nil || input.Code != strings.Repeat("b", 32) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		credential := deviceFixtureCredential()
		data = map[string]any{
			"token": credential.Token, "owner_id": credential.OwnerID,
			"device": publicDevice{
				ID: credential.DeviceID, Name: input.Name, Platform: input.Platform, Arch: input.Arch,
				AppVersion: input.AppVersion, CreatedAt: time.Now(), UpdatedAt: time.Now(),
			},
		}
	case "/api/v1/projects":
		data = []any{}
	case "/api/v1/me/model-preference":
		data = map[string]any{
			"configured": false, "models": []any{}, "default_model": nil,
			"selected_model": nil, "selected_reasoning_effort": nil,
		}
	case "/api/v1/me/personalization":
		data = map[string]any{
			"custom_instructions": "", "memories_enabled": false,
			"task_auto_naming": "first_message", "show_reasoning": false,
		}
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": data})
}

func whiteboxWait(t *testing.T, page *mygo.Page, expression string) {
	t.Helper()
	whiteboxWaitContext(t, t.Context(), page, expression)
}

func whiteboxWaitContext(t *testing.T, parent context.Context, page *mygo.Page, expression string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(parent, 25*time.Second)
	defer cancel()
	var last any
	for ctx.Err() == nil {
		value, err := page.EvalContext(ctx, expression)
		if err == nil && value == true {
			return
		}
		last = value
		select {
		case <-ctx.Done():
		case <-time.After(100 * time.Millisecond):
		}
	}
	diagnostic, stop := context.WithTimeout(parent, time.Second)
	defer stop()
	body, _ := page.EvalContext(diagnostic, "document.body.innerText.slice(0, 1500)")
	host, _ := page.EvalContext(diagnostic, `mygo.call("Desktop.Info").then(info => ({bridgeVersion: info.bridgeVersion, platform: info.platform, version: info.version})).catch(error => ({error: String(error)}))`)
	t.Fatalf("native page condition failed: %s; last=%v; host=%v; body=%v", expression, last, host, body)
}

func whiteboxReload(t *testing.T, page *mygo.Page) {
	t.Helper()
	whiteboxReloadContext(t, t.Context(), page)
}

func whiteboxReloadContext(t *testing.T, ctx context.Context, page *mygo.Page) {
	t.Helper()
	ready := make(chan struct{}, 1)
	off := page.OnDOMReady(func() {
		select {
		case ready <- struct{}{}:
		default:
		}
	})
	defer off()
	page.Reload()
	select {
	case <-ready:
	case <-ctx.Done():
		t.Fatal("the native WebView reload deadline expired")
	case <-time.After(10 * time.Second):
		t.Fatal("the native WebView did not reload its document")
	}
}

func nativeWhiteboxSession(t *testing.T, signedIn bool) {
	t.Helper()
	session := nativeWhitebox.desktop.session
	if err := session.clearSession(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := session.clearSession(); err != nil {
			t.Error(err)
		}
		nativeWhitebox.protocol.Store(1)
	})
	if !signedIn {
		return
	}
	refresh, err := json.Marshal(storedRefreshSession{
		Token: strings.Repeat("a", 64), ExpiresAt: time.Now().Add(time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := nativeWhitebox.store.Set(session.secretKey(), refresh); err != nil {
		t.Fatal(err)
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	if err := session.allowNewSession(); err != nil {
		t.Fatal(err)
	}
}

func TestNativeSharedUILoginAndSecureSessionRestore(t *testing.T) {
	nativeWhiteboxSession(t, false)
	nativeWhitebox.logins.Store(0)
	desktop := nativeWhitebox.desktop
	desktop.openMainWindow()
	win := desktop.mainWindow()
	defer win.Destroy()
	page := win.Page()
	whiteboxWait(t, page, `document.querySelector("[data-desktop-sign-in]") !== null`)
	policy, err := page.Eval(`document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content.includes("script-src 'self' 'wasm-unsafe-eval'") === true`)
	if err != nil || policy != true {
		t.Fatal("the embedded UI lost the shared Web content security policy")
	}
	if _, err := page.Eval(`
		if (document.querySelector("#login-email") || document.querySelector('input[type="password"]'))
			throw new Error("desktop retained its embedded password login");
		document.querySelector("[data-desktop-sign-in]").click();
	`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli")`)
	if nativeWhitebox.logins.Load() != 1 || !storeHasSession(nativeWhitebox.store) {
		t.Fatal("shared login did not use the native credential store")
	}
	stored, err := page.Eval(`localStorage.getItem("linksense.auth.access-session")`)
	if err != nil || stored != nil {
		t.Fatal("desktop access token was persisted in WebView storage")
	}
	before := nativeWhitebox.refresh.Load()
	whiteboxReload(t, page)
	whiteboxWait(t, page, `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli")`)
	if nativeWhitebox.refresh.Load() <= before {
		t.Fatal("reloading the shared UI did not restore the native refresh session")
	}
	info, err := page.Eval(`mygo.call("Desktop.Info").then(info => info.bridgeVersion === 1)`)
	if err != nil || info != true {
		t.Fatal("generated native host API is unavailable")
	}
	nativeWhitebox.protocol.Store(2)
	whiteboxReload(t, page)
	whiteboxWait(t, page, `document.querySelector('[role="dialog"]') !== null && document.body.innerText.includes("incompatible")`)
	if _, err := page.Eval(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(button => button.textContent.trim() === "Check for updates")?.click()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.body.innerText.includes("This installation cannot check for updates.")`)
	nativeWhitebox.protocol.Store(1)
	whiteboxReload(t, page)
	whiteboxWait(t, page, `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli")`)
}

func TestNativeDevicePairResumeLogoutAndRemoteFrameIsolation(t *testing.T) {
	nativeWhiteboxSession(t, true)
	desktop := nativeWhitebox.desktop
	desktop.openMainWindow()
	win := desktop.mainWindow()
	defer win.Destroy()
	defer desktop.closeDevice()
	page := win.Page()
	whiteboxWait(t, page, `typeof mygo === "object"`)
	result, err := page.Eval(`mygo.call("Desktop.PairDevice", "` + strings.Repeat("b", 32) + `", "Work laptop").then(status => !!status.deviceId)`)
	if err != nil || result != true {
		t.Fatalf("native pairing IPC failed: %v", err)
	}
	whiteboxWait(t, page, `mygo.call("Desktop.DeviceStatus").then(status => status.state === "online")`)
	credential := deviceFixtureCredential()
	result, err = page.Eval(`mygo.call("Desktop.ResumeDevice", "` + credential.OwnerID + `").then(status => status.state === "online")`)
	if err != nil || result != true {
		t.Fatal("a paired native device could not resume")
	}
	// A completed reconnect attempt must be restartable without pairing again.
	desktop.mu.RLock()
	completed := desktop.device
	desktop.mu.RUnlock()
	completed.cancel()
	waitDeviceDone(t, completed)
	if _, err := page.Eval(`mygo.call("Desktop.ResumeDevice", "` + credential.OwnerID + `")`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `mygo.call("Desktop.DeviceStatus").then(status => status.state === "online")`)
	if _, err := page.Eval(`
		(() => {
			const frame = document.createElement("iframe");
			window.addEventListener("message", event => {
				if (event.source === frame.contentWindow && event.origin === "` + nativeWhitebox.server.URL + `" &&
					event.data?.type === "native-frame-probe") window.__nativeFrameProbe = event.data;
			});
			frame.src = "` + nativeWhitebox.server.URL + `/native-frame-probe";
			document.body.append(frame);
		})()
	`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `window.__nativeFrameProbe?.parentBlocked === true && window.__nativeFrameProbe?.hostAvailable === false`)
	if blocked, err := desktop.session.sessionBlocked(); err != nil || blocked {
		t.Fatal("a remote iframe invoked the privileged sign-out bridge")
	}
	result, err = page.Eval(`mygo.call("Desktop.ResumeDevice", "10000000-0000-4000-8000-000000000002").then(() => false, () => true)`)
	if err != nil || result != true {
		t.Fatal("another account resumed the stored device")
	}
	if _, err := page.Eval(`mygo.call("Desktop.ClearSession")`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `mygo.call("Desktop.DeviceStatus").then(status => status.state === "unpaired")`)
	if _, err := nativeWhitebox.store.Get(serverCredentialKey(desktop.server, "device")); err != mygo.ErrSecretNotFound {
		t.Fatal("sign-out retained the device credential")
	}
}
