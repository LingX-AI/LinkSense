//go:build desktop_whitebox && darwin

package main

// P0-09/P1-25 plan §5.7: the shared composer's own DOM drop path must upload a
// dropped File through the real attachment mutation in the macOS WKWebView.
// The real shared Web UI runs in the main window against the disposable
// loopback service; one scoped nativeWhitebox.api closure serves that window's
// signed-in conversation, model preference, event stream and attachment route.

import (
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

const (
	composerDropConversationPath = "/api/v1/conversations/" + cloudConversation
	composerDropPrewarmPath      = "/api/v1/conversations/prewarm"
	composerDropComposerJS       = `document.querySelector('form[aria-label="Task composer"]')`
	composerDropFilename         = "whitebox-drop.txt"
	composerDropContent          = "LinkSense WKWebView drop fixture\n"
	composerDropDraft            = "Keep this draft through the attachment drop."
	composerDropAttachmentID     = "e1000000-0000-4000-8000-000000000001"
	composerDropBodyLimit        = 16 << 10
	composerDropFileLimit        = 4 << 10
)

// composerDropUpload is the one POST to the conversation attachment route,
// recorded even when it is rejected so a malformed or extra request fails the
// test with its exact shape.
type composerDropUpload struct {
	method, path, query, contentType string
	authorized                       bool
	field, filename                  string
	content                          []byte
	problem                          string
}

func TestNativeMacComposerUploadsDroppedAttachment(t *testing.T) {
	nativeWhiteboxSession(t, true)

	// One mutex covers every fixture mutation and the final joint snapshot.
	var (
		mu          sync.Mutex
		uploads     []composerDropUpload
		writes      []string
		turns       int
		preferences int
	)
	done := make(chan struct{})

	// The strict shared conversationFileSchema shape for an uploaded attachment.
	attachment := func(filename string, size int) map[string]any {
		return map[string]any{
			"id": composerDropAttachmentID, "conversation_id": cloudConversation, "pending_request_id": nil, "turn_id": nil,
			"kind": "attachment", "source": "user_upload", "status": "staged", "mime_type": "text/plain", "size_bytes": size,
			"filename": filename, "checksum_sha256": nil, "storage_backend": "minio", "workspace_relative_path": nil,
			"downloadable": true, "created_at": fixtureTime, "updated_at": fixtureTime,
		}
	}
	// conversationDetailPayloadSchema reads value.files at the payload's top
	// level; the known cloud task shape is idle so no running turn covers the
	// composer.
	detail := func() map[string]any {
		conversation := cloudBrowserConversationData(cloudConversation, cloudTitle)
		conversation["execution_status"] = "idle"
		mu.Lock()
		files := []any{}
		for _, upload := range uploads {
			if upload.problem == "" && upload.authorized {
				files = append(files, attachment(upload.filename, len(upload.content)))
			}
		}
		mu.Unlock()
		payload := sideChatDetail(conversation, []any{}, []any{})
		payload["files"] = files
		return payload
	}
	// readUpload accepts exactly one bounded "file" part and proves there is no
	// second one; a deviation is recorded instead of silently accepted.
	readUpload := func(w http.ResponseWriter, r *http.Request) composerDropUpload {
		upload := composerDropUpload{
			method: r.Method, path: r.URL.Path, query: r.URL.RawQuery,
			contentType: r.Header.Get("Content-Type"), authorized: cloudAuthorized(w, r),
		}
		if !upload.authorized {
			return upload
		}
		r.Body = http.MaxBytesReader(w, r.Body, composerDropBodyLimit)
		reader, err := r.MultipartReader()
		if err != nil {
			upload.problem = "not a multipart request"
			return upload
		}
		part, err := reader.NextPart()
		if err != nil {
			upload.problem = "missing file field"
			return upload
		}
		upload.field, upload.filename = part.FormName(), part.FileName()
		upload.content, err = io.ReadAll(io.LimitReader(part, composerDropFileLimit+1))
		_ = part.Close()
		if err != nil {
			upload.problem = "unreadable file field"
		} else if len(upload.content) > composerDropFileLimit {
			upload.problem = "file field exceeds the fixture bound"
		} else if _, err := reader.NextPart(); err != io.EOF {
			upload.problem = "extra multipart field"
		}
		return upload
	}
	serve := nativeWhiteboxAPI(func(w http.ResponseWriter, r *http.Request) bool {
		path := r.URL.Path
		switch {
		case path == composerDropConversationPath && r.Method == http.MethodGet:
			if cloudAuthorized(w, r) {
				writeCloudData(w, detail())
			}
		case path == composerDropConversationPath+"/events" && r.Method == http.MethodGet:
			writeApprovalCardEvents(w, r, done)
		case path == composerDropConversationPath+"/model-preference" && r.Method == http.MethodGet:
			// Count before auth so the readiness gate can wait instead of racing
			// the composer's first query.
			mu.Lock()
			preferences++
			mu.Unlock()
			if cloudAuthorized(w, r) {
				writeCloudData(w, sideChatModelPreference())
			}
		case path == composerDropPrewarmPath && r.Method == http.MethodPost:
			// An open cloud task stays warm; this receipt is not a task write.
			if cloudAuthorized(w, r) {
				writeCloudData(w, map[string]any{"accepted": true, "conversation_id": cloudConversation})
			}
		case path == composerDropConversationPath+"/attachments" && r.Method == http.MethodPost:
			upload := readUpload(w, r)
			mu.Lock()
			uploads = append(uploads, upload)
			mu.Unlock()
			switch {
			case !upload.authorized: // cloudAuthorized already wrote the refusal
			case upload.problem != "":
				w.WriteHeader(http.StatusBadRequest)
				_, _ = io.WriteString(w, `{"success":false,"error_code":"FIXTURE_UPLOAD_INVALID"}`)
			default:
				writeCloudData(w, attachment(upload.filename, len(upload.content)))
			}
		case (r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodPatch ||
			r.Method == http.MethodDelete) && (path == "/api/v1/conversations" || strings.HasPrefix(path, "/api/v1/conversations/")):
			// Captured even when rejected, so a stray turn submission fails.
			mu.Lock()
			writes = append(writes, r.Method+" "+path)
			if strings.HasSuffix(path, "/turns") {
				turns++
			}
			mu.Unlock()
			if cloudAuthorized(w, r) {
				w.WriteHeader(http.StatusNotFound)
				_, _ = io.WriteString(w, `{"success":false,"error_code":"FIXTURE_PATH_UNSUPPORTED"}`)
			}
		default:
			return false
		}
		return true
	})
	nativeWhitebox.api.Store(&serve)
	t.Cleanup(func() {
		close(done)
		nativeWhitebox.api.Store(nil)
	})

	// The real AppKit/WKWebView host is the subject; an ephemeral WebView
	// session keeps the fixture out of the developer store. Cleanups run last in
	// first out, so the window goes before its scoped route.
	desktop := nativeWhitebox.desktop
	desktop.openMainWindowInSession(mygo.NewEphemeralSession())
	win := desktop.mainWindow()
	if win == nil {
		t.Fatal("the native main window was not created")
	}
	t.Cleanup(win.Destroy)
	page := win.Page()
	if err := page.LoadURL("/conversations/" + cloudConversation); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `location.pathname === `+deviceJourneyJSString("/conversations/"+cloudConversation)+` && `+
		`document.body.innerText.includes(`+deviceJourneyJSString(cloudTitle)+`) && `+
		composerDropComposerJS+` !== null`)
	deviceJourneyWaitFor(t, 10*time.Second, "the conversation model preference", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return preferences >= 1
	})
	// Add content is disabled until attachment readiness settles, so an enabled
	// control proves the drop will attach instead of only cancelling the default.
	whiteboxWait(t, page, `(() => {
		const form = `+composerDropComposerJS+`;
		const add = form && Array.from(form.querySelectorAll("button")).find((button) =>
			button.getAttribute("aria-label") === "Add content");
		return Boolean(add) && add.disabled === false;
	})()`)
	deviceJourneySetPrompt(t, page, composerDropDraft)
	whiteboxWait(t, page, `document.querySelector('textarea[aria-label="Task composer"]')?.value === `+deviceJourneyJSString(composerDropDraft))

	// One synthetic small DOM File on a real cancelable drop at the composer
	// form. A navigation would clear window.__whiteboxDropURL, which the probe
	// below relies on.
	handled, err := page.Eval(`(() => {
		const form = ` + composerDropComposerJS + `;
		const transfer = new DataTransfer();
		transfer.items.add(new File([` + deviceJourneyJSString(composerDropContent) + `], ` + deviceJourneyJSString(composerDropFilename) + `, { type: "text/plain" }));
		window.__whiteboxDropURL = location.href;
		const drop = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer });
		if (drop.dataTransfer !== transfer) Object.defineProperty(drop, "dataTransfer", { value: transfer });
		form.dispatchEvent(drop);
		return drop.defaultPrevented;
	})()`)
	if err != nil || handled != true {
		t.Fatalf("the shared composer did not consume the dropped File: handled=%v err=%v", handled, err)
	}
	deviceJourneyWaitFor(t, 10*time.Second, "one multipart attachment POST", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(uploads) >= 1
	})
	mu.Lock()
	upload := uploads[0]
	mu.Unlock()
	if upload.method != http.MethodPost || upload.path != composerDropConversationPath+"/attachments" ||
		upload.query != "" || !upload.authorized || !strings.HasPrefix(upload.contentType, "multipart/form-data") {
		t.Fatalf("attachment request = %s %s?%s authorized=%v content-type=%q, want one authenticated multipart POST to the conversation attachment route",
			upload.method, upload.path, upload.query, upload.authorized, upload.contentType)
	}
	if upload.problem != "" || upload.field != "file" ||
		upload.filename != composerDropFilename || string(upload.content) != composerDropContent {
		t.Fatalf("multipart upload = problem=%q field=%q filename=%q bytes=%d",
			upload.problem, upload.field, upload.filename, len(upload.content))
	}
	// The chip only exists once the composer refetched the fixture's detail.
	whiteboxWait(t, page, `(() => {
		const form = `+composerDropComposerJS+`;
		const remove = form && Array.from(form.querySelectorAll("button")).find((button) =>
			button.getAttribute("aria-label") === `+deviceJourneyJSString("Remove attachment "+composerDropFilename)+`);
		return Boolean(remove) && remove.getClientRects().length > 0 &&
			form.textContent.includes(`+deviceJourneyJSString(composerDropFilename)+`);
	})()`)
	stayed, err := page.Eval(`location.href === window.__whiteboxDropURL && ` + composerDropComposerJS + ` !== null`)
	if err != nil || stayed != true {
		t.Fatalf("the saved attachment navigated the document instead of staying in the composer: stayed=%v err=%v", stayed, err)
	}
	if draft := deviceJourneyPrompt(t, page); draft != composerDropDraft {
		t.Fatalf("the dropped attachment changed the composer draft: %q", draft)
	}
	mu.Lock()
	count, extraWrites, turnCount := len(uploads), append([]string(nil), writes...), turns
	mu.Unlock()
	if count != 1 || len(extraWrites) != 0 || turnCount != 0 {
		t.Fatalf("the drop produced %d attachment POST(s) and %d non-attachment write(s) (turns=%d), want exactly one attachment POST and no conversation write",
			count, len(extraWrites), turnCount)
	}
	t.Logf("dropped File -> POST %s: field=%q filename=%q bytes=%d authorized=%v; chip visible; draft retained; no turn POST (turns=%d)",
		upload.path, upload.field, upload.filename, len(upload.content), upload.authorized, turnCount)
}
