package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func deviceFixtureCredential() deviceCredential {
	return deviceCredential{
		Token:    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		OwnerID:  "10000000-0000-4000-8000-000000000001",
		DeviceID: "20000000-0000-4000-8000-000000000001", Name: "Work laptop",
	}
}

func sendDeviceReady(ctx context.Context, socket *websocket.Conn, deviceID string) error {
	data, _ := json.Marshal(deviceReady{
		Type: "ready", DeviceID: deviceID,
		ConnectionID:    "30000000-0000-4000-8000-000000000001",
		ProtocolVersion: 1, HeartbeatIntervalMS: 15_000,
	})
	return socket.Write(ctx, websocket.MessageText, data)
}

func waitDeviceDone(t *testing.T, connection *deviceConnection) {
	t.Helper()
	select {
	case <-connection.done:
	case <-time.After(5 * time.Second):
		t.Fatal("device connection did not stop")
	}
}

func TestDeviceBridgeAuthenticatesHeartbeatsAndStopsWithItsContext(t *testing.T) {
	credential := deviceFixtureCredential()
	ping := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") != "" || r.URL.RawQuery != "" {
			t.Error("native credentials must not use browser origins or query strings")
			return
		}
		socket, err := websocket.Accept(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer socket.CloseNow()
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		_, data, err := socket.Read(ctx)
		var hello struct {
			Type            string `json:"type"`
			Token           string `json:"token"`
			ProtocolVersion int    `json:"protocol_version"`
		}
		if err != nil || json.Unmarshal(data, &hello) != nil ||
			hello.Type != "hello" || hello.Token != credential.Token || hello.ProtocolVersion != 1 {
			t.Error("native device authentication did not match the strict contract")
			return
		}
		if err := sendDeviceReady(ctx, socket, credential.DeviceID); err != nil {
			return
		}
		_, data, err = socket.Read(ctx)
		if err != nil || string(data) != `{"type":"ping"}` {
			t.Error("native device did not send its initial heartbeat")
			return
		}
		if err := socket.Write(ctx, websocket.MessageText, []byte(`{"type":"pong"}`)); err != nil {
			return
		}
		ping <- struct{}{}
		_, _, _ = socket.Read(ctx)
	}))
	defer server.Close()
	origin, _ := url.Parse(server.URL)
	connection := newDeviceConnection(origin, credential)
	go connection.run()
	defer connection.cancel()
	select {
	case <-ping:
	case <-time.After(5 * time.Second):
		t.Fatal("device heartbeat did not reach the API")
	}
	if connection.Status().State != DeviceOnline {
		t.Fatal("authenticated device was not online")
	}
	connection.cancel()
	waitDeviceDone(t, connection)
	if connection.Status().State != DeviceOffline {
		t.Fatal("a stopped native device remained online")
	}
}

func TestDeviceBridgeRejectsUnexpectedExecutionFramesWithoutRetrying(t *testing.T) {
	var attempts atomic.Int32
	credential := deviceFixtureCredential()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		socket, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer socket.CloseNow()
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		if _, _, err := socket.Read(ctx); err != nil {
			return
		}
		if err := sendDeviceReady(ctx, socket, credential.DeviceID); err != nil {
			return
		}
		_ = socket.Write(ctx, websocket.MessageText, []byte(`{"type":"execute","command":"echo fixture"}`))
		_, _, _ = socket.Read(ctx)
	}))
	defer server.Close()
	origin, _ := url.Parse(server.URL)
	connection := newDeviceConnection(origin, credential)
	go connection.run()
	defer connection.cancel()
	waitDeviceDone(t, connection)
	if connection.Status().ErrorCode != "DESKTOP_PROTOCOL_ERROR" || attempts.Load() != 1 {
		t.Fatal("an unexpected execution frame was accepted or replayed")
	}
}

func TestDeviceBridgeDistinguishesReplacementFromCredentialRevocation(t *testing.T) {
	credential := deviceFixtureCredential()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		socket, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer socket.CloseNow()
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		if _, _, err := socket.Read(ctx); err == nil {
			_ = socket.Close(websocket.StatusCode(4409), "")
		}
	}))
	defer server.Close()
	origin, _ := url.Parse(server.URL)
	connection := newDeviceConnection(origin, credential)
	go connection.run()
	defer connection.cancel()
	waitDeviceDone(t, connection)
	if connection.Status().State != DeviceOffline || connection.Status().ErrorCode != "DESKTOP_CONNECTION_REPLACED" {
		t.Fatal("replacing a socket was reported as revoking its device credential")
	}
}

func TestDeviceFramesRejectUnknownFieldsAndTrailingDocuments(t *testing.T) {
	credential := deviceFixtureCredential()
	data, _ := json.Marshal(deviceReady{
		Type: "ready", DeviceID: credential.DeviceID,
		ConnectionID: "30000000-0000-4000-8000-000000000001", ProtocolVersion: 1, HeartbeatIntervalMS: 15_000,
	})
	if _, err := decodeDeviceReady(data); err != nil {
		t.Fatal(err)
	}
	if _, err := decodeDeviceReady(append(data, []byte(`{}`)...)); err == nil {
		t.Fatal("accepted multiple documents in one device frame")
	}
	for _, data := range []string{`{"type":"pong","owner_id":"other"}`, `{"type":"pong"}{}`, `{"type":"execute"}`} {
		if decodeDevicePong([]byte(data)) {
			t.Fatal("accepted an unexpected device frame")
		}
	}
}
