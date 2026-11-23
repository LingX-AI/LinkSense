//go:build desktop_whitebox

package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

const embeddedBrowserFixtureName = "EmbeddedBrowserFixture"
const embeddedBrowserFixtureReply = "fixture-reply"

type embeddedBrowserCallReceipt struct {
	page     *mygo.Page
	argument string
}

type embeddedBrowserFixtureBridge struct {
	calls atomic.Int32
	last  atomic.Pointer[embeddedBrowserCallReceipt]
}

var bindEmbeddedBrowserFixture = sync.OnceValue(func() *embeddedBrowserFixtureBridge {
	bridge := new(embeddedBrowserFixtureBridge)
	mygo.BindAs(embeddedBrowserFixtureName, bridge)
	return bridge
})

func (b *embeddedBrowserFixtureBridge) Probe(ctx context.Context, argument string) string {
	b.last.Store(&embeddedBrowserCallReceipt{page: mygo.CallerPage(ctx), argument: argument})
	b.calls.Add(1)
	return embeddedBrowserFixtureReply
}

func TestNativeEmbeddedBrowserBoundary(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 25*time.Second)
	defer cancel()

	const mainCookie, browserCookie, cookieValue = "fixture-main", "fixture-browser", "synthetic"
	requests := map[string]*struct {
		set, want   string
		hits        atomic.Int32
		wrongCookie atomic.Bool
	}{
		"/seed-main":     {set: mainCookie},
		"/seed-browser":  {set: browserCookie},
		"/check-main":    {want: mainCookie},
		"/check-browser": {want: browserCookie},
		"/check-tab":     {want: browserCookie},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		request := requests[r.RequestURI]
		if request == nil || r.Method != http.MethodGet {
			http.NotFound(w, r)
			return
		}
		cookies := r.Cookies()
		matches := len(cookies) == 0
		if request.want != "" {
			matches = len(cookies) == 1 && cookies[0].Name == request.want && cookies[0].Value == cookieValue
		}
		if !matches {
			request.wrongCookie.Store(true)
		}
		request.hits.Add(1)
		if request.set != "" {
			http.SetCookie(w, &http.Cookie{Name: request.set, Value: cookieValue, HttpOnly: true, Path: "/"})
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = fmt.Fprintf(w, `<!doctype html><p id="fixture-ready">%s</p>`, r.RequestURI)
	}))
	defer server.Close()

	main := mygo.NewWindow(mygo.WindowOptions{Hidden: true, Page: mygo.PageOptions{
		TrustedOrigins: []string{server.URL},
		Session:        mygo.NewEphemeralSession(),
	}})
	defer main.Destroy()
	browser := mygo.NewWindow(mygo.WindowOptions{Hidden: true, Content: ui.View(func(*ui.Context) {})})
	defer browser.Destroy()
	session := mygo.NewEphemeralSession()
	newTab := func() *mygo.WebView {
		t.Helper()
		view, err := browser.NewWebView(mygo.WebViewOptions{Page: mygo.PageOptions{Untrusted: true, Session: session}})
		if err != nil {
			t.Fatalf("create hidden browser WebView: %v", err)
		}
		return view
	}

	load := func(page *mygo.Page, path string) {
		t.Helper()
		target := server.URL + path
		finished := make(chan struct{}, 1)
		off := page.OnDidFinishLoad(func() {
			if page.URL() == target {
				select {
				case finished <- struct{}{}:
				default:
				}
			}
		})
		defer off()
		if err := page.LoadURL(target); err != nil {
			t.Fatalf("%s: start fixture load: %v", path, err)
		}
		select {
		case <-finished:
		case <-ctx.Done():
			t.Fatalf("%s: native fixture load did not finish: %v", path, ctx.Err())
		}
		got, err := page.EvalContext(ctx, fmt.Sprintf(`location.href === %q && document.getElementById("fixture-ready")?.textContent === %q`, target, path))
		if err != nil || got != true {
			t.Fatalf("%s: fixture document not ready: result=%v err=%v", path, got, err)
		}
		request := requests[path]
		if hits, wrong := request.hits.Load(), request.wrongCookie.Load(); hits != 1 || wrong {
			t.Fatalf("%s: wrong request or session cookies: requests=%d wrongCookie=%t", path, hits, wrong)
		}
	}

	tab := newTab()
	defer tab.Destroy()
	load(main.Page(), "/seed-main")
	load(tab.Page(), "/seed-browser")
	load(main.Page(), "/check-main")
	load(tab.Page(), "/check-browser")
	secondTab := newTab()
	defer secondTab.Destroy()
	load(secondTab.Page(), "/check-tab")

	bridge := bindEmbeddedBrowserFixture()
	defer bridge.last.Store(nil)
	before := bridge.calls.Load()
	const method = embeddedBrowserFixtureName + ".Probe"
	const argument = "fixture-argument"
	const denied = "CallError:" + method + ":this page is untrusted (PageOptions.Untrusted) and may not call Go methods"
	call := fmt.Sprintf(`mygo.call(%q, %q).then(
		value => "ok:" + value,
		error => error.name + ":" + error.method + ":" + error.message
	)`, method, argument)
	checkBridge := func(label string, page *mygo.Page, want string) {
		t.Helper()
		if got, err := page.EvalContext(ctx, call); err != nil || got != want {
			t.Fatalf("%s: bridge reply=%v err=%v; want %q", label, got, err, want)
		}
	}
	checkBridge("trusted main", main.Page(), "ok:"+embeddedBrowserFixtureReply)
	if receipt := bridge.last.Load(); receipt == nil || receipt.page != main.Page() || receipt.argument != argument {
		t.Fatal("trusted call did not reach Go with its exact page and argument")
	}
	checkBridge("untrusted browser tab", tab.Page(), denied)
	checkBridge("untrusted second browser tab", secondTab.Page(), denied)
	if calls := bridge.calls.Load() - before; calls != 1 {
		t.Fatalf("fixture binding received %d calls; only the trusted call should reach Go", calls)
	}
}
