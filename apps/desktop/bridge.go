package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"runtime"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/websocket"
)

type pairedDevice struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Platform string `json:"platform"`
}
type deviceCredentials struct {
	Server string       `json:"server"`
	Token  string       `json:"token"`
	Device pairedDevice `json:"device"`
}
type desktopCommand struct {
	Type           string          `json:"type"`
	ID             string          `json:"id"`
	ConnectionID   string          `json:"connection_id"`
	DeviceID       string          `json:"device_id"`
	ConversationID string          `json:"conversation_id"`
	TurnID         string          `json:"turn_id"`
	Title          string          `json:"title"`
	ExpiresAt      int64           `json:"expires_at"`
	ReadOnly       *bool           `json:"read_only"`
	Request        json.RawMessage `json:"request"`
}
type bridgeStatus struct {
	Generation  uint64
	Connected   bool
	Control     string
	Permissions permissionState
	Error       string
}
type taskGrant struct {
	contextID string
	readOnly  bool
	expiresAt time.Time
}

type desktopBridge struct {
	engine       commandEngine
	lifecycle    sync.Mutex
	permission   sync.Mutex
	onStatus     func(bridgeStatus)
	onPermission func(permissionState)
	onApprove    func(context.Context, desktopCommand, func(bool))
	mu           sync.Mutex
	sendMu       sync.Mutex
	conn         *websocket.Conn
	cancel       context.CancelFunc
	active       context.CancelFunc
	activeID     string
	awaiting     bool
	connectionID string
	generation   uint64
	paused       bool
	grant        taskGrant
	permissions  permissionState
}

func decodeStrict(data []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return errors.New("unexpected trailing JSON")
	}
	return nil
}

func pairDevice(ctx context.Context, server, code, name string) (deviceCredentials, error) {
	origin, err := workspaceURL(server)
	if err != nil || len(code) < 32 || len(code) > 100 || len(name) == 0 || len(name) > 100 {
		return deviceCredentials{}, errors.New("invalid pairing input")
	}
	platform := runtime.GOOS
	if platform == "windows" {
		platform = "win32"
	}
	data, err := json.Marshal(map[string]string{"code": code, "name": name, "platform": platform})
	if err != nil {
		return deviceCredentials{}, err
	}
	endpoint, err := url.JoinPath(origin, "api/v1/computer-use/pair")
	if err != nil {
		return deviceCredentials{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return deviceCredentials{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	client := &http.Client{
		Timeout:       12 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	response, err := client.Do(request)
	if err != nil {
		return deviceCredentials{}, errors.New("pairing connection failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return deviceCredentials{}, errors.New("pairing was rejected")
	}
	data, err = io.ReadAll(io.LimitReader(response.Body, 4_097))
	if err != nil || len(data) > 4_096 {
		return deviceCredentials{}, errors.New("invalid pairing response")
	}
	var result struct {
		Token  string       `json:"token"`
		Device pairedDevice `json:"device"`
	}
	if err := decodeStrict(data, &result); err != nil || len(result.Token) < 32 ||
		len(result.Token) > 100 || !uuidPattern.MatchString(result.Device.ID) ||
		len(result.Device.Name) == 0 || len(result.Device.Name) > 100 || result.Device.Platform != platform {
		return deviceCredentials{}, errors.New("invalid device credential")
	}
	return deviceCredentials{Server: origin, Token: result.Token, Device: result.Device}, nil
}

func (b *desktopBridge) Generation() uint64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.generation
}

func (b *desktopBridge) emit(generation uint64, code string) {
	b.mu.Lock()
	if b.generation != generation {
		b.mu.Unlock()
		return
	}
	control := "ready"
	if b.paused {
		control = "paused"
	} else if b.awaiting {
		control = "pending"
	} else if b.activeID != "" {
		control = "running"
	}
	status := bridgeStatus{
		Generation: generation, Connected: b.connectionID != "",
		Control: control, Permissions: b.permissions, Error: code,
	}
	b.mu.Unlock()
	if b.onStatus != nil {
		b.onStatus(status)
	}
}

func (b *desktopBridge) send(conn *websocket.Conn, value any) error {
	b.sendMu.Lock()
	defer b.sendMu.Unlock()
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return websocket.JSON.Send(conn, value)
}

func (b *desktopBridge) closeConnection(generation uint64, code string) {
	b.lifecycle.Lock()
	defer b.lifecycle.Unlock()
	b.mu.Lock()
	if b.generation != generation {
		b.mu.Unlock()
		return
	}
	b.generation++
	generation = b.generation
	conn, cancel, active := b.conn, b.cancel, b.active
	b.conn, b.cancel, b.active = nil, nil, nil
	b.activeID, b.connectionID, b.grant, b.awaiting = "", "", taskGrant{}, false
	b.paused = true
	b.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if active != nil {
		active()
	}
	if conn != nil {
		_ = conn.Close()
	}
	b.engine.Stop()
	b.emit(generation, code)
}

func (b *desktopBridge) Disconnect() {
	b.closeConnection(b.Generation(), "")
}

func (b *desktopBridge) Pause() {
	b.mu.Lock()
	conn, generation := b.conn, b.generation
	b.mu.Unlock()
	b.pauseConnection(generation, conn)
}

func (b *desktopBridge) pauseConnection(generation uint64, conn *websocket.Conn) {
	b.lifecycle.Lock()
	b.mu.Lock()
	if b.generation != generation || b.conn != conn {
		b.mu.Unlock()
		b.lifecycle.Unlock()
		return
	}
	b.paused, b.grant = true, taskGrant{}
	cancel := b.active
	connecting := b.connectionID == ""
	b.mu.Unlock()
	if connecting {
		b.lifecycle.Unlock()
		b.closeConnection(generation, "")
		return
	}
	if cancel != nil {
		cancel()
	}
	b.engine.Stop()
	b.lifecycle.Unlock()
	if conn != nil {
		_ = b.send(conn, map[string]string{"type": "pause"})
	}
	b.emit(generation, "")
}

func (b *desktopBridge) cancelCommand(generation uint64, conn *websocket.Conn, id string) {
	b.lifecycle.Lock()
	defer b.lifecycle.Unlock()
	b.mu.Lock()
	active := b.active
	matches := b.generation == generation && b.conn == conn && b.activeID == id
	if matches {
		b.grant = taskGrant{}
	}
	b.mu.Unlock()
	if matches && active != nil {
		active()
		b.engine.Stop()
	}
}

func (b *desktopBridge) Resume() {
	b.mu.Lock()
	b.paused, b.grant = false, taskGrant{}
	conn, generation := b.conn, b.generation
	b.mu.Unlock()
	if conn != nil {
		_ = b.send(conn, map[string]string{"type": "resume"})
	}
	b.emit(generation, "")
}

func (b *desktopBridge) CheckPermissions(ctx context.Context) {
	if !b.permission.TryLock() {
		return
	}
	defer b.permission.Unlock()
	b.mu.Lock()
	busy := b.activeID != ""
	b.mu.Unlock()
	if busy {
		return
	}
	permissions := b.engine.Permissions(ctx)
	b.mu.Lock()
	b.permissions = permissions
	callback := b.onPermission
	b.mu.Unlock()
	if callback != nil {
		callback(permissions)
	}
}

func (b *desktopBridge) Connect(ctx context.Context, credential deviceCredentials) error {
	origin, err := workspaceURL(credential.Server)
	if err != nil || !uuidPattern.MatchString(credential.Device.ID) ||
		len(credential.Token) < 32 || len(credential.Token) > 100 {
		return errors.New("invalid device credential")
	}
	b.Disconnect()
	b.mu.Lock()
	b.generation++
	generation := b.generation
	b.mu.Unlock()
	u, err := url.Parse(origin)
	if err != nil {
		return err
	}
	u.Path = "/api/v1/computer-use/socket"
	if u.Scheme == "https" {
		u.Scheme = "wss"
	} else {
		u.Scheme = "ws"
	}
	config, err := websocket.NewConfig(u.String(), origin)
	if err != nil {
		return err
	}
	dial, cancelDial := context.WithTimeout(ctx, 10*time.Second)
	defer cancelDial()
	b.mu.Lock()
	if b.generation != generation {
		b.mu.Unlock()
		return context.Canceled
	}
	b.cancel = cancelDial
	b.mu.Unlock()
	conn, err := config.DialContext(dial)
	if err != nil {
		return errors.New("desktop connection failed")
	}
	conn.MaxPayloadBytes = 40_000
	lifetime, cancel := context.WithCancel(ctx)
	b.mu.Lock()
	if b.generation != generation {
		b.mu.Unlock()
		cancel()
		_ = conn.Close()
		return context.Canceled
	}
	b.conn, b.cancel, b.paused = conn, cancel, false
	b.mu.Unlock()
	if err := b.send(conn, map[string]string{
		"type": "authenticate", "version": "1", "token": credential.Token, "device_id": credential.Device.ID,
	}); err != nil {
		b.closeConnection(generation, "connectionFailed")
		return err
	}
	go b.listen(lifetime, conn, credential, generation)
	return nil
}

func (b *desktopBridge) listen(ctx context.Context, conn *websocket.Conn, credential deviceCredentials, generation uint64) {
	defer b.closeConnection(generation, "connectionLost")
	// A transport never restores a task grant or replays an old desktop command.
	seen := make(map[string]bool)
	var order []string
	heartbeat := time.NewTicker(10 * time.Second)
	defer heartbeat.Stop()
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-heartbeat.C:
				b.mu.Lock()
				if b.generation != generation || b.conn != conn {
					b.mu.Unlock()
					return
				}
				control := "ready"
				if b.paused {
					control = "paused"
				} else if b.awaiting {
					control = "pending"
				} else if b.activeID != "" {
					control = "running"
				}
				permissions := b.permissions
				b.mu.Unlock()
				if permissions.Accessibility == "" {
					permissions = permissionState{"unknown", "unknown"}
				}
				if b.send(conn, map[string]any{"type": "heartbeat", "control": control, "permissions": permissions}) != nil {
					_ = conn.Close()
					return
				}
			}
		}
	}()
	for ctx.Err() == nil {
		_ = conn.SetReadDeadline(time.Now().Add(35 * time.Second))
		var raw []byte
		if websocket.Message.Receive(conn, &raw) != nil {
			return
		}
		b.mu.Lock()
		current := b.generation == generation && b.conn == conn
		b.mu.Unlock()
		if !current {
			return
		}
		var header struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(raw, &header) != nil {
			return
		}
		switch header.Type {
		case "ready":
			var ready struct {
				Type         string `json:"type"`
				ConnectionID string `json:"connection_id"`
			}
			if decodeStrict(raw, &ready) != nil || !uuidPattern.MatchString(ready.ConnectionID) {
				return
			}
			b.mu.Lock()
			if b.generation != generation || b.conn != conn {
				b.mu.Unlock()
				return
			}
			b.connectionID = ready.ConnectionID
			b.mu.Unlock()
			b.emit(generation, "")
		case "heartbeat":
		case "pause":
			b.pauseConnection(generation, conn)
		case "cancel":
			var cancel struct {
				Type string `json:"type"`
				ID   string `json:"id"`
			}
			if decodeStrict(raw, &cancel) != nil {
				return
			}
			b.cancelCommand(generation, conn, cancel.ID)
		case "command":
			var command desktopCommand
			if decodeStrict(raw, &command) != nil {
				return
			}
			if seen[command.ID] {
				_ = b.send(conn, map[string]any{"type": "reply", "id": command.ID,
					"result": failure("COMPUTER_USE_ACCESS_DENIED", "not_delivered")})
				continue
			}
			seen[command.ID] = true
			order = append(order, command.ID)
			if len(order) > 256 {
				delete(seen, order[0])
				order = order[1:]
			}
			b.dispatch(ctx, conn, credential, generation, command)
		default:
			return
		}
	}
}

func (b *desktopBridge) dispatch(ctx context.Context, conn *websocket.Conn, credential deviceCredentials, generation uint64, command desktopCommand) {
	request, err := validateCommand(command, credential.Device.ID, time.Now())
	deadline, cancel := context.WithDeadline(ctx, time.UnixMilli(command.ExpiresAt))
	b.mu.Lock()
	valid := b.generation == generation && b.conn == conn &&
		b.connectionID == command.ConnectionID && deadline.Err() == nil
	busy, paused := b.activeID != "", b.paused
	if err != nil || !valid || paused || busy {
		b.mu.Unlock()
		cancel()
		code := "COMPUTER_USE_ACCESS_DENIED"
		if paused {
			code = "COMPUTER_USE_PAUSED"
		} else if busy {
			code = "COMPUTER_USE_BUSY"
		}
		_ = b.send(conn, map[string]any{"type": "reply", "id": command.ID, "result": failure(code, "not_delivered")})
		return
	}
	b.active, b.activeID = cancel, command.ID
	b.mu.Unlock()
	b.emit(generation, "")
	go func() {
		defer cancel()
		contextID := command.ConversationID + "/" + command.TurnID
		b.mu.Lock()
		grant := b.grant
		allowed := grant.contextID == contextID && grant.readOnly == *command.ReadOnly && time.Now().Before(grant.expiresAt)
		newGrant := !allowed
		requestApproval := !allowed && b.onApprove != nil && b.generation == generation &&
			b.conn == conn && b.activeID == command.ID && !b.paused && deadline.Err() == nil
		if requestApproval {
			b.awaiting = true
		}
		b.mu.Unlock()
		if requestApproval {
			b.emit(generation, "")
			decision := make(chan bool, 1)
			b.onApprove(deadline, command, func(approved bool) {
				select {
				case decision <- approved:
				default:
				}
			})
			select {
			case allowed = <-decision:
			case <-deadline.Done():
			}
		}
		result := failure("COMPUTER_USE_ACCESS_DENIED", "not_delivered")
		b.mu.Lock()
		stillCurrent := b.generation == generation && b.conn == conn && !b.paused &&
			b.activeID == command.ID && deadline.Err() == nil
		if allowed && stillCurrent && newGrant {
			b.grant = taskGrant{contextID, *command.ReadOnly, time.Now().Add(5 * time.Minute)}
		}
		grantExpiry := b.grant.expiresAt
		if b.generation == generation && b.activeID == command.ID {
			b.awaiting = false
		}
		b.mu.Unlock()
		if allowed && stillCurrent {
			b.lifecycle.Lock()
			b.mu.Lock()
			stillCurrent = b.generation == generation && b.conn == conn && !b.paused &&
				b.activeID == command.ID && deadline.Err() == nil
			b.mu.Unlock()
			if newGrant && stillCurrent {
				b.engine.Stop()
			}
			b.lifecycle.Unlock()
			b.emit(generation, "")
			if stillCurrent {
				execution, cancelExecution := context.WithDeadline(deadline, grantExpiry)
				result = b.engine.Execute(execution, request, contextID)
				cancelExecution()
			}
		}
		if deadline.Err() != nil {
			result = failure("COMPUTER_USE_CANCELLED", "unknown")
		}
		b.mu.Lock()
		if b.generation == generation && b.activeID == command.ID {
			b.active, b.activeID = nil, ""
		}
		current := b.generation == generation && b.conn == conn
		b.mu.Unlock()
		if current {
			_ = b.send(conn, map[string]any{"type": "reply", "id": command.ID, "result": result})
			b.emit(generation, "")
		}
	}()
}

func validateCommand(command desktopCommand, deviceID string, now time.Time) (desktopRequest, error) {
	var request desktopRequest
	if command.Type != "command" || !uuidPattern.MatchString(command.ID) ||
		!uuidPattern.MatchString(command.ConnectionID) || !uuidPattern.MatchString(command.ConversationID) ||
		!uuidPattern.MatchString(command.TurnID) || command.DeviceID != deviceID ||
		command.ReadOnly == nil || len(command.Title) > 2_000 || command.ExpiresAt <= now.UnixMilli() ||
		command.ExpiresAt > now.Add(65*time.Second).UnixMilli() || len(command.Request) > 36_000 {
		return request, errors.New("invalid desktop command")
	}
	if err := decodeStrict(command.Request, &request); err != nil || request.DeviceID != deviceID {
		return request, errors.New("invalid desktop request")
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(command.Request, &fields) != nil {
		return request, errors.New("invalid desktop fields")
	}
	allowed := map[string]bool{"action": true, "device_id": true}
	switch request.Action {
	case "windows":
		allowed["app"] = true
	case "snapshot", "screenshot":
		allowed["app"], allowed["window_id"] = true, true
	case "key":
		allowed["app"], allowed["window_id"], allowed["key"] = true, true, true
	case "click", "focus":
		allowed["ref"] = true
	case "type":
		allowed["ref"], allowed["text"] = true, true
	case "scroll":
		allowed["ref"], allowed["direction"], allowed["amount"] = true, true, true
	}
	for field := range fields {
		if !allowed[field] {
			return request, errors.New("unsupported desktop field")
		}
	}
	if *command.ReadOnly && !readOnlyAction(request.Action) {
		return request, errors.New("Plan cannot modify the computer")
	}
	if strings.ContainsRune(request.App+request.WindowID+request.Ref+request.Key, 0) {
		return request, errors.New("invalid desktop target")
	}
	_, err := commandArguments(request)
	return request, err
}
