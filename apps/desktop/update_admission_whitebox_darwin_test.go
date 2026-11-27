//go:build darwin && desktop_update_admission

package main

// Whitebox of the P1-22 application-update admission gate against the real
// packaged desktop runner, with the sibling gate's runtime.go,
// runtime_update.go, workspace.go and its shared/runner protocol changes
// overlaid (they are not part of this file's patch):
//
//	go test -tags desktop_runtime_package,desktop_update_admission -run 'TestPackaged(UpdateAdmissionGate|DesktopDeviceTurn)$' -count=1 -timeout=180s ./...
//
// Requires LINKSENSE_DESKTOP_RUNTIME_DIST to select a prepared runtime. The
// device-turn test calls probeUpdateAdmissionDuringTurn, which proves that a
// real local Codex turn refuses admission; this test holds the acknowledged
// gate across a real private-pipe link and proves a turn.start is refused
// with RUNNER_UNAVAILABLE, then releases and acquires again.

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPackagedUpdateAdmissionGate(t *testing.T) {
	runtimeRoot := os.Getenv("LINKSENSE_DESKTOP_RUNTIME_DIST")
	if !filepath.IsAbs(runtimeRoot) {
		t.Fatal("LINKSENSE_DESKTOP_RUNTIME_DIST must select a packaged runtime")
	}
	origin, err := url.Parse("http://127.0.0.1:1")
	if err != nil {
		t.Fatal(err)
	}
	runtime := superviseRuntime(filepath.Join(t.TempDir(), "local-runtime"), runtimeRoot, origin.String())
	t.Cleanup(runtime.close)
	readiness := time.Now().Add(30 * time.Second)
	for !runtime.ready.Load() && time.Now().Before(readiness) {
		select {
		case <-runtime.done:
			t.Fatal("packaged runtime did not start")
		case <-time.After(50 * time.Millisecond):
		}
	}
	if !runtime.ready.Load() {
		t.Fatal("packaged runtime readiness timed out")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	guard, err := runtime.acquireUpdateAdmission(ctx)
	if err != nil || guard == nil {
		t.Fatalf("acquiring update admission: guard=%v err=%v", guard, err)
	}
	t.Cleanup(guard.release)
	if second, err := runtime.acquireUpdateAdmission(ctx); !errors.Is(err, errUpdateAdmissionBusy) || second != nil {
		t.Fatalf("a second admission while the gate is held returned guard=%v err=%v", second, err)
	}

	const (
		linkID         = "70000000-0000-4000-8000-000000000011"
		ownerID        = "40000000-0000-4000-8000-000000000011"
		conversationID = "40000000-0000-4000-8000-000000000012"
		generation     = "50000000-0000-4000-8000-000000000011"
		turnID         = "60000000-0000-4000-8000-000000000011"
		startID        = "80000000-0000-4000-8000-000000000011"
	)
	link, err := runtime.attach(linkID, ownerID, nil, nil, nil, nil, nil)
	if err != nil {
		t.Fatalf("attaching the private link: %v", err)
	}
	defer link.close()
	start, err := json.Marshal(map[string]any{
		"type": "command", "operation": "turn.start", "id": startID, "owner_id": ownerID,
		"conversation_id": conversationID, "runtime_generation": generation, "turn_id": turnID,
		"expires_at": time.Now().Add(45 * time.Second).UTC().Format(time.RFC3339Nano),
		"body": map[string]any{
			"native_thread_id": nil, "input": "update admission fixture", "reasoning_effort": "low",
			"credentials": map[string]any{
				"turn_id": turnID, "run_token": "lsdr_" + strings.Repeat("b", 43),
				"expires_at": time.Now().Add(2 * time.Minute).UTC().Format(time.RFC3339Nano),
				"primary": map[string]any{"purpose": "primary", "model": "gpt-5.4", "revision": 1,
					"protocol_mode": "native_responses", "token": "lsdm_" + strings.Repeat("a", 43)},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := link.send(start); err != nil {
		t.Fatalf("sending turn.start over the held link: %v", err)
	}
	deadline := time.After(15 * time.Second)
	for {
		select {
		case <-runtime.done:
			t.Fatal("the packaged runtime stopped while the update gate was held")
		case frame := <-link.frames:
			var result struct {
				Type      string `json:"type"`
				ID        string `json:"id"`
				Operation string `json:"operation"`
				OK        bool   `json:"ok"`
				ErrorCode string `json:"error_code"`
			}
			if json.Unmarshal(frame, &result) != nil {
				t.Fatalf("malformed runner frame: %s", frame)
			}
			if result.Type != "command.result" || result.ID != startID || result.Operation != "turn.start" {
				continue // an unrelated correct frame is not admission
			}
			if result.OK || result.ErrorCode != "RUNNER_UNAVAILABLE" {
				t.Fatalf("a turn.start was admitted while the update gate was held: %+v", result)
			}
			t.Logf("turn.start while the update gate was held: ok=%v error_code=%s", result.OK, result.ErrorCode)
			break
		case <-deadline:
			t.Fatal("the runner did not answer turn.start while the update gate was held")
		}
		break
	}
	// Nothing may have started: no callback, no second result.
	select {
	case frame := <-link.frames:
		t.Fatalf("the refused start produced a frame: %s", frame)
	case <-time.After(500 * time.Millisecond):
	}

	guard.release()
	resumed, err := runtime.acquireUpdateAdmission(ctx)
	if err != nil || resumed == nil {
		t.Fatalf("admission after release: guard=%v err=%v", resumed, err)
	}
	t.Logf("update admission was reacquired after release")
	resumed.release()
	if !runtime.ready.Load() {
		t.Fatal("the packaged runtime did not survive the admission sequence")
	}
}
