//go:build desktop_whitebox

package main

// Real-WKWebView regression for the composer toolbar clipping report. When a
// preview pane narrows the conversation workspace, the composer toolbar wraps
// to a second line. The composer's border must grow with that wrapped row:
// every control has to stay inside the composer's padding box and the visible
// window. The Mac cloud preview is the supported way to reach this width
// without changing the window below its native minimum.

import (
	"fmt"
	"testing"

	"github.com/egoist/mygo"
)

// Subpixel layout gives fractional edges around the intended content box.
const composerLayoutTolerance = 0.75

const composerLayoutMetricsJS = `(() => {
	const bounds = (label, element) => {
		if (!element) throw new Error(label + " is missing");
		const rect = element.getBoundingClientRect();
		return {
			left: rect.left,
			top: rect.top,
			right: rect.right,
			bottom: rect.bottom,
		};
	};
	const centerHit = (element) => {
		const rect = element.getBoundingClientRect();
		const target = document.elementFromPoint(
			rect.left + rect.width / 2,
			rect.top + rect.height / 2,
		);
		return target === element || element.contains(target);
	};
	const control = (label) => {
		const element = document.querySelector('button[aria-label="' + label + '"]');
		if (!element) throw new Error("the " + label + " control is missing");
		return element;
	};
	const shell = document.querySelector(".composer-shell");
	if (!shell) throw new Error("the composer shell is missing");
	const style = getComputedStyle(shell);
	const model = control("Choose model and reasoning effort");
	const voice = control("Voice input");
	const send = control("Send");
	return {
		viewport: [window.innerWidth, window.innerHeight],
		shell: bounds("the composer shell", shell),
		workspace: bounds("the conversation workspace", document.querySelector(".conversation-workspace")),
		toolbar: bounds("the composer toolbar", document.querySelector('[data-slot="composer-toolbar"]')),
		actions: bounds("the composer primary actions", document.querySelector('[data-testid="composer-primary-actions"]')),
		model: bounds("the model control", model),
		voice: bounds("the voice control", voice),
		send: bounds("the send control", send),
		paddingBottom: parseFloat(style.paddingBottom),
		borderBottom: parseFloat(style.borderBottomWidth),
		hits: {
			model: { enabled: !model.disabled, hit: centerHit(model) },
			voice: { enabled: !voice.disabled, hit: centerHit(voice) },
			send: { enabled: !send.disabled, hit: centerHit(send) },
		},
	};
})()`

type composerLayoutBounds struct {
	Left   float64 `json:"left"`
	Top    float64 `json:"top"`
	Right  float64 `json:"right"`
	Bottom float64 `json:"bottom"`
}

func (bounds composerLayoutBounds) width() float64  { return bounds.Right - bounds.Left }
func (bounds composerLayoutBounds) height() float64 { return bounds.Bottom - bounds.Top }

func (bounds composerLayoutBounds) within(outer composerLayoutBounds, tolerance float64) bool {
	return bounds.Left >= outer.Left-tolerance &&
		bounds.Top >= outer.Top-tolerance &&
		bounds.Right <= outer.Right+tolerance &&
		bounds.Bottom <= outer.Bottom+tolerance
}

func (bounds composerLayoutBounds) insideViewport(viewport [2]float64, tolerance float64) bool {
	return bounds.Left >= -tolerance &&
		bounds.Top >= -tolerance &&
		bounds.Right <= viewport[0]+tolerance &&
		bounds.Bottom <= viewport[1]+tolerance
}

func (bounds composerLayoutBounds) String() string {
	return fmt.Sprintf("(%.2f,%.2f)-(%.2f,%.2f)", bounds.Left, bounds.Top, bounds.Right, bounds.Bottom)
}

type composerLayoutHit struct {
	Enabled bool `json:"enabled"`
	Hit     bool `json:"hit"`
}

func (hit composerLayoutHit) String() string {
	return fmt.Sprintf("enabled=%t,hit=%t", hit.Enabled, hit.Hit)
}

type composerLayoutMetrics struct {
	Viewport      [2]float64                   `json:"viewport"`
	Shell         composerLayoutBounds         `json:"shell"`
	Workspace     composerLayoutBounds         `json:"workspace"`
	Toolbar       composerLayoutBounds         `json:"toolbar"`
	Actions       composerLayoutBounds         `json:"actions"`
	Model         composerLayoutBounds         `json:"model"`
	Voice         composerLayoutBounds         `json:"voice"`
	Send          composerLayoutBounds         `json:"send"`
	PaddingBottom float64                      `json:"paddingBottom"`
	BorderBottom  float64                      `json:"borderBottom"`
	Hits          map[string]composerLayoutHit `json:"hits"`
}

func readComposerLayoutMetrics(t *testing.T, page *mygo.Page) composerLayoutMetrics {
	t.Helper()
	metrics, err := mygo.EvalAs[composerLayoutMetrics](page, composerLayoutMetricsJS)
	if err != nil {
		t.Fatalf("read composer layout metrics: %v", err)
	}
	return metrics
}

func (metrics composerLayoutMetrics) describe() string {
	return fmt.Sprintf(
		"viewport=%v workspace=%v shell=%v padding-bottom=%.2f border-bottom=%.2f "+
			"toolbar=%v actions=%v model=%v voice=%v send=%v hits=%v",
		metrics.Viewport,
		metrics.Workspace,
		metrics.Shell,
		metrics.PaddingBottom,
		metrics.BorderBottom,
		metrics.Toolbar,
		metrics.Actions,
		metrics.Model,
		metrics.Voice,
		metrics.Send,
		metrics.Hits,
	)
}

func (metrics composerLayoutMetrics) boxes() map[string]composerLayoutBounds {
	return map[string]composerLayoutBounds{
		"toolbar":       metrics.Toolbar,
		"actions":       metrics.Actions,
		"model control": metrics.Model,
		"voice control": metrics.Voice,
		"send control":  metrics.Send,
	}
}

// assertComposerContainment proves that the composer's existing bottom padding
// and border are still below the toolbar and controls, and that every box is
// inside the composer border and the visible window on all four sides.
func assertComposerContainment(t *testing.T, state string, metrics composerLayoutMetrics) {
	t.Helper()
	contentBottom := metrics.Shell.Bottom - metrics.PaddingBottom - metrics.BorderBottom
	for name, bounds := range metrics.boxes() {
		if bounds.Bottom > contentBottom+composerLayoutTolerance {
			t.Fatalf("%s: the %s ends %.2fpx below the composer content box "+
				"(bottom %.2f, content bottom %.2f, bottom padding %.2f, border %.2f): %s",
				state, name, bounds.Bottom-contentBottom, bounds.Bottom, contentBottom,
				metrics.PaddingBottom, metrics.BorderBottom, metrics.describe())
		}
		if !bounds.within(metrics.Shell, composerLayoutTolerance) {
			t.Fatalf("%s: the %s is outside the composer border on at least one side: %s",
				state, name, metrics.describe())
		}
		if !bounds.insideViewport(metrics.Viewport, composerLayoutTolerance) {
			t.Fatalf("%s: the %s is outside the visible window: %s", state, name, metrics.describe())
		}
	}
}

func assertComposerHits(t *testing.T, state string, metrics composerLayoutMetrics) {
	t.Helper()
	// Disabled controls deliberately use pointer-events: none in the shared UI,
	// so their center belongs to the parent. Bounds and visibility are still
	// checked for every control by assertComposerContainment.
	for name, hit := range metrics.Hits {
		if hit.Enabled && !hit.Hit {
			t.Fatalf("%s: the center of the enabled %s control misses it: %s", state, name, metrics.describe())
		}
	}
}

func clickComposerBrowserPreview(t *testing.T, page *mygo.Page) {
	t.Helper()
	whiteboxWait(t, page, `Array.from(document.querySelectorAll("header button")).some((candidate) =>
		(candidate.getAttribute("aria-label") || "").includes("task browser"))`)
	if _, err := page.Eval(`(() => {
		const button = Array.from(document.querySelectorAll("header button")).find((candidate) =>
			(candidate.getAttribute("aria-label") || "").includes("task browser"));
		if (!button) throw new Error("browser preview toggle missing");
		button.click();
		return true;
	})()`); err != nil {
		t.Fatalf("toggle browser preview: %v", err)
	}
}

func TestNativeComposerToolbarStaysInsideTheComposerWhenPreviewNarrowsWorkspace(t *testing.T) {
	nativeWhiteboxSession(t, true)
	desktop := nativeWhitebox.desktop
	desktop.closeDevice()
	fixture := newDeviceJourneyFixture()
	deviceJourneyWhitebox.Store(fixture)
	t.Cleanup(func() {
		desktop.closeDevice()
		deviceJourneyWhitebox.Store(nil)
		fixture.close()
	})

	desktop.openMainWindowInSession(mygo.NewEphemeralSession())
	win := desktop.mainWindow()
	defer win.Destroy()
	win.SetSize(1200, 800)
	page := win.Page()
	whiteboxWait(t, page, `location.pathname === "/conversations/new" &&
		document.querySelector(".composer-shell") !== null &&
		document.querySelector('button[aria-label="Choose model and reasoning effort"]') !== null`)
	deviceJourneyForeground(t, page)

	// The report shows an idle existing conversation, where the run-location
	// picker is absent and the project picker is visible. Create a fixture
	// conversation, then reload it so the optimistic message is gone.
	deviceJourneySetPrompt(t, page, "Composer layout regression")
	deviceJourneySubmit(t, page)
	whiteboxWait(t, page, `location.pathname.startsWith("/conversations/") && location.pathname !== "/conversations/new"`)
	rawPath, err := page.Eval(`location.pathname`)
	if err != nil {
		t.Fatal(err)
	}
	path, _ := rawPath.(string)
	if err := page.LoadURL(path); err != nil {
		t.Fatal(err)
	}
	// The configured model trigger only renders after the model preference
	// request settles, so it doubles as the conversation readiness signal.
	whiteboxWait(t, page, `document.querySelector(".composer-shell") !== null &&
		document.querySelector('button[aria-label="Choose model and reasoning effort"]') !== null &&
		document.querySelector(".conversation-project-dock") !== null`)

	// The Mac cloud preview pane takes 480px from the 928px workspace. The
	// viewport stays above the 1100px overlay threshold, so the workspace
	// narrows via the animated flex-basis and the toolbar wraps.
	clickComposerBrowserPreview(t, page)
	whiteboxWait(t, page, `(() => {
		const workspace = document.querySelector(".conversation-workspace");
		return document.querySelector(".office-preview-pane") !== null &&
			workspace !== null &&
			workspace.getBoundingClientRect().width < 500 &&
			document.querySelector('[data-slot="composer-toolbar"]').getBoundingClientRect().height > 40;
	})()`)
	// Wait for the pane's 360ms flex-basis and transform motion to finish
	// instead of sleeping, so the measured state is the real settled layout.
	whiteboxWait(t, page, `(() => {
		const workspace = document.querySelector(".conversation-workspace");
		if (!workspace) return false;
		const layout = workspace.parentElement;
		return [workspace, layout].every((element) =>
			element !== null &&
			Array.from(element.getAnimations()).every((animation) => animation.playState === "finished"));
	})()`)

	narrow := readComposerLayoutMetrics(t, page)
	if narrow.Workspace.width() >= 500 {
		t.Fatalf("the preview pane did not narrow the workspace: %s", narrow.describe())
	}
	if narrow.Toolbar.height() <= 40 {
		t.Fatalf("the toolbar did not wrap into the reported narrow layout: %s", narrow.describe())
	}
	assertComposerContainment(t, "narrow", narrow)
	assertComposerHits(t, "narrow", narrow)

	// Script focus exercises the same DOM focus path as Tab without injecting
	// native key events. The :focus-visible ring itself is a browser modality
	// heuristic, so it is not asserted here; the enabled model trigger must be
	// able to take keyboard focus while the narrow layout is active.
	focused, err := page.Eval(`(() => {
		const button = document.querySelector('button[aria-label="Choose model and reasoning effort"]');
		if (!button || button.disabled) return false;
		button.focus({ preventScroll: true });
		return document.activeElement === button;
	})()`)
	if err != nil || focused != true {
		t.Fatalf("the enabled model selector did not take keyboard focus: focused=%v err=%v\n%s",
			focused, err, narrow.describe())
	}

	// A non-empty draft enables the real Send button. Typing reflows the
	// composer, so it happens only after the initial narrow measurements above.
	deviceJourneySetPrompt(t, page, "Layout draft")
	whiteboxWait(t, page, `(() => {
		const send = document.querySelector('button[aria-label="Send"]');
		return send !== null && send.disabled === false &&
			send.getAttribute("aria-disabled") === "false" &&
			document.querySelector(".office-preview-pane") !== null;
	})()`)
	drafted := readComposerLayoutMetrics(t, page)
	if drafted.Workspace.width() >= 500 {
		t.Fatalf("the draft relayout lost the narrow workspace: %s", drafted.describe())
	}
	assertComposerContainment(t, "narrow draft", drafted)
	assertComposerHits(t, "narrow draft", drafted)
	if send, ok := drafted.Hits["send"]; !ok || !send.Enabled || !send.Hit {
		t.Fatalf("the enabled send control does not take its own center hit: %s", drafted.describe())
	}

	// Closing the preview must restore the original wide single-row toolbar.
	clickComposerBrowserPreview(t, page)
	whiteboxWait(t, page, `(() => {
		const workspace = document.querySelector(".conversation-workspace");
		if (document.querySelector(".office-preview-pane") !== null || !workspace) return false;
		if (workspace.getBoundingClientRect().width <= 900) return false;
		if (document.querySelector('[data-slot="composer-toolbar"]').getBoundingClientRect().height >= 40) return false;
		const layout = workspace.parentElement;
		return [workspace, layout].every((element) =>
			element !== null &&
			Array.from(element.getAnimations()).every((animation) => animation.playState === "finished"));
	})()`)
	wide := readComposerLayoutMetrics(t, page)
	if wide.Workspace.width() <= 900 {
		t.Fatalf("the workspace did not return to its wide layout: %s", wide.describe())
	}
	if wide.Toolbar.height() >= 40 {
		t.Fatalf("the toolbar did not return to one row after the preview closed: %s", wide.describe())
	}
	assertComposerContainment(t, "restored wide", wide)
}
