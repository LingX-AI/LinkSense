package main

// Product host entry point for M1b computer control.
//
// The trusted main page asks the native host to select, renew, pause, resume or
// stop local computer control. The page supplies only conversation/turn ids and
// an action: the host never accepts a window, application, process or text
// selector, and the actual target is chosen by the native picker. Selection
// state travels to the server on the already authenticated device socket as
// `computer.control`; this file owns that frame's closed shape, the strict
// result parser, and the redacted status returned to the page.
//
// The page never sees the picked application name, window title, bundle id or
// any native permission error. Those stay in the picker/host process.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	computerControlRequestType = "computer.control"
	computerControlResultType  = "computer.control.result"

	// The server issues the task grant and may renew it. The host enforces a
	// bounded lifetime so a malformed or stale acknowledgement cannot keep a
	// selection alive indefinitely.
	computerControlMaxGrant = 30 * time.Minute
	// An explicit renewal extends the exact live grant by the server's
	// five-minute window. The host accepts that ceiling with a small audited
	// tolerance for clock skew between this Mac and the server; it never treats
	// a renewal as a way to keep an expired local grant alive.
	computerControlRenewGrant          = 5 * time.Minute
	computerControlRenewClockTolerance = 30 * time.Second

	computerControlMaxResultBytes = 8 << 10
	computerControlMaxCodeBytes   = 64

	computerControlStateUnavailable = "unavailable"
	computerControlStateIdle        = "idle"
	computerControlStateActive      = "active"
	computerControlStatePaused      = "paused"
	// retiring is a read-only status for the exact live scope while input is
	// closed and the old act/driver is not yet proven terminal and closed. It
	// is never a control acknowledgement or a server payload, and it carries no
	// expiry: no action may treat it as a live grant.
	computerControlStateRetiring = "retiring"
	computerControlStateStopped  = "stopped"
)

var (
	errComputerUnavailable = errors.New("COMPUTER_UNAVAILABLE")
	errComputerInvalid     = errors.New("COMPUTER_INVALID")
	errComputerBusy        = errors.New("COMPUTER_BUSY")
	errComputerCanceled    = errors.New("COMPUTER_CANCELED")
	errComputerTimeout     = errors.New("COMPUTER_TIMEOUT")
	errComputerForbidden   = errors.New("FORBIDDEN")

	// Internal picker outcomes. They never cross the bridge as text; the
	// controller maps them to the stable codes above.
	errComputerPickerCanceled    = errors.New("computer picker canceled")
	errComputerPickerUnavailable = errors.New("computer picker unavailable")

	errComputerControlInvalidAck = errors.New("computer control invalid result")
	errComputerControlSuperseded = errors.New("computer control superseded")
)

// ComputerControlStatus is the only selection state the trusted page receives.
// It carries no application, window, process, bundle or permission detail.
type ComputerControlStatus struct {
	State     string `json:"state"`
	ExpiresAt string `json:"expiresAt,omitempty"`
}

// computerControlScope is the exact conversation/turn pair a renderer action is
// bound to. Both ids are required for every IPC action; the empty scope exists
// only inside the native emergency pause and stop paths and is unreachable from
// the binding.
type computerControlScope struct {
	ConversationID string
	TurnID         string
}

func newComputerControlScope(conversationID, turnID string) (computerControlScope, bool) {
	scope := computerControlScope{
		ConversationID: strings.ToLower(conversationID),
		TurnID:         strings.ToLower(turnID),
	}
	if !validUUID(scope.ConversationID) || !validUUID(scope.TurnID) {
		return computerControlScope{}, false
	}
	return scope, true
}

func (scope computerControlScope) matches(selection m1bComputerSelection) bool {
	return strings.EqualFold(scope.ConversationID, selection.ConversationID) &&
		strings.EqualFold(scope.TurnID, selection.TurnID)
}

// computerControlTerminal is the stopped state's exact owner, scope and socket
// generation. Another account, conversation, turn or socket generation sees
// idle, never this terminal state.
type computerControlTerminal struct {
	computerControlScope
	OwnerID string
	LinkID  string
}

// computerSelectedTarget is the complete first-use window pin. It exists only
// inside the host process and never crosses the bridge, the device socket, a
// tool call or a log line.
type computerSelectedTarget struct {
	BundleID        string
	WindowID        string
	PID             int
	ProcessInstance string
}

const (
	computerTargetMaxBundleBytes   = 256
	computerTargetMaxWindowBytes   = 128
	computerTargetMaxInstanceBytes = 128
)

func (target computerSelectedTarget) validate() error {
	if !computerPrintableToken(target.BundleID, computerTargetMaxBundleBytes) ||
		!computerPrintableToken(target.WindowID, computerTargetMaxWindowBytes) ||
		target.PID <= 0 ||
		!computerPrintableToken(target.ProcessInstance, computerTargetMaxInstanceBytes) {
		return errComputerInvalid
	}
	return nil
}

func computerPrintableToken(value string, maxBytes int) bool {
	if value == "" || len(value) > maxBytes {
		return false
	}
	for index := 0; index < len(value); index++ {
		if value[index] < 0x21 || value[index] > 0x7e {
			return false
		}
	}
	return true
}

// computerControlService is implemented by the macOS product host. Other
// platforms leave Desktop.computer nil, so the binding reports unavailable and
// no device capability is negotiated.
type computerControlService interface {
	control(ctx context.Context, desktop *Desktop, conversationID, turnID, action string) (ComputerControlStatus, error)
	status(desktop *Desktop, conversationID, turnID string) ComputerControlStatus
	prepareConnection(connection *deviceConnection)
	connectionEnded(connection *deviceConnection, session *deviceControlSession)
	// emergencyPause and emergencyStop are the one native path per action. An
	// empty selectionID is the menu/tray wildcard; a background chord passes
	// the exact selection id its registration was armed for.
	emergencyPause(desktop *Desktop, selectionID string)
	emergencyStop(desktop *Desktop, selectionID string)
}

// ComputerControl is the closed M1b control binding. It is available only to
// the trusted main page and supports exactly the six documented actions. A
// renewal is an explicit gesture for the host's existing selection; it never
// opens a picker or names another target.
func (d *Desktop) ComputerControl(ctx context.Context, conversationID, turnID, action string) (ComputerControlStatus, error) {
	if err := d.checkCaller(ctx); err != nil {
		return ComputerControlStatus{}, err
	}
	switch action {
	case "select", "renew", "pause", "resume", "stop", "status":
	default:
		return ComputerControlStatus{State: computerControlStateUnavailable}, errComputerInvalid
	}
	// Every IPC action requires both ids. The empty scope is reserved for the
	// native emergency pause and stop and can never reach the product controller
	// through this binding, so a renderer can neither wildcard another turn nor
	// act on the host's current selection.
	if _, ok := newComputerControlScope(conversationID, turnID); !ok {
		return ComputerControlStatus{State: computerControlStateUnavailable}, errComputerInvalid
	}
	if d.computer == nil {
		status := ComputerControlStatus{State: computerControlStateUnavailable}
		if action == "status" {
			return status, nil
		}
		return status, errComputerUnavailable
	}
	return d.computer.control(ctx, d, conversationID, turnID, action)
}

// emergencyPauseComputer is the one Pause affordance for the menu, tray and
// background chord. An empty selectionID acts on the host's current selection;
// the chord passes the exact selection it was armed for. It closes local input
// immediately and never surfaces native detail.
func (d *Desktop) emergencyPauseComputer(selectionID string) {
	if d == nil || d.computer == nil {
		return
	}
	d.computer.emergencyPause(d, selectionID)
}

// emergencyStopComputer is the one Stop affordance for the menu, tray and
// background chord. An empty selectionID resolves the host's current picker or
// selection under the stop admission lock; the chord passes its exact armed
// selection and never falls back to a newer one.
func (d *Desktop) emergencyStopComputer(selectionID string) {
	if d == nil || d.computer == nil {
		return
	}
	d.computer.emergencyStop(d, selectionID)
}

// computerControlAck is one strictly validated success result.
type computerControlAck struct {
	State             string
	SessionID         string
	SelectionID       string
	RuntimeGeneration string
	ExpiresAt         time.Time
	ErrorCode         string
}

type computerControlResultEnvelope struct {
	Type      string                     `json:"type"`
	ID        string                     `json:"id"`
	OK        *bool                      `json:"ok"`
	Data      *computerControlResultData `json:"data"`
	ErrorCode *string                    `json:"error_code"`
}

type computerControlResultData struct {
	State             string `json:"state"`
	SessionID         string `json:"session_id"`
	SelectionID       string `json:"selection_id"`
	RuntimeGeneration string `json:"runtime_generation"`
	ExpiresAt         string `json:"expires_at"`
}

// parseComputerControlResult enforces the closed success/failure shapes. It
// also binds the reply to the request id and to the state the requested action
// must produce, so a delayed or crossed result never activates a selection.
func parseComputerControlResult(raw []byte, requestID, action string, now time.Time) (computerControlAck, error) {
	var ack computerControlAck
	if len(raw) == 0 || len(raw) > computerControlMaxResultBytes || !validUUID(requestID) {
		return ack, errComputerControlInvalidAck
	}
	var envelope computerControlResultEnvelope
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&envelope); err != nil || !json.Valid(raw) ||
		envelope.Type != computerControlResultType || envelope.ID != requestID || envelope.OK == nil {
		return ack, errComputerControlInvalidAck
	}
	if !*envelope.OK {
		if envelope.Data != nil || envelope.ErrorCode == nil ||
			!validComputerControlCode(*envelope.ErrorCode) {
			return ack, errComputerControlInvalidAck
		}
		ack.ErrorCode = *envelope.ErrorCode
		return ack, nil
	}
	if envelope.ErrorCode != nil || envelope.Data == nil {
		return ack, errComputerControlInvalidAck
	}
	data := envelope.Data
	expectedState := ""
	switch action {
	case "select", "resume":
		expectedState = computerControlStateActive
	case "pause":
		expectedState = computerControlStatePaused
	case "stop":
		expectedState = computerControlStateStopped
	}
	if expectedState == "" || data.State != expectedState ||
		!validUUID(data.SessionID) || !validUUID(data.SelectionID) ||
		!validUUID(data.RuntimeGeneration) {
		return ack, errComputerControlInvalidAck
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, data.ExpiresAt)
	if err != nil || expiresAt.IsZero() {
		return ack, errComputerControlInvalidAck
	}
	// An active or paused grant must still be live and bounded. A stop result
	// may carry the grant's already-elapsed expiry, but never an absurd one.
	if data.State == computerControlStateActive || data.State == computerControlStatePaused {
		if !now.Before(expiresAt) || expiresAt.After(now.Add(computerControlMaxGrant)) {
			return ack, errComputerControlInvalidAck
		}
	} else if expiresAt.After(now.Add(computerControlMaxGrant)) {
		return ack, errComputerControlInvalidAck
	}
	return computerControlAck{
		State: data.State, SessionID: data.SessionID, SelectionID: data.SelectionID,
		RuntimeGeneration: data.RuntimeGeneration, ExpiresAt: expiresAt,
	}, nil
}

func validComputerControlCode(code string) bool {
	if code == "" || len(code) > computerControlMaxCodeBytes {
		return false
	}
	for index := 0; index < len(code); index++ {
		c := code[index]
		if (c < 'A' || c > 'Z') && (c < '0' || c > '9') && c != '_' {
			return false
		}
	}
	return true
}

// computerControlServerError maps a bounded server refusal to a stable local
// code. Unknown codes stay generic so the renderer cannot receive arbitrary
// server text.
func computerControlServerError(code string) error {
	switch code {
	case "FORBIDDEN", "COMPUTER_ACCESS_DENIED":
		// The Web adapter renders FORBIDDEN; the server names the same refusal
		// COMPUTER_ACCESS_DENIED.
		return errComputerForbidden
	case "DEVICE_BUSY", "COMPUTER_TIMEOUT", "COMPUTER_TARGET_CHANGED",
		"COMPUTER_INVALID", "DESKTOP_UPDATE_REQUIRED":
		return errors.New(code)
	default:
		return errComputerUnavailable
	}
}

func computerControlSelectFrame(id, conversationID, turnID, selectionID, bundleID string) ([]byte, error) {
	return json.Marshal(struct {
		Type string `json:"type"`
		ID   string `json:"id"`
		Body struct {
			Action         string `json:"action"`
			ConversationID string `json:"conversation_id"`
			TurnID         string `json:"turn_id"`
			SelectionID    string `json:"selection_id"`
			BundleID       string `json:"bundle_id"`
		} `json:"body"`
	}{
		Type: computerControlRequestType, ID: id,
		Body: struct {
			Action         string `json:"action"`
			ConversationID string `json:"conversation_id"`
			TurnID         string `json:"turn_id"`
			SelectionID    string `json:"selection_id"`
			BundleID       string `json:"bundle_id"`
		}{"select", conversationID, turnID, selectionID, bundleID},
	})
}

func computerControlScopeFrame(id, action, conversationID, turnID, selectionID, newSelectionID string) ([]byte, error) {
	if action == "resume" {
		return json.Marshal(struct {
			Type string `json:"type"`
			ID   string `json:"id"`
			Body struct {
				Action         string `json:"action"`
				ConversationID string `json:"conversation_id"`
				TurnID         string `json:"turn_id"`
				SelectionID    string `json:"selection_id"`
				NewSelectionID string `json:"new_selection_id"`
			} `json:"body"`
		}{
			Type: computerControlRequestType, ID: id,
			Body: struct {
				Action         string `json:"action"`
				ConversationID string `json:"conversation_id"`
				TurnID         string `json:"turn_id"`
				SelectionID    string `json:"selection_id"`
				NewSelectionID string `json:"new_selection_id"`
			}{action, conversationID, turnID, selectionID, newSelectionID},
		})
	}
	return json.Marshal(struct {
		Type string `json:"type"`
		ID   string `json:"id"`
		Body struct {
			Action         string `json:"action"`
			ConversationID string `json:"conversation_id"`
			TurnID         string `json:"turn_id"`
			SelectionID    string `json:"selection_id"`
		} `json:"body"`
	}{
		Type: computerControlRequestType, ID: id,
		Body: struct {
			Action         string `json:"action"`
			ConversationID string `json:"conversation_id"`
			TurnID         string `json:"turn_id"`
			SelectionID    string `json:"selection_id"`
		}{action, conversationID, turnID, selectionID},
	})
}

// computerDisplayLabel builds a picker row from display-only fields. Both
// values are sanitized and bounded; the row never carries ids, paths or
// native diagnostics.
func computerDisplayLabel(appName, title string) string {
	app := sanitizeComputerDisplayText(appName, 120)
	title = sanitizeComputerDisplayText(title, 200)
	switch {
	case app != "" && title != "":
		return app + " — " + title
	case app != "":
		return app
	default:
		return title
	}
}

// sanitizeComputerDisplayText keeps one line of visible text, drops bidi and
// control characters that could disguise the row, and truncates at a UTF-16
// code-unit budget without splitting a rune.
func sanitizeComputerDisplayText(value string, maxUnits int) string {
	if maxUnits <= 0 || !utf8.ValidString(value) {
		return ""
	}
	var builder strings.Builder
	units, lastSpace := 0, true
	for _, char := range value {
		if unicode.IsControl(char) || char == '‪' || char == '‫' || char == '‬' ||
			char == '‭' || char == '‮' || char == '⁦' || char == '⁧' ||
			char == '⁨' || char == '⁩' || char == '‎' || char == '‏' {
			char = ' '
		}
		if unicode.IsSpace(char) {
			if lastSpace {
				continue
			}
			char, lastSpace = ' ', true
		} else {
			lastSpace = false
		}
		width := 1
		if char > 0xFFFF {
			width = 2
		}
		if units+width > maxUnits {
			break
		}
		builder.WriteRune(char)
		units += width
	}
	return strings.TrimSpace(builder.String())
}

// computerPickerOption is one selectable row for the native picker. The label
// is display-only and stays in the host process.
type computerPickerOption struct {
	Label  string
	Target computerSelectedTarget
}

// computerPickerOptions builds sanitized rows from driver display fields. A
// candidate with neither an application name nor a title is skipped rather
// than shown as an anonymous, ambiguous row.
func computerPickerOptions(candidates []computerPickerCandidate) []computerPickerOption {
	options := make([]computerPickerOption, 0, len(candidates))
	for _, candidate := range candidates {
		label := computerDisplayLabel(candidate.AppName, candidate.Title)
		if label == "" {
			continue
		}
		options = append(options, computerPickerOption{Label: label, Target: candidate.Target})
	}
	return options
}

// computerPickerCandidate is the display-only view of one driver window
// candidate. The darwin adapter fills it from computerWindowCandidate.
type computerPickerCandidate struct {
	AppName string
	Title   string
	Target  computerSelectedTarget
}

// computerRunTerminal is the exact local run a terminal link frame ends. It is
// used only to release this host's own selection; it never authorizes input,
// resumes a selection or reaches the renderer.
type computerRunTerminal struct {
	ConversationID    string
	TurnID            string
	RuntimeGeneration string
}

// computerTerminalFromRuntimeFrame reads the runtime pipe's existing
// `execution.callback` / `execution.recovery` link frames for a completed,
// failed or interrupted turn. The frame has already passed the pipe's bounded
// link.frame validation; this parse only extracts the scoped ids and terminal
// signal and never forwards or rewrites anything.
func computerTerminalFromRuntimeFrame(frame []byte) (computerRunTerminal, bool) {
	var terminal computerRunTerminal
	if len(frame) == 0 || len(frame) > desktopFrameLimit || !json.Valid(frame) {
		return terminal, false
	}
	var envelope struct {
		Type              string          `json:"type"`
		Operation         string          `json:"operation"`
		ConversationID    string          `json:"conversation_id"`
		TurnID            string          `json:"turn_id"`
		RuntimeGeneration string          `json:"runtime_generation"`
		Body              json.RawMessage `json:"body"`
	}
	if json.Unmarshal(frame, &envelope) != nil {
		return terminal, false
	}
	ended := false
	switch envelope.Type {
	case "execution.callback":
		switch envelope.Operation {
		case "turn.exited":
			ended = true
		case "events":
			ended = computerEventBatchTerminal(envelope.Body)
		}
	case "execution.recovery":
		if envelope.Operation == "events" {
			ended = computerEventBatchTerminal(envelope.Body)
		}
	}
	if !ended || !validUUID(envelope.ConversationID) || !validUUID(envelope.TurnID) ||
		!validUUID(envelope.RuntimeGeneration) {
		return terminal, false
	}
	return computerRunTerminal{
		ConversationID:    strings.ToLower(envelope.ConversationID),
		TurnID:            strings.ToLower(envelope.TurnID),
		RuntimeGeneration: strings.ToLower(envelope.RuntimeGeneration),
	}, true
}

func computerEventBatchTerminal(body json.RawMessage) bool {
	if len(body) == 0 || len(body) > desktopFrameLimit {
		return false
	}
	var batch struct {
		Events []struct {
			Event struct {
				Method string `json:"method"`
				Params struct {
					Turn struct {
						Status string `json:"status"`
					} `json:"turn"`
				} `json:"params"`
			} `json:"event"`
		} `json:"events"`
	}
	if json.Unmarshal(body, &batch) != nil {
		return false
	}
	for _, entry := range batch.Events {
		if entry.Event.Method != "turn/completed" {
			continue
		}
		switch entry.Event.Params.Turn.Status {
		case "completed", "failed", "interrupted":
			return true
		}
	}
	return false
}
