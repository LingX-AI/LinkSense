package main

import (
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/permissionflow"
)

func stubDiagnosticsPermissions(t *testing.T, accessibility, screenRecording permissionflow.Status) {
	t.Helper()
	fake := fakeComputerPermission()
	fake.check = func(permission permissionflow.Permission) (permissionflow.Status, error) {
		switch permission {
		case permissionflow.Accessibility:
			return accessibility, nil
		case permissionflow.ScreenRecording:
			return screenRecording, nil
		default:
			return permissionflow.Unknown, errors.New("unexpected permission")
		}
	}
	stubComputerPermission(t, fake)
}

func TestDiagnosticsMenuIsLocalizedAdjacentAndHasNoShortcut(t *testing.T) {
	wantLabels := map[string]string{
		"zh-CN": "导出 LinkSense 诊断信息…",
		"en-US": "Export LinkSense Diagnostics…",
		"es-ES": "Exportar diagnósticos de LinkSense…",
		"pt-BR": "Exportar diagnósticos do LinkSense…",
		"fr-FR": "Exporter les diagnostics de LinkSense…",
		"ja-JP": "LinkSense の診断情報を書き出す…",
	}
	for _, locale := range []string{"zh-CN", "en-US", "es-ES", "pt-BR", "fr-FR", "ja-JP"} {
		t.Run(locale, func(t *testing.T) {
			d := &Desktop{}
			app, tray := d.shellMenus(locales.In(locale))
			item := app.ItemByID("export-diagnostics")
			if item == nil || item.Click == nil {
				t.Fatal("the app menu has no diagnostics export action")
			}
			if item.Label != wantLabels[locale] {
				t.Fatalf("diagnostics label = %q, want %q", item.Label, wantLabels[locale])
			}
			if item.Accelerator != "" {
				t.Fatalf("diagnostics export has shortcut %q", item.Accelerator)
			}
			if tray.ItemByID("export-diagnostics") != nil {
				t.Fatal("diagnostics export must not appear in the menu-bar menu")
			}

			var appItems []*mygo.MenuItem
			for _, candidate := range app.Items() {
				if candidate.Role == mygo.RoleAppMenu {
					appItems = candidate.Submenu
					break
				}
			}
			if appItems == nil {
				t.Fatal("the native app menu is missing")
			}
			about, updates, export := -1, -1, -1
			for index, candidate := range appItems {
				switch {
				case candidate.Role == mygo.RoleAbout:
					about = index
				case candidate.ID == "desktop-updates":
					updates = index
				case candidate.ID == "export-diagnostics":
					export = index
				}
			}
			if about < 0 || updates != about+1 || export != updates+1 {
				t.Fatalf("app menu order about=%d updates=%d export=%d, want adjacent About, updates, export", about, updates, export)
			}
		})
	}
}

func TestDiagnosticsReportUsesValidatedVersionAndUnpairedDefaults(t *testing.T) {
	stubDiagnosticsPermissions(t, permissionflow.Granted, permissionflow.Denied)
	originalVersion := mygo.App.Version()
	defer mygo.App.SetVersion(originalVersion)
	for _, test := range []struct{ name, version, want string }{
		{"packaged app", "1.2.3", "1.2.3"},
		{"unpackaged development build", "", "development"},
		{"invalid version", "1.2.3 beta", "development"},
		{"overlong version", strings.Repeat("1", 41), "development"},
	} {
		t.Run(test.name, func(t *testing.T) {
			mygo.App.SetVersion(test.version)
			report := (&Desktop{}).diagnosticSnapshot()
			if report.AppVersion != test.want {
				t.Fatalf("appVersion = %q, want %q", report.AppVersion, test.want)
			}
			if report.Device.State != DeviceUnpaired || report.Device.ExecutionReady ||
				report.Device.ComputerReady || report.Device.ErrorCode != "" {
				t.Fatalf("default device report = %+v, want unpaired without readiness or error", report.Device)
			}
			if report.Permissions.Accessibility.Status != ComputerPermissionStatusGranted ||
				report.Permissions.Accessibility.Reason != ComputerPermissionReasonChecked {
				t.Fatalf("Accessibility = %+v", report.Permissions.Accessibility)
			}
			if report.Permissions.ScreenRecording.Status != ComputerPermissionStatusNotGranted ||
				report.Permissions.ScreenRecording.Reason != ComputerPermissionReasonChecked {
				t.Fatalf("Screen Recording = %+v", report.Permissions.ScreenRecording)
			}
		})
	}
}

func TestDiagnosticsReportUnpackagedPermissionsDoNotProbeTCC(t *testing.T) {
	fake := fakeComputerPermission()
	fake.guideApp = ""
	fake.check = func(permissionflow.Permission) (permissionflow.Status, error) {
		t.Fatal("an unpackaged diagnostic export probed TCC")
		return permissionflow.Unknown, nil
	}
	stubComputerPermission(t, fake)
	report := (&Desktop{}).diagnosticSnapshot()
	for name, permission := range map[string]diagnosticPermission{
		"Accessibility":    report.Permissions.Accessibility,
		"Screen Recording": report.Permissions.ScreenRecording,
	} {
		if permission.Status != ComputerPermissionStatusUnknown || permission.Reason != ComputerPermissionReasonNotPackaged {
			t.Fatalf("%s = %+v, want unknown/notPackaged", name, permission)
		}
	}
}

func TestDiagnosticsConnectedSnapshotOmitsPrivateIdentityAndUnsafeErrors(t *testing.T) {
	stubDiagnosticsPermissions(t, permissionflow.Denied, permissionflow.Granted)
	credential := deviceFixtureCredential()
	credential.Name = "Synthetic Private Name"
	credential.DeviceID = "https://private.example.invalid/devices/secret-id"
	origin, err := url.Parse("https://private.example.invalid/account/private")
	if err != nil {
		t.Fatal(err)
	}
	connection := newFixtureDeviceConnection(t, origin, credential)
	t.Cleanup(connection.cancel)
	d := &Desktop{}
	d.mu.Lock()
	d.device = connection
	d.mu.Unlock()
	for _, test := range []struct{ name, code, want string }{
		{"stable allowlisted error", "DESKTOP_CONNECTION_REPLACED", "DESKTOP_CONNECTION_REPLACED"},
		{"arbitrary raw error", "write /Users/private/secret at https://private.example.invalid/raw", ""},
		{"unknown stable-looking error", "AUTH_SESSION_EXPIRED", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			connection.mu.Lock()
			connection.status = DeviceConnectionStatus{
				State: DeviceOnline, DeviceID: credential.DeviceID, Name: credential.Name,
				ErrorCode: test.code, ExecutionReady: true, ComputerReady: true,
			}
			connection.mu.Unlock()
			report := d.diagnosticSnapshot()
			if report.Device.State != DeviceOnline || report.Device.ErrorCode != test.want {
				t.Fatalf("device report = %+v, want online with error %q", report.Device, test.want)
			}
			data, err := json.Marshal(report)
			if err != nil {
				t.Fatal(err)
			}
			for _, secret := range []string{credential.Name, credential.DeviceID, origin.String(), "private.example.invalid", "/Users/private"} {
				if strings.Contains(string(data), secret) {
					t.Fatalf("diagnostic report leaked %q: %s", secret, data)
				}
			}
		})
	}
}

func TestDiagnosticsErrorCodeAllowsExactlyTheBridgeCodes(t *testing.T) {
	for _, code := range []string{
		"AUTH_REQUIRED", "RUNNER_UNAVAILABLE", "DESKTOP_PROTOCOL_ERROR", "DESKTOP_CONNECTION_REPLACED",
	} {
		if got := diagnosticErrorCode(code); got != code {
			t.Fatalf("allowlisted code %q became %q", code, got)
		}
	}
	for _, code := range []string{
		"", "auth_required", "RUNNER_UNAVAILABLE ", "AUTH_SESSION_EXPIRED",
		"raw error /Users/private/secret", "https://private.example.invalid/error",
	} {
		if got := diagnosticErrorCode(code); got != "" {
			t.Fatalf("unallowlisted code %q became %q", code, got)
		}
	}
	report := newDiagnosticReport(
		"1.2.3",
		DeviceConnectionStatus{
			State: DeviceOnline, ExecutionReady: true, ComputerReady: true,
			ErrorCode: "RUNNER_UNAVAILABLE",
		},
		ComputerPermissionResult{Status: ComputerPermissionStatusGranted, Reason: ComputerPermissionReasonChecked},
		ComputerPermissionResult{Status: ComputerPermissionStatusNotGranted, Reason: ComputerPermissionReasonChecked},
	)
	if !report.Device.ExecutionReady || !report.Device.ComputerReady || report.Device.ErrorCode != "RUNNER_UNAVAILABLE" {
		t.Fatalf("connected report lost readiness or its stable error: %+v", report.Device)
	}
}

func TestDiagnosticsExportCancellationWritesNothingAndShowsNoFailure(t *testing.T) {
	stubDiagnosticsPermissions(t, permissionflow.Denied, permissionflow.Denied)
	target := filepath.Join(t.TempDir(), "canceled.json")
	window := &mygo.Window{}
	d := &Desktop{}
	d.mu.Lock()
	d.window = window
	d.mu.Unlock()
	tx := locales.In("en-US")
	d.diagnostics.save = func(options mygo.SaveDialogOptions) (string, error) {
		if options.Parent != window {
			t.Fatal("the save panel did not prefer the main window as parent")
		}
		if options.Title != tx.DiagnosticsExportTitle() || options.Message != tx.DiagnosticsPrivacy() {
			t.Fatalf("save dialog text = %q / %q", options.Title, options.Message)
		}
		if filepath.Base(options.DefaultPath) != diagnosticsExportFileName {
			t.Fatalf("default path = %q, want file name %q", options.DefaultPath, diagnosticsExportFileName)
		}
		if len(options.Filters) != 1 || len(options.Filters[0].Extensions) != 1 || options.Filters[0].Extensions[0] != "json" {
			t.Fatalf("save filters = %+v", options.Filters)
		}
		return "", nil
	}
	d.diagnostics.message = func(mygo.MessageOptions) (mygo.MessageResult, error) {
		t.Fatal("a canceled save showed a failure")
		return mygo.MessageResult{}, nil
	}
	d.diagnostics.write = func(string, []byte) error {
		t.Fatal("a canceled save wrote a file")
		return nil
	}
	d.runDiagnosticsExport(tx)
	if _, err := os.Stat(target); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("canceled target exists or stat failed: %v", err)
	}
	entries, err := os.ReadDir(filepath.Dir(target))
	if err != nil || len(entries) != 0 {
		t.Fatalf("canceled save left files: %v, %v", entries, err)
	}
}

func TestDiagnosticsExportFailureIsLocalizedAndBounded(t *testing.T) {
	stubDiagnosticsPermissions(t, permissionflow.Denied, permissionflow.Denied)
	dir := t.TempDir()
	target := filepath.Join(dir, "diagnostics.json")
	if err := os.WriteFile(target, []byte("existing target bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	secret := "write failed at /Users/private/secret.json"
	d := &Desktop{}
	d.diagnostics.save = func(mygo.SaveDialogOptions) (string, error) { return target, nil }
	d.diagnostics.write = func(path string, data []byte) error {
		if path != target {
			t.Fatalf("write path = %q, want chosen path", path)
		}
		return errors.New(secret)
	}
	var shown mygo.MessageOptions
	d.diagnostics.message = func(options mygo.MessageOptions) (mygo.MessageResult, error) {
		shown = options
		return mygo.MessageResult{}, nil
	}
	tx := locales.In("en-US")
	d.runDiagnosticsExport(tx)
	if shown.Type != mygo.MessageError {
		t.Fatalf("failure dialog type = %q, want error", shown.Type)
	}
	if shown.Title != "" || shown.Message != tx.DiagnosticsExportFailedHeading() ||
		shown.Detail != tx.DiagnosticsExportFailedDetail() {
		t.Fatalf("failure dialog title = %q, message = %q, detail = %q; want visible heading and detail only", shown.Title, shown.Message, shown.Detail)
	}
	for _, text := range []string{shown.Message, shown.Detail} {
		if strings.Contains(text, secret) || strings.Contains(text, "/Users/private") {
			t.Fatalf("failure dialog leaked the error: %+v", shown)
		}
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "existing target bytes" {
		t.Fatalf("failed export changed the existing target: %q, %v", data, err)
	}
}

func TestDiagnosticsExportQuitDuringSaveWritesNothingAndShowsNoFailure(t *testing.T) {
	stubDiagnosticsPermissions(t, permissionflow.Denied, permissionflow.Denied)
	dir := t.TempDir()
	target := filepath.Join(dir, "quit-during-save.json")
	if err := os.WriteFile(target, []byte("existing target bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	d := &Desktop{}
	entered := false
	d.diagnostics.save = func(mygo.SaveDialogOptions) (string, error) {
		if d.quitting.Load() {
			t.Fatal("the save panel was entered after quitting had started")
		}
		entered = true
		// OnBeforeQuit runs while the live panel is open.
		d.quitting.Store(true)
		return target, nil
	}
	d.diagnostics.message = func(mygo.MessageOptions) (mygo.MessageResult, error) {
		t.Fatal("quitting after the save finished showed a diagnostics failure")
		return mygo.MessageResult{}, nil
	}
	d.diagnostics.write = func(string, []byte) error {
		t.Fatal("quitting after the save finished wrote a diagnostics file")
		return nil
	}
	d.runDiagnosticsExport(locales.In("en-US"))
	if !entered {
		t.Fatal("the export did not enter its save panel while live")
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "existing target bytes" {
		t.Fatalf("quitting during save changed the existing target: %q, %v", data, err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 || entries[0].Name() != filepath.Base(target) {
		t.Fatalf("quitting during save left files: %v, %v", entries, err)
	}
}

func TestDiagnosticsExportSaveErrorAfterQuitShowsNoFailure(t *testing.T) {
	stubDiagnosticsPermissions(t, permissionflow.Denied, permissionflow.Denied)
	d := &Desktop{}
	entered := false
	d.diagnostics.save = func(mygo.SaveDialogOptions) (string, error) {
		if d.quitting.Load() {
			t.Fatal("the save panel was entered after quitting had started")
		}
		entered = true
		d.quitting.Store(true)
		return "", errors.New("the panel closed while quitting")
	}
	d.diagnostics.message = func(mygo.MessageOptions) (mygo.MessageResult, error) {
		t.Fatal("a save error after quitting showed a diagnostics failure")
		return mygo.MessageResult{}, nil
	}
	d.diagnostics.write = func(string, []byte) error {
		t.Fatal("a save error wrote a diagnostics file")
		return nil
	}
	d.runDiagnosticsExport(locales.In("en-US"))
	if !entered {
		t.Fatal("the export did not enter its save panel while live")
	}
}

func TestDiagnosticsExportDoesNotStartAfterQuit(t *testing.T) {
	stubDiagnosticsPermissions(t, permissionflow.Denied, permissionflow.Denied)
	d := &Desktop{}
	d.quitting.Store(true)
	defer d.quitting.Store(false)
	d.diagnostics.save = func(mygo.SaveDialogOptions) (string, error) {
		t.Fatal("an export started after quitting opened its save panel")
		return "", nil
	}
	d.startDiagnosticsExport(locales.In("en-US"))
	if d.diagnostics.busy.Load() {
		t.Fatal("an export started after quitting left the busy guard set")
	}
}

func TestDiagnosticsExportWritesMinimalReportToChosenTempDir(t *testing.T) {
	stubDiagnosticsPermissions(t, permissionflow.Granted, permissionflow.NotDetermined)
	originalVersion := mygo.App.Version()
	defer mygo.App.SetVersion(originalVersion)
	mygo.App.SetVersion("9.9.9")
	dir := t.TempDir()
	target := filepath.Join(dir, "picked.json")
	d := &Desktop{}
	d.diagnostics.save = func(mygo.SaveDialogOptions) (string, error) { return target, nil }
	d.diagnostics.message = func(mygo.MessageOptions) (mygo.MessageResult, error) {
		t.Fatal("a successful export showed a failure")
		return mygo.MessageResult{}, nil
	}
	d.runDiagnosticsExport(locales.In("en-US"))
	data, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	var report diagnosticReport
	if err := json.Unmarshal(data, &report); err != nil {
		t.Fatalf("exported invalid JSON %q: %v", data, err)
	}
	if report.AppVersion != "9.9.9" || report.Device.State != DeviceUnpaired ||
		report.Device.ExecutionReady || report.Device.ComputerReady || report.Device.ErrorCode != "" {
		t.Fatalf("exported report = %+v", report)
	}
	if report.Permissions.Accessibility.Status != ComputerPermissionStatusGranted ||
		report.Permissions.ScreenRecording.Status != ComputerPermissionStatusNotDetermined ||
		report.Permissions.Accessibility.Reason != ComputerPermissionReasonChecked ||
		report.Permissions.ScreenRecording.Reason != ComputerPermissionReasonChecked {
		t.Fatalf("exported permissions = %+v", report.Permissions)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("export mode = %o, want 600", info.Mode().Perm())
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 || entries[0].Name() != "picked.json" {
		t.Fatalf("successful export left temp files: %v, %v", entries, err)
	}
}

func TestWritePrivateDiagnosticsWritesClosedPrivateFile(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, diagnosticsExportFileName)
	data := []byte("{\"appVersion\":\"1.2.3\"}\n")
	if err := writePrivateDiagnostics(target, data); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(target)
	if err != nil || string(got) != string(data) {
		t.Fatalf("written bytes = %q, %v; want %q", got, err, data)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("export mode = %o, want 600", info.Mode().Perm())
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 || entries[0].Name() != diagnosticsExportFileName {
		t.Fatalf("export left temp files: %v, %v", entries, err)
	}
}

func TestWritePrivateDiagnosticsReplacesFinalSymlinkNotItsTarget(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "real.json")
	if err := os.WriteFile(target, []byte("symlink target"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "chosen.json")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := writePrivateDiagnostics(link, []byte("new export\n")); err != nil {
		t.Fatal(err)
	}
	realBytes, err := os.ReadFile(target)
	if err != nil || string(realBytes) != "symlink target" {
		t.Fatalf("final symlink was followed: %q, %v", realBytes, err)
	}
	linkInfo, err := os.Lstat(link)
	if err != nil {
		t.Fatal(err)
	}
	if linkInfo.Mode()&os.ModeSymlink != 0 {
		t.Fatal("the chosen final symlink was not replaced")
	}
	linkBytes, err := os.ReadFile(link)
	if err != nil || string(linkBytes) != "new export\n" {
		t.Fatalf("replacement bytes = %q, %v", linkBytes, err)
	}
}

func TestWritePrivateDiagnosticsRenameFailureKeepsTargetAndRemovesTemp(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "diagnostics.json")
	if err := os.WriteFile(target, []byte("existing target bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	renameErr := errors.New("fixture rename failure")
	err := writePrivateDiagnosticsWithRename(target, []byte("new bytes"), func(oldPath, newPath string) error {
		if newPath != target || filepath.Dir(oldPath) != dir {
			t.Fatalf("rename = %q -> %q, want a sibling temp to the chosen path", oldPath, newPath)
		}
		if _, err := os.Stat(oldPath); err != nil {
			t.Fatalf("temp file was not written before rename: %v", err)
		}
		return renameErr
	})
	if !errors.Is(err, renameErr) {
		t.Fatalf("rename failure returned %v", err)
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "existing target bytes" {
		t.Fatalf("rename failure changed the existing target: %q, %v", data, err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 || entries[0].Name() != "diagnostics.json" {
		t.Fatalf("rename failure left a temp file: %v, %v", entries, err)
	}
}

func TestDiagnosticsMenuDoesNotStackSavePanels(t *testing.T) {
	stubDiagnosticsPermissions(t, permissionflow.Denied, permissionflow.Denied)
	d := &Desktop{}
	entered := make(chan struct{})
	release := make(chan struct{})
	finished := make(chan struct{})
	var saves atomic.Int32
	d.diagnostics.save = func(mygo.SaveDialogOptions) (string, error) {
		if saves.Add(1) == 1 {
			close(entered)
		}
		<-release
		close(finished)
		return "", nil
	}
	app, _ := d.shellMenus(locales.In("en-US"))
	item := app.ItemByID("export-diagnostics")
	item.Click(item, nil)
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("the first export did not open its save dialog")
	}
	item.Click(item, nil)
	if got := saves.Load(); got != 1 {
		t.Fatalf("a reentrant menu action opened %d save panels, want 1", got)
	}
	close(release)
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("the first export did not finish")
	}
	deadline := time.Now().Add(5 * time.Second)
	for d.diagnostics.busy.Load() && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if d.diagnostics.busy.Load() {
		t.Fatal("the diagnostics export guard did not clear")
	}
}
