package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/egoist/mygo/netproxy"
)

type DeviceConnectionState string

const (
	DeviceUnpaired   DeviceConnectionState = "unpaired"
	DeviceConnecting DeviceConnectionState = "connecting"
	DeviceOnline     DeviceConnectionState = "online"
	DeviceOffline    DeviceConnectionState = "offline"
	DeviceRevoked    DeviceConnectionState = "revoked"
)

type DeviceConnectionStatus struct {
	State     DeviceConnectionState `json:"state"`
	DeviceID  string                `json:"deviceId,omitempty"`
	Name      string                `json:"name,omitempty"`
	ErrorCode string                `json:"errorCode,omitempty"`
}

type deviceConnection struct {
	mu         sync.RWMutex
	server     *url.URL
	credential deviceCredential
	ctx        context.Context
	cancel     context.CancelFunc
	done       chan struct{}
	status     DeviceConnectionStatus
	runtime    *runtimeSupervisor
}

const (
	desktopExecutionVersion = 1
	desktopExecutionHeader  = "X-LinkSense-Desktop-Execution"
)

func newDeviceConnection(server *url.URL, credential deviceCredential) *deviceConnection {
	ctx, cancel := context.WithCancel(context.Background())
	return &deviceConnection{
		server: server, credential: credential, ctx: ctx, cancel: cancel, done: make(chan struct{}),
		status: DeviceConnectionStatus{State: DeviceConnecting, DeviceID: credential.DeviceID, Name: credential.Name},
	}
}

func (connection *deviceConnection) Status() DeviceConnectionStatus {
	connection.mu.RLock()
	defer connection.mu.RUnlock()
	return connection.status
}

func (connection *deviceConnection) setStatus(state DeviceConnectionState, code string) {
	connection.mu.Lock()
	connection.status.State, connection.status.ErrorCode = state, code
	connection.mu.Unlock()
}

func (connection *deviceConnection) run() {
	defer close(connection.done)
	for attempt := 0; attempt < 6; attempt++ {
		if connection.ctx.Err() != nil {
			connection.setStatus(DeviceOffline, "")
			return
		}
		connection.setStatus(DeviceConnecting, "")
		permanent, code := connection.runOnce()
		if connection.ctx.Err() != nil {
			connection.setStatus(DeviceOffline, "")
			return
		}
		if permanent {
			state := DeviceOffline
			if code == "AUTH_REQUIRED" {
				state = DeviceRevoked
			}
			connection.setStatus(state, code)
			return
		}
		connection.setStatus(DeviceOffline, code)
		if attempt == 5 {
			return
		}
		timer := time.NewTimer(time.Duration(1<<attempt) * 500 * time.Millisecond)
		select {
		case <-connection.ctx.Done():
			timer.Stop()
		case <-timer.C:
		}
	}
}

func (connection *deviceConnection) runOnce() (bool, string) {
	endpoint := *connection.server
	endpoint.Path = "/api/v1/desktop/devices/socket"
	if endpoint.Scheme == "https" {
		endpoint.Scheme = "wss"
	} else {
		endpoint.Scheme = "ws"
	}
	transport := netproxy.Transport().Clone()
	transport.ResponseHeaderTimeout, transport.TLSHandshakeTimeout = 10*time.Second, 10*time.Second
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport:     transport,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	dialContext, cancelDial := context.WithTimeout(connection.ctx, 10*time.Second)
	headers := make(http.Header)
	offerExecution := connection.runtime != nil && connection.runtime.ready.Load()
	if offerExecution {
		headers.Set(desktopExecutionHeader, strconv.Itoa(desktopExecutionVersion))
	}
	socket, _, err := websocket.Dial(dialContext, endpoint.String(), &websocket.DialOptions{
		HTTPClient: client, HTTPHeader: headers, CompressionMode: websocket.CompressionDisabled,
	})
	cancelDial()
	if err != nil {
		return false, "RUNNER_UNAVAILABLE"
	}
	defer socket.CloseNow()
	socket.SetReadLimit(8192)
	hello, _ := json.Marshal(struct {
		Type            string `json:"type"`
		Token           string `json:"token"`
		ProtocolVersion int    `json:"protocol_version"`
	}{"hello", connection.credential.Token, 1})
	writeContext, cancelWrite := context.WithTimeout(connection.ctx, 5*time.Second)
	err = socket.Write(writeContext, websocket.MessageText, hello)
	cancelWrite()
	if err != nil {
		return false, "RUNNER_UNAVAILABLE"
	}
	readContext, cancelRead := context.WithTimeout(connection.ctx, 5*time.Second)
	kind, data, err := socket.Read(readContext)
	cancelRead()
	if err != nil {
		return deviceSocketError(err)
	}
	ready, err := decodeDeviceReady(data)
	if kind != websocket.MessageText || err != nil || ready.DeviceID != connection.credential.DeviceID {
		return true, "DESKTOP_PROTOCOL_ERROR"
	}
	if ready.ExecutionVersion != nil && !offerExecution {
		return true, "DESKTOP_PROTOCOL_ERROR"
	}
	var link *runtimeLink
	if ready.ExecutionVersion != nil {
		link, err = connection.runtime.attach(ready.ConnectionID, connection.credential.OwnerID)
		if err != nil {
			return false, "RUNNER_UNAVAILABLE"
		}
		defer link.close()
		socket.SetReadLimit(desktopFrameLimit)
	}
	connection.setStatus(DeviceOnline, "")
	heartbeatContext, stopHeartbeat := context.WithCancel(connection.ctx)
	keepaliveDone := make(chan struct{})
	defer func() {
		stopHeartbeat()
		<-keepaliveDone
	}()
	go func() {
		defer close(keepaliveDone)
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		var frames <-chan json.RawMessage
		var runtimeDone <-chan struct{}
		if link != nil {
			frames, runtimeDone = link.frames, link.pipe.done
		}
		frame := []byte(`{"type":"ping"}`)
		for {
			ctx, cancel := context.WithTimeout(heartbeatContext, 5*time.Second)
			err := socket.Write(ctx, websocket.MessageText, frame)
			cancel()
			if err != nil {
				_ = socket.CloseNow()
				return
			}
			select {
			case <-heartbeatContext.Done():
				return
			case <-runtimeDone:
				_ = socket.CloseNow()
				return
			case frame = <-frames:
			case <-ticker.C:
				if !offerExecution && connection.runtime != nil && connection.runtime.ready.Load() {
					_ = socket.CloseNow()
					return
				}
				frame = []byte(`{"type":"ping"}`)
			}
		}
	}()
	for {
		ctx, cancel := context.WithTimeout(connection.ctx, 45*time.Second)
		kind, data, err = socket.Read(ctx)
		cancel()
		if err != nil {
			return deviceSocketError(err)
		}
		if kind != websocket.MessageText {
			return true, "DESKTOP_PROTOCOL_ERROR"
		}
		if decodeDevicePong(data) {
			continue
		}
		if link == nil || !isDesktopExecutionInput(data) {
			return true, "DESKTOP_PROTOCOL_ERROR"
		}
		if err := link.send(data); err != nil {
			return false, "RUNNER_UNAVAILABLE"
		}
	}
}

func isDesktopExecutionInput(data []byte) bool {
	var frame struct {
		Type string `json:"type"`
	}
	if json.Unmarshal(data, &frame) != nil {
		return false
	}
	return frame.Type == "command" || frame.Type == "command.cancel" || frame.Type == "execution.ack"
}

type deviceReady struct {
	Type                string `json:"type"`
	DeviceID            string `json:"device_id"`
	ConnectionID        string `json:"connection_id"`
	ProtocolVersion     int    `json:"protocol_version"`
	HeartbeatIntervalMS int    `json:"heartbeat_interval_ms"`
	ExecutionVersion    *int   `json:"execution_protocol_version,omitempty"`
}

func decodeDeviceReady(data []byte) (deviceReady, error) {
	if !json.Valid(data) {
		return deviceReady{}, errors.New("DESKTOP_PROTOCOL_ERROR")
	}
	var ready deviceReady
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&ready); err != nil || ready.Type != "ready" ||
		!validUUID(ready.DeviceID) || !validUUID(ready.ConnectionID) ||
		ready.ProtocolVersion != 1 || ready.HeartbeatIntervalMS != 15_000 ||
		(ready.ExecutionVersion != nil && *ready.ExecutionVersion != desktopExecutionVersion) {
		return deviceReady{}, errors.New("DESKTOP_PROTOCOL_ERROR")
	}
	return ready, nil
}

func decodeDevicePong(data []byte) bool {
	if !json.Valid(data) {
		return false
	}
	var pong struct {
		Type string `json:"type"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	return decoder.Decode(&pong) == nil && pong.Type == "pong"
}

func deviceSocketError(err error) (bool, string) {
	switch websocket.CloseStatus(err) {
	case 4401, 4403:
		return true, "AUTH_REQUIRED"
	case 4400:
		return true, "DESKTOP_PROTOCOL_ERROR"
	case 4409:
		return true, "DESKTOP_CONNECTION_REPLACED"
	default:
		return false, "RUNNER_UNAVAILABLE"
	}
}
