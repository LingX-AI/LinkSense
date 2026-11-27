//go:build darwin

package main

// Positive status is a native acknowledgement of one exact selection
// generation, never a driver permission claim. These tests use the existing
// fixture platform/driver seam and the native wire; no real window, AX call,
// permission request, driver process, or GUI is touched.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func statusAttestationRequest(expiresAt time.Time) string {
	return fmt.Sprintf(`{"kind":"status","selection_expires_at":%q}`, expiresAt.UTC().Format(time.RFC3339Nano))
}

// The real Darwin executor, driven through the existing fake agent-desktop CLI,
// can publish positive only for the exact current selection expiry. The legacy
// command remains false, and a stale expiry produces no positive result.
func TestComputerExecutorPositiveStatusRequiresExactNativeSelection(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	credential := deviceFixtureCredential()
	selection := fixtureComputerSelection(credential)
	executor := newTestComputerExecutor(t, runtimeRoot, selection)
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		StatusData:      fakeStatusData(computerConcreteDriver(t, executor).sessionID, computerConcreteDriver(t, executor).stateRoot, "granted"),
		PermissionsData: fakePermissions("granted"),
	})
	gate := &computerExecutorGate{}
	gate.install(executor)
	host := newM1BComputerHost(gate)
	server, sockets := newComputerFixtureServer(t, credential, fixtureReadyOperations, []string{fixtureLink}, true)
	run := startComputerFixture(t, server, sockets, credential, host)

	positive := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000601", selection, "", true,
		statusAttestationRequest(selection.ExpiresAt))
	kind, status := typedComputerFrame(t, positive)
	if kind != "status" || status["active_grant"] != true || status["available"] != true {
		t.Fatalf("the exact native selection did not attest positive: %+v", positive)
	}
	assertComputerStatusWire(t, status)

	legacy := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000602", selection, "", true,
		`{"kind":"status"}`)
	kind, status = typedComputerFrame(t, legacy)
	if kind != "status" || status["active_grant"] != false {
		t.Fatalf("legacy status did not stay informational false: %+v", legacy)
	}
	assertComputerStatusWire(t, status)

	const staleID = "90000000-0000-4000-8000-000000000603"
	staleExpiry := selection.ExpiresAt.Add(time.Minute)
	if err := run.socket.send([]byte(computerCommandJSON(staleID, selection, "", true,
		"2030-01-01T00:00:00Z", statusAttestationRequest(staleExpiry)))); err != nil {
		t.Fatal(err)
	}
	expectNoComputerResults(t, run.socket, []string{staleID}, 300*time.Millisecond)
}

// The host preserves the legacy false even when a fixture executor returns a
// positive driver status, acknowledges an exact positive only for the current
// expiry, and publishes nothing after a same-ID renewal while status is held.
func TestComputerHostPositiveStatusFencesRenewalAndExpiry(t *testing.T) {
	credential := deviceFixtureCredential()
	selection := fixtureComputerSelection(credential)
	fake := newFixtureComputerExecutor(selection)
	host := newM1BComputerHost(fake)
	server, sockets := newComputerFixtureServer(t, credential, fixtureReadyOperations, []string{fixtureLink}, true)
	run := startComputerFixture(t, server, sockets, credential, host)

	legacy := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000611", selection, "", true,
		`{"kind":"status"}`)
	kind, status := typedComputerFrame(t, legacy)
	if kind != "status" || status["active_grant"] != false {
		t.Fatalf("a fixture-only positive reached the legacy status wire: %+v", legacy)
	}

	// A fixture executor has no product gate evidence. Even its positive
	// driver status is only diagnostics with the boolean cleared.
	positive := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000612", selection, "", true,
		statusAttestationRequest(selection.ExpiresAt))
	kind, status = typedComputerFrame(t, positive)
	if kind != "status" || status["active_grant"] != false {
		t.Fatalf("a fixture-only attestation published positive: %+v", positive)
	}

	expired := selection
	expired.ExpiresAt = time.Now().Add(-time.Second)
	fake.selectTarget(expired)
	expiry := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000613", expired, "", true,
		statusAttestationRequest(expired.ExpiresAt))
	kind, status = typedComputerFrame(t, expiry)
	if kind == "status" && status["active_grant"] == true {
		t.Fatalf("an expired selection attested positive: %+v", expiry)
	}

	fake.selectTarget(selection)
	// Drain earlier status notifications so the hold is observed on its own call.
	for {
		select {
		case <-fake.statusStarted:
			continue
		default:
		}
		break
	}
	hold := make(chan struct{})
	fake.holdNextStatus(hold)
	const renewalID = "90000000-0000-4000-8000-000000000614"
	if err := run.socket.send([]byte(computerCommandJSON(renewalID, selection, "", true,
		"2030-01-01T00:00:00Z", statusAttestationRequest(selection.ExpiresAt)))); err != nil {
		t.Fatal(err)
	}
	select {
	case <-fake.statusStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("the positive status did not reach the held driver")
	}
	renewed := selection
	renewed.ExpiresAt = selection.ExpiresAt.Add(time.Minute)
	fake.selectTarget(renewed)
	close(hold)
	expectNoComputerResults(t, run.socket, []string{renewalID}, 300*time.Millisecond)
	waitComputerIdle(t, host)

	const staleAfterRenewalID = "90000000-0000-4000-8000-000000000615"
	if err := run.socket.send([]byte(computerCommandJSON(staleAfterRenewalID, selection, "", true,
		"2030-01-01T00:00:00Z", statusAttestationRequest(selection.ExpiresAt)))); err != nil {
		t.Fatal(err)
	}
	expectNoComputerResults(t, run.socket, []string{staleAfterRenewalID}, 300*time.Millisecond)

	legacyAfterRenewal := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000616", renewed, "", true,
		`{"kind":"status"}`)
	kind, status = typedComputerFrame(t, legacyAfterRenewal)
	if kind != "status" || status["active_grant"] != false {
		t.Fatalf("renewal changed the legacy informational status: %+v", legacyAfterRenewal)
	}
}

// The product gate admits positive status only while the exact acknowledged
// binding is current and input is open. A local pause/stop closes the same
// lifetime before the driver read, and a renewed expiry is a different exact
// generation.
func TestComputerGatePositiveStatusRequiresOpenExactSelection(t *testing.T) {
	selection := fixtureComputerSelection(deviceFixtureCredential())
	executor := &controlTestExecutor{binding: selection}
	gate := &computerExecutorGate{}
	gate.install(executor)

	openGrant, ok := gate.statusAttestationContext(selection)
	if !ok {
		t.Fatal("the open exact status exposed no admission grant")
	}
	open := gate.statusAttestation(context.Background(), selection, openGrant)
	if open.kind != "status" || !open.status.ActiveGrant {
		t.Fatalf("the open exact status was not positive: %+v", open)
	}
	direct := gate.statusAttestation(context.Background(), selection, context.Background())
	if direct.kind != "status" || direct.status.ActiveGrant {
		t.Fatalf("a direct read-only context authorized positive status: %+v", direct)
	}
	gate.closeInputIf(executor)
	closedGrant, ok := gate.statusAttestationContext(selection)
	if ok {
		t.Fatal("a paused selection exposed an admission grant")
	}
	closed := gate.statusAttestation(context.Background(), selection, closedGrant)
	if closed.kind != "status" || closed.status.ActiveGrant {
		t.Fatalf("a paused selection lost ordinary diagnostics or claimed positive: %+v", closed)
	}

	gate.resume(executor, selection)
	renewed := selection
	renewed.ExpiresAt = selection.ExpiresAt.Add(time.Minute)
	if err := gate.renew(executor, renewed); err != nil {
		t.Fatal(err)
	}
	stale := gate.statusAttestation(context.Background(), selection, openGrant)
	if stale.kind != "failure" || stale.failure != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("a stale expiry entered positive status: %+v", stale)
	}
	currentGrant, ok := gate.statusAttestationContext(renewed)
	if !ok {
		t.Fatal("the renewed exact status exposed no admission grant")
	}
	current := gate.statusAttestation(context.Background(), renewed, currentGrant)
	if current.kind != "status" || !current.status.ActiveGrant {
		t.Fatalf("the renewed exact status was not positive: %+v", current)
	}
}

// statusAdmissionGapExecutor makes the resume rebind observable before the
// gate installs the matching grant/open state. The binding is updated by the
// real selectHostSelection call, then held so a status dispatch can capture its
// transport-only admission context in that exact gap.
type statusAdmissionGapExecutor struct {
	*controlTestExecutor
	selectStarted chan struct{}
	selectRelease chan struct{}
	holdSelect    atomic.Bool
	statusCalls   atomic.Int32
}

func (executor *statusAdmissionGapExecutor) selectHostSelection(selection m1bComputerSelection) error {
	if err := executor.controlTestExecutor.selectHostSelection(selection); err != nil {
		return err
	}
	if executor.holdSelect.Load() {
		close(executor.selectStarted)
		<-executor.selectRelease
	}
	return nil
}

func (executor *statusAdmissionGapExecutor) status(context.Context, m1bComputerSelection) m1bComputerResult {
	executor.statusCalls.Add(1)
	return m1bComputerStatusResult(m1bComputerStatus{
		Available: true, Permissions: m1bComputerPermissions{Accessibility: "granted"},
	})
}

// A status admitted while the new/later grant is observable but not yet open
// captures no positive authority. When that grant opens before the held
// runInput enters the driver, the status must stay ordinary diagnostics false:
// the gate must not rediscover a grant that the work context and final write
// were never attached to. The same binding's later expiry is included so a
// replacement cannot inherit the old admission.
func TestComputerStatusPositiveUsesOnlyAdmissionGrant(t *testing.T) {
	for _, test := range []struct {
		name string
		next func(m1bComputerSelection) m1bComputerSelection
	}{
		{"new selection in the resume gap", func(old m1bComputerSelection) m1bComputerSelection {
			old.SelectionID = newComputerControlID()
			return old
		}},
		{"same binding replacement in the resume gap", func(old m1bComputerSelection) m1bComputerSelection {
			old.ExpiresAt = old.ExpiresAt.Add(time.Minute)
			return old
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			executor := &statusAdmissionGapExecutor{
				controlTestExecutor: &controlTestExecutor{},
				selectStarted:       make(chan struct{}),
				selectRelease:       make(chan struct{}),
			}
			h := newWaitPublicationHarness(t, executor)
			next := test.next(h.selection)
			gate := h.control.gate
			gate.closeInputIf(executor)
			executor.holdSelect.Store(true)

			resumeDone := make(chan error, 1)
			go func() { resumeDone <- gate.resume(executor, next) }()
			select {
			case <-executor.selectStarted:
			case <-time.After(5 * time.Second):
				t.Fatal("the resume rebind did not enter its gap")
			}

			var executableCalls atomic.Int32
			runInputEntered, runInputRelease := make(chan struct{}), make(chan struct{})
			h.link.live = func() bool {
				if executableCalls.Add(1) == 2 {
					close(runInputEntered)
					<-runInputRelease
				}
				return true
			}
			var positiveCandidate, writes atomic.Bool
			results := make(chan map[string]any, 1)
			h.link.write = func(_ context.Context, data []byte) error {
				writes.Store(true)
				if strings.Contains(string(data), `"active_grant":true`) {
					positiveCandidate.Store(true)
				}
				var frame map[string]any
				if err := json.Unmarshal(data, &frame); err != nil {
					return err
				}
				results <- frame
				return nil
			}
			h.link.computerStatus = true
			const statusID = "90000000-0000-4000-8000-000000000651"
			frame := computerCommandJSON(statusID, next, "", true,
				time.Now().Add(5*time.Minute).UTC().Format(time.RFC3339Nano),
				statusAttestationRequest(next.ExpiresAt))
			if !interceptM1BComputerFrame(h.link, []byte(frame)) {
				t.Fatal("the status frame was not consumed by the product host")
			}
			select {
			case <-runInputEntered:
			case <-time.After(5 * time.Second):
				t.Fatal("the status admission context was not captured before the grant opened")
			}
			if executor.statusCalls.Load() != 0 {
				t.Fatal("the status driver read entered during the admission gap")
			}

			executor.holdSelect.Store(false)
			close(executor.selectRelease)
			select {
			case err := <-resumeDone:
				if err != nil {
					t.Fatalf("the resume rebind failed: %v", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("the resume rebind did not install the grant")
			}
			close(runInputRelease)

			select {
			case result := <-results:
				kind, status := typedComputerFrame(t, result)
				if kind != "status" || status["active_grant"] != false {
					t.Fatalf("a later grant authorized the transport-only status: %+v", result)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("the transport-only status did not publish its diagnostics")
			}
			if positiveCandidate.Load() {
				t.Fatal("a positive candidate reached the existing writer seam")
			}
			if !writes.Load() {
				t.Fatal("the ordinary false diagnostics did not reach the writer")
			}
			if executor.statusCalls.Load() != 1 {
				t.Fatalf("the status read was repeated %d times", executor.statusCalls.Load())
			}
			waitPublicationDone(t, h.control.host)
		})
	}
}

// A command cancel closes the exact positive status before its held driver can
// publish. The read is not an act, so no uncertain result or replay is needed.
func TestComputerHostCancelSuppressesHeldPositiveStatus(t *testing.T) {
	credential := deviceFixtureCredential()
	selection := fixtureComputerSelection(credential)
	fake := newFixtureComputerExecutor(selection)
	host := newM1BComputerHost(fake)
	server, sockets := newComputerFixtureServer(t, credential, fixtureReadyOperations, []string{fixtureLink}, true)
	run := startComputerFixture(t, server, sockets, credential, host)

	hold := make(chan struct{})
	fake.holdNextStatus(hold)
	const statusID = "90000000-0000-4000-8000-000000000621"
	if err := run.socket.send([]byte(computerCommandJSON(statusID, selection, "", true,
		"2030-01-01T00:00:00Z", statusAttestationRequest(selection.ExpiresAt)))); err != nil {
		t.Fatal(err)
	}
	select {
	case <-fake.statusStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("the positive status did not reach the held driver")
	}
	if err := run.socket.send([]byte(`{"type":"command.cancel","id":"` + statusID + `"}`)); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		host.mu.Lock()
		work := host.commands[m1bComputerCommandKey(statusID)]
		canceled := work != nil && work.canceled
		host.mu.Unlock()
		if canceled {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the command cancel was not applied")
		}
		time.Sleep(5 * time.Millisecond)
	}
	close(hold)
	expectNoComputerResults(t, run.socket, []string{statusID}, 300*time.Millisecond)
	waitComputerIdle(t, host)
}

// The additive status marker is a separate HTTP offer, echoed only on the exact
// ready frame. It is deliberately absent from the strict tool list that the
// runtime link forwards to the Runner.
func TestDeviceBridgeOffersComputerStatusWithoutToolLeak(t *testing.T) {
	credential := deviceFixtureCredential()
	offers := make(chan http.Header, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		offers <- r.Header.Clone()
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
		execution, tool, status := desktopExecutionVersion, desktopToolVersion, desktopComputerStatusVersion
		data, _ := json.Marshal(deviceReady{
			Type: "ready", DeviceID: credential.DeviceID,
			ConnectionID: fixtureLink, ProtocolVersion: 1, HeartbeatIntervalMS: 15_000,
			ExecutionVersion: &execution, ToolVersion: &tool,
			ToolOperations:        []string{"web.search", m1bComputerOperation},
			ComputerStatusVersion: &status,
		})
		if socket.Write(ctx, websocket.MessageText, data) != nil {
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
	runtime, _, messages := newFixtureRuntime(t)
	connection := newFixtureDeviceConnection(t, origin, credential)
	connection.runtime = runtime
	connection.computer = newM1BComputerHost(newFixtureComputerExecutor(fixtureComputerSelection(credential)))
	go connection.run()
	defer func() {
		connection.cancel()
		waitDeviceDone(t, connection)
	}()

	select {
	case header := <-offers:
		if header.Get(desktopComputerStatusHeader) != "1" {
			t.Fatalf("the Mac host did not offer the status marker: %q", header.Get(desktopComputerStatusHeader))
		}
		if strings.Contains(header.Get(desktopToolOperationsHeader), "computer.status") {
			t.Fatalf("the status marker leaked into the tool operations: %q", header.Get(desktopToolOperationsHeader))
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the device did not dial")
	}
	select {
	case opened := <-messages:
		if opened.Type != "link.open" {
			t.Fatalf("the echoed status readiness was not accepted: %+v", opened)
		}
		for _, operation := range opened.ToolOperations {
			if strings.Contains(operation, "status") {
				t.Fatalf("the status marker leaked into link.open: %+v", opened.ToolOperations)
			}
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the status-ready link did not open the runtime")
	}
}

// The exact expiry is a closed status-only field. Explicit null/empty is not an
// expiry, and every other native request variant rejects it through the
// existing strict decoder.
func TestComputerStatusAttestationFieldIsStatusOnly(t *testing.T) {
	expiry := time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano)
	valid := fmt.Sprintf(`{"kind":"status","selection_expires_at":%q}`, expiry)
	request, err := m1bComputerParseRequest([]byte(valid))
	if err != nil || request.Kind != "status" || request.StatusExpiresAt.IsZero() {
		t.Fatalf("the exact status expiry was not parsed: %+v %v", request, err)
	}
	for name, raw := range map[string]string{
		"null":          `{"kind":"status","selection_expires_at":null}`,
		"empty":         `{"kind":"status","selection_expires_at":""}`,
		"invalid":       `{"kind":"status","selection_expires_at":"not-a-time"}`,
		"zero":          `{"kind":"status","selection_expires_at":"0001-01-01T00:00:00Z"}`,
		"unknown field": `{"kind":"status","selection_expires_at":"` + expiry + `","extra":true}`,
		"observe":       `{"kind":"observe","selection_expires_at":"` + expiry + `"}`,
		"quiesce":       `{"kind":"quiesce","selection_expires_at":"` + expiry + `"}`,
		"wait":          `{"kind":"wait","selection_expires_at":"` + expiry + `","input":{"observation_id":"obs-1","ref":"@obs-1:e1"}}`,
		"act":           `{"kind":"act","selection_expires_at":"` + expiry + `","native_call_id":"call-1","input":{"action":"click","observation_id":"obs-1","ref":"e1"}}`,
	} {
		if _, err := m1bComputerParseRequest([]byte(raw)); err == nil {
			t.Fatalf("%s accepted a non-status selection expiry", name)
		}
	}
}

// The real bridge accepts the positive variant only on the socket generation
// that echoed the offered status marker. A reconnect without the echo keeps
// the unchanged legacy status: diagnostics false, and an unsolicited exact
// expiry is a bounded invalid request rather than an armed attestation.
func TestComputerStatusBridgeEchoAndReconnect(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	credential := deviceFixtureCredential()
	selection := fixtureComputerSelection(credential)
	executor := newTestComputerExecutor(t, runtimeRoot, selection)
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		StatusData:      fakeStatusData(computerConcreteDriver(t, executor).sessionID, computerConcreteDriver(t, executor).stateRoot, "granted"),
		PermissionsData: fakePermissions("granted"),
	})
	gate := &computerExecutorGate{}
	gate.install(executor)
	host := newM1BComputerHost(gate)
	server, sockets := newComputerFixtureServer(t, credential, fixtureReadyOperations,
		[]string{fixtureLink, fixtureLink}, true, false)
	run := startComputerFixture(t, server, sockets, credential, host)

	positive := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000631", selection, "", true,
		statusAttestationRequest(selection.ExpiresAt))
	kind, status := typedComputerFrame(t, positive)
	if kind != "status" || status["active_grant"] != true {
		t.Fatalf("the echoed socket did not attest positive: %+v", positive)
	}

	run.socket.close()
	var second *fixtureComputerSocket
	select {
	case second = <-sockets:
	case <-time.After(5 * time.Second):
		t.Fatal("the device did not reconnect after the echoed socket closed")
	}
	awaitRuntimeInput(t, run.messages, func(message runtimePipeMessage) bool {
		return message.Type == "link.open"
	})
	run.socket = second

	unsolicited := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000632", selection, "", true,
		statusAttestationRequest(selection.ExpiresAt))
	if kind, _ := typedComputerFrame(t, unsolicited); kind != "failure" ||
		fixtureCommandError(unsolicited) != "COMPUTER_INVALID" {
		t.Fatalf("a no-echo socket armed an unsolicited attestation: %+v", unsolicited)
	}

	legacy := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000633", selection, "", true,
		`{"kind":"status"}`)
	kind, status = typedComputerFrame(t, legacy)
	if kind != "status" || status["active_grant"] != false || status["available"] != true {
		t.Fatalf("the reconnected legacy status was not typed diagnostics false: %+v", legacy)
	}
}

// A positive status read that loses its exact grant while the driver is still
// running, or immediately after the driver returned, is suppressed as a typed
// timeout. The driver read is never retried.
type statusRaceExecutor struct {
	*controlTestExecutor
	started      chan struct{}
	release      chan struct{}
	readDone     chan struct{}
	beforeReturn chan struct{}
	calls        atomic.Int32
}

func (executor *statusRaceExecutor) status(context.Context, m1bComputerSelection) m1bComputerResult {
	executor.calls.Add(1)
	select {
	case executor.started <- struct{}{}:
	default:
	}
	<-executor.release
	if executor.readDone != nil {
		select {
		case executor.readDone <- struct{}{}:
		default:
		}
	}
	if executor.beforeReturn != nil {
		<-executor.beforeReturn
	}
	return m1bComputerStatusResult(m1bComputerStatus{
		Available: true, Permissions: m1bComputerPermissions{Accessibility: "granted"},
	})
}

func TestComputerGatePositiveStatusPostReadLossIsTypedTimeout(t *testing.T) {
	for _, test := range []struct {
		name       string
		afterRead  bool
		transition string
	}{
		{"renewal while the driver read is held", false, "renew"},
		{"pause while the driver read is held", false, "pause"},
		{"renewal just after the driver read", true, "renew"},
		{"pause just after the driver read", true, "pause"},
	} {
		t.Run(test.name, func(t *testing.T) {
			selection := fixtureComputerSelection(deviceFixtureCredential())
			release := make(chan struct{})
			var beforeReturn chan struct{}
			if test.afterRead {
				beforeReturn = make(chan struct{})
			}
			executor := &statusRaceExecutor{
				controlTestExecutor: &controlTestExecutor{binding: selection},
				started:             make(chan struct{}, 1), release: release,
				readDone: make(chan struct{}, 1), beforeReturn: beforeReturn,
			}
			gate := &computerExecutorGate{}
			gate.install(executor)
			admittedGrant, ok := gate.statusAttestationContext(selection)
			if !ok {
				t.Fatal("the open exact status exposed no admission grant")
			}
			host := newM1BComputerHost(gate)
			result := make(chan m1bComputerResult, 1)
			go func() {
				result <- host.statusOutcome(context.Background(), selection, m1bComputerRequest{
					Kind: "status", StatusExpiresAt: selection.ExpiresAt,
				}, admittedGrant)
			}()
			select {
			case <-executor.started:
			case <-time.After(5 * time.Second):
				t.Fatal("the driver status read did not start")
			}
			transition := func() {
				if test.transition == "pause" {
					gate.closeInputIf(executor)
					return
				}
				renewed := selection
				renewed.ExpiresAt = selection.ExpiresAt.Add(time.Minute)
				if err := gate.renew(executor, renewed); err != nil {
					t.Fatal(err)
				}
			}
			if test.afterRead {
				close(release)
				select {
				case <-executor.readDone:
				case <-time.After(5 * time.Second):
					t.Fatal("the driver status read did not finish")
				}
				transition()
				close(beforeReturn)
			} else {
				transition()
				close(release)
			}
			select {
			case outcome := <-result:
				if outcome.kind != "failure" || outcome.failure != "COMPUTER_TIMEOUT" {
					t.Fatalf("a lost exact status generation published data: %+v", outcome)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("the lost positive status did not settle")
			}
			if executor.calls.Load() != 1 {
				t.Fatalf("the failed exact status read was retried %d times", executor.calls.Load())
			}
		})
	}
}

// The exact grant also fences a positive status candidate that has already
// reached the final socket write. Renewal or local pause must cancel this exact
// publication lifetime rather than let the paused write publish afterward.
func TestComputerStatusPositiveBlockedWriteIsFenced(t *testing.T) {
	for _, transition := range []string{"renew", "pause"} {
		t.Run(transition, func(t *testing.T) {
			executor := &controlTestExecutor{}
			h := newWaitPublicationHarness(t, executor)
			h.link.computerStatus = true
			entered, release := make(chan struct{}), make(chan struct{})
			var positiveCandidate, published atomic.Bool
			h.link.write = func(ctx context.Context, data []byte) error {
				if strings.Contains(string(data), `"active_grant":true`) {
					positiveCandidate.Store(true)
				}
				close(entered)
				<-release
				if ctx.Err() != nil {
					return ctx.Err()
				}
				published.Store(true)
				return nil
			}
			const statusID = "90000000-0000-4000-8000-000000000641"
			frame := computerCommandJSON(statusID, h.selection, "", true,
				time.Now().Add(5*time.Minute).UTC().Format(time.RFC3339Nano),
				statusAttestationRequest(h.selection.ExpiresAt))
			if !interceptM1BComputerFrame(h.link, []byte(frame)) {
				t.Fatal("the positive status frame was not consumed")
			}
			select {
			case <-entered:
			case <-time.After(5 * time.Second):
				t.Fatal("the positive status did not reach the final write")
			}
			if !positiveCandidate.Load() {
				t.Fatal("the blocked write did not carry the positive candidate")
			}
			if transition == "pause" {
				h.control.gate.closeInputIf(executor)
			} else {
				renewed := h.selection
				renewed.ExpiresAt = h.selection.ExpiresAt.Add(time.Minute)
				if err := h.control.gate.renew(executor, renewed); err != nil {
					t.Fatal(err)
				}
			}
			close(release)
			waitPublicationDone(t, h.control.host)
			if published.Load() {
				t.Fatal("a positive status was published after its exact grant closed")
			}
		})
	}
}
