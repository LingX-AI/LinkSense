//go:build desktop_whitebox

package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

const (
	cloudConversation = "20000000-0000-4000-8000-000000000001"
	cloudTurn         = "20000000-0000-4000-8000-000000000002"
	cloudArtifact     = "20000000-0000-4000-8000-000000000003"
	cloudTitle        = "Desktop whitebox cloud task"
	cloudFile         = "desktop-whitebox-artifact.txt"
	cloudFileContent  = "Downloaded the expected LinkSense desktop artifact.\n"
	fixtureTime       = "2026-07-11T08:00:00Z"
)

type cloudWhitebox struct {
	allowReconnect chan struct{}
	firstStream    chan struct{}
	nextStream     chan string
	streams        atomic.Int32
	downloads      atomic.Int32
}

func (c *cloudWhitebox) serve(w http.ResponseWriter, r *http.Request) bool {
	conversationPath := "/api/v1/conversations/" + cloudConversation
	var data any
	switch r.URL.Path {
	case conversationPath:
		data = map[string]any{
			"id": cloudConversation, "title": cloudTitle, "project_id": nil, "updated_at": fixtureTime,
			"created_at": fixtureTime, "archive_status": "active", "execution_status": "running",
			"execution_target": "cloud", "desktop_device_id": nil,
		}
	case conversationPath + "/events":
		if !cloudAuthorized(w, r) {
			return true
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		if c.streams.Add(1) == 1 {
			writeCloudEvent(w, 1)
			close(c.firstStream)
			select {
			case <-c.allowReconnect:
			case <-r.Context().Done():
			case <-time.After(25 * time.Second):
			}
			return true
		}
		select {
		case c.nextStream <- r.Header.Get("Last-Event-ID"):
		default:
		}
		writeCloudEvent(w, 2)
		select {
		case <-r.Context().Done():
		case <-time.After(25 * time.Second):
		}
		return true
	case "/api/v1/conversations/artifacts":
		data = map[string]any{"next_cursor": nil, "items": []map[string]any{{
			"id": cloudArtifact, "conversation_id": cloudConversation, "turn_id": cloudTurn,
			"kind": "artifact", "source": "agent_generated", "status": "registered", "filename": cloudFile,
			"mime_type": "text/plain", "size_bytes": len(cloudFileContent), "storage_backend": "minio",
			"downloadable": true, "created_at": fixtureTime, "updated_at": fixtureTime,
			"task": map[string]string{"id": cloudConversation, "title": cloudTitle, "archive_status": "active"},
		}}}
	case conversationPath + "/files/" + cloudArtifact + "/download":
		if !cloudAuthorized(w, r) {
			return true
		}
		c.downloads.Add(1)
		w.Header().Set("Content-Type", "text/plain")
		w.Header().Set("Content-Disposition", `attachment; filename="`+cloudFile+`"`)
		_, _ = w.Write([]byte(cloudFileContent))
		return true
	default:
		return false
	}
	if cloudAuthorized(w, r) {
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": data})
	}
	return true
}

func cloudAuthorized(w http.ResponseWriter, r *http.Request) bool {
	if r.Header.Get("Authorization") != "Bearer browser-test-access-token-0000000000000000" {
		w.WriteHeader(http.StatusUnauthorized)
		return false
	}
	return true
}

func writeCloudEvent(w http.ResponseWriter, sequence int) {
	id := fmt.Sprintf("%s:%d", cloudConversation, sequence)
	data, _ := json.Marshal(map[string]any{
		"id": fmt.Sprintf("60000000-0000-4000-8000-%012d", sequence), "conversation_id": cloudConversation,
		"turn_id": cloudTurn, "sequence_no": sequence, "event_type": "conversation.completed",
		"visibility": "user_visible", "sse_event_id": id, "created_at": fixtureTime,
		"payload": map[string]any{"schema_version": 1, "turn_id": cloudTurn, "codex_turn_id": "native-fixture-turn", "status": "completed"},
	})
	_, _ = fmt.Fprintf(w, "id: %s\nevent: conversation.completed\ndata: %s\n\n", id, data)
	if flush, ok := w.(http.Flusher); ok {
		flush.Flush()
	}
}

func TestNativeCloudConversationStreamReconnectsAndDownloadsArtifact(t *testing.T) {
	nativeWhiteboxSession(t, true)
	desktop := nativeWhitebox.desktop
	cloud := &cloudWhitebox{
		allowReconnect: make(chan struct{}), firstStream: make(chan struct{}), nextStream: make(chan string, 1),
	}
	nativeWhitebox.cloud.Store(cloud)
	defer nativeWhitebox.cloud.Store(nil)
	destination := t.TempDir()
	mygo.App.SetPath(mygo.PathDownloads, destination)
	defer mygo.App.SetPath(mygo.PathDownloads, "")
	desktop.openMainWindow()
	win := desktop.mainWindow()
	defer win.Destroy()
	win.Show()
	mygo.App.Focus()
	win.Focus()
	page := win.Page()
	downloads := make(chan *mygo.Download, 1)
	page.OnDownloadDone(func(download *mygo.Download) {
		select {
		case downloads <- download:
		default:
		}
	})
	if err := page.LoadURL("/conversations/" + cloudConversation); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.body.innerText.includes("`+cloudTitle+`")`)
	// A CLI-launched WKWebView may stay hidden; exercise the same transition as a foreground window.
	if _, err := page.Eval(`
		if (document.visibilityState === "hidden") {
			Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
			document.dispatchEvent(new Event("visibilitychange"));
		}
	`); err != nil {
		t.Fatal(err)
	}
	select {
	case <-cloud.firstStream:
	case <-time.After(7 * time.Second):
		visibility, _ := page.Eval(`document.visibilityState`)
		t.Fatalf("no authorized SSE stream reached the API; page visibility: %v", visibility)
	}
	cursor := fmt.Sprintf(`sessionStorage.getItem("linksense.sse.%s.lastEventId")`, cloudConversation)
	whiteboxWait(t, page, fmt.Sprintf(`%s === "%s:1"`, cursor, cloudConversation))
	close(cloud.allowReconnect)
	select {
	case lastID := <-cloud.nextStream:
		if lastID != cloudConversation+":1" {
			t.Fatal("native SSE reconnect did not resume from the consumed event")
		}
	case <-time.After(10 * time.Second):
		t.Fatal("native SSE connection did not recover")
	}
	whiteboxWait(t, page, fmt.Sprintf(`%s === "%s:2"`, cursor, cloudConversation))
	if err := page.LoadURL("/knowledge-bases?tab=artifacts"); err != nil {
		t.Fatal(err)
	}
	button := `document.querySelector('[aria-label="Download ` + cloudFile + `"]')`
	whiteboxWait(t, page, button+" !== null")
	if _, err := page.Eval(button + ".click()"); err != nil {
		t.Fatal(err)
	}
	select {
	case download := <-downloads:
		if download.Err != nil {
			t.Fatal("WebView could not save the authenticated artifact")
		}
		if filepath.Dir(download.Path) != destination || filepath.Base(download.Path) != cloudFile {
			t.Fatal("native download saved outside the expected test destination")
		}
		content, err := os.ReadFile(download.Path)
		if err != nil || string(content) != cloudFileContent || cloud.downloads.Load() != 1 {
			t.Fatal("native artifact download did not contain the authenticated response bytes")
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("native artifact did not finish downloading; API requests: %d", cloud.downloads.Load())
	}
}
