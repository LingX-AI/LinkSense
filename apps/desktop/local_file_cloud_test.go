package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestDeviceBridgeServesGrantedFileToolsOffTheReadLoop(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "visible.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := fileTestStore(t, root)
	result := make(chan map[string]any, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		socket, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer socket.CloseNow()
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		if _, _, err := socket.Read(ctx); err != nil {
			return
		}
		version := desktopCloudToolVersion
		ready, _ := json.Marshal(deviceReady{
			Type: "ready", DeviceID: "20000000-0000-4000-8000-000000000001",
			ConnectionID:    "30000000-0000-4000-8000-000000000001",
			ProtocolVersion: 1, HeartbeatIntervalMS: 15_000,
			CloudToolVersion: &version,
			CloudToolOperations: []string{
				desktopCloudToolPingOperation,
				desktopCloudToolListOperation,
				desktopCloudToolWriteOperation,
			},
		})
		if socket.Write(ctx, websocket.MessageText, ready) != nil {
			return
		}
		request, _ := json.Marshal(map[string]any{
			"type":       "cloud_tool.request",
			"id":         "50000000-0000-4000-8000-000000000010",
			"operation":  desktopCloudToolListOperation,
			"input":      map[string]any{"root_id": fileTestRoot, "path": "", "limit": 10},
			"expires_at": time.Now().Add(30 * time.Second).UTC().Format(time.RFC3339Nano),
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
			if json.Unmarshal(data, &frame) != nil {
				continue
			}
			if frame["type"] != "cloud_tool.result" {
				continue
			}
			result <- frame
			writeRequest, _ := json.Marshal(map[string]any{
				"type":      "cloud_tool.request",
				"id":        "50000000-0000-4000-8000-000000000011",
				"operation": desktopCloudToolWriteOperation,
				"input": map[string]any{
					"root_id": fileTestRoot, "path": "written.txt",
					"content": strings.Repeat("x", 20_000),
				},
				"expires_at": time.Now().Add(30 * time.Second).UTC().Format(time.RFC3339Nano),
			})
			if socket.Write(ctx, websocket.MessageText, writeRequest) != nil {
				return
			}
		}
	}))
	defer server.Close()
	origin, _ := url.Parse(server.URL)
	connection := newFixtureDeviceConnection(t, origin, deviceFixtureCredential())
	connection.files = store
	go connection.run()
	defer func() {
		connection.cancel()
		waitDeviceDone(t, connection)
	}()

	select {
	case frame := <-result:
		if frame["ok"] != true {
			t.Fatalf("file tool failed: %v", frame)
		}
		raw, err := json.Marshal(frame["data"])
		if err != nil {
			t.Fatal(err)
		}
		var list localFilesListResult
		if json.Unmarshal(raw, &list) != nil || len(list.Entries) != 1 ||
			list.Entries[0].Path != "visible.txt" {
			t.Fatalf("list = %s", raw)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the file tool result never arrived")
	}

	select {
	case frame := <-result:
		if frame["ok"] != true {
			t.Fatalf("large write failed: %v", frame)
		}
		data, err := os.ReadFile(filepath.Join(root, "written.txt"))
		if err != nil || len(data) != 20_000 {
			t.Fatalf("large write file = %d bytes, %v", len(data), err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the large write result never arrived")
	}
}
