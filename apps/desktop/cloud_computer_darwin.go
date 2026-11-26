//go:build darwin

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"
)

const cloudComputerGrant = 5 * time.Minute

type cloudComputerSelectionInput struct {
	SelectionID string `json:"selection_id"`
}

type cloudComputerActInput struct {
	SelectionID   string `json:"selection_id"`
	Action        string `json:"action"`
	ObservationID string `json:"observation_id"`
	Ref           string `json:"ref"`
	Text          string `json:"text"`
	TimeoutMS     int    `json:"timeout_ms"`
}

type cloudComputerWaitInput struct {
	SelectionID   string `json:"selection_id"`
	ObservationID string `json:"observation_id"`
	Ref           string `json:"ref"`
	TimeoutMS     int    `json:"timeout_ms"`
}

type cloudComputer struct {
	desktop  *Desktop
	platform computerPlatform
	gate     *computerExecutorGate

	mu        sync.Mutex
	state     string
	ownerID   string
	linkID    string
	selection m1bComputerSelection
	executor  computerProductExecutor
	timer     *time.Timer
}

func newCloudComputer(desktop *Desktop) cloudComputerHost {
	return &cloudComputer{
		desktop:  desktop,
		platform: darwinComputerPlatform{desktop: desktop},
		gate:     &computerExecutorGate{},
		state:    computerControlStateIdle,
	}
}

func decodeCloudComputerInput(raw json.RawMessage, value any) bool {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	return decoder.Decode(value) == nil
}

func cloudComputerPermissionState() string {
	status := checkComputerPermission(ComputerPermissionAccessibility).Status
	switch status {
	case ComputerPermissionStatusGranted:
		return "granted"
	case ComputerPermissionStatusNotDetermined:
		return "unknown"
	default:
		return "missing"
	}
}

func (c *cloudComputer) statusData() map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	result := map[string]any{
		"state":     c.state,
		"available": c.platform.driverEligible(),
		"permissions": map[string]any{
			"accessibility": cloudComputerPermissionState(),
		},
	}
	if (c.state == computerControlStateActive || c.state == computerControlStatePaused) &&
		c.selection.SelectionID != "" {
		result["selection_id"] = c.selection.SelectionID
		result["expires_at"] = c.selection.ExpiresAt.UTC().Format(time.RFC3339Nano)
	}
	return result
}

func (c *cloudComputer) ensureScope(ownerID, linkID string) {
	c.mu.Lock()
	selection := c.selection
	state := c.state
	c.mu.Unlock()
	if (state == computerControlStateActive || state == computerControlStatePaused) &&
		(selection.OwnerID != ownerID || selection.LinkID != linkID || !time.Now().Before(selection.ExpiresAt)) {
		_, _ = c.stopSelection("")
	}
}

func (c *cloudComputer) selectTarget(ctx context.Context, desktop *Desktop, ownerID, linkID string) (any, string) {
	if !c.platform.driverEligible() {
		return nil, "COMPUTER_UNAVAILABLE"
	}
	if cloudComputerPermissionState() != "granted" {
		return nil, "COMPUTER_ACCESS_DENIED"
	}
	c.mu.Lock()
	if c.state == computerControlStateActive || c.state == computerControlStatePaused {
		c.mu.Unlock()
		return nil, "DEVICE_BUSY"
	}
	c.state = computerControlStateIdle
	c.mu.Unlock()

	pickContext, cancel := context.WithTimeout(ctx, computerControlPickerTimeout)
	target, err := c.platform.pickTarget(pickContext, desktop)
	cancel()
	if err != nil {
		if errors.Is(err, errComputerPickerCanceled) || errors.Is(err, context.Canceled) ||
			errors.Is(err, context.DeadlineExceeded) {
			return nil, "COMPUTER_CANCELED"
		}
		return nil, "COMPUTER_UNAVAILABLE"
	}
	selection := m1bComputerSelection{
		OwnerID: ownerID, LinkID: linkID,
		ConversationID: newComputerControlID(), TurnID: newComputerControlID(),
		RuntimeGeneration: newComputerControlID(), SessionID: newComputerControlID(),
		SelectionID: newComputerControlID(), ExpiresAt: time.Now().Add(cloudComputerGrant),
	}
	executor, err := c.platform.newExecutor(ctx, desktop, target, selection)
	if err != nil {
		return nil, "COMPUTER_UNAVAILABLE"
	}
	c.mu.Lock()
	c.ownerID, c.linkID = ownerID, linkID
	c.selection = selection
	c.executor = executor
	c.state = computerControlStateActive
	c.gate.install(executor)
	c.armTimerLocked()
	c.mu.Unlock()
	return map[string]any{
		"selection_id": selection.SelectionID,
		"expires_at":   selection.ExpiresAt.UTC().Format(time.RFC3339Nano),
		"state":        computerControlStateActive,
	}, ""
}

func (c *cloudComputer) armTimerLocked() {
	if c.timer != nil {
		c.timer.Stop()
	}
	selectionID := c.selection.SelectionID
	delay := time.Until(c.selection.ExpiresAt)
	if delay < 0 {
		delay = 0
	}
	c.timer = time.AfterFunc(delay, func() { c.stopSelection(selectionID) })
}

func (c *cloudComputer) selectionFor(selectionID string) (m1bComputerSelection, computerProductExecutor, string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.selection.SelectionID == "" || c.selection.SelectionID != selectionID {
		return m1bComputerSelection{}, nil, "COMPUTER_TARGET_CHANGED"
	}
	if c.state == computerControlStateStopped {
		return m1bComputerSelection{}, nil, "COMPUTER_TARGET_CHANGED"
	}
	if !time.Now().Before(c.selection.ExpiresAt) {
		return m1bComputerSelection{}, nil, "COMPUTER_TIMEOUT"
	}
	return c.selection, c.executor, ""
}

func cloudComputerResultData(result m1bComputerResult) (any, string) {
	if result.kind == "failure" {
		return nil, result.failure
	}
	switch result.kind {
	case "status":
		return result.status, ""
	case "observe":
		return result.observation, ""
	case "act":
		return result.act, ""
	case "wait":
		return result.wait, ""
	default:
		return nil, "COMPUTER_INVALID"
	}
}

func (c *cloudComputer) observe(ctx context.Context, selectionID string) (any, string) {
	selection, _, failure := c.selectionFor(selectionID)
	if failure != "" {
		return nil, failure
	}
	return cloudComputerResultData(c.gate.observe(ctx, selection))
}

func (c *cloudComputer) act(ctx context.Context, callID, selectionID string, raw json.RawMessage) (any, string) {
	var input cloudComputerActInput
	if !decodeCloudComputerInput(raw, &input) || input.SelectionID != selectionID {
		return nil, "COMPUTER_INVALID"
	}
	if input.Action != "click" && input.Action != "type" {
		return nil, "COMPUTER_INVALID"
	}
	if input.Action == "click" && input.Text != "" {
		return nil, "COMPUTER_INVALID"
	}
	if input.Action == "type" && input.Text == "" {
		return nil, "COMPUTER_INVALID"
	}
	if input.TimeoutMS == 0 {
		input.TimeoutMS = 8_000
	}
	selection, _, failure := c.selectionFor(selectionID)
	if failure != "" {
		return nil, failure
	}
	return cloudComputerResultData(c.gate.act(ctx, selection, callID, m1bComputerAct{
		Action: input.Action, ObservationID: input.ObservationID,
		Ref: input.Ref, Text: input.Text, TimeoutMS: input.TimeoutMS,
	}))
}

func (c *cloudComputer) wait(ctx context.Context, selectionID string, raw json.RawMessage) (any, string) {
	var input cloudComputerWaitInput
	if !decodeCloudComputerInput(raw, &input) || input.SelectionID != selectionID {
		return nil, "COMPUTER_INVALID"
	}
	if input.TimeoutMS == 0 {
		input.TimeoutMS = 8_000
	}
	selection, _, failure := c.selectionFor(selectionID)
	if failure != "" {
		return nil, failure
	}
	return cloudComputerResultData(c.gate.wait(ctx, selection, m1bComputerWait{
		ObservationID: input.ObservationID, Ref: input.Ref, TimeoutMS: input.TimeoutMS,
	}))
}

func (c *cloudComputer) pause(selectionID string) (any, string) {
	selection, executor, failure := c.selectionFor(selectionID)
	if failure != "" {
		return nil, failure
	}
	c.mu.Lock()
	if c.state == computerControlStatePaused {
		c.mu.Unlock()
		return map[string]any{"state": computerControlStatePaused, "expires_at": selection.ExpiresAt.UTC().Format(time.RFC3339Nano)}, ""
	}
	c.gate.closeInputIf(executor)
	c.state = computerControlStatePaused
	c.mu.Unlock()
	return map[string]any{"state": computerControlStatePaused, "expires_at": selection.ExpiresAt.UTC().Format(time.RFC3339Nano)}, ""
}

func (c *cloudComputer) resume(selectionID string) (any, string) {
	selection, executor, failure := c.selectionFor(selectionID)
	if failure != "" {
		return nil, failure
	}
	next := selection
	next.ExpiresAt = time.Now().Add(cloudComputerGrant)
	if err := c.gate.resume(executor, next); err != nil {
		return nil, "COMPUTER_TARGET_CHANGED"
	}
	c.mu.Lock()
	if c.selection.SelectionID != selectionID {
		c.mu.Unlock()
		return nil, "COMPUTER_TARGET_CHANGED"
	}
	c.selection = next
	c.state = computerControlStateActive
	c.armTimerLocked()
	c.mu.Unlock()
	return map[string]any{"state": computerControlStateActive, "expires_at": next.ExpiresAt.UTC().Format(time.RFC3339Nano)}, ""
}

func (c *cloudComputer) stopSelection(selectionID string) (any, string) {
	c.mu.Lock()
	if c.selection.SelectionID == "" || (selectionID != "" && c.selection.SelectionID != selectionID) {
		c.mu.Unlock()
		return nil, "COMPUTER_TARGET_CHANGED"
	}
	executor := c.executor
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	c.executor = nil
	c.selection = m1bComputerSelection{}
	c.state = computerControlStateStopped
	c.mu.Unlock()
	if executor != nil {
		c.gate.closeInputIf(executor)
		c.gate.detachIf(executor)
		_ = executor.close()
	}
	return map[string]any{"state": computerControlStateStopped}, ""
}

func (c *cloudComputer) handle(
	ctx context.Context,
	callID, ownerID, linkID, operation string,
	input json.RawMessage,
) (any, string) {
	c.ensureScope(ownerID, linkID)
	switch operation {
	case cloudComputerStatusOperation:
		return c.statusData(), ""
	case cloudComputerSelectOperation:
		return c.selectTarget(ctx, c.desktop, ownerID, linkID)
	case cloudComputerObserveOperation,
		cloudComputerActOperation,
		cloudComputerWaitOperation,
		cloudComputerPauseOperation,
		cloudComputerResumeOperation,
		cloudComputerStopOperation:
		var selection cloudComputerSelectionInput
		if json.Unmarshal(input, &selection) != nil || !validUUID(selection.SelectionID) {
			return nil, "COMPUTER_INVALID"
		}
		switch operation {
		case cloudComputerObserveOperation:
			return c.observe(ctx, selection.SelectionID)
		case cloudComputerActOperation:
			return c.act(ctx, callID, selection.SelectionID, input)
		case cloudComputerWaitOperation:
			return c.wait(ctx, selection.SelectionID, input)
		case cloudComputerPauseOperation:
			return c.pause(selection.SelectionID)
		case cloudComputerResumeOperation:
			return c.resume(selection.SelectionID)
		default:
			return c.stopSelection(selection.SelectionID)
		}
	default:
		return nil, "COMPUTER_INVALID"
	}
}

func (c *cloudComputer) control(
	ctx context.Context,
	desktop *Desktop,
	ownerID, linkID, action string,
) (CloudComputerControlStatus, error) {
	c.ensureScope(ownerID, linkID)
	switch action {
	case "status":
		return cloudComputerStatusFromData(c.statusData()), nil
	case "select":
		data, code := c.selectTarget(ctx, desktop, ownerID, linkID)
		if code != "" {
			return CloudComputerControlStatus{State: computerControlStateUnavailable}, errors.New(code)
		}
		return cloudComputerStatusFromData(data.(map[string]any)), nil
	default:
		c.mu.Lock()
		selectionID := c.selection.SelectionID
		c.mu.Unlock()
		if selectionID == "" {
			return CloudComputerControlStatus{State: computerControlStateIdle}, nil
		}
		var data any
		var code string
		switch action {
		case "pause":
			data, code = c.pause(selectionID)
		case "resume":
			data, code = c.resume(selectionID)
		case "stop":
			data, code = c.stopSelection(selectionID)
		default:
			code = "COMPUTER_INVALID"
		}
		if code != "" {
			return CloudComputerControlStatus{State: computerControlStateUnavailable}, errors.New(code)
		}
		return cloudComputerStatusFromData(data.(map[string]any)), nil
	}
}

func cloudComputerStatusFromData(data map[string]any) CloudComputerControlStatus {
	status := CloudComputerControlStatus{}
	if state, ok := data["state"].(string); ok {
		status.State = state
	}
	if expires, ok := data["expires_at"].(string); ok {
		status.ExpiresAt = expires
	}
	return status
}

func (c *cloudComputer) emergencyPause() {
	c.mu.Lock()
	selectionID := c.selection.SelectionID
	c.mu.Unlock()
	if selectionID != "" {
		_, _ = c.pause(selectionID)
	}
}

func (c *cloudComputer) emergencyStop() {
	c.mu.Lock()
	selectionID := c.selection.SelectionID
	c.mu.Unlock()
	if selectionID != "" {
		_, _ = c.stopSelection(selectionID)
	}
}
