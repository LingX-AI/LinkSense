package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/transfer"
	"github.com/egoist/mygo/ui"
)

const permissionRefreshInterval = 3 * time.Second

type credentialStorage interface {
	Load() (deviceCredentials, error)
	Save(deviceCredentials) error
	Clear() error
}

type systemCredentialStorage struct{}

func (systemCredentialStorage) Load() (deviceCredentials, error) {
	data, err := mygo.Secrets.Service("org.linksense.desktop").Get("paired-device")
	if err != nil {
		return deviceCredentials{}, err
	}
	var credential deviceCredentials
	if len(data) > mygo.MaxSecretSize {
		return credential, errors.New("invalid credential storage")
	}
	if err := decodeStrict(data, &credential); err != nil {
		return credential, err
	}
	return credential, nil
}

func (systemCredentialStorage) Save(credential deviceCredentials) error {
	data, err := json.Marshal(credential)
	if err != nil {
		return err
	}
	return mygo.Secrets.Service("org.linksense.desktop").Set("paired-device", data)
}

func (systemCredentialStorage) Clear() error {
	err := mygo.Secrets.Service("org.linksense.desktop").Delete("paired-device")
	if errors.Is(err, mygo.ErrSecretNotFound) {
		return nil
	}
	return err
}

type approvalRequest struct {
	command desktopCommand
	ctx     context.Context
	decide  func(bool)
}

func (a *desktopApp) update(fn func()) {
	if a.post != nil {
		a.post(fn)
	} else {
		fn()
	}
}

func (a *desktopApp) pair() {
	if a.preview || a.busy || a.bridge == nil {
		return
	}
	origin, err := workspaceURL(a.server)
	code := strings.TrimSpace(a.pairingCode)
	if err != nil {
		a.message = "invalidURL"
		return
	}
	if len(code) < 32 || len(code) > 100 {
		a.message = "invalidPairCode"
		return
	}
	ctx, attempt := a.beginAttempt()
	a.message = ""
	name, storage := a.deviceName, a.storage
	go func() {
		credential, err := pairDevice(ctx, origin, code, name)
		if err == nil {
			if ctx.Err() != nil {
				return
			}
			a.secretMu.Lock()
			if storage == nil {
				err = errors.New("credential storage unavailable")
			} else {
				err = storage.Save(credential)
			}
			if ctx.Err() != nil && storage != nil {
				current, loadErr := storage.Load()
				if loadErr == nil && current.Token == credential.Token {
					_ = storage.Clear()
				}
			}
			a.secretMu.Unlock()
			if err != nil {
				a.update(func() {
					if a.attemptID == attempt && ctx.Err() == nil {
						a.busy, a.message = false, "credentialFailed"
					}
				})
				return
			}
		}
		a.update(func() {
			if a.attemptID != attempt || ctx.Err() != nil {
				return
			}
			a.busy = false
			if err != nil {
				a.message = "pairFailed"
				return
			}
			a.credential, a.pairingCode = &credential, ""
			a.server, a.pairing = credential.Server, false
			a.reconnect()
		})
	}()
}

func (a *desktopApp) reconnect() {
	if a.preview || a.bridge == nil || a.credential == nil || a.busy {
		return
	}
	credential := *a.credential
	ctx, attempt := a.beginAttempt()
	go func() {
		err := a.bridge.Connect(ctx, credential)
		a.update(func() {
			if a.attemptID != attempt || ctx.Err() != nil {
				return
			}
			a.busy = false
			if err != nil {
				a.state, a.message = connectionError, "connectionFailed"
			}
		})
	}()
}

func (a *desktopApp) disconnect() {
	if a.preview {
		a.state = disconnected
		return
	}
	a.cancelConnectionAttempt()
	if a.bridge != nil {
		a.bridge.Disconnect()
	}
	a.state, a.pendingApproval = disconnected, nil
	storage, credential := a.storage, a.credential
	a.credential = nil
	if storage != nil && credential != nil {
		go func() {
			a.secretMu.Lock()
			defer a.secretMu.Unlock()
			current, err := storage.Load()
			if err == nil && current.Token == credential.Token {
				err = storage.Clear()
			}
			if err != nil {
				a.update(func() { a.message = "credentialFailed" })
			}
		}()
	}
}

func (a *desktopApp) beginAttempt() (context.Context, uint64) {
	a.cancelConnectionAttempt()
	ctx, cancel := context.WithCancel(context.Background())
	a.cancelAttempt, a.busy = cancel, true
	return ctx, a.attemptID
}

func (a *desktopApp) cancelConnectionAttempt() {
	if a.cancelAttempt != nil {
		a.cancelAttempt()
	}
	a.cancelAttempt = nil
	a.attemptID++
	a.busy = false
}

func (a *desktopApp) cancelPairing() {
	a.cancelConnectionAttempt()
	a.pairing = false
}

func (a *desktopApp) resume() {
	if a.preview {
		a.state = connected
		return
	}
	if a.bridge != nil {
		a.bridge.Resume()
	}
}

func (a *desktopApp) checkPermissions() {
	if a.preview || a.bridge == nil || a.busy || a.state == running || a.state == awaitingApproval {
		return
	}
	bridge := a.bridge
	a.busy = true
	go func() {
		bridge.CheckPermissions(context.Background())
		a.update(func() { a.busy = false })
	}()
}

func (a *desktopApp) refreshPermissions() {
	bridge := a.bridge
	if a.preview || bridge == nil {
		return
	}
	go bridge.CheckPermissions(context.Background())
}

func (a *desktopApp) startPermissionRefresh() {
	bridge := a.bridge
	if a.preview || bridge == nil || a.permissionStop != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.permissionStop = cancel
	go func() {
		ticker := time.NewTicker(permissionRefreshInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				bridge.CheckPermissions(ctx)
			}
		}
	}()
}

func (a *desktopApp) stopPermissionRefresh() {
	if a.permissionStop != nil {
		a.permissionStop()
		a.permissionStop = nil
	}
}

func (a *desktopApp) openPermissionSettings(pane string) {
	if a.preview || runtime.GOOS != "darwin" {
		return
	}
	if pane != "Privacy_Accessibility" && pane != "Privacy_ScreenCapture" {
		return
	}
	if err := mygo.Shell.OpenExternal("x-apple.systempreferences:com.apple.preference.security?" + pane); err != nil {
		a.message = "openFailed"
		return
	}
	if pane == "Privacy_ScreenCapture" && a.permissions.ScreenRecording != "granted" {
		a.showPermissionDragPanel()
	}
}

func appBundlePath(resources string) (string, bool) {
	bundle := filepath.Dir(filepath.Dir(resources))
	info, err := os.Stat(bundle)
	return bundle, err == nil && info.IsDir() && strings.HasSuffix(bundle, ".app")
}

func (a *desktopApp) showPermissionDragPanel() {
	if runtime.GOOS != "darwin" {
		return
	}
	if a.permissionPanel == nil {
		resources, err := mygo.App.Path(mygo.PathResources)
		if err != nil {
			return
		}
		bundle, ok := appBundlePath(resources)
		if !ok {
			return
		}
		data, err := transfer.FileData(bundle)
		if err != nil {
			return
		}
		var window *mygo.Window
		window = mygo.NewWindow(mygo.WindowOptions{
			Title:             "LinkSense helper",
			Width:             280,
			Height:            190,
			Frameless:         true,
			Panel:             true,
			Transparent:       true,
			CornerRadius:      16,
			DisableResize:     true,
			DisableMinimize:   true,
			DisableMaximize:   true,
			DisableFullScreen: true,
			Content: ui.View(func(c *ui.Context) {
				a.permissionDragView(c, func() { window.Hide() }, data)
			}),
		})
		a.permissionPanel = window
		window.OnClosed(func() { a.permissionPanel = nil })
	}
	display := mygo.Screen.DisplayNearestPoint(mygo.Screen.CursorScreenPoint())
	a.permissionPanel.SetPosition(
		display.WorkArea.X+display.WorkArea.Width-280-24,
		display.WorkArea.Y+48,
	)
	a.permissionPanel.Show()
}

func workspaceSettingsURL(origin string) string {
	u, err := url.Parse(origin)
	if err != nil {
		return origin
	}
	u.Path, u.Fragment = "/settings/general", "computer-use"
	return u.String()
}

func (a *desktopApp) handlePairURL(raw string) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "linksense-desktop" || u.Host != "pair" ||
		u.User != nil || u.Path != "" || u.Fragment != "" {
		return
	}
	query := u.Query()
	if len(query) != 2 || len(query["server"]) != 1 || len(query["code"]) != 1 {
		return
	}
	origin, err := workspaceURL(query.Get("server"))
	code := query.Get("code")
	if err != nil || len(code) < 32 || len(code) > 100 {
		return
	}
	a.cancelConnectionAttempt()
	a.server, a.pairingCode, a.pairing, a.message = origin, code, true, ""
	if a.show != nil {
		a.show()
	}
}

func (a *desktopApp) decide(approved bool) {
	pending := a.pendingApproval
	a.pendingApproval = nil
	if pending != nil && pending.ctx.Err() == nil {
		pending.decide(approved)
	}
}

func (a *desktopApp) attachRuntime() *nativeEngine {
	binary := os.Getenv("LINKSENSE_AGENT_DESKTOP_BIN")
	if binary == "" {
		resources, err := mygo.App.Path(mygo.PathResources)
		if err == nil {
			name := "agent-desktop"
			if runtime.GOOS == "windows" {
				name += ".exe"
			}
			binary = filepath.Join(resources, "bin", name)
		}
	}
	engine := &nativeEngine{path: binary}
	a.storage = systemCredentialStorage{}
	bridge := &desktopBridge{engine: engine, permissions: permissionState{"unknown", "unknown"}}
	a.bridge = bridge
	bridge.onStatus = func(status bridgeStatus) {
		a.applyBridgeStatus(bridge, status)
	}
	bridge.onPermission = func(permissions permissionState) {
		a.update(func() { a.applyPermissions(permissions) })
	}
	bridge.onApprove = func(ctx context.Context, command desktopCommand, decide func(bool)) {
		generation := bridge.Generation()
		a.update(func() {
			if ctx.Err() != nil || bridge.Generation() != generation {
				return
			}
			a.pendingApproval = &approvalRequest{command, ctx, decide}
			a.state = awaitingApproval
			if a.show != nil {
				a.show()
			}
		})
	}
	return engine
}

func (a *desktopApp) applyBridgeStatus(bridge *desktopBridge, status bridgeStatus) {
	a.update(func() {
		if bridge.Generation() != status.Generation {
			return
		}
		a.applyPermissions(status.Permissions)
		if !status.Connected {
			a.state = disconnected
			if status.Error != "" {
				a.state = connectionError
			}
		} else {
			switch status.Control {
			case "paused":
				a.state = paused
			case "pending":
				a.state = awaitingApproval
			case "running":
				a.state = running
			default:
				a.state = connected
			}
		}
		if status.Control != "pending" {
			a.pendingApproval = nil
		}
		if status.Error != "" {
			a.message = status.Error
		} else if a.message == "connectionFailed" || a.message == "connectionLost" {
			a.message = ""
		}
	})
}

func (a *desktopApp) applyPermissions(permissions permissionState) {
	a.permissions = permissions
	if permissions.ScreenRecording == "granted" && a.permissionPanel != nil &&
		a.permissionPanel.IsVisible() {
		a.permissionPanel.Hide()
	}
}

func (a *desktopApp) restore() {
	if a.preview || a.storage == nil || a.pairing {
		return
	}
	attempt := a.attemptID
	storage := a.storage
	go func() {
		a.secretMu.Lock()
		credential, err := storage.Load()
		a.secretMu.Unlock()
		a.update(func() {
			if a.attemptID != attempt || a.pairing {
				return
			}
			if err == nil {
				a.credential, a.server = &credential, credential.Server
				a.reconnect()
			} else if !errors.Is(err, mygo.ErrSecretNotFound) {
				a.message = "credentialFailed"
			}
			a.checkPermissions()
		})
	}()
}
