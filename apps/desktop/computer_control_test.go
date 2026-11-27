package main

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

const (
	controlTestRequest      = "80000000-0000-4000-8000-000000000301"
	controlTestSessionID    = "70000000-0000-4000-8000-000000000301"
	controlTestGeneration   = "50000000-0000-4000-8000-000000000301"
	controlTestSelection    = "80000000-0000-4000-8000-000000000302"
	controlTestConversation = "40000000-0000-4000-8000-000000000301"
	controlTestTurn         = "60000000-0000-4000-8000-000000000301"
)

func controlAckJSON(t *testing.T, id, actionState, selectionID string, expires time.Time) []byte {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"type": computerControlResultType, "id": id, "ok": true,
		"data": map[string]any{
			"state": actionState, "session_id": controlTestSessionID,
			"selection_id": selectionID, "runtime_generation": controlTestGeneration,
			"expires_at": expires.UTC().Format(time.RFC3339Nano),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestParseComputerControlResultClosedShapes(t *testing.T) {
	now := time.Now()
	valid := controlAckJSON(t, controlTestRequest, computerControlStateActive, controlTestSelection, now.Add(time.Minute))
	ack, err := parseComputerControlResult(valid, controlTestRequest, "select", now)
	if err != nil || ack.State != computerControlStateActive || ack.SessionID != controlTestSessionID ||
		ack.SelectionID != controlTestSelection || ack.RuntimeGeneration != controlTestGeneration {
		t.Fatalf("valid ack was rejected: %+v %v", ack, err)
	}

	rejected := [][]byte{
		[]byte(``),
		[]byte(`null`),
		[]byte(`{"type":"computer.control.result","id":"` + controlTestRequest + `","ok":true}`),
		[]byte(`{"type":"computer.control.result","id":"` + controlTestRequest + `","ok":false,"error_code":"FORBIDDEN","data":{}}`),
		[]byte(`{"type":"computer.control.result","id":"` + controlTestRequest + `","ok":true,"error_code":"FORBIDDEN","data":` +
			`{"state":"active","session_id":"` + controlTestSessionID + `","selection_id":"` + controlTestSelection +
			`","runtime_generation":"` + controlTestGeneration + `","expires_at":"2030-01-01T00:00:00Z"}}`),
		[]byte(`{"type":"computer.control.result","id":"` + controlTestRequest + `","ok":"yes"}`),
		[]byte(`{"type":"computer.control.result","id":"` + controlTestRequest + `","ok":false,"error_code":"bad code"}`),
		[]byte(`{"type":"computer.control.result","id":"` + controlTestRequest + `","ok":true,"data":` +
			`{"state":"stopped","session_id":"` + controlTestSessionID + `","selection_id":"` + controlTestSelection +
			`","runtime_generation":"` + controlTestGeneration + `","expires_at":"2030-01-01T00:00:00Z"}}`),
		[]byte(`{"type":"computer.control.result","id":"` + controlTestRequest + `","ok":true,"data":` +
			`{"state":"active","session_id":"` + controlTestSessionID + `","selection_id":"` + controlTestSelection +
			`","runtime_generation":"` + controlTestGeneration + `","expires_at":"soon"}}`),
		[]byte(`{"type":"computer.control.result","id":"` + controlTestRequest + `","ok":true,"extra":1,"data":` +
			`{"state":"active","session_id":"` + controlTestSessionID + `","selection_id":"` + controlTestSelection +
			`","runtime_generation":"` + controlTestGeneration + `","expires_at":"2030-01-01T00:00:00Z"}}`),
	}
	for index, raw := range rejected {
		if _, err := parseComputerControlResult(raw, controlTestRequest, "select", now); !errors.Is(err, errComputerControlInvalidAck) {
			t.Fatalf("shape %d was not rejected: %v", index, err)
		}
	}

	// A differently bound request id can never complete this request.
	if _, err := parseComputerControlResult(valid, "80000000-0000-4000-8000-000000000399", "select", now); !errors.Is(err, errComputerControlInvalidAck) {
		t.Fatal("a crossed request id was accepted")
	}
	// An active grant must still be live and within the host bound.
	expired := controlAckJSON(t, controlTestRequest, computerControlStateActive, controlTestSelection, now.Add(-time.Second))
	if _, err := parseComputerControlResult(expired, controlTestRequest, "select", now); !errors.Is(err, errComputerControlInvalidAck) {
		t.Fatal("an expired grant was accepted")
	}
	tooLong := controlAckJSON(t, controlTestRequest, computerControlStateActive, controlTestSelection, now.Add(computerControlMaxGrant+time.Minute))
	if _, err := parseComputerControlResult(tooLong, controlTestRequest, "select", now); !errors.Is(err, errComputerControlInvalidAck) {
		t.Fatal("an over-long grant was accepted")
	}
	// A successful stop may report the grant's elapsed expiry.
	stopped := controlAckJSON(t, controlTestRequest, computerControlStateStopped, controlTestSelection, now.Add(-time.Second))
	if _, err := parseComputerControlResult(stopped, controlTestRequest, "stop", now); err != nil {
		t.Fatalf("a stopped result with an elapsed expiry was rejected: %v", err)
	}
	// Failure codes map only a closed set; anything else is generic.
	if computerControlServerError("FORBIDDEN").Error() != "FORBIDDEN" {
		t.Fatal("FORBIDDEN was not preserved")
	}
	if computerControlServerError("COMPUTER_ACCESS_DENIED").Error() != "FORBIDDEN" {
		t.Fatal("COMPUTER_ACCESS_DENIED was not mapped to the Web's forbidden code")
	}
	for _, code := range []string{"INTERNAL", "internal", "", strings.Repeat("A", 65)} {
		if !errors.Is(computerControlServerError(code), errComputerUnavailable) {
			t.Fatalf("server code %q did not map to the generic failure", code)
		}
	}
	if !errors.Is(computerControlTransportError(errAccountRequired), errComputerForbidden) {
		t.Fatal("an account loss was not mapped to the Web's forbidden code")
	}
}

func TestComputerTerminalFromRuntimeFrameIsScopedAndBounded(t *testing.T) {
	const conversation = "40000000-0000-4000-8000-000000000501"
	const turn = "60000000-0000-4000-8000-000000000501"
	const generation = "50000000-0000-4000-8000-000000000501"
	terminalEvent := func(status string) string {
		return `{"type":"execution.callback","operation":"events","conversation_id":"` + conversation +
			`","turn_id":"` + turn + `","runtime_generation":"` + generation + `","id":"80000000-0000-4000-8000-000000000501",` +
			`"body":{"events":[{"event":{"method":"turn/completed","params":{"turn":{"status":"` + status + `"}}}}]}}`
	}
	for _, status := range []string{"completed", "failed", "interrupted"} {
		frame, ok := computerTerminalFromRuntimeFrame([]byte(terminalEvent(status)))
		if !ok || frame.ConversationID != conversation || frame.TurnID != turn || frame.RuntimeGeneration != generation {
			t.Fatalf("terminal status %q was not read: %+v %v", status, frame, ok)
		}
	}
	for name, frame := range map[string]string{
		"in progress":     terminalEvent("inProgress"),
		"no completion":   `{"type":"execution.callback","operation":"events","conversation_id":"` + conversation + `","turn_id":"` + turn + `","runtime_generation":"` + generation + `","body":{"events":[{"event":{"method":"turn/started"}}]}}`,
		"turn exit":       `{"type":"execution.callback","operation":"turn.exited","conversation_id":"` + conversation + `","turn_id":"` + turn + `","runtime_generation":"` + generation + `"}`,
		"wrong envelope":  `{"type":"command.result","conversation_id":"` + conversation + `","turn_id":"` + turn + `","runtime_generation":"` + generation + `"}`,
		"missing turn id": `{"type":"execution.callback","operation":"events","conversation_id":"` + conversation + `","runtime_generation":"` + generation + `","body":{}}`,
		"short id":        `{"type":"execution.callback","operation":"events","conversation_id":"x","turn_id":"` + turn + `","runtime_generation":"` + generation + `","body":{}}`,
	} {
		_, ok := computerTerminalFromRuntimeFrame([]byte(frame))
		want := name == "turn exit"
		if ok != want {
			t.Fatalf("%s frame terminal=%v, want %v", name, ok, want)
		}
	}
	if _, ok := computerTerminalFromRuntimeFrame([]byte(`not json`)); ok {
		t.Fatal("invalid JSON was treated as terminal")
	}
	if _, ok := computerTerminalFromRuntimeFrame([]byte(strings.Repeat("x", desktopFrameLimit+1))); ok {
		t.Fatal("an oversized frame was treated as terminal")
	}
}

func TestComputerControlFrameShapes(t *testing.T) {
	frame, err := computerControlSelectFrame(controlTestRequest, controlTestConversation, controlTestTurn, controlTestSelection, "com.example.editor")
	if err != nil {
		t.Fatal(err)
	}
	var selectFrame struct {
		Type string         `json:"type"`
		ID   string         `json:"id"`
		Body map[string]any `json:"body"`
	}
	if json.Unmarshal(frame, &selectFrame) != nil || selectFrame.Type != computerControlRequestType ||
		selectFrame.ID != controlTestRequest || len(selectFrame.Body) != 5 ||
		selectFrame.Body["action"] != "select" ||
		selectFrame.Body["conversation_id"] != controlTestConversation ||
		selectFrame.Body["turn_id"] != controlTestTurn ||
		selectFrame.Body["selection_id"] != controlTestSelection ||
		selectFrame.Body["bundle_id"] != "com.example.editor" {
		t.Fatalf("select frame was not the closed shape: %s", frame)
	}

	scope, err := computerControlScopeFrame(controlTestRequest, "pause", controlTestConversation, controlTestTurn, controlTestSelection, "")
	if err != nil {
		t.Fatal(err)
	}
	var scopeFrame struct {
		Body map[string]any `json:"body"`
	}
	if json.Unmarshal(scope, &scopeFrame) != nil || len(scopeFrame.Body) != 4 ||
		scopeFrame.Body["action"] != "pause" || scopeFrame.Body["selection_id"] != controlTestSelection {
		t.Fatalf("pause frame was not the closed shape: %s", scope)
	}

	resume, err := computerControlScopeFrame(controlTestRequest, "resume", controlTestConversation, controlTestTurn, controlTestSelection, controlTestRequest)
	if err != nil {
		t.Fatal(err)
	}
	var resumeFrame struct {
		Body map[string]any `json:"body"`
	}
	if json.Unmarshal(resume, &resumeFrame) != nil || len(resumeFrame.Body) != 5 ||
		resumeFrame.Body["new_selection_id"] != controlTestRequest {
		t.Fatalf("resume frame was not the closed shape: %s", resume)
	}
}

func TestComputerPickerLabelsStaySanitizedAndBounded(t *testing.T) {
	label := computerDisplayLabel("Editor‮\n\t", "Quarterly\u0000 report "+strings.Repeat("x", 400))
	if strings.ContainsAny(label, "‮\n\t\x00") {
		t.Fatalf("label kept unsafe characters: %q", label)
	}
	if units := computerTextUnits(label); units > 323 {
		t.Fatalf("label was not bounded: %d units", units)
	}
	if label == "" || !strings.HasPrefix(label, "Editor") {
		t.Fatalf("label lost its visible prefix: %q", label)
	}
	if got := computerDisplayLabel("\xff\xfe", ""); got != "" {
		t.Fatalf("invalid UTF-8 produced a label: %q", got)
	}
	if got := computerDisplayLabel("", ""); got != "" {
		t.Fatalf("an empty label was produced: %q", got)
	}

	options := computerPickerOptions([]computerPickerCandidate{
		{AppName: "", Title: "", Target: computerSelectedTarget{BundleID: "empty"}},
		{AppName: "Editor", Title: "Untitled", Target: computerSelectedTarget{BundleID: "com.example.editor"}},
	})
	if len(options) != 1 || options[0].Target.BundleID != "com.example.editor" ||
		!strings.Contains(options[0].Label, "Editor") {
		t.Fatalf("picker options were wrong: %+v", options)
	}
}

func computerTextUnits(value string) int {
	units := 0
	for _, char := range value {
		if char > 0xFFFF {
			units += 2
		} else {
			units++
		}
	}
	return units
}

func TestComputerSelectedTargetRejectsIncompleteIdentity(t *testing.T) {
	valid := computerSelectedTarget{BundleID: "com.example.editor", WindowID: "42", PID: 7, ProcessInstance: "instance"}
	if err := valid.validate(); err != nil {
		t.Fatalf("a complete target was rejected: %v", err)
	}
	for name, target := range map[string]computerSelectedTarget{
		"no bundle":    {WindowID: "42", PID: 7, ProcessInstance: "instance"},
		"no window":    {BundleID: "com.example.editor", PID: 7, ProcessInstance: "instance"},
		"no pid":       {BundleID: "com.example.editor", WindowID: "42", ProcessInstance: "instance"},
		"no instance":  {BundleID: "com.example.editor", WindowID: "42", PID: 7},
		"control char": {BundleID: "com.example\neditor", WindowID: "42", PID: 7, ProcessInstance: "instance"},
	} {
		if err := target.validate(); !errors.Is(err, errComputerInvalid) {
			t.Fatalf("%s target was accepted", name)
		}
	}
}
