package main

import (
	"encoding/json"
	"testing"
	"time"
)

const cloudToolTestConversation = "60000000-0000-4000-8000-000000000001"

func TestCloudToolPingIsLocalAndBounded(t *testing.T) {
	id := "50000000-0000-4000-8000-000000000001"
	frame, err := json.Marshal(map[string]any{
		"type": "cloud_tool.request", "id": id, "conversation_id": cloudToolTestConversation, "operation": "local_tools.ping",
		"input": map[string]any{"message": "hello"}, "expires_at": time.Now().Add(10 * time.Second).UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatal(err)
	}
	request, handled, err := parseCloudToolFrame(frame)
	if err != nil || !handled || request.Operation != desktopCloudToolPingOperation {
		t.Fatalf("valid ping was not parsed: handled=%v request=%+v err=%v", handled, request, err)
	}
	response := cloudToolPingResponse(request)
	var result struct {
		Type      string `json:"type"`
		ID        string `json:"id"`
		Operation string `json:"operation"`
		OK        bool   `json:"ok"`
		Data      struct {
			Message    string `json:"message"`
			Platform   string `json:"platform"`
			AppVersion string `json:"app_version"`
		} `json:"data"`
	}
	if json.Unmarshal(response, &result) != nil || result.Type != "cloud_tool.result" ||
		result.ID != id || result.Operation != "local_tools.ping" || !result.OK ||
		result.Data.Message != "hello" || result.Data.Platform == "" || result.Data.AppVersion == "" {
		t.Fatalf("unexpected ping result: %s", response)
	}

	expired, _ := json.Marshal(map[string]any{
		"type": "cloud_tool.request", "id": id, "conversation_id": cloudToolTestConversation, "operation": "local_tools.ping",
		"input": map[string]any{"message": "hello"}, "expires_at": time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano),
	})
	request, handled, err = parseCloudToolFrame(expired)
	if err != nil || !handled || !request.ExpiresAt.IsZero() {
		t.Fatalf("expired ping parsing: handled=%v request=%+v err=%v", handled, request, err)
	}
	if json.Unmarshal(cloudToolPingResponse(request), &result) != nil || result.OK {
		t.Fatalf("expired ping was accepted: %s", response)
	}

	_, handled, err = parseCloudToolFrame([]byte(`{"type":"cloud_tool.cancel","id":"` + id + `","operation":"local_tools.ping"}`))
	if err != nil || !handled {
		t.Fatalf("cancel handling: handled=%v err=%v", handled, err)
	}

	_, handled, err = parseCloudToolFrame([]byte(`{"type":"ping"}`))
	if handled || err != nil {
		t.Fatalf("ordinary frame was consumed: handled=%v err=%v", handled, err)
	}

	invalid, _ := json.Marshal(map[string]any{
		"type": "cloud_tool.request", "id": id, "conversation_id": cloudToolTestConversation, "operation": "local_tools.ping",
		"input": map[string]any{"message": "hello"}, "expires_at": time.Now().Add(10 * time.Second).UTC().Format(time.RFC3339Nano),
		"extra": true,
	})
	if _, accepted, parseErr := parseCloudToolFrame(invalid); !accepted || parseErr == nil {
		t.Fatalf("unknown field was accepted: handled=%v err=%v", accepted, parseErr)
	}

	fileFrame, _ := json.Marshal(map[string]any{
		"type": "cloud_tool.request", "id": id, "conversation_id": cloudToolTestConversation, "operation": "local_files.list",
		"input": map[string]any{"root_id": "50000000-0000-4000-8000-000000000002", "limit": 10},
		"expires_at": time.Now().Add(10 * time.Second).UTC().Format(time.RFC3339Nano),
	})
	request, handled, err = parseCloudToolFrame(fileFrame)
	if err != nil || !handled || request.Operation != desktopCloudToolListOperation {
		t.Fatalf("file request parsing: handled=%v request=%+v err=%v", handled, request, err)
	}

	unknown, _ := json.Marshal(map[string]any{
		"type": "cloud_tool.request", "id": id, "conversation_id": cloudToolTestConversation, "operation": "local_files.nope",
		"input": map[string]any{}, "expires_at": time.Now().Add(10 * time.Second).UTC().Format(time.RFC3339Nano),
	})
	if _, accepted, parseErr := parseCloudToolFrame(unknown); !accepted || parseErr == nil {
		t.Fatalf("unknown operation was accepted: handled=%v err=%v", accepted, parseErr)
	}
}
