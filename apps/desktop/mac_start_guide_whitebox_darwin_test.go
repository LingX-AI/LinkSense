//go:build desktop_whitebox

package main

// Real-WKWebView regression for the Mac first-run start guide: one compact
// test runs the shared Web UI in the 720x540 main window against the synthetic
// device-journey API and checks the nonmodal card in the new-task welcome
// slot. Its three Settings hash destinations are clicked through their
// observable hrefs and must focus their real target; the guide must not pair
// this Mac or Browser Use, open the system browser, change the draft or
// default run location, create task work, or read/request OS permissions.
// Skip is checked on this account across one real document reload in a
// disposable WebKit store (never a process-restart or distribution claim).
//
// Fixture assumptions: the journey fixture keeps its normal rollout, so the
// baseline whitebox handler serves the bootstrap without a desktop policy and
// both run locations stay enabled for this unpaired Mac; the dismissal key
// mirrors desktopStartGuideKey's "linksense.desktopStartGuide:" +
// JSON.stringify([serverURL, userID]).

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/permissionflow"
)

const (
	macStartGuideTitle     = "Get started on this Mac"
	macStartGuideSkipLabel = "Skip"
	macStartGuideDraft     = "First-run guide keeps this draft"
	// Subpixel layout gives fractional edges around the intended card box.
	macStartGuideTolerance = 0.75
)

// macStartGuideRegion is the single locator for the nonmodal card: the region
// role whose visible heading names the guide. The Web candidate owns its
// accessibility ids, so nothing here reads them.
func macStartGuideRegion() string {
	return `Array.from(document.querySelectorAll('[role="region"]')).find((candidate) =>
		Array.from(candidate.querySelectorAll("h1, h2, h3, h4, h5, h6")).some((heading) =>
			(heading.textContent || "").trim() === ` + deviceJourneyJSString(macStartGuideTitle) + `))`
}

// macStartGuideSkip locates the visible Skip action inside the card.
func macStartGuideSkip() string {
	return `Array.from((` + macStartGuideRegion() + `)?.querySelectorAll("button") ?? [])
		.find((candidate) => (candidate.textContent || "").trim() === ` + deviceJourneyJSString(macStartGuideSkipLabel) + `)`
}

// macStartGuideReady waits for the settled guide. The pair step is offered
// only after the native device read proves this Mac unpaired, so three ordered
// anchor targets with visible text and an enabled Skip mean every step exists.
func macStartGuideReady() string {
	return `(() => {
		const region = ` + macStartGuideRegion() + `;
		if (!region) return false;
		const links = Array.from(region.querySelectorAll("a[href]"));
		const skip = ` + macStartGuideSkip() + `;
		return links.length === 3 && links.every((link) => (link.textContent || "").trim() !== "") &&
			skip !== undefined && skip.disabled !== true && skip.getAttribute("aria-disabled") !== "true";
	})()`
}

// macStartGuidePageReady is the ordinary first-use page for the synthetic
// account: a hydrated composer with a run-location target.
func macStartGuidePageReady() string {
	return `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli") &&
		document.querySelector('textarea[aria-label="Task composer"]') !== null &&
		(` + deviceJourneyTargetTriggerJS + `) !== undefined`
}

// macStartGuideRunLocation reads the composer's visible default run location.
func macStartGuideRunLocation(t *testing.T, page *mygo.Page) string {
	t.Helper()
	value, err := page.Eval(`(` + deviceJourneyTargetTriggerJS + `)?.textContent.trim() ?? ""`)
	if err != nil {
		t.Fatalf("read the composer run location: %v", err)
	}
	text, _ := value.(string)
	return text
}

func TestNativeMacFirstRunStartGuideWhitebox(t *testing.T) {
	nativeWhiteboxSession(t, true)
	desktop := nativeWhitebox.desktop
	credential := deviceFixtureCredential()

	// Start from the supported unpaired state with only the native refresh
	// session seeded: no stored device pairing and no real service credential.
	desktop.closeDevice()
	if err := nativeWhitebox.store.Delete(serverCredentialKey(desktop.server, "device")); err != nil {
		t.Fatal(err)
	}

	// The guide must not read TCC state or open a permission prompt. The
	// existing permission seam records any bridge call and never reaches the OS.
	var permissionRequests atomic.Int32
	deny := func() (permissionflow.Status, error) {
		permissionRequests.Add(1)
		return permissionflow.Denied, nil
	}
	stubComputerPermission(t, computerPermissionSystem{
		goos:     "darwin",
		guideApp: "/Applications/LinkSense.app",
		check:    func(permissionflow.Permission) (permissionflow.Status, error) { return deny() },
		guide: func(context.Context, permissionflow.Permission, permissionflow.GuideOptions) (permissionflow.Status, error) {
			return deny()
		},
		openSettings: func(permissionflow.Permission) error { permissionRequests.Add(1); return nil },
	})

	// The journey fixture supplies the authenticated synthetic account and the
	// configured model. Its normal rollout is kept: this is ordinary first use,
	// not the closed-cloud journey.
	fixture := newDeviceJourneyFixture()
	deviceJourneyWhitebox.Store(fixture)
	browser := &browserUseWhitebox{}
	nativeWhitebox.browser.Store(browser)

	var browserOpened atomic.Int32
	previousBrowser := desktop.openBrowser
	desktop.openBrowser = func(string) error {
		browserOpened.Add(1)
		return nil
	}
	t.Cleanup(func() {
		desktop.closeDevice()
		deviceJourneyWhitebox.Store(nil)
		fixture.close()
		nativeWhitebox.browser.Store(nil)
		desktop.openBrowser = previousBrowser
		_ = nativeWhitebox.store.Delete(serverCredentialKey(desktop.server, "device"))
	})

	// Default assumption: the journey fixture keeps its normal rollout, so the
	// baseline handler serves the bootstrap and both run locations stay enabled.
	// The viewport journey below exercises that same baseline branch.

	// One assertion reused at every step: no pairing (native or Browser Use),
	// no system-browser open, no OS permission seam call, and no task write.
	// The new-task page prewarms cloud reservations on its own, so bare
	// prewarms are expected at any time; only a prewarm naming a conversation
	// is a task-scoped write.
	assertNoSideEffects := func(stage string) {
		t.Helper()
		pairings, pairs, creates, _, hellos := fixture.counts()
		_, _, turns := fixture.taskWrites()
		// Count task-scoped prewarms under one fixture.mu hold so a reservation
		// appended by the page between separate reads cannot skew the result.
		fixture.mu.Lock()
		taskPrewarms := 0
		for _, body := range fixture.prewarms {
			if _, ok := body["conversation_id"]; ok {
				taskPrewarms++
			}
		}
		fixture.mu.Unlock()
		if pairings+pairs+hellos+creates+turns != 0 || taskPrewarms != 0 ||
			browserOpened.Load() != 0 || browser.pairing.Load() != 0 || permissionRequests.Load() != 0 ||
			len(fixture.unexpectedWrites()) != 0 {
			t.Fatalf("%s: pairings=%d pairs=%d hellos=%d creates=%d turns=%d task-prewarms=%d browser=%d/%d permissions=%d unexpected=%v",
				stage, pairings, pairs, hellos, creates, turns, taskPrewarms,
				browserOpened.Load(), browser.pairing.Load(), permissionRequests.Load(), fixture.unexpectedWrites())
		}
	}

	// A disposable WebKit data store keeps this account's localStorage and
	// drafts out of every other native whitebox test in this process.
	desktop.openMainWindowInSession(mygo.NewEphemeralSession())
	win := desktop.mainWindow()
	t.Cleanup(win.Destroy)
	// The main window shares MyGo's "desktop-main" StateKey: MyGo saves its
	// bounds when it closes, in this process's window-state.json. Keep the
	// geometry this test entered with so the 720x540 viewport below cannot
	// outlive it and shrink the next native test's main window. Registered
	// after win.Destroy, so the restore runs before MyGo captures and saves the
	// closing state, whether an assertion failed or not.
	entryBounds := win.Bounds()
	t.Cleanup(func() {
		if !win.IsDestroyed() {
			win.SetBounds(entryBounds)
		}
	})
	win.SetSize(720, 540)
	page := win.Page()
	if got := page.ZoomFactor(); got != 1 {
		t.Fatalf("the Mac main window did not keep its fixed 100%% page zoom: %v", got)
	}
	whiteboxWait(t, page, macStartGuidePageReady()+` && `+macStartGuideReady())
	if width, height := win.Size(); width != 720 || height != 540 {
		t.Fatalf("the main window is %dx%d, want the supported 720x540 minimum", width, height)
	}

	// The guide is one nonmodal region with the three ordered destinations; the
	// Web candidate owns link labels, so the hrefs are the stable observable.
	wantHrefs := []string{
		"/settings/general#desktop-devices-heading",
		"/settings/general#browser-extension",
		"/settings/general#desktop-default-target",
	}
	links, err := mygo.EvalAs[[]string](page, `Array.from((`+macStartGuideRegion()+
		`)?.querySelectorAll("a[href]") ?? []).map((link) => link.getAttribute("href"))`)
	if err != nil || !slices.Equal(links, wantHrefs) {
		t.Fatalf("the start guide links = %v (%v), want %v", links, err, wantHrefs)
	}
	layout, err := mygo.EvalAs[[5]float64](page, `(() => {
		const region = `+macStartGuideRegion()+`;
		const rect = region.getBoundingClientRect();
		return [rect.left, rect.right, window.innerWidth, window.innerHeight,
			Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))
				.filter((dialog) => dialog.getClientRects().length > 0).length];
	})()`)
	if err != nil {
		t.Fatalf("measure the Mac start guide: %v", err)
	}
	if layout[2] <= 0 || layout[2] > 720 || layout[3] > 540 || layout[1]-layout[0] <= 0 ||
		layout[0] < -macStartGuideTolerance || layout[1] > layout[2]+macStartGuideTolerance || layout[4] != 0 {
		t.Fatalf("the start guide card %.2f..%.2f and %.0f dialogs do not fit the nonmodal %.0fx%.0f viewport",
			layout[0], layout[1], layout[4], layout[2], layout[3])
	}
	baselineRunLocation := macStartGuideRunLocation(t, page)
	if baselineRunLocation == "" {
		t.Fatal("the new task composer has no run location to preserve")
	}
	if draft := deviceJourneyPrompt(t, page); draft != "" {
		t.Fatalf("the new task composer started with a draft: %q", draft)
	}
	assertNoSideEffects("the settled guide")

	// Each link reaches its existing Settings hash route through the real DOM
	// click, focuses the actual destination, and the WebView's own Back returns
	// to the new task, where the guide is offered again.
	for _, href := range wantHrefs {
		path, id, _ := strings.Cut(href, "#")
		if _, err := page.Eval(`Array.from((` + macStartGuideRegion() + `)?.querySelectorAll("a[href]") ?? [])
			.find((link) => link.getAttribute("href") === ` + deviceJourneyJSString(href) + `).click()`); err != nil {
			t.Fatalf("click the %q guide target: %v", href, err)
		}
		whiteboxWait(t, page, fmt.Sprintf(
			`location.pathname === %q && location.hash === %q && document.activeElement === document.getElementById(%q)`,
			path, "#"+id, id))
		assertNoSideEffects("visiting " + href)
		if !page.CanGoBack() {
			t.Fatalf("the %q guide target left no history entry to navigate back", href)
		}
		page.GoBack()
		whiteboxWait(t, page, macStartGuidePageReady()+` && `+macStartGuideReady())
	}
	if draft := deviceJourneyPrompt(t, page); draft != "" {
		t.Fatalf("visiting the guide targets changed the new task draft to %q", draft)
	}
	if got := macStartGuideRunLocation(t, page); got != baselineRunLocation {
		t.Fatalf("visiting the guide targets changed the default run location from %q to %q", baselineRunLocation, got)
	}

	// Skip is the only dismissal: it hides the guide on this account, keeps the
	// typed draft and the default run location, and writes the one scoped key.
	// The fresh store cannot already hold it: the rendered guide proves the
	// account had no dismissal.
	guideKey := fmt.Sprintf(`linksense.desktopStartGuide:["%s","%s"]`, nativeWhitebox.server.URL, credential.OwnerID)
	deviceJourneySetPrompt(t, page, macStartGuideDraft)
	whiteboxWait(t, page, `document.querySelector('button[aria-label="Send"]')?.disabled === false`)
	if _, err := page.Eval(`(` + macStartGuideSkip() + `).click()`); err != nil {
		t.Fatalf("dismiss the start guide: %v", err)
	}
	whiteboxWait(t, page, `(`+macStartGuideRegion()+`) === undefined`)
	if draft := deviceJourneyPrompt(t, page); draft != macStartGuideDraft {
		t.Fatalf("Skip changed the composer draft to %q", draft)
	}
	if got := macStartGuideRunLocation(t, page); got != baselineRunLocation {
		t.Fatalf("Skip changed the default run location from %q to %q", baselineRunLocation, got)
	}
	if value, err := page.Eval(`localStorage.getItem(` + deviceJourneyJSString(guideKey) + `)`); err != nil || value != "dismissed" {
		t.Fatalf("Skip did not persist the scoped dismissal at %q: %v (%v)", guideKey, value, err)
	}
	assertNoSideEffects("Skip")

	// A real document reload in this same disposable store restores the native
	// session, keeps the guide dismissed for this account, and leaves the
	// composer working with the same default run location. Readiness is the
	// synthetic account on the expected route with a hydrated composer; the
	// scoped storage value proves the dismissal itself persisted.
	refreshes := nativeWhitebox.refresh.Load()
	whiteboxReload(t, page)
	whiteboxWait(t, page, macStartGuidePageReady()+` &&
		localStorage.getItem(`+deviceJourneyJSString(guideKey)+`) === "dismissed" &&
		(`+macStartGuideRegion()+`) === undefined`)
	if nativeWhitebox.refresh.Load() <= refreshes {
		t.Fatal("the reload did not restore the native refresh session")
	}
	deviceJourneySetPrompt(t, page, macStartGuideDraft+" after reload")
	whiteboxWait(t, page, `document.querySelector('button[aria-label="Send"]')?.disabled === false &&
		(`+macStartGuideRegion()+`) === undefined`)
	if got := macStartGuideRunLocation(t, page); got != baselineRunLocation {
		t.Fatalf("the reload changed the default run location from %q to %q", baselineRunLocation, got)
	}
	assertNoSideEffects("the reload")
}
