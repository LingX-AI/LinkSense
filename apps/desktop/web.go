package main

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/egoist/mygo"
)

const desktopBridgeVersion = 1

type HostInfo struct {
	BridgeVersion int    `json:"bridgeVersion"`
	ServerURL     string `json:"serverUrl"`
	Platform      string `json:"platform"`
	Version       string `json:"version"`
}

// Desktop exposes only the capabilities used by the shared application UI.
type Desktop struct {
	mu           sync.RWMutex
	deviceSetup  sync.Mutex
	server       *url.URL
	window       *mygo.Window
	session      *sessionTransport
	device       *deviceConnection
	login        *browserLoginAttempt
	openBrowser  func(string) error
	localRuntime *runtimeSupervisor
	// The window and application lifecycle callbacks use these only on the main thread.
	closeToTray bool
	quitting    bool
}

func (d *Desktop) configure(server *url.URL, store credentialStore, dataRoot string) {
	d.server = server
	client := newDesktopHTTPClient(server, store)
	d.session = client.Transport.(*sessionTransport)
	d.session.signedOutPath = filepath.Join(dataRoot, "sessions", serverCredentialKey(server, "refresh")+".signed-out")
}

func (d *Desktop) ClearSession(ctx context.Context) error {
	d.deviceSetup.Lock()
	defer d.deviceSetup.Unlock()
	if err := d.checkCaller(ctx); err != nil {
		return err
	}
	d.closeDevice()
	d.cancelSignIn()
	refreshErr := d.session.clearSession()
	deviceErr := d.session.store.Delete(serverCredentialKey(d.server, "device"))
	if refreshErr != nil || deviceErr != nil {
		return errors.New("DESKTOP_CREDENTIAL_STORE_UNAVAILABLE")
	}
	return nil
}

func (d *Desktop) roundTrip(request *http.Request) (*http.Response, error) {
	if d.session == nil {
		return nil, errors.New("DESKTOP_HOST_NOT_READY")
	}
	return d.session.RoundTrip(request)
}
func (d *Desktop) mainWindow() *mygo.Window {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.window
}

func (d *Desktop) checkCaller(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	win := d.mainWindow()
	if win == nil || mygo.CallerPage(ctx) != win.Page() {
		return errors.New("DESKTOP_CALLER_FORBIDDEN")
	}
	return nil
}

func (d *Desktop) Info(ctx context.Context) (HostInfo, error) {
	if err := d.checkCaller(ctx); err != nil {
		return HostInfo{}, err
	}
	version := mygo.App.Version()
	if version == "" {
		version = "development"
	}
	return HostInfo{
		BridgeVersion: desktopBridgeVersion,
		ServerURL:     d.server.String(),
		Platform:      runtime.GOOS,
		Version:       version,
	}, nil
}

func externalURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") ||
		u.Host == "" || u.User != nil || strings.ContainsAny(raw, "\x00\r\n") {
		return nil, errors.New("DESKTOP_EXTERNAL_URL_FORBIDDEN")
	}
	return u, nil
}

func (d *Desktop) OpenExternal(ctx context.Context, raw string) error {
	if err := d.checkCaller(ctx); err != nil {
		return err
	}
	u, err := externalURL(raw)
	if err != nil {
		return err
	}
	return d.openInSystemBrowser(u.String())
}

func (d *Desktop) openInSystemBrowser(raw string) error {
	if d.openBrowser != nil {
		return d.openBrowser(raw)
	}
	return mygo.Shell.OpenExternal(raw)
}

func frontendNavigation(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.User != nil || u.Port() != "" {
		return false
	}
	return (u.Scheme == "mygo" && u.Host == "localhost") ||
		(u.Scheme == "http" && (u.Host == "mygo.localhost" || u.Host == "localhost.mygo.localhost"))
}

func conversationDeepLink(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "linksense-desktop" || u.Host != "conversation" ||
		u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("DESKTOP_DEEP_LINK_INVALID")
	}
	id := strings.TrimPrefix(u.Path, "/")
	if !validUUID(id) {
		return "", errors.New("DESKTOP_DEEP_LINK_INVALID")
	}
	return "/conversations/" + id, nil
}

func validUUID(id string) bool {
	if len(id) != 36 {
		return false
	}
	for i, c := range id {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
		} else if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
			return false
		}
	}
	return true
}

func (d *Desktop) openMainWindow() {
	page := mygo.PageOptions{DevTools: mygo.DevToolsDisabled}
	if runtime.GOOS == "darwin" {
		// Keep the existing completion feed running after Close to Menu Bar.
		page.BackgroundThrottling = mygo.ThrottlingOff
	}
	win := mygo.NewWindow(mygo.WindowOptions{
		Title: "LinkSense", URL: "/",
		Width: 1200, Height: 800, MinWidth: 720, MinHeight: 540,
		StateKey: "desktop-main",
		Page:     page,
	})
	d.mu.Lock()
	d.window = win
	d.mu.Unlock()
	win.Page().OnWillNavigate(func(event *mygo.NavigateEvent) {
		if frontendNavigation(event.URL) {
			return
		}
		event.PreventDefault()
		if u, err := externalURL(event.URL); err == nil && event.UserInitiated {
			_ = mygo.Shell.OpenExternal(u.String())
		}
	})
	win.Page().SetWindowOpenHandler(func(request mygo.WindowOpenRequest) *mygo.WindowOptions {
		if u, err := externalURL(request.URL); err == nil && request.UserInitiated {
			_ = mygo.Shell.OpenExternal(u.String())
		}
		return nil
	})
	win.OnClose(func(event *mygo.CloseEvent) {
		if d.closeToTray && !d.quitting {
			event.PreventDefault()
			win.Hide()
		}
	})
}
