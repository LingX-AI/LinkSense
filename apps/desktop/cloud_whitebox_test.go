//go:build desktop_whitebox

package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"maps"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

const (
	cloudConversation       = "20000000-0000-4000-8000-000000000001"
	cloudTurn               = "20000000-0000-4000-8000-000000000002"
	cloudArtifact           = "20000000-0000-4000-8000-000000000003"
	cloudTitle              = "Desktop whitebox cloud task"
	cloudFile               = "desktop-whitebox-artifact.txt"
	cloudFileContent        = "Downloaded the expected LinkSense desktop artifact.\n"
	cloudShowInFinderButton = `Array.from(document.querySelectorAll("[data-sonner-toast]"))
		.filter(toast => toast.getAttribute("data-removed") !== "true" && toast.getAttribute("data-visible") !== "false")
		.flatMap(toast => Array.from(toast.querySelectorAll("button")))
		.find(button => button.textContent.trim() === "Show in Finder")`
	// The account menu trigger exposes the signed-in user's accessible name;
	// the menu item and the confirmation dialog both use the shared en-US
	// "Sign Out" label.
	cloudAccountMenuTrigger = `document.querySelector('button[aria-label="Eli"]')`
	cloudSignOutMenuItem    = `Array.from(document.querySelectorAll('[role="menuitem"]'))
		.find(item => item.textContent.trim() === "Sign Out")`
	cloudSignOutConfirm = `Array.from(document.querySelectorAll('[role="dialog"] button'))
		.find(button => button.textContent.trim() === "Sign Out")`
	fixtureTime = "2026-07-11T08:00:00Z"

	cloudSiblingConversation = "20000000-0000-4000-8000-000000000011"
	cloudSiblingTitle        = "Desktop whitebox sibling cloud task"
	cloudBrowserFrameTitle   = "Desktop whitebox browser frame"
	cloudBrowserFrameURL     = "https://browser.whitebox.invalid/cloud-task"
	cloudBrowserFrameWidth   = 8
	cloudBrowserFrameHeight  = 6
)

// cloudVisibleNoticeWithFile requires a visible sonner toast naming the exact
// saved file. WKWebView disambiguates a repeated destination with a " (n)"
// suffix, so callers must pass the basename the save actually produced.
func cloudVisibleNoticeWithFile(file string) string {
	return `Array.from(document.querySelectorAll("[data-sonner-toast]"))
		.filter(toast => toast.getAttribute("data-removed") !== "true" && toast.getAttribute("data-visible") !== "false")
		.some(toast => toast.textContent.includes(` + strconv.Quote(file) + `))`
}

type cloudWhitebox struct {
	allowReconnect chan struct{}
	firstStream    chan struct{}
	nextStream     chan string
	streams        atomic.Int32
	downloads      atomic.Int32
	contents       atomic.Int32
	// browser is installed only by the BrowserPanel regression. The legacy
	// stream/download fixture keeps the same paths and responses without it.
	browser *cloudBrowserFixture
}

func (c *cloudWhitebox) serve(w http.ResponseWriter, r *http.Request) bool {
	if c.browser != nil && c.browser.serve(w, r) {
		return true
	}
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
	case conversationPath + "/files/" + cloudArtifact + "/content":
		if !cloudAuthorized(w, r) {
			return true
		}
		c.contents.Add(1)
		w.Header().Set("Content-Type", "text/plain")
		w.Header().Set("Content-Disposition", `inline; filename="`+cloudFile+`"`)
		_, _ = w.Write([]byte(cloudFileContent))
		return true
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
	// The reveal primitive is injected: this fixture records the exact path it
	// would hand Finder and never activates Finder or touches real Downloads.
	var revealMu sync.Mutex
	var revealed []string
	previousReveal := showItemInFolder
	showItemInFolder = func(path string) {
		revealMu.Lock()
		revealed = append(revealed, path)
		revealMu.Unlock()
	}
	defer func() { showItemInFolder = previousReveal }()
	revealCalls := func() []string {
		revealMu.Lock()
		defer revealMu.Unlock()
		return append([]string(nil), revealed...)
	}
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
		t.Logf("download URL: %s", download.URL)
		t.Logf("authenticated bytes: %d from %d authenticated API download(s); exact saved path: %s",
			len(content), cloud.downloads.Load(), download.Path)
		if calls := revealCalls(); len(calls) != 0 {
			t.Fatalf("Finder was activated before the explicit action: %v", calls)
		} else {
			t.Logf("reveal calls before the explicit action: %v", calls)
		}
		// The successful save offers one keyboard action; the handle is opaque
		// and the native ticket still exists until that action consumes it.
		handle := whiteboxCompletedArtifactHandle(desktop, download.Path)
		if handle == "" {
			t.Fatal("the successful save left no explicit Finder ticket")
		}
		if calls := revealCalls(); len(calls) != 0 {
			t.Fatalf("Finder was activated before the toast action was clicked: %v", calls)
		} else {
			t.Logf("reveal calls before the toast action was clicked: %v", calls)
		}
		whiteboxClickShowInFinder(t, page)
		whiteboxWaitReveal(t, revealCalls, 1)
		if calls := revealCalls(); len(calls) != 1 || calls[0] != download.Path {
			t.Fatalf("explicit reveal calls = %v, want exactly %q", calls, download.Path)
		} else {
			t.Logf("exact reveal argument: %q", calls[0])
		}
		// A text/plain .txt artifact selects the content-based "text" preview, not
		// media source loading. Both saves below must reuse this one /content
		// response instead of downloading or fetching again.
		previewButton := `document.querySelector('[aria-label="Preview file ` + cloudFile + `"]')`
		whiteboxWait(t, page, previewButton+" !== null")
		if _, err := page.Eval(previewButton + ".click()"); err != nil {
			t.Fatal(err)
		}
		previewDownload := `document.querySelector('section[aria-label="Preview document ` + cloudFile + `"] button[aria-label="Download document ` + cloudFile + `"]')`
		whiteboxWait(t, page, previewDownload+" !== null")
		cloudBrowserWaitFor(t, 10*time.Second, "the preview content request", func() bool {
			return cloud.contents.Load() == 1
		})
		downloadsBeforePreviewSave := cloud.downloads.Load()
		revealsBeforePreviewSave := len(revealCalls())
		if downloadsBeforePreviewSave != 1 || revealsBeforePreviewSave != 1 {
			t.Fatalf("preview setup changed existing counters: API downloads=%d reveals=%d",
				downloadsBeforePreviewSave, revealsBeforePreviewSave)
		}
		t.Logf("preview loaded %d authenticated /content response(s) with %d /download request(s)",
			cloud.contents.Load(), downloadsBeforePreviewSave)

		clickPreviewDownload := func(description string) *mygo.Download {
			t.Helper()
			if _, err := page.Eval(previewDownload + ".click()"); err != nil {
				t.Fatalf("%s: %v", description, err)
			}
			select {
			case download := <-downloads:
				if download.Err != nil {
					t.Fatalf("%s failed: %v", description, download.Err)
				}
				if filepath.Dir(download.Path) != destination {
					t.Fatalf("%s saved outside the test destination: %s", description, download.Path)
				}
				content, err := os.ReadFile(download.Path)
				if err != nil || string(content) != cloudFileContent {
					t.Fatalf("%s did not contain the loaded preview bytes", description)
				}
				if cloud.contents.Load() != 1 {
					t.Fatalf("%s fetched /content again: %d", description, cloud.contents.Load())
				}
				if cloud.downloads.Load() != downloadsBeforePreviewSave {
					t.Fatalf("%s issued an unintended /download: %d", description, cloud.downloads.Load())
				}
				t.Logf("%s: %d authenticated /content response(s), %d /download request(s), exact saved path: %s",
					description, cloud.contents.Load(), cloud.downloads.Load(), download.Path)
				return download
			case <-time.After(10 * time.Second):
				t.Fatalf("%s did not finish; /content=%d /download=%d",
					description, cloud.contents.Load(), cloud.downloads.Load())
				return nil
			}
		}

		firstPreviewSave := clickPreviewDownload("the first preview save")
		if calls := revealCalls(); len(calls) != revealsBeforePreviewSave {
			t.Fatalf("Finder was activated before the first preview action: %v", calls)
		}
		firstPreviewHandle := whiteboxCompletedArtifactHandle(desktop, firstPreviewSave.Path)
		if firstPreviewHandle == "" {
			t.Fatal("the first preview save left no explicit Finder ticket")
		}
		whiteboxClickShowInFinder(t, page)
		whiteboxWaitReveal(t, revealCalls, revealsBeforePreviewSave+1)
		if calls := revealCalls(); calls[revealsBeforePreviewSave] != firstPreviewSave.Path {
			t.Fatalf("first preview reveal calls = %v, want the last one to be %q",
				calls, firstPreviewSave.Path)
		}
		rejected, err := page.Eval(fmt.Sprintf(`mygo.call("Desktop.RevealArtifactDownload", %q)
			.then(() => false, error => String(error).includes("DESKTOP_DOWNLOAD_STALE"))`, firstPreviewHandle))
		if err != nil || rejected != true {
			t.Fatalf("the replayed preview reveal was not rejected: rejected=%v err=%v", rejected, err)
		}
		if calls := revealCalls(); len(calls) != revealsBeforePreviewSave+1 {
			t.Fatalf("a replayed preview handle activated Finder: %v", calls)
		}

		secondPreviewSave := clickPreviewDownload("the second preview save")
		if secondPreviewSave.Path == firstPreviewSave.Path {
			t.Fatal("two preview saves shared one MyGo destination path")
		}
		secondPreviewHandle := whiteboxCompletedArtifactHandle(desktop, secondPreviewSave.Path)
		if secondPreviewHandle == "" {
			t.Fatal("the second preview save left no explicit Finder ticket")
		}
		if calls := revealCalls(); len(calls) != revealsBeforePreviewSave+1 {
			t.Fatalf("the second preview save activated Finder without a click: %v", calls)
		}
		// Leave the second live offer visible but unused. The real App sign-out
		// must dismiss it, invalidate its ticket, and leave no saved name on the
		// login screen before Finder can be activated.
		secondPreviewFile := filepath.Base(secondPreviewSave.Path)
		whiteboxWait(t, page, fmt.Sprintf(`(%s) !== undefined`, cloudShowInFinderButton))
		whiteboxWait(t, page, cloudVisibleNoticeWithFile(secondPreviewFile))
		whiteboxSignOut(t, page, nil)
		whiteboxWait(t, page, fmt.Sprintf(`location.pathname === "/login" &&
			document.querySelector("[data-desktop-sign-in]") !== null`))
		whiteboxWait(t, page, fmt.Sprintf(`(%s) === undefined`, cloudShowInFinderButton))
		whiteboxWait(t, page, fmt.Sprintf(`!%s`, cloudVisibleNoticeWithFile(secondPreviewFile)))
		rejected, err = page.Eval(fmt.Sprintf(`mygo.call("Desktop.RevealArtifactDownload", %q)
			.then(() => false, error => String(error).includes("DESKTOP_DOWNLOAD_STALE") || String(error).includes("AUTH_REQUIRED"))`, secondPreviewHandle))
		if err != nil || rejected != true {
			t.Fatalf("the signed-out preview reveal was not rejected: revealed=%v rejected=%v err=%v", revealCalls(), rejected, err)
		}
		if calls := revealCalls(); len(calls) != revealsBeforePreviewSave+1 {
			t.Fatalf("a signed-out preview handle activated Finder: %v", calls)
		} else {
			t.Logf("reveal calls after sign-out (unchanged, no new call): %v", calls)
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("native artifact did not finish downloading; API requests: %d", cloud.downloads.Load())
	}
}

func whiteboxCompletedArtifactHandle(desktop *Desktop, path string) string {
	desktop.downloads.mu.Lock()
	defer desktop.downloads.mu.Unlock()
	for handle, ticket := range desktop.downloads.tickets {
		if ticket.phase == artifactDownloadCompleted && ticket.path == path {
			return handle
		}
	}
	return ""
}

func whiteboxClickShowInFinder(t *testing.T, page *mygo.Page) {
	t.Helper()
	whiteboxWait(t, page, fmt.Sprintf("(%s) !== undefined", cloudShowInFinderButton))
	clicked, err := page.Eval(fmt.Sprintf(`(() => {
		const button = %s;
		if (!button) return false;
		button.click();
		return true;
	})()`, cloudShowInFinderButton))
	if err != nil || clicked != true {
		t.Fatalf("the explicit Show in Finder action was not clickable: %v", err)
	}
}

// whiteboxSignOut drives the account menu, the confirmation dialog, and the
// shared App sign-out flow, optionally interacting with the open dialog before
// confirmation. The fixture leaves native session cleanup to the App.
func whiteboxSignOut(t *testing.T, page *mygo.Page, beforeConfirm func()) {
	t.Helper()
	whiteboxWait(t, page, cloudAccountMenuTrigger+` !== null`)
	if _, err := page.Eval(cloudAccountMenuTrigger + `.click()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, cloudSignOutMenuItem+` !== undefined`)
	if _, err := page.Eval(fmt.Sprintf(`(() => {
		const item = %s;
		if (!item) return false;
		item.click();
		return true;
	})()`, cloudSignOutMenuItem)); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, cloudSignOutConfirm+` !== undefined`)
	if beforeConfirm != nil {
		beforeConfirm()
	}
	if _, err := page.Eval(fmt.Sprintf(`(() => {
		const button = %s;
		if (!button) return false;
		button.click();
		return true;
	})()`, cloudSignOutConfirm)); err != nil {
		t.Fatal(err)
	}
}

func whiteboxWaitReveal(t *testing.T, revealCalls func() []string, want int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for len(revealCalls()) < want && time.Now().Before(deadline) {
		time.Sleep(25 * time.Millisecond)
	}
	if calls := revealCalls(); len(calls) < want {
		t.Fatalf("explicit reveal calls = %v, want at least %d", calls, want)
	}
}

// The selectors below follow the shared en-US BrowserPanel resources rather
// than implementation classes: the header toggle, the panel region and its
// toolbar controls all expose accessible names.
const (
	cloudBrowserOpenLabel  = "View task browser"
	cloudBrowserPanelLabel = "Browser"
	cloudBrowserTakeLabel  = "Take control"
	cloudBrowserCloseLabel = "Close browser panel"
	// BrowserPanel refetches its frame every 1.5 s while visible. Observing 2 s
	// proves that a closed or switched-away panel stopped polling and that the
	// next task polled nothing before its panel was opened.
	cloudBrowserIdleWindow = 2 * time.Second
)

const cloudBrowserOpenButton = `[...document.querySelectorAll("button")].find((button) => ` +
	`(button.getAttribute("aria-label") || button.textContent || "").trim() === "` + cloudBrowserOpenLabel + `")`

const cloudBrowserPanel = `document.querySelector('section[aria-label="` + cloudBrowserPanelLabel + `"]')`

func cloudBrowserPanelControl(label string) string {
	return `[...document.querySelectorAll('section[aria-label="` + cloudBrowserPanelLabel +
		`"] button')].find((button) => (button.getAttribute("aria-label") || button.textContent || "").trim() === "` +
		label + `")`
}

// cloudBrowserEnabled keeps the click waits from accepting a disabled header or
// toolbar control rendered before its state is ready.
func cloudBrowserEnabled(control string) string {
	return `(() => {
		const control = ` + control + `;
		return control != null && !control.disabled && control.getAttribute("aria-disabled") !== "true";
	})()`
}

func cloudBrowserClick(t *testing.T, page *mygo.Page, control, description string) {
	t.Helper()
	clicked, err := page.Eval(`(() => {
		const control = ` + control + `;
		if (!control) return false;
		control.click();
		return true;
	})()`)
	if err != nil {
		t.Fatalf("%s: %v", description, err)
	}
	if clicked != true {
		t.Fatalf("%s: no matching control is rendered", description)
	}
}

func cloudBrowserWaitFor(t *testing.T, timeout time.Duration, description string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", description)
}

// cloudBrowserImageReady requires the frame to decode in WebKit at the
// advertised dimensions, so a placeholder cannot satisfy the wait.
func cloudBrowserImageReady() string {
	return fmt.Sprintf(`(async () => {
		const image = `+cloudBrowserPanel+`.querySelector("img");
		if (!image) return false;
		try { await image.decode(); } catch { return false; }
		return image.complete && image.naturalWidth === %d && image.naturalHeight === %d;
	})()`, cloudBrowserFrameWidth, cloudBrowserFrameHeight)
}

// cloudBrowserCall is one authenticated POST /conversations/:id/browser body.
type cloudBrowserCall struct {
	conversation string
	action       string
	token        string
}

// cloudBrowserFixture is a synthetic browser session for two existing cloud
// tasks. It never contacts a real site: frames are stdlib-encoded JPEG bytes and
// control leases stay in process, so the regression can assert the exact token
// that claimed and released control.
type cloudBrowserFixture struct {
	mu       sync.Mutex
	image    string
	holders  map[string]string
	calls    []cloudBrowserCall
	rejected int
	idle     chan struct{}
	stopOnce sync.Once
}

func newCloudBrowserFixture(t *testing.T) *cloudBrowserFixture {
	t.Helper()
	picture := image.NewRGBA(image.Rect(0, 0, cloudBrowserFrameWidth, cloudBrowserFrameHeight))
	for y := range cloudBrowserFrameHeight {
		for x := range cloudBrowserFrameWidth {
			picture.Set(x, y, color.RGBA{
				R: uint8(16 + x*24), G: uint8(48 + y*32), B: uint8(176 + (x*13)%64), A: 0xff,
			})
		}
	}
	var frame bytes.Buffer
	if err := jpeg.Encode(&frame, picture, &jpeg.Options{Quality: 92}); err != nil {
		t.Fatalf("synthetic browser frame could not be encoded as JPEG: %v", err)
	}
	return &cloudBrowserFixture{
		image:   base64.StdEncoding.EncodeToString(frame.Bytes()),
		holders: map[string]string{},
		idle:    make(chan struct{}),
	}
}

// stop releases idle event streams so the package's httptest server closes
// deterministically instead of waiting for the fixture deadline.
func (b *cloudBrowserFixture) stop() {
	b.stopOnce.Do(func() { close(b.idle) })
}

func (b *cloudBrowserFixture) serve(w http.ResponseWriter, r *http.Request) bool {
	tasks := []struct{ id, title string }{
		{cloudConversation, cloudTitle},
		{cloudSiblingConversation, cloudSiblingTitle},
	}
	if r.URL.Path == "/api/v1/conversations" {
		if !cloudAuthorized(w, r) {
			return true
		}
		items := make([]map[string]any, 0, len(tasks))
		for _, task := range tasks {
			items = append(items, cloudBrowserConversationData(task.id, task.title))
		}
		writeCloudData(w, map[string]any{"next_cursor": nil, "items": items})
		return true
	}
	for _, task := range tasks {
		path := "/api/v1/conversations/" + task.id
		switch r.URL.Path {
		case path:
			if !cloudAuthorized(w, r) {
				return true
			}
			writeCloudData(w, cloudBrowserConversationData(task.id, task.title))
			return true
		case path + "/events":
			return b.idleEvents(w, r)
		case path + "/browser":
			b.panel(w, r, task.id)
			return true
		}
	}
	return false
}

func cloudBrowserConversationData(conversation, title string) map[string]any {
	return map[string]any{
		"id": conversation, "title": title, "project_id": nil, "updated_at": fixtureTime,
		"created_at": fixtureTime, "archive_status": "active", "execution_status": "running",
		"execution_target": "cloud", "desktop_device_id": nil,
	}
}

func (b *cloudBrowserFixture) panel(w http.ResponseWriter, r *http.Request, conversation string) {
	if !cloudAuthorized(w, r) {
		return
	}
	var request struct {
		Action string `json:"action"`
		Token  string `json:"token"`
	}
	// The API/schema suites own wire validation; the fixture only refuses a
	// request that would make its own token assertions unverifiable.
	accepted := r.Method == http.MethodPost &&
		json.NewDecoder(http.MaxBytesReader(w, r.Body, 24_000)).Decode(&request) == nil &&
		validUUID(request.Token)
	switch request.Action {
	case "frame", "claim", "release":
	default:
		accepted = false
	}
	if !accepted {
		b.reject(w)
		return
	}
	b.mu.Lock()
	b.calls = append(b.calls, cloudBrowserCall{conversation: conversation, action: request.Action, token: request.Token})
	switch request.Action {
	case "claim":
		b.holders[conversation] = request.Token
	case "release":
		if b.holders[conversation] == request.Token {
			delete(b.holders, conversation)
		}
	}
	mode, hasControl, lease := "agent", false, any(nil)
	if holder := b.holders[conversation]; holder != "" {
		mode = "human"
		hasControl = holder == request.Token
		if hasControl {
			lease = time.Now().Add(30 * time.Second).UTC().Format(time.RFC3339)
		}
	}
	b.mu.Unlock()
	writeCloudData(w, map[string]any{
		"mode": mode, "has_control": hasControl, "lease_expires_at": lease,
		"frame": map[string]any{
			"image": b.image, "url": cloudBrowserFrameURL, "title": cloudBrowserFrameTitle,
			"width": cloudBrowserFrameWidth, "height": cloudBrowserFrameHeight,
		},
	})
}

func (b *cloudBrowserFixture) reject(w http.ResponseWriter) {
	b.mu.Lock()
	b.rejected++
	b.mu.Unlock()
	w.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"success": false, "error_code": "BROWSER_PANEL_UNAVAILABLE",
	})
}

func (b *cloudBrowserFixture) idleEvents(w http.ResponseWriter, r *http.Request) bool {
	if !cloudAuthorized(w, r) {
		return true
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	if flush, ok := w.(http.Flusher); ok {
		flush.Flush()
	}
	select {
	case <-r.Context().Done():
	case <-b.idle:
	case <-time.After(25 * time.Second):
	}
	return true
}

func writeCloudData(w http.ResponseWriter, data any) {
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": data})
}

// cloudBrowserSnapshot is a consistent copy of the fixture's recorded state so
// assertions never hold the fixture lock while polling the WebView.
type cloudBrowserSnapshot struct {
	calls    []cloudBrowserCall
	holders  map[string]string
	rejected int
}

func (b *cloudBrowserFixture) snapshot() cloudBrowserSnapshot {
	b.mu.Lock()
	defer b.mu.Unlock()
	return cloudBrowserSnapshot{
		calls:    append([]cloudBrowserCall(nil), b.calls...),
		holders:  maps.Clone(b.holders),
		rejected: b.rejected,
	}
}

// tokens returns the recorded tokens for a conversation and action; an empty
// action matches every action.
func (s cloudBrowserSnapshot) tokens(conversation, action string) []string {
	var tokens []string
	for _, call := range s.calls {
		if call.conversation == conversation && (action == "" || call.action == action) {
			tokens = append(tokens, call.token)
		}
	}
	return tokens
}

func TestNativeCloudBrowserPanelRendersAndReleasesControl(t *testing.T) {
	nativeWhiteboxSession(t, true)
	browser := newCloudBrowserFixture(t)
	defer browser.stop()
	nativeWhitebox.cloud.Store(&cloudWhitebox{browser: browser})
	defer nativeWhitebox.cloud.Store(nil)
	desktop := nativeWhitebox.desktop
	desktop.openMainWindow()
	win := desktop.mainWindow()
	defer win.Destroy()
	win.Show()
	mygo.App.Focus()
	win.Focus()
	page := win.Page()
	if err := page.LoadURL("/conversations/" + cloudConversation); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.body.innerText.includes("`+cloudTitle+`")`)
	// A CLI-launched WKWebView may stay hidden; exercise the same transition as
	// a foreground window so the panel's visibility-gated polling can run.
	if _, err := page.Eval(`
		if (document.visibilityState === "hidden") {
			Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
			document.dispatchEvent(new Event("visibilitychange"));
		}
	`); err != nil {
		t.Fatal(err)
	}

	// The closed panel must neither mount nor poll: wait for the header action
	// to be ready, then observe a full refetch interval.
	whiteboxWait(t, page, cloudBrowserEnabled(cloudBrowserOpenButton))
	time.Sleep(cloudBrowserIdleWindow)
	if calls := browser.snapshot().calls; len(calls) != 0 {
		t.Fatalf("the closed browser panel recorded %d calls before explicit open: %v", len(calls), calls)
	}
	if panel, err := page.Eval(cloudBrowserPanel + ` !== null`); err != nil || panel != false {
		t.Fatalf("the cloud task mounted a browser panel before explicit open: panel=%v err=%v", panel, err)
	}

	cloudBrowserClick(t, page, cloudBrowserOpenButton, "the conversation header does not expose View task browser")
	whiteboxWait(t, page, cloudBrowserPanel+` !== null`)
	whiteboxWait(t, page, cloudBrowserImageReady())
	cloudBrowserWaitFor(t, 10*time.Second, "the open panel to poll a second frame", func() bool {
		return len(browser.snapshot().tokens(cloudConversation, "frame")) >= 2
	})
	frames := browser.snapshot().tokens(cloudConversation, "frame")
	if !validUUID(frames[0]) {
		t.Fatalf("the panel frame did not identify its control token: %q", frames[0])
	}

	control := cloudBrowserPanelControl(cloudBrowserTakeLabel)
	whiteboxWait(t, page, cloudBrowserEnabled(control))
	cloudBrowserClick(t, page, control, "the browser panel does not expose Take control")
	cloudBrowserWaitFor(t, 10*time.Second, "Take control to claim the panel token", func() bool {
		return len(browser.snapshot().tokens(cloudConversation, "claim")) == 1
	})
	snapshot := browser.snapshot()
	claims := snapshot.tokens(cloudConversation, "claim")
	if len(claims) != 1 || claims[0] != frames[0] || snapshot.holders[cloudConversation] != claims[0] {
		t.Fatalf("Take control claimed %v after frame %q; fixture holder is %q", claims, frames[0], snapshot.holders[cloudConversation])
	}

	// A real in-app route action keeps the document context alive so React's
	// unmount cleanup can release the exact claimed token.
	siblingLink := `a[href="/conversations/` + cloudSiblingConversation + `"]`
	whiteboxWait(t, page, `document.querySelector('`+siblingLink+`') !== null`)
	cloudBrowserClick(t, page, `document.querySelector('`+siblingLink+`')`, "the sidebar does not expose the sibling cloud task")
	whiteboxWait(t, page, `location.pathname === "/conversations/`+cloudSiblingConversation+`"`)
	cloudBrowserWaitFor(t, 10*time.Second, "the switched-away panel to release its claim", func() bool {
		return len(browser.snapshot().tokens(cloudConversation, "release")) == 1
	})
	whiteboxWait(t, page, cloudBrowserPanel+` === null`)
	snapshot = browser.snapshot()
	releases := snapshot.tokens(cloudConversation, "release")
	if len(releases) != 1 || releases[0] != claims[0] || snapshot.holders[cloudConversation] != "" {
		t.Fatalf("the switched-away panel released %v with holder %q, want only %q", releases, snapshot.holders[cloudConversation], claims[0])
	}

	// The old task must stop refetching and the new task must stay inert until
	// its own explicit open.
	settled := len(snapshot.tokens(cloudConversation, "frame"))
	time.Sleep(cloudBrowserIdleWindow)
	snapshot = browser.snapshot()
	if frames := len(snapshot.tokens(cloudConversation, "frame")); frames != settled {
		t.Fatalf("the switched-away panel kept polling: %d frames became %d", settled, frames)
	}
	if calls := snapshot.tokens(cloudSiblingConversation, ""); len(calls) != 0 {
		t.Fatalf("the sibling task recorded %d browser calls before explicit open", len(calls))
	}
	if panel, err := page.Eval(cloudBrowserPanel + ` !== null`); err != nil || panel != false {
		t.Fatalf("the sibling task shows a browser panel without explicit open: panel=%v err=%v", panel, err)
	}

	// Re-open on the sibling task to prove the new conversation id and a fresh
	// per-mount token instead of reusing the first panel's lease.
	whiteboxWait(t, page, cloudBrowserEnabled(cloudBrowserOpenButton))
	cloudBrowserClick(t, page, cloudBrowserOpenButton, "the sibling cloud task does not expose View task browser")
	whiteboxWait(t, page, cloudBrowserPanel+` !== null`)
	whiteboxWait(t, page, cloudBrowserImageReady())
	cloudBrowserWaitFor(t, 10*time.Second, "the sibling panel to request its frame", func() bool {
		return len(browser.snapshot().tokens(cloudSiblingConversation, "frame")) >= 1
	})
	snapshot = browser.snapshot()
	siblingFrames := snapshot.tokens(cloudSiblingConversation, "frame")
	if !validUUID(siblingFrames[0]) || siblingFrames[0] == claims[0] {
		t.Fatalf("the sibling panel frame token %q did not change from %q", siblingFrames[0], claims[0])
	}
	whiteboxWait(t, page, cloudBrowserEnabled(control))
	cloudBrowserClick(t, page, control, "the sibling browser panel does not expose Take control")
	cloudBrowserWaitFor(t, 10*time.Second, "the sibling panel to claim its token", func() bool {
		return len(browser.snapshot().tokens(cloudSiblingConversation, "claim")) == 1
	})
	snapshot = browser.snapshot()
	siblingClaims := snapshot.tokens(cloudSiblingConversation, "claim")
	if len(siblingClaims) != 1 || siblingClaims[0] != siblingFrames[0] ||
		siblingClaims[0] == claims[0] || snapshot.holders[cloudSiblingConversation] != siblingClaims[0] {
		t.Fatalf("the sibling panel claimed %v for frame %q; fixture holder is %q", siblingClaims, siblingFrames[0], snapshot.holders[cloudSiblingConversation])
	}
	siblingClaim := siblingClaims[0]
	closeControl := cloudBrowserPanelControl(cloudBrowserCloseLabel)
	whiteboxWait(t, page, cloudBrowserEnabled(closeControl))
	cloudBrowserClick(t, page, closeControl, "the browser panel does not expose Close browser panel")
	whiteboxWait(t, page, cloudBrowserPanel+` === null`)
	cloudBrowserWaitFor(t, 10*time.Second, "Close to release the sibling token", func() bool {
		return len(browser.snapshot().tokens(cloudSiblingConversation, "release")) == 1
	})
	snapshot = browser.snapshot()
	if released := snapshot.tokens(cloudSiblingConversation, "release"); len(released) != 1 ||
		released[0] != siblingClaim || snapshot.holders[cloudSiblingConversation] != "" {
		t.Fatalf("Close released %v with holder %q, want only %q", released, snapshot.holders[cloudSiblingConversation], siblingClaim)
	}
	if rejected := snapshot.rejected; rejected != 0 {
		t.Fatalf("the browser fixture rejected %d requests that were not frame/claim/release", rejected)
	}
}
