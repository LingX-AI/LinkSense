package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync/atomic"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
	"github.com/egoist/mygo"
)

const diagnosticsExportFileName = "linksense-diagnostics.json"

// diagnosticReport is the fixed, minimal document the native menu exports. It
// has no device id, name, server URL, path, message, log, timestamp or task
// content; the JSON shape is part of the export contract.
type diagnosticReport struct {
	AppVersion  string                `json:"appVersion"`
	Device      diagnosticDevice      `json:"device"`
	Permissions diagnosticPermissions `json:"permissions"`
}

type diagnosticDevice struct {
	State          DeviceConnectionState `json:"state"`
	ExecutionReady bool                  `json:"executionReady"`
	ComputerReady  bool                  `json:"computerReady"`
	ErrorCode      string                `json:"errorCode,omitempty"`
}

type diagnosticPermissions struct {
	Accessibility   diagnosticPermission `json:"accessibility"`
	ScreenRecording diagnosticPermission `json:"screenRecording"`
}

type diagnosticPermission struct {
	Status ComputerPermissionStatus `json:"status"`
	Reason ComputerPermissionReason `json:"reason"`
}

// diagnosticErrorCode admits only the stable codes bridge.go assigns while
// classifying a device socket. A raw error, renderer value or future unknown
// code is omitted rather than copied into the export.
func diagnosticErrorCode(code string) string {
	switch code {
	case "AUTH_REQUIRED", "RUNNER_UNAVAILABLE", "DESKTOP_PROTOCOL_ERROR", "DESKTOP_CONNECTION_REPLACED":
		return code
	default:
		return ""
	}
}

func newDiagnosticReport(
	version string, device DeviceConnectionStatus,
	accessibility, screenRecording ComputerPermissionResult,
) diagnosticReport {
	state := device.State
	if state == "" {
		state = DeviceUnpaired
	}
	return diagnosticReport{
		AppVersion: version,
		Device: diagnosticDevice{
			State:          state,
			ExecutionReady: device.ExecutionReady,
			ComputerReady:  device.ComputerReady,
			ErrorCode:      diagnosticErrorCode(device.ErrorCode),
		},
		Permissions: diagnosticPermissions{
			Accessibility: diagnosticPermission{
				Status: accessibility.Status, Reason: accessibility.Reason,
			},
			ScreenRecording: diagnosticPermission{
				Status: screenRecording.Status, Reason: screenRecording.Reason,
			},
		},
	}
}

// desktopDiagnosticVersion uses the same MyGo bundle version PairDevice
// registers and the bridge already validates. An unpackaged build or an
// unavailable/invalid version is reported honestly as development.
func desktopDiagnosticVersion() string {
	if version, ok := desktopAppVersionHeaderValue(); ok {
		return version
	}
	return "development"
}

// diagnosticSnapshot reads the existing native connection without creating
// one. No id or name from that snapshot enters the report.
func (d *Desktop) diagnosticSnapshot() diagnosticReport {
	status := DeviceConnectionStatus{State: DeviceUnpaired}
	if d != nil {
		if connection := d.currentDevice(); connection != nil {
			status = connection.Status()
		}
	}
	return newDiagnosticReport(
		desktopDiagnosticVersion(), status,
		checkComputerPermission(ComputerPermissionAccessibility),
		checkComputerPermission(ComputerPermissionScreenRecording),
	)
}

// desktopDiagnostics owns at most one export and the three UI/file seams used
// by tests. Production leaves the function fields nil and uses MyGo/Go below.
type desktopDiagnostics struct {
	busy    atomic.Bool
	save    func(mygo.SaveDialogOptions) (string, error)
	message func(mygo.MessageOptions) (mygo.MessageResult, error)
	write   func(string, []byte) error
}

func defaultDiagnosticsSavePath() string {
	if dir, err := mygo.App.Path(mygo.PathDocuments); err == nil && dir != "" {
		return filepath.Join(dir, diagnosticsExportFileName)
	}
	return diagnosticsExportFileName
}

// startDiagnosticsExport returns immediately, refuses to start while the app
// is quitting, and refuses a second panel while one export is saving or writing.
func (d *Desktop) startDiagnosticsExport(tx locales.Messages) {
	if d == nil || d.quitting.Load() || !d.diagnostics.busy.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer d.diagnostics.busy.Store(false)
		d.runDiagnosticsExport(tx)
	}()
}

func (d *Desktop) runDiagnosticsExport(tx locales.Messages) {
	if d.quitting.Load() {
		return
	}
	report, err := json.MarshalIndent(d.diagnosticSnapshot(), "", "  ")
	if err != nil {
		d.showDiagnosticsFailure(tx)
		return
	}
	report = append(report, '\n')
	if d.quitting.Load() {
		return
	}
	parent := d.mainWindow()
	save := d.diagnostics.save
	if save == nil {
		save = mygo.Dialog.Save
	}
	target, err := save(mygo.SaveDialogOptions{
		Parent:      parent,
		Title:       tx.DiagnosticsExportTitle(),
		DefaultPath: defaultDiagnosticsSavePath(),
		Message:     tx.DiagnosticsPrivacy(),
		Filters:     []mygo.FileFilter{{Name: "JSON", Extensions: []string{"json"}}},
	})
	if err != nil {
		d.showDiagnosticsFailure(tx)
		return
	}
	if target == "" {
		return // The user canceled: no file and no failure dialog.
	}
	if d.quitting.Load() {
		return
	}
	write := d.diagnostics.write
	if write == nil {
		write = writePrivateDiagnostics
	}
	if err := write(target, report); err != nil {
		d.showDiagnosticsFailure(tx)
	}
}

// showDiagnosticsFailure shows only a localized, bounded heading and detail.
// macOS shows Message and Detail and discards Title, so no path or raw error
// enters either field and neither is ever logged.
func (d *Desktop) showDiagnosticsFailure(tx locales.Messages) {
	if d.quitting.Load() {
		return
	}
	message := d.diagnostics.message
	if message == nil {
		message = mygo.Dialog.Message
	}
	_, _ = message(mygo.MessageOptions{
		Parent:  d.mainWindow(),
		Type:    mygo.MessageError,
		Message: tx.DiagnosticsExportFailedHeading(),
		Detail:  tx.DiagnosticsExportFailedDetail(),
	})
}

func writePrivateDiagnostics(path string, data []byte) error {
	return writePrivateDiagnosticsWithRename(path, data, os.Rename)
}

// writePrivateDiagnosticsWithRename writes a private sibling temporary file,
// closes it, then atomically renames it over the user's chosen path. An
// existing target is untouched until that rename, and a final symlink is
// replaced rather than followed. Any failed attempt removes its temp file.
func writePrivateDiagnosticsWithRename(path string, data []byte, rename func(string, string) error) (err error) {
	targetDir := filepath.Dir(path)
	temp, err := os.CreateTemp(targetDir, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	renamed := false
	defer func() {
		if !renamed {
			_ = os.Remove(tempPath)
		}
	}()
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := rename(tempPath, path); err != nil {
		return err
	}
	renamed = true
	return nil
}
