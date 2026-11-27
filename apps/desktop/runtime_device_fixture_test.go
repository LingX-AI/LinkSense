//go:build desktop_runtime_package

package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// Shared wire fixtures for the packaged device turn and its forced-quit
// variant. Scenario assertions stay in each test; framing, websocket
// authentication, model relay validation, and callback acknowledgement live
// here once.

type fixtureModelRequest struct {
	Tools []struct {
		Name string `json:"name"`
		Type string `json:"type"`
	} `json:"tools"`
	Input json.RawMessage `json:"input"`
}

// fixtureModelDirective is one synthetic model step: run a command, reject the
// request, or hold it while the scenario observes the native turn.
type fixtureModelDirective struct {
	command string
	hold    func(context.Context)
	reject  string
}

type fixtureModelScript func(call int, input string) fixtureModelDirective

// serveFixtureModel handles one scoped primary model request. The caller has
// already matched the turn path. fail records a rejected request and writes its
// status.
func serveFixtureModel(t *testing.T, w http.ResponseWriter, r *http.Request, modelToken, turnID string,
	calls *atomic.Int32, script fixtureModelScript, fail func(string, int)) {
	t.Helper()
	if r.Header.Get("Authorization") != "Bearer "+modelToken ||
		r.Header.Get("X-Linksense-Model-Purpose") != "primary" {
		fail("model relay did not use the scoped model credential", http.StatusForbidden)
		return
	}
	var request fixtureModelRequest
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 2*1024*1024)).Decode(&request) != nil {
		fail("invalid model fixture request", http.StatusBadRequest)
		return
	}
	call := int(calls.Add(1))
	directive := script(call, string(request.Input))
	if directive.reject != "" {
		fail(directive.reject, http.StatusBadRequest)
		return
	}
	if directive.hold != nil {
		directive.hold(r.Context())
		return
	}
	var item map[string]any
	for _, tool := range request.Tools {
		if tool.Name == "exec_command" && tool.Type == "function" {
			args, _ := json.Marshal(map[string]any{"cmd": directive.command, "yield_time_ms": 1000})
			item = map[string]any{"id": "fixture-tool-" + strconv.Itoa(call), "type": "function_call",
				"call_id": "fixture-call-" + strconv.Itoa(call), "name": tool.Name, "arguments": string(args), "status": "completed"}
			break
		}
	}
	if item == nil {
		fail("pinned Codex did not expose exec_command", http.StatusBadRequest)
		return
	}
	streamFixtureResponses(w, item)
}

// fixtureDeviceFrame is the shared device-channel response and callback shape.
type fixtureDeviceFrame struct {
	Type         string `json:"type"`
	ID           string `json:"id"`
	OK           bool   `json:"ok"`
	ErrorCode    string `json:"error_code"`
	Operation    string `json:"operation"`
	TurnID       string `json:"turn_id"`
	Conversation string `json:"conversation_id"`
	Generation   string `json:"runtime_generation"`
	RunToken     string `json:"run_token"`
	DrainID      string `json:"drain_id"`
	Raw          []byte `json:"-"`
	Result       struct {
		Code     string `json:"code"`
		Status   string `json:"status"`
		Drained  bool   `json:"drained"`
		Terminal struct {
			CodexThreadID string `json:"codexThreadId"`
			Turn          struct {
				ID     string `json:"id"`
				Status string `json:"status"`
			} `json:"turn"`
		} `json:"terminal"`
	} `json:"result"`
	Body struct {
		Events []struct {
			DeliveryID string `json:"deliveryId"`
			Event      struct {
				Method string `json:"method"`
				Params struct {
					Turn struct {
						Status string `json:"status"`
					} `json:"turn"`
				} `json:"params"`
			} `json:"event"`
		} `json:"events"`
	} `json:"body"`
}

// acknowledgement builds the device ack for an execution callback.
func (frame fixtureDeviceFrame) acknowledgement() map[string]any {
	ids := make([]string, 0, len(frame.Body.Events))
	for _, entry := range frame.Body.Events {
		ids = append(ids, entry.DeliveryID)
	}
	if frame.Operation == "start.settled" {
		return map[string]any{"settled": true}
	}
	return map[string]any{"accepted_delivery_ids": ids}
}

type fixtureDeviceSocket struct {
	conn   *websocket.Conn
	ctx    context.Context
	cancel context.CancelFunc
}

// acceptFixtureDeviceSocket performs the shared hello authentication and
// execution-ready handshake for one negotiated device connection.
func acceptFixtureDeviceSocket(t *testing.T, w http.ResponseWriter, r *http.Request,
	credential deviceCredential, connectionID string, timeout time.Duration) (*fixtureDeviceSocket, bool) {
	t.Helper()
	socket, err := websocket.Accept(w, r, nil)
	if err != nil {
		t.Error("could not upgrade fixture WebSocket")
		return nil, false
	}
	socket.SetReadLimit(desktopFrameLimit)
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	_, hello, err := socket.Read(ctx)
	if err != nil || !strings.Contains(string(hello), credential.Token) {
		cancel()
		_ = socket.CloseNow()
		t.Error("device did not authenticate")
		return nil, false
	}
	version := desktopExecutionVersion
	ready, _ := json.Marshal(deviceReady{
		Type: "ready", DeviceID: credential.DeviceID, ConnectionID: connectionID,
		ProtocolVersion: 1, HeartbeatIntervalMS: 15_000, ExecutionVersion: &version,
	})
	if socket.Write(ctx, websocket.MessageText, ready) != nil {
		cancel()
		_ = socket.CloseNow()
		t.Error("test device ready was not sent")
		return nil, false
	}
	return &fixtureDeviceSocket{conn: socket, ctx: ctx, cancel: cancel}, true
}

func (socket *fixtureDeviceSocket) send(value any) bool {
	raw, err := json.Marshal(value)
	if err != nil {
		return false
	}
	return socket.conn.Write(socket.ctx, websocket.MessageText, raw) == nil
}

// receive reads the next scenario frame, answering pings internally.
func (socket *fixtureDeviceSocket) receive() (fixtureDeviceFrame, bool) {
	for {
		_, raw, err := socket.conn.Read(socket.ctx)
		if err != nil {
			return fixtureDeviceFrame{}, false
		}
		var frame fixtureDeviceFrame
		if json.Unmarshal(raw, &frame) != nil {
			return fixtureDeviceFrame{}, false
		}
		frame.Raw = raw
		if frame.Type == "ping" {
			if !socket.send(map[string]string{"type": "pong"}) {
				return fixtureDeviceFrame{}, false
			}
			continue
		}
		return frame, true
	}
}

func (socket *fixtureDeviceSocket) done() <-chan struct{} {
	return socket.ctx.Done()
}

func (socket *fixtureDeviceSocket) close() {
	socket.cancel()
	_ = socket.conn.CloseNow()
}
