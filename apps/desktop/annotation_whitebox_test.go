//go:build desktop_whitebox

package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const (
	annotationConversation = "71000000-0000-4000-8000-000000000001"
	annotationPreview      = "71000000-0000-4000-8000-000000000002"
	annotationDevelopment  = "71000000-0000-4000-8000-000000000003"
	annotationApplication  = "71000000-0000-4000-8000-000000000004"
	annotationPackage      = "71000000-0000-4000-8000-000000000005"
	annotationTitle        = "Native annotation fixture"
)

var annotationTicket = strings.Repeat("p", 43)

type annotationWhitebox struct {
	posts atomic.Int32
}

// annotationFixtureHTML stands in for a user-authored interactive application.
// Its capture-phase publisher listeners are registered after the preload, so
// the test proves the preload wins during annotation mode.
const annotationFixtureHTML = `<!doctype html>
<html><head><title>Fixture</title></head><body>
<button id="test-target">Fixture control</button>
<form id="test-form"><input name="value" value="fixture"><button id="submit-target" type="submit">Submit</button></form>
<a id="second-page" href="details.html">Another page</a>
<script>
(() => {
  const button = document.querySelector('#test-target');
  const form = document.querySelector('#test-form');
  // Direct children report to the native window. A synthetic intermediate
  // host passes its own origin so the same fixture can run nested.
  const parentOrigin = new URLSearchParams(location.search).get('reportTo') || 'mygo://localhost';
  const report = (payload) => parent.postMessage({
    ...payload,
    native: !!window.mygo,
    navigationApi: !!window.navigation,
    path: location.pathname,
    scope: document.body.hasAttribute('data-office-annotation-scope'),
  }, parentOrigin);
  report({fixture: 'loaded'});
  button.addEventListener('click', () => report({fixture: 'activated'}));
  window.addEventListener('click', () => report({fixture: 'captured'}), true);
  document.addEventListener('click', () => report({fixture: 'document-captured'}), true);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    report({fixture: 'submitted'});
  });
  addEventListener('message', (event) => {
    if (event.origin !== parentOrigin || event.source !== parent) return;
    if (event.data === 'linksense:desktop-application-annotation:initialize') {
      // The preload stops propagation only when it accepts this document.
      report({fixture: 'init-observed'});
      return;
    }
    if (!event.data || typeof event.data !== 'object') return;
    if (event.data.fixture === 'select') {
      const rect = button.getBoundingClientRect();
      const point = {clientX: rect.left + 4, clientY: rect.top + 4, button: 0, bubbles: true, cancelable: true};
      button.dispatchEvent(new MouseEvent('mousedown', {...point, buttons: 1}));
      button.dispatchEvent(new MouseEvent('mouseup', {...point, buttons: 0}));
      button.click();
      report({fixture: 'selected'});
      return;
    }
    if (event.data.fixture === 'submit') {
      form.requestSubmit();
      report({fixture: 'submit-attempted'});
      return;
    }
    if (event.data.fixture === 'history') {
      history.pushState({fixture: true}, '', event.data.path);
      report({fixture: 'history-set', path: location.pathname});
      return;
    }
    if (event.data.fixture === 'status') {
      report({fixture: 'status', id: event.data.id});
    }
  });
})();
</script></body></html>`

// annotationNestedHostHTML is a synthetic intermediate frame. It embeds the
// same runtime fixture one level deeper than the native window, so the fixture
// is not a direct child of the page that owns the preload.
const annotationNestedHostHTML = `<!doctype html>
<html><head><title>Nested host</title></head><body>
<script>
(() => {
  const nested = document.createElement('iframe');
  nested.src = new URL('index.html?reportTo=' + encodeURIComponent(location.origin), location.href).href;
  document.body.append(nested);
  const nestedOrigin = new URL(nested.src).origin;
  addEventListener('message', (event) => {
    if (event.source === nested.contentWindow) {
      if (event.data && typeof event.data === 'object')
        parent.postMessage({nested: event.data}, 'mygo://localhost');
      return;
    }
    if (event.origin !== 'mygo://localhost' || event.source !== parent) return;
    if (event.data === 'bridge-nested') {
      const channel = new MessageChannel();
      channel.port1.onmessage = (message) => {
        if (message.data?.type === 'linksense:desktop-application-annotation:ready')
          parent.postMessage({nestedReady: true}, 'mygo://localhost');
      };
      nested.contentWindow.postMessage('linksense:desktop-application-annotation:initialize', nestedOrigin, [channel.port2]);
      return;
    }
    if (event.data === 'probe-nested') {
      nested.contentWindow.postMessage({fixture: 'status', id: 'nested'}, nestedOrigin);
    }
  });
})();
</script></body></html>`

func (a *annotationWhitebox) serve(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		a.posts.Add(1)
	}
	if strings.HasPrefix(r.URL.Path, "/api/v1/interactive-app-runtime/") &&
		strings.HasSuffix(r.URL.Path, "/nested-host.html") {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Referrer-Policy", "no-referrer")
		_, _ = fmt.Fprint(w, annotationNestedHostHTML)
		return true
	}
	if strings.HasPrefix(r.URL.Path, "/api/v1/interactive-app-runtime/") &&
		strings.HasSuffix(r.URL.Path, ".html") {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		// Keep the production frame security headers covered.
		w.Header().Set("Referrer-Policy", "no-referrer")
		_, _ = fmt.Fprint(w, annotationFixtureHTML)
		return true
	}
	root := "/api/v1/interactive-app-runtime/" + annotationTicket + "/"

	manifest := map[string]any{
		"schema_version": 1, "id": "native-annotation-fixture", "name": annotationTitle,
		"version": "1.0.0", "description": nil, "instructions": nil, "icon": nil,
		"entry": "index.html", "sdk_version": 1, "permissions": []string{}, "custom_events": []string{},
	}
	var data any
	switch r.URL.Path {
	case "/api/v1/application-developments/by-conversation/" + annotationConversation,
		"/api/v1/application-developments/" + annotationDevelopment + "/sync":
		data = map[string]any{
			"id": annotationDevelopment, "conversation_id": annotationConversation,
			"name": annotationTitle, "directory": "apps/annotations",
			"application_id": nil, "preview_application_id": annotationApplication,
			"preview_conversation_id": annotationPreview, "preview_current": true,
			"revision": 1, "source_hash": strings.Repeat("a", 64), "installed_source_hash": nil,
			"source_error": nil, "manifest": manifest, "diagnostics": []any{}, "updated_at": fixtureTime,
		}
	case "/api/v1/conversations/" + annotationConversation,
		"/api/v1/conversations/" + annotationPreview:
		conversation := map[string]any{
			"id": strings.TrimPrefix(r.URL.Path, "/api/v1/conversations/"), "title": annotationTitle,
			"project_id": nil, "updated_at": fixtureTime, "execution_status": "idle",
		}
		if r.URL.Path == "/api/v1/conversations/"+annotationPreview {
			conversation["application"] = map[string]any{
				"id": annotationApplication, "name": annotationTitle, "kind": "interactive",
				"package_id": annotationPackage,
			}
		}
		data = conversation
	case "/api/v1/applications/" + annotationApplication:
		data = map[string]any{
			"id": annotationApplication, "owner": map[string]string{"id": deviceFixtureCredential().OwnerID, "name": "Eli"},
			"name": annotationTitle, "icon": map[string]string{"type": "preset", "preset": "sparkles"},
			"description": nil, "kind": "interactive", "instructions": nil, "model": nil,
			"reasoning_effort": nil, "status": "active", "is_owner": true, "can_manage": true,
			"access_source": "owner", "capability_count": 0, "knowledge_base_count": 0, "mcp_server_count": 0,
			"share_targets": []any{}, "dependencies_available": true, "capabilities": []any{},
			"knowledge_bases": []any{}, "mcp_servers": []any{},
			"interactive_package": map[string]any{
				"id": annotationPackage, "version": "1.0.0", "manifest": manifest, "created_at": fixtureTime,
			},
			"created_at": fixtureTime, "updated_at": fixtureTime,
		}
	case "/api/v1/applications/" + annotationApplication + "/interactive-runtime-token":
		data = map[string]any{
			"runtime_url": root + "index.html", "expires_at": time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339), "manifest": manifest,
		}
	default:
		return false
	}
	if cloudAuthorized(w, r) {
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": data})
	}
	return true
}

func TestNativeCrossOriginApplicationAnnotation(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("the application annotation preload is macOS-only")
	}
	nativeWhiteboxSession(t, true)
	annotation := &annotationWhitebox{}
	nativeWhitebox.annotation.Store(annotation)
	defer nativeWhitebox.annotation.Store(nil)
	// A second loopback origin serves the same synthetic document. The preload
	// is configured for the packaged API origin only, so this frame must stay
	// outside annotation mode.
	wrongOriginServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Referrer-Policy", "no-referrer")
		_, _ = fmt.Fprint(w, annotationFixtureHTML)
	}))
	defer wrongOriginServer.Close()
	wrongOrigin := wrongOriginServer.URL
	wrongOriginPath := "/api/v1/interactive-app-runtime/" + strings.Repeat("w", 43) + "/index.html"
	nestedDecoyPath := "/api/v1/interactive-app-runtime/" + strings.Repeat("n", 43) + "/nested-host.html"
	desktop := nativeWhitebox.desktop
	desktop.openMainWindow()
	win := desktop.mainWindow()
	defer win.Destroy()
	page := win.Page()
	if userAgent, err := page.Eval(`navigator.userAgent`); err == nil {
		t.Logf("WKWebView user agent: %v", userAgent)
	}
	if err := page.LoadURL("/conversations/" + annotationConversation); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Annotate' && !button.disabled)`)
	run := func(script string) {
		t.Helper()
		if _, err := page.Eval(script); err != nil {
			t.Fatal(err)
		}
	}
	wait := func(expression string) {
		t.Helper()
		whiteboxWait(t, page, expression)
	}

	mainPath := "/api/v1/interactive-app-runtime/" + annotationTicket + "/index.html"
	mainDetailsPath := "/api/v1/interactive-app-runtime/" + annotationTicket + "/details.html"
	validDecoyPath := "/api/v1/interactive-app-runtime/" + strings.Repeat("c", 43) + "/index.html"
	untouchedDecoyPath := "/api/v1/interactive-app-runtime/" + strings.Repeat("d", 43) + "/index.html"
	wrongDecoyPath := "/api/v1/interactive-app-runtime/short/index.html"

	run(fmt.Sprintf(`(() => {
		const frame = document.querySelector('iframe[title=%q]');
		if (!frame) throw new Error('missing preview frame');
		const senderOrigin = new URL(frame.src).origin;
		window.annotationFrame = frame;
		window.annotationFixture = {
			clicks: 0, captured: 0, documentCaptured: 0, submitted: 0,
			submitAttempts: 0, selected: 0, loads: {}, statuses: {},
			initObserved: {}, validReady: false, validReadyTicket: null, wrongReady: false,
		};
		window.addEventListener('message', event => {
			if (event.origin !== senderOrigin || !event.data || typeof event.data !== 'object') return;
			const data = event.data;
			if (data.fixture === 'loaded') { annotationFixture.loads[data.path] = true; return; }
			if (data.fixture === 'status') { annotationFixture.statuses[data.id] = data; return; }
			if (data.fixture === 'init-observed') { annotationFixture.initObserved[data.path] = true; return; }
			if (event.source !== frame.contentWindow) return;
			if (data.fixture === 'activated') annotationFixture.clicks++;
			if (data.fixture === 'captured') annotationFixture.captured++;
			if (data.fixture === 'document-captured') annotationFixture.documentCaptured++;
			if (data.fixture === 'submitted') annotationFixture.submitted++;
			if (data.fixture === 'submit-attempted') annotationFixture.submitAttempts++;
			if (data.fixture === 'selected') {
				annotationFixture.selected++;
				annotationFixture.native = data.native;
				annotationFixture.selectedPath = data.path;
			}
		});
		window.selectFixtureTarget = () => frame.contentWindow.postMessage({fixture: 'select'}, senderOrigin);
		window.submitFixtureForm = () => frame.contentWindow.postMessage({fixture: 'submit'}, senderOrigin);
	})()`, annotationTitle))
	// The fixture loads before this listener exists, so ask for its current
	// state instead of depending on the one-shot load report.
	run(`annotationFrame.contentWindow.postMessage({fixture: 'status', id: 'main'}, new URL(annotationFrame.src).origin)`)
	wait(fmt.Sprintf(`annotationFixture.statuses.main?.path === %q && annotationFixture.statuses.main.native === false`, mainPath))
	if available, err := page.Eval(`annotationFixture.statuses.main?.navigationApi`); err == nil {
		t.Logf("WKWebView Navigation API available: %v", available)
	}

	// Outside annotation mode the application's own capture and bubble
	// listeners run, including its real submit handler.
	run(`selectFixtureTarget(); submitFixtureForm()`)
	wait(`annotationFixture.selected === 1 && annotationFixture.clicks === 1 &&
		annotationFixture.captured === 1 && annotationFixture.documentCaptured === 1 &&
		annotationFixture.submitted === 1 && annotationFixture.submitAttempts === 1 &&
		annotationFixture.native === false && annotationFixture.selectedPath === ` + fmt.Sprintf("%q", mainPath))

	run(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Annotate').click()`)
	wait(`Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Exit annotation')`)

	// Selecting during annotation mode suppresses every publisher listener,
	// including capture listeners registered after the preload.
	run(`selectFixtureTarget()`)
	wait(`annotationFixture.selected === 2 && annotationFixture.clicks === 1 &&
		annotationFixture.captured === 1 && annotationFixture.documentCaptured === 1 &&
		Array.from(document.querySelectorAll('button')).some(button => button.textContent.includes('Ask LinkSense'))`)
	run(`submitFixtureForm()`)
	wait(`annotationFixture.submitAttempts === 2 && annotationFixture.submitted === 1`)

	run(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Ask LinkSense')).click()`)
	wait(`document.querySelector('[role=dialog] textarea') !== null`)
	run(`(() => {
		const input = document.querySelector('[role=dialog] textarea');
		Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Make this control clearer.');
		input.dispatchEvent(new Event('input', {bubbles:true}));
	})()`)
	wait(`document.querySelector('[role=dialog] button[aria-label="Add annotation"]')?.disabled === false`)
	run(`document.querySelector('[role=dialog] button[aria-label="Add annotation"]').click()`)
	wait(`document.querySelector('.html-preview-annotation-frame') !== null`)

	// Leaving annotation mode keeps the pending marker and restores the app.
	run(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Exit annotation').click()`)
	wait(`document.querySelector('.html-preview-annotation-frame') !== null &&
		Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Annotate')`)
	run(`selectFixtureTarget()`)
	wait(`annotationFixture.selected === 3 && annotationFixture.clicks === 2 &&
		annotationFixture.captured === 2 && annotationFixture.documentCaptured === 2`)
	run(`submitFixtureForm()`)
	wait(`annotationFixture.submitAttempts === 3 && annotationFixture.submitted === 2`)

	// A normal same-document History change while annotation mode is off is
	// detected by the bridge itself: no focus, selection, or bridge command
	// drives it. Drafts stay, Send is disabled, and no API write is attempted.
	annotation.posts.Store(0)
	run(`annotationFrame.contentWindow.postMessage({fixture: 'history', path: 'details.html'}, new URL(annotationFrame.src).origin)`)
	wait(`document.body.innerText.includes('The page has changed.') &&
		document.querySelector('.html-preview-annotation-frame') === null &&
		Array.from(document.querySelectorAll('button')).some(button => button.getAttribute('aria-label') === 'View 1 pending annotations')`)
	if loaded, err := page.Eval(fmt.Sprintf(`annotationFixture.loads[%q] === true`, mainDetailsPath)); err != nil || loaded != false {
		t.Fatalf("a same-document route change reloaded the frame: %v %v", loaded, err)
	}
	run(`(() => {
		const trigger = Array.from(document.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === 'View 1 pending annotations');
		if (!document.querySelector('.office-annotation-batch-send')) trigger.click();
	})()`)
	wait(`document.querySelector('.office-annotation-batch-send') !== null`)
	if disabled, err := page.Eval(`document.querySelector('.office-annotation-batch-send').disabled`); err != nil || disabled != true {
		t.Fatalf("a History-changed page still offered submit: %v %v", disabled, err)
	}
	run(`document.querySelector('.office-annotation-batch-send').click()`)
	if posts := annotation.posts.Load(); posts != 0 {
		t.Fatalf("a mismatched page attempted %d writes", posts)
	}
	if unchanged, err := page.Eval(`annotationFixture.selected === 3`); err != nil || unchanged != true {
		t.Fatalf("the bridge changed selection on another page: %v %v", unchanged, err)
	}

	// Returning with History keeps the same document and port: no iframe load
	// occurs, the pending draft matches again, and its marker is repainted.
	run(`annotationFrame.contentWindow.postMessage({fixture: 'history', path: 'index.html'}, new URL(annotationFrame.src).origin)`)
	wait(`!document.body.innerText.includes('The page has changed.') &&
		Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Annotate' && !button.disabled)`)
	wait(`document.querySelector('.office-annotation-batch-send')?.disabled === false`)
	wait(`document.querySelector('.html-preview-annotation-frame') !== null`)
	if loaded, err := page.Eval(fmt.Sprintf(`annotationFixture.loads[%q] === true`, mainDetailsPath)); err != nil || loaded != false {
		t.Fatalf("the History return reloaded the frame: %v %v", loaded, err)
	}

	// A full child navigation changes the live page path. Drafts stay, the
	// old marker disappears, and submit is not offered for the new path.
	run(`(() => {
		const frame = annotationFrame;
		frame.src = new URL('details.html', frame.src).href;
	})()`)
	wait(`document.body.innerText.includes('The page has changed.') &&
		document.querySelector('.html-preview-annotation-frame') === null &&
		Array.from(document.querySelectorAll('button')).some(button => button.getAttribute('aria-label') === 'View 1 pending annotations')`)
	run(`(() => {
		const trigger = Array.from(document.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === 'View 1 pending annotations');
		if (!document.querySelector('.office-annotation-batch-send')) trigger.click();
	})()`)
	wait(`document.querySelector('.office-annotation-batch-send') !== null`)
	if disabled, err := page.Eval(`document.querySelector('.office-annotation-batch-send').disabled`); err != nil || disabled != true {
		t.Fatalf("a changed page still offered submit: %v %v", disabled, err)
	}

	// Returning to the original page keeps the drafts and enables submit.
	run(`(() => {
		const frame = annotationFrame;
		frame.src = new URL('index.html', frame.src).href;
	})()`)
	wait(`!document.body.innerText.includes('The page has changed.') &&
		Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Annotate' && !button.disabled)`)
	wait(`document.querySelector('.office-annotation-batch-send')?.disabled === false`)

	// Other frames at the same API origin are never initialized by the host.
	run(fmt.Sprintf(`(() => {
		const origin = new URL(annotationFrame.src).origin;
		const paths = {valid: %q, untouched: %q, wrong: %q};
		const names = ['valid', 'untouched', 'wrong'];
		annotationFixture.decoys = {};
		for (const name of names) {
			const frame = document.createElement('iframe');
			frame.id = 'decoy-' + name;
			frame.src = new URL(paths[name], origin).href;
			document.body.append(frame);
			annotationFixture.decoys[name] = frame;
		}
	})()`, validDecoyPath, untouchedDecoyPath, wrongDecoyPath))
	wait(fmt.Sprintf(`annotationFixture.loads[%q] === true && annotationFixture.loads[%q] === true && annotationFixture.loads[%q] === true`,
		validDecoyPath, untouchedDecoyPath, wrongDecoyPath))

	// A valid runtime path at the same origin accepts a port and answers its
	// own ticket, proving the transport the host uses for the selected frame.
	run(`(() => {
		const frame = annotationFixture.decoys.valid;
		const origin = new URL(frame.src).origin;
		annotationFixture.validChannel = new MessageChannel();
		annotationFixture.validChannel.port1.onmessage = event => {
			if (event.data?.type === 'linksense:desktop-application-annotation:ready') {
				annotationFixture.validReady = true;
				annotationFixture.validReadyTicket = event.data.ticket;
			}
			if (event.data?.type === 'linksense:html-preview:selection-change') annotationFixture.validModeReported = true;
			if (event.data === 'linksense:desktop-application-annotation:closed') annotationFixture.validClosed = true;
		};
		frame.contentWindow.postMessage('linksense:desktop-application-annotation:initialize', origin, [annotationFixture.validChannel.port2]);
	})()`)
	wait(`annotationFixture.validReady === true`)
	run(`(() => {
		annotationFixture.validChannel.port1.postMessage({
			type: 'linksense:html-preview:annotation-mode', enabled: true, selectionColor: '#0b73e0',
		});
	})()`)
	wait(`annotationFixture.validModeReported === true`)
	run(`annotationFixture.decoys.valid.contentWindow.postMessage({fixture: 'status', id: 'valid'}, new URL(annotationFixture.decoys.valid.src).origin)`)
	wait(`annotationFixture.statuses.valid?.scope === true`)
	// The decoy's own mode command must not select in or annotate the frame
	// the user actually chose.
	run(`annotationFrame.contentWindow.postMessage({fixture: 'status', id: 'main-after-decoy'}, new URL(annotationFrame.src).origin)`)
	wait(`annotationFixture.statuses['main-after-decoy']?.scope === false && annotationFixture.selected === 3`)
	if ticket, err := page.Eval(`annotationFixture.validReadyTicket`); err != nil || ticket != strings.Repeat("c", 43) {
		t.Fatalf("the decoy reported another ticket: %v %v", ticket, err)
	}

	// An invalid ticket path ignores the same initialize and its mode command.
	run(`(() => {
		const frame = annotationFixture.decoys.wrong;
		const origin = new URL(frame.src).origin;
		annotationFixture.wrongChannel = new MessageChannel();
		annotationFixture.wrongChannel.port1.onmessage = event => {
			if (event.data?.type === 'linksense:desktop-application-annotation:ready') annotationFixture.wrongReady = true;
		};
		frame.contentWindow.postMessage('linksense:desktop-application-annotation:initialize', origin, [annotationFixture.wrongChannel.port2]);
		frame.contentWindow.postMessage({fixture: 'status', id: 'wrong'}, origin);
	})()`)
	wait(fmt.Sprintf(`annotationFixture.initObserved[%q] === true && annotationFixture.statuses.wrong?.scope === false`, wrongDecoyPath))

	// The host never initialized the untouched same-origin frame, so it stays
	// out of annotation mode while the selected frame works normally.
	run(`annotationFixture.decoys.untouched.contentWindow.postMessage({fixture: 'status', id: 'untouched'}, new URL(annotationFixture.decoys.untouched.src).origin)`)
	wait(`annotationFixture.statuses.untouched?.scope === false`)
	if ready, err := page.Eval(`annotationFixture.wrongReady`); err != nil || ready != false {
		t.Fatalf("an invalid runtime path accepted the bridge: %v %v", ready, err)
	}

	// A direct child at another loopback origin is not the packaged API
	// origin. The initialize reaches the page's own listener instead of being
	// consumed by the preload, and the port never becomes ready.
	run(fmt.Sprintf(`(() => {
		annotationFixture.wrongOrigin = {loaded: false, initObserved: false, ready: false, status: null};
		window.addEventListener('message', event => {
			if (event.origin !== new URL(%q).origin || !event.data || typeof event.data !== 'object') return;
			if (event.data.fixture === 'loaded') annotationFixture.wrongOrigin.loaded = true;
			if (event.data.fixture === 'init-observed') annotationFixture.wrongOrigin.initObserved = true;
			if (event.data.fixture === 'status') annotationFixture.wrongOrigin.status = event.data;
		});
		const frame = document.createElement('iframe');
		frame.id = 'decoy-wrong-origin';
		frame.src = new URL(%q, %q).href;
		document.body.append(frame);
		annotationFixture.decoys['wrong-origin'] = frame;
	})()`, wrongOrigin, wrongOriginPath, wrongOrigin))
	wait(`annotationFixture.wrongOrigin.loaded === true`)
	run(fmt.Sprintf(`(() => {
		const frame = annotationFixture.decoys['wrong-origin'];
		const origin = new URL(%q).origin;
		annotationFixture.wrongOriginChannel = new MessageChannel();
		annotationFixture.wrongOriginChannel.port1.onmessage = event => {
			if (event.data?.type === 'linksense:desktop-application-annotation:ready') annotationFixture.wrongOrigin.ready = true;
		};
		frame.contentWindow.postMessage('linksense:desktop-application-annotation:initialize', origin, [annotationFixture.wrongOriginChannel.port2]);
		frame.contentWindow.postMessage({fixture: 'status', id: 'wrong-origin'}, origin);
	})()`, wrongOrigin))
	wait(`annotationFixture.wrongOrigin.initObserved === true &&
		annotationFixture.wrongOrigin.status?.scope === false &&
		annotationFixture.wrongOrigin.status.native === false`)
	if ready, err := page.Eval(`annotationFixture.wrongOrigin.ready`); err != nil || ready != false {
		t.Fatalf("a frame at another origin accepted the bridge: %v %v", ready, err)
	}

	// A runtime document nested inside another frame is not a direct child of
	// the native window. It also stays out of annotation mode without a port.
	run(fmt.Sprintf(`(() => {
		annotationFixture.nested = [];
		annotationFixture.nestedReady = false;
		const serverOrigin = new URL(annotationFrame.src).origin;
		window.addEventListener('message', event => {
			if (event.source !== annotationFixture.nestedHost?.contentWindow) return;
			if (event.data?.nestedReady === true) annotationFixture.nestedReady = true;
			if (event.data?.nested) annotationFixture.nested.push(event.data.nested);
		});
		const host = document.createElement('iframe');
		host.id = 'decoy-nested';
		host.src = new URL(%q, serverOrigin).href;
		annotationFixture.nestedHost = host;
		document.body.append(host);
	})()`, nestedDecoyPath))
	wait(`annotationFixture.nested.some(message => message.fixture === 'loaded')`)
	run(`annotationFixture.nestedHost.contentWindow.postMessage('bridge-nested', new URL(annotationFrame.src).origin)`)
	run(`annotationFixture.nestedHost.contentWindow.postMessage('probe-nested', new URL(annotationFrame.src).origin)`)
	wait(`annotationFixture.nested.some(message => message.fixture === 'init-observed') &&
		annotationFixture.nested.some(message => message.fixture === 'status' && message.id === 'nested' && message.scope === false && message.native === false)`)
	if ready, err := page.Eval(`annotationFixture.nestedReady`); err != nil || ready != false {
		t.Fatalf("a nested frame accepted the bridge: %v %v", ready, err)
	}

	// Closing the decoy's port restores its document.
	run(`annotationFixture.validChannel.port1.postMessage('linksense:desktop-application-annotation:destroy')`)
	wait(`annotationFixture.validClosed === true`)
	run(`annotationFixture.decoys.valid.contentWindow.postMessage({fixture: 'status', id: 'valid-after'}, new URL(annotationFixture.decoys.valid.src).origin)`)
	wait(`annotationFixture.statuses['valid-after']?.scope === false`)
	for _, name := range []string{"valid", "untouched", "wrong", "wrong-origin"} {
		run(fmt.Sprintf(`annotationFixture.decoys[%q].remove()`, name))
	}
	run(`annotationFixture.nestedHost.remove()`)
}
