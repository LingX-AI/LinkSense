package main

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestInstalledEngineAgainstIsolatedNativeWindow(t *testing.T) {
	if os.Getenv("LINKSENSE_DESKTOP_NATIVE_WHITEBOX") != "1" {
		t.Skip("set LINKSENSE_DESKTOP_NATIVE_WHITEBOX=1 to exercise the packaged native engine")
	}
	executable := os.Getenv("LINKSENSE_DESKTOP_APP_BIN")
	binary := os.Getenv("LINKSENSE_AGENT_DESKTOP_BIN")
	if executable == "" || binary == "" {
		t.Fatal("native whitebox requires explicit packaged client and engine paths")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	target := exec.CommandContext(ctx, executable, "-whitebox-target")
	if err := target.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = target.Process.Kill(); _ = target.Wait() }()
	engine := &nativeEngine{path: binary}
	defer engine.Stop()
	permissions := engine.Permissions(ctx)
	if permissions.Accessibility != "granted" {
		t.Fatal("macOS Accessibility permission is required for native whitebox")
	}
	if permissions.ScreenRecording != "granted" {
		t.Fatal("macOS Screen Recording permission is required for the full native whitebox")
	}
	credential, rpc := startComputerUseAPIFixture(t, ctx)
	connected := make(chan struct{}, 1)
	var approvals atomic.Int32
	bridge := &desktopBridge{
		engine: engine,
		onStatus: func(state bridgeStatus) {
			if state.Connected {
				select {
				case connected <- struct{}{}:
				default:
				}
			}
		},
		onApprove: func(_ context.Context, _ desktopCommand, answer func(bool)) {
			approvals.Add(1)
			answer(true)
		},
	}
	defer bridge.Disconnect()
	if err := bridge.Connect(ctx, credential); err != nil {
		t.Fatal(err)
	}
	select {
	case <-connected:
	case <-ctx.Done():
		t.Fatal("packaged engine bridge did not authenticate")
	}
	execute := func(request desktopRequest) toolResult {
		t.Helper()
		if request.Action != "status" {
			request.DeviceID = credential.Device.ID
		}
		var reply struct {
			Status int
			Result toolResult
		}
		rpc(map[string]any{"type": "execute", "input": request}, &reply)
		if reply.Status != 200 {
			t.Fatalf("native API request failed: status=%d code=%s", reply.Status, reply.Result.Code)
		}
		return reply.Result
	}
	if result := execute(desktopRequest{Action: "status"}); !result.OK || approvals.Load() != 0 {
		t.Fatal("status failed or requested task consent before an action")
	}
	if result := execute(desktopRequest{Action: "apps"}); !result.OK {
		t.Fatalf("native app inventory failed: %s", result.Code)
	}
	findWindow := func(app, title string) string {
		t.Helper()
		for attempt := 0; attempt < 35; attempt++ {
			result := execute(desktopRequest{Action: "windows", App: app})
			if result.OK && result.Data != nil {
				var windows []struct {
					ID    json.RawMessage `json:"id"`
					Title string          `json:"title"`
				}
				if json.Unmarshal([]byte(result.Data.Text), &windows) != nil {
					t.Fatal("invalid window response")
				}
				for _, window := range windows {
					if window.Title == title {
						var id string
						if json.Unmarshal(window.ID, &id) == nil {
							return id
						}
						return string(window.ID)
					}
				}
			}
			select {
			case <-ctx.Done():
				t.Fatal("isolated native window unavailable")
			case <-time.After(150 * time.Millisecond):
			}
		}
		t.Fatal("cannot locate only the isolated whitebox window; no other window was touched")
		return ""
	}
	appID := "org.linksense.desktop"
	windowID := findWindow(appID, "LinkSense Computer Use Whitebox")
	snapshot := func() toolResult {
		return execute(desktopRequest{Action: "snapshot", App: appID, WindowID: windowID})
	}
	findRef := func(result toolResult, label string) string {
		t.Helper()
		if !result.OK || result.Data == nil {
			t.Fatalf("snapshot failed: %s", result.Code)
		}
		type node struct {
			Name     string `json:"name"`
			Ref      string `json:"ref_id"`
			Children []node `json:"children"`
		}
		var document struct{ Tree node }
		if err := json.Unmarshal([]byte(result.Data.Text), &document); err != nil {
			t.Fatal(err)
		}
		ref := ""
		var visit func(node)
		visit = func(item node) {
			if item.Name == label && refPattern.MatchString(item.Ref) {
				ref = item.Ref
			}
			for _, child := range item.Children {
				visit(child)
			}
		}
		visit(document.Tree)
		if ref == "" {
			directory := os.Getenv("LINKSENSE_DESKTOP_SCREENSHOTS")
			if directory != "" {
				_ = os.MkdirAll(directory, 0o700)
				_ = os.WriteFile(filepath.Join(directory, "native-whitebox-snapshot.json"), []byte(result.Data.Text), 0o600)
			}
			t.Fatalf("isolated %s ref not found", label)
		}
		return ref
	}
	ref := findRef(snapshot(), "Whitebox input")
	if result := execute(desktopRequest{Action: "focus", Ref: ref}); !result.OK {
		t.Fatalf("native focus failed: %s", result.Code)
	}
	ref = findRef(snapshot(), "Whitebox input")
	if result := execute(desktopRequest{Action: "click", Ref: ref}); result.OK || result.Delivery != "not_delivered" {
		t.Fatal("a non-clickable input must fail without physical fallback")
	}
	button := findRef(snapshot(), "Whitebox button")
	if refreshed := engine.Permissions(ctx); refreshed.Accessibility != "granted" {
		t.Fatal("passive permission refresh lost the current Accessibility grant")
	}
	if result := execute(desktopRequest{Action: "click", Ref: button}); !result.OK {
		t.Fatalf("native button click failed: %s", result.Code)
	}
	clicked := snapshot()
	if !clicked.OK || clicked.Data == nil || !strings.Contains(clicked.Data.Text, "Whitebox clicked") {
		t.Fatal("native button click was not observed in the isolated window")
	}
	ref = findRef(clicked, "Whitebox input")
	result := execute(desktopRequest{Action: "type", Ref: ref, Text: "LinkSense whitebox input"})
	if !result.OK {
		t.Fatalf("native input failed: %s", result.Code)
	}
	observed := snapshot()
	if !observed.OK || observed.Data == nil || !strings.Contains(observed.Data.Text, "LinkSense whitebox input") {
		t.Fatal("native input was not observed in the same isolated window")
	}
	if result := execute(desktopRequest{
		Action: "key", App: "org.linksense.desktop", WindowID: windowID, Key: "ArrowLeft",
	}); !result.OK {
		t.Fatalf("native key failed: %s", result.Code)
	}
	image := execute(desktopRequest{Action: "screenshot", App: "org.linksense.desktop", WindowID: windowID})
	if !image.OK || image.Data == nil || image.Data.MimeType != "image/png" || image.Data.Image == "" {
		t.Fatalf("native screenshot failed: %s", image.Code)
	}
	startNativeScrollTarget(t, ctx)
	appID = "org.linksense.whitebox.scroll"
	windowID = findWindow(appID, "LinkSense Native Scroll Whitebox")
	scrollSnapshot := snapshot()
	if !scrollSnapshot.OK || scrollSnapshot.Data == nil || !strings.Contains(scrollSnapshot.Data.Text, "Whitebox scroll offset: 0") {
		t.Fatal("native scroll fixture did not start at its initial position")
	}
	scroll := findRef(scrollSnapshot, "Whitebox scroll")
	if result := execute(desktopRequest{Action: "scroll", Ref: scroll, Direction: "down", Amount: 3}); !result.OK {
		t.Fatalf("native scroll failed: %s", result.Code)
	}
	scrolled := snapshot()
	if !scrolled.OK || scrolled.Data == nil || !regexp.MustCompile(`Whitebox scroll offset: [1-9][0-9]*`).MatchString(scrolled.Data.Text) {
		t.Fatal("native scroll did not move the isolated document")
	}
	ref = findRef(scrolled, "Whitebox scroll")
	engine.Stop()
	if got := execute(desktopRequest{Action: "scroll", Ref: ref, Direction: "down", Amount: 3}); got.Code != "COMPUTER_USE_STALE_REF" {
		t.Fatal("stopped native host retained an actionable ref")
	}
	if approvals.Load() != 1 {
		t.Fatalf("sequential native actions lost their task grant: approvals=%d", approvals.Load())
	}
	if result := execute(desktopRequest{Action: "release"}); !result.OK {
		t.Fatalf("native release failed: %s", result.Code)
	}
	if result := execute(desktopRequest{Action: "apps"}); result.Code != "COMPUTER_USE_PAUSED" {
		t.Fatal("remote release allowed another native action")
	}
}

func startNativeScrollTarget(t *testing.T, ctx context.Context) {
	t.Helper()
	contents := filepath.Join(t.TempDir(), "Scroll Whitebox.app", "Contents")
	binary := filepath.Join(contents, "MacOS", "Scroll Whitebox")
	if err := os.MkdirAll(filepath.Dir(binary), 0o700); err != nil {
		t.Fatal(err)
	}
	plist := `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.linksense.whitebox.scroll</string><key>CFBundleExecutable</key><string>Scroll Whitebox</string></dict></plist>`
	if err := os.WriteFile(filepath.Join(contents, "Info.plist"), []byte(plist), 0o600); err != nil {
		t.Fatal(err)
	}
	compiler := exec.CommandContext(ctx, "swiftc", "testdata/scroll-whitebox.swift", "-o", binary)
	if output, err := compiler.CombinedOutput(); err != nil {
		t.Fatalf("compile isolated AppKit scroll target (requires Xcode Command Line Tools): %v\n%s", err, output)
	}
	target := exec.CommandContext(ctx, binary)
	if err := target.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = target.Process.Kill(); _ = target.Wait() })
}
