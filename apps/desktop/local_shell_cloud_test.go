package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// The device lane carries the shell operation next to the file tools. A
// bypass conversation runs without a page; a Manual conversation stays failed
// closed when the socket goes away mid-approval.
func TestDeviceBridgeRunsShellAndFailsClosedWhenTheLaneGoesAway(t *testing.T) {
	for _, run := range []struct {
		name    string
		mode    string
		command string
		offline bool
		allow   bool
	}{
		{name: "bypass", mode: permissionModeBypass, command: "printf hello"},
		{name: "manual-allowed", mode: permissionModeManual, command: "printf hello", allow: true},
		{name: "manual-offline", mode: permissionModeManual, command: "touch marker", offline: true},
	} {
		t.Run(run.name, func(t *testing.T) {
			root := t.TempDir()
			store := fileTestStore(t, root)
			store.state.PermissionModes[fileTestOwner][fileTestConversation] = run.mode
			center := newCloudApprovalCenter()
			prompted := make(chan cloudApprovalRequest, 1)
			center.setEmitter(func(view cloudApprovalRequest) error {
				prompted <- view
				if run.allow {
					go func() { _ = center.answer(view.ID, cloudApprovalAllow) }()
				}
				return nil
			}, nil)
			result := make(chan map[string]any, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				socket, err := websocket.Accept(w, r, nil)
				if err != nil {
					return
				}
				defer socket.CloseNow()
				ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
				defer cancel()
				if _, _, err := socket.Read(ctx); err != nil {
					return
				}
				version := desktopCloudToolVersion
				ready, _ := json.Marshal(deviceReady{
					Type: "ready", DeviceID: deviceFixtureCredential().DeviceID,
					ConnectionID:    "30000000-0000-4000-8000-000000000001",
					ProtocolVersion: 1, HeartbeatIntervalMS: 15_000,
					CloudToolVersion:    &version,
					CloudToolOperations: []string{desktopCloudToolShellOperation},
				})
				if socket.Write(ctx, websocket.MessageText, ready) != nil {
					return
				}
				request, _ := json.Marshal(map[string]any{
					"type":            "cloud_tool.request",
					"id":              "50000000-0000-4000-8000-000000000020",
					"conversation_id": fileTestConversation,
					"operation":       desktopCloudToolShellOperation,
					"input": map[string]any{
						"root_id": fileTestRoot, "command": run.command, "timeout_ms": 10_000,
					},
					"expires_at": time.Now().Add(170 * time.Second).UTC().Format(time.RFC3339Nano),
				})
				if socket.Write(ctx, websocket.MessageText, request) != nil {
					return
				}
				for {
					_, data, err := socket.Read(ctx)
					if err != nil {
						return
					}
					var frame map[string]any
					if json.Unmarshal(data, &frame) != nil || frame["type"] != "cloud_tool.result" {
						continue
					}
					result <- frame
				}
			}))
			defer server.Close()
			origin, _ := url.Parse(server.URL)
			connection := newFixtureDeviceConnection(t, origin, deviceFixtureCredential())
			connection.files = store
			connection.approvals = center
			go connection.run()
			defer func() {
				connection.cancel()
				waitDeviceDone(t, connection)
			}()

			if run.offline {
				select {
				case view := <-prompted:
					if view.Command != run.command || view.RootName != "root" {
						t.Fatalf("approval view = %+v", view)
					}
				case <-time.After(10 * time.Second):
					t.Fatal("the shell approval never arrived")
				}
				connection.cancel()
				waitDeviceDone(t, connection)
				select {
				case frame := <-result:
					t.Fatalf("an offline approval produced a result: %v", frame)
				case <-time.After(300 * time.Millisecond):
				}
				if _, err := os.Stat(filepath.Join(root, "marker")); !os.IsNotExist(err) {
					t.Fatal("an offline approval must not run the command")
				}
				return
			}

			select {
			case frame := <-result:
				if frame["ok"] != true {
					t.Fatalf("shell result failed: %v", frame)
				}
				raw, _ := json.Marshal(frame["data"])
				var shell localShellExecResult
				if json.Unmarshal(raw, &shell) != nil || shell.Stdout != "hello" ||
					shell.ExitCode == nil || *shell.ExitCode != 0 {
					t.Fatalf("shell data = %s", raw)
				}
			case <-time.After(10 * time.Second):
				t.Fatal("the shell result never arrived")
			}
		})
	}
}
