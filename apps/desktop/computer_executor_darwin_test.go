//go:build darwin

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"syscall"
	"testing"
	"time"
)

// These tests drive the private Darwin connector through the real Go device
// bridge, the real selection/holder/quiesce host and the real driver, with the
// existing copied test binary acting as the fake agent-desktop CLI. No real
// window, AX call, permission request, or agent-desktop install is used.

// Mirrors packages/shared/src/computer-use.ts; these are the only values the
// committed TS schemas accept.
var (
	sharedComputerEffects = map[string]bool{
		"done": true, "small_change": true, "no_effect": true, "place_changed": true,
	}
	sharedComputerFailureCodes = map[string]bool{
		"COMPUTER_UNAVAILABLE": true, "COMPUTER_STALE_OBSERVATION": true,
		"COMPUTER_STALE_REF": true, "COMPUTER_ACCESS_DENIED": true,
		"COMPUTER_TIMEOUT": true, "COMPUTER_INVALID": true,
		"COMPUTER_ACTION_FAILED": true, "DEVICE_BUSY": true,
		"COMPUTER_TARGET_CHANGED": true, "RUNNER_OPERATION_UNCERTAIN": true,
	}
)

func assertComputerStatusWire(t *testing.T, status map[string]any) {
	t.Helper()
	if _, ok := status["available"].(bool); !ok {
		t.Fatalf("status.available is not boolean: %+v", status)
	}
	permissions, _ := status["permissions"].(map[string]any)
	switch permissions["accessibility"] {
	case "granted", "missing", "unknown":
	default:
		t.Fatalf("status.permissions.accessibility is outside the shared enum: %+v", status)
	}
	if _, ok := status["active_grant"].(bool); !ok {
		t.Fatalf("status.active_grant is not boolean: %+v", status)
	}
	if version, ok := status["agent_desktop_version"].(string); ok && !m1bComputerStringOK(version, 1, 40) {
		t.Fatalf("agent_desktop_version is out of bounds: %q", version)
	}
}

func assertComputerObservationWire(t *testing.T, observation map[string]any) {
	t.Helper()
	observationID, _ := observation["observation_id"].(string)
	if !m1bComputerStringOK(observationID, 1, m1bComputerMaxObservID) {
		t.Fatalf("observation_id is out of bounds: %q", observationID)
	}
	switch observation["tree_quality"] {
	case "good", "partial", "unusable":
	default:
		t.Fatalf("tree_quality is outside the shared enum: %+v", observation)
	}
	if _, ok := observation["truncated"].(bool); !ok {
		t.Fatalf("truncated is not boolean: %+v", observation)
	}
	nodes, _ := observation["nodes"].([]any)
	if len(nodes) > 400 {
		t.Fatalf("too many nodes: %d", len(nodes))
	}
	for _, raw := range nodes {
		node, ok := raw.(map[string]any)
		if !ok {
			t.Fatalf("node is not an object: %+v", raw)
		}
		ref, _ := node["ref"].(string)
		role, _ := node["role"].(string)
		if !m1bComputerStringOK(ref, 1, m1bComputerMaxRef) || !m1bComputerStringOK(role, 1, 64) {
			t.Fatalf("node ref/role is empty or out of bounds: %+v", node)
		}
		if name, ok := node["name"].(string); ok && !m1bComputerStringOK(name, 0, 500) {
			t.Fatalf("node name is out of bounds: %+v", node)
		}
	}
}

func assertComputerActWire(t *testing.T, act map[string]any) {
	t.Helper()
	ok, isBool := act["ok"].(bool)
	if !isBool {
		t.Fatalf("act.ok is not boolean: %+v", act)
	}
	waited, isNumber := act["waited_ms"].(float64)
	if !isNumber || waited < 0 || waited > m1bComputerMaxTimeout || waited != float64(int(waited)) {
		t.Fatalf("act.waited_ms is outside the shared schema: %+v", act)
	}
	effect, hasEffect := act["effect"].(string)
	code, hasError := act["error"].(string)
	if hasEffect && !sharedComputerEffects[effect] {
		t.Fatalf("act.effect is outside the shared enum: %+v", act)
	}
	if hasError && !sharedComputerFailureCodes[code] {
		t.Fatalf("act.error is outside the shared enum: %+v", act)
	}
	if ok && (!hasEffect || hasError) {
		t.Fatalf("successful act lacks an effect or carries an error: %+v", act)
	}
	if !ok && !hasError {
		t.Fatalf("failed act lacks an error: %+v", act)
	}
}

func assertSharedFailureCode(t *testing.T, code string) {
	t.Helper()
	if !sharedComputerFailureCodes[code] {
		t.Fatalf("error %q is outside the shared enum", code)
	}
}

func newTestComputerExecutor(t *testing.T, runtimeRoot string, selection m1bComputerSelection) *computerExecutorDarwin {
	t.Helper()
	executor, err := newComputerExecutorDarwin(context.Background(), fixtureTarget(), selection, runtimeRoot, t.TempDir(), preparedProof())
	if err != nil {
		t.Fatal(err)
	}
	// Under -race the copied fake is the race-instrumented test binary. Disable
	// only its per-process atexit sleep; production never sets this.
	computerConcreteDriver(t, executor).environment = append(computerConcreteDriver(t, executor).environment, "GORACE=atexit_sleep_ms=0")
	t.Cleanup(func() { _ = executor.close() })
	return executor
}

// computerConcreteDriver recovers the concrete private driver behind the
// executor seam. Tests that need the fake-CLI state root use it; fake drivers
// may wrap the same concrete driver for a deterministic wait fence.
func computerConcreteDriver(t *testing.T, executor *computerExecutorDarwin) *computerDriver {
	t.Helper()
	driver, ok := executor.driver.(*computerDriver)
	if !ok {
		t.Fatalf("executor driver is %T, want the concrete private driver", executor.driver)
	}
	return driver
}

func startComputerExecutorBridge(t *testing.T, executor *computerExecutorDarwin) (*m1bComputerHost, *computerFixtureRun) {
	t.Helper()
	credential := deviceFixtureCredential()
	host := newM1BComputerHost(executor)
	server, sockets := newComputerFixtureServer(t, credential, fixtureReadyOperations, []string{fixtureLink})
	return host, startComputerFixture(t, server, sockets, credential, host)
}

func computerActRequestJSON(t *testing.T, nativeCallID string, input map[string]any) string {
	t.Helper()
	data, err := json.Marshal(map[string]any{
		"kind": "act", "native_call_id": nativeCallID, "input": input,
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func observeFixture(t *testing.T, run *computerFixtureRun, id string, selection m1bComputerSelection) (string, map[string]any) {
	t.Helper()
	frame := sendComputerCommand(t, run, id, selection, fixtureHolder, false, `{"kind":"observe"}`)
	kind, observation := typedComputerFrame(t, frame)
	if kind != "observe" {
		t.Fatalf("expected an observation, got %+v", frame)
	}
	assertComputerObservationWire(t, observation)
	observationID, _ := observation["observation_id"].(string)
	if observationID == "" {
		t.Fatalf("the observation id was missing: %+v", observation)
	}
	return observationID, observation
}

func observationRef(t *testing.T, observation map[string]any, role, name string) string {
	t.Helper()
	nodes, _ := observation["nodes"].([]any)
	for _, raw := range nodes {
		node, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if node["role"] == role && node["name"] == name {
			ref, _ := node["ref"].(string)
			return ref
		}
	}
	return ""
}

func typedObservationRef(observation m1bComputerObservation, role, name string) string {
	for _, node := range observation.Nodes {
		if node.Role == role && node.Name != nil && *node.Name == name {
			return node.Ref
		}
	}
	return ""
}

func authorizeFixtureAct(t *testing.T, executor *computerExecutorDarwin, selection m1bComputerSelection, nativeCallID string, input m1bComputerAct, ttl time.Duration) {
	t.Helper()
	auth, err := newComputerHostAuthorization(selection, nativeCallID, input, time.Now().Add(ttl))
	if err != nil {
		t.Fatal(err)
	}
	if err := executor.authorize(auth); err != nil {
		t.Fatal(err)
	}
}

func TestComputerExecutorDarwinKeepsRuntimeProofGate(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	selection := fixtureComputerSelection(deviceFixtureCredential())
	for _, test := range []struct {
		name  string
		proof computerRuntimeProof
		code  string
	}{
		{"missing proof", computerRuntimeProof{}, computerErrorRuntimeProofMissing},
		{"signed proof without a release token fails closed", computerRuntimeProof{Kind: computerRuntimeProofSigned}, computerErrorRuntimeProofMissing},
	} {
		t.Run(test.name, func(t *testing.T) {
			executor, err := newComputerExecutorDarwin(context.Background(), fixtureTarget(), selection, runtimeRoot, t.TempDir(), test.proof)
			if executor != nil {
				_ = executor.close()
				t.Fatal("an executor was constructed without a supported proof")
			}
			assertDriverCode(t, err, test.code)
		})
	}
}

func TestComputerExecutorBridgeMapsSharedWireResults(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	credential := deviceFixtureCredential()
	selection := fixtureComputerSelection(credential)
	executor := newTestComputerExecutor(t, runtimeRoot, selection)
	text := "LinkSense 白盒 123 🙂 é"

	preTree := fakeNode("window", "Fixture", "", nil,
		fakeNode("group", "", "", nil,
			fakeNode("textfield", "Input", "@stre1:e1", "SECRET-VALUE"),
			fakeNode("button", "保存 🙂", "@stre1:e2", nil)))
	postTree := fakeNode("window", "Fixture", "", nil,
		fakeNode("group", "", "", nil,
			fakeNode("textfield", "Input", "@stpost1:e1", text),
			fakeNode("button", "保存 🙂", "@stpost1:e2", nil)))
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		StatusData:      fakeStatusData(computerConcreteDriver(t, executor).sessionID, computerConcreteDriver(t, executor).stateRoot, "granted"),
		PermissionsData: fakePermissions("granted"),
		Windows:         mustWindows(t, fixtureWindow()),
		Snapshots: []json.RawMessage{
			fakeSnapshotData("stre1", "w-4242", "Fixture", "Fixture App", preTree),
			fakeSnapshotData("stpost1", "w-4242", "Fixture", "Fixture App", postTree),
		},
	})
	_, run := startComputerExecutorBridge(t, executor)

	statusFrame := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000501", selection, "", true, `{"kind":"status"}`)
	statusKind, status := typedComputerFrame(t, statusFrame)
	if statusKind != "status" || status["available"] != true || status["agent_desktop_version"] != "1.3.1" {
		t.Fatalf("unexpected status: %+v", statusFrame)
	}
	assertComputerStatusWire(t, status)
	permissions, _ := status["permissions"].(map[string]any)
	if permissions["accessibility"] != "granted" {
		t.Fatalf("unexpected permissions: %+v", status)
	}

	observationID, observation := observeFixture(t, run, "90000000-0000-4000-8000-000000000502", selection)
	ref := observationRef(t, observation, "textfield", "Input")
	if ref != "@stre1:e1" {
		t.Fatalf("unexpected ref: %q", ref)
	}
	if observationRef(t, observation, "button", "保存 🙂") != "@stre1:e2" {
		t.Fatalf("unicode node name was not preserved: %+v", observation)
	}
	// The driver may retain AX values privately, but they must never reach the
	// wire, especially since nonactionable window/group nodes are skipped.
	if strings.Contains(fmt.Sprint(observation), "SECRET-VALUE") {
		t.Fatal("an AX value reached the observation result")
	}

	input := map[string]any{
		"action": "type", "observation_id": observationID, "ref": ref, "text": text, "timeout_ms": m1bComputerDefaultTimeout,
	}
	actInput := m1bComputerAct{Action: "type", ObservationID: observationID, Ref: ref, Text: text, TimeoutMS: m1bComputerDefaultTimeout}
	authorizeFixtureAct(t, executor, selection, "call-unicode", actInput, time.Minute)
	actFrame := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000503", selection, fixtureHolder, false,
		computerActRequestJSON(t, "call-unicode", input))
	actKind, act := typedComputerFrame(t, actFrame)
	if actKind != "act" || act["ok"] != true || act["effect"] != "done" {
		t.Fatalf("unexpected unicode act result: %+v", actFrame)
	}
	assertComputerActWire(t, act)
	if _, err := os.Lstat(computerConcreteDriver(t, executor).stateRoot); err != nil {
		t.Fatalf("the driver state root disappeared: %v", err)
	}

	calls := readFakeCalls(t, runtimeRoot)
	typeCalls := callsFor(calls, "type")
	if len(typeCalls) != 1 {
		t.Fatalf("expected exactly one type call, got %d", len(typeCalls))
	}
	assertExactArgs(t, typeCalls[0], computerConcreteDriver(t, executor).sessionID, "type", ref, "--stdin", "--timeout-ms=8000")
	if typeCalls[0].Stdin != text {
		t.Fatalf("stdin mismatch: got %q want %q", typeCalls[0].Stdin, text)
	}
	if strings.Contains(strings.Join(typeCalls[0].Argv, " "), text) {
		t.Fatal("typed text travelled in argv")
	}
	if count := len(callsFor(calls, "snapshot")); count != 2 {
		t.Fatalf("expected the observe plus one readback, snapshots=%d", count)
	}
	assertNoForbiddenArgs(t, calls)

	// The proof was consumed by that exact input. A fresh observation does not
	// revive it, so a second identical act is rejected before the driver.
	freshObservationID, freshObservation := observeFixture(t, run, "90000000-0000-4000-8000-000000000504", selection)
	freshRef := observationRef(t, freshObservation, "textfield", "Input")
	if freshRef == "" {
		t.Fatal("the fresh observation had no text field")
	}
	replay := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000505", selection, fixtureHolder, false,
		computerActRequestJSON(t, "call-unicode", map[string]any{
			"action": "type", "observation_id": freshObservationID, "ref": freshRef, "text": text,
		}))
	replayKind, replayResult := typedComputerFrame(t, replay)
	if replayKind != "act" || replayResult["ok"] != false || replayResult["error"] != computerExecutorAccessDenied {
		t.Fatalf("a consumed proof authorized a second act: %+v", replay)
	}
	assertComputerActWire(t, replayResult)
	if count := len(callsFor(readFakeCalls(t, runtimeRoot), "type")); count != 1 {
		t.Fatalf("a rejected act reached the driver: %d type calls", count)
	}
}

func TestComputerExecutorBridgeMapsPermissionStates(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	executor := newTestComputerExecutor(t, runtimeRoot, fixtureComputerSelection(deviceFixtureCredential()))
	_, run := startComputerExecutorBridge(t, executor)
	for index, test := range []struct {
		driverState string
		wireState   string
	}{
		{"granted", "granted"},
		{"denied", "missing"},
		{"not_required", "unknown"},
		{"unknown", "unknown"},
	} {
		t.Run(test.driverState, func(t *testing.T) {
			selection := executor.selection()
			writeFakeScenario(t, runtimeRoot, fakeScenario{
				StatusData: fakeStatusData(computerConcreteDriver(t, executor).sessionID, computerConcreteDriver(t, executor).stateRoot, test.driverState),
			})
			id := fmt.Sprintf("90000000-0000-4000-8000-%012d", 506+index)
			frame := sendComputerCommand(t, run, id, selection, "", true, `{"kind":"status"}`)
			kind, status := typedComputerFrame(t, frame)
			if kind != "status" {
				t.Fatalf("unexpected status result: %+v", frame)
			}
			assertComputerStatusWire(t, status)
			permissions, _ := status["permissions"].(map[string]any)
			if permissions["accessibility"] != test.wireState {
				t.Fatalf("driver %q mapped to %v, want %q", test.driverState, permissions["accessibility"], test.wireState)
			}
		})
	}
}

func TestComputerExecutorBridgeRequiresExactAuthorization(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	selection := fixtureComputerSelection(deviceFixtureCredential())
	executor := newTestComputerExecutor(t, runtimeRoot, selection)

	preTree := fakeNode("window", "Fixture", "", nil,
		fakeNode("group", "", "", nil,
			fakeNode("textfield", "Input", "@sapre1:e1", ""),
			fakeNode("button", "Apply", "@sapre1:e2", nil)))
	postTree := fakeNode("window", "Fixture", "", nil,
		fakeNode("group", "", "", nil,
			fakeNode("textfield", "Input", "@sapost1:e1", ""),
			fakeNode("button", "Applied", "@sapost1:e2", nil)))
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Windows:         mustWindows(t, fixtureWindow()),
		Snapshots: []json.RawMessage{
			fakeSnapshotData("sapre1", "w-4242", "Fixture", "Fixture App", preTree),
			fakeSnapshotData("sapost1", "w-4242", "Fixture", "Fixture App", postTree),
		},
	})
	_, run := startComputerExecutorBridge(t, executor)

	observationID, observation := observeFixture(t, run, "90000000-0000-4000-8000-000000000511", selection)
	ref := observationRef(t, observation, "button", "Apply")
	if ref != "@sapre1:e2" {
		t.Fatalf("unexpected ref: %q", ref)
	}
	input := map[string]any{"action": "click", "observation_id": observationID, "ref": ref, "timeout_ms": m1bComputerMaxTimeout}

	missing := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000512", selection, fixtureHolder, false,
		computerActRequestJSON(t, "call-a", input))
	missingKind, missingResult := typedComputerFrame(t, missing)
	if missingKind != "act" || missingResult["ok"] != false || missingResult["error"] != computerExecutorAccessDenied {
		t.Fatalf("an unauthorized click was not rejected: %+v", missing)
	}
	assertComputerActWire(t, missingResult)
	if count := len(callsFor(readFakeCalls(t, runtimeRoot), "click")); count != 0 {
		t.Fatalf("an unauthorized click reached the driver: %d", count)
	}

	// A proof bound to a different native call id must not authorize this
	// input, and it must not survive for a later action.
	otherAuth, err := newComputerHostAuthorization(selection, "call-other", m1bComputerAct{
		Action: "click", ObservationID: observationID, Ref: ref, TimeoutMS: m1bComputerMaxTimeout,
	}, time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if err := executor.authorize(otherAuth); err != nil {
		t.Fatal(err)
	}
	changed := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000513", selection, fixtureHolder, false,
		computerActRequestJSON(t, "call-a", input))
	changedKind, changedResult := typedComputerFrame(t, changed)
	if changedKind != "act" || changedResult["ok"] != false || changedResult["error"] != computerExecutorAccessDenied {
		t.Fatalf("a changed authorization authorized the input: %+v", changed)
	}
	assertComputerActWire(t, changedResult)
	if count := len(callsFor(readFakeCalls(t, runtimeRoot), "click")); count != 0 {
		t.Fatalf("a changed-authorization click reached the driver: %d", count)
	}

	authorizeFixtureAct(t, executor, selection, "call-a", m1bComputerAct{
		Action: "click", ObservationID: observationID, Ref: ref, TimeoutMS: m1bComputerMaxTimeout,
	}, time.Minute)
	accepted := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000514", selection, fixtureHolder, false,
		computerActRequestJSON(t, "call-a", input))
	acceptedKind, acceptedResult := typedComputerFrame(t, accepted)
	if acceptedKind != "act" || acceptedResult["ok"] != true || acceptedResult["effect"] != computerEffectSmallChange {
		t.Fatalf("the exact authorization was not honored: %+v", accepted)
	}
	assertComputerActWire(t, acceptedResult)
	clickCalls := callsFor(readFakeCalls(t, runtimeRoot), "click")
	if len(clickCalls) != 1 {
		t.Fatalf("expected exactly one click, got %d", len(clickCalls))
	}
	assertExactArgs(t, clickCalls[0], computerConcreteDriver(t, executor).sessionID, "click", ref, "--timeout-ms=20000")

	// A post-entry result whose delivery is not proven maps to the documented
	// uncertain runner code and is not retried.
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Windows:         mustWindows(t, fixtureWindow()),
		Snapshots: []json.RawMessage{
			fakeSnapshotData("sapost1", "w-4242", "Fixture", "Fixture App", postTree),
		},
		ActionError: map[string]json.RawMessage{"click": mustJSON(t, map[string]any{"code": "ACTION_FAILED"})},
	})
	ambiguousObservationID, ambiguousObservation := observeFixture(t, run, "90000000-0000-4000-8000-000000000515", selection)
	ambiguousRef := observationRef(t, ambiguousObservation, "button", "Applied")
	if ambiguousRef == "" {
		t.Fatal("the post-observation had no button")
	}
	ambiguousInput := map[string]any{"action": "click", "observation_id": ambiguousObservationID, "ref": ambiguousRef}
	authorizeFixtureAct(t, executor, selection, "call-ambiguous", m1bComputerAct{
		Action: "click", ObservationID: ambiguousObservationID, Ref: ambiguousRef, TimeoutMS: m1bComputerDefaultTimeout,
	}, time.Minute)
	ambiguous := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000516", selection, fixtureHolder, false,
		computerActRequestJSON(t, "call-ambiguous", ambiguousInput))
	ambiguousKind, ambiguousResult := typedComputerFrame(t, ambiguous)
	if ambiguousKind != "act" || ambiguousResult["ok"] != false || ambiguousResult["error"] != computerExecutorUncertain {
		t.Fatalf("an unproven post-entry result was not uncertain: %+v", ambiguous)
	}
	assertComputerActWire(t, ambiguousResult)
	if count := len(callsFor(readFakeCalls(t, runtimeRoot), "click")); count != 2 {
		t.Fatalf("the uncertain action was retried: %d clicks", count)
	}

	// A selection revoked between observation and dispatch fails before the
	// driver, and quiesce-style invalidation never touches another selection.
	revoked := selection
	revoked.SelectionID = "80000000-0000-4000-8000-000000000102"
	if err := executor.selectHostSelection(revoked); err != nil {
		t.Fatal(err)
	}
	stale := executor.act(context.Background(), selection, "call-stale", m1bComputerAct{
		Action: "click", ObservationID: ambiguousObservationID, Ref: ambiguousRef,
	})
	if stale.kind != "act" || stale.act.OK {
		t.Fatalf("a revoked selection still acted: %+v", stale)
	}
	assertSharedFailureCode(t, stale.act.Error)
	if stale.act.Error != computerExecutorTargetChanged {
		t.Fatalf("unexpected revoked-selection error: %q", stale.act.Error)
	}

	direct := executor.observe(context.Background(), revoked)
	if direct.kind != "observe" || direct.observation.ObservationID == "" {
		t.Fatalf("the replacement selection could not observe: %+v", direct)
	}
	executor.invalidate(selection)
	if computerConcreteDriver(t, executor).latest == nil {
		t.Fatal("clearing the old selection also cleared the replacement observation")
	}
	executor.invalidate(revoked)
	if computerConcreteDriver(t, executor).latest != nil {
		t.Fatal("the matching selection did not clear its refs")
	}
	if _, err := os.Lstat(computerConcreteDriver(t, executor).stateRoot); err != nil {
		t.Fatalf("invalidation closed the driver state root: %v", err)
	}

	// The deadline is checked after the consumed proof and immediately before
	// dispatch; an expired context never reaches the driver.
	direct = executor.observe(context.Background(), revoked)
	deadlineInput := m1bComputerAct{
		Action: "click", ObservationID: direct.observation.ObservationID,
		Ref: typedObservationRef(direct.observation, "button", "Applied"), TimeoutMS: m1bComputerDefaultTimeout,
	}
	authorizeFixtureAct(t, executor, revoked, "call-deadline", deadlineInput, time.Minute)
	expired, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	deadlineResult := executor.act(expired, revoked, "call-deadline", deadlineInput)
	if deadlineResult.kind != "act" || deadlineResult.act.OK || deadlineResult.act.Error != computerExecutorTimeout {
		t.Fatalf("an expired deadline dispatched: %+v", deadlineResult)
	}
	assertSharedFailureCode(t, deadlineResult.act.Error)
	if count := len(callsFor(readFakeCalls(t, runtimeRoot), "click")); count != 2 {
		t.Fatalf("an expired act reached the driver: %d clicks", count)
	}
}

func TestComputerExecutorBridgeUnprovenSuccessIsUncertain(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	selection := fixtureComputerSelection(deviceFixtureCredential())
	executor := newTestComputerExecutor(t, runtimeRoot, selection)
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Windows:         mustWindows(t, fixtureWindow()),
		Snapshots: []json.RawMessage{
			fakeSnapshotData("suproven1", "w-4242", "Fixture", "Fixture App", basicTree("@suproven1:e1")),
			json.RawMessage(`{}`),
		},
	})
	_, run := startComputerExecutorBridge(t, executor)
	observationID, observation := observeFixture(t, run, "90000000-0000-4000-8000-000000000531", selection)
	ref := observationRef(t, observation, "button", "Apply")
	if ref == "" {
		t.Fatal("the observation had no button")
	}
	input := m1bComputerAct{
		Action: "click", ObservationID: observationID, Ref: ref, TimeoutMS: m1bComputerDefaultTimeout,
	}
	authorizeFixtureAct(t, executor, selection, "call-unproven", input, time.Minute)
	frame := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000532", selection, fixtureHolder, false,
		computerActRequestJSON(t, "call-unproven", map[string]any{
			"action": "click", "observation_id": observationID, "ref": ref,
		}))
	kind, result := typedComputerFrame(t, frame)
	if kind != "act" || result["ok"] != false || result["error"] != computerExecutorUncertain {
		t.Fatalf("an accepted action without a proven effect was not uncertain: %+v", frame)
	}
	if _, hasEffect := result["effect"]; hasEffect {
		t.Fatalf("an unproven effect was reported: %+v", result)
	}
	assertComputerActWire(t, result)
	if count := len(callsFor(readFakeCalls(t, runtimeRoot), "click")); count != 1 {
		t.Fatalf("the unproven action was retried: %d clicks", count)
	}
}

type computerPreflightRun struct {
	executor    *computerExecutorDarwin
	host        *m1bComputerHost
	run         *computerFixtureRun
	runtimeRoot string
	selection   m1bComputerSelection
	actID       string
}

func startComputerPreflight(t *testing.T, proofTTL time.Duration) *computerPreflightRun {
	t.Helper()
	runtimeRoot, _ := newFakeRuntime(t)
	selection := fixtureComputerSelection(deviceFixtureCredential())
	executor := newTestComputerExecutor(t, runtimeRoot, selection)
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Windows:         mustWindows(t, fixtureWindow()),
		Snapshots: []json.RawMessage{
			fakeSnapshotData("spreflight1", "w-4242", "Fixture", "Fixture App", basicTree("@spreflight1:e1")),
		},
		DelayMS:      1500,
		DelayCommand: "permissions",
	})
	host, run := startComputerExecutorBridge(t, executor)
	observationID, observation := observeFixture(t, run, "90000000-0000-4000-8000-000000000601", selection)
	ref := observationRef(t, observation, "button", "Apply")
	if ref != "@spreflight1:e1" {
		t.Fatalf("unexpected ref: %q", ref)
	}
	actInput := m1bComputerAct{Action: "click", ObservationID: observationID, Ref: ref, TimeoutMS: m1bComputerMaxTimeout}
	authorizeFixtureAct(t, executor, selection, "call-preflight", actInput, proofTTL)
	const actID = "90000000-0000-4000-8000-000000000602"
	if err := run.socket.send([]byte(computerCommandJSON(actID, selection, fixtureHolder, false, "2030-01-01T00:00:00Z",
		computerActRequestJSON(t, "call-preflight", map[string]any{
			"action": "click", "observation_id": observationID, "ref": ref, "timeout_ms": m1bComputerMaxTimeout,
		})))); err != nil {
		t.Fatal(err)
	}
	waitForFakeCommand(t, runtimeRoot, "permissions")
	return &computerPreflightRun{
		executor: executor, host: host, run: run, runtimeRoot: runtimeRoot, selection: selection, actID: actID,
	}
}

func TestComputerExecutorBridgePreflightGuards(t *testing.T) {
	t.Run("canceled during preflight", func(t *testing.T) {
		pre := startComputerPreflight(t, time.Minute)
		if err := pre.run.socket.send([]byte(`{"type":"command.cancel","id":"` + pre.actID + `"}`)); err != nil {
			t.Fatal(err)
		}
		expectNoComputerResults(t, pre.run.socket, []string{pre.actID}, 300*time.Millisecond)
		if count := len(callsFor(readFakeCalls(t, pre.runtimeRoot), "click")); count != 0 {
			t.Fatalf("a canceled preflight dispatched input: %d clicks", count)
		}
	})

	t.Run("replaced during preflight", func(t *testing.T) {
		pre := startComputerPreflight(t, time.Minute)
		replacement := pre.selection
		replacement.SelectionID = "80000000-0000-4000-8000-000000000103"
		if err := pre.executor.selectHostSelection(replacement); err != nil {
			t.Fatal(err)
		}
		expectNoComputerResults(t, pre.run.socket, []string{pre.actID}, 300*time.Millisecond)
		waitComputerIdle(t, pre.host)
		if count := len(callsFor(readFakeCalls(t, pre.runtimeRoot), "click")); count != 0 {
			t.Fatalf("a replaced preflight dispatched input: %d clicks", count)
		}
		frame := sendComputerCommand(t, pre.run, "90000000-0000-4000-8000-000000000603", replacement, fixtureHolderTwo, false, `{"kind":"observe"}`)
		if kind, _ := typedComputerFrame(t, frame); kind != "observe" {
			t.Fatalf("the replacement selection could not observe: %+v", frame)
		}
	})

	t.Run("proof expired during preflight", func(t *testing.T) {
		pre := startComputerPreflight(t, 250*time.Millisecond)
		frame := awaitComputerResult(t, pre.run.socket, pre.actID)
		kind, result := typedComputerFrame(t, frame)
		if kind != "act" || result["ok"] != false || result["error"] != computerExecutorTimeout {
			t.Fatalf("an expired proof did not stop preflight with a proven no-dispatch error: %+v", frame)
		}
		assertComputerActWire(t, result)
		if count := len(callsFor(readFakeCalls(t, pre.runtimeRoot), "click")); count != 0 {
			t.Fatalf("an expired proof dispatched input: %d clicks", count)
		}
	})
}

func TestComputerExecutorDarwinPreflightInvalidationAndClose(t *testing.T) {
	start := func(t *testing.T) (*computerExecutorDarwin, m1bComputerSelection, <-chan m1bComputerResult, string) {
		t.Helper()
		runtimeRoot, _ := newFakeRuntime(t)
		selection := fixtureComputerSelection(deviceFixtureCredential())
		executor := newTestComputerExecutor(t, runtimeRoot, selection)
		writeFakeScenario(t, runtimeRoot, fakeScenario{
			PermissionsData: fakePermissions("granted"),
			Windows:         mustWindows(t, fixtureWindow()),
			Snapshots: []json.RawMessage{
				fakeSnapshotData("sdirect1", "w-4242", "Fixture", "Fixture App", basicTree("@sdirect1:e1")),
			},
			DelayMS:      1500,
			DelayCommand: "permissions",
		})
		observation := executor.observe(context.Background(), selection)
		if observation.kind != "observe" {
			t.Fatalf("the direct observation failed: %+v", observation)
		}
		input := m1bComputerAct{
			Action: "click", ObservationID: observation.observation.ObservationID,
			Ref: typedObservationRef(observation.observation, "button", "Apply"), TimeoutMS: m1bComputerDefaultTimeout,
		}
		authorizeFixtureAct(t, executor, selection, "call-direct", input, time.Minute)
		results := make(chan m1bComputerResult, 1)
		go func() {
			results <- executor.act(context.Background(), selection, "call-direct", input)
		}()
		waitForFakeCommand(t, runtimeRoot, "permissions")
		return executor, selection, results, runtimeRoot
	}

	t.Run("invalidate before input", func(t *testing.T) {
		executor, selection, results, runtimeRoot := start(t)
		executor.invalidate(selection)
		select {
		case result := <-results:
			if result.kind != "act" || result.act.OK || result.act.Error != computerExecutorTargetChanged {
				t.Fatalf("invalidation did not prove no dispatch: %+v", result)
			}
			assertSharedFailureCode(t, result.act.Error)
		case <-time.After(5 * time.Second):
			t.Fatal("the invalidated preflight did not return")
		}
		if count := len(callsFor(readFakeCalls(t, runtimeRoot), "click")); count != 0 {
			t.Fatalf("invalidation still dispatched input: %d clicks", count)
		}
	})

	t.Run("close before input", func(t *testing.T) {
		executor, _, results, runtimeRoot := start(t)
		if err := executor.close(); err != nil {
			t.Fatal(err)
		}
		select {
		case result := <-results:
			if result.kind != "act" || result.act.OK || result.act.Error != computerExecutorUnavailable {
				t.Fatalf("close did not prove no dispatch: %+v", result)
			}
			assertSharedFailureCode(t, result.act.Error)
		case <-time.After(5 * time.Second):
			t.Fatal("the closed preflight did not return")
		}
		if count := len(callsFor(readFakeCalls(t, runtimeRoot), "click")); count != 0 {
			t.Fatalf("close still dispatched input: %d clicks", count)
		}
		if _, err := os.Lstat(computerConcreteDriver(t, executor).stateRoot); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("close did not remove the driver state root: %v", err)
		}
	})
}

func TestComputerExecutorBridgeCancelSuppressesResultAndKeepsDriverAlive(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	credential := deviceFixtureCredential()
	selection := fixtureComputerSelection(credential)
	executor := newTestComputerExecutor(t, runtimeRoot, selection)

	scenario := basicScenario(t, "scancel1", "@scancel1:e1")
	scenario.DelayMS = 30000
	scenario.DelayCommand = "click"
	writeFakeScenario(t, runtimeRoot, scenario)
	_, run := startComputerExecutorBridge(t, executor)

	observationID, observation := observeFixture(t, run, "90000000-0000-4000-8000-000000000521", selection)
	ref := observationRef(t, observation, "button", "Apply")
	if ref != "@scancel1:e1" {
		t.Fatalf("unexpected ref: %q", ref)
	}
	authorizeFixtureAct(t, executor, selection, "call-cancel", m1bComputerAct{
		Action: "click", ObservationID: observationID, Ref: ref, TimeoutMS: m1bComputerDefaultTimeout,
	}, time.Minute)
	const actID = "90000000-0000-4000-8000-000000000522"
	if err := run.socket.send([]byte(computerCommandJSON(actID, selection, fixtureHolder, false, "2030-01-01T00:00:00Z",
		computerActRequestJSON(t, "call-cancel", map[string]any{
			"action": "click", "observation_id": observationID, "ref": ref,
		})))); err != nil {
		t.Fatal(err)
	}
	waitForFakeCommand(t, runtimeRoot, "click")
	if err := run.socket.send([]byte(`{"type":"command.cancel","id":"` + actID + `"}`)); err != nil {
		t.Fatal(err)
	}
	// Cancellation is not a result: the host must suppress the late act.
	expectNoComputerResults(t, run.socket, []string{actID}, 300*time.Millisecond)
	clickCalls := callsFor(readFakeCalls(t, runtimeRoot), "click")
	if len(clickCalls) != 1 {
		t.Fatalf("expected exactly one cancelled click, got %d", len(clickCalls))
	}
	if last := callsFor(readFakeCalls(t, runtimeRoot), "type"); len(last) != 0 {
		t.Fatal("cancellation substituted a different action")
	}
	pid := clickCalls[0].PID
	deadline := time.Now().Add(5 * time.Second)
	for {
		err := syscall.Kill(pid, 0)
		if errors.Is(err, syscall.ESRCH) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("cancelled action process %d still exists", pid)
		}
		time.Sleep(20 * time.Millisecond)
	}

	// The quiesce barrier clears only refs, never the driver process or state.
	quiesce := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000523", selection, fixtureHolder, false, `{"kind":"quiesce"}`)
	quiesceKind, quiesceResult := typedComputerFrame(t, quiesce)
	if quiesceKind != "quiesce" || quiesceResult["quiesced"] != true {
		t.Fatalf("the quiesce was not acknowledged: %+v", quiesce)
	}
	if computerConcreteDriver(t, executor).latest != nil {
		t.Fatal("the quiesce did not clear the driver refs")
	}
	if _, err := os.Lstat(computerConcreteDriver(t, executor).stateRoot); err != nil {
		t.Fatalf("the quiesce closed the driver state root: %v", err)
	}

	// A new host-picked selection can observe again in the same driver process.
	fresh := selection
	fresh.SelectionID = "80000000-0000-4000-8000-000000000104"
	if err := executor.selectHostSelection(fresh); err != nil {
		t.Fatal(err)
	}
	freshFrame := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000524", fresh, fixtureHolderTwo, false, `{"kind":"observe"}`)
	if kind, _ := typedComputerFrame(t, freshFrame); kind != "observe" {
		t.Fatalf("the driver did not survive the quiesce: %+v", freshFrame)
	}
}

// A validated short input timeout bounds the driver context itself, including
// the preflight, even when the selection and proof live far longer.
func TestComputerExecutorDarwinHonorsValidatedInputTimeout(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	selection := fixtureComputerSelection(deviceFixtureCredential())
	executor := newTestComputerExecutor(t, runtimeRoot, selection)
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Windows:         mustWindows(t, fixtureWindow()),
		Snapshots: []json.RawMessage{
			fakeSnapshotData("stimeout1", "w-4242", "Fixture", "Fixture App", basicTree("@stimeout1:e1")),
		},
		DelayMS:      1500,
		DelayCommand: "permissions",
	})
	observation := executor.observe(context.Background(), selection)
	if observation.kind != "observe" {
		t.Fatalf("the observation failed: %+v", observation)
	}
	input := m1bComputerAct{
		Action: "click", ObservationID: observation.observation.ObservationID,
		Ref: typedObservationRef(observation.observation, "button", "Apply"), TimeoutMS: m1bComputerMinTimeout,
	}
	authorizeFixtureAct(t, executor, selection, "call-input-timeout", input, time.Minute)
	start := time.Now()
	result := executor.act(context.Background(), selection, "call-input-timeout", input)
	elapsed := time.Since(start)
	if result.kind != "act" || result.act.OK || result.act.Error != computerExecutorTimeout {
		t.Fatalf("a short input timeout did not stop the preflight: %+v", result)
	}
	assertSharedFailureCode(t, result.act.Error)
	if elapsed > time.Second {
		t.Fatalf("the 100ms input timeout took %s; the 1500ms preflight was not cut", elapsed)
	}
	if count := len(callsFor(readFakeCalls(t, runtimeRoot), "click")); count != 0 {
		t.Fatalf("an expired input dispatched %d clicks", count)
	}
}

// The one-shot host proof covers the exact parser-normalized input, including
// the requested wait. A changed timeout never reuses it, an expired proof never
// dispatches, and a caller deadline shorter than the requested wait still
// authorizes the unchanged input and only bounds execution.
func TestComputerExecutorAuthorizationBindsExactInput(t *testing.T) {
	start := func(t *testing.T, selectionExpiry time.Duration) (*computerExecutorDarwin, m1bComputerSelection, *computerFixtureRun, string, string, string) {
		t.Helper()
		runtimeRoot, _ := newFakeRuntime(t)
		selection := fixtureComputerSelection(deviceFixtureCredential())
		selection.ExpiresAt = time.Now().Add(selectionExpiry)
		executor := newTestComputerExecutor(t, runtimeRoot, selection)
		pre := basicTree("@sauthpre1:e1")
		post := fakeNode("window", "Fixture", "", nil, fakeNode("button", "Applied", "@sauthpost1:e1", nil))
		writeFakeScenario(t, runtimeRoot, fakeScenario{
			PermissionsData: fakePermissions("granted"),
			Windows:         mustWindows(t, fixtureWindow()),
			Snapshots: []json.RawMessage{
				fakeSnapshotData("sauthpre1", "w-4242", "Fixture", "Fixture App", pre),
				fakeSnapshotData("sauthpost1", "w-4242", "Fixture", "Fixture App", post),
			},
		})
		_, run := startComputerExecutorBridge(t, executor)
		observationID, observation := observeFixture(t, run, "90000000-0000-4000-8000-000000000721", selection)
		ref := observationRef(t, observation, "button", "Apply")
		if ref == "" {
			t.Fatal("the observation had no button")
		}
		return executor, selection, run, runtimeRoot, observationID, ref
	}
	clickInput := func(observationID, ref string) m1bComputerAct {
		return m1bComputerAct{
			Action: "click", ObservationID: observationID, Ref: ref, TimeoutMS: m1bComputerDefaultTimeout,
		}
	}

	t.Run("changed timeout is denied without dispatch", func(t *testing.T) {
		executor, selection, run, runtimeRoot, observationID, ref := start(t, time.Hour)
		authorizeFixtureAct(t, executor, selection, "call-timeout", clickInput(observationID, ref), time.Minute)
		frame := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000722", selection, fixtureHolder, false,
			computerActRequestJSON(t, "call-timeout", map[string]any{
				"action": "click", "observation_id": observationID, "ref": ref, "timeout_ms": m1bComputerMaxTimeout,
			}))
		kind, result := typedComputerFrame(t, frame)
		if kind != "act" || result["ok"] != false || result["error"] != computerExecutorAccessDenied {
			t.Fatalf("a changed timeout reused the proof: %+v", frame)
		}
		assertComputerActWire(t, result)
		if count := len(callsFor(readFakeCalls(t, runtimeRoot), "click")); count != 0 {
			t.Fatalf("a changed-timeout act reached the driver: %d clicks", count)
		}
	})

	t.Run("expired proof is denied without dispatch", func(t *testing.T) {
		executor, selection, run, runtimeRoot, observationID, ref := start(t, time.Hour)
		input := clickInput(observationID, ref)
		expiresAt := time.Now().Add(300 * time.Millisecond)
		auth, err := newComputerHostAuthorization(selection, "call-expired", input, expiresAt)
		if err != nil {
			t.Fatal(err)
		}
		if err := executor.authorize(auth); err != nil {
			t.Fatal(err)
		}
		for time.Now().Before(expiresAt) {
			time.Sleep(10 * time.Millisecond)
		}
		frame := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000723", selection, fixtureHolder, false,
			computerActRequestJSON(t, "call-expired", map[string]any{
				"action": "click", "observation_id": observationID, "ref": ref,
			}))
		kind, result := typedComputerFrame(t, frame)
		if kind != "act" || result["ok"] != false || result["error"] != computerExecutorAccessDenied {
			t.Fatalf("an expired proof authorized the act: %+v", frame)
		}
		assertComputerActWire(t, result)
		if count := len(callsFor(readFakeCalls(t, runtimeRoot), "click")); count != 0 {
			t.Fatalf("an expired proof dispatched %d clicks", count)
		}
	})

	t.Run("shorter caller deadline still authorizes exact input", func(t *testing.T) {
		// The selection expires well before the requested 8s wait, so the host
		// dispatch context is shorter than the approved timeout. The input the
		// proof is compared against must stay the parser-normalized original.
		executor, selection, run, runtimeRoot, observationID, ref := start(t, 6*time.Second)
		authorizeFixtureAct(t, executor, selection, "call-short", clickInput(observationID, ref), time.Minute)
		frame := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000724", selection, fixtureHolder, false,
			computerActRequestJSON(t, "call-short", map[string]any{
				"action": "click", "observation_id": observationID, "ref": ref,
			}))
		kind, result := typedComputerFrame(t, frame)
		if kind != "act" || result["ok"] != true || result["effect"] != computerEffectSmallChange {
			t.Fatalf("a shorter caller deadline rejected the exact input: %+v", frame)
		}
		assertComputerActWire(t, result)
		if count := len(callsFor(readFakeCalls(t, runtimeRoot), "click")); count != 1 {
			t.Fatalf("the exact authorized act dispatched %d clicks", count)
		}
	})

	t.Run("explicit lower timeout is passed to the driver", func(t *testing.T) {
		executor, selection, run, runtimeRoot, observationID, ref := start(t, time.Hour)
		input := clickInput(observationID, ref)
		input.TimeoutMS = 2_000
		authorizeFixtureAct(t, executor, selection, "call-lower", input, time.Minute)
		frame := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000725", selection, fixtureHolder, false,
			computerActRequestJSON(t, "call-lower", map[string]any{
				"action": "click", "observation_id": observationID, "ref": ref, "timeout_ms": 2_000,
			}))
		kind, result := typedComputerFrame(t, frame)
		if kind != "act" || result["ok"] != true || result["effect"] != computerEffectSmallChange {
			t.Fatalf("an explicit lower timeout rejected the exact input: %+v", frame)
		}
		assertComputerActWire(t, result)
		clickCalls := callsFor(readFakeCalls(t, runtimeRoot), "click")
		if len(clickCalls) != 1 {
			t.Fatalf("the explicit lower timeout dispatched %d clicks", len(clickCalls))
		}
		assertExactArgs(t, clickCalls[0], computerConcreteDriver(t, executor).sessionID, "click", ref, "--timeout-ms=2000")
	})
}

// The default 8s act wait must survive the former 5s read window: the fake CLI
// holds the click for 5.2s and the action still completes with one dispatch.
func TestComputerExecutorBridgeDefaultActWaitOutlivesReadWindow(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	selection := fixtureComputerSelection(deviceFixtureCredential())
	executor := newTestComputerExecutor(t, runtimeRoot, selection)
	pre := basicTree("@slong1:e1")
	post := fakeNode("window", "Fixture", "", nil, fakeNode("button", "Applied", "@slongpost1:e1", nil))
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Windows:         mustWindows(t, fixtureWindow()),
		Snapshots: []json.RawMessage{
			fakeSnapshotData("slong1", "w-4242", "Fixture", "Fixture App", pre),
			fakeSnapshotData("slongpost1", "w-4242", "Fixture", "Fixture App", post),
		},
		DelayMS:      5200,
		DelayCommand: "click",
	})
	_, run := startComputerExecutorBridge(t, executor)
	observationID, observation := observeFixture(t, run, "90000000-0000-4000-8000-000000000711", selection)
	ref := observationRef(t, observation, "button", "Apply")
	if ref == "" {
		t.Fatal("the observation had no button")
	}
	input := m1bComputerAct{Action: "click", ObservationID: observationID, Ref: ref, TimeoutMS: m1bComputerDefaultTimeout}
	authorizeFixtureAct(t, executor, selection, "call-slow", input, time.Minute)
	const actID = "90000000-0000-4000-8000-000000000712"
	start := time.Now()
	if err := run.socket.send([]byte(computerCommandJSON(actID, selection, fixtureHolder, false, "2030-01-01T00:00:00Z",
		computerActRequestJSON(t, "call-slow", map[string]any{
			"action": "click", "observation_id": observationID, "ref": ref,
		})))); err != nil {
		t.Fatal(err)
	}
	frame := nextComputerFrameWithin(t, run.socket, func(frame map[string]any) bool {
		return frame["type"] == "command.result" && frame["id"] == actID
	}, 15*time.Second)
	kind, result := typedComputerFrame(t, frame)
	if kind != "act" || result["ok"] != true || result["effect"] != computerEffectSmallChange {
		t.Fatalf("the default act wait was cut short: %+v", frame)
	}
	assertComputerActWire(t, result)
	if elapsed := time.Since(start); elapsed < 5*time.Second {
		t.Fatalf("the fixture action returned in %s; the 5s window was not exercised", elapsed)
	}
	if waited, _ := result["waited_ms"].(float64); waited < 5000 {
		t.Fatalf("waited_ms = %v; the default act wait was cut short", result["waited_ms"])
	}
	calls := readFakeCalls(t, runtimeRoot)
	if count := len(callsFor(calls, "click")); count != 1 {
		t.Fatalf("the slow action dispatched %d clicks", count)
	}
	assertNoForbiddenArgs(t, calls)
}

// TestComputerExecutorRenewalFencesThePreviousObservation proves the explicit
// renewal keeps the exact window/session but advances a private generation and
// clears the previous observation/proof, so the next act requires a fresh
// observation. A delayed observe that started before the renewal is rejected by
// the same generation. No driver process, CLI or native state is touched.
func TestComputerExecutorRenewalFencesThePreviousObservation(t *testing.T) {
	selection := fixtureComputerSelection(deviceFixtureCredential())
	executor := &computerExecutorDarwin{binding: selection}
	key := selection.bindingKey()
	executor.observed = key
	executor.pending = &computerHostAuthorization{selectionKey: key}
	generation, failure := executor.observeStart(selection)
	if failure != "" {
		t.Fatal(failure)
	}

	renewed := selection
	renewed.ExpiresAt = selection.ExpiresAt.Add(time.Minute)
	if err := executor.selectHostSelection(renewed); err != nil {
		t.Fatal(err)
	}
	if executor.generation == generation {
		t.Fatal("renewal did not advance the observation generation")
	}
	if executor.observed != "" || executor.pending != nil {
		t.Fatalf("renewal kept the previous observation/proof: observed=%q pending=%v", executor.observed, executor.pending)
	}
	if bound := executor.selection(); !bound.ExpiresAt.Equal(renewed.ExpiresAt) ||
		bound.bindingKey() != selection.bindingKey() {
		t.Fatalf("renewal changed the exact binding: %+v", bound)
	}

	// A stale observation from before the renewal can no longer mark refs.
	executor.mu.Lock()
	stale := executor.generation != generation
	executor.mu.Unlock()
	if !stale {
		t.Fatal("the pre-renewal observe generation survived")
	}

	// A repeat or shorter same-identity expiry is not a renewal.
	for name, expiry := range map[string]time.Time{
		"same": selection.ExpiresAt.Add(time.Minute),
		"old":  selection.ExpiresAt,
	} {
		candidate := selection
		candidate.ExpiresAt = expiry
		if err := executor.selectHostSelection(candidate); err == nil {
			t.Fatalf("%s expiry was accepted as a renewal", name)
		}
	}
	if bound := executor.selection(); !bound.ExpiresAt.Equal(renewed.ExpiresAt) {
		t.Fatalf("a refused renewal changed the binding: %+v", bound)
	}

	// After a fresh observe the new grant is actable again.
	executor.mu.Lock()
	executor.observed = selection.bindingKey()
	executor.mu.Unlock()
	input := m1bComputerAct{
		Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1",
		TimeoutMS: m1bComputerDefaultTimeout,
	}
	expiry, ok := executor.consumeAuthorization(renewed, "call-renewed", input)
	if ok {
		t.Fatal("a proof was consumed without being authorized after the renewal")
	}
	proof, err := newComputerHostAuthorization(renewed, "call-renewed", input, renewed.ExpiresAt)
	if err != nil {
		t.Fatal(err)
	}
	if err := executor.authorize(proof); err != nil {
		t.Fatal(err)
	}
	expiry, ok = executor.consumeAuthorization(renewed, "call-renewed", input)
	if !ok || expiry.IsZero() {
		t.Fatal("the fresh observation did not authorize the renewed grant")
	}
}

// TestComputerExecutorRenewalRejectsAStaleObservationExpiry proves a stale
// same-id observation admitted for the pre-renewal expiry can neither start nor
// finish against the renewed grant, and its delayed cleanup cannot clear a
// fresh observation completed after the renewal. Status and act preflights use
// the same exact expiry fence.
func TestComputerExecutorRenewalRejectsAStaleObservationExpiry(t *testing.T) {
	selection := fixtureComputerSelection(deviceFixtureCredential())
	executor := &computerExecutorDarwin{binding: selection}
	key := selection.bindingKey()
	executor.observed = key

	renewed := selection
	renewed.ExpiresAt = selection.ExpiresAt.Add(time.Minute)
	if err := executor.selectHostSelection(renewed); err != nil {
		t.Fatal(err)
	}
	if _, failure := executor.observeStart(selection); failure != computerExecutorTargetChanged {
		t.Fatalf("a stale observation captured the renewed generation: %q", failure)
	}
	if failure := executor.failure(selection, false); failure != computerExecutorTargetChanged {
		t.Fatalf("a stale status preflight was accepted: %q", failure)
	}
	if _, failure, _ := executor.actStart(selection); failure != computerExecutorTargetChanged {
		t.Fatalf("a stale act preflight was accepted: %q", failure)
	}
	generation, failure := executor.observeStart(renewed)
	if failure != "" {
		t.Fatalf("the renewed exact observation was rejected: %q", failure)
	}
	// Simulate a fresh observation completed under the renewed grant.
	executor.mu.Lock()
	executor.observed = key
	executor.mu.Unlock()
	executor.clearObserved(selection, generation)
	executor.mu.Lock()
	observed := executor.observed
	executor.mu.Unlock()
	if observed != key {
		t.Fatal("a delayed pre-renewal observation cleanup cleared the fresh observation")
	}
	if failure := executor.failure(renewed, true); failure != "" {
		t.Fatalf("the fresh renewed observation was not current: %q", failure)
	}
	executor.clearObserved(renewed, generation)
	executor.mu.Lock()
	observed = executor.observed
	executor.mu.Unlock()
	if observed != "" {
		t.Fatal("the exact renewed observation was not cleared")
	}
}

func computerWaitRequestJSON(t *testing.T, observationID, ref string, timeout *int) string {
	t.Helper()
	input := map[string]any{"observation_id": observationID, "ref": ref}
	if timeout != nil {
		input["timeout_ms"] = *timeout
	}
	data, err := json.Marshal(map[string]any{"kind": "wait", "input": input})
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// The bridge admits the exact read-only native wait and keeps the same
// observation actable. It needs no mutating proof and never captures a new
// snapshot or dispatches click/type.
func TestComputerExecutorBridgeWaitUsesExactArgsAndKeepsObservation(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	selection := fixtureComputerSelection(deviceFixtureCredential())
	executor := newTestComputerExecutor(t, runtimeRoot, selection)
	writeFakeScenario(t, runtimeRoot, basicScenario(t, "swait1", "@swait1:e1"))
	_, run := startComputerExecutorBridge(t, executor)
	observationID, observation := observeFixture(t, run, "90000000-0000-4000-8000-000000000901", selection)
	ref := observationRef(t, observation, "button", "Apply")
	if ref == "" {
		t.Fatal("the observation had no Apply button")
	}
	resetFakeCalls(t, runtimeRoot)

	timeout := 5000
	const waitID = "90000000-0000-4000-8000-000000000902"
	wait := sendComputerCommand(t, run, waitID, selection, fixtureHolder, false,
		computerWaitRequestJSON(t, observationID, ref, &timeout))
	kind, result := typedComputerFrame(t, wait)
	if kind != "wait" || result["result"] != computerWaitMet || result["waited_ms"] != float64(0) {
		t.Fatalf("the exact wait did not return met: %+v", wait)
	}
	if _, hasError := result["error"]; hasError {
		t.Fatalf("a met wait carried a failure: %+v", result)
	}
	if executor.observed == "" {
		t.Fatal("a met wait cleared the prior observation")
	}
	if computerConcreteDriver(t, executor).latest == nil {
		t.Fatal("a met wait dropped the driver observation")
	}
	calls := readFakeCalls(t, runtimeRoot)
	waitCalls := callsFor(calls, "wait")
	if len(waitCalls) != 1 {
		t.Fatalf("expected one wait process, got %d", len(waitCalls))
	}
	assertWaitExactArgs(t, waitCalls[0], computerConcreteDriver(t, executor).sessionID, ref, timeout)
	if len(callsFor(calls, "snapshot")) != 0 ||
		len(callsFor(calls, "click")) != 0 || len(callsFor(calls, "type")) != 0 {
		t.Fatal("a wait captured a snapshot or mutated")
	}
	assertNoForbiddenArgs(t, calls)
	assertNoWaitSpecificArgs(t, calls)
}

func TestComputerExecutorWaitNativePredicateTimeoutIsTimedOut(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	selection := fixtureComputerSelection(deviceFixtureCredential())
	executor := newTestComputerExecutor(t, runtimeRoot, selection)
	scenario := basicScenario(t, "swait2", "@swait2:e1")
	scenario.ActionError = map[string]json.RawMessage{"wait": mustJSON(t, map[string]any{
		"code": "TIMEOUT", "message": "SECRET wait text",
		"details": map[string]any{
			"kind": "wait_timeout", "ref": "@swait2:e1", "predicate": "actionable",
			"timeout_ms": m1bComputerDefaultTimeout, "last_observed": map[string]any{"actionable": false},
		},
		"disposition": map[string]any{"delivery": "not_delivered", "retry": "safe"},
	})}
	writeFakeScenario(t, runtimeRoot, scenario)
	_, run := startComputerExecutorBridge(t, executor)
	observationID, observation := observeFixture(t, run, "90000000-0000-4000-8000-000000000911", selection)
	ref := observationRef(t, observation, "button", "Apply")
	// Seed the exact pending click proof before the read-only wait against the
	// same prior observation: a typed timed_out must leave it consumable.
	clickInput := m1bComputerAct{
		Action: "click", ObservationID: observationID, Ref: ref, TimeoutMS: m1bComputerDefaultTimeout,
	}
	authorizeFixtureAct(t, executor, selection, "call-wait-timeout-proof", clickInput, time.Minute)
	resetFakeCalls(t, runtimeRoot)

	const waitID = "90000000-0000-4000-8000-000000000912"
	wait := sendComputerCommand(t, run, waitID, selection, fixtureHolder, false,
		computerWaitRequestJSON(t, observationID, ref, nil))
	kind, result := typedComputerFrame(t, wait)
	if kind != "wait" || result["result"] != computerWaitTimedOut ||
		result["waited_ms"] != float64(m1bComputerDefaultTimeout) {
		t.Fatalf("a native predicate expiry was not timed_out: %+v", wait)
	}
	if _, hasError := result["error"]; hasError {
		t.Fatalf("a native predicate expiry was classified as a failure: %+v", result)
	}
	if executor.observed == "" || computerConcreteDriver(t, executor).latest == nil {
		t.Fatal("a native predicate expiry must keep the observation")
	}
	if len(callsFor(readFakeCalls(t, runtimeRoot), "wait")) != 1 {
		t.Fatal("a predicate expiry was retried")
	}
	// The typed timed_out result must not have consumed or invalidated the
	// exact pending click proof seeded before the wait.
	expiry, ok := executor.consumeAuthorization(selection, "call-wait-timeout-proof", clickInput)
	if !ok || expiry.IsZero() {
		t.Fatal("a timed_out predicate wait consumed the pending act proof")
	}
}

// A wait blocked in the driver mutex is canceled before synchronous
// invalidation/close waits for that mutex. Invalidation returns only after the
// child is gone, and the canceled wait publishes no success.
func TestComputerExecutorWaitCancellationPrecedesSynchronousInvalidation(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	selection := fixtureComputerSelection(deviceFixtureCredential())
	executor := newTestComputerExecutor(t, runtimeRoot, selection)
	scenario := basicScenario(t, "scancel1", "@scancel1:e1")
	scenario.DelayMS = 30000
	scenario.DelayCommand = "wait"
	writeFakeScenario(t, runtimeRoot, scenario)

	observation := executor.observe(context.Background(), selection)
	if observation.kind != "observe" {
		t.Fatalf("observe failed: %+v", observation)
	}
	ref := typedObservationRef(observation.observation, "button", "Apply")
	if ref == "" {
		t.Fatal("the observation had no ref")
	}
	resetFakeCalls(t, runtimeRoot)
	type outcome struct {
		result m1bComputerResult
	}
	finished := make(chan outcome, 1)
	go func() {
		finished <- outcome{result: executor.wait(context.Background(), selection, m1bComputerWait{
			ObservationID: observation.observation.ObservationID, Ref: ref, TimeoutMS: m1bComputerMaxTimeout,
		})}
	}()
	waitForFakeCommand(t, runtimeRoot, "wait")
	waitCalls := callsFor(readFakeCalls(t, runtimeRoot), "wait")
	if len(waitCalls) != 1 {
		t.Fatalf("expected one wait process, got %d", len(waitCalls))
	}
	start := time.Now()
	executor.invalidate(selection)
	select {
	case got := <-finished:
		if got.result.kind == "wait" {
			t.Fatalf("a canceled wait published a result: %+v", got.result)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("invalidation did not release the driver mutex")
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("invalidation waited too long: %s", elapsed)
	}
	assertProcessGone(t, waitCalls[0].PID, "invalidated wait")
}

// A same-binding renewal cancels the wait before the driver mutex is touched,
// advances the generation, and returns no pre-renewal success.
func TestComputerExecutorWaitRenewalCancelsBeforeFence(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	selection := fixtureComputerSelection(deviceFixtureCredential())
	executor := newTestComputerExecutor(t, runtimeRoot, selection)
	scenario := basicScenario(t, "srenew1", "@srenew1:e1")
	scenario.DelayMS = 30000
	scenario.DelayCommand = "wait"
	writeFakeScenario(t, runtimeRoot, scenario)
	observation := executor.observe(context.Background(), selection)
	if observation.kind != "observe" {
		t.Fatalf("observe failed: %+v", observation)
	}
	ref := typedObservationRef(observation.observation, "button", "Apply")
	resetFakeCalls(t, runtimeRoot)
	finished := make(chan m1bComputerResult, 1)
	go func() {
		finished <- executor.wait(context.Background(), selection, m1bComputerWait{
			ObservationID: observation.observation.ObservationID, Ref: ref, TimeoutMS: m1bComputerMaxTimeout,
		})
	}()
	waitForFakeCommand(t, runtimeRoot, "wait")
	waitCalls := callsFor(readFakeCalls(t, runtimeRoot), "wait")
	if len(waitCalls) != 1 {
		t.Fatalf("expected one wait process, got %d", len(waitCalls))
	}
	renewed := selection
	renewed.ExpiresAt = selection.ExpiresAt.Add(time.Minute)
	if err := executor.selectHostSelection(renewed); err != nil {
		t.Fatal(err)
	}
	select {
	case result := <-finished:
		if result.kind == "wait" {
			t.Fatalf("a pre-renewal wait published success: %+v", result)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("renewal did not cancel the wait")
	}
	assertProcessGone(t, waitCalls[0].PID, "renewed wait")
}

// A fake driver that ignores cancellation and returns a late success after the
// executor generation advanced cannot be published. The fence is the same
// binding, observation, generation, and live wait context.
func TestComputerExecutorWaitFencesLateFakeSuccess(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(t *testing.T, executor *computerExecutorDarwin, selection m1bComputerSelection, deadline context.Context)
	}{
		{
			name: "exact renewal",
			change: func(t *testing.T, executor *computerExecutorDarwin, selection m1bComputerSelection, _ context.Context) {
				renewed := selection
				renewed.ExpiresAt = selection.ExpiresAt.Add(time.Minute)
				if err := executor.selectHostSelection(renewed); err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "invalidate",
			change: func(t *testing.T, executor *computerExecutorDarwin, selection m1bComputerSelection, _ context.Context) {
				executor.invalidate(selection)
			},
		},
		{
			name: "expiry",
			change: func(t *testing.T, _ *computerExecutorDarwin, _ m1bComputerSelection, deadline context.Context) {
				<-deadline.Done()
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			runtimeRoot, _ := newFakeRuntime(t)
			selection := fixtureComputerSelection(deviceFixtureCredential())
			executor := newTestComputerExecutor(t, runtimeRoot, selection)
			scenario := basicScenario(t, "sfake1", "@sfake1:e1")
			writeFakeScenario(t, runtimeRoot, scenario)
			concrete := computerConcreteDriver(t, executor)
			late := &lateWaitDriver{
				computerDriver: concrete,
				started:        make(chan struct{}, 1),
				release:        make(chan struct{}),
				result:         computerWaitResult{Result: computerWaitMet, WaitedMS: 1},
			}
			executor.driver = late
			observation := executor.observe(context.Background(), selection)
			if observation.kind != "observe" {
				t.Fatalf("observe failed: %+v", observation)
			}
			ref := typedObservationRef(observation.observation, "button", "Apply")
			ctx := context.Background()
			var cancel context.CancelFunc
			if test.name == "expiry" {
				ctx, cancel = context.WithTimeout(context.Background(), 50*time.Millisecond)
				defer cancel()
			}
			finished := make(chan m1bComputerResult, 1)
			go func() {
				finished <- executor.wait(ctx, selection, m1bComputerWait{
					ObservationID: observation.observation.ObservationID, Ref: ref, TimeoutMS: m1bComputerDefaultTimeout,
				})
			}()
			select {
			case <-late.started:
			case <-time.After(5 * time.Second):
				t.Fatal("the fake wait did not start")
			}
			test.change(t, executor, selection, ctx)
			close(late.release)
			select {
			case result := <-finished:
				if result.kind == "wait" {
					t.Fatalf("a late fake success was published: %+v", result)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("the late fake success was not fenced")
			}
		})
	}
}

type lateWaitDriver struct {
	*computerDriver
	started chan struct{}
	release chan struct{}
	result  computerWaitResult
}

func (driver *lateWaitDriver) Wait(context.Context, computerWaitRequest) (computerWaitResult, error) {
	select {
	case driver.started <- struct{}{}:
	default:
	}
	// Deliberately ignore cancellation to model a driver that reports success
	// after the parent has already canceled or rebound the selection.
	<-driver.release
	return driver.result, nil
}

// A wait is read-only: it needs no computerHostAuthorization and does not
// consume a proof already issued for a following act.
func TestComputerExecutorWaitDoesNotConsumeActProof(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	selection := fixtureComputerSelection(deviceFixtureCredential())
	executor := newTestComputerExecutor(t, runtimeRoot, selection)
	writeFakeScenario(t, runtimeRoot, basicScenario(t, "sproof1", "@sproof1:e1"))
	observation := executor.observe(context.Background(), selection)
	if observation.kind != "observe" {
		t.Fatalf("observe failed: %+v", observation)
	}
	ref := typedObservationRef(observation.observation, "button", "Apply")
	actInput := m1bComputerAct{
		Action: "click", ObservationID: observation.observation.ObservationID, Ref: ref,
		TimeoutMS: m1bComputerDefaultTimeout,
	}
	authorizeFixtureAct(t, executor, selection, "call-proof", actInput, time.Minute)

	wait := executor.wait(context.Background(), selection, m1bComputerWait{
		ObservationID: observation.observation.ObservationID, Ref: ref, TimeoutMS: 1000,
	})
	if wait.kind != "wait" || wait.wait.Result != computerWaitMet {
		t.Fatalf("the read-only wait failed: %+v", wait)
	}
	expiry, ok := executor.consumeAuthorization(selection, "call-proof", actInput)
	if !ok || expiry.IsZero() {
		t.Fatal("the wait consumed the act proof")
	}
}

// The gate's act slot stays idle during a read-only wait, so a same-binding
// renewal can cancel that wait instead of inheriting mutating-act semantics.
func TestComputerGateWaitKeepsActBusyForActsOnly(t *testing.T) {
	selection := fixtureComputerSelection(deviceFixtureCredential())
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	executor := &controlTestExecutor{
		binding: selection, waitStarted: started, waitRelease: release,
	}
	gate := &computerExecutorGate{}
	gate.install(executor)
	finished := make(chan m1bComputerResult, 1)
	go func() {
		finished <- gate.wait(context.Background(), selection, m1bComputerWait{
			ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: m1bComputerDefaultTimeout,
		})
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("the gate wait did not start")
	}
	if gate.busy() {
		t.Fatal("a read-only wait occupied the act busy slot")
	}
	if _, authorizations, _ := executor.snapshot(); authorizations != 0 {
		t.Fatal("a read-only wait required a mutating authorization")
	}
	close(release)
	select {
	case result := <-finished:
		if result.kind != "wait" || result.wait.Result != computerWaitMet {
			t.Fatalf("the gate wait did not return met: %+v", result)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the gate wait did not finish")
	}
	if gate.busy() {
		t.Fatal("a wait left the act busy slot set")
	}
}

// A local pause/stop quiesce closes input and synchronously invalidates the
// exact selection. The invalidate cancels the wait before trying to acquire the
// driver mutex, so the quiesce proof returns promptly and no wait success is
// published after the boundary closes.
func TestComputerGateQuiesceCancelsWaitBeforeInvalidate(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	selection := fixtureComputerSelection(deviceFixtureCredential())
	executor := newTestComputerExecutor(t, runtimeRoot, selection)
	scenario := basicScenario(t, "squiesce1", "@squiesce1:e1")
	scenario.DelayMS = 30000
	scenario.DelayCommand = "wait"
	writeFakeScenario(t, runtimeRoot, scenario)
	observation := executor.observe(context.Background(), selection)
	if observation.kind != "observe" {
		t.Fatalf("observe failed: %+v", observation)
	}
	ref := typedObservationRef(observation.observation, "button", "Apply")
	gate := &computerExecutorGate{}
	gate.install(executor)
	resetFakeCalls(t, runtimeRoot)
	finished := make(chan m1bComputerResult, 1)
	go func() {
		finished <- gate.wait(context.Background(), selection, m1bComputerWait{
			ObservationID: observation.observation.ObservationID, Ref: ref, TimeoutMS: m1bComputerMaxTimeout,
		})
	}()
	waitForFakeCommand(t, runtimeRoot, "wait")
	waitCalls := callsFor(readFakeCalls(t, runtimeRoot), "wait")
	if len(waitCalls) != 1 {
		t.Fatalf("expected one wait process, got %d", len(waitCalls))
	}
	start := time.Now()
	quiesce := gate.quiesce(context.Background(), executor, selection)
	select {
	case quiesced := <-quiesce:
		if !quiesced {
			t.Fatal("the quiesce did not prove the wait terminal")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("quiesce blocked on the driver mutex")
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("quiesce took %s", elapsed)
	}
	select {
	case result := <-finished:
		if result.kind == "wait" {
			t.Fatalf("a paused/stopped wait published success: %+v", result)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the quiesced wait did not return")
	}
	assertProcessGone(t, waitCalls[0].PID, "quiesced wait")
}

// Close is the logout/teardown path. It cancels the in-flight wait before
// waiting on the same driver mutex, then marks the driver closed so no late
// result can be attributed afterwards.
func TestComputerExecutorCloseCancelsWaitBeforeDriverMutex(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	selection := fixtureComputerSelection(deviceFixtureCredential())
	executor := newTestComputerExecutor(t, runtimeRoot, selection)
	scenario := basicScenario(t, "sclose1", "@sclose1:e1")
	scenario.DelayMS = 30000
	scenario.DelayCommand = "wait"
	writeFakeScenario(t, runtimeRoot, scenario)
	observation := executor.observe(context.Background(), selection)
	if observation.kind != "observe" {
		t.Fatalf("observe failed: %+v", observation)
	}
	ref := typedObservationRef(observation.observation, "button", "Apply")
	resetFakeCalls(t, runtimeRoot)
	finished := make(chan m1bComputerResult, 1)
	go func() {
		finished <- executor.wait(context.Background(), selection, m1bComputerWait{
			ObservationID: observation.observation.ObservationID, Ref: ref, TimeoutMS: m1bComputerMaxTimeout,
		})
	}()
	waitForFakeCommand(t, runtimeRoot, "wait")
	waitCalls := callsFor(readFakeCalls(t, runtimeRoot), "wait")
	if len(waitCalls) != 1 {
		t.Fatalf("expected one wait process, got %d", len(waitCalls))
	}
	closed := make(chan error, 1)
	start := time.Now()
	go func() { closed <- executor.close() }()
	select {
	case err := <-closed:
		if err != nil {
			t.Fatalf("close failed: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("close blocked on the driver mutex")
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("close took %s", elapsed)
	}
	select {
	case result := <-finished:
		if result.kind == "wait" {
			t.Fatalf("a closed executor published wait success: %+v", result)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the closed wait did not return")
	}
	assertProcessGone(t, waitCalls[0].PID, "closed wait")
}
