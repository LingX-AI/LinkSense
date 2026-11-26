package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/coder/websocket"
)

type fixtureCloudComputer struct {
	operation string
}

func (f *fixtureCloudComputer) handle(
	_ context.Context, _ string, _ string, _ string, operation string, _ json.RawMessage,
) (any, string) {
	f.operation = operation
	return map[string]any{
		"state": "idle", "available": true,
		"permissions": map[string]any{"accessibility": "granted"},
	}, ""
}

func (f *fixtureCloudComputer) control(context.Context, *Desktop, string, string, string) (CloudComputerControlStatus, error) {
	return CloudComputerControlStatus{State: computerControlStateIdle}, nil
}

func (f *fixtureCloudComputer) emergencyPause() {}
func (f *fixtureCloudComputer) emergencyStop()  {}

func TestDeviceBridgeServesCloudComputerTools(t *testing.T) {
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
				cloudComputerStatusOperation, cloudComputerSelectOperation,
			},
		})
		if socket.Write(ctx, websocket.MessageText, ready) != nil {
			return
		}
		request, _ := json.Marshal(map[string]any{
			"type":       "cloud_tool.request",
			"id":         "50000000-0000-4000-8000-000000000020",
			"operation":  cloudComputerStatusOperation,
			"input":      map[string]any{},
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
			if json.Unmarshal(data, &frame) == nil && frame["type"] == "cloud_tool.result" {
				result <- frame
				return
			}
		}
	}))
	defer server.Close()
	origin, _ := url.Parse(server.URL)
	connection := newFixtureDeviceConnection(t, origin, deviceFixtureCredential())
	host := &fixtureCloudComputer{}
	connection.cloudComputer = host
	go connection.run()
	defer func() {
		connection.cancel()
		waitDeviceDone(t, connection)
	}()

	select {
	case frame := <-result:
		if frame["ok"] != true || host.operation != cloudComputerStatusOperation {
			t.Fatalf("computer result = %v operation=%q", frame, host.operation)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the cloud computer result never arrived")
	}
}
