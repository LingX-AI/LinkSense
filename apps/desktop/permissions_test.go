package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo/plugins/permissionflow"
)

func stubComputerPermission(t *testing.T, fake computerPermissionSystem) {
	t.Helper()
	previous := computerPermission
	computerPermission = fake
	t.Cleanup(func() { computerPermission = previous })
}

func fakeComputerPermission() computerPermissionSystem {
	return computerPermissionSystem{
		goos:     "darwin",
		guideApp: "/Applications/LinkSense.app",
		check: func(permissionflow.Permission) (permissionflow.Status, error) {
			return permissionflow.Denied, nil
		},
		guide: func(context.Context, permissionflow.Permission, permissionflow.GuideOptions) (permissionflow.Status, error) {
			return permissionflow.Denied, nil
		},
		openSettings: func(permissionflow.Permission) error { return nil },
	}
}

func writeTestExecutable(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
}

func TestComputerPermissionKindsAreClosed(t *testing.T) {
	stubComputerPermission(t, fakeComputerPermission())
	for _, test := range []struct {
		kind ComputerPermissionKind
		want permissionflow.Permission
		ok   bool
	}{
		{ComputerPermissionAccessibility, permissionflow.Accessibility, true},
		{ComputerPermissionScreenRecording, permissionflow.ScreenRecording, true},
		{"", "", false},
		{"microphone", "", false},
		{"screen-recording", "", false},
		{"Accessibility", "", false},
		{"accessibility ", "", false},
	} {
		got, reason, ok := test.kind.permissionFor()
		if ok != test.ok || got != test.want {
			t.Fatalf("%q mapped to %q, %t; want %q, %t", test.kind, got, ok, test.want, test.ok)
		}
		if !test.ok && reason != ComputerPermissionReasonInvalidKind {
			t.Fatalf("%q reason = %q, want invalidKind", test.kind, reason)
		}
	}
}

func TestComputerPermissionGateFailsClosed(t *testing.T) {
	for _, test := range []struct {
		name     string
		goos     string
		guideApp string
		want     ComputerPermissionReason
	}{
		{"non-macOS", "windows", "/Applications/LinkSense.app", ComputerPermissionReasonUnsupported},
		{"unpackaged guide", "darwin", "", ComputerPermissionReasonNotPackaged},
	} {
		t.Run(test.name, func(t *testing.T) {
			fake := fakeComputerPermission()
			fake.goos = test.goos
			fake.guideApp = test.guideApp
			stubComputerPermission(t, fake)
			_, reason, ok := ComputerPermissionAccessibility.permissionFor()
			if ok || reason != test.want {
				t.Fatalf("permissionFor = %q, %t; want %q, false", reason, ok, test.want)
			}
		})
	}
}

func TestComputerPermissionBundleCheckUsesActualExecutableLayout(t *testing.T) {
	root := t.TempDir()
	normalBundle := filepath.Join(root, "LinkSense.app", "Contents", "MacOS", "LinkSense")
	testBundle := filepath.Join(root, "LinkSense Desktop Test.app", "Contents", "MacOS", "desktop.test")
	standalone := filepath.Join(root, "standalone", "linksense")
	withoutApp := filepath.Join(root, "Contents", "MacOS", "linksense")
	bundleHelper := filepath.Join(root, "LinkSense.app", "Contents", "Helpers", "linksense")
	for _, path := range []string{normalBundle, testBundle, standalone, withoutApp, bundleHelper} {
		writeTestExecutable(t, path)
	}
	for _, test := range []struct {
		name string
		path string
		want bool
	}{
		{"normal app bundle", normalBundle, true},
		{"test app bundle", testBundle, true},
		{"standalone executable", standalone, false},
		{"Contents/MacOS without .app", withoutApp, false},
		{"bundle helper", bundleHelper, false},
	} {
		if _, got := executableAppBundle(test.path); got != test.want {
			t.Fatalf("%s: executableAppBundle = %t, want %t", test.name, got, test.want)
		}
	}
	if runtime.GOOS != "windows" {
		link := filepath.Join(root, "linksense-link")
		if err := os.Symlink(normalBundle, link); err != nil {
			t.Fatal(err)
		}
		if _, ok := executableAppBundle(link); !ok {
			t.Fatal("a symlink to the bundle executable was not recognized")
		}
	}
	missing := filepath.Join(root, "missing", "LinkSense.app", "Contents", "MacOS", "LinkSense")
	if _, ok := executableAppBundle(missing); ok {
		t.Fatal("a missing executable was treated as a bundle")
	}
}

func TestComputerPermissionGuideUsesTheActualBundleLayout(t *testing.T) {
	root := t.TempDir()
	bundleExe := filepath.Join(root, "LinkSense.app", "Contents", "MacOS", "LinkSense")
	standaloneExe := filepath.Join(root, "standalone", "linksense")
	writeTestExecutable(t, bundleExe)
	writeTestExecutable(t, standaloneExe)
	for _, test := range []struct {
		name       string
		exe        string
		wantStatus ComputerPermissionStatus
		wantReason ComputerPermissionReason
		wantGuide  bool
	}{
		{"bundle executable", bundleExe, ComputerPermissionStatusNotGranted, ComputerPermissionReasonClosed, true},
		{"standalone executable", standaloneExe, ComputerPermissionStatusUnknown, ComputerPermissionReasonNotPackaged, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			var checked, guided, opened bool
			fake := fakeComputerPermission()
			fake.guideApp, _ = executableAppBundle(test.exe)
			fake.check = func(permissionflow.Permission) (permissionflow.Status, error) {
				checked = true
				return permissionflow.Denied, nil
			}
			fake.guide = func(context.Context, permissionflow.Permission, permissionflow.GuideOptions) (permissionflow.Status, error) {
				guided = true
				return permissionflow.Denied, nil
			}
			fake.openSettings = func(permissionflow.Permission) error {
				opened = true
				return nil
			}
			stubComputerPermission(t, fake)
			result := guideComputerPermission(context.Background(), ComputerPermissionAccessibility)
			if result.Reason != test.wantReason || result.Status != test.wantStatus {
				t.Fatalf("Guide = %+v, want %q/%q", result, test.wantStatus, test.wantReason)
			}
			if guided != test.wantGuide || checked != test.wantGuide || opened {
				t.Fatalf("checked=%t guided=%t opened=%t, want checked=%t guided=%t opened=false", checked, guided, opened, test.wantGuide, test.wantGuide)
			}
		})
	}
}

func TestComputerPermissionGuidePassesTheVerifiedBundlePath(t *testing.T) {
	root := t.TempDir()
	bundleExe := filepath.Join(root, "LinkSense.app", "Contents", "MacOS", "LinkSense")
	writeTestExecutable(t, bundleExe)
	wantApp, err := filepath.EvalSymlinks(filepath.Join(root, "LinkSense.app"))
	if err != nil {
		t.Fatal(err)
	}
	appPath, ok := executableAppBundle(bundleExe)
	if !ok || appPath != wantApp {
		t.Fatalf("executableAppBundle = %q, %t; want %q, true", appPath, ok, wantApp)
	}
	if standalone, ok := executableAppBundle(filepath.Join(root, "linksense")); ok || standalone != "" {
		t.Fatalf("a standalone executable produced %q, %t; want no bundle", standalone, ok)
	}

	var got permissionflow.GuideOptions
	fake := fakeComputerPermission()
	fake.guideApp = appPath
	fake.guide = func(_ context.Context, _ permissionflow.Permission, options permissionflow.GuideOptions) (permissionflow.Status, error) {
		got = options
		return permissionflow.Denied, nil
	}
	stubComputerPermission(t, fake)
	result := guideComputerPermission(context.Background(), ComputerPermissionAccessibility)
	if result.Status != ComputerPermissionStatusNotGranted || result.Reason != ComputerPermissionReasonClosed {
		t.Fatalf("Guide = %+v, want notGranted/closed", result)
	}
	if got.App != appPath {
		t.Fatalf("Guide app = %q, want the verified bundle %q", got.App, appPath)
	}
}

func TestComputerPermissionCheckReportsStatusWithoutGuiding(t *testing.T) {
	for _, test := range []struct {
		kind   ComputerPermissionKind
		status permissionflow.Status
		want   ComputerPermissionStatus
	}{
		{ComputerPermissionAccessibility, permissionflow.Granted, ComputerPermissionStatusGranted},
		{ComputerPermissionScreenRecording, permissionflow.Denied, ComputerPermissionStatusNotGranted},
		{ComputerPermissionAccessibility, permissionflow.NotDetermined, ComputerPermissionStatusNotDetermined},
		{ComputerPermissionScreenRecording, permissionflow.Unknown, ComputerPermissionStatusUnknown},
	} {
		var guided, opened bool
		fake := fakeComputerPermission()
		fake.check = func(permissionflow.Permission) (permissionflow.Status, error) {
			return test.status, nil
		}
		fake.guide = func(context.Context, permissionflow.Permission, permissionflow.GuideOptions) (permissionflow.Status, error) {
			guided = true
			return permissionflow.Granted, nil
		}
		fake.openSettings = func(permissionflow.Permission) error {
			opened = true
			return nil
		}
		stubComputerPermission(t, fake)
		result := checkComputerPermission(test.kind)
		if result.Kind != test.kind || result.Status != test.want || result.Reason != ComputerPermissionReasonChecked {
			t.Fatalf("Check(%q) = %+v, want status %q and reason %q", test.kind, result, test.want, ComputerPermissionReasonChecked)
		}
		if guided || opened {
			t.Fatal("Check opened a guide or System Settings")
		}
	}
}

func TestComputerPermissionCheckMapsErrors(t *testing.T) {
	for _, test := range []struct {
		err  error
		want ComputerPermissionReason
	}{
		{errors.ErrUnsupported, ComputerPermissionReasonUnsupported},
		{errors.New("CoreGraphics failed at /System/Library/Frameworks"), ComputerPermissionReasonFailed},
	} {
		fake := fakeComputerPermission()
		fake.check = func(permissionflow.Permission) (permissionflow.Status, error) {
			return permissionflow.Unknown, test.err
		}
		stubComputerPermission(t, fake)
		result := checkComputerPermission(ComputerPermissionAccessibility)
		if result.Status != ComputerPermissionStatusUnknown || result.Reason != test.want {
			t.Fatalf("Check error %v = %+v, want unknown/%q", test.err, result, test.want)
		}
	}
}

func TestComputerPermissionGuideReturnsPregrantedWithoutOpening(t *testing.T) {
	var guided, opened bool
	fake := fakeComputerPermission()
	fake.check = func(permissionflow.Permission) (permissionflow.Status, error) {
		return permissionflow.Granted, nil
	}
	fake.guide = func(context.Context, permissionflow.Permission, permissionflow.GuideOptions) (permissionflow.Status, error) {
		guided = true
		return permissionflow.Denied, nil
	}
	fake.openSettings = func(permissionflow.Permission) error {
		opened = true
		return nil
	}
	stubComputerPermission(t, fake)
	result := guideComputerPermission(context.Background(), ComputerPermissionAccessibility)
	want := ComputerPermissionResult{
		Kind: ComputerPermissionAccessibility, Status: ComputerPermissionStatusGranted,
		Reason: ComputerPermissionReasonGranted,
	}
	if result != want {
		t.Fatalf("pregranted Guide = %+v, want %+v", result, want)
	}
	if guided || opened {
		t.Fatal("a pregranted Guide opened the plugin or System Settings")
	}
}

func TestComputerPermissionGuideStopsWhenTheCheckFails(t *testing.T) {
	for _, test := range []struct {
		err  error
		want ComputerPermissionReason
	}{
		{errors.ErrUnsupported, ComputerPermissionReasonUnsupported},
		{errors.New("permissionflow: /Users/private/app.app"), ComputerPermissionReasonFailed},
	} {
		var guided, opened bool
		fake := fakeComputerPermission()
		fake.check = func(permissionflow.Permission) (permissionflow.Status, error) {
			return permissionflow.Unknown, test.err
		}
		fake.guide = func(context.Context, permissionflow.Permission, permissionflow.GuideOptions) (permissionflow.Status, error) {
			guided = true
			return permissionflow.Granted, nil
		}
		fake.openSettings = func(permissionflow.Permission) error {
			opened = true
			return nil
		}
		stubComputerPermission(t, fake)
		result := guideComputerPermission(context.Background(), ComputerPermissionAccessibility)
		if result.Status != ComputerPermissionStatusUnknown || result.Reason != test.want {
			t.Fatalf("failed pre-check = %+v, want unknown/%q", result, test.want)
		}
		if guided || opened {
			t.Fatal("a failed pre-check still guided or opened settings")
		}
	}
}

func TestComputerPermissionGuideKeepsDismissalDistinctFromGrant(t *testing.T) {
	var opened bool
	fake := fakeComputerPermission()
	fake.guide = func(ctx context.Context, permission permissionflow.Permission, options permissionflow.GuideOptions) (permissionflow.Status, error) {
		if permission != permissionflow.ScreenRecording {
			t.Errorf("guided %q, want screen recording", permission)
		}
		// The verified bundle path is the only option; the renderer never
		// supplies a path or target.
		if options != (permissionflow.GuideOptions{App: fake.guideApp}) {
			t.Errorf("Guide options = %+v, want the verified app %q", options, fake.guideApp)
		}
		if _, ok := ctx.Deadline(); !ok {
			t.Error("Guide did not receive a bounded context")
		}
		return permissionflow.Denied, nil
	}
	fake.openSettings = func(permissionflow.Permission) error {
		opened = true
		return nil
	}
	stubComputerPermission(t, fake)
	result := guideComputerPermission(context.Background(), ComputerPermissionScreenRecording)
	if result.Status != ComputerPermissionStatusNotGranted || result.Reason != ComputerPermissionReasonClosed {
		t.Fatalf("dismissed Guide = %+v, want notGranted/closed", result)
	}
	if opened {
		t.Fatal("Guide opened System Settings through the manual fallback as well")
	}
}

func TestComputerPermissionGuideKeepsCancellationAndTimeoutDistinct(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		want ComputerPermissionReason
	}{
		{"canceled", context.Canceled, ComputerPermissionReasonCanceled},
		{"deadline", context.DeadlineExceeded, ComputerPermissionReasonTimedOut},
	} {
		fake := fakeComputerPermission()
		fake.guide = func(context.Context, permissionflow.Permission, permissionflow.GuideOptions) (permissionflow.Status, error) {
			return permissionflow.Denied, test.err
		}
		stubComputerPermission(t, fake)
		result := guideComputerPermission(context.Background(), ComputerPermissionAccessibility)
		if result.Status != ComputerPermissionStatusNotGranted || result.Reason != test.want {
			t.Fatalf("%s Guide = %+v, want notGranted/%q", test.name, result, test.want)
		}
	}
}

func TestComputerPermissionGuideTimeoutEndsTheWait(t *testing.T) {
	fake := fakeComputerPermission()
	fake.guide = func(ctx context.Context, _ permissionflow.Permission, _ permissionflow.GuideOptions) (permissionflow.Status, error) {
		<-ctx.Done()
		return permissionflow.Denied, ctx.Err()
	}
	stubComputerPermission(t, fake)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	result := guideComputerPermission(ctx, ComputerPermissionAccessibility)
	if result.Status != ComputerPermissionStatusNotGranted || result.Reason != ComputerPermissionReasonTimedOut {
		t.Fatalf("timed out Guide = %+v, want notGranted/timedOut", result)
	}
}

func TestComputerPermissionGuideDoesNotLaunchForCanceledContext(t *testing.T) {
	var guided bool
	fake := fakeComputerPermission()
	fake.guide = func(context.Context, permissionflow.Permission, permissionflow.GuideOptions) (permissionflow.Status, error) {
		guided = true
		return permissionflow.Granted, nil
	}
	stubComputerPermission(t, fake)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result := guideComputerPermission(ctx, ComputerPermissionAccessibility)
	if result.Status != ComputerPermissionStatusNotGranted || result.Reason != ComputerPermissionReasonCanceled {
		t.Fatalf("canceled Guide = %+v, want notGranted/canceled", result)
	}
	if guided {
		t.Fatal("a canceled Guide still opened the plugin's panel")
	}
}

func TestComputerPermissionFailsClosedOutsideMacOSAndUnpackaged(t *testing.T) {
	t.Run("non-macOS", func(t *testing.T) {
		var checked, guided, opened bool
		fake := fakeComputerPermission()
		fake.goos = "windows"
		fake.check = func(permissionflow.Permission) (permissionflow.Status, error) {
			checked = true
			return permissionflow.Granted, nil
		}
		fake.guide = func(context.Context, permissionflow.Permission, permissionflow.GuideOptions) (permissionflow.Status, error) {
			guided = true
			return permissionflow.Granted, nil
		}
		fake.openSettings = func(permissionflow.Permission) error {
			opened = true
			return nil
		}
		stubComputerPermission(t, fake)
		if result := checkComputerPermission(ComputerPermissionAccessibility); result.Reason != ComputerPermissionReasonUnsupported {
			t.Fatalf("non-macOS Check = %+v, want unsupported", result)
		}
		if result := guideComputerPermission(context.Background(), ComputerPermissionAccessibility); result.Reason != ComputerPermissionReasonUnsupported {
			t.Fatalf("non-macOS Guide = %+v, want unsupported", result)
		}
		if err := openComputerPermissionSettings(ComputerPermissionAccessibility); !errors.Is(err, errComputerPermissionUnsupported) {
			t.Fatalf("non-macOS settings = %v, want unsupported", err)
		}
		if checked || guided || opened {
			t.Fatal("a non-macOS path reached the plugin or System Settings")
		}
	})
	t.Run("unpackaged", func(t *testing.T) {
		var checked, guided, opened bool
		fake := fakeComputerPermission()
		fake.guideApp = ""
		fake.check = func(permissionflow.Permission) (permissionflow.Status, error) {
			checked = true
			return permissionflow.Granted, nil
		}
		fake.guide = func(context.Context, permissionflow.Permission, permissionflow.GuideOptions) (permissionflow.Status, error) {
			guided = true
			return permissionflow.Granted, nil
		}
		fake.openSettings = func(permissionflow.Permission) error {
			opened = true
			return nil
		}
		stubComputerPermission(t, fake)
		if result := checkComputerPermission(ComputerPermissionAccessibility); result.Status != ComputerPermissionStatusUnknown || result.Reason != ComputerPermissionReasonNotPackaged {
			t.Fatalf("unpackaged Check = %+v, want unknown/notPackaged", result)
		}
		if result := guideComputerPermission(context.Background(), ComputerPermissionAccessibility); result.Reason != ComputerPermissionReasonNotPackaged {
			t.Fatalf("unpackaged Guide = %+v, want notPackaged", result)
		}
		if err := openComputerPermissionSettings(ComputerPermissionAccessibility); !errors.Is(err, errComputerPermissionNotPackaged) {
			t.Fatalf("unpackaged settings = %v, want notPackaged", err)
		}
		if checked || guided || opened {
			t.Fatalf("checked=%t guided=%t opened=%t, want all false", checked, guided, opened)
		}
	})
}

func TestComputerPermissionGuideMapsUnknownAndFailureWithoutGranting(t *testing.T) {
	for _, test := range []struct {
		name   string
		status permissionflow.Status
		err    error
		want   ComputerPermissionReason
	}{
		{"unknown", permissionflow.Unknown, nil, ComputerPermissionReasonUnknown},
		{"unsupported", permissionflow.Unknown, errors.ErrUnsupported, ComputerPermissionReasonUnsupported},
		{"failed", permissionflow.Unknown, errors.New("permissionflow: /Users/private/app.app"), ComputerPermissionReasonFailed},
	} {
		fake := fakeComputerPermission()
		fake.guide = func(context.Context, permissionflow.Permission, permissionflow.GuideOptions) (permissionflow.Status, error) {
			return test.status, test.err
		}
		stubComputerPermission(t, fake)
		result := guideComputerPermission(context.Background(), ComputerPermissionAccessibility)
		if result.Status != ComputerPermissionStatusUnknown || result.Reason != test.want {
			t.Fatalf("%s Guide = %+v, want unknown/%q", test.name, result, test.want)
		}
	}
}

func TestComputerPermissionSettingsUsePluginOpenOnlyWhenExplicit(t *testing.T) {
	var opened []permissionflow.Permission
	fake := fakeComputerPermission()
	fake.openSettings = func(permission permissionflow.Permission) error {
		opened = append(opened, permission)
		return nil
	}
	stubComputerPermission(t, fake)
	for _, test := range []struct {
		kind ComputerPermissionKind
		want permissionflow.Permission
	}{
		{ComputerPermissionAccessibility, permissionflow.Accessibility},
		{ComputerPermissionScreenRecording, permissionflow.ScreenRecording},
	} {
		if err := openComputerPermissionSettings(test.kind); err != nil {
			t.Fatalf("open %q: %v", test.kind, err)
		}
		if len(opened) == 0 || opened[len(opened)-1] != test.want {
			t.Fatalf("open %q reached %v, want %q", test.kind, opened, test.want)
		}
	}
	opened = nil
	if err := openComputerPermissionSettings("microphone"); !errors.Is(err, errComputerPermissionKind) {
		t.Fatalf("unknown kind = %v, want invalid kind", err)
	}
	if len(opened) != 0 {
		t.Fatal("an unknown kind opened System Settings")
	}
	computerPermission.openSettings = func(permissionflow.Permission) error {
		return errors.New("permissionflow: System Settings didn't open /Users/private")
	}
	err := openComputerPermissionSettings(ComputerPermissionAccessibility)
	if !errors.Is(err, errComputerPermissionSettings) {
		t.Fatalf("failed open = %v, want a stable settings failure", err)
	}
	if strings.Contains(err.Error(), "private") {
		t.Fatal("the OS error leaked through the bridge")
	}
	computerPermission.openSettings = func(permissionflow.Permission) error { return errors.ErrUnsupported }
	if err := openComputerPermissionSettings(ComputerPermissionAccessibility); !errors.Is(err, errComputerPermissionUnsupported) {
		t.Fatalf("unsupported open = %v, want unsupported", err)
	}
}

func TestComputerPermissionInvalidKindDoesNotReachTheSystem(t *testing.T) {
	var checked, guided, opened bool
	fake := fakeComputerPermission()
	fake.check = func(permissionflow.Permission) (permissionflow.Status, error) {
		checked = true
		return permissionflow.Granted, nil
	}
	fake.guide = func(context.Context, permissionflow.Permission, permissionflow.GuideOptions) (permissionflow.Status, error) {
		guided = true
		return permissionflow.Granted, nil
	}
	fake.openSettings = func(permissionflow.Permission) error {
		opened = true
		return nil
	}
	stubComputerPermission(t, fake)
	if result := checkComputerPermission("microphone"); result.Status != ComputerPermissionStatusUnknown || result.Reason != ComputerPermissionReasonInvalidKind {
		t.Fatalf("unknown kind Check = %+v, want unknown/invalidKind", result)
	}
	if result := guideComputerPermission(context.Background(), "microphone"); result.Status != ComputerPermissionStatusUnknown || result.Reason != ComputerPermissionReasonInvalidKind {
		t.Fatalf("unknown kind Guide = %+v, want unknown/invalidKind", result)
	}
	if err := openComputerPermissionSettings("microphone"); !errors.Is(err, errComputerPermissionKind) {
		t.Fatalf("unknown kind settings = %v, want invalid kind", err)
	}
	if checked || guided || opened {
		t.Fatal("an unknown kind reached the plugin or System Settings")
	}
}

func TestComputerPermissionMethodsRejectUntrustedCallers(t *testing.T) {
	fake := fakeComputerPermission()
	fake.check = func(permissionflow.Permission) (permissionflow.Status, error) {
		t.Fatal("an unbound caller reached the plugin check")
		return permissionflow.Unknown, nil
	}
	fake.guide = func(context.Context, permissionflow.Permission, permissionflow.GuideOptions) (permissionflow.Status, error) {
		t.Fatal("an unbound caller reached the plugin guide")
		return permissionflow.Unknown, nil
	}
	fake.openSettings = func(permissionflow.Permission) error {
		t.Fatal("an unbound caller reached System Settings")
		return nil
	}
	stubComputerPermission(t, fake)
	desktop := &Desktop{}
	if _, err := desktop.CheckComputerPermission(context.Background(), ComputerPermissionAccessibility); err == nil {
		t.Fatal("an unbound caller checked a computer permission")
	}
	if _, err := desktop.GuideComputerPermission(context.Background(), ComputerPermissionScreenRecording); err == nil {
		t.Fatal("an unbound caller guided a computer permission")
	}
	if err := desktop.OpenComputerPermissionSettings(context.Background(), ComputerPermissionAccessibility); err == nil {
		t.Fatal("an unbound caller opened computer permission settings")
	}
}
