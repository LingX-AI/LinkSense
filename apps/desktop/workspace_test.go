package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"
)

const (
	workspaceRequestFixture    = "30000000-0000-4000-8000-000000000001"
	workspaceOwnerFixture      = "40000000-0000-4000-8000-000000000001"
	otherWorkspaceOwnerFixture = "40000000-0000-4000-8000-000000000009"
	workspaceConversation      = "40000000-0000-4000-8000-000000000002"
)

func pendingUsage(reply chan json.RawMessage) *pendingWorkspaceRequest {
	return &pendingWorkspaceRequest{
		reply: reply, messageType: workspaceUsageRequestType, resultType: workspaceUsageResultType,
	}
}

func pendingCleanup(reply chan json.RawMessage) *pendingWorkspaceRequest {
	return &pendingWorkspaceRequest{
		reply: reply, messageType: workspaceCleanupRequestType, resultType: workspaceCleanupResultType,
	}
}

func TestWorkspaceResultsReachTheirPendingRequestAndRejectExtraFields(t *testing.T) {
	pipe := &runtimePipe{done: make(chan struct{}), requests: map[string]*pendingWorkspaceRequest{}}
	reply := make(chan json.RawMessage, 1)
	pipe.requests[workspaceRequestFixture] = pendingUsage(reply)
	usage := fmt.Sprintf(`{"type":"workspace.usage.result","request_id":"%s","ok":true,`+
		`"usage":{"bytes":2048,"files":4,"sessions":1,"retention_days":14,"budget_bytes":10737418240}}`,
		workspaceRequestFixture)
	if !pipe.deliver(usage) {
		t.Fatal("a valid workspace usage result was rejected")
	}
	select {
	case raw := <-reply:
		message, err := parseWorkspaceResult(raw, workspaceUsageResultType)
		if err != nil || !message.OK || message.Usage == nil || message.Usage.Files != 4 {
			t.Fatalf("workspace usage result did not round-trip: %v", err)
		}
	default:
		t.Fatal("workspace usage result did not reach its pending request")
	}
	if _, pending := pipe.requests[workspaceRequestFixture]; pending {
		t.Fatal("a delivered workspace request stayed pending")
	}

	for _, invalid := range []string{
		fmt.Sprintf(`{"type":"workspace.usage.result","request_id":"%s","ok":true,"usage":`+
			`{"bytes":0,"files":0,"sessions":0,"retention_days":14,"budget_bytes":1},"path":"/tmp"}`, workspaceRequestFixture),
		fmt.Sprintf(`{"type":"workspace.usage.result","request_id":"%s","ok":true,"usage":`+
			`{"bytes":-1,"files":0,"sessions":0,"retention_days":14,"budget_bytes":1}}`, workspaceRequestFixture),
		fmt.Sprintf(`{"type":"workspace.cleanup.result","request_id":"%s","ok":true,"cleanup":`+
			`{"status":"deleted","deleted_sessions":0,"freed_bytes":0,"retained_bytes":0}}`, workspaceRequestFixture),
		fmt.Sprintf(`{"type":"workspace.usage.result","request_id":"%s","ok":false,"error_code":"FORBIDDEN"}`, workspaceRequestFixture),
		fmt.Sprintf(`{"type":"workspace.usage.result","request_id":"%s","ok":true}`, workspaceRequestFixture),
	} {
		if pipe.deliver(invalid) {
			t.Fatalf("accepted an invalid workspace result: %s", invalid)
		}
	}
}

func TestWorkspaceResultTypeMustMatchThePendingRequest(t *testing.T) {
	pipe := &runtimePipe{done: make(chan struct{}), requests: map[string]*pendingWorkspaceRequest{}}
	reply := make(chan json.RawMessage, 1)
	pipe.requests[workspaceRequestFixture] = pendingCleanup(reply)
	usage := fmt.Sprintf(`{"type":"workspace.usage.result","request_id":"%s","ok":true,"usage":`+
		`{"bytes":0,"files":0,"sessions":0,"retention_days":14,"budget_bytes":1}}`, workspaceRequestFixture)
	if pipe.deliver(usage) {
		t.Fatal("a usage result completed a cleanup request")
	}
	if _, pending := pipe.requests[workspaceRequestFixture]; !pending {
		t.Fatal("a mismatched result removed its request")
	}
	cleanup := fmt.Sprintf(`{"type":"workspace.cleanup.result","request_id":"%s","ok":true,"cleanup":`+
		`{"status":"busy","deleted_sessions":0,"freed_bytes":0,"retained_bytes":0}}`, workspaceRequestFixture)
	if !pipe.deliver(cleanup) {
		t.Fatal("a matching result was rejected")
	}
}

func TestLateWorkspaceResultsAreIgnoredAfterCancellation(t *testing.T) {
	pipe := &runtimePipe{done: make(chan struct{}), requests: map[string]*pendingWorkspaceRequest{}}
	usage := fmt.Sprintf(`{"type":"workspace.usage.result","request_id":"%s","ok":true,"usage":`+
		`{"bytes":0,"files":0,"sessions":0,"retention_days":14,"budget_bytes":1}}`, workspaceRequestFixture)
	// No pending request at all: a result that lost the race with cancellation
	// is late, not a protocol violation.
	if !pipe.deliver(usage) {
		t.Fatal("a late workspace result was treated as a protocol error")
	}
	reply := make(chan json.RawMessage, 1)
	pipe.requests[workspaceRequestFixture] = pendingUsage(reply)
	pipe.cancelWorkspaceRequest(workspaceRequestFixture)
	if !pipe.deliver(usage) {
		t.Fatal("a result for a cancelled request was treated as a protocol error")
	}
	select {
	case raw := <-reply:
		t.Fatalf("a cancelled request still delivered %s", raw)
	default:
	}
}

func TestWorkspaceMethodsTakeNoAccountFromTheCaller(t *testing.T) {
	desktop := &Desktop{}
	if _, err := desktop.WorkspaceUsage(context.Background()); err == nil {
		t.Fatal("an unbound caller read workspace usage")
	}
	if _, err := desktop.CleanupWorkspaces(context.Background()); err == nil {
		t.Fatal("an unbound caller cleaned workspaces")
	}
	if _, err := desktop.WorkspaceNotice(context.Background(), workspaceConversation); err == nil {
		t.Fatal("an unbound caller read a workspace notice")
	}
	desktop.account.set(workspaceOwnerFixture, time.Now().Add(time.Hour))
	desktop.account.setOnClear(func() {})
	if lease, err := desktop.workspaceOwner(context.Background()); err == nil || lease.id != "" {
		t.Fatalf("a caller without the main window obtained an account: %q, %v", lease.id, err)
	}
	if lease, err := requireAccount(&desktop.account); err != nil || lease.id != workspaceOwnerFixture {
		t.Fatalf("the captured account was not usable: %q, %v", lease.id, err)
	}
	desktop.account.set("not-a-uuid", time.Now().Add(time.Hour))
	if _, err := requireAccount(&desktop.account); err == nil {
		t.Fatal("an invalid captured account was accepted")
	}
	desktop.account.set(workspaceOwnerFixture, time.Now().Add(-time.Second))
	if _, err := requireAccount(&desktop.account); err == nil {
		t.Fatal("an expired captured account was accepted")
	}
}

func TestAccountSwitchCancelsAPendingCleanup(t *testing.T) {
	pipe, frames := pipeFixture(t)
	supervisor := &runtimeSupervisor{}
	supervisor.ready.Store(true)
	supervisor.pipe.Store(pipe)
	account := &workspaceAccount{}
	account.setOnClear(supervisor.dropWorkspaceRequests)
	account.set(workspaceOwnerFixture, time.Now().Add(time.Hour))
	lease, err := requireAccount(account)
	if err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		_, err := supervisor.workspaceRequest(context.Background(), workspaceCleanupRequestType, account, lease)
		result <- err
	}()
	request := nextFrame(t, frames)
	requestID, _ := request["request_id"].(string)
	// A native refresh can prove a different account without an explicit
	// sign-out. That switch must stop the previous account's cleanup exactly
	// like sign-out does.
	account.set(otherWorkspaceOwnerFixture, time.Now().Add(time.Hour))
	cancel := nextFrame(t, frames)
	if cancel["type"] != workspaceCancelRequestType || cancel["request_id"] != requestID {
		t.Fatalf("account switch did not cancel the pending cleanup: %v", cancel)
	}
	select {
	case err := <-result:
		if !errors.Is(err, errAccountRequired) {
			t.Fatalf("switched-account cleanup returned %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("switched-account cleanup waiter was not released")
	}
	if current, ok := account.current(); !ok || current != otherWorkspaceOwnerFixture {
		t.Fatalf("the new account was not captured: %q, %v", current, ok)
	}
}

func TestRefreshAfterAnExpiredLifetimeStartsANewSession(t *testing.T) {
	account := &workspaceAccount{}
	cleared := 0
	account.setOnClear(func() { cleared++ })
	account.set(workspaceOwnerFixture, time.Now().Add(time.Minute))
	lease, err := requireAccount(account)
	if err != nil {
		t.Fatal(err)
	}
	// Expire the in-memory lifetime deterministically, as if time passed.
	account.mu.Lock()
	account.expiresAt = time.Now().Add(-time.Second)
	account.mu.Unlock()
	if account.matches(lease) {
		t.Fatal("an expired lifetime still matched its lease")
	}
	account.set(workspaceOwnerFixture, time.Now().Add(time.Hour))
	if account.matches(lease) {
		t.Fatal("the same account id after expiry reused the previous session lifetime")
	}
	if cleared != 1 {
		t.Fatalf("the expired lifetime released %d relays", cleared)
	}
	next, err := requireAccount(account)
	if err != nil || next.generation == lease.generation {
		t.Fatalf("the refresh after expiry did not advance the generation: %v", err)
	}
}

func TestExpiringAccountLifetimeCancelsAPendingCleanup(t *testing.T) {
	pipe, frames := pipeFixture(t)
	supervisor := &runtimeSupervisor{}
	supervisor.ready.Store(true)
	supervisor.pipe.Store(pipe)
	account := &workspaceAccount{}
	account.set(workspaceOwnerFixture, time.Now().Add(400*time.Millisecond))
	lease, err := requireAccount(account)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := workspaceRelayContext(context.Background(), workspaceCleanupTimeout, lease)
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, err := supervisor.workspaceRequest(ctx, workspaceCleanupRequestType, account, lease)
		result <- err
	}()
	request := nextFrame(t, frames)
	requestID, _ := request["request_id"].(string)
	cancelled := nextFrame(t, frames)
	if cancelled["type"] != workspaceCancelRequestType || cancelled["request_id"] != requestID {
		t.Fatalf("account expiry did not cancel the exact request: %v", cancelled)
	}
	select {
	case err := <-result:
		if !errors.Is(err, context.DeadlineExceeded) && !errors.Is(err, errAccountRequired) {
			t.Fatalf("expired cleanup returned %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("expired cleanup waiter was not released")
	}
}

func TestSameAccountSignInInvalidatesThePreviousLease(t *testing.T) {
	account := &workspaceAccount{}
	account.set(workspaceOwnerFixture, time.Now().Add(time.Hour))
	lease, err := requireAccount(account)
	if err != nil {
		t.Fatal(err)
	}
	if !account.matches(lease) {
		t.Fatal("a fresh lease did not match")
	}
	account.clear()
	account.set(workspaceOwnerFixture, time.Now().Add(time.Hour))
	if account.matches(lease) {
		t.Fatal("the same account id after sign-out reused the previous session lifetime")
	}
	next, err := requireAccount(account)
	if err != nil || next.generation == lease.generation {
		t.Fatal("a new sign-in did not advance the account generation")
	}
}

func pipeFixture(t *testing.T) (*runtimePipe, <-chan string) {
	t.Helper()
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = writer.Close()
		_ = reader.Close()
	})
	frames := make(chan string, 8)
	go func() {
		scanner := bufio.NewScanner(reader)
		for scanner.Scan() {
			frames <- scanner.Text()
		}
		close(frames)
	}()
	return &runtimePipe{input: writer, done: make(chan struct{}), requests: map[string]*pendingWorkspaceRequest{}}, frames
}

func nextFrame(t *testing.T, frames <-chan string) map[string]any {
	t.Helper()
	select {
	case raw, ok := <-frames:
		if !ok {
			t.Fatal("runtime pipe closed before the expected frame")
		}
		var frame map[string]any
		if json.Unmarshal([]byte(raw), &frame) != nil {
			t.Fatalf("malformed runtime frame: %s", raw)
		}
		return frame
	case <-time.After(5 * time.Second):
		t.Fatal("expected runtime frame did not arrive")
	}
	return nil
}

func TestSignOutCancelsAPendingCleanupAndReleasesItsWaiter(t *testing.T) {
	pipe, frames := pipeFixture(t)
	supervisor := &runtimeSupervisor{}
	supervisor.ready.Store(true)
	supervisor.pipe.Store(pipe)
	account := &workspaceAccount{}
	account.setOnClear(supervisor.dropWorkspaceRequests)
	account.set(workspaceOwnerFixture, time.Now().Add(time.Hour))
	lease, err := requireAccount(account)
	if err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		_, err := supervisor.workspaceRequest(context.Background(), workspaceCleanupRequestType, account, lease)
		result <- err
	}()
	request := nextFrame(t, frames)
	if request["type"] != workspaceCleanupRequestType || request["owner_id"] != workspaceOwnerFixture {
		t.Fatalf("unexpected cleanup request: %v", request)
	}
	requestID, _ := request["request_id"].(string)
	if !validUUID(requestID) {
		t.Fatal("cleanup request did not carry a request id")
	}

	account.clear()
	cancel := nextFrame(t, frames)
	if cancel["type"] != workspaceCancelRequestType || cancel["request_id"] != requestID || cancel["owner_id"] != nil {
		t.Fatalf("sign-out did not send a request-id-bound cancel: %v", cancel)
	}
	select {
	case err := <-result:
		if !errors.Is(err, errAccountRequired) {
			t.Fatalf("cancelled cleanup returned %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cancelled cleanup waiter was not released")
	}
}

func TestUsageCancellationSendsNoCleanupCancel(t *testing.T) {
	pipe, frames := pipeFixture(t)
	supervisor := &runtimeSupervisor{}
	supervisor.ready.Store(true)
	supervisor.pipe.Store(pipe)
	account := &workspaceAccount{}
	account.setOnClear(supervisor.dropWorkspaceRequests)
	account.set(workspaceOwnerFixture, time.Now().Add(time.Hour))
	lease, _ := requireAccount(account)
	result := make(chan error, 1)
	go func() {
		_, err := supervisor.workspaceRequest(context.Background(), workspaceUsageRequestType, account, lease)
		result <- err
	}()
	request := nextFrame(t, frames)
	if request["type"] != workspaceUsageRequestType {
		t.Fatalf("unexpected usage request: %v", request)
	}
	account.clear()
	if err := <-result; !errors.Is(err, errAccountRequired) {
		t.Fatalf("cancelled usage returned %v", err)
	}
	select {
	case frame, ok := <-frames:
		if ok {
			t.Fatalf("a read-only usage request emitted %s", frame)
		}
	case <-time.After(200 * time.Millisecond):
	}
}

func TestCleanupDeadlineCancelsThePrivateRequest(t *testing.T) {
	pipe, frames := pipeFixture(t)
	supervisor := &runtimeSupervisor{}
	supervisor.ready.Store(true)
	supervisor.pipe.Store(pipe)
	account := &workspaceAccount{}
	account.set(workspaceOwnerFixture, time.Now().Add(time.Hour))
	lease, _ := requireAccount(account)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	err := make(chan error, 1)
	go func() {
		_, requestErr := supervisor.workspaceRequest(ctx, workspaceCleanupRequestType, account, lease)
		err <- requestErr
	}()
	request := nextFrame(t, frames)
	requestID, _ := request["request_id"].(string)
	select {
	case requestErr := <-err:
		if !errors.Is(requestErr, context.DeadlineExceeded) {
			t.Fatalf("cleanup deadline returned %v", requestErr)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cleanup deadline did not release its waiter")
	}
	cancelFrame := nextFrame(t, frames)
	if cancelFrame["type"] != workspaceCancelRequestType || cancelFrame["request_id"] != requestID {
		t.Fatalf("deadline did not cancel the exact request: %v", cancelFrame)
	}
}

func TestInvalidatedSessionDoesNotQueueNewCleanupWork(t *testing.T) {
	pipe, frames := pipeFixture(t)
	supervisor := &runtimeSupervisor{}
	supervisor.ready.Store(true)
	supervisor.pipe.Store(pipe)
	account := &workspaceAccount{}
	account.set(workspaceOwnerFixture, time.Now().Add(time.Hour))
	lease, _ := requireAccount(account)
	account.clear()
	if _, err := supervisor.workspaceRequest(context.Background(), workspaceCleanupRequestType, account, lease); !errors.Is(err, errAccountRequired) {
		t.Fatalf("an invalidated session queued cleanup work: %v", err)
	}
	// Admission is fenced inside the writer serialization, so no cleanup frame
	// (and therefore no destructive work) is emitted for an invalidated lease.
	select {
	case frame, ok := <-frames:
		if ok {
			t.Fatalf("an invalidated session emitted %s", frame)
		}
	case <-time.After(200 * time.Millisecond):
	}
}

func TestCleanupIsNotAdmittedWhenInvalidatedWhileQueuedForWrite(t *testing.T) {
	pipe, frames := pipeFixture(t)
	supervisor := &runtimeSupervisor{}
	supervisor.ready.Store(true)
	supervisor.pipe.Store(pipe)
	account := &workspaceAccount{}
	account.setOnClear(supervisor.dropWorkspaceRequests)
	account.set(workspaceOwnerFixture, time.Now().Add(time.Hour))
	lease, err := requireAccount(account)
	if err != nil {
		t.Fatal(err)
	}
	pipe.mu.Lock()
	result := make(chan error, 1)
	go func() {
		_, err := supervisor.workspaceRequest(context.Background(), workspaceCleanupRequestType, account, lease)
		result <- err
	}()
	// Invalidate while the request is queued behind the writer. clear() blocks
	// in its relay callback on the same writer mutex, so wait for the account
	// state itself before releasing admission.
	cleared := make(chan struct{})
	go func() {
		account.clear()
		close(cleared)
	}()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, ok := account.current(); !ok {
			break
		}
		if time.Now().After(deadline) {
			pipe.mu.Unlock()
			t.Fatal("the account was not invalidated before admission")
		}
		time.Sleep(time.Millisecond)
	}
	pipe.mu.Unlock()
	select {
	case err := <-result:
		if !errors.Is(err, errAccountRequired) {
			t.Fatalf("an invalidated queued cleanup returned %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("invalidated queued cleanup did not return")
	}
	select {
	case <-cleared:
	case <-time.After(5 * time.Second):
		t.Fatal("sign-out did not release its relay callback")
	}
	select {
	case frame, ok := <-frames:
		if ok {
			t.Fatalf("a cleanup invalidated while queued emitted %s", frame)
		}
	case <-time.After(200 * time.Millisecond):
	}
}

func TestDesktopWorkspaceNoticeRejectsAliasedPathsAndInexactMarkers(t *testing.T) {
	root := t.TempDir()
	server, _ := url.Parse("https://server.example.test")
	workspaceRoot := filepath.Join(root, "local-runtime")
	desktop := &Desktop{workspaceRoot: workspaceRoot, server: server}
	valid := []byte(`{"version":2,"origin":"https://server.example.test","ownerId":"` +
		workspaceOwnerFixture + `","conversationId":"` + workspaceConversation + `","lastUsedAt":1,"clearedAt":2}`)
	writeMarker := func(directory string, raw []byte) {
		t.Helper()
		if err := os.MkdirAll(directory, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(directory, "desktop-session.json"), raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	ownerDirectory := filepath.Join(workspaceRoot, workspaceOwnerFixture)
	writeMarker(filepath.Join(ownerDirectory, "services", workspaceConversation), valid)
	if !desktop.sessionWorkspaceCleared(workspaceOwnerFixture, workspaceConversation) {
		t.Fatal("a canonical owned clear was not reported")
	}

	// Trailing bytes are not the exact bounded marker the runner writes.
	writeMarker(filepath.Join(ownerDirectory, "services", workspaceConversation), append(valid, 'x'))
	if desktop.sessionWorkspaceCleared(workspaceOwnerFixture, workspaceConversation) {
		t.Fatal("an inexact marker reported a clear")
	}
	writeMarker(filepath.Join(ownerDirectory, "services", workspaceConversation), valid)

	// An aliased owner, services, or session directory is not canonical.
	outside := filepath.Join(root, "outside")
	writeMarker(filepath.Join(outside, "services", workspaceConversation), valid)
	aliasOwner := "40000000-0000-4000-8000-00000000000a"
	if err := os.Symlink(outside, filepath.Join(workspaceRoot, aliasOwner)); err != nil {
		t.Fatal(err)
	}
	if desktop.sessionWorkspaceCleared(aliasOwner, workspaceConversation) {
		t.Fatal("an aliased owner directory reported a clear")
	}
	aliasServices := "40000000-0000-4000-8000-00000000000b"
	aliasServicesDirectory := filepath.Join(workspaceRoot, aliasServices)
	if err := os.MkdirAll(aliasServicesDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "services"), filepath.Join(aliasServicesDirectory, "services")); err != nil {
		t.Fatal(err)
	}
	if desktop.sessionWorkspaceCleared(aliasServices, workspaceConversation) {
		t.Fatal("an aliased services directory reported a clear")
	}
	aliasConversation := "40000000-0000-4000-8000-00000000000c"
	aliasedSession := "40000000-0000-4000-8000-00000000000d"
	aliasedServices := filepath.Join(workspaceRoot, aliasConversation, "services")
	if err := os.MkdirAll(aliasedServices, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "services", workspaceConversation),
		filepath.Join(aliasedServices, aliasedSession)); err != nil {
		t.Fatal(err)
	}
	if desktop.sessionWorkspaceCleared(aliasConversation, aliasedSession) {
		t.Fatal("an aliased session directory reported a clear")
	}

	// A marker larger than the runner ever writes is not evidence.
	oversized := append(append([]byte{}, valid...), bytes.Repeat([]byte(" "), maxSessionMarkerBytes)...)
	writeMarker(filepath.Join(ownerDirectory, "services", workspaceConversation), oversized)
	if desktop.sessionWorkspaceCleared(workspaceOwnerFixture, workspaceConversation) {
		t.Fatal("an oversized marker reported a clear")
	}
}

func TestDesktopWorkspaceNoticeRequiresAConfirmedOwnedClear(t *testing.T) {
	root := t.TempDir()
	server, _ := url.Parse("https://server.example.test")
	desktop := &Desktop{workspaceRoot: filepath.Join(root, "local-runtime"), server: server}
	markerPath := filepath.Join(desktop.workspaceRoot, workspaceOwnerFixture, "services",
		workspaceConversation, "desktop-session.json")
	if err := os.MkdirAll(filepath.Dir(markerPath), 0o700); err != nil {
		t.Fatal(err)
	}
	writeMarker := func(value any) {
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(markerPath, raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	valid := map[string]any{
		"version": 2, "origin": "https://server.example.test", "ownerId": workspaceOwnerFixture,
		"conversationId": workspaceConversation, "lastUsedAt": 1, "clearedAt": 2,
	}
	writeMarker(valid)
	if !desktop.sessionWorkspaceCleared(workspaceOwnerFixture, workspaceConversation) {
		t.Fatal("a confirmed owned clear was not reported")
	}
	// The native server may retain an explicit default port while the shared
	// schema stores the normalized origin.
	desktop.server, _ = url.Parse("https://server.example.test:443")
	if !desktop.sessionWorkspaceCleared(workspaceOwnerFixture, workspaceConversation) {
		t.Fatal("a default-port origin did not match")
	}

	for name, value := range map[string]any{
		"legacy version":       map[string]any{"version": 1, "ownerId": workspaceOwnerFixture, "conversationId": workspaceConversation, "lastUsedAt": 1, "clearedAt": 2},
		"no clear":             map[string]any{"version": 2, "origin": "https://server.example.test", "ownerId": workspaceOwnerFixture, "conversationId": workspaceConversation, "lastUsedAt": 1},
		"zero clear":           map[string]any{"version": 2, "origin": "https://server.example.test", "ownerId": workspaceOwnerFixture, "conversationId": workspaceConversation, "lastUsedAt": 1, "clearedAt": 0},
		"foreign origin":       map[string]any{"version": 2, "origin": "https://other.example.test", "ownerId": workspaceOwnerFixture, "conversationId": workspaceConversation, "lastUsedAt": 1, "clearedAt": 2},
		"other owner":          map[string]any{"version": 2, "origin": "https://server.example.test", "ownerId": "40000000-0000-4000-8000-000000000009", "conversationId": workspaceConversation, "lastUsedAt": 1, "clearedAt": 2},
		"other conversation":   map[string]any{"version": 2, "origin": "https://server.example.test", "ownerId": workspaceOwnerFixture, "conversationId": "40000000-0000-4000-8000-000000000009", "lastUsedAt": 1, "clearedAt": 2},
		"unknown origin field": map[string]any{"version": 2, "origin": "https://server.example.test", "ownerId": workspaceOwnerFixture, "conversationId": workspaceConversation, "lastUsedAt": 1, "clearedAt": 2, "path": "/tmp"},
	} {
		writeMarker(value)
		if desktop.sessionWorkspaceCleared(workspaceOwnerFixture, workspaceConversation) {
			t.Fatalf("reported a clear for %s", name)
		}
	}

	if err := os.WriteFile(markerPath, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if desktop.sessionWorkspaceCleared(workspaceOwnerFixture, workspaceConversation) {
		t.Fatal("a corrupt marker reported a clear")
	}
	if err := os.Remove(markerPath); err != nil {
		t.Fatal(err)
	}
	if desktop.sessionWorkspaceCleared(workspaceOwnerFixture, workspaceConversation) {
		t.Fatal("a missing marker inferred a clear")
	}
	outside := filepath.Join(root, "outside.json")
	if err := os.WriteFile(outside, []byte(`{"version":2}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, markerPath); err != nil {
		t.Fatal(err)
	}
	if desktop.sessionWorkspaceCleared(workspaceOwnerFixture, workspaceConversation) {
		t.Fatal("an aliased marker reported a clear")
	}
}
