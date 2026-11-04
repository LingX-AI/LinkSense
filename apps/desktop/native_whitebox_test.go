package main

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestInstalledEngineAgainstIsolatedNativeWindow(t *testing.T) {
	if os.Getenv("LINKSENSE_DESKTOP_NATIVE_WHITEBOX") != "1" {
		return
	}
	executable := os.Getenv("LINKSENSE_DESKTOP_APP_BIN")
	binary := os.Getenv("LINKSENSE_AGENT_DESKTOP_BIN")
	if executable == "" || binary == "" {
		t.Fatal("native whitebox requires explicit packaged client and engine paths")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
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
	var windowID string
	for attempt := 0; attempt < 35; attempt++ {
		result := engine.Execute(ctx, desktopRequest{Action: "windows", App: "org.linksense.desktop"}, "native-whitebox")
		if result.OK && result.Data != nil {
			var windows []struct {
				ID    json.RawMessage `json:"id"`
				Title string          `json:"title"`
			}
			if json.Unmarshal([]byte(result.Data.Text), &windows) != nil {
				t.Fatal("invalid window response")
			}
			for _, window := range windows {
				if window.Title == "LinkSense Computer Use Whitebox" {
					var id string
					if json.Unmarshal(window.ID, &id) == nil {
						windowID = id
					} else {
						windowID = string(window.ID)
					}
				}
			}
		}
		if windowID != "" {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("isolated native window unavailable")
		case <-time.After(150 * time.Millisecond):
		}
	}
	if windowID == "" {
		t.Fatal("cannot locate only the isolated whitebox window; no other window was touched")
	}
	snapshot := func() toolResult {
		return engine.Execute(ctx, desktopRequest{Action: "snapshot", App: "org.linksense.desktop", WindowID: windowID}, "native-whitebox")
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
	if result := engine.Execute(ctx, desktopRequest{Action: "focus", Ref: ref}, "native-whitebox"); !result.OK {
		t.Fatalf("native focus failed: %s", result.Code)
	}
	ref = findRef(snapshot(), "Whitebox input")
	if result := engine.Execute(ctx, desktopRequest{Action: "click", Ref: ref}, "native-whitebox"); result.OK || result.Delivery != "not_delivered" {
		t.Fatal("a non-clickable input must fail without physical fallback")
	}
	button := findRef(snapshot(), "Whitebox button")
	if refreshed := engine.Permissions(ctx); refreshed.Accessibility != "granted" {
		t.Fatal("passive permission refresh lost the current Accessibility grant")
	}
	if result := engine.Execute(ctx, desktopRequest{Action: "click", Ref: button}, "native-whitebox"); !result.OK {
		t.Fatalf("native button click failed: %s", result.Code)
	}
	clicked := snapshot()
	if !clicked.OK || clicked.Data == nil || !strings.Contains(clicked.Data.Text, "Whitebox clicked") {
		t.Fatal("native button click was not observed in the isolated window")
	}
	ref = findRef(clicked, "Whitebox input")
	result := engine.Execute(ctx, desktopRequest{Action: "type", Ref: ref, Text: "LinkSense whitebox input"}, "native-whitebox")
	if !result.OK {
		t.Fatalf("native input failed: %s", result.Code)
	}
	observed := snapshot()
	if !observed.OK || observed.Data == nil || !strings.Contains(observed.Data.Text, "LinkSense whitebox input") {
		t.Fatal("native input was not observed in the same isolated window")
	}
	if result := engine.Execute(ctx, desktopRequest{
		Action: "key", App: "org.linksense.desktop", WindowID: windowID, Key: "ArrowLeft",
	}, "native-whitebox"); !result.OK {
		t.Fatalf("native key failed: %s", result.Code)
	}
	if permissions.ScreenRecording == "granted" {
		image := engine.Execute(ctx, desktopRequest{Action: "screenshot", App: "org.linksense.desktop", WindowID: windowID}, "native-whitebox")
		if !image.OK || image.Data == nil || image.Data.MimeType != "image/png" || image.Data.Image == "" {
			t.Fatalf("native screenshot failed: %s", image.Code)
		}
	}
	engine.Stop()
	if got := engine.Execute(ctx, desktopRequest{Action: "click", Ref: ref}, "native-whitebox"); got.Code != "COMPUTER_USE_STALE_REF" {
		t.Fatal("stopped native host retained an actionable ref")
	}
}
