package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"runtime"
	"slices"
	"strconv"
	"sync"
	"sync/atomic"
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
	// ExecutionReady reports that this socket negotiated execution protocol v2
	// and holds a live link to the local runtime. Presence-only connections and
	// revoked, disconnected, shut-down, or account-invalidated connections
	// report false.
	ExecutionReady bool `json:"executionReady,omitempty"`
	// LocalToolsDisabled reports the user's persisted local-tools preference on
	// this installation. It is independent of the server device revocation.
	LocalToolsDisabled bool `json:"localToolsDisabled,omitempty"`
	// ComputerReady reports that the live socket negotiated the computer
	// operation, the runtime link for that exact generation is still live, and
	// this host can build a signed, packaged computer driver. An older server
	// that negotiates no computer operation reports false without an error.
	ComputerReady bool `json:"computerReady,omitempty"`
	// ConversationReferenceReadReady reports that this exact trusted socket
	// negotiated conversation_reference.read and the live runtime generation
	// for it is still available. It is unrelated to the structured side-chat
	// quote flag; old servers and old clients simply omit it.
	ConversationReferenceReadReady bool `json:"conversationReferenceReadReady,omitempty"`
}

type deviceConnection struct {
	mu         sync.RWMutex
	server     *url.URL
	credential deviceCredential
	// account and lease bind this connection to the native principal proven by
	// the rotated refresh. A renderer owner id or a stored pairing alone is not
	// identity.
	account *workspaceAccount
	lease   accountLease
	// signOut is the native sign-out intent. It is atomic and may be set before
	// the account clear becomes visible, so pipe admission reads it after the
	// pipe lock.
	signOut *atomic.Bool
	ctx     context.Context
	cancel  context.CancelFunc
	done    chan struct{}
	status  DeviceConnectionStatus
	runtime *runtimeSupervisor
	link    atomic.Pointer[runtimeLink]
	// computer is the product computer executor ingress, or the explicit
	// test-injected fixture host. It is non-nil only when this host can offer
	// the operation; production builds always use the product gate.
	computer *m1bComputerHost
	// computerEligible is the host-side driver eligibility check. Status
	// derives ComputerReady from it on every read, so a removed runtime,
	// unsigned build, revoked account, or dead link fails closed.
	computerEligible func() bool
	// onLinkEnded lets the product controller invalidate a selection before a
	// reconnect. It receives the exact socket generation that ended, so a stale
	// callback can never reset a newer generation's selection. It runs without
	// any connection lock held.
	onLinkEnded func(*deviceControlSession)
	// onRuntimeFrame observes one bounded frame published by the local runtime
	// before its result is forgotten. The product controller uses it only to
	// release a selection whose exact run reached terminal; it never authorizes
	// input and never rewrites the frame. It runs without connection locks.
	onRuntimeFrame func([]byte)
	// computerNegotiated is true only for the live socket generation that
	// negotiated computer.execute. It is cleared whenever readiness is lost.
	computerNegotiated bool
	// conversationReferenceReadNegotiated is true only for the live socket
	// generation that echoed the read operation this host offered.
	conversationReferenceReadNegotiated bool

	controlMu      sync.Mutex
	controlPending map[string]*pendingComputerControl
	control        *deviceControlSession
}

const (
	desktopExecutionVersion     = 2
	desktopExecutionHeader      = "X-LinkSense-Desktop-Execution"
	desktopToolVersion          = 1
	desktopToolHeader           = "X-LinkSense-Desktop-Tools"
	desktopToolOperationsHeader = "X-LinkSense-Desktop-Tool-Operations"
	// desktopComputerStatusHeader negotiates the additive positive status
	// attestation on the exact API/native link. It is not a tool operation and
	// never enters the runtime link.open list.
	desktopComputerStatusHeader  = "X-LinkSense-Desktop-Computer-Status"
	desktopComputerStatusVersion = 1
	// desktopComputerWaitOperation is an additive negotiation marker for the
	// read-only wait kind inside computer.execute. It is not a second wire
	// operation: an old server ignores the unknown offered string and an old
	// Mac never offers it.
	desktopComputerWaitOperation              = "computer.wait"
	desktopConversationReferenceReadOperation = "conversation_reference.read"
	desktopModelSwitchOperation               = "turn.model-switch"
	desktopAttachmentHeader                   = "X-LinkSense-Desktop-Attachments"
	desktopAttachmentVersion                  = 1
	desktopConversationReferenceHeader        = "X-LinkSense-Desktop-Conversation-Reference"
	desktopConversationReferenceVersion       = 1
	desktopAppVersionHeader                   = "X-LinkSense-Desktop-App-Version"
)

func newDeviceConnection(server *url.URL, credential deviceCredential, account *workspaceAccount, lease accountLease) *deviceConnection {
	ctx, cancel := context.WithCancel(context.Background())
	return &deviceConnection{
		server: server, credential: credential, account: account, lease: lease,
		ctx: ctx, cancel: cancel, done: make(chan struct{}),
		status: DeviceConnectionStatus{State: DeviceConnecting, DeviceID: credential.DeviceID, Name: credential.Name},
	}
}

// authorized reports whether the native principal this connection was created
// for is still the verified account and no sign-out is pending. Sign-out
// intent is atomic and can precede the account clear, so it is part of the
// same derivation used by status publication and pipe admission. Sign-out, an
// account switch, an expired session, or the same account signing in again
// under a new generation all stop the connection even while the device
// credential itself remains valid.
func (connection *deviceConnection) authorized() bool {
	if connection.account == nil || connection.lease.id == "" {
		return false
	}
	if connection.signOut != nil && connection.signOut.Load() {
		return false
	}
	return connection.account.matches(connection.lease)
}

// runtimeLinkLive reports whether the exact runtime generation this link was
// opened on is still running. A restarted supervisor publishes a new pipe, so
// a link must not be treated as live merely because readiness is true again.
func runtimeLinkLive(link *runtimeLink) bool {
	return link != nil && link.pipe != nil && !runtimePipeClosed(link.pipe)
}

// runtimeWriteAdmission revalidates this connection immediately before a frame
// enters the private runtime pipe. The caller holds pipe.mu, so a command that
// waited for an earlier pipe writer is checked only after that wait. The account
// read lease is held across the bounded pipe write, preventing a sign-out or
// account switch from completing between admission and the write. It never
// takes the auth mutex or a credential store.
func (connection *deviceConnection) runtimeWriteAdmission(ctx context.Context) func(write func() error) error {
	return func(write func() error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if !connection.authorized() {
			return errAccountRequired
		}
		return connection.account.withLease(connection.lease, func() error {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			// Re-read the atomic intent after acquiring the pipe and the lease;
			// authorized() is not called here because withLease already holds
			// the account read lock.
			if connection.signOut != nil && connection.signOut.Load() {
				return errAccountRequired
			}
			return write()
		})
	}
}

func (connection *deviceConnection) Status() DeviceConnectionStatus {
	connection.mu.RLock()
	status := connection.status
	computerNegotiated := connection.computerNegotiated
	// Derive authority after taking the status snapshot. Checking before this
	// lock let a sign-out, switch, or expiry that landed while a caller waited
	// on connection.mu publish the previous account's id, name, and state.
	authorized := connection.authorized()
	connection.mu.RUnlock()
	if !authorized {
		return DeviceConnectionStatus{State: DeviceUnpaired}
	}
	// Readiness is derived too: a lost link, stopped runtime, or canceled
	// connection must fail closed even before the socket unwinds and cleanup
	// completes.
	if status.ExecutionReady {
		link := connection.link.Load()
		if connection.ctx.Err() != nil || link == nil || !runtimeLinkLive(link) ||
			(connection.runtime != nil && !connection.runtime.ready.Load()) {
			status.ExecutionReady = false
		}
	}
	if status.ConversationReferenceReadReady &&
		(!status.ExecutionReady || !connection.conversationReferenceReadNegotiated) {
		status.ConversationReferenceReadReady = false
	}
	if status.ComputerReady {
		if !status.ExecutionReady || !computerNegotiated || connection.computer == nil ||
			connection.computerEligible == nil || !connection.computerEligible() ||
			connection.ctx.Err() != nil {
			status.ComputerReady = false
		}
	}
	return status
}

func (connection *deviceConnection) setStatus(state DeviceConnectionState, code string) {
	connection.mu.Lock()
	connection.status.State, connection.status.ErrorCode = state, code
	connection.status.ExecutionReady = false
	connection.status.ComputerReady = false
	connection.status.ConversationReferenceReadReady = false
	connection.computerNegotiated = false
	connection.conversationReferenceReadNegotiated = false
	connection.mu.Unlock()
}

func (connection *deviceConnection) setOnline(executionReady bool) {
	connection.mu.Lock()
	connection.status.State, connection.status.ErrorCode = DeviceOnline, ""
	connection.status.ExecutionReady = executionReady
	connection.status.ComputerReady = false
	connection.status.ConversationReferenceReadReady = false
	connection.computerNegotiated = false
	connection.conversationReferenceReadNegotiated = false
	connection.mu.Unlock()
}

// setComputerNegotiated accepts only a live negotiated generation. The
// eligibility closure is evaluated before the lock so a status read never
// waits behind a filesystem check.
func (connection *deviceConnection) setComputerNegotiated(negotiated bool) {
	eligible := false
	if negotiated {
		eligible = connection.computer != nil && connection.computerEligible != nil &&
			connection.computerEligible()
	}
	connection.mu.Lock()
	connection.computerNegotiated = negotiated
	connection.status.ComputerReady = negotiated && eligible
	connection.mu.Unlock()
}

func (connection *deviceConnection) setConversationReferenceReadNegotiated(negotiated bool) {
	connection.mu.Lock()
	connection.conversationReferenceReadNegotiated = negotiated
	connection.status.ConversationReferenceReadReady = negotiated
	connection.mu.Unlock()
}

func (connection *deviceConnection) clearExecutionReady() {
	connection.mu.Lock()
	connection.status.ExecutionReady = false
	connection.status.ComputerReady = false
	connection.status.ConversationReferenceReadReady = false
	connection.computerNegotiated = false
	connection.conversationReferenceReadNegotiated = false
	connection.mu.Unlock()
}

func (connection *deviceConnection) run() {
	defer close(connection.done)
	for attempt := 0; attempt < 6; attempt++ {
		if connection.ctx.Err() != nil {
			connection.setStatus(DeviceOffline, "")
			return
		}
		// No dial, retry, or hello may happen after the native session that
		// authorized this pairing has ended.
		if !connection.authorized() {
			connection.setStatus(DeviceOffline, "AUTH_REQUIRED")
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
			// A credential revoked by the server is different from a local
			// account that is no longer proven; the latter keeps the pairing.
			if code == "AUTH_REQUIRED" && connection.authorized() {
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
	if !connection.authorized() {
		return true, "AUTH_REQUIRED"
	}
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
	if runtime.GOOS == "darwin" {
		if version, ok := desktopAppVersionHeaderValue(); ok {
			headers.Set(desktopAppVersionHeader, version)
		}
	}
	// The bundled runtime starts with the app. A socket dialed before it is
	// ready would stay presence-only until the next reconnect, so wait a
	// bounded time for the first offer. A failed runtime still connects as
	// presence-only after the deadline.
	offerDeadline := time.Now().Add(8 * time.Second)
	for connection.runtime != nil && !connection.runtime.ready.Load() &&
		time.Now().Before(offerDeadline) && connection.ctx.Err() == nil {
		time.Sleep(100 * time.Millisecond)
	}
	offerExecution := connection.runtime != nil && connection.runtime.ready.Load()
	offerComputerStatus := offerExecution && connection.computer != nil
	offerConversationReference := offerExecution && runtime.GOOS == "darwin"
	offerConversationReferenceRead := offerExecution && runtime.GOOS == "darwin"
	if offerExecution {
		headers.Set(desktopExecutionHeader, strconv.Itoa(desktopExecutionVersion))
		if runtime.GOOS == "darwin" {
			headers.Set(desktopAttachmentHeader, strconv.Itoa(desktopAttachmentVersion))
			headers.Set(desktopConversationReferenceHeader, strconv.Itoa(desktopConversationReferenceVersion))
		}
		headers.Set(desktopToolHeader, strconv.Itoa(desktopToolVersion))
		operations := "web.search,knowledge.search,knowledge.documents,knowledge.markdown,connection.execute,browser.execute,artifact.prepare,artifact.multipart,artifact.website,approval.respond"
		if runtime.GOOS == "darwin" {
			operations += "," + desktopModelSwitchOperation
		}
		if offerConversationReferenceRead {
			// Read-only access to an explicitly granted task reference. The
			// operation carries no native shell UI and remains unavailable on
			// older APIs that do not echo it.
			operations += "," + desktopConversationReferenceReadOperation
		}
		if connection.computer != nil {
			// Only the installed Mac product host offers the read-only wait,
			// and it rides the existing computer.execute operation. The status
			// attestation is a separate header, never a tool operation.
			operations += "," + m1bComputerOperation + "," + desktopComputerWaitOperation
			headers.Set(desktopComputerStatusHeader, strconv.Itoa(desktopComputerStatusVersion))
		}
		headers.Set(desktopToolOperationsHeader, operations)
	}
	socket, _, err := websocket.Dial(dialContext, endpoint.String(), &websocket.DialOptions{
		HTTPClient: client, HTTPHeader: headers, CompressionMode: websocket.CompressionDisabled,
	})
	cancelDial()
	if err != nil {
		return false, "RUNNER_UNAVAILABLE"
	}
	defer socket.CloseNow()
	// The dial and the server handshake can outlive a sign-out; never present
	// the device credential on behalf of an account that is no longer proven.
	if !connection.authorized() {
		return true, "AUTH_REQUIRED"
	}
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
	// The status marker is accepted only as the identical echo of this exact
	// socket's offer, and only when the same ready frame negotiated
	// computer.execute. An unoffered marker is a protocol error; a missing echo
	// keeps the legacy status exchange.
	if ready.ComputerStatusVersion != nil && (!offerComputerStatus ||
		!hasM1BComputerOperation(ready.ToolOperations)) {
		return true, "DESKTOP_PROTOCOL_ERROR"
	}
	// A ready frame must never enable an operation this host did not offer.
	if slices.Contains(ready.ToolOperations, desktopConversationReferenceReadOperation) && !offerConversationReferenceRead {
		return true, "DESKTOP_PROTOCOL_ERROR"
	}
	// The quote echo is accepted only for the exact opt-in this socket offered.
	// An old server omits it, so plain execution remains available without the
	// structured local quote capability.
	if ready.ConversationReferenceVersion != nil && !offerConversationReference {
		return true, "DESKTOP_PROTOCOL_ERROR"
	}
	if !connection.authorized() {
		return true, "AUTH_REQUIRED"
	}
	var link *runtimeLink
	if ready.ExecutionVersion != nil {
		// attach reuses the supervisor's own checks: only a published pipe owned
		// by a ready runtime with no other link is accepted. Its admission runs
		// under pipe.mu and holds the account lease across link.open.
		link, err = connection.runtime.attach(ready.ConnectionID, connection.credential.OwnerID, ready.ToolVersion, ready.ToolOperations, ready.AttachmentVersion, ready.ConversationReferenceVersion, connection.runtimeWriteAdmission(connection.ctx))
		if err != nil {
			if errors.Is(err, errAccountRequired) {
				return true, "AUTH_REQUIRED"
			}
			return false, "RUNNER_UNAVAILABLE"
		}
		connection.link.Store(link)
		defer func() {
			connection.link.CompareAndSwap(link, nil)
			link.close()
		}()
		socket.SetReadLimit(desktopFrameLimit)
	}
	// The attach write can block; re-check the lease immediately before this
	// connection is reported online with execution.
	if !connection.authorized() {
		return true, "AUTH_REQUIRED"
	}
	// Execution readiness exists only for an accepted execution_protocol_version
	// with a live link; a presence-only server stays online without it.
	connection.setOnline(link != nil)
	connection.setConversationReferenceReadNegotiated(link != nil && offerConversationReferenceRead &&
		slices.Contains(ready.ToolOperations, desktopConversationReferenceReadOperation))
	// Control frames belong to this exact hello generation. The session is
	// published before readiness so a status read can never see ComputerReady
	// for a socket that cannot carry computer.control, and it is withdrawn
	// with the link so a late result can never complete a newer operation.
	controlSession := &deviceControlSession{socket: socket, linkID: ready.ConnectionID}
	connection.setControlSession(controlSession)
	defer func() {
		connection.clearControlSession(controlSession)
		if connection.onLinkEnded != nil {
			connection.onLinkEnded(controlSession)
		}
	}()
	if link != nil {
		connection.setComputerNegotiated(connection.computer != nil && hasM1BComputerOperation(ready.ToolOperations))
	}
	// The per-socket context cancels computer work immediately when this
	// socket/read/link generation ends, before the deferred heartbeat join.
	socketContext, socketCancel := context.WithCancel(connection.ctx)
	heartbeatContext, stopHeartbeat := context.WithCancel(socketContext)
	keepaliveDone := make(chan struct{})
	defer func() {
		stopHeartbeat()
		<-keepaliveDone
	}()
	// A fixture executor is armed only for the exact ready generation that
	// negotiated the operation. Its token serializes this host across
	// connection changes; release is token-scoped so an old socket cannot
	// release a newer one.
	computer := &m1bComputerLink{
		connection: connection, socket: socket, linkID: ready.ConnectionID, ctx: socketContext,
		computerStatus: offerComputerStatus && ready.ComputerStatusVersion != nil &&
			*ready.ComputerStatusVersion == desktopComputerStatusVersion &&
			hasM1BComputerOperation(ready.ToolOperations),
		live: func() bool {
			return link != nil && runtimeLinkLive(link) && (link.current == nil || link.current()) &&
				connection.runtime != nil && connection.runtime.ready.Load()
		},
	}
	if connection.computer != nil && link != nil && hasM1BComputerOperation(ready.ToolOperations) {
		computer.host = connection.computer
		computer.token = connection.computer.open()
		defer connection.computer.release(computer.token)
	}
	// Registered after the keepalive join defer so it runs first.
	defer socketCancel()
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
		runtimeFrame := false
		for {
			// Account loss is an actual lease loss: cancel the connection rather
			// than letting the socket unwind into a reconnect attempt.
			if !connection.authorized() {
				connection.cancel()
				connection.clearExecutionReady()
				_ = socket.CloseNow()
				return
			}
			// The link belongs to one runtime generation. Its pipe ending, or the
			// supervisor withdrawing readiness, is runtime loss: stop claiming
			// execution instead of waiting for the next server frame.
			if link != nil && (!runtimeLinkLive(link) || !connection.runtime.ready.Load()) {
				connection.clearExecutionReady()
				_ = socket.CloseNow()
				return
			}
			ctx, cancel := context.WithTimeout(heartbeatContext, 5*time.Second)
			err := socket.Write(ctx, websocket.MessageText, frame)
			cancel()
			if err != nil {
				connection.clearExecutionReady()
				_ = socket.CloseNow()
				return
			}
			if runtimeFrame {
				// The exact runtime frame reached the server on this socket
				// generation. Let the product controller release a selection whose
				// run it proves terminal; the frame itself is unchanged.
				if connection.onRuntimeFrame != nil {
					connection.onRuntimeFrame(frame)
				}
				runtimeFrame = false
			}
			select {
			case <-heartbeatContext.Done():
				return
			case <-runtimeDone:
				connection.clearExecutionReady()
				_ = socket.CloseNow()
				return
			case frame = <-frames:
				runtimeFrame = true
			case <-ticker.C:
				if !offerExecution && connection.runtime != nil && connection.runtime.ready.Load() {
					_ = socket.CloseNow()
					return
				}
				frame = []byte(`{"type":"ping"}`)
				runtimeFrame = false
			}
		}
	}()
	// The socket is gone as soon as this read loop exits. Clear readiness
	// before the deferred keepalive join and link close, so Status never
	// reports a live execution link for a disconnected socket. Registered
	// after the keepalive defer, so it runs first.
	defer connection.clearExecutionReady()
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
		// Re-check after the read too: a frame that arrived across sign-out must
		// not be answered or handed to the runtime for the previous account.
		if !connection.authorized() {
			return true, "AUTH_REQUIRED"
		}
		if decodeDevicePong(data) {
			continue
		}
		// A control result completes only its exact pending request on this
		// exact socket generation. It is never forwarded to the runtime.
		if connection.deliverComputerControlResult(controlSession, data) {
			continue
		}
		// The fixture operation is consumed here, before the runtime pipe.
		// Unknown computer-prefixed commands are rejected rather than falling
		// through to DesktopTurns as an unrecognized command.
		if interceptM1BComputerFrame(computer, data) {
			continue
		}
		if link == nil || !isDesktopExecutionInput(data) {
			return true, "DESKTOP_PROTOCOL_ERROR"
		}
		if err := link.send(data); err != nil {
			// send revalidates authority under pipe.mu immediately before the
			// frame write; a command that lost its account is never replayed.
			if errors.Is(err, errAccountRequired) {
				return true, "AUTH_REQUIRED"
			}
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
	return frame.Type == "command" || frame.Type == "command.cancel" || frame.Type == "execution.ack" || frame.Type == "tool.result"
}

type deviceReady struct {
	Type                         string   `json:"type"`
	DeviceID                     string   `json:"device_id"`
	ConnectionID                 string   `json:"connection_id"`
	ProtocolVersion              int      `json:"protocol_version"`
	HeartbeatIntervalMS          int      `json:"heartbeat_interval_ms"`
	ExecutionVersion             *int     `json:"execution_protocol_version,omitempty"`
	AttachmentVersion            *int     `json:"attachment_protocol_version,omitempty"`
	ConversationReferenceVersion *int     `json:"conversation_reference_protocol_version,omitempty"`
	ToolVersion                  *int     `json:"tool_protocol_version,omitempty"`
	ToolOperations               []string `json:"tool_operations,omitempty"`
	ComputerStatusVersion        *int     `json:"computer_status_version,omitempty"`
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
		(ready.ExecutionVersion != nil && *ready.ExecutionVersion != desktopExecutionVersion) ||
		(ready.AttachmentVersion != nil && (ready.ExecutionVersion == nil || *ready.AttachmentVersion != desktopAttachmentVersion)) ||
		(ready.ConversationReferenceVersion != nil && (ready.ExecutionVersion == nil ||
			*ready.ConversationReferenceVersion != desktopConversationReferenceVersion)) ||
		(ready.ToolVersion != nil && (ready.ExecutionVersion == nil || *ready.ToolVersion != desktopToolVersion)) ||
		(ready.ComputerStatusVersion != nil && (*ready.ComputerStatusVersion != desktopComputerStatusVersion ||
			ready.ExecutionVersion == nil || ready.ToolVersion == nil)) ||
		(len(ready.ToolOperations) > 0 && ready.ToolVersion == nil) {
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

// deviceControlSession is one hello generation that can carry
// computer.control. A pending control request is bound to the exact pointer:
// a replacement socket fails it instead of letting a late result activate a
// selection on the newer link.
type deviceControlSession struct {
	socket *websocket.Conn
	linkID string
}

type pendingComputerControl struct {
	session *deviceControlSession
	reply   chan computerControlReply
}

type computerControlReply struct {
	data    json.RawMessage
	session *deviceControlSession
	err     error
}

func (connection *deviceConnection) setControlSession(session *deviceControlSession) {
	connection.mu.Lock()
	connection.control = session
	connection.mu.Unlock()
}

func (connection *deviceConnection) currentControlSession() *deviceControlSession {
	connection.mu.RLock()
	defer connection.mu.RUnlock()
	return connection.control
}

// clearControlSession withdraws the generation and releases every waiter bound
// to it. A request that was written but not answered becomes an explicit
// supersession, never a silent success or a replay on the next socket.
func (connection *deviceConnection) clearControlSession(session *deviceControlSession) {
	connection.mu.Lock()
	if connection.control == session {
		connection.control = nil
	}
	connection.mu.Unlock()
	connection.controlMu.Lock()
	for id, pending := range connection.controlPending {
		if pending.session != session {
			continue
		}
		delete(connection.controlPending, id)
		select {
		case pending.reply <- computerControlReply{session: session, err: errComputerControlSuperseded}:
		default:
		}
	}
	connection.controlMu.Unlock()
}

// computerControl writes one control frame on the exact hello generation the
// caller admitted and waits for its correlated result. The session pointer is
// pinned for the write: a reconnect that installs a newer generation between
// admission and this call fails the request before any write instead of
// redirecting the old generation's frame onto the new link. No connection lock
// is held across the write or the wait, so the socket reader and every other
// status caller keep going.
func (connection *deviceConnection) computerControl(ctx context.Context, session *deviceControlSession, id string, frame []byte) (json.RawMessage, *deviceControlSession, error) {
	if ctx == nil || !validUUID(id) || len(frame) == 0 || len(frame) > computerControlMaxResultBytes {
		return nil, nil, errComputerInvalid
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	if !connection.authorized() {
		return nil, nil, errAccountRequired
	}
	if session == nil || connection.currentControlSession() != session {
		return nil, nil, errComputerControlSuperseded
	}
	pending := &pendingComputerControl{session: session, reply: make(chan computerControlReply, 1)}
	connection.controlMu.Lock()
	if connection.controlPending == nil {
		connection.controlPending = make(map[string]*pendingComputerControl)
	}
	if len(connection.controlPending) >= 4 {
		connection.controlMu.Unlock()
		return nil, nil, errComputerBusy
	}
	if _, exists := connection.controlPending[id]; exists {
		connection.controlMu.Unlock()
		return nil, nil, errComputerInvalid
	}
	connection.controlPending[id] = pending
	connection.controlMu.Unlock()
	defer connection.removeComputerControl(id)

	writeContext, cancelWrite := context.WithTimeout(ctx, 5*time.Second)
	err := session.socket.Write(writeContext, websocket.MessageText, frame)
	cancelWrite()
	if err != nil {
		return nil, nil, errComputerUnavailable
	}
	select {
	case <-ctx.Done():
		return nil, nil, ctx.Err()
	case <-connection.ctx.Done():
		return nil, nil, errComputerUnavailable
	case reply := <-pending.reply:
		if reply.err != nil {
			return nil, nil, reply.err
		}
		if reply.session != session || connection.currentControlSession() != session {
			return nil, nil, errComputerControlSuperseded
		}
		// Re-check the native principal after the wait: a result that arrived
		// across a sign-out or account switch is never used.
		if !connection.authorized() {
			return nil, nil, errAccountRequired
		}
		return reply.data, session, nil
	}
}

func (connection *deviceConnection) removeComputerControl(id string) {
	connection.controlMu.Lock()
	delete(connection.controlPending, id)
	connection.controlMu.Unlock()
}

// deliverComputerControlResult consumes a control result for its exact pending
// request. Unknown, late, malformed-id and oversized results are consumed
// without affecting a connection; a result for another socket generation is
// left for clearControlSession to fail.
func (connection *deviceConnection) deliverComputerControlResult(session *deviceControlSession, data []byte) bool {
	var header struct {
		Type string `json:"type"`
		ID   string `json:"id"`
	}
	if !json.Valid(data) || json.Unmarshal(data, &header) != nil {
		return false
	}
	if header.Type != computerControlResultType {
		return false
	}
	if session == nil || len(data) > computerControlMaxResultBytes || !validUUID(header.ID) {
		return true
	}
	connection.controlMu.Lock()
	pending := connection.controlPending[header.ID]
	if pending != nil && pending.session == session {
		delete(connection.controlPending, header.ID)
	}
	connection.controlMu.Unlock()
	if pending == nil {
		return true
	}
	reply := computerControlReply{data: append(json.RawMessage(nil), data...), session: session}
	select {
	case pending.reply <- reply:
	default:
	}
	return true
}

// desktopAppVersionHeaderValue returns the packaged application version only
// when it matches the desktop registration app_version grammar
// (1..40 ASCII characters from [A-Za-z0-9._+-]). Unpackaged development
// builds report no version, so the optional header is omitted.
func desktopAppVersionHeaderValue() (string, bool) {
	version := desktopAppVersion()
	if len(version) < 1 || len(version) > 40 {
		return "", false
	}
	for i := 0; i < len(version); i++ {
		c := version[i]
		if (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') && (c < '0' || c > '9') &&
			c != '.' && c != '_' && c != '+' && c != '-' {
			return "", false
		}
	}
	return version, true
}
