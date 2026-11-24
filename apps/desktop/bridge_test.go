package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	jsonv2 "encoding/json/v2"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"runtime"
	"strconv"
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

func sendDeviceExecutionReady(ctx context.Context, socket *websocket.Conn, deviceID, connectionID string) error {
	version, attachment := desktopExecutionVersion, desktopAttachmentVersion
	data, _ := json.Marshal(deviceReady{
		Type: "ready", DeviceID: deviceID, ConnectionID: connectionID,
		ProtocolVersion: 1, HeartbeatIntervalMS: 15_000,
		ExecutionVersion: &version, AttachmentVersion: &attachment,
	})
	return socket.Write(ctx, websocket.MessageText, data)
}

// newFixtureDeviceConnection binds a fixture connection to the verified
// account its credential belongs to, like the production bridge does.
func newFixtureDeviceConnection(t *testing.T, origin *url.URL, credential deviceCredential) *deviceConnection {
	t.Helper()
	account := &workspaceAccount{}
	account.set(credential.OwnerID, time.Now().Add(time.Hour))
	lease, err := requireAccount(account)
	if err != nil {
		t.Fatal(err)
	}
	return newDeviceConnection(origin, credential, account, lease)
}

func deviceFixtureAccount(credential deviceCredential) (*workspaceAccount, accountLease) {
	account := &workspaceAccount{}
	account.set(credential.OwnerID, time.Now().Add(time.Hour))
	lease, _ := requireAccount(account)
	return account, lease
}

// newFixtureRuntime publishes a ready supervisor whose pipe the test can read.
func newFixtureRuntime(t *testing.T) (*runtimeSupervisor, *runtimePipe, <-chan runtimePipeMessage) {
	t.Helper()
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	pipe := &runtimePipe{input: writer, done: make(chan struct{})}
	runtime := &runtimeSupervisor{}
	runtime.pipe.Store(pipe)
	runtime.ready.Store(true)
	messages := make(chan runtimePipeMessage, 4)
	go func() {
		defer close(messages)
		scanner := bufio.NewScanner(reader)
		for scanner.Scan() {
			var message runtimePipeMessage
			if json.Unmarshal(scanner.Bytes(), &message) == nil {
				messages <- message
			}
		}
	}()
	t.Cleanup(func() {
		runtime.ready.Store(false)
		runtime.pipe.Store(nil)
		_ = writer.Close()
		_ = reader.Close()
	})
	return runtime, pipe, messages
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
	connection := newFixtureDeviceConnection(t, origin, credential)
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
	if connection.Status().ExecutionReady {
		t.Fatal("a presence-only API connection reported execution readiness")
	}
	connection.cancel()
	waitDeviceDone(t, connection)
	if connection.Status().State != DeviceOffline {
		t.Fatal("a stopped native device remained online")
	}
}

func TestDeviceBridgeOffersComputerWaitOnlyWithTheMacHost(t *testing.T) {
	credential := deviceFixtureCredential()
	offers := make(chan string, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		offers <- r.Header.Get(desktopToolOperationsHeader)
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
		// An older server sends no tool_operations; the new bridge must still
		// accept that ready frame, and its own offer is unchanged for an old
		// server.
		if sendDeviceExecutionReady(ctx, socket, credential.DeviceID,
			"30000000-0000-4000-8000-000000000021") != nil {
			return
		}
		for {
			_, data, err := socket.Read(ctx)
			if err != nil {
				return
			}
			if string(data) == `{"type":"ping"}` {
				if socket.Write(ctx, websocket.MessageText, []byte(`{"type":"pong"}`)) != nil {
					return
				}
			}
		}
	}))
	defer server.Close()
	origin, _ := url.Parse(server.URL)

	withHostRuntime, _, withHostMessages := newFixtureRuntime(t)
	withHost := newFixtureDeviceConnection(t, origin, credential)
	withHost.runtime = withHostRuntime
	withHost.computer = newM1BComputerHost(newFixtureComputerExecutor(fixtureComputerSelection(credential)))
	withHost.computerEligible = func() bool { return true }
	go withHost.run()
	select {
	case offer := <-offers:
		for _, required := range []string{m1bComputerOperation, desktopComputerWaitOperation} {
			if !strings.Contains(offer, required) {
				t.Fatalf("the Mac host did not offer %q: %q", required, offer)
			}
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the device did not dial")
	}
	select {
	case message := <-withHostMessages:
		if message.Type != "link.open" {
			t.Fatalf("the old ready frame was not accepted: %+v", message)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the old ready frame did not open the runtime link")
	}
	withHost.cancel()
	waitDeviceDone(t, withHost)

	presenceRuntime, _, _ := newFixtureRuntime(t)
	withoutHost := newFixtureDeviceConnection(t, origin, credential)
	withoutHost.runtime = presenceRuntime
	go withoutHost.run()
	defer func() {
		withoutHost.cancel()
		waitDeviceDone(t, withoutHost)
	}()
	select {
	case offer := <-offers:
		if strings.Contains(offer, m1bComputerOperation) ||
			strings.Contains(offer, desktopComputerWaitOperation) {
			t.Fatalf("a host without the Mac computer executor offered computer operations: %q", offer)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the second device did not dial")
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
	connection := newFixtureDeviceConnection(t, origin, credential)
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
	connection := newFixtureDeviceConnection(t, origin, credential)
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

func TestDeviceReadyRequiresExecutionForConversationReference(t *testing.T) {
	credential := deviceFixtureCredential()
	execution, quote := desktopExecutionVersion, desktopConversationReferenceVersion
	ready := deviceReady{
		Type: "ready", DeviceID: credential.DeviceID,
		ConnectionID: "30000000-0000-4000-8000-000000000001", ProtocolVersion: 1, HeartbeatIntervalMS: 15_000,
		ExecutionVersion: &execution, ConversationReferenceVersion: &quote,
	}
	encoded, _ := json.Marshal(ready)
	if parsed, err := decodeDeviceReady(encoded); err != nil || parsed.ConversationReferenceVersion == nil {
		t.Fatal("rejected the matching quote negotiation echo")
	}
	withoutExecution := ready
	withoutExecution.ExecutionVersion = nil
	encoded, _ = json.Marshal(withoutExecution)
	if _, err := decodeDeviceReady(encoded); err == nil {
		t.Fatal("accepted a quote echo without execution negotiation")
	}
	wrong := desktopConversationReferenceVersion + 1
	mismatched := ready
	mismatched.ConversationReferenceVersion = &wrong
	encoded, _ = json.Marshal(mismatched)
	if _, err := decodeDeviceReady(encoded); err == nil {
		t.Fatal("accepted a mismatched quote protocol version")
	}
}

func TestRuntimeLinkOpenCarriesOnlyTheMatchingQuoteVersion(t *testing.T) {
	runtime, _, messages := newFixtureRuntime(t)
	quote := desktopConversationReferenceVersion
	link, err := runtime.attach("70000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000001", nil, nil, nil, &quote, nil)
	if err != nil {
		t.Fatal(err)
	}
	opened := <-messages
	if opened.Type != "link.open" || opened.ConversationReferenceVersion == nil || *opened.ConversationReferenceVersion != quote {
		t.Fatal("the private supervisor did not carry the exact quote negotiation")
	}
	link.close()
	wrong := quote + 1
	if _, err := runtime.attach("70000000-0000-4000-8000-000000000002", "10000000-0000-4000-8000-000000000001", nil, nil, nil, &wrong, nil); err == nil {
		t.Fatal("the private supervisor accepted an unknown quote protocol version")
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
			connection := newFixtureDeviceConnection(t, origin, credential)
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

func waitDeviceStatus(t *testing.T, connection *deviceConnection, condition func(DeviceConnectionStatus) bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if condition(connection.Status()) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("device status condition was not reached: %+v", connection.Status())
}

func TestDeviceBridgeReportsExecutionReadyOnlyForANegotiatedRuntimeLink(t *testing.T) {
	credential := deviceFixtureCredential()
	const connectionID = "30000000-0000-4000-8000-000000000003"
	runtime, _, messages := newFixtureRuntime(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(desktopExecutionHeader) != strconv.Itoa(desktopExecutionVersion) {
			t.Error("the device did not offer execution before dialing")
			return
		}
		socket, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer socket.CloseNow()
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		if _, data, err := socket.Read(ctx); err != nil || !strings.Contains(string(data), credential.Token) {
			t.Error("the device did not authenticate")
			return
		}
		if err := sendDeviceExecutionReady(ctx, socket, credential.DeviceID, connectionID); err != nil {
			return
		}
		for {
			_, data, err := socket.Read(ctx)
			if err != nil {
				return
			}
			if string(data) == `{"type":"ping"}` {
				if socket.Write(ctx, websocket.MessageText, []byte(`{"type":"pong"}`)) != nil {
					return
				}
			}
		}
	}))
	defer server.Close()
	origin, _ := url.Parse(server.URL)
	connection := newFixtureDeviceConnection(t, origin, credential)
	connection.runtime = runtime
	go connection.run()
	defer connection.cancel()

	var opened runtimePipeMessage
	select {
	case opened = <-messages:
	case <-time.After(5 * time.Second):
		t.Fatal("the accepted execution protocol did not open a runtime link")
	}
	if opened.Type != "link.open" || opened.LinkID != connectionID || opened.OwnerID != credential.OwnerID {
		t.Fatalf("the runtime link was not scoped to the paired owner: %+v", opened)
	}
	waitDeviceStatus(t, connection, func(status DeviceConnectionStatus) bool {
		return status.State == DeviceOnline && status.ExecutionReady
	})
	connection.cancel()
	waitDeviceDone(t, connection)
	status := connection.Status()
	if status.State != DeviceOffline || status.ExecutionReady {
		t.Fatalf("a stopped execution connection reported readiness: %+v", status)
	}
}

func TestDeviceBridgeOffersAndEchoesConversationReferenceOnTheExactSocket(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("the local quote lane is macOS-only")
	}
	credential := deviceFixtureCredential()
	runtime, _, messages := newFixtureRuntime(t)
	offer := make(chan string, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		offer <- r.Header.Get(desktopConversationReferenceHeader)
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
		execution, quote := desktopExecutionVersion, desktopConversationReferenceVersion
		data, _ := json.Marshal(deviceReady{
			Type: "ready", DeviceID: credential.DeviceID, ConnectionID: "30000000-0000-4000-8000-000000000005",
			ProtocolVersion: 1, HeartbeatIntervalMS: 15_000,
			ExecutionVersion: &execution, ConversationReferenceVersion: &quote,
		})
		if socket.Write(ctx, websocket.MessageText, data) != nil {
			return
		}
		<-ctx.Done()
	}))
	defer server.Close()
	origin, _ := url.Parse(server.URL)
	connection := newFixtureDeviceConnection(t, origin, credential)
	connection.runtime = runtime
	go connection.run()
	defer connection.cancel()
	if got := <-offer; got != strconv.Itoa(desktopConversationReferenceVersion) {
		t.Fatalf("conversation-reference offer header = %q", got)
	}
	select {
	case opened := <-messages:
		if opened.ConversationReferenceVersion == nil || *opened.ConversationReferenceVersion != desktopConversationReferenceVersion {
			t.Fatalf("the exact quote echo was not carried to the private runner: %+v", opened)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the quote negotiation did not open a runtime link")
	}
	waitDeviceStatus(t, connection, func(status DeviceConnectionStatus) bool {
		return status.State == DeviceOnline && status.ExecutionReady
	})
}

func TestDeviceBridgeExecutionReadyFailsClosedWhenTheRuntimeStops(t *testing.T) {
	credential := deviceFixtureCredential()
	runtime, pipe, messages := newFixtureRuntime(t)
	presenceOnly := make(chan struct{}, 1)
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
		if r.Header.Get(desktopExecutionHeader) == "" {
			if sendDeviceReady(ctx, socket, credential.DeviceID) != nil {
				return
			}
			select {
			case presenceOnly <- struct{}{}:
			default:
			}
		} else if sendDeviceExecutionReady(ctx, socket, credential.DeviceID, "30000000-0000-4000-8000-000000000004") != nil {
			return
		}
		for {
			_, data, err := socket.Read(ctx)
			if err != nil {
				return
			}
			if string(data) == `{"type":"ping"}` {
				if socket.Write(ctx, websocket.MessageText, []byte(`{"type":"pong"}`)) != nil {
					return
				}
			}
		}
	}))
	defer server.Close()
	origin, _ := url.Parse(server.URL)
	connection := newFixtureDeviceConnection(t, origin, credential)
	connection.runtime = runtime
	go connection.run()
	defer func() {
		connection.cancel()
		waitDeviceDone(t, connection)
	}()
	waitDeviceStatus(t, connection, func(status DeviceConnectionStatus) bool {
		return status.State == DeviceOnline && status.ExecutionReady
	})
	select {
	case <-messages:
	case <-time.After(5 * time.Second):
		t.Fatal("the runtime link was not opened")
	}
	// The supervisor withdraws the pipe before its done channel closes, exactly
	// like a stopped runtime generation.
	runtime.ready.Store(false)
	runtime.pipe.Store(nil)
	close(pipe.done)
	select {
	case <-presenceOnly:
	case <-time.After(5 * time.Second):
		t.Fatal("the device did not reconnect without execution after runtime loss")
	}
	waitDeviceStatus(t, connection, func(status DeviceConnectionStatus) bool {
		return status.State == DeviceOnline && !status.ExecutionReady
	})
}

func TestDeviceConnectionIsBoundToTheVerifiedAccountLease(t *testing.T) {
	credential := deviceFixtureCredential()
	account, lease := deviceFixtureAccount(credential)
	connection := newDeviceConnection(nil, credential, account, lease)
	if !connection.authorized() {
		t.Fatal("the verified account did not authorize its connection")
	}
	account.set("50000000-0000-4000-8000-000000000002", time.Now().Add(time.Hour))
	if connection.authorized() {
		t.Fatal("an account switch kept the previous account's connection authorized")
	}
	account.clear()
	if connection.authorized() {
		t.Fatal("a signed-out connection stayed authorized")
	}
	account.set(credential.OwnerID, time.Now().Add(time.Hour))
	if connection.authorized() {
		t.Fatal("a new sign-in of the same account revived the old connection generation")
	}
	next, err := requireAccount(account)
	if err != nil {
		t.Fatal(err)
	}
	connection.lease = next
	if !connection.authorized() {
		t.Fatal("the new same-account session did not authorize a fresh connection")
	}
	account.set(credential.OwnerID, time.Now().Add(20*time.Millisecond))
	next, err = requireAccount(account)
	if err != nil {
		t.Fatal(err)
	}
	connection.lease = next
	time.Sleep(40 * time.Millisecond)
	if connection.authorized() {
		t.Fatal("an expired native session stayed authorized")
	}
}

func TestDeviceConnectionStatusHidesExecutionReadinessAfterLoss(t *testing.T) {
	t.Run("account invalidation", func(t *testing.T) {
		credential := deviceFixtureCredential()
		account, lease := deviceFixtureAccount(credential)
		runtime, pipe, _ := newFixtureRuntime(t)
		connection := newDeviceConnection(nil, credential, account, lease)
		connection.runtime = runtime
		connection.link.Store(&runtimeLink{pipe: pipe, frames: make(chan json.RawMessage)})
		connection.setOnline(true)
		if !connection.Status().ExecutionReady {
			t.Fatal("the live runtime link was not reported as ready")
		}
		account.clear()
		if connection.Status().ExecutionReady {
			t.Fatal("an invalidated account kept reporting execution readiness")
		}
	})
	t.Run("runtime generation loss", func(t *testing.T) {
		credential := deviceFixtureCredential()
		account, lease := deviceFixtureAccount(credential)
		runtime, pipe, _ := newFixtureRuntime(t)
		connection := newDeviceConnection(nil, credential, account, lease)
		connection.runtime = runtime
		connection.link.Store(&runtimeLink{pipe: pipe, frames: make(chan json.RawMessage)})
		connection.setOnline(true)
		close(pipe.done)
		if connection.Status().ExecutionReady {
			t.Fatal("a stopped runtime generation kept reporting execution readiness")
		}
	})
}

func TestDeviceConnectionStatusExecutionReadinessIsNeverClaimedByFalse(t *testing.T) {
	// MyGo encodes IPC replies with encoding/json/v2 (mygo ipc.go), whose
	// omitempty still emits false for a bool. Older hosts may omit the field.
	// Both mean "not execution ready"; only true may claim readiness.
	presence, err := jsonv2.Marshal(DeviceConnectionStatus{State: DeviceOnline})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(presence), `"executionReady":true`) {
		t.Fatalf("a presence-only status claimed execution readiness: %s", presence)
	}
	for _, raw := range []string{`{"state":"online"}`, string(presence)} {
		var status DeviceConnectionStatus
		if err := jsonv2.Unmarshal([]byte(raw), &status); err != nil || status.ExecutionReady {
			t.Fatalf("readiness was not false or absent: %s", raw)
		}
	}
	execution, err := jsonv2.Marshal(DeviceConnectionStatus{State: DeviceOnline, ExecutionReady: true})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(execution), `"executionReady":true`) {
		t.Fatalf("an execution-attached status omitted its readiness: %s", execution)
	}
}

func TestDeviceBridgeKeepsTurnsOnTheCurrentExecutionLink(t *testing.T) {
	credential := deviceFixtureCredential()
	const (
		connectionID = "30000000-0000-4000-8000-000000000005"
		commandID    = "90000000-0000-4000-8000-000000000001"
		conversation = "40000000-0000-4000-8000-000000000001"
		generation   = "50000000-0000-4000-8000-000000000001"
		turnID       = "60000000-0000-4000-8000-000000000001"
	)
	command := `{"type":"command","id":"` + commandID + `","owner_id":"` + credential.OwnerID +
		`","conversation_id":"` + conversation + `","runtime_generation":"` + generation +
		`","turn_id":"` + turnID + `","expires_at":"2030-01-01T00:00:00Z","operation":"turn.inspect"}`
	result := `{"type":"command.result","id":"` + commandID + `","ok":true,"operation":"turn.inspect","result":null}`
	runtime, pipe, messages := newFixtureRuntime(t)
	resultSeen := make(chan struct{})
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
		if err := sendDeviceExecutionReady(ctx, socket, credential.DeviceID, connectionID); err != nil {
			return
		}
		if err := socket.Write(ctx, websocket.MessageText, []byte(command)); err != nil {
			return
		}
		for {
			_, data, err := socket.Read(ctx)
			if err != nil {
				return
			}
			if string(data) == result {
				close(resultSeen)
			}
		}
	}))
	defer server.Close()
	origin, _ := url.Parse(server.URL)
	connection := newFixtureDeviceConnection(t, origin, credential)
	connection.runtime = runtime
	go connection.run()
	defer func() {
		connection.cancel()
		waitDeviceDone(t, connection)
	}()
	waitDeviceStatus(t, connection, func(status DeviceConnectionStatus) bool {
		return status.State == DeviceOnline && status.ExecutionReady
	})
	var opened, forwarded runtimePipeMessage
	for _, message := range []*runtimePipeMessage{&opened, &forwarded} {
		select {
		case *message = <-messages:
		case <-time.After(5 * time.Second):
			t.Fatal("the current execution link did not receive the bridge frames")
		}
	}
	if opened.Type != "link.open" || opened.LinkID != connectionID || opened.OwnerID != credential.OwnerID {
		t.Fatalf("unexpected runtime link: %+v", opened)
	}
	if forwarded.Type != "link.frame" || forwarded.LinkID != connectionID || string(forwarded.Frame) != command {
		t.Fatalf("the current connection did not forward its turn: %+v", forwarded)
	}
	wrapped, err := json.Marshal(runtimePipeMessage{Type: "link.frame", LinkID: connectionID, Frame: json.RawMessage(result)})
	if err != nil {
		t.Fatal(err)
	}
	if !pipe.deliver(string(wrapped)) {
		t.Fatal("the runtime result was not admitted for the current link")
	}
	select {
	case <-resultSeen:
	case <-time.After(5 * time.Second):
		t.Fatal("the current connection did not return the turn result")
	}
}

func pairingTestDesktop(t *testing.T, store credentialStore) (*Desktop, *url.URL) {
	t.Helper()
	server, err := parseServerURL("https://pairing.example.test")
	if err != nil {
		t.Fatal(err)
	}
	return &Desktop{server: server, session: &sessionTransport{store: store}}, server
}

func TestPairingResponseAfterAccountInvalidationKeepsThePreviousCredential(t *testing.T) {
	const otherOwner = "50000000-0000-4000-8000-000000000002"
	credential := deviceFixtureCredential()
	previousCredential := deviceCredential{
		Token: strings.Repeat("b", 64), OwnerID: credential.OwnerID,
		DeviceID: "20000000-0000-4000-8000-000000000009", Name: "Previous laptop",
	}
	for _, test := range []struct {
		name       string
		invalidate func(*Desktop)
	}{
		{"same account signs in again", func(d *Desktop) {
			d.account.clear()
			d.account.set(credential.OwnerID, time.Now().Add(time.Hour))
		}},
		{"account switch", func(d *Desktop) {
			d.account.set(otherOwner, time.Now().Add(time.Hour))
		}},
		{"sign-out intent before account clear", func(d *Desktop) {
			d.session.signOutPending.Store(true)
		}},
		{"session expiry", func(d *Desktop) {
			d.account.set(credential.OwnerID, time.Now().Add(20*time.Millisecond))
			time.Sleep(40 * time.Millisecond)
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := &memoryCredentialStore{}
			desktop, server := pairingTestDesktop(t, store)
			desktop.account.set(credential.OwnerID, time.Now().Add(time.Hour))
			lease, err := requireAccount(&desktop.account)
			if err != nil {
				t.Fatal(err)
			}
			previous, err := json.Marshal(previousCredential)
			if err != nil {
				t.Fatal(err)
			}
			key := serverCredentialKey(server, "device")
			if err := store.Set(key, previous); err != nil {
				t.Fatal(err)
			}
			// The pairing response is deliberately stalled until after the
			// native principal that requested it has been invalidated.
			test.invalidate(desktop)
			if _, err := desktop.storePairedDevice(credential, lease); !errors.Is(err, errAccountRequired) {
				t.Fatalf("stale pairing response returned %v, want AUTH_REQUIRED", err)
			}
			got, err := store.Get(key)
			if err != nil || !bytes.Equal(got, previous) {
				t.Fatalf("the previous pairing was overwritten: err=%v bytes=%q", err, got)
			}
		})
	}
}

func TestPairingWriteInvalidatedWhileTheCredentialStoreBlocksKeepsPreviousBytes(t *testing.T) {
	credential := deviceFixtureCredential()
	previousCredential := deviceCredential{
		Token: strings.Repeat("b", 64), OwnerID: credential.OwnerID,
		DeviceID: "20000000-0000-4000-8000-000000000009", Name: "Previous laptop",
	}
	for _, test := range []struct {
		name string
		seed bool
	}{
		{"previous pairing restored", true},
		{"empty state restored", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := &memoryCredentialStore{}
			var previous []byte
			var err error
			if test.seed {
				previous, err = json.Marshal(previousCredential)
				if err != nil {
					t.Fatal(err)
				}
			}
			desktop, server := pairingTestDesktop(t, store)
			key := serverCredentialKey(server, "device")
			if test.seed {
				if err := store.Set(key, previous); err != nil {
					t.Fatal(err)
				}
			}
			blocking := &blockingCredentialStore{
				memoryCredentialStore: store, started: make(chan struct{}), release: make(chan struct{}),
			}
			blocking.arm()
			desktop.session.store = blocking
			desktop.account.set(credential.OwnerID, time.Now().Add(time.Hour))
			lease, err := requireAccount(&desktop.account)
			if err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() {
				_, err := desktop.storePairedDevice(credential, lease)
				done <- err
			}()
			select {
			case <-blocking.started:
			case <-time.After(5 * time.Second):
				t.Fatal("the pairing write did not reach the credential store")
			}
			// The lease is lost while the credential store is writing.
			desktop.account.clear()
			close(blocking.release)
			select {
			case err := <-done:
				if !errors.Is(err, errAccountRequired) {
					t.Fatalf("blocked pairing returned %v, want AUTH_REQUIRED", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("the pairing write did not finish")
			}
			got, err := store.Get(key)
			if test.seed {
				if err != nil || !bytes.Equal(got, previous) {
					t.Fatalf("the previous pairing bytes were not restored: err=%v bytes=%q", err, got)
				}
			} else if !errors.Is(err, mygo.ErrSecretNotFound) {
				t.Fatalf("an invalidated first pairing left bytes behind: err=%v bytes=%q", err, got)
			}
		})
	}
}

func TestAccountInvalidationDoesNotCancelANewerValidDeviceGeneration(t *testing.T) {
	credential := deviceFixtureCredential()
	other := deviceFixtureCredential()
	other.OwnerID = "50000000-0000-4000-8000-000000000002"
	other.DeviceID = "20000000-0000-4000-8000-000000000002"
	server, err := parseServerURL("https://device.example.test")
	if err != nil {
		t.Fatal(err)
	}
	desktop := &Desktop{server: server}
	desktop.account.set(credential.OwnerID, time.Now().Add(time.Hour))
	oldLease, err := requireAccount(&desktop.account)
	if err != nil {
		t.Fatal(err)
	}
	oldConnection := newDeviceConnection(server, credential, &desktop.account, oldLease)
	desktop.device = oldConnection
	// The switch publishes a new generation, and a resume for it replaces the
	// current device before the older invalidation callback runs.
	desktop.account.set(other.OwnerID, time.Now().Add(time.Hour))
	newLease, err := requireAccount(&desktop.account)
	if err != nil {
		t.Fatal(err)
	}
	newConnection := newDeviceConnection(server, other, &desktop.account, newLease)
	desktop.device = newConnection
	desktop.clearInvalidatedDevice()
	if newConnection.ctx.Err() != nil {
		t.Fatal("the invalidation callback cancelled a valid newer generation")
	}
	// A genuine loss of that generation still cancels it.
	desktop.account.clear()
	desktop.clearInvalidatedDevice()
	if newConnection.ctx.Err() == nil {
		t.Fatal("the invalidated connection was not cancelled")
	}
}

func TestDesktopExchangeInvalidatesThePreviousDeviceConnection(t *testing.T) {
	store := &memoryCredentialStore{}
	desktop := &Desktop{}
	server, err := parseServerURL("https://exchange.example.test")
	if err != nil {
		t.Fatal(err)
	}
	desktop.configure(server, store, t.TempDir())
	credential := deviceFixtureCredential()
	desktop.account.set(credential.OwnerID, time.Now().Add(time.Hour))
	lease, err := requireAccount(&desktop.account)
	if err != nil {
		t.Fatal(err)
	}
	connection := newDeviceConnection(server, credential, &desktop.account, lease)
	desktop.device = connection
	desktop.session.base = roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Path != desktopLoginExchangePath {
			t.Errorf("unexpected exchange path: %s", request.URL.Path)
		}
		return &http.Response{
			StatusCode: http.StatusNoContent,
			Header: http.Header{
				"X-Linksense-Desktop-Protocol": {"1"},
				"Set-Cookie": {(&http.Cookie{
					Name: refreshCookieName, Value: strings.Repeat("a", 64),
					Path: "/api/v1/auth", HttpOnly: true, MaxAge: 3600, Secure: true,
				}).String()},
			},
			Body: http.NoBody,
		}, nil
	})
	if err := exchangeDesktopCode(context.Background(), server, desktop.session,
		strings.Repeat("c", 43), strings.Repeat("v", 43)); err != nil {
		t.Fatal(err)
	}
	if _, ok := desktop.account.current(); ok {
		t.Fatal("the desktop exchange kept the previous account")
	}
	if connection.ctx.Err() == nil {
		t.Fatal("the desktop exchange left the previous device connection running")
	}
}

func TestDeviceConnectionCancelsWhenTheLeaseIsLostWhileIdle(t *testing.T) {
	credential := deviceFixtureCredential()
	const connectionID = "30000000-0000-4000-8000-000000000006"
	account, lease := deviceFixtureAccount(credential)
	runtime, pipe, messages := newFixtureRuntime(t)
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
		if err := sendDeviceExecutionReady(ctx, socket, credential.DeviceID, connectionID); err != nil {
			return
		}
		for {
			if _, _, err := socket.Read(ctx); err != nil {
				return
			}
		}
	}))
	defer server.Close()
	origin, _ := url.Parse(server.URL)
	connection := newDeviceConnection(origin, credential, account, lease)
	connection.runtime = runtime
	go connection.run()
	defer func() {
		connection.cancel()
		waitDeviceDone(t, connection)
	}()
	waitDeviceStatus(t, connection, func(status DeviceConnectionStatus) bool {
		return status.State == DeviceOnline && status.ExecutionReady
	})
	select {
	case <-messages:
	case <-time.After(5 * time.Second):
		t.Fatal("the runtime link was not opened")
	}
	account.clear()
	// Wake the idle keepalive with a runtime frame so it reaches its next
	// authorization check without waiting for the heartbeat interval.
	wrapped, err := json.Marshal(runtimePipeMessage{
		Type: "link.frame", LinkID: connectionID,
		Frame: json.RawMessage(`{"type":"command.result","id":"90000000-0000-4000-8000-000000000003","ok":true,"operation":"turn.inspect","result":null}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !pipe.deliver(string(wrapped)) {
		t.Fatal("the runtime frame was not admitted")
	}
	select {
	case <-connection.done:
	case <-time.After(5 * time.Second):
		t.Fatal("a lost lease did not cancel the idle connection")
	}
	if connection.ctx.Err() == nil {
		t.Fatal("the connection reported completion without being cancelled")
	}
	// Once the account lease is gone the status derivation is unpaired; no
	// stale offline id/name/state is published for the invalidated session.
	waitDeviceStatus(t, connection, func(status DeviceConnectionStatus) bool {
		return status.State == DeviceUnpaired && !status.ExecutionReady
	})
}

func TestDeviceConnectionDoesNotForwardACommandAfterLeaseLoss(t *testing.T) {
	credential := deviceFixtureCredential()
	const connectionID = "30000000-0000-4000-8000-000000000007"
	account, lease := deviceFixtureAccount(credential)
	command := `{"type":"command","id":"90000000-0000-4000-8000-000000000004","owner_id":"` + credential.OwnerID +
		`","conversation_id":"40000000-0000-4000-8000-000000000001","runtime_generation":"50000000-0000-4000-8000-000000000001",` +
		`"turn_id":"60000000-0000-4000-8000-000000000001","expires_at":"2030-01-01T00:00:00Z","operation":"turn.inspect"}`
	sendCommand := make(chan struct{})
	runtime, _, messages := newFixtureRuntime(t)
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
		if err := sendDeviceExecutionReady(ctx, socket, credential.DeviceID, connectionID); err != nil {
			return
		}
		select {
		case <-sendCommand:
		case <-ctx.Done():
			return
		}
		if socket.Write(ctx, websocket.MessageText, []byte(command)) != nil {
			return
		}
		for {
			if _, _, err := socket.Read(ctx); err != nil {
				return
			}
		}
	}))
	defer server.Close()
	origin, _ := url.Parse(server.URL)
	connection := newDeviceConnection(origin, credential, account, lease)
	connection.runtime = runtime
	go connection.run()
	defer func() {
		connection.cancel()
		waitDeviceDone(t, connection)
	}()
	waitDeviceStatus(t, connection, func(status DeviceConnectionStatus) bool {
		return status.State == DeviceOnline && status.ExecutionReady
	})
	select {
	case <-messages:
	case <-time.After(5 * time.Second):
		t.Fatal("the runtime link was not opened")
	}
	account.clear()
	close(sendCommand)
	select {
	case <-connection.done:
	case <-time.After(5 * time.Second):
		t.Fatal("the lease loss did not stop the connection")
	}
	// Only link.close may follow; the command must never reach the runtime.
	deadline := time.After(500 * time.Millisecond)
	for {
		select {
		case message := <-messages:
			if message.Type == "link.frame" {
				t.Fatalf("a command was forwarded after the lease was lost: %+v", message)
			}
		case <-deadline:
			return
		}
	}
}

func drainRuntimeWrites(t *testing.T, pipe *runtimePipe, messages <-chan runtimePipeMessage, forbidden string) {
	t.Helper()
	// Closing the writer lets the fixture reader reach EOF, so every admitted
	// frame is delivered before the assertion.
	_ = pipe.input.Close()
	for message := range messages {
		if message.Type == forbidden {
			t.Fatalf("a stale runtime write was admitted: %+v", message)
		}
	}
}

func TestRuntimeLinkAdmissionFencesAccountLossAtOpen(t *testing.T) {
	credential := deviceFixtureCredential()
	const linkID = "30000000-0000-4000-8000-000000000008"
	for _, test := range []struct {
		name       string
		invalidate func(*workspaceAccount, *atomic.Bool)
	}{
		{"account switch", func(account *workspaceAccount, _ *atomic.Bool) {
			account.set("50000000-0000-4000-8000-000000000002", time.Now().Add(time.Hour))
		}},
		{"sign-out intent", func(_ *workspaceAccount, signOut *atomic.Bool) {
			signOut.Store(true)
		}},
		{"account cleared", func(account *workspaceAccount, _ *atomic.Bool) {
			account.clear()
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			account, lease := deviceFixtureAccount(credential)
			signOut := &atomic.Bool{}
			connection := newDeviceConnection(nil, credential, account, lease)
			connection.signOut = signOut
			runtime, pipe, messages := newFixtureRuntime(t)
			pipe.mu.Lock()
			type attachResult struct {
				link *runtimeLink
				err  error
			}
			started := make(chan struct{})
			results := make(chan attachResult, 1)
			go func() {
				close(started)
				link, err := runtime.attach(linkID, credential.OwnerID, nil, nil, nil, nil,
					connection.runtimeWriteAdmission(connection.ctx))
				results <- attachResult{link, err}
			}()
			<-started
			// Invalidate while the open waits for pipe.mu; the admission must
			// revalidate after that wait, not rely on the pre-attach check.
			test.invalidate(account, signOut)
			pipe.mu.Unlock()
			attached := <-results
			if attached.link != nil || !errors.Is(attached.err, errAccountRequired) {
				t.Fatalf("a stale link.open was admitted: link=%v err=%v", attached.link, attached.err)
			}
			if pipe.link.Load() != nil {
				t.Fatal("a stale link was published")
			}
			drainRuntimeWrites(t, pipe, messages, "link.open")
		})
	}
}

func TestRuntimeLinkAdmissionFencesAccountLossAtSend(t *testing.T) {
	credential := deviceFixtureCredential()
	const linkID = "30000000-0000-4000-8000-000000000009"
	command := `{"type":"command","id":"90000000-0000-4000-8000-000000000005","owner_id":"` + credential.OwnerID +
		`","conversation_id":"40000000-0000-4000-8000-000000000001","runtime_generation":"50000000-0000-4000-8000-000000000001",` +
		`"turn_id":"60000000-0000-4000-8000-000000000001","expires_at":"2030-01-01T00:00:00Z","operation":"turn.inspect"}`
	for _, test := range []struct {
		name       string
		invalidate func(*workspaceAccount, *atomic.Bool)
	}{
		{"account switch", func(account *workspaceAccount, _ *atomic.Bool) {
			account.set("50000000-0000-4000-8000-000000000002", time.Now().Add(time.Hour))
		}},
		{"sign-out intent", func(_ *workspaceAccount, signOut *atomic.Bool) {
			signOut.Store(true)
		}},
		{"account cleared", func(account *workspaceAccount, _ *atomic.Bool) {
			account.clear()
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			account, lease := deviceFixtureAccount(credential)
			signOut := &atomic.Bool{}
			connection := newDeviceConnection(nil, credential, account, lease)
			connection.signOut = signOut
			runtime, pipe, messages := newFixtureRuntime(t)
			link, err := runtime.attach(linkID, credential.OwnerID, nil, nil, nil, nil,
				connection.runtimeWriteAdmission(connection.ctx))
			if err != nil {
				t.Fatal(err)
			}
			select {
			case message := <-messages:
				if message.Type != "link.open" {
					t.Fatalf("unexpected runtime write: %+v", message)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("link.open was not written")
			}
			pipe.mu.Lock()
			started := make(chan struct{})
			done := make(chan error, 1)
			go func() {
				close(started)
				done <- link.send(json.RawMessage(command))
			}()
			<-started
			// Invalidate while the command waits for pipe.mu. The pre-send check
			// already passed; admission must revalidate under the pipe lock.
			test.invalidate(account, signOut)
			pipe.mu.Unlock()
			if err := <-done; !errors.Is(err, errAccountRequired) {
				t.Fatalf("a stale command was admitted: %v", err)
			}
			drainRuntimeWrites(t, pipe, messages, "link.frame")
		})
	}
}

func TestRuntimeLinkAdmissionRejectsAStaleRuntimeGeneration(t *testing.T) {
	credential := deviceFixtureCredential()
	const linkID = "30000000-0000-4000-8000-000000000010"
	for _, test := range []struct {
		name   string
		change func(*runtimeSupervisor, *runtimePipe, *os.File)
	}{
		{"not ready", func(runtime *runtimeSupervisor, _ *runtimePipe, _ *os.File) {
			runtime.ready.Store(false)
		}},
		{"pipe replaced", func(runtime *runtimeSupervisor, _ *runtimePipe, writer *os.File) {
			replacement := &runtimePipe{input: writer, done: make(chan struct{})}
			runtime.pipe.Store(replacement)
		}},
		{"pipe stopped", func(runtime *runtimeSupervisor, pipe *runtimePipe, _ *os.File) {
			close(pipe.done)
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			account, lease := deviceFixtureAccount(credential)
			connection := newDeviceConnection(nil, credential, account, lease)
			runtime, pipe, messages := newFixtureRuntime(t)
			link, err := runtime.attach(linkID, credential.OwnerID, nil, nil, nil, nil,
				connection.runtimeWriteAdmission(connection.ctx))
			if err != nil {
				t.Fatal(err)
			}
			select {
			case <-messages:
			case <-time.After(5 * time.Second):
				t.Fatal("link.open was not written")
			}
			duplicate, duplicateWriter, err := os.Pipe()
			if err != nil {
				t.Fatal(err)
			}
			defer duplicate.Close()
			defer duplicateWriter.Close()
			test.change(runtime, pipe, duplicateWriter)
			if err := link.send(json.RawMessage(`{"type":"command","id":"90000000-0000-4000-8000-000000000006"}`)); err == nil || errors.Is(err, errAccountRequired) {
				t.Fatalf("a stale runtime generation admitted a frame: %v", err)
			}
			if err := link.send(json.RawMessage(`{"type":"command","id":"90000000-0000-4000-8000-000000000007"}`)); err == nil {
				t.Fatal("a stale runtime generation admitted a repeated frame")
			}
		})
	}
}

type setFailingCredentialStore struct {
	*memoryCredentialStore
}

func (s setFailingCredentialStore) Set(string, []byte) error {
	return errors.New("credential store write failed")
}

func TestPairingStoreFailureKeepsThePreviousCredential(t *testing.T) {
	credential := deviceFixtureCredential()
	previousCredential := deviceCredential{
		Token: strings.Repeat("b", 64), OwnerID: credential.OwnerID,
		DeviceID: "20000000-0000-4000-8000-000000000009", Name: "Previous laptop",
	}
	store := &memoryCredentialStore{}
	desktop, server := pairingTestDesktop(t, store)
	desktop.account.set(credential.OwnerID, time.Now().Add(time.Hour))
	lease, err := requireAccount(&desktop.account)
	if err != nil {
		t.Fatal(err)
	}
	previous, err := json.Marshal(previousCredential)
	if err != nil {
		t.Fatal(err)
	}
	key := serverCredentialKey(server, "device")
	if err := store.Set(key, previous); err != nil {
		t.Fatal(err)
	}
	desktop.session.store = setFailingCredentialStore{memoryCredentialStore: store}
	rollback, err := desktop.storePairedDevice(credential, lease)
	if rollback != nil || err == nil || err.Error() != "DESKTOP_CREDENTIAL_STORE_UNAVAILABLE" {
		t.Fatalf("store failure was not reported without a rollback: rollback=%v err=%v", rollback != nil, err)
	}
	got, err := store.Get(key)
	if err != nil || !bytes.Equal(got, previous) {
		t.Fatalf("a failed store write changed the previous pairing: err=%v bytes=%q", err, got)
	}
}

func TestPairingPublicationRollsBackWhenTheAccountChangesDuringBridgeReplacement(t *testing.T) {
	credential := deviceFixtureCredential()
	previousCredential := deviceCredential{
		Token: strings.Repeat("b", 64), OwnerID: credential.OwnerID,
		DeviceID: "20000000-0000-4000-8000-000000000009", Name: "Previous laptop",
	}
	store := &memoryCredentialStore{}
	desktop, server := pairingTestDesktop(t, store)
	desktop.account.set(credential.OwnerID, time.Now().Add(time.Hour))
	lease, err := requireAccount(&desktop.account)
	if err != nil {
		t.Fatal(err)
	}
	previous, err := json.Marshal(previousCredential)
	if err != nil {
		t.Fatal(err)
	}
	key := serverCredentialKey(server, "device")
	if err := store.Set(key, previous); err != nil {
		t.Fatal(err)
	}
	rollback, err := desktop.storePairedDevice(credential, lease)
	if err != nil {
		t.Fatal(err)
	}
	// A previous bridge whose cancellation and completion the test controls:
	// connectDevice blocks on it while replacing the device.
	cancelled := make(chan struct{})
	oldContext, oldCancel := context.WithCancel(context.Background())
	old := &deviceConnection{
		ctx: oldContext, done: make(chan struct{}),
		cancel: func() {
			close(cancelled)
			oldCancel()
		},
	}
	desktop.device = old
	done := make(chan error, 1)
	go func() {
		_, err := desktop.completePairing(credential, lease, rollback)
		done <- err
	}()
	select {
	case <-cancelled:
	case <-time.After(5 * time.Second):
		t.Fatal("the pairing replacement did not reach the old bridge close")
	}
	// The account changes while connectDevice waits for the old bridge.
	desktop.account.clear()
	close(old.done)
	select {
	case err := <-done:
		if !errors.Is(err, errAccountRequired) {
			t.Fatalf("replacement during invalidation returned %v, want AUTH_REQUIRED", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the pairing replacement did not finish")
	}
	got, err := store.Get(key)
	if err != nil || !bytes.Equal(got, previous) {
		t.Fatalf("the previous pairing bytes were not rolled back: err=%v bytes=%q", err, got)
	}
	if desktop.device != nil {
		t.Fatal("a connection for the invalidated pairing stayed attached")
	}
}

func TestDeviceConnectionStatusNeverPublishesAStaleAccountAfterInvalidation(t *testing.T) {
	credential := deviceFixtureCredential()
	account, lease := deviceFixtureAccount(credential)
	connection := newDeviceConnection(nil, credential, account, lease)
	connection.setOnline(false)
	// Hold the status lock so the reader must wait, then invalidate before it
	// can take its snapshot. This is the DeviceStatus/resume fast-path window.
	connection.mu.Lock()
	started := make(chan struct{})
	statuses := make(chan DeviceConnectionStatus, 1)
	go func() {
		close(started)
		statuses <- connection.Status()
	}()
	<-started
	account.clear()
	connection.mu.Unlock()
	status := <-statuses
	if status.State != DeviceUnpaired || status.DeviceID != "" || status.Name != "" || status.ErrorCode != "" {
		t.Fatalf("a stale invalidated status was published: %+v", status)
	}

	// A valid account keeps the intended state, including a server revocation.
	otherAccount, otherLease := deviceFixtureAccount(credential)
	revoked := newDeviceConnection(nil, credential, otherAccount, otherLease)
	revoked.setStatus(DeviceRevoked, "AUTH_REQUIRED")
	status = revoked.Status()
	if status.State != DeviceRevoked || status.ErrorCode != "AUTH_REQUIRED" ||
		status.DeviceID != credential.DeviceID || status.Name != credential.Name {
		t.Fatalf("the intended revoked status was lost: %+v", status)
	}
}

func TestDeviceConnectionStatusClearsExecutionReadyWhenCanceled(t *testing.T) {
	credential := deviceFixtureCredential()
	account, lease := deviceFixtureAccount(credential)
	runtime, pipe, _ := newFixtureRuntime(t)
	connection := newDeviceConnection(nil, credential, account, lease)
	connection.runtime = runtime
	connection.link.Store(&runtimeLink{pipe: pipe, frames: make(chan json.RawMessage)})
	connection.setOnline(true)
	live := connection.Status()
	if live.State != DeviceOnline || !live.ExecutionReady || live.DeviceID != credential.DeviceID {
		t.Fatalf("a live execution connection was not ready: %+v", live)
	}
	connection.cancel()
	status := connection.Status()
	if status.ExecutionReady {
		t.Fatalf("a canceled connection reported execution readiness: %+v", status)
	}
	// The same valid account keeps its state; only readiness fails closed.
	if status.State != DeviceOnline || status.DeviceID != credential.DeviceID || status.Name != credential.Name {
		t.Fatalf("cancellation changed the valid account status: %+v", status)
	}
}
