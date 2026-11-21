package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/egoist/mygo"
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

func TestDeviceBridgeReportsPackagedAppVersionOnReconnect(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("the desktop app version header is macOS-only")
	}
	credential := deviceFixtureCredential()
	observed := make(chan string, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		socket, err := websocket.Accept(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer socket.CloseNow()
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		// An older API reads hello with its strict decoder and ignores the
		// optional app version header.
		_, data, err := socket.Read(ctx)
		var hello struct {
			Type            string `json:"type"`
			Token           string `json:"token"`
			ProtocolVersion int    `json:"protocol_version"`
		}
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.DisallowUnknownFields()
		if err != nil || decoder.Decode(&hello) != nil || hello.Type != "hello" ||
			hello.Token != credential.Token || hello.ProtocolVersion != 1 {
			t.Error("the optional app version header changed the strict hello contract")
			return
		}
		if err := sendDeviceReady(ctx, socket, credential.DeviceID); err != nil {
			return
		}
		_, data, err = socket.Read(ctx)
		if err != nil || string(data) != `{"type":"ping"}` {
			t.Error("the optional app version header broke the device heartbeat")
			return
		}
		_ = socket.Write(ctx, websocket.MessageText, []byte(`{"type":"pong"}`))
		observed <- r.Header.Get(desktopAppVersionHeader)
		_, _, _ = socket.Read(ctx)
	}))
	defer server.Close()
	origin, _ := url.Parse(server.URL)
	originalVersion := mygo.App.Version()
	defer mygo.App.SetVersion(originalVersion)
	for _, test := range []struct{ name, version, want string }{
		{"fresh packaged app", "1.27.3", "1.27.3"},
		{"app upgraded", "1.27.4", "1.27.4"},
		{"app rolled back", "1.27.2", "1.27.2"},
		{"longest accepted version", strings.Repeat("1", 40), strings.Repeat("1", 40)},
		{"unpackaged development build", "", ""},
		{"invalid characters", "1.27.3 beta", ""},
		{"over 40 characters", strings.Repeat("1", 41), ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			mygo.App.SetVersion(test.version)
			connection := newDeviceConnection(origin, credential)
			go connection.run()
			defer connection.cancel()
			select {
			case got := <-observed:
				if got != test.want {
					t.Fatalf("server observed app version header %q, want %q", got, test.want)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("device connection did not authenticate")
			}
			connection.cancel()
			waitDeviceDone(t, connection)
		})
	}
}
