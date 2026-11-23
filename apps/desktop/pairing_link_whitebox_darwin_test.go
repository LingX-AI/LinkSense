//go:build desktop_whitebox

package main

import (
	"bytes"
	"errors"
	"io/fs"
	"net/url"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

const pairingHeadingVisibleAndFocused = `(() => {
	const heading = document.getElementById("desktop-devices-heading");
	if (location.pathname !== "/settings/general" || location.hash !== "#desktop-devices-heading" ||
		!heading || heading.tagName !== "H2" || document.activeElement !== heading) return false;
	const rect = heading.getBoundingClientRect();
	return rect.top >= 0 && rect.bottom <= innerHeight &&
		heading.contains(document.elementFromPoint(rect.left + 2, rect.top + rect.height / 2));
})()`

func fixturePairingLink() string {
	return "linksense-desktop://pair?server=" + url.QueryEscape(nativeWhitebox.server.URL)
}

func pairingLinkFixture(t *testing.T) *deviceJourneyFixture {
	t.Helper()
	d := nativeWhitebox.desktop
	d.closeDevice()
	key := serverCredentialKey(d.server, "device")
	before, readErr := nativeWhitebox.store.Get(key)
	if readErr != nil && !errors.Is(readErr, mygo.ErrSecretNotFound) {
		t.Fatal(readErr)
	}
	if err := nativeWhitebox.store.Delete(key); err != nil {
		t.Fatal(err)
	}
	fixture := newDeviceJourneyFixture()
	deviceJourneyWhitebox.Store(fixture)
	t.Cleanup(func() {
		d.closeDevice()
		deviceJourneyWhitebox.Store(nil)
		fixture.close()
		var err error
		if readErr == nil {
			err = nativeWhitebox.store.Set(key, before)
		} else {
			err = nativeWhitebox.store.Delete(key)
		}
		if err != nil {
			t.Error(err)
		}
	})
	return fixture
}

// Hold the real index response on its scheme-serving goroutine. This proves
// delivery while there is no DOM, without racing the WebView against a sleep.
type initialPairingPageGate struct {
	fs.FS
	onOpen func() error
}

func (g initialPairingPageGate) Open(name string) (fs.File, error) {
	if name == "index.html" {
		if err := g.onOpen(); err != nil {
			return nil, err
		}
	}
	return g.FS.Open(name)
}

func TestNativePairingDeepLinkBeforeDOMReopensAndRequiresSubmit(t *testing.T) {
	nativeWhiteboxSession(t, true)
	fixture := pairingLinkFixture(t)
	d := nativeWhitebox.desktop
	var browserOpens atomic.Int32
	originalBrowser := d.openBrowser
	d.openBrowser = func(string) error {
		browserOpens.Add(1)
		return errors.New("pairing must not launch a browser")
	}
	t.Cleanup(func() { d.openBrowser = originalBrowser })

	entered, release := make(chan struct{}), make(chan struct{})
	markEntered := sync.OnceFunc(func() { close(entered) })
	unblock := sync.OnceFunc(func() { close(release) })
	dist := os.DirFS(os.Getenv("LINKSENSE_DESKTOP_WEB_DIST"))
	mygo.SetFrontend(initialPairingPageGate{FS: dist, onOpen: func() error {
		markEntered()
		select {
		case <-release:
			return nil
		case <-t.Context().Done():
			return t.Context().Err()
		case <-time.After(10 * time.Second):
			return errors.New("initial pairing document gate timed out")
		}
	}})

	d.openMainWindow()
	w := d.mainWindow()
	defer w.Destroy()
	defer func() {
		unblock()
		mygo.SetFrontend(dist)
	}()
	page := w.Page()
	ready := make(chan struct{}, 1)
	defer page.OnDOMReady(func() {
		select {
		case ready <- struct{}{}:
		default:
		}
	})()
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("the initial WebView document did not request index.html")
	}
	link := fixturePairingLink()
	d.handleOpenURL(link)
	mygo.RunOnMain(func() {}) // Deliver to MyGo's pre-DOM event buffer.
	select {
	case <-ready:
		t.Fatal("the initial DOM loaded before delivery was exercised")
	default:
	}
	unblock()
	whiteboxWait(t, page, pairingHeadingVisibleAndFocused)
	if _, err := page.Eval(`window.__pairingLinkDocument = "original"`); err != nil {
		t.Fatal(err)
	}

	// A hash-only change on General works even after hiding the window, and
	// invalid links neither restore it nor change the configured server.
	mygo.RunOnMain(func() { d.navigateMainWindow("/conversations/new") })
	whiteboxWait(t, page, `location.pathname === "/conversations/new"`)
	mygo.RunOnMain(func() { d.navigateMainWindow("/settings/general") })
	whiteboxWait(t, page, `location.pathname === "/settings/general" && location.hash === ""`)
	w.Hide()
	if w.IsVisible() {
		t.Fatal("the fixture window did not hide")
	}
	for _, invalid := range []string{
		"linksense-desktop://pair?server=https%3A%2F%2Fforeign.example.test",
		"linksense-desktop://pair?server=%XY",
		link + "&code=legacy",
	} {
		d.handleOpenURL(invalid)
	}
	mygo.RunOnMain(func() {})
	if w.IsVisible() {
		t.Fatal("an invalid pairing link presented a hidden window")
	}
	d.handleOpenURL(link)
	whiteboxWait(t, page, pairingHeadingVisibleAndFocused)
	if d.mainWindow() != w || !w.IsVisible() || w.IsMinimized() {
		t.Fatal("the pairing link did not present the original hidden window")
	}

	mygo.RunOnMain(func() { d.navigateMainWindow("/conversations/new") })
	whiteboxWait(t, page, `location.pathname === "/conversations/new"`)
	w.Minimize()
	deviceJourneyWaitFor(t, 5*time.Second, "window minimization", w.IsMinimized)
	d.handleOpenURL(link)
	whiteboxWait(t, page, pairingHeadingVisibleAndFocused)
	if d.mainWindow() != w || !w.IsVisible() || w.IsMinimized() {
		t.Fatal("the pairing link did not restore the original minimized window")
	}

	const input = `document.querySelector('input[name="deviceName"]')`
	whiteboxWait(t, page, input+` !== null`)
	if _, err := page.Eval(`(() => {
		window.__pairingLinkLocationKey = history.state?.key;
		const field = ` + input + `;
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, ` + deviceJourneyJSString(deviceJourneyPairName) + `);
		field.dispatchEvent(new Event("input", { bubbles: true }));
	})()`); err != nil {
		t.Fatal(err)
	}
	d.handleOpenURL(link)
	mygo.RunOnMain(func() {})
	whiteboxWait(t, page, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(
		window.__pairingLinkDocument === "original" &&
		window.__pairingLinkLocationKey === history.state?.key &&
		`+input+`?.value === `+deviceJourneyJSString(deviceJourneyPairName)+`))))`)
	if pairings, pairs, _, _, hellos := fixture.counts(); pairings != 0 || pairs != 0 || hellos != 0 {
		t.Fatalf("a link paired without submitting the form: issuance=%d exchange=%d sockets=%d", pairings, pairs, hellos)
	}
	key := serverCredentialKey(d.server, "device")
	if _, err := nativeWhitebox.store.Get(key); !errors.Is(err, mygo.ErrSecretNotFound) {
		t.Fatal("a link established a device credential before submission")
	}
	if d.server.String() != nativeWhitebox.server.URL || browserOpens.Load() != 0 {
		t.Fatal("a pairing link changed the configured origin or opened a browser")
	}

	if _, err := page.Eval(input + `.form.querySelector('button[type="submit"]').click()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `mygo.call("Desktop.DeviceStatus").then(status => status.state === "online")`)
	whiteboxWait(t, page, input+` === null`)
	credential, err := nativeWhitebox.store.Get(key)
	if err != nil || d.currentDevice() == nil {
		t.Fatal("submitting the form did not establish a device credential and connection")
	}
	device := d.currentDevice()
	mygo.RunOnMain(func() { d.navigateMainWindow("/conversations/new") })
	whiteboxWait(t, page, `location.pathname === "/conversations/new"`)
	d.handleOpenURL(link)
	whiteboxWait(t, page, pairingHeadingVisibleAndFocused)
	whiteboxWait(t, page, input+` === null && document.body.innerText.includes("Work laptop")`)
	if pairings, pairs, _, _, hellos := fixture.counts(); pairings != 1 || pairs != 1 || hellos != 1 {
		t.Fatalf("pairing form/link journey made unexpected requests: issuance=%d exchange=%d sockets=%d", pairings, pairs, hellos)
	}
	after, err := nativeWhitebox.store.Get(key)
	if err != nil || !bytes.Equal(credential, after) || d.currentDevice() != device || browserOpens.Load() != 0 {
		t.Fatal("reopening pairing settings changed an existing credential, connection, or browser")
	}
}

func TestNativePairingDeepLinkHonorsUnsavedSettingsOnce(t *testing.T) {
	link := fixturePairingLink()
	nativeDeepLinkHonorsUnsavedSettingsOnce(t, link, pairingHeadingVisibleAndFocused, link+"&code=legacy")
}

func TestNativePairingDeepLinkSurvivesCancelledSignIn(t *testing.T) {
	fixture := pairingLinkFixture(t)
	nativeDeepLinkSurvivesCancelledSignIn(t, fixturePairingLink(), pairingHeadingVisibleAndFocused)
	if pairings, pairs, _, _, hellos := fixture.counts(); pairings != 0 || pairs != 0 || hellos != 0 {
		t.Fatalf("sign-in and opening pairing settings paired a device: issuance=%d exchange=%d sockets=%d", pairings, pairs, hellos)
	}
}
