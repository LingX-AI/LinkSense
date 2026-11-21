//go:build desktop_whitebox

package main

// Real WKWebView whitebox of the P1-22 update Settings surface. The built
// React Settings page runs in the platform WebView, calls the generated
// desktop bindings, receives native desktop:update-changed events, and is
// served by the real desktopUpdates controller. Only that controller's
// MyGo check/install/lease/relaunch/opener seams are synthetic, exactly as
// the update lifecycle unit tests inject them; no product code is replaced.
//
//	go test -tags desktop_whitebox -run '^TestNativeUpdateSettings' -count=1 -timeout=120s ./...
//	(LINKSENSE_DESKTOP_WEB_DIST must select a built shared Web UI)

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

const (
	updateUIInstallerURL = "https://downloads.example.test/linksense-installer"
	updateUIFeed         = "https://updates.example.test/update-darwin-arm64.json"
	updateUIBetaFeed     = "https://updates.example.test/beta/update-darwin-arm64.json"
	updateUINotes        = "Release notes <b>literal</b> <img src=\"https://updates.example.test/tracker.png\"> https://updates.example.test/notes\nSecond line"

	// The settings page has several selects; the update channel one is
	// identified by its own label, not by being the first combobox.
	updateUIChannelTrigger = `Array.from(document.querySelectorAll('[role="combobox"]')).find(trigger => {
		const label = trigger.getAttribute("aria-labelledby");
		return label !== null && document.getElementById(label)?.textContent.trim() === "Update channel";
	})`
)

type updateUIProgress struct {
	Downloaded int64
	Total      int64
}

type updateUISeam struct {
	mu             sync.Mutex
	busyFirst      atomic.Bool
	acquireCalls   atomic.Int32
	installCalls   atomic.Int32
	progress       []updateUIProgress
	opened         string
	installStarted chan struct{}
	advance        chan struct{}
}

// newUpdateUI creates the real controller with the same synthetic MyGo
// boundaries the lifecycle tests use, but tied to the WebView's Desktop so
// its snapshots are emitted to the page.
func newUpdateUI(t *testing.T, desktop *Desktop, installEnabled bool, installerURL string) (*desktopUpdates, *updateHarness, *updateUISeam) {
	t.Helper()
	isolateUpdateGlobals(t)
	desktopUpdateFeed = updateUIFeed
	desktopUpdateBetaFeed = updateUIBetaFeed
	desktopUpdateInstallerURL = installerURL
	// The controller only creates its sources with a valid manifest public
	// key; the synthetic applySource never verifies a manifest, but start()
	// requires the key to parse.
	desktopUpdateManifestKey = base64.StdEncoding.EncodeToString(newUpdateTestKey(t))
	h := &updateHarness{prefs: map[string]any{}}
	seam := &updateUISeam{installStarted: make(chan struct{}, 1), advance: make(chan struct{})}
	u := newDesktopUpdates(desktop)
	u.enabled = func() bool { return installEnabled }
	var checks atomic.Int32
	u.check = func(context.Context) (*mygo.Update, error) {
		// The first call is the launch background check; the explicit click
		// is the one that must offer the candidate.
		if checks.Add(1) == 1 {
			return nil, nil
		}
		return &mygo.Update{Version: "0.2.0", Notes: updateUINotes}, nil
	}
	u.install = func(ctx context.Context, _ *mygo.Update, progress func(int64, int64)) error {
		seam.installCalls.Add(1)
		select {
		case seam.installStarted <- struct{}{}:
		default:
		}
		for _, step := range []updateUIProgress{{512, 2048}, {128, 4096}, {2048, 4096}} {
			progress(step.Downloaded, step.Total)
			seam.mu.Lock()
			seam.progress = append(seam.progress, step)
			seam.mu.Unlock()
			select {
			case <-seam.advance:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		return nil
	}
	u.acquire = func(context.Context) (updateLease, error) {
		if seam.acquireCalls.Add(1) == 1 && seam.busyFirst.Load() {
			return nil, errUpdateAdmissionBusy
		}
		return &fakeUpdateLease{}, nil
	}
	u.relaunch = func() { h.relaunch.Add(1) }
	u.quit = func() { h.quit.Add(1) }
	u.openInstaller = func(raw string) error {
		seam.mu.Lock()
		seam.opened = raw
		seam.mu.Unlock()
		return nil
	}
	u.getPreference = h.getPreference
	u.setPreference = h.setPreference
	u.applySource = h.applySource
	u.setPreferences(true)
	desktop.updates = u
	u.start()
	t.Cleanup(func() {
		u.shutdown()
		if desktop.updates == u {
			desktop.updates = nil
		}
	})
	return u, h, seam
}

func updateUIOpenSettings(t *testing.T, d *Desktop) *mygo.Page {
	t.Helper()
	nativeWhiteboxSession(t, true)
	d.openMainWindow()
	win := d.mainWindow()
	if win == nil {
		t.Fatal("the main window did not open")
	}
	t.Cleanup(win.Destroy)
	page := win.Page()
	whiteboxWait(t, page, `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli")`)
	if err := page.LoadURL("/settings/general"); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `location.pathname === "/settings/general" && document.querySelector("#desktop-update-heading") !== null`)
	return page
}

func updateUIButton(t *testing.T, page *mygo.Page, label string) {
	t.Helper()
	// A previous update action clears its pending flag one render after the
	// snapshot it caused, so wait for the button itself to become actionable.
	whiteboxWait(t, page, fmt.Sprintf(`(() => {
		const button = Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === %q);
		return !!button && !button.disabled && button.getAttribute("aria-disabled") !== "true";
	})()`, label))
	value, err := page.Eval(fmt.Sprintf(`(() => {
		const button = Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === %q);
		if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return false;
		button.click();
		return true;
	})()`, label))
	if err != nil {
		t.Fatalf("clicking %q: %v", label, err)
	}
	if value != true {
		t.Fatalf("the update control does not offer an enabled %q button", label)
	}
}

func updateUIWaitButton(t *testing.T, page *mygo.Page, label string) {
	t.Helper()
	whiteboxWait(t, page, fmt.Sprintf(
		`Array.from(document.querySelectorAll("button")).some(button => button.textContent.trim() === %q)`, label))
}

func updateUISelectChannel(t *testing.T, page *mygo.Page, label string) {
	t.Helper()
	value, err := page.Eval(fmt.Sprintf(`(() => {
		const trigger = %s;
		if (!trigger) return false;
		trigger.click();
		return true;
	})()`, updateUIChannelTrigger))
	if err != nil || value != true {
		t.Fatalf("opening the update channel select: %v", err)
	}
	whiteboxWait(t, page, fmt.Sprintf(
		`Array.from(document.querySelectorAll('[role="option"]')).some(option => option.textContent.trim() === %q)`, label))
	value, err = page.Eval(fmt.Sprintf(`(() => {
		const option = Array.from(document.querySelectorAll('[role="option"]')).find(option => option.textContent.trim() === %q);
		if (!option) return false;
		option.click();
		return true;
	})()`, label))
	if err != nil || value != true {
		t.Fatalf("choosing update channel %q: %v", label, err)
	}
}

func updateUIWaitProgress(t *testing.T, page *mygo.Page, value, visible string) {
	t.Helper()
	whiteboxWait(t, page, fmt.Sprintf(
		`document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow") === %q && `+
			`document.querySelector('[data-slot="progress-value"]')?.textContent.trim() === %q`,
		value, visible))
}

func updateUIEvents(t *testing.T, page *mygo.Page) []DesktopUpdateResult {
	t.Helper()
	value, err := page.Eval(`JSON.stringify(window.__updateEvents || [])`)
	if err != nil {
		t.Fatalf("reading delivered update events: %v", err)
	}
	text, ok := value.(string)
	if !ok {
		t.Fatalf("unexpected native event probe value: %T", value)
	}
	var events []DesktopUpdateResult
	if err := json.Unmarshal([]byte(text), &events); err != nil {
		t.Fatalf("decoding delivered update events: %v", err)
	}
	return events
}

func TestNativeUpdateSettingsInstallsStagedCandidateThroughWKWebView(t *testing.T) {
	d := nativeWhitebox.desktop
	u, h, seam := newUpdateUI(t, d, true, "")
	page := updateUIOpenSettings(t, d)

	// The launch background check settles the real controller before the
	// explicit check, so the page renders the authoritative current state.
	whiteboxWait(t, page, `document.body.innerText.includes("The desktop app is up to date.")`)
	whiteboxWait(t, page, `typeof mygo.on === "function" && (() => {
		window.__updateEvents = [];
		window.__updateProbeOff = mygo.on("desktop:update-changed", value => window.__updateEvents.push(value));
		return true;
	})()`)

	// Channel switching goes through the real Select and binding, and the
	// native controller persists the choice and applies the beta source.
	whiteboxWait(t, page, fmt.Sprintf(`(%s)?.textContent.trim().startsWith("Stable")`, updateUIChannelTrigger))
	updateUISelectChannel(t, page, "Beta")
	whiteboxWait(t, page, fmt.Sprintf(`(%s)?.textContent.trim().startsWith("Beta")`, updateUIChannelTrigger))
	h.mu.Lock()
	storedChannel, hasChannel := h.prefs[updateChannelPreference]
	sourceCount := len(h.sources)
	var lastSource mygo.UpdateSource
	if sourceCount > 0 {
		lastSource = h.sources[sourceCount-1]
	}
	h.mu.Unlock()
	if !hasChannel || storedChannel != "beta" || sourceCount < 2 {
		t.Fatalf("native channel switch did not persist or apply: prefs=%v sources=%d", storedChannel, sourceCount)
	}
	if lastSource != mygo.UpdateSource(u.betaSource) {
		t.Fatal("native channel switch did not apply the beta source")
	}
	t.Logf("channel switch persisted %q and applied the beta source", storedChannel)

	// The explicit click is the only place the candidate appears.
	whiteboxWait(t, page, fmt.Sprintf(`(%s)?.textContent.trim().startsWith("Beta")`, updateUIChannelTrigger))
	updateUIButton(t, page, "Check for updates")
	whiteboxWait(t, page, `document.body.innerText.includes("Version 0.2.0 is available.")`)
	updateUIWaitButton(t, page, "Release notes")
	updateUIButton(t, page, "Release notes")
	whiteboxWait(t, page, `(() => {
		const notes = document.querySelector('[data-slot="desktop-update-release-notes"]');
		if (!notes) return false;
		const text = notes.innerText;
		return text.includes("<b>literal</b>") &&
			text.includes("<img src=\"https://updates.example.test/tracker.png\">") &&
			text.includes("https://updates.example.test/notes") &&
			notes.querySelector("b, a, img") === null;
	})()`)
	updateUIWaitButton(t, page, "Install update")

	// The first attempt is refused by the injected runner lease; the panel
	// must show the busy guidance, keep the same candidate, and not call the
	// installer or install until the user clicks again.
	seam.busyFirst.Store(true)
	updateUIButton(t, page, "Install update")
	whiteboxWait(t, page, `document.body.innerText.includes("A local task is running on this Mac. Finish or stop it before installing the update.")`)
	if seam.installCalls.Load() != 0 || seam.acquireCalls.Load() != 1 {
		t.Fatalf("a refused install reached the installer: installs=%d acquires=%d", seam.installCalls.Load(), seam.acquireCalls.Load())
	}
	updateUIWaitButton(t, page, "Install update")
	t.Logf("first install was refused by the injected busy lease and kept the candidate for retry")

	// Retry: the controller emits each real byte count as a new revision.
	updateUIButton(t, page, "Install update")
	select {
	case <-seam.installStarted:
	case <-time.After(10 * time.Second):
		t.Fatal("the retried install never reached the native installer")
	}
	updateUIWaitProgress(t, page, "25", "25%")
	advanceUpdateUI(t, seam)
	// A full-archive fallback resets the total; the UI must use the counts it
	// was given rather than an extrapolated percentage.
	updateUIWaitProgress(t, page, "3", "3%")
	advanceUpdateUI(t, seam)
	updateUIWaitProgress(t, page, "50", "50%")
	advanceUpdateUI(t, seam)
	t.Logf("rendered real byte counts: 512/2048 -> 128/4096 (reset) -> 2048/4096")
	whiteboxWait(t, page, `document.body.innerText.includes("The update is ready. Restart LinkSense to finish updating.")`)
	updateUIWaitButton(t, page, "Restart to update")
	whiteboxWait(t, page, `document.querySelector('[role="progressbar"]') === null`)

	// Every event the page received came over the real WKWebView event
	// channel; revisions strictly increase and the downloaded/total values
	// are exactly the synthetic installer counts, including the reset.
	whiteboxWait(t, page, `window.__updateEvents.some(event => event.state === "staged" && event.version === "0.2.0")`)
	events := updateUIEvents(t, page)
	if len(events) < 6 {
		t.Fatalf("too few native update events reached the page: %+v", events)
	}
	lastRevision := int64(-1)
	var delivered []updateUIProgress
	var staged *DesktopUpdateResult
	for i := range events {
		event := events[i]
		if event.Revision <= lastRevision {
			t.Fatalf("native revisions did not increase at %d: %+v", i, events)
		}
		lastRevision = event.Revision
		if event.State == UpdateDownloading && event.Downloaded != nil && event.Total != nil {
			delivered = append(delivered, updateUIProgress{*event.Downloaded, *event.Total})
		}
		if event.State == UpdateStaged {
			staged = &events[i]
		}
	}
	want := []updateUIProgress{{512, 2048}, {128, 4096}, {2048, 4096}}
	if fmt.Sprint(delivered) != fmt.Sprint(want) {
		t.Fatalf("the page received %v byte counts, want %v", delivered, want)
	}
	if staged == nil || staged.Version != "0.2.0" || staged.Channel != "beta" {
		t.Fatalf("the page received an unexpected staged snapshot: %+v", staged)
	}
	t.Logf("page received %d strictly increasing native revisions; downloading counts=%v; staged=%s channel=%s",
		len(events), delivered, staged.Version, staged.Channel)
	seam.mu.Lock()
	recorded := append([]updateUIProgress(nil), seam.progress...)
	seam.mu.Unlock()
	if fmt.Sprint(recorded) != fmt.Sprint(want) {
		t.Fatalf("the installer reported %v byte counts, want %v", recorded, want)
	}

	// Restart is an explicit user action, not an automatic relaunch.
	if h.relaunch.Load() != 0 {
		t.Fatal("the app relaunched before the user asked to restart")
	}
	updateUIButton(t, page, "Restart to update")
	deadline := time.Now().Add(5 * time.Second)
	for h.relaunch.Load() != 1 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if h.relaunch.Load() != 1 || h.quit.Load() != 0 {
		t.Fatalf("restart did not request exactly one relaunch: relaunch=%d quit=%d", h.relaunch.Load(), h.quit.Load())
	}
}

func advanceUpdateUI(t *testing.T, seam *updateUISeam) {
	t.Helper()
	select {
	case seam.advance <- struct{}{}:
	case <-time.After(5 * time.Second):
		t.Fatal("the native installer did not wait for the next progress step")
	}
}

func TestNativeUpdateSettingsOffersFixedInstallerWhenReadOnly(t *testing.T) {
	d := nativeWhitebox.desktop
	_, h, seam := newUpdateUI(t, d, false, updateUIInstallerURL)
	page := updateUIOpenSettings(t, d)

	// Read-only installation: no in-place candidate, no channel selector,
	// only the configured installer page.
	whiteboxWait(t, page, `document.body.innerText.includes("This installation cannot check for updates. Contact your administrator.")`)
	updateUIWaitButton(t, page, "Open installer page")
	if value, err := page.Eval(`Array.from(document.querySelectorAll("button")).some(button => button.textContent.trim() === "Install update")`); err != nil || value != false {
		t.Fatalf("a read-only install offered the in-place action: %v", err)
	}
	if value, err := page.Eval(fmt.Sprintf(`!(%s)`, updateUIChannelTrigger)); err != nil || value != true {
		t.Fatalf("a read-only install offered an update channel: %v", err)
	}

	seam.mu.Lock()
	opened := seam.opened
	seam.mu.Unlock()
	if opened != "" {
		t.Fatalf("the installer opened before the user clicked: %q", opened)
	}
	updateUIButton(t, page, "Open installer page")
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		seam.mu.Lock()
		opened = seam.opened
		seam.mu.Unlock()
		if opened != "" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if opened != updateUIInstallerURL {
		t.Fatalf("the installer opener received %q, want the fixed %q", opened, updateUIInstallerURL)
	}
	t.Logf("read-only settings offered no in-place install and no channel; opener received %q", opened)
	if h.relaunch.Load() != 0 || h.quit.Load() != 0 {
		t.Fatalf("a read-only install restarted the app: relaunch=%d quit=%d", h.relaunch.Load(), h.quit.Load())
	}
	if value, err := page.Eval(`Array.from(document.querySelectorAll("button")).some(button => button.textContent.trim() === "Install update")`); err != nil || value != false {
		t.Fatalf("the installer action exposed an in-place install: %v", err)
	}
}
