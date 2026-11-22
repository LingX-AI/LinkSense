//go:build darwin

package main

// These fixtures close the publication race with the real product lifecycle:
// the macOS gate, host, control state machine and device connection run here,
// and only the socket write is paused. The same exact grant's cancellation
// must reach both the executor work context and the final result write.

import (
	"context"
	"encoding/json"
	"fmt"
	"sync/atomic"
	"testing"
	"time"
)

type waitPublicationHarness struct {
	*controlHarness
	selection m1bComputerSelection
	link      *m1bComputerLink
}

// newWaitPublicationHarness installs the real acknowledged selection, adopts
// the fixture holder on the real host, and opens one synthetic socket view with
// a controllable write. Control transitions still run through the real gate and
// controller; no driver, AX, GUI or real socket write is used.
func newWaitPublicationHarness(t *testing.T, executor *controlTestExecutor) *waitPublicationHarness {
	t.Helper()
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
		executor: func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
			return executor, nil
		},
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	selectActiveTarget(t, harness, platform)
	selection := executor.selection()
	host := harness.control.host
	token := host.open()
	host.mu.Lock()
	host.selectionBinding = selection.bindingKey()
	host.selectionHolder = controlHolder
	host.selectionHasHolder = true
	host.selectionClosed = false
	host.mu.Unlock()
	link := &m1bComputerLink{
		connection: harness.connection, host: host, token: token,
		linkID: selection.LinkID, ctx: harness.connection.ctx,
	}
	return &waitPublicationHarness{
		controlHarness: harness, selection: selection, link: link,
	}
}

func (h *waitPublicationHarness) dispatchWait(t *testing.T, id string, selection m1bComputerSelection, observationID, ref string) {
	t.Helper()
	request := fmt.Sprintf(`{"kind":"wait","input":{"observation_id":%q,"ref":%q,"timeout_ms":1000}}`,
		observationID, ref)
	frame := computerCommandJSON(id, selection, controlHolder, false,
		time.Now().Add(5*time.Minute).UTC().Format(time.RFC3339Nano), request)
	if !interceptM1BComputerFrame(h.link, []byte(frame)) {
		t.Fatal("the wait frame was not consumed by the product host")
	}
}

func waitPublicationDone(t *testing.T, host *m1bComputerHost) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		host.mu.Lock()
		active, last := host.active, host.last
		host.mu.Unlock()
		if active == nil && last == nil {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the wait publication did not settle")
}

func resultFrame(t *testing.T, raw []byte) (string, map[string]any) {
	t.Helper()
	var frame map[string]any
	if err := json.Unmarshal(raw, &frame); err != nil {
		t.Fatalf("the result frame is not JSON: %v", err)
	}
	if frame["type"] != "command.result" || frame["operation"] != m1bComputerOperation {
		t.Fatalf("unexpected result frame: %+v", frame)
	}
	result, _ := frame["result"].(map[string]any)
	kind, _ := result["kind"].(string)
	return kind, result
}

// A same-id renewal commits while the pre-renewal wait result is paused in its
// bounded final write. The real gate must cancel that grant's publication
// context before the transition, so the resumed write cannot publish the old
// met success. The renewed exact grant then requires a fresh observe, and only
// that current grant can publish.
func TestComputerWaitRenewalClosesBlockedPublicationAndFreshObserve(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	stateParent := t.TempDir()
	executors := make(chan *computerExecutorDarwin, 1)
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	platform.executor = func(ctx context.Context, _ *Desktop, _ computerSelectedTarget, selection m1bComputerSelection) (computerProductExecutor, error) {
		executor, err := newComputerExecutorDarwin(ctx, fixtureTarget(), selection, runtimeRoot, stateParent, preparedProof())
		if err != nil {
			return nil, err
		}
		if driver, ok := executor.driver.(*computerDriver); ok {
			driver.environment = append(driver.environment, "GORACE=atexit_sleep_ms=0")
		}
		executors <- executor
		return executor, nil
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	selectActiveTarget(t, harness, platform)
	var executor *computerExecutorDarwin
	select {
	case executor = <-executors:
	case <-time.After(5 * time.Second):
		t.Fatal("the product executor was not constructed")
	}
	t.Cleanup(func() { _ = executor.close() })
	writeFakeScenario(t, runtimeRoot, basicScenario(t, "sint1", "@sint1:e1"))

	selection := executor.selection()
	observed := harness.control.gate.observe(context.Background(), selection)
	if observed.kind != "observe" {
		t.Fatalf("the exact observation was not admitted: %+v", observed)
	}
	ref := typedObservationRef(observed.observation, "button", "Apply")
	if ref == "" {
		t.Fatalf("the observation had no button: %+v", observed.observation)
	}
	observationID := observed.observation.ObservationID
	host := harness.control.host
	token := host.open()
	host.mu.Lock()
	host.selectionBinding = selection.bindingKey()
	host.selectionHolder = controlHolder
	host.selectionHasHolder = true
	host.selectionClosed = false
	host.mu.Unlock()
	link := &m1bComputerLink{
		connection: harness.connection, host: host, token: token,
		linkID: selection.LinkID, ctx: harness.connection.ctx,
	}

	entered, release := make(chan struct{}), make(chan struct{})
	var oldPublished atomic.Bool
	link.write = func(ctx context.Context, _ []byte) error {
		close(entered)
		<-release
		if err := ctx.Err(); err != nil {
			return err
		}
		oldPublished.Store(true)
		return nil
	}
	const oldWaitID = "90000000-0000-4000-8000-000000000981"
	frame := computerCommandJSON(oldWaitID, selection, controlHolder, false,
		time.Now().Add(5*time.Minute).UTC().Format(time.RFC3339Nano),
		fmt.Sprintf(`{"kind":"wait","input":{"observation_id":%q,"ref":%q,"timeout_ms":1000}}`, observationID, ref))
	if !interceptM1BComputerFrame(link, []byte(frame)) {
		t.Fatal("the wait frame was not consumed by the product host")
	}
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("the wait did not reach final publication")
	}
	renewFrame, renewResults := startComputerRenew(t, harness)
	renewedExpiry := selection.ExpiresAt.Add(time.Minute)
	sendControlAck(t, harness.socket, renewFrame["id"].(string), computerControlStateActive,
		controlSession, selection.SelectionID, controlGeneration, renewedExpiry)
	if result := awaitControl(t, renewResults); result.err != nil {
		t.Fatalf("the exact renewal did not commit: %+v", result)
	}
	close(release)
	waitPublicationDone(t, host)
	if oldPublished.Load() {
		t.Fatal("a pre-renewal wait success was published after the exact grant advanced")
	}

	frames := make(chan []byte, 4)
	link.write = func(ctx context.Context, data []byte) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		frames <- append([]byte(nil), data...)
		return nil
	}
	renewed := executor.selection()
	if !renewed.ExpiresAt.Equal(renewedExpiry) {
		t.Fatalf("the renewed binding did not advance: %+v", renewed)
	}
	// The renewed exact grant is a new observation generation. A wait without a
	// fresh observe is fenced by the product executor; only the observation
	// taken after the renewal can publish success.
	const staleWaitID = "90000000-0000-4000-8000-000000000982"
	frame = computerCommandJSON(staleWaitID, renewed, controlHolder, false,
		time.Now().Add(5*time.Minute).UTC().Format(time.RFC3339Nano),
		fmt.Sprintf(`{"kind":"wait","input":{"observation_id":%q,"ref":%q,"timeout_ms":1000}}`, observationID, ref))
	if !interceptM1BComputerFrame(link, []byte(frame)) {
		t.Fatal("the stale-observation wait frame was not consumed")
	}
	select {
	case raw := <-frames:
		kind, result := resultFrame(t, raw)
		if kind != "failure" || result["error"] != "COMPUTER_TARGET_CHANGED" {
			t.Fatalf("a renewed grant accepted its pre-renewal observation: %+v", result)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the stale-observation wait did not settle")
	}

	fresh := harness.control.gate.observe(context.Background(), renewed)
	if fresh.kind != "observe" {
		t.Fatalf("the renewed observation was not admitted: %+v", fresh)
	}
	freshRef := typedObservationRef(fresh.observation, "button", "Apply")
	if freshRef == "" {
		t.Fatal("the renewed observation had no button")
	}
	enteredFresh, releaseFresh := make(chan struct{}), make(chan struct{})
	var freshPublished atomic.Bool
	link.write = func(ctx context.Context, _ []byte) error {
		close(enteredFresh)
		<-releaseFresh
		if err := ctx.Err(); err != nil {
			return err
		}
		freshPublished.Store(true)
		return nil
	}
	const freshWaitID = "90000000-0000-4000-8000-000000000983"
	frame = computerCommandJSON(freshWaitID, renewed, controlHolder, false,
		time.Now().Add(5*time.Minute).UTC().Format(time.RFC3339Nano),
		fmt.Sprintf(`{"kind":"wait","input":{"observation_id":%q,"ref":%q,"timeout_ms":1000}}`,
			fresh.observation.ObservationID, freshRef))
	if !interceptM1BComputerFrame(link, []byte(frame)) {
		t.Fatal("the fresh wait frame was not consumed")
	}
	select {
	case <-enteredFresh:
	case <-time.After(5 * time.Second):
		t.Fatal("the fresh wait did not reach publication")
	}
	// An expiry carrying the superseded grant expiry is stale: it must not
	// cancel the read admitted under the current renamed grant.
	harness.control.expire(selection.SelectionID, selection.ExpiresAt)
	if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateActive {
		t.Fatalf("a stale expiry changed the renewed state: %+v", status)
	}
	close(releaseFresh)
	waitPublicationDone(t, host)
	if !freshPublished.Load() {
		t.Fatal("a stale expiry canceled the current renewed-grant publication")
	}
}

// Local pause closes the exact input and cancels its grant before the server
// acknowledgement. A wait result paused in the final write must therefore be
// suppressed even when the quiesce is local-only.
func TestComputerWaitPauseClosesBlockedPublicationBeforeAck(t *testing.T) {
	executor := &controlTestExecutor{}
	h := newWaitPublicationHarness(t, executor)
	entered, release := make(chan struct{}), make(chan struct{})
	var published atomic.Bool
	h.link.write = func(ctx context.Context, _ []byte) error {
		close(entered)
		<-release
		if err := ctx.Err(); err != nil {
			return err
		}
		published.Store(true)
		return nil
	}
	h.dispatchWait(t, "90000000-0000-4000-8000-000000000986", h.selection, "obs-1", "@obs-1:e1")
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("the wait did not reach final publication")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pauseResults := controlAsync(ctx, h.desktop, "pause")
	pauseFrame := nextControlFrame(t, h.socket, computerControlRequestType)
	close(release)
	waitPublicationDone(t, h.control.host)
	if published.Load() {
		t.Fatal("a wait success was published after local pause closed its exact grant")
	}
	sendControlAck(t, h.socket, pauseFrame["id"].(string), computerControlStatePaused,
		controlSession, h.selection.SelectionID, controlGeneration, h.grantExpiry)
	if result := awaitControl(t, pauseResults); result.err != nil || result.status.State != computerControlStatePaused {
		t.Fatalf("the proven pause did not settle: %+v", result)
	}
	if h.control.gate.open() {
		t.Fatal("pause left the exact input open")
	}
}

// An actual native controller stop begins the exact retirement while a wait
// result is paused in its final write. The retirement closes the exact input
// and cancels that grant synchronously, so the resumed write cannot publish the
// old met success before the server acknowledgement, and the exact stopped
// terminal is published only through the proven retirement.
func TestComputerWaitStopClosesBlockedPublicationBeforeAck(t *testing.T) {
	executor := &controlTestExecutor{closedDone: make(chan struct{})}
	h := newWaitPublicationHarness(t, executor)
	entered, release := make(chan struct{}), make(chan struct{})
	var published atomic.Bool
	h.link.write = func(ctx context.Context, _ []byte) error {
		close(entered)
		<-release
		if err := ctx.Err(); err != nil {
			return err
		}
		published.Store(true)
		return nil
	}
	h.dispatchWait(t, "90000000-0000-4000-8000-000000000988", h.selection, "obs-1", "@obs-1:e1")
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("the wait did not reach final publication")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stopResults := controlAsync(ctx, h.desktop, "stop")
	stopFrame := nextControlFrame(t, h.socket, computerControlRequestType)
	close(release)
	waitPublicationDone(t, h.control.host)
	if published.Load() {
		t.Fatal("a wait success was published after stop closed its exact grant")
	}
	sendControlAck(t, h.socket, stopFrame["id"].(string), computerControlStateStopped,
		controlSession, h.selection.SelectionID, controlGeneration, h.grantExpiry)
	if result := awaitControl(t, stopResults); result.err != nil || result.status.State != computerControlStateStopped {
		t.Fatalf("the proven stop did not settle: %+v", result)
	}
	status := waitComputerStatus(t, h.control, h.desktop, controlConversation, controlTurn,
		computerControlStateStopped)
	if status.State != computerControlStateStopped {
		t.Fatalf("the stopped terminal was not published: %+v", status)
	}
	h.control.mu.Lock()
	terminal := h.control.terminal
	h.control.mu.Unlock()
	if terminal.ConversationID != controlConversation || terminal.TurnID != controlTurn ||
		terminal.OwnerID != h.selection.OwnerID || terminal.LinkID != h.selection.LinkID {
		t.Fatalf("the stopped terminal did not retain the exact scope/owner/link: %+v", terminal)
	}
	executor.mu.Lock()
	closed := executor.closed
	executor.mu.Unlock()
	if !closed {
		t.Fatal("the proven stop did not close the exact executor")
	}
	if h.control.gate.open() {
		t.Fatal("stop left the exact input open")
	}
}

// Local expiry uses the same synchronous retirement close. A wait result
// blocked in the write path cannot turn into a late success.
func TestComputerWaitExpiryClosesBlockedPublication(t *testing.T) {
	executor := &controlTestExecutor{}
	h := newWaitPublicationHarness(t, executor)
	entered, release := make(chan struct{}), make(chan struct{})
	var published atomic.Bool
	h.link.write = func(ctx context.Context, _ []byte) error {
		close(entered)
		<-release
		if err := ctx.Err(); err != nil {
			return err
		}
		published.Store(true)
		return nil
	}
	h.dispatchWait(t, "90000000-0000-4000-8000-000000000987", h.selection, "obs-1", "@obs-1:e1")
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("the wait did not reach final publication")
	}
	h.control.expire(h.selection.SelectionID, h.selection.ExpiresAt)
	close(release)
	waitPublicationDone(t, h.control.host)
	if published.Load() {
		t.Fatal("a wait success was published after local expiry closed its exact grant")
	}
	waitComputerStatus(t, h.control, h.desktop, controlConversation, controlTurn, computerControlStateStopped)
}

// A local quiesce carrying the prior expiry after a same-identity renewal is
// stale. Through the real gate it must leave the renewed grant exactly as it
// is: input open, the fresh observation retained, the grant publication
// lifetime uncanceled and an admitted wait still running. Only the exact
// current snapshot may close the boundary and cancel that wait before the
// driver mutex wait.
func TestComputerGateStaleQuiesceKeepsRenewedGrant(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	selection := fixtureComputerSelection(deviceFixtureCredential())
	executor := newTestComputerExecutor(t, runtimeRoot, selection)
	scenario := basicScenario(t, "swaitstale1", "@swaitstale1:e1")
	scenario.DelayMS = 30000
	scenario.DelayCommand = "wait"
	writeFakeScenario(t, runtimeRoot, scenario)

	gate := &computerExecutorGate{}
	gate.install(executor)
	prior := selection
	renewed := selection
	renewed.ExpiresAt = prior.ExpiresAt.Add(time.Minute)
	if err := gate.renew(executor, renewed); err != nil {
		t.Fatalf("the same-identity renewal was refused: %v", err)
	}
	observed := gate.observe(context.Background(), renewed)
	if observed.kind != "observe" {
		t.Fatalf("the renewed observation was not admitted: %+v", observed)
	}
	ref := typedObservationRef(observed.observation, "button", "Apply")
	if ref == "" {
		t.Fatalf("the renewed observation had no button: %+v", observed.observation)
	}
	grant, ok := gate.waitPublicationContext(renewed)
	if !ok || grant == nil {
		t.Fatal("the renewed grant exposed no publication lifetime")
	}

	resetFakeCalls(t, runtimeRoot)
	finished := make(chan m1bComputerResult, 1)
	go func() {
		finished <- gate.wait(context.Background(), renewed, m1bComputerWait{
			ObservationID: observed.observation.ObservationID, Ref: ref, TimeoutMS: m1bComputerMaxTimeout,
		})
	}()
	waitForFakeCommand(t, runtimeRoot, "wait")
	waitCalls := callsFor(readFakeCalls(t, runtimeRoot), "wait")
	if len(waitCalls) != 1 {
		t.Fatalf("expected one wait process, got %d", len(waitCalls))
	}

	quiesced := <-gate.quiesce(context.Background(), executor, prior)
	if !quiesced {
		t.Fatal("the stale quiesce did not release its wait")
	}
	if !gate.open() {
		t.Error("a stale prior-expiry quiesce closed the renewed input")
	}
	if grant.Err() != nil {
		t.Error("a stale prior-expiry quiesce canceled the renewed publication lifetime")
	}
	executor.mu.Lock()
	observedKey := executor.observed
	executor.mu.Unlock()
	if observedKey != renewed.bindingKey() {
		t.Errorf("a stale prior-expiry quiesce cleared the fresh observation: %q", observedKey)
	}
	select {
	case result := <-finished:
		t.Errorf("a stale prior-expiry quiesce canceled the current renewed wait: %+v", result)
	case <-time.After(250 * time.Millisecond):
	}

	// The exact current snapshot still closes and cancels before terminal wait.
	start := time.Now()
	current := gate.quiesce(context.Background(), executor, renewed)
	select {
	case quiesced := <-current:
		if !quiesced {
			t.Fatal("the exact current quiesce was not terminal")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the exact current quiesce blocked on the driver mutex")
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("the exact current quiesce took %s", elapsed)
	}
	if gate.open() {
		t.Error("the exact current quiesce left input open")
	}
	if grant.Err() == nil {
		t.Error("the exact current quiesce did not cancel the renewal's publication lifetime")
	}
	select {
	case result := <-finished:
		if result.kind == "wait" {
			t.Errorf("the exact current quiesce let a wait publish success: %+v", result)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the exact current quiesce left the wait running")
	}
	assertProcessGone(t, waitCalls[0].PID, "quiesced renewed wait")
}
