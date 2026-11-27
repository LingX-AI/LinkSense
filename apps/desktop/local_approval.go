package main

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// A cloud task that needs local consent gets one bounded, native approval.
// Deny, timeout, a closed socket or a missing page all fail closed: nothing
// runs. The approval never leaves this Mac.
const (
	cloudApprovalKindCommand    = "command"
	cloudApprovalKindFileChange = "file_change"

	cloudApprovalAllow = "allow"
	cloudApprovalDeny  = "deny"
)

var (
	errApprovalInvalid     = errors.New("DESKTOP_APPROVAL_INVALID")
	errApprovalUnknown     = errors.New("DESKTOP_APPROVAL_UNKNOWN")
	errApprovalUnavailable = errors.New("DESKTOP_APPROVAL_UNAVAILABLE")
	errApprovalDenied      = errors.New("DESKTOP_APPROVAL_DENIED")
	errApprovalTimedOut    = errors.New("DESKTOP_APPROVAL_TIMEOUT")
)

var (
	desktopCloudApproval        = mygo.NewEvent[cloudApprovalRequest]("desktop:cloud-approval")
	desktopCloudApprovalSettled = mygo.NewEvent[string]("desktop:cloud-approval-settled")
)

// cloudApprovalRequest carries only grant-relative paths and the command the
// user must judge. It is local UI state, never API or audit input.
type cloudApprovalRequest struct {
	ID             string `json:"id"`
	ConversationID string `json:"conversation_id"`
	Kind           string `json:"kind"`
	Operation      string `json:"operation"`
	Command        string `json:"command,omitempty"`
	Cwd            string `json:"cwd,omitempty"`
	Path           string `json:"path,omitempty"`
	RootName       string `json:"root_name"`
	ExpiresAt      string `json:"expires_at"`
}

type pendingCloudApproval struct {
	request cloudApprovalRequest
	answer  chan string
}

type cloudApprovalCenter struct {
	mu          sync.Mutex
	pending     map[string]*pendingCloudApproval
	emit        func(cloudApprovalRequest) error
	emitSettled func(string) error
}

func newCloudApprovalCenter() *cloudApprovalCenter {
	return &cloudApprovalCenter{pending: map[string]*pendingCloudApproval{}}
}

func (c *cloudApprovalCenter) setEmitter(
	emit func(cloudApprovalRequest) error,
	emitSettled func(string) error,
) {
	c.mu.Lock()
	c.emit, c.emitSettled = emit, emitSettled
	c.mu.Unlock()
}

// request presents one approval and waits for the person or the deadline. A
// completion always removes the pending entry and settles the page card.
func (c *cloudApprovalCenter) request(ctx context.Context, view cloudApprovalRequest) (string, error) {
	if c == nil {
		return "", errApprovalUnavailable
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if view.ID == "" {
		view.ID = newLocalRootID()
	}
	if view.ID == "" || !validUUID(view.ID) || !validUUID(view.ConversationID) ||
		(view.Kind != cloudApprovalKindCommand && view.Kind != cloudApprovalKindFileChange) {
		return "", errApprovalInvalid
	}
	expiry := time.Now().Add(localShellApprovalTimeout)
	if deadline, ok := ctx.Deadline(); ok && deadline.Before(expiry) {
		expiry = deadline
	}
	if requested := approvalExpiry(view.ExpiresAt); !requested.IsZero() && requested.Before(expiry) {
		expiry = requested
	}
	view.ExpiresAt = expiry.UTC().Format(time.RFC3339Nano)
	pending := &pendingCloudApproval{request: view, answer: make(chan string, 1)}
	c.mu.Lock()
	emit := c.emit
	c.pending[view.ID] = pending
	c.mu.Unlock()
	if emit == nil {
		c.finish(view.ID)
		return "", errApprovalUnavailable
	}
	if err := emit(view); err != nil {
		c.finish(view.ID)
		return "", errApprovalUnavailable
	}
	select {
	case decision := <-pending.answer:
		return decision, nil
	case <-ctx.Done():
		c.finish(view.ID)
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return "", errApprovalTimedOut
		}
		return "", ctx.Err()
	}
}

// finish removes the pending approval and tells the page to drop the card.
func (c *cloudApprovalCenter) finish(id string) {
	c.mu.Lock()
	delete(c.pending, id)
	settle := c.emitSettled
	c.mu.Unlock()
	if settle != nil {
		_ = settle(id)
	}
}

func (c *cloudApprovalCenter) answer(id, decision string) error {
	if c == nil || !validUUID(id) || (decision != cloudApprovalAllow && decision != cloudApprovalDeny) {
		return errApprovalInvalid
	}
	c.mu.Lock()
	pending := c.pending[id]
	if pending == nil {
		c.mu.Unlock()
		return errApprovalUnknown
	}
	delete(c.pending, id)
	settle := c.emitSettled
	c.mu.Unlock()
	select {
	case pending.answer <- decision:
	default:
	}
	if settle != nil {
		_ = settle(id)
	}
	return nil
}

func (c *cloudApprovalCenter) list() []cloudApprovalRequest {
	if c == nil {
		return []cloudApprovalRequest{}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	views := make([]cloudApprovalRequest, 0, len(c.pending))
	for _, pending := range c.pending {
		views = append(views, pending.request)
	}
	return views
}

func approvalExpiry(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}
	}
	return parsed
}

func approvalErrorCode(err error) string {
	switch {
	case errors.Is(err, context.Canceled):
		return "CANCELLED"
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, errApprovalTimedOut):
		return "DESKTOP_APPROVAL_TIMEOUT"
	case errors.Is(err, errApprovalDenied):
		return "DESKTOP_APPROVAL_DENIED"
	default:
		return "DESKTOP_APPROVAL_UNAVAILABLE"
	}
}

// requestApproval is the shared gate used by shell commands and mutating file
// tools. It returns nil only for an explicit allow.
func requestApproval(ctx context.Context, center *cloudApprovalCenter, view cloudApprovalRequest) error {
	decision, err := center.request(ctx, view)
	if err != nil {
		return err
	}
	if decision != cloudApprovalAllow {
		return errApprovalDenied
	}
	return nil
}

// CloudApprovals returns the live approvals so a page reload can restore them.
func (d *Desktop) CloudApprovals(ctx context.Context) ([]cloudApprovalRequest, error) {
	if err := d.checkCaller(ctx); err != nil {
		return nil, err
	}
	return d.cloudApprovals.list(), nil
}

// AnswerCloudApproval answers exactly one live approval. A stale, repeated or
// unknown id is refused; the shell or file operation remains failed closed.
func (d *Desktop) AnswerCloudApproval(ctx context.Context, requestID, decision string) error {
	if err := d.checkCaller(ctx); err != nil {
		return err
	}
	return d.cloudApprovals.answer(requestID, decision)
}
