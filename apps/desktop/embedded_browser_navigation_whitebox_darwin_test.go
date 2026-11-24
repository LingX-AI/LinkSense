//go:build desktop_whitebox

package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

func TestNativeEmbeddedBrowserNavigationPolicy(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()

	var startHits, allowedHits, deniedHits atomic.Int32
	writeHTML := func(w http.ResponseWriter, body string) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = fmt.Fprint(w, "<!doctype html>", body)
	}
	denied := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		deniedHits.Add(1)
		writeHTML(w, `<p id="fixture-ready">denied</p>`)
	}))
	defer denied.Close()
	deniedURL := denied.URL + "/denied"
	allowed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.RequestURI {
		case "GET /start":
			startHits.Add(1)
			writeHTML(w, fmt.Sprintf(`<p id="fixture-ready">start</p><a id="denied" href=%q>Denied</a><a id="allowed" href="/allowed">Allowed</a>`, deniedURL))
		case "GET /allowed":
			allowedHits.Add(1)
			writeHTML(w, `<p id="fixture-ready">allowed</p>`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer allowed.Close()
	for _, fixture := range []*httptest.Server{allowed, denied} {
		addr, ok := fixture.Listener.Addr().(*net.TCPAddr)
		if !ok || addr.IP.String() != "127.0.0.1" || fixture.URL != "http://"+addr.String() {
			t.Fatalf("expected an owned IPv4 loopback origin; got %q", fixture.URL)
		}
	}
	if allowed.URL == denied.URL {
		t.Fatal("navigation fixtures must use distinct origins")
	}
	startURL, allowedURL := allowed.URL+"/start", allowed.URL+"/allowed"

	window := mygo.NewWindow(mygo.WindowOptions{Hidden: true, Content: ui.View(func(*ui.Context) {})})
	defer window.Destroy()
	view, err := window.NewWebView(mygo.WebViewOptions{Page: mygo.PageOptions{
		Untrusted: true,
		Session:   mygo.NewEphemeralSession(),
	}})
	if err != nil {
		t.Fatalf("create hidden browser WebView: %v", err)
	}
	defer view.Destroy()
	page := view.Page()

	type navigationEvent struct{ kind, url string }
	events := make(chan navigationEvent, 8)
	var overflow atomic.Bool
	observe := func(kind, url string) {
		select {
		case events <- navigationEvent{kind, url}:
		default:
			overflow.Store(true)
		}
	}
	defer page.OnWillNavigate(func(e *mygo.NavigateEvent) {
		// The fixture has one allowed destination, at the first owned origin.
		if e.URL != allowedURL {
			e.PreventDefault()
		}
		observe("policy", e.URL)
	})()
	defer page.OnDidNavigate(func(url string) { observe("commit", url) })()
	defer page.OnDidFinishLoad(func() { observe("finish", page.URL()) })()

	expect := func(kind, url string) {
		t.Helper()
		select {
		case got := <-events:
			if got.kind != kind || got.url != url {
				t.Fatalf("received %s for %q; want %s for %q", got.kind, got.url, kind, url)
			}
		case <-ctx.Done():
			t.Fatalf("waiting for %s of %q: %v", kind, url, ctx.Err())
		}
	}
	assertDocument := func(url, marker string) {
		t.Helper()
		got, err := page.EvalContext(ctx, fmt.Sprintf(`location.href === %q && document.getElementById("fixture-ready")?.textContent === %q`, url, marker))
		if err != nil || got != true {
			t.Fatalf("expected %q document at %q; result=%v err=%v", marker, url, got, err)
		}
	}
	click := func(id, url string) {
		t.Helper()
		// Schedule the ordinary link click after the Eval response is computed.
		got, err := page.EvalContext(ctx, fmt.Sprintf(`(() => {
			const link = document.getElementById(%q);
			if (!(link instanceof HTMLAnchorElement) || link.href !== %q || link.target !== "") return false;
			setTimeout(() => link.click(), 0);
			return true;
		})()`, id, url))
		if err != nil || got != true {
			t.Fatalf("could not click %q at %q: result=%v err=%v", id, url, got, err)
		}
	}

	// LoadURL skips the link policy; seed only the validated owned origin.
	if err := page.LoadURL(startURL); err != nil {
		t.Fatalf("load fixture: %v", err)
	}
	expect("commit", startURL)
	expect("finish", startURL)
	assertDocument(startURL, "start")

	click("denied", deniedURL)
	expect("policy", deniedURL)
	assertDocument(startURL, "start")

	// Complete another link navigation to fence the denial check.
	click("allowed", allowedURL)
	expect("policy", allowedURL)
	expect("commit", allowedURL)
	expect("finish", allowedURL)
	assertDocument(allowedURL, "allowed")
	select {
	case got := <-events:
		t.Fatalf("unexpected %s for %q", got.kind, got.url)
	default:
	}
	if overflow.Load() {
		t.Fatal("navigation callback buffer overflowed")
	}
	if start, allowed, denied := startHits.Load(), allowedHits.Load(), deniedHits.Load(); start != 1 || allowed != 1 || denied != 0 {
		t.Fatalf("got HTTP requests start=%d allowed=%d denied=%d; want 1, 1, 0", start, allowed, denied)
	}
	t.Logf("blocked %s and stayed on %s; allowed %s with commit, finish, DOM marker and HTTP GET", deniedURL, startURL, allowedURL)
}
