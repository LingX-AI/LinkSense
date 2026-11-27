package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/egoist/mygo/plugins/permissionflow"
)

// ComputerPermissionKind is the closed set of macOS permissions the shared UI
// may inspect or guide. The WebView cannot name another platform permission,
// a path, a target or an external URL.
type ComputerPermissionKind string

const (
	// ComputerPermissionAccessibility is the Accessibility permission, which
	// lets the local computer-use engine read and control other apps.
	ComputerPermissionAccessibility ComputerPermissionKind = "accessibility"
	// ComputerPermissionScreenRecording is the Screen Recording permission,
	// which lets the engine capture the screen.
	ComputerPermissionScreenRecording ComputerPermissionKind = "screenRecording"
)

// ComputerPermissionStatus is the permission state reported by MyGo's
// permissionflow.Check. "notGranted" folds the plugin's Denied state: macOS
// does not distinguish "not asked" from "turned down" for Accessibility and
// Screen Recording, and a guide ending is never treated as a denial.
type ComputerPermissionStatus string

const (
	ComputerPermissionStatusGranted       ComputerPermissionStatus = "granted"
	ComputerPermissionStatusNotGranted    ComputerPermissionStatus = "notGranted"
	ComputerPermissionStatusNotDetermined ComputerPermissionStatus = "notDetermined"
	ComputerPermissionStatusUnknown       ComputerPermissionStatus = "unknown"
)

// ComputerPermissionReason is the stable reason a call ended. None of these
// values asserts that the user denied a permission.
type ComputerPermissionReason string

const (
	ComputerPermissionReasonChecked     ComputerPermissionReason = "checked"
	ComputerPermissionReasonGranted     ComputerPermissionReason = "granted"
	ComputerPermissionReasonClosed      ComputerPermissionReason = "closed"
	ComputerPermissionReasonCanceled    ComputerPermissionReason = "canceled"
	ComputerPermissionReasonTimedOut    ComputerPermissionReason = "timedOut"
	ComputerPermissionReasonUnknown     ComputerPermissionReason = "unknown"
	ComputerPermissionReasonFailed      ComputerPermissionReason = "failed"
	ComputerPermissionReasonUnsupported ComputerPermissionReason = "unsupported"
	ComputerPermissionReasonNotPackaged ComputerPermissionReason = "notPackaged"
	ComputerPermissionReasonInvalidKind ComputerPermissionReason = "invalidKind"
)

// ComputerPermissionResult is the only permission state the WebView receives.
// It contains no OS error, path, target or bundle identifier. A Guide that
// ends without a grant reports "closed", "canceled" or "timedOut", never a
// denial. For Screen Recording, macOS reports a switched-on permission only
// after the app starts again, so a still-notGranted result permits the UI to
// mention a restart only after the user confirms they enabled it; this bridge
// never restarts the app and never assumes the grant.
type ComputerPermissionResult struct {
	Kind   ComputerPermissionKind   `json:"kind"`
	Status ComputerPermissionStatus `json:"status"`
	Reason ComputerPermissionReason `json:"reason"`
}

const computerPermissionGuideTimeout = 10 * time.Minute

var (
	errComputerPermissionKind        = errors.New("DESKTOP_COMPUTER_PERMISSION_KIND_INVALID")
	errComputerPermissionUnsupported = errors.New("DESKTOP_COMPUTER_PERMISSION_UNSUPPORTED")
	errComputerPermissionNotPackaged = errors.New("DESKTOP_COMPUTER_PERMISSION_NOT_PACKAGED")
	errComputerPermissionSettings    = errors.New("DESKTOP_COMPUTER_PERMISSION_SETTINGS_FAILED")
)

// computerPermission is the single test seam for the platform, bundle and
// plugin calls. Production installs the real values below; tests replace the
// whole value so no TCC state is read or changed and no System Settings window
// opens.
type computerPermissionSystem struct {
	goos string
	// guideApp is the verified .app path of the current executable. An empty
	// value means the executable is not in a real .app bundle, which is the one
	// running layout where Check, Guide and manual Settings are unavailable.
	// It is also the only app path passed to permissionflow.Guide.
	guideApp     string
	check        func(permissionflow.Permission) (permissionflow.Status, error)
	guide        func(context.Context, permissionflow.Permission, permissionflow.GuideOptions) (permissionflow.Status, error)
	openSettings func(permissionflow.Permission) error
}

var computerPermission = newComputerPermissionSystem()

func newComputerPermissionSystem() computerPermissionSystem {
	return computerPermissionSystem{
		goos:         runtime.GOOS,
		guideApp:     currentAppBundle(),
		check:        permissionflow.Check,
		guide:        permissionflow.Guide,
		openSettings: permissionflow.OpenSettings,
	}
}

// currentAppBundle returns the .app bundle the current executable runs from,
// or "" when it is not in a real macOS .app bundle. mygo.App.IsPackaged is not
// enough: it also reports true for a standalone executable built with a linker
// package identifier, and permissionflow.Guide then falls back to that
// executable, which can give the permission to the terminal instead of
// LinkSense. The path comes only from the verified current executable; the
// WebView never supplies it.
func currentAppBundle() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	app, _ := executableAppBundle(exe)
	return app
}

func executableAppBundle(exe string) (string, bool) {
	resolved, err := filepath.EvalSymlinks(exe)
	if err != nil {
		return "", false
	}
	macos := filepath.Dir(resolved)
	contents := filepath.Dir(macos)
	app := filepath.Dir(contents)
	if filepath.Base(macos) != "MacOS" ||
		filepath.Base(contents) != "Contents" ||
		!strings.HasSuffix(app, ".app") {
		return "", false
	}
	return app, true
}

// permissionFor returns the plugin permission when the renderer may use it in
// this process, or the stable reason it may not. Check uses the same gate as
// Guide and manual Settings: without a verified .app bundle it reports
// notPackaged without probing the OS, so the UI cannot show a status the two
// actions cannot act on.
func (kind ComputerPermissionKind) permissionFor() (permissionflow.Permission, ComputerPermissionReason, bool) {
	var permission permissionflow.Permission
	switch kind {
	case ComputerPermissionAccessibility:
		permission = permissionflow.Accessibility
	case ComputerPermissionScreenRecording:
		permission = permissionflow.ScreenRecording
	default:
		return "", ComputerPermissionReasonInvalidKind, false
	}
	if computerPermission.goos != "darwin" {
		return "", ComputerPermissionReasonUnsupported, false
	}
	if computerPermission.guideApp == "" {
		return "", ComputerPermissionReasonNotPackaged, false
	}
	return permission, "", true
}

func computerPermissionStatus(status permissionflow.Status) ComputerPermissionStatus {
	switch status {
	case permissionflow.Granted:
		return ComputerPermissionStatusGranted
	case permissionflow.NotDetermined:
		return ComputerPermissionStatusNotDetermined
	case permissionflow.Denied:
		return ComputerPermissionStatusNotGranted
	}
	return ComputerPermissionStatusUnknown
}

func computerPermissionErrorReason(err error) ComputerPermissionReason {
	if errors.Is(err, errors.ErrUnsupported) {
		return ComputerPermissionReasonUnsupported
	}
	return ComputerPermissionReasonFailed
}

func computerPermissionContextReason(err error) ComputerPermissionReason {
	if errors.Is(err, context.DeadlineExceeded) {
		return ComputerPermissionReasonTimedOut
	}
	return ComputerPermissionReasonCanceled
}

func checkComputerPermission(kind ComputerPermissionKind) ComputerPermissionResult {
	result := ComputerPermissionResult{
		Kind: kind, Status: ComputerPermissionStatusUnknown, Reason: ComputerPermissionReasonInvalidKind,
	}
	permission, reason, ok := kind.permissionFor()
	if !ok {
		result.Reason = reason
		return result
	}
	result.Reason = ComputerPermissionReasonChecked
	status, err := computerPermission.check(permission)
	result.Status = computerPermissionStatus(status)
	if err != nil {
		result.Status = ComputerPermissionStatusUnknown
		result.Reason = computerPermissionErrorReason(err)
	}
	return result
}

func guideComputerPermission(ctx context.Context, kind ComputerPermissionKind) ComputerPermissionResult {
	result := ComputerPermissionResult{
		Kind: kind, Status: ComputerPermissionStatusUnknown, Reason: ComputerPermissionReasonInvalidKind,
	}
	permission, reason, ok := kind.permissionFor()
	if !ok {
		result.Reason = reason
		return result
	}
	status, err := computerPermission.check(permission)
	result.Status = computerPermissionStatus(status)
	if err != nil {
		result.Status = ComputerPermissionStatusUnknown
		result.Reason = computerPermissionErrorReason(err)
		return result
	}
	if status == permissionflow.Granted {
		result.Reason = ComputerPermissionReasonGranted
		return result
	}
	guideContext, cancel := context.WithTimeout(ctx, computerPermissionGuideTimeout)
	defer cancel()
	// Guide opens System Settings before it looks at its context, so a call
	// that is already canceled must not reach it.
	if err := guideContext.Err(); err != nil {
		result.Reason = computerPermissionContextReason(err)
		return result
	}
	// permissionFor guarantees currentAppBundle's verified, non-empty .app
	// path, so the plugin never resolves its own fallback.
	status, err = computerPermission.guide(guideContext, permission, permissionflow.GuideOptions{App: computerPermission.guideApp})
	result.Status = computerPermissionStatus(status)
	switch {
	case err == nil && status == permissionflow.Granted:
		result.Status = ComputerPermissionStatusGranted
		result.Reason = ComputerPermissionReasonGranted
	case err == nil && status == permissionflow.Unknown:
		result.Status = ComputerPermissionStatusUnknown
		result.Reason = ComputerPermissionReasonUnknown
	case err == nil:
		// MyGo returns without an error when the user closes its panel or
		// System Settings. That is a dismissal, not a denial.
		result.Reason = ComputerPermissionReasonClosed
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		// Keep the status the plugin observed, but record how the wait ended:
		// a cancellation or timeout neither grants nor denies.
		result.Reason = computerPermissionContextReason(err)
	case errors.Is(err, errors.ErrUnsupported):
		result.Status = ComputerPermissionStatusUnknown
		result.Reason = ComputerPermissionReasonUnsupported
	default:
		result.Status = ComputerPermissionStatusUnknown
		result.Reason = ComputerPermissionReasonFailed
	}
	return result
}

func openComputerPermissionSettings(kind ComputerPermissionKind) error {
	permission, reason, ok := kind.permissionFor()
	if !ok {
		switch reason {
		case ComputerPermissionReasonInvalidKind:
			return errComputerPermissionKind
		case ComputerPermissionReasonUnsupported:
			return errComputerPermissionUnsupported
		default:
			return errComputerPermissionNotPackaged
		}
	}
	if err := computerPermission.openSettings(permission); err != nil {
		if errors.Is(err, errors.ErrUnsupported) {
			return errComputerPermissionUnsupported
		}
		return errComputerPermissionSettings
	}
	return nil
}

// CheckComputerPermission reports the current permission without prompting or
// opening anything. It is the only permission read the shared UI needs for
// its status display.
func (d *Desktop) CheckComputerPermission(ctx context.Context, kind ComputerPermissionKind) (ComputerPermissionResult, error) {
	if err := d.checkCaller(ctx); err != nil {
		return ComputerPermissionResult{}, err
	}
	return checkComputerPermission(kind), nil
}

// GuideComputerPermission uses MyGo's permissionflow.Guide: it opens the
// matching System Settings page and shows the plugin's draggable app panel.
// The plugin opens, follows and closes its own panel, and its context ends the
// wait. The WebView may not choose the app, a path or a URL.
func (d *Desktop) GuideComputerPermission(ctx context.Context, kind ComputerPermissionKind) (ComputerPermissionResult, error) {
	if err := d.checkCaller(ctx); err != nil {
		return ComputerPermissionResult{}, err
	}
	return guideComputerPermission(ctx, kind), nil
}

// OpenComputerPermissionSettings is the manual add fallback after
// GuideComputerPermission reports a failure. MyGo's Guide registers its panel
// classes before it opens System Settings, so a failure there leaves the user
// with no settings page; permissionflow.OpenSettings needs only the core
// frameworks and opens the plugin's own page for the same kind.
func (d *Desktop) OpenComputerPermissionSettings(ctx context.Context, kind ComputerPermissionKind) error {
	if err := d.checkCaller(ctx); err != nil {
		return err
	}
	return openComputerPermissionSettings(kind)
}
