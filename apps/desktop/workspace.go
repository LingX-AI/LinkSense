package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"time"
)

const (
	workspaceUsageRequestType   = "workspace.usage"
	workspaceCleanupRequestType = "workspace.cleanup"
	workspaceCancelRequestType  = "workspace.cancel"
	workspaceUsageResultType    = "workspace.usage.result"
	workspaceCleanupResultType  = "workspace.cleanup.result"

	workspaceUsageTimeout   = 60 * time.Second
	workspaceCleanupTimeout = 5 * time.Minute

	maxSessionMarkerBytes = 4096
)

// WorkspaceUsage is an aggregate for the signed-in account on this Mac.
// It never contains paths, conversation ids or file names.
type WorkspaceUsage struct {
	Bytes         int64 `json:"bytes"`
	Files         int64 `json:"files"`
	Sessions      int64 `json:"sessions"`
	RetentionDays int   `json:"retentionDays"`
	BudgetBytes   int64 `json:"budgetBytes"`
}

// WorkspaceCleanupResult reports the outcome of one explicit cleanup.
// "busy" means a start, recovery or turn owned a workspace, so nothing ran.
type WorkspaceCleanupResult struct {
	Status          string `json:"status"`
	DeletedSessions int    `json:"deletedSessions"`
	FreedBytes      int64  `json:"freedBytes"`
	RetainedBytes   int64  `json:"retainedBytes"`
}

type workspaceUsagePayload struct {
	Bytes         int64 `json:"bytes"`
	Files         int64 `json:"files"`
	Sessions      int64 `json:"sessions"`
	RetentionDays int   `json:"retention_days"`
	BudgetBytes   int64 `json:"budget_bytes"`
}

type workspaceCleanupPayload struct {
	Status          string `json:"status"`
	DeletedSessions int    `json:"deleted_sessions"`
	FreedBytes      int64  `json:"freed_bytes"`
	RetainedBytes   int64  `json:"retained_bytes"`
}

type workspaceResultMessage struct {
	Type      string                   `json:"type"`
	RequestID string                   `json:"request_id"`
	OK        bool                     `json:"ok"`
	ErrorCode string                   `json:"error_code,omitempty"`
	Usage     *workspaceUsagePayload   `json:"usage,omitempty"`
	Cleanup   *workspaceCleanupPayload `json:"cleanup,omitempty"`
}

// workspaceOwner mirrors the native account captured from the refresh
// response. The WebView supplies no account id, so a page cannot ask the host
// to measure or clean another account on this Mac. The returned lease binds
// the relay to this sign-in even if the same account signs in again later.
func (d *Desktop) workspaceOwner(ctx context.Context) (accountLease, error) {
	if goruntime.GOOS != "darwin" {
		return accountLease{}, errors.New("DESKTOP_WORKSPACE_UNAVAILABLE")
	}
	if err := d.checkCaller(ctx); err != nil {
		return accountLease{}, err
	}
	return requireAccount(&d.account)
}

func (d *Desktop) WorkspaceUsage(ctx context.Context) (WorkspaceUsage, error) {
	lease, err := d.workspaceOwner(ctx)
	if err != nil {
		return WorkspaceUsage{}, err
	}
	runtime := d.localRuntime
	if runtime == nil {
		return WorkspaceUsage{}, errors.New("DESKTOP_RUNTIME_UNAVAILABLE")
	}
	callCtx, cancel := workspaceRelayContext(ctx, workspaceUsageTimeout, lease)
	defer cancel()
	raw, err := runtime.workspaceRequest(callCtx, workspaceUsageRequestType, &d.account, lease)
	if err != nil {
		if errors.Is(err, errAccountRequired) {
			return WorkspaceUsage{}, errAccountRequired
		}
		return WorkspaceUsage{}, errors.New("DESKTOP_RUNTIME_UNAVAILABLE")
	}
	// An account switch or sign-out during the relay must not surface the
	// previous account's aggregate under the new session.
	if !d.account.matches(lease) {
		return WorkspaceUsage{}, errAccountRequired
	}
	message, err := parseWorkspaceResult(raw, workspaceUsageResultType)
	if err != nil || !message.OK || message.Usage == nil {
		return WorkspaceUsage{}, errors.New("DESKTOP_WORKSPACE_UNAVAILABLE")
	}
	return WorkspaceUsage{
		Bytes: message.Usage.Bytes, Files: message.Usage.Files, Sessions: message.Usage.Sessions,
		RetentionDays: message.Usage.RetentionDays, BudgetBytes: message.Usage.BudgetBytes,
	}, nil
}

func (d *Desktop) CleanupWorkspaces(ctx context.Context) (WorkspaceCleanupResult, error) {
	lease, err := d.workspaceOwner(ctx)
	if err != nil {
		return WorkspaceCleanupResult{}, err
	}
	runtime := d.localRuntime
	if runtime == nil {
		return WorkspaceCleanupResult{}, errors.New("DESKTOP_RUNTIME_UNAVAILABLE")
	}
	callCtx, cancel := workspaceRelayContext(ctx, workspaceCleanupTimeout, lease)
	defer cancel()
	raw, err := runtime.workspaceRequest(callCtx, workspaceCleanupRequestType, &d.account, lease)
	if err != nil {
		if errors.Is(err, errAccountRequired) {
			return WorkspaceCleanupResult{}, errAccountRequired
		}
		// A timeout, sign-out, or runtime stop may have removed some files
		// before the request was cancelled; never report this as nothing done.
		return WorkspaceCleanupResult{}, errors.New("DESKTOP_RUNTIME_UNAVAILABLE")
	}
	if !d.account.matches(lease) {
		return WorkspaceCleanupResult{}, errAccountRequired
	}
	message, err := parseWorkspaceResult(raw, workspaceCleanupResultType)
	if err != nil || !message.OK || message.Cleanup == nil {
		return WorkspaceCleanupResult{}, errors.New("DESKTOP_WORKSPACE_CLEANUP_FAILED")
	}
	return WorkspaceCleanupResult{
		Status: message.Cleanup.Status, DeletedSessions: message.Cleanup.DeletedSessions,
		FreedBytes: message.Cleanup.FreedBytes, RetainedBytes: message.Cleanup.RetainedBytes,
	}, nil
}

// workspaceRelayContext bounds one relay by both its operation timeout and the
// in-memory account lifetime. The waiter's deferred cancel sends the
// request-id-bound cancel frame, so an expiring session stops a cleanup at the
// same point sign-out and deadline cancellation do.
func workspaceRelayContext(ctx context.Context, timeout time.Duration, lease accountLease) (context.Context, context.CancelFunc) {
	deadline := time.Now().Add(timeout)
	if !lease.expiresAt.IsZero() && lease.expiresAt.Before(deadline) {
		deadline = lease.expiresAt
	}
	return context.WithDeadline(ctx, deadline)
}

// pendingWorkspaceRequest is one private relay. Its expected result type keeps
// a result for another operation from completing it.
type pendingWorkspaceRequest struct {
	reply       chan json.RawMessage
	messageType string
	resultType  string
}

func workspaceResultTypeFor(messageType string) string {
	if messageType == workspaceCleanupRequestType {
		return workspaceCleanupResultType
	}
	return workspaceUsageResultType
}

func (s *runtimeSupervisor) workspaceRequest(
	ctx context.Context, messageType string, account *workspaceAccount, lease accountLease,
) (json.RawMessage, error) {
	pipe := s.pipe.Load()
	if pipe == nil || !s.ready.Load() || account == nil {
		return nil, errors.New("DESKTOP_RUNTIME_UNAVAILABLE")
	}
	requestID, err := randomWorkspaceRequestID()
	if err != nil {
		return nil, err
	}
	pending := &pendingWorkspaceRequest{
		reply: make(chan json.RawMessage, 1), messageType: messageType,
		resultType: workspaceResultTypeFor(messageType),
	}
	// Writer serialization is also admission serialization. The lease and call
	// deadline are checked after acquiring it and immediately before the frame
	// is written, so a request invalidated while queued emits no frame at all.
	// The account read lease covers only this bounded write; the reply is never
	// awaited under it.
	pipe.mu.Lock()
	if pipe.requests == nil {
		pipe.requests = make(map[string]*pendingWorkspaceRequest)
	}
	if len(pipe.requests) >= 4 {
		pipe.mu.Unlock()
		return nil, errors.New("DESKTOP_RUNTIME_BUSY")
	}
	if err := ctx.Err(); err != nil {
		pipe.mu.Unlock()
		return nil, err
	}
	pipe.requests[requestID] = pending
	err = account.withLease(lease, func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		return pipe.writeLocked(runtimePipeMessage{Type: messageType, OwnerID: lease.id, RequestID: requestID})
	})
	if err != nil {
		delete(pipe.requests, requestID)
		pipe.mu.Unlock()
		if errors.Is(err, errAccountRequired) || errors.Is(err, context.Canceled) ||
			errors.Is(err, context.DeadlineExceeded) {
			return nil, err
		}
		return nil, errors.New("DESKTOP_RUNTIME_UNAVAILABLE")
	}
	pipe.mu.Unlock()
	// Every exit path releases the waiter. A cleanup that has not produced a
	// result also sends the request-id-bound cancel frame, so the runner stops
	// deleting even though this caller will never see the outcome. A frame
	// admitted above is cancelled by invalidation through dropWorkspaceRequests.
	defer pipe.cancelWorkspaceRequest(requestID)
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-pipe.done:
		return nil, errors.New("DESKTOP_RUNTIME_UNAVAILABLE")
	case raw := <-pending.reply:
		if len(raw) == 0 {
			return nil, errAccountRequired
		}
		return raw, nil
	}
}

// cancelWorkspaceRequest removes a pending relay and asks the runtime to stop a
// cleanup. The frame is bound to the request id, so a late cancel cannot affect
// a later scan. A request that already received its result is left alone.
func (pipe *runtimePipe) cancelWorkspaceRequest(requestID string) {
	pipe.mu.Lock()
	pending := pipe.requests[requestID]
	if pending == nil {
		pipe.mu.Unlock()
		return
	}
	delete(pipe.requests, requestID)
	var err error
	if pending.messageType == workspaceCleanupRequestType {
		err = pipe.writeLocked(runtimePipeMessage{Type: workspaceCancelRequestType, RequestID: requestID})
	}
	pipe.mu.Unlock()
	_ = err
}

// dropWorkspaceRequests releases every pending workspace relay, for example
// when the user signs out, the account changes, or the app quits. A pending
// cleanup is cancelled before its waiter is released; the runtime may still
// finish an operation already in progress, but it starts no further deletion.
func (s *runtimeSupervisor) dropWorkspaceRequests() {
	pipe := s.pipe.Load()
	if pipe == nil {
		return
	}
	pipe.mu.Lock()
	defer pipe.mu.Unlock()
	for requestID, pending := range pipe.requests {
		delete(pipe.requests, requestID)
		if pending.messageType == workspaceCleanupRequestType {
			_ = pipe.writeLocked(runtimePipeMessage{Type: workspaceCancelRequestType, RequestID: requestID})
		}
		select {
		case pending.reply <- json.RawMessage{}:
		default:
		}
	}
}

func (pipe *runtimePipe) deliverWorkspaceResult(raw, messageType string) bool {
	message, err := parseWorkspaceResult(json.RawMessage(raw), messageType)
	if err != nil {
		return false
	}
	pipe.mu.Lock()
	pending := pipe.requests[message.RequestID]
	if pending == nil {
		// A result that lost the race with cancellation is late, not invalid.
		pipe.mu.Unlock()
		return true
	}
	if pending.resultType != messageType {
		pipe.mu.Unlock()
		return false
	}
	delete(pipe.requests, message.RequestID)
	pipe.mu.Unlock()
	select {
	case pending.reply <- json.RawMessage(raw):
	default:
	}
	return true
}

func parseWorkspaceResult(raw json.RawMessage, messageType string) (workspaceResultMessage, error) {
	var message workspaceResultMessage
	if !json.Valid(raw) {
		return message, errors.New("invalid workspace result")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&message) != nil || message.Type != messageType || !validUUID(message.RequestID) {
		return workspaceResultMessage{}, errors.New("invalid workspace result")
	}
	if message.OK {
		if message.ErrorCode != "" {
			return workspaceResultMessage{}, errors.New("invalid workspace result")
		}
		switch messageType {
		case workspaceUsageResultType:
			if message.Usage == nil || message.Cleanup != nil ||
				message.Usage.Bytes < 0 || message.Usage.Files < 0 || message.Usage.Sessions < 0 ||
				message.Usage.RetentionDays <= 0 || message.Usage.BudgetBytes <= 0 {
				return workspaceResultMessage{}, errors.New("invalid workspace result")
			}
		case workspaceCleanupResultType:
			if message.Cleanup == nil || message.Usage != nil ||
				(message.Cleanup.Status != "completed" && message.Cleanup.Status != "busy") ||
				message.Cleanup.DeletedSessions < 0 || message.Cleanup.FreedBytes < 0 || message.Cleanup.RetainedBytes < 0 {
				return workspaceResultMessage{}, errors.New("invalid workspace result")
			}
		}
		return message, nil
	}
	if message.Usage != nil || message.Cleanup != nil {
		return workspaceResultMessage{}, errors.New("invalid workspace result")
	}
	switch messageType {
	case workspaceUsageResultType:
		if message.ErrorCode != "DESKTOP_WORKSPACE_UNAVAILABLE" {
			return workspaceResultMessage{}, errors.New("invalid workspace result")
		}
	case workspaceCleanupResultType:
		if message.ErrorCode != "DESKTOP_WORKSPACE_UNAVAILABLE" && message.ErrorCode != "DESKTOP_WORKSPACE_CLEANUP_FAILED" {
			return workspaceResultMessage{}, errors.New("invalid workspace result")
		}
	}
	return message, nil
}

// WorkspaceNotice answers one read-only question for the shared UI: were this
// conversation's local task files explicitly cleared on this Mac? It exposes a
// boolean only, never a path, token, or file name.
type WorkspaceNotice struct {
	Cleared bool `json:"cleared"`
}

type desktopSessionMarker struct {
	Version        int    `json:"version"`
	Origin         string `json:"origin"`
	OwnerID        string `json:"ownerId"`
	ConversationID string `json:"conversationId"`
	LastUsedAt     int64  `json:"lastUsedAt"`
	ClearedAt      *int64 `json:"clearedAt"`
}

// WorkspaceNotice derives the account from the authenticated native refresh
// session, exactly like usage and cleanup. An unreadable, corrupt, legacy, or
// foreign-origin marker produces no notice; absence of an old workspace is
// never treated as an eviction.
func (d *Desktop) WorkspaceNotice(ctx context.Context, conversationID string) (WorkspaceNotice, error) {
	if goruntime.GOOS != "darwin" {
		return WorkspaceNotice{}, nil
	}
	if err := d.checkCaller(ctx); err != nil {
		return WorkspaceNotice{}, err
	}
	lease, err := requireAccount(&d.account)
	if err != nil {
		return WorkspaceNotice{}, err
	}
	conversation := strings.ToLower(conversationID)
	if !validUUID(conversation) {
		return WorkspaceNotice{}, errors.New("DESKTOP_WORKSPACE_UNAVAILABLE")
	}
	notice := WorkspaceNotice{Cleared: d.sessionWorkspaceCleared(lease.id, conversation)}
	if !d.account.matches(lease) {
		return WorkspaceNotice{}, errAccountRequired
	}
	return notice, nil
}

// privatePathUnderRoot returns a path only when every segment is a real
// directory (not an alias) and the canonical result stays at exactly those
// segments under the canonical root. It mirrors the runner's owner/session
// chain validation without adding a bridge API.
func privatePathUnderRoot(root string, segments ...string) (string, bool) {
	if root == "" || len(segments) == 0 {
		return "", false
	}
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", false
	}
	current := root
	for _, segment := range segments {
		if segment == "" || segment == "." || segment == ".." || strings.ContainsRune(segment, filepath.Separator) {
			return "", false
		}
		current = filepath.Join(current, segment)
		info, err := os.Lstat(current)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", false
		}
	}
	canonical, err := filepath.EvalSymlinks(current)
	if err != nil {
		return "", false
	}
	relative, err := filepath.Rel(canonicalRoot, canonical)
	if err != nil || filepath.IsAbs(relative) || relative == ".." ||
		strings.HasPrefix(relative, ".."+string(filepath.Separator)) ||
		relative != filepath.Join(segments...) {
		return "", false
	}
	return current, true
}

func (d *Desktop) sessionWorkspaceCleared(ownerID, conversationID string) bool {
	if d.workspaceRoot == "" {
		return false
	}
	// The runner validates the canonical owner/session chain before reading a
	// marker; a notice must not follow an aliased owner, services, or session
	// directory. Missing or unreadable evidence stays fail-closed.
	directory, ok := privatePathUnderRoot(d.workspaceRoot, ownerID, "services", conversationID)
	if !ok {
		return false
	}
	markerPath := filepath.Join(directory, "desktop-session.json")
	info, err := os.Lstat(markerPath)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() > maxSessionMarkerBytes {
		return false
	}
	raw, err := os.ReadFile(markerPath)
	if err != nil || len(raw) > maxSessionMarkerBytes {
		return false
	}
	var marker desktopSessionMarker
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if !json.Valid(raw) || decoder.Decode(&marker) != nil || marker.Version != 2 ||
		marker.ClearedAt == nil || *marker.ClearedAt <= 0 ||
		!strings.EqualFold(marker.OwnerID, ownerID) || !strings.EqualFold(marker.ConversationID, conversationID) {
		return false
	}
	serverOrigin := ""
	if d.server != nil {
		serverOrigin = desktopOriginKey(d.server.String())
	}
	return serverOrigin != "" && desktopOriginKey(marker.Origin) == serverOrigin
}

// desktopOriginKey compares origins the way the shared desktop schema stores
// them: lowercase, no default port, no path.
func desktopOriginKey(raw string) string {
	server, err := parseServerURL(raw)
	if err != nil {
		return ""
	}
	scheme, host, port := server.Scheme, strings.ToLower(server.Hostname()), server.Port()
	if (scheme == "https" && port == "443") || (scheme == "http" && port == "80") {
		port = ""
	}
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if port != "" {
		return scheme + "://" + host + ":" + port
	}
	return scheme + "://" + host
}

func randomWorkspaceRequestID() (string, error) {
	value := randomLoginBytes()[:16]
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", value[0:4], value[4:6], value[6:8], value[8:10], value[10:16]), nil
}
