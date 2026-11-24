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
	"sync/atomic"

	"github.com/egoist/mygo"
)

const desktopBridgeVersion = 1

type HostInfo struct {
	BridgeVersion int    `json:"bridgeVersion"`
	ServerURL     string `json:"serverUrl"`
	Platform      string `json:"platform"`
	Version       string `json:"version"`
	MacSignOut    bool   `json:"macSignOut,omitzero"`
}

// MacSignOutOptions preserves the pairing unless the UI confirmed a revoke.
type MacSignOutOptions struct {
	RevokedDevice *RevokedMacDevice `json:"revokedDevice,omitempty"`
}

type RevokedMacDevice struct {
	OwnerID  string `json:"ownerId"`
	DeviceID string `json:"deviceId"`
}

// Desktop exposes only the capabilities used by the shared application UI.
type Desktop struct {
	mu            sync.RWMutex
	deviceSetup   sync.Mutex
	server        *url.URL
	workspaceRoot string
	window        *mygo.Window
	session       *sessionTransport
	account       workspaceAccount
	device        *deviceConnection
	login         *browserLoginAttempt
	openBrowser   func(string) error
	localRuntime  *runtimeSupervisor
	updates       *desktopUpdates
	// computer is the M1b product control host. It is nil on platforms and
	// builds that cannot construct the signed driver, which keeps the device
	// operation and the binding unavailable.
	computer computerControlService
	// computerShortcut is the optional background Cmd+Shift+Esc binding. It is
	// installed only on macOS and released on quit; the menu accelerator remains
	// the app-local fallback.
	computerShortcut *computerEmergencyShortcut
	// downloads is bounded page-local state for the explicit Mac Finder action.
	downloads artifactDownloadTracker
	// diagnostics guards the single native export and provides local test seams.
	diagnostics  desktopDiagnostics
	dataRoot     string
	shutdownOnce sync.Once
	// closeToTray and preferencesWritable are used only on the main thread.
	closeToTray bool
	// quitting is set by OnBeforeQuit and cleared by OnQuitCanceled. The
	// diagnostics worker reads it off the main thread, so it is atomic.
	quitting            atomic.Bool
	preferencesWritable bool
}

func (d *Desktop) configure(server *url.URL, store credentialStore, dataRoot string) {
	d.server = server
	d.dataRoot = dataRoot
	// The computer driver is built lazily after the user's select gesture from
	// this private state parent; wiring it here touches no process or TCC state.
	d.computer = newDesktopComputerControl(d)
	// The native host answers the per-conversation workspace notice from the
	// same private runtime root the supervisor uses, without starting it.
	d.workspaceRoot = filepath.Join(dataRoot, "local-runtime")
	client := newDesktopHTTPClient(server, store)
	d.session = client.Transport.(*sessionTransport)
	d.session.account = &d.account
	d.session.signedOutPath = filepath.Join(dataRoot, "sessions", serverCredentialKey(server, "refresh")+".signed-out")
	// Any invalidation (sign-out, account switch, expiry, 401/403) releases a
	// pending workspace relay so its result cannot cross into another account.
	// The device socket is bound to the same account lease. Cancel only an
	// unauthorized connection, without waiting: this callback can run under the
	// auth mutex, and ClearSession may already hold deviceSetup. A resume for a
	// newer generation may have replaced the connection after the account lock
	// was dropped, so clearInvalidatedDevice re-checks the current lease.
	d.account.setOnClear(func() {
		// A pending or completed save belongs to the invalidated sign-in and
		// must never offer Finder for what is now another account's file.
		d.downloads.discardAll()
		// Cancel the invalidated device first: workspace cleanup can wait on
		// the runtime pipe lock and must not delay the device's fail-closed
		// transition. Both calls are nonblocking.
		d.clearInvalidatedDevice()
		if d.updates != nil {
			d.updates.cancelUpdateNotification()
		}
		if d.localRuntime != nil {
			d.localRuntime.dropWorkspaceRequests()
		}
	})
	if runtime.GOOS == "darwin" && desktopUpdateFeed != "" {
		// Only C's self-hosted URL-directory workflow gets the in-place
		// lifecycle. Legacy package feeds keep CheckForUpdate and can never
		// stage an install; Windows keeps the same check-only bridge.
		d.updates = newDesktopUpdates(d)
	}
}

// shutdown is idempotent because App.OnQuit runs it synchronously (also on
// session end, which may skip main's defers) and main defers it as well.
func (d *Desktop) shutdown() {
	d.shutdownOnce.Do(func() {
		if d.updates != nil {
			d.updates.shutdown()
		}
		// Preserve the existing order: device, runtime, pending sign-in.
		d.closeDevice()
		if d.localRuntime != nil {
			d.localRuntime.close()
		}
		d.cancelSignIn()
	})
}

func (d *Desktop) ClearSession(ctx context.Context) error {
	if err := d.checkCaller(ctx); err != nil {
		return err
	}
	return d.clearSession(true, nil)
}

func (d *Desktop) ClearMacSession(ctx context.Context, options MacSignOutOptions) error {
	if err := d.checkCaller(ctx); err != nil {
		return err
	}
	if runtime.GOOS != "darwin" {
		return errors.New("DESKTOP_HOST_UNAVAILABLE")
	}
	revoked := options.RevokedDevice
	if revoked != nil && (!validUUID(revoked.OwnerID) || !validUUID(revoked.DeviceID)) {
		return errors.New("VALIDATION_ERROR")
	}
	return d.clearSession(false, revoked)
}

func (d *Desktop) clearSession(legacyDeletePairing bool, revoked *RevokedMacDevice) error {
	// Sign-out intent and account invalidation happen before device shutdown,
	// which can wait for a connection to unwind. This releases pending relays
	// and prevents an already in-flight refresh from restoring the account.
	d.session.requestSignOut()
	d.deviceSetup.Lock()
	defer d.deviceSetup.Unlock()
	d.closeDevice()
	d.cancelSignIn()
	refreshErr := d.session.clearSession()
	var deviceErr error
	if legacyDeletePairing {
		deviceErr = d.session.store.Delete(serverCredentialKey(d.server, "device"))
	} else if revoked != nil {
		deviceErr = d.deleteRevokedDevice(*revoked)
	}
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

// desktopAppVersion returns the app bundle version MyGo reports, which is the
// same source PairDevice registers as app_version. Unpackaged development
// builds have none.
func desktopAppVersion() string {
	return mygo.App.Version()
}

func (d *Desktop) Info(ctx context.Context) (HostInfo, error) {
	if err := d.checkCaller(ctx); err != nil {
		return HostInfo{}, err
	}
	version := desktopAppVersion()
	if version == "" {
		version = "development"
	}
	return HostInfo{
		BridgeVersion: desktopBridgeVersion,
		ServerURL:     d.server.String(),
		Platform:      runtime.GOOS,
		Version:       version,
		MacSignOut:    runtime.GOOS == "darwin",
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
	d.openMainWindowInSession(nil)
}

func (d *Desktop) openMainWindowInSession(session *mygo.Session) {
	pageOptions := mygo.PageOptions{DevTools: mygo.DevToolsDisabled, Session: session}
	if runtime.GOOS == "darwin" {
		// Keep the existing completion feed running after Close to Menu Bar.
		pageOptions.BackgroundThrottling = mygo.ThrottlingOff
		// The preload only activates in a direct child at the exact packaged
		// origin and ticket path. It is not an IPC permission: window.mygo
		// stays absent from iframes.
		if preload := desktopApplicationAnnotationPreloadForWindow(d.server); preload != "" {
			pageOptions.PreloadScript = preload
			pageOptions.PreloadAllFrames = true
		}
	}
	options := mygo.WindowOptions{
		Title: "LinkSense", URL: "/",
		Width: 1200, Height: 800, MinWidth: 720, MinHeight: 540,
		StateKey: "desktop-main",
		Page:     pageOptions,
	}
	if runtime.GOOS == "darwin" {
		// Keep the native traffic lights and let the shared UI own the top area.
		// A larger top inset aligns them with the compact brand row.
		options.TitleBarStyle = mygo.TitleBarHidden
		options.TrafficLightPosition = &mygo.Point{X: 14, Y: 14}
	}
	win := mygo.NewWindow(options)
	d.mu.Lock()
	d.window = win
	d.mu.Unlock()
	page := win.Page()
	// These callbacks are page-scoped and observe MyGo's own save result. They
	// never choose a path or change the downloaded bytes.
	d.downloads.discardOtherPages(page)
	page.OnWillDownload(func(event *mygo.DownloadEvent) {
		d.artifactDownloadStarted(page, event)
	})
	page.OnDownloadDone(func(download *mygo.Download) {
		d.artifactDownloadFinished(page, download)
	})
	page.OnDidNavigate(func(string) {
		d.artifactDownloadNavigated(page)
	})
	page.OnWillNavigate(func(event *mygo.NavigateEvent) {
		if frontendNavigation(event.URL) {
			return
		}
		event.PreventDefault()
		if u, err := externalURL(event.URL); err == nil && event.UserInitiated {
			_ = mygo.Shell.OpenExternal(u.String())
		}
	})
	page.SetWindowOpenHandler(func(request mygo.WindowOpenRequest) *mygo.WindowOptions {
		if u, err := externalURL(request.URL); err == nil && request.UserInitiated {
			_ = mygo.Shell.OpenExternal(u.String())
		}
		return nil
	})
	win.OnClose(func(event *mygo.CloseEvent) {
		if d.closeToTray && !d.quitting.Load() {
			event.PreventDefault()
			win.Hide()
		}
	})
}
