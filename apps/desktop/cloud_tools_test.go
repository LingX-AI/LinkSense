package main

import (
	"encoding/json"
	"testing"
	"time"
)

func TestCloudToolPingIsLocalAndBounded(t *testing.T) {
	id := "50000000-0000-4000-8000-000000000001"
	frame, err := json.Marshal(map[string]any{
		"type": "cloud_tool.request", "id": id, "operation": "local_tools.ping",
		"input": map[string]any{"message": "hello"}, "expires_at": time.Now().Add(10 * time.Second).UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatal(err)
	}
	handled, response, err := cloudToolResponse(frame)
	if err != nil || !handled || response == nil {
		t.Fatalf("valid ping was not handled: handled=%v response=%v err=%v", handled, response, err)
	}
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
		"type": "cloud_tool.request", "id": id, "operation": "local_tools.ping",
		"input": map[string]any{"message": "hello"}, "expires_at": time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano),
	})
	handled, response, err = cloudToolResponse(expired)
	if err != nil || !handled || response == nil {
		t.Fatalf("expired ping handling: handled=%v response=%v err=%v", handled, response, err)
	}
	if json.Unmarshal(response, &result) != nil || result.OK {
		t.Fatalf("expired ping was accepted: %s", response)
	}

	handled, response, err = cloudToolResponse([]byte(`{"type":"cloud_tool.cancel","id":"` + id + `","operation":"local_tools.ping"}`))
	if err != nil || !handled || response != nil {
		t.Fatalf("cancel handling: handled=%v response=%v err=%v", handled, response, err)
	}

	handled, _, err = cloudToolResponse([]byte(`{"type":"ping"}`))
	if handled || err != nil {
		t.Fatalf("ordinary frame was consumed: handled=%v err=%v", handled, err)
	}

	invalid, _ := json.Marshal(map[string]any{
		"type": "cloud_tool.request", "id": id, "operation": "local_tools.ping",
		"input": map[string]any{"message": "hello"}, "expires_at": time.Now().Add(10 * time.Second).UTC().Format(time.RFC3339Nano),
		"extra": true,
	})
	if handled, _, err = cloudToolResponse(invalid); !handled || err == nil {
		t.Fatalf("unknown field was accepted: handled=%v err=%v", handled, err)
	}
}
