//go:build desktop_whitebox

package main

import (
	"fmt"
	"math"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

type titleBarAction struct {
	Label  string  `json:"label"`
	Left   float64 `json:"left"`
	Top    float64 `json:"top"`
	Right  float64 `json:"right"`
	Bottom float64 `json:"bottom"`
}

type titleBarSurface struct {
	InsetLeft            float64          `json:"insetLeft"`
	InsetRight           float64          `json:"insetRight"`
	ControlsBottom       float64          `json:"controlsBottom"`
	TitleBarHeight       float64          `json:"titleBarHeight"`
	ViewportWidth        float64          `json:"viewportWidth"`
	SidebarVisible       bool             `json:"sidebarVisible"`
	SidebarWidth         float64          `json:"sidebarWidth"`
	SettingsSidebarShown bool             `json:"settingsSidebarShown"`
	SettingsSidebarWidth float64          `json:"settingsSidebarWidth"`
	BrandBarRegion       string           `json:"brandBarRegion"`
	BrandLeft            float64          `json:"brandLeft"`
	BrandTop             float64          `json:"brandTop"`
	BrandRight           float64          `json:"brandRight"`
	BrandBottom          float64          `json:"brandBottom"`
	BrandLogoLeft        float64          `json:"brandLogoLeft"`
	BrandLogoTop         float64          `json:"brandLogoTop"`
	BrandLogoWidth       float64          `json:"brandLogoWidth"`
	BrandLogoHeight      float64          `json:"brandLogoHeight"`
	BrandLogoBottom      float64          `json:"brandLogoBottom"`
	BrandLogoComplete    bool             `json:"brandLogoComplete"`
	BrandLogoNaturalW    float64          `json:"brandLogoNaturalWidth"`
	BrandLogoNaturalH    float64          `json:"brandLogoNaturalHeight"`
	ActionButtonWidth    float64          `json:"actionButtonWidth"`
	ActionButtons        []titleBarAction `json:"actionButtons"`
	BarHeight            float64          `json:"barHeight"`
	BarLeft              float64          `json:"barLeft"`
	BarRight             float64          `json:"barRight"`
	ActionsLeft          float64          `json:"actionsLeft"`
	ActionsTop           float64          `json:"actionsTop"`
	ActionsBottom        float64          `json:"actionsBottom"`
	ActionsWidth         float64          `json:"actionsWidth"`
	TopBarRegion         string           `json:"topBarRegion"`
	TopBarPadding        float64          `json:"topBarPadding"`
	TriggerDisplay       string           `json:"triggerDisplay"`
	TriggerLeft          float64          `json:"triggerLeft"`
	TriggerTop           float64          `json:"triggerTop"`
	CollapseLeft         float64          `json:"collapseLeft"`
	CollapseTop          float64          `json:"collapseTop"`
	CollapseBottom       float64          `json:"collapseBottom"`
	HeaderPadding        float64          `json:"headerPadding"`
	HeaderRegion         string           `json:"headerRegion"`
	LogoLeft             float64          `json:"logoLeft"`
	LogoTop              float64          `json:"logoTop"`
	LogoWidth            float64          `json:"logoWidth"`
	LogoHeight           float64          `json:"logoHeight"`
	LogoBottom           float64          `json:"logoBottom"`
	AuthRegion           string           `json:"authRegion"`
	AuthChildRegion      string           `json:"authChildRegion"`
	AuthTopRowRegion     string           `json:"authTopRowRegion"`
	AuthButtonLeft       float64          `json:"authButtonLeft"`
	AuthButtonTop        float64          `json:"authButtonTop"`
	AuthButtonRight      float64          `json:"authButtonRight"`
	FailureRegion        string           `json:"failureRegion"`
	FailureChild         string           `json:"failureChildRegion"`
	MobileHeader         bool             `json:"mobileHeaderVisible"`
	MobileHeaderPad      float64          `json:"mobileHeaderPadding"`
	MobileHeaderLeft     float64          `json:"mobileHeaderLeft"`
}

// nativeTitleBarProbe reads the native control room MyGo reported and the
// geometry of the surfaces that consume it. It does not trigger a drag.
const nativeTitleBarProbe = `(() => {
	const root = getComputedStyle(document.documentElement)
	const px = name => parseFloat(root.getPropertyValue(name)) || 0
	const region = element => element ? getComputedStyle(element).getPropertyValue("--app-region").trim() : ""
	const box = element => element ? element.getBoundingClientRect() : null
	const visible = element => !!element && getComputedStyle(element).display !== "none" && element.getClientRects().length > 0
	const bar = Array.from(document.querySelectorAll(".sidebar-brand-bar, .settings-brand-bar")).find(visible) ?? document.querySelector(".sidebar-brand-bar")
	const brand = bar?.querySelector(".sidebar-brand-link")
	const brandLogo = brand?.querySelector("img")
	const actions = bar?.querySelector(".sidebar-header-actions")
	const actionButton = actions?.querySelector("button")
	const sidebar = document.querySelector("#app-sidebar")
	const settingsSidebar = document.querySelector(".settings-sidebar")
	const topBar = Array.from(document.querySelectorAll(".conversation-top-bar, [data-slot='page-top-bar']")).find(visible)
	const trigger = document.querySelector(".desktop-sidebar-trigger, .mobile-shell-trigger")
	const collapse = document.querySelector(".sidebar-collapse-control")
	const header = document.querySelector(".settings-navigation-header")
	const logo = header?.querySelector("img")
	const auth = document.querySelector("[data-slot='account-access-layout']")
	const authTopRow = document.querySelector(".account-access-top-row")
	const authButton = authTopRow?.querySelector("button")
	const failure = document.querySelector("[data-slot='public-failure-screen']")
	const mobileHeader = document.querySelector(".settings-mobile-header")
	const mobileHeaderLink = mobileHeader?.querySelector("a")
	const br = box(brand), bl = box(brandLogo), bb = box(bar), ar = box(actions), cr = box(collapse), lr = box(logo), tr = box(trigger), ab = box(authButton), mh = box(mobileHeaderLink), af = box(actionButton), sb = box(sidebar), ssb = box(settingsSidebar)
	const actionButtons = Array.from(bar?.querySelectorAll(".sidebar-header-actions button") ?? []).map(button => {
		const rect = box(button)
		return rect ? { label: button.getAttribute("aria-label") || button.textContent.trim(), left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null
	}).filter(Boolean)
	return {
		insetLeft: px("--mygo-titlebar-inset-left"),
		insetRight: px("--mygo-titlebar-inset-right"),
		controlsBottom: px("--mygo-titlebar-controls-bottom"),
		titleBarHeight: px("--mygo-titlebar-height"),
		viewportWidth: innerWidth,
		sidebarVisible: visible(sidebar),
		sidebarWidth: sb ? sb.width : -1,
		settingsSidebarShown: visible(settingsSidebar),
		settingsSidebarWidth: ssb ? ssb.width : -1,
		brandBarRegion: region(bar),
		brandLeft: br ? br.left : -1,
		brandTop: br ? br.top : -1,
		brandRight: br ? br.right : -1,
		brandBottom: br ? br.bottom : -1,
		brandLogoLeft: bl ? bl.left : -1,
		brandLogoTop: bl ? bl.top : -1,
		brandLogoWidth: bl ? bl.width : -1,
		brandLogoHeight: bl ? bl.height : -1,
		brandLogoBottom: bl ? bl.bottom : -1,
		brandLogoComplete: !!brandLogo && brandLogo.complete,
		brandLogoNaturalWidth: brandLogo ? brandLogo.naturalWidth : -1,
		brandLogoNaturalHeight: brandLogo ? brandLogo.naturalHeight : -1,
		actionButtonWidth: af ? af.width : -1,
		actionButtons,
		barHeight: bb ? bb.height : -1,
		barLeft: bb ? bb.left : -1,
		barRight: bb ? bb.right : -1,
		actionsLeft: ar ? ar.left : -1,
		actionsTop: ar ? ar.top : -1,
		actionsBottom: ar ? ar.bottom : -1,
		actionsWidth: ar ? ar.width : -1,
		topBarRegion: region(topBar),
		topBarPadding: topBar ? parseFloat(getComputedStyle(topBar).paddingLeft) : -1,
		triggerDisplay: trigger ? getComputedStyle(trigger).display : "absent",
		triggerLeft: tr ? tr.left : -1,
		triggerTop: tr ? tr.top : -1,
		collapseLeft: cr ? cr.left : -1,
		collapseTop: cr ? cr.top : -1,
		collapseBottom: cr ? cr.bottom : -1,
		headerPadding: header ? parseFloat(getComputedStyle(header).paddingLeft) : -1,
		headerRegion: region(header),
		logoLeft: lr ? lr.left : -1,
		logoTop: lr ? lr.top : -1,
		logoWidth: lr ? lr.width : -1,
		logoHeight: lr ? lr.height : -1,
		logoBottom: lr ? lr.bottom : -1,
		authRegion: region(auth),
		authChildRegion: auth ? region(auth.firstElementChild) : "",
		authTopRowRegion: region(authTopRow),
		authButtonLeft: ab ? ab.left : -1,
		authButtonTop: ab ? ab.top : -1,
		authButtonRight: ab ? ab.right : -1,
		failureRegion: region(failure),
		failureChildRegion: failure ? region(failure.firstElementChild) : "",
		mobileHeaderVisible: visible(mobileHeader),
		mobileHeaderPadding: mobileHeader ? parseFloat(getComputedStyle(mobileHeader).paddingLeft) : -1,
		mobileHeaderLeft: mh ? mh.left : -1
	}
})()`

func titleBarProbe(t *testing.T, page *mygo.Page) titleBarSurface {
	t.Helper()
	surface, err := mygo.EvalAs[titleBarSurface](page, nativeTitleBarProbe)
	if err != nil {
		t.Fatal(err)
	}
	return surface
}

func setDesktopMarker(t *testing.T, page *mygo.Page, marker string) {
	t.Helper()
	expression := `delete document.documentElement.dataset.desktopPlatform`
	if marker != "" {
		expression = `document.documentElement.dataset.desktopPlatform = "` + marker + `"`
	}
	if _, err := page.Eval(expression); err != nil {
		t.Fatal(err)
	}
}

// waitForNativeFullScreen waits for the windowDidEnterFullScreen or
// windowDidExitFullScreen notification MyGo forwards. It does not consult the
// style mask: macOS sets it while animating the Space transition and reverts
// it when the transition is aborted, so only the notification proves that the
// transition completed.
func waitForNativeFullScreen(t *testing.T, win *mygo.Window, done <-chan struct{}, wantFullScreen bool) {
	t.Helper()
	select {
	case <-done:
		return
	case <-time.After(20 * time.Second):
	}
	t.Fatalf("the native full-screen notification did not arrive (wanted full screen=%t; appActive=%t windowFocused=%t styleMaskFullScreen=%t); macOS may have aborted the transition, which needs an active, unlocked session", wantFullScreen, mygo.App.IsActive(), win.IsFocused(), win.IsFullScreen())
}

// The link carries the standard 2 px focus ring plus its 2 px offset, so its
// top must clear the native controls by at least this much. The logo itself
// keeps its compact clearance at normal zoom.
const (
	titleBarFocusClearance       = 4.0
	titleBarLogoClearance        = 6.0
	titleBarLogoMaxHeight        = 18.0
	titleBarLockupAspect         = 348.0 / 94.0
	titleBarSidebarWidth         = 200.0
	titleBarSettingsSidebarWidth = 272.0
	titleBarBrandInset           = 16.0
	titleBarBrandWidth           = 52.0
	titleBarBrandGap             = 16.0
	titleBarActionButtonWidth    = 28.0
	titleBarActionsWidth         = 99.0
	titleBarBaseBarHeight        = 66.0
	titleBarSidebarBarAllowance  = 37.0
	titleBarSettingsAllowance    = 33.0
)

const titleBarMinimumZoomEpsilon = 0.5

// The app shell animates its grid column for 160ms when the sidebar width
// changes, including the zoom-driven layout change that precedes the brand
// geometry. Wait for that animation to finish instead of a fixed delay.
const titleBarSettled = `(async () => {
	const shell = document.querySelector(".app-shell")
	const transition = Array.from(shell?.getAnimations() ?? []).filter(animation => animation.transitionProperty === "grid-template-columns")
	await Promise.all(transition.map(animation => animation.finished.catch(() => {})))
	return Array.from(shell?.getAnimations() ?? []).filter(animation => animation.transitionProperty === "grid-template-columns").every(animation => animation.playState === "finished")
})()`

// waitTitleBarSidebarSettled waits for the zoom update, the stored sidebar
// width and the app-shell grid animation on the same document. Geometry
// assertions run only after this helper returns.
func waitTitleBarSidebarSettled(t *testing.T, page *mygo.Page, selector, route string, wantWidth float64) {
	t.Helper()
	whiteboxWait(t, page, fmt.Sprintf(`location.pathname === %q`, route))
	whiteboxWait(t, page, fmt.Sprintf(`(() => {
		const sidebar = document.querySelector(%q)
		return !!sidebar && Math.abs(sidebar.getBoundingClientRect().width - %g) <= 1
	})()`, selector, wantWidth))
	whiteboxWait(t, page, titleBarSettled)
	width, err := mygo.EvalAs[float64](page, fmt.Sprintf(`(() => {
		const sidebar = document.querySelector(%q)
		return sidebar ? sidebar.getBoundingClientRect().width : -1
	})()`, selector))
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(width-wantWidth) > 1 {
		t.Fatalf("%s settled at %.3f px, not the expected %.0f px sidebar width", selector, width, wantWidth)
	}
}

func titleBarZoomReady(zoom, insetLeft float64) string {
	return fmt.Sprintf(`window.innerWidth > 767 && Math.abs(((parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mygo-titlebar-inset-left")) || 0) * %g) - %g) < 1.5`, zoom, insetLeft)
}

// assertTitleBarDesktopSidebarLayout checks the Mac desktop brand row at any
// reported native control room: the fixed normal-zoom row, the 4px focus-ring
// envelope, the 24px link, the compact logo and the three adjacent actions.
func assertTitleBarDesktopSidebarLayout(t *testing.T, label string, surface titleBarSurface) {
	t.Helper()
	if !surface.SidebarVisible || surface.SidebarWidth <= 1 {
		t.Fatalf("%s: the desktop sidebar is missing: %+v", label, surface)
	}
	if math.Abs(surface.SidebarWidth-titleBarSidebarWidth) > 1 {
		t.Fatalf("%s: the stored sidebar width changed: %+v", label, surface)
	}
	if surface.BrandRight-surface.BrandLeft <= 1 ||
		surface.BrandLogoWidth <= 1 || surface.BrandLogoHeight <= 1 ||
		surface.BarRight-surface.BarLeft <= 1 {
		t.Fatalf("%s: the sidebar logo, its focus link, or the brand bar collapsed: %+v", label, surface)
	}
	// A nonempty box is not proof of a loaded lockup: WebKit reports the
	// natural size only after the image resource decodes.
	if !surface.BrandLogoComplete || surface.BrandLogoNaturalW <= 0 || surface.BrandLogoNaturalH <= 0 {
		t.Fatalf("%s: the sidebar logo has no loaded intrinsic size: %+v", label, surface)
	}
	// The fixed row keeps the normal-zoom spacing. The sidebar's 1px border
	// can round to extra device pixels at extreme page zoom, so the flexed
	// brand link may lose a few pixels but must not collapse.
	brandWidth := surface.BrandRight - surface.BrandLeft
	if math.Abs(surface.BrandLeft-titleBarBrandInset) > 1 ||
		brandWidth < titleBarBrandWidth-8 || brandWidth > titleBarBrandWidth+1 ||
		math.Abs(surface.ActionsLeft-surface.BrandRight-titleBarBrandGap) > 1 {
		t.Fatalf("%s: the desktop brand row lost its normal-zoom horizontal spacing: %+v", label, surface)
	}
	if math.Abs(surface.ActionsWidth-titleBarActionsWidth) > 1 ||
		math.Abs(surface.ActionButtonWidth-titleBarActionButtonWidth) > 0.5 {
		t.Fatalf("%s: page zoom inflated the fixed action row: %+v", label, surface)
	}
	if len(surface.ActionButtons) != 3 {
		t.Fatalf("%s: expected the three existing sidebar actions: %+v", label, surface)
	}
	if math.Abs(surface.BrandTop-(surface.ControlsBottom+titleBarFocusClearance)) > 1 {
		t.Fatalf("%s: the desktop brand row is not under the native controls: %+v", label, surface)
	}
	wantBarHeight := math.Max(titleBarBaseBarHeight, surface.ControlsBottom+titleBarSidebarBarAllowance)
	if math.Abs(surface.BarHeight-wantBarHeight) > 1 {
		t.Fatalf("%s: the brand bar does not fit the focus envelope (want %.2f): %+v", label, wantBarHeight, surface)
	}
	if surface.BrandTop-titleBarFocusClearance < surface.ControlsBottom-titleBarMinimumZoomEpsilon ||
		surface.BrandBottom+titleBarFocusClearance > surface.BarHeight-1+titleBarMinimumZoomEpsilon {
		t.Fatalf("%s: the brand focus ring escaped the bar or the native controls: %+v", label, surface)
	}
	if surface.ActionsBottom+titleBarFocusClearance > surface.BarHeight-1+titleBarMinimumZoomEpsilon {
		t.Fatalf("%s: the action focus ring escaped the bar: %+v", label, surface)
	}
	if surface.BarRight > surface.SidebarWidth+titleBarMinimumZoomEpsilon ||
		surface.BarRight < surface.SidebarWidth-5 {
		t.Fatalf("%s: the brand bar does not span the stored sidebar width: %+v", label, surface)
	}
	if surface.BrandLogoTop < surface.ControlsBottom+titleBarLogoClearance-titleBarMinimumZoomEpsilon {
		t.Fatalf("%s: the logo is too close to the native controls: %+v", label, surface)
	}
	if surface.BrandLogoBottom > surface.BrandBottom+titleBarMinimumZoomEpsilon ||
		surface.BrandLogoHeight > titleBarLogoMaxHeight+titleBarMinimumZoomEpsilon {
		t.Fatalf("%s: the logo escaped its link or grew past the compact cap: %+v", label, surface)
	}
	if surface.BrandRight > surface.ActionsLeft+titleBarMinimumZoomEpsilon {
		t.Fatalf("%s: the brand overlaps its adjacent actions: %+v", label, surface)
	}
	for _, action := range surface.ActionButtons {
		if action.Label == "" || action.Right-action.Left <= 1 || action.Bottom-action.Top <= 1 {
			t.Fatalf("%s: action %q is missing or collapsed: %+v", label, action.Label, surface)
		}
		if action.Top < -titleBarMinimumZoomEpsilon || action.Bottom > surface.BarHeight+titleBarMinimumZoomEpsilon ||
			action.Right > surface.BarRight+titleBarMinimumZoomEpsilon {
			t.Fatalf("%s: action %q escaped the brand bar: %+v", label, action.Label, surface)
		}
		if action.Left < surface.BrandRight-titleBarMinimumZoomEpsilon {
			t.Fatalf("%s: action %q overlaps the brand: %+v", label, action.Label, surface)
		}
		// The action may sit level with the native controls only when its
		// focus ring is entirely to their right; otherwise both the button
		// and its 2px ring plus 2px offset need the same clearance as the link.
		xClear := action.Left-titleBarFocusClearance >= surface.InsetLeft-titleBarMinimumZoomEpsilon
		yClear := action.Top-titleBarFocusClearance >= surface.ControlsBottom-titleBarMinimumZoomEpsilon
		if !xClear && !yClear {
			t.Fatalf("%s: action %q and its focus ring overlap the native controls: %+v", label, action.Label, surface)
		}
		if action.Bottom+titleBarFocusClearance > surface.BarHeight-1+titleBarMinimumZoomEpsilon {
			t.Fatalf("%s: action %q focus ring escaped the brand bar: %+v", label, action.Label, surface)
		}
	}
	if math.Abs(surface.BrandLogoWidth/surface.BrandLogoHeight-titleBarLockupAspect) > 0.12 {
		t.Fatalf("%s: the sidebar lockup lost its aspect ratio: %+v", label, surface)
	}
}

// assertTitleBarSettingsLayout checks the settings lockup, which keeps the
// shared adaptive bar because it has no adjacent actions.
func assertTitleBarSettingsLayout(t *testing.T, label string, surface titleBarSurface) {
	t.Helper()
	if !surface.SettingsSidebarShown || surface.SettingsSidebarWidth <= 1 {
		t.Fatalf("%s: the settings sidebar is missing: %+v", label, surface)
	}
	if math.Abs(surface.SettingsSidebarWidth-titleBarSettingsSidebarWidth) > 1 {
		t.Fatalf("%s: the settings sidebar width changed: %+v", label, surface)
	}
	if surface.LogoWidth <= 1 || surface.LogoHeight <= 1 || surface.BarHeight <= 1 {
		t.Fatalf("%s: the settings logo or its brand bar collapsed: %+v", label, surface)
	}
	wantBarHeight := math.Max(titleBarBaseBarHeight, surface.ControlsBottom+titleBarSettingsAllowance)
	if math.Abs(surface.BarHeight-wantBarHeight) > 1 {
		t.Fatalf("%s: the settings bar lost its adaptive height (want %.2f): %+v", label, wantBarHeight, surface)
	}
	if math.Abs(surface.LogoTop-(surface.ControlsBottom+titleBarLogoClearance)) > 1 {
		t.Fatalf("%s: the settings logo is not under the native controls: %+v", label, surface)
	}
	if surface.LogoBottom > surface.BarHeight-1+titleBarMinimumZoomEpsilon ||
		surface.LogoHeight > titleBarLogoMaxHeight+titleBarMinimumZoomEpsilon {
		t.Fatalf("%s: the settings logo escaped the brand bar: %+v", label, surface)
	}
	if math.Abs(surface.LogoWidth/surface.LogoHeight-titleBarLockupAspect) > 0.12 {
		t.Fatalf("%s: the settings lockup lost its aspect ratio: %+v", label, surface)
	}
}

type titleBarFocusTarget struct {
	Label     string  `json:"label"`
	TabIndex  int     `json:"tabIndex"`
	Disabled  bool    `json:"disabled"`
	Inert     bool    `json:"inert"`
	Width     float64 `json:"width"`
	Height    float64 `json:"height"`
	CenterHit bool    `json:"centerHit"`
	Hit       string  `json:"hit"`
}

// nativeTitleBarFocusProbe reads only the sidebar brand link and its three
// sibling action buttons. It does not focus them, synthesize key input, or
// inspect pseudo-class paint.
const nativeTitleBarFocusProbe = `(() => {
	const bar = document.querySelector(".sidebar-brand-bar")
	const link = bar?.querySelector(".sidebar-brand-link")
	const buttons = Array.from(bar?.querySelectorAll(".sidebar-header-actions button") ?? [])
	return [link, ...buttons].filter(Boolean).map(element => {
		const rect = element.getBoundingClientRect()
		const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
		const label = element.getAttribute("aria-label") || element.textContent.trim() || element.getAttribute("href") || element.tagName.toLowerCase()
		return {
			label: label.slice(0, 40),
			tabIndex: element.tabIndex,
			disabled: !!element.disabled,
			inert: !!element.closest("[inert]"),
			width: rect.width,
			height: rect.height,
			centerHit: !!center && (center === element || element.contains(center)),
			hit: center ? center.tagName.toLowerCase() : "none"
		}
	})
})()`

// assertTitleBarFocusTargets checks DOM tab-order eligibility and the center
// hit-test only. It does not claim OS focus rendering or keyboard navigation.
func assertTitleBarFocusTargets(t *testing.T, label string, page *mygo.Page) {
	t.Helper()
	targets, err := mygo.EvalAs[[]titleBarFocusTarget](page, nativeTitleBarFocusProbe)
	if err != nil {
		t.Fatal(err)
	}
	if len(targets) != 4 {
		t.Fatalf("%s: expected the brand link and three sidebar actions, got %d: %+v", label, len(targets), targets)
	}
	for _, target := range targets {
		t.Logf("%s target %q: tabIndex=%d disabled=%t inert=%t centerHit=%t(%s) size=%.2fx%.2f",
			label, target.Label, target.TabIndex, target.Disabled, target.Inert,
			target.CenterHit, target.Hit, target.Width, target.Height)
		if target.TabIndex < 0 {
			t.Fatalf("%s: %q is not in the tab order (tabIndex=%d)", label, target.Label, target.TabIndex)
		}
		if target.Disabled {
			t.Fatalf("%s: %q is disabled", label, target.Label)
		}
		if target.Inert {
			t.Fatalf("%s: %q is inside an inert subtree", label, target.Label)
		}
		if target.Width <= 1 || target.Height <= 1 {
			t.Fatalf("%s: %q has no hit area", label, target.Label)
		}
		if !target.CenterHit {
			t.Fatalf("%s: %q center hit %s", label, target.Label, target.Hit)
		}
	}
}

// TestNativeImmersiveTitleBarKeepsBrandAtMinimumZoomInNarrowSidebar runs on
// its own and covers a persisted 200px sidebar at 100%, the 0.33/0.5/0.25
// extremes, the 0.67/0.8/0.9 threshold steps, and back at 100% on the same
// document. Every probe waits for the actual sidebar width and the settled
// grid before its geometry assertions run. It stops before the unlocked
// full-screen move.
func TestNativeImmersiveTitleBarKeepsBrandAtMinimumZoomInNarrowSidebar(t *testing.T) {
	nativeWhiteboxSession(t, true)
	desktop := nativeWhitebox.desktop
	desktop.openMainWindow()
	win := desktop.mainWindow()
	t.Cleanup(win.Destroy)
	page := win.Page()
	whiteboxWait(t, page, `location.pathname === "/conversations/new" && document.querySelector(".sidebar-brand-bar") !== null`)
	win.SetSize(1200, 800)
	whiteboxWait(t, page, `window.innerWidth > 767`)
	if _, err := page.Eval(`localStorage.setItem("linksense.sidebarWidth", "200")`); err != nil {
		t.Fatal(err)
	}
	whiteboxReload(t, page)
	waitTitleBarSidebarSettled(t, page, "#app-sidebar", "/conversations/new", titleBarSidebarWidth)
	whiteboxWait(t, page, `(() => {
		const logo = document.querySelector(".sidebar-brand-link img")
		return !!logo && logo.complete && logo.naturalWidth > 0 && logo.naturalHeight > 0
	})()`)
	baseline := titleBarProbe(t, page)
	t.Logf("baseline zoom 1.00 settled: sidebar=%.2f bar=%.2f controls=%.2f inset=%.2f brand=%.2f..%.2f top=%.2f logo=%.2fx%.2f natural=%.0fx%.0f actions=%.2f..%.2f top=%.2f width=%.2f button=%.2f",
		baseline.SidebarWidth, baseline.BarHeight, baseline.ControlsBottom, baseline.InsetLeft,
		baseline.BrandLeft, baseline.BrandRight, baseline.BrandTop,
		baseline.BrandLogoWidth, baseline.BrandLogoHeight, baseline.BrandLogoNaturalW, baseline.BrandLogoNaturalH,
		baseline.ActionsLeft, baseline.ActionsLeft+baseline.ActionsWidth, baseline.ActionsTop,
		baseline.ActionsWidth, baseline.ActionButtonWidth)
	if baseline.InsetLeft <= 0 || baseline.ControlsBottom <= 0 || baseline.ControlsBottom >= 30 {
		t.Fatalf("the baseline did not report normal native control room: %+v", baseline)
	}
	if math.Abs(baseline.BarHeight-titleBarBaseBarHeight) > 1 {
		t.Fatalf("the baseline brand bar changed height at 100%%: %+v", baseline)
	}
	assertTitleBarDesktopSidebarLayout(t, "baseline zoom 1", baseline)
	assertTitleBarFocusTargets(t, "baseline zoom 1", page)

	if _, err := page.Eval(`window.__titleBarZoomDocument = "sidebar"`); err != nil {
		t.Fatal(err)
	}
	for _, step := range []struct {
		name string
		zoom float64
	}{
		{"zoom 0.33", 0.33},
		{"zoom 0.50", 0.5},
		{"zoom 0.25", 0.25},
		{"zoom 0.67", 0.67},
		{"zoom 0.80", 0.8},
		{"zoom 0.90", 0.9},
	} {
		// Re-check the current settled layout before starting the next zoom
		// transition, so a previous step cannot leak into the next reading.
		waitTitleBarSidebarSettled(t, page, "#app-sidebar", "/conversations/new", titleBarSidebarWidth)
		page.SetZoomFactor(step.zoom)
		whiteboxWait(t, page, titleBarZoomReady(step.zoom, baseline.InsetLeft))
		waitTitleBarSidebarSettled(t, page, "#app-sidebar", "/conversations/new", titleBarSidebarWidth)
		surface := titleBarProbe(t, page)
		t.Logf("%s settled: sidebar=%.2f bar=%.2f controls=%.2f inset=%.2f brand=%.2f..%.2f top=%.2f logo=%.2fx%.2f natural=%.0fx%.0f actions=%.2f..%.2f top=%.2f width=%.2f button=%.2f",
			step.name, surface.SidebarWidth, surface.BarHeight, surface.ControlsBottom, surface.InsetLeft,
			surface.BrandLeft, surface.BrandRight, surface.BrandTop,
			surface.BrandLogoWidth, surface.BrandLogoHeight, surface.BrandLogoNaturalW, surface.BrandLogoNaturalH,
			surface.ActionsLeft, surface.ActionsLeft+surface.ActionsWidth, surface.ActionsTop,
			surface.ActionsWidth, surface.ActionButtonWidth)
		assertTitleBarDesktopSidebarLayout(t, step.name, surface)
		if step.zoom == 0.25 {
			assertTitleBarFocusTargets(t, step.name, page)
		}
	}

	// Restore on the same document. Reloading here would hide a layout that
	// only looks recovered because the page rebuilt it.
	waitTitleBarSidebarSettled(t, page, "#app-sidebar", "/conversations/new", titleBarSidebarWidth)
	page.SetZoomFactor(1)
	whiteboxWait(t, page, titleBarZoomReady(1, baseline.InsetLeft))
	waitTitleBarSidebarSettled(t, page, "#app-sidebar", "/conversations/new", titleBarSidebarWidth)
	sameDocument, err := mygo.EvalAs[bool](page, `window.__titleBarZoomDocument === "sidebar"`)
	if err != nil {
		t.Fatal(err)
	}
	if !sameDocument {
		t.Fatal("the sidebar zoom sequence replaced the document")
	}
	recovered := titleBarProbe(t, page)
	t.Logf("restored zoom 1.00 settled: sidebar=%.2f bar=%.2f controls=%.2f inset=%.2f brand=%.2f..%.2f top=%.2f logo=%.2fx%.2f actions=%.2f..%.2f top=%.2f width=%.2f button=%.2f",
		recovered.SidebarWidth, recovered.BarHeight, recovered.ControlsBottom, recovered.InsetLeft,
		recovered.BrandLeft, recovered.BrandRight, recovered.BrandTop,
		recovered.BrandLogoWidth, recovered.BrandLogoHeight,
		recovered.ActionsLeft, recovered.ActionsLeft+recovered.ActionsWidth, recovered.ActionsTop,
		recovered.ActionsWidth, recovered.ActionButtonWidth)
	for _, pair := range []struct {
		name          string
		before, after float64
	}{
		{"brand left", baseline.BrandLeft, recovered.BrandLeft},
		{"brand top", baseline.BrandTop, recovered.BrandTop},
		{"brand right", baseline.BrandRight, recovered.BrandRight},
		{"brand bottom", baseline.BrandBottom, recovered.BrandBottom},
		{"logo left", baseline.BrandLogoLeft, recovered.BrandLogoLeft},
		{"logo top", baseline.BrandLogoTop, recovered.BrandLogoTop},
		{"logo width", baseline.BrandLogoWidth, recovered.BrandLogoWidth},
		{"logo height", baseline.BrandLogoHeight, recovered.BrandLogoHeight},
		{"logo bottom", baseline.BrandLogoBottom, recovered.BrandLogoBottom},
		{"bar height", baseline.BarHeight, recovered.BarHeight},
		{"bar left", baseline.BarLeft, recovered.BarLeft},
		{"bar right", baseline.BarRight, recovered.BarRight},
		{"actions left", baseline.ActionsLeft, recovered.ActionsLeft},
		{"actions top", baseline.ActionsTop, recovered.ActionsTop},
		{"actions bottom", baseline.ActionsBottom, recovered.ActionsBottom},
		{"actions width", baseline.ActionsWidth, recovered.ActionsWidth},
		{"action button width", baseline.ActionButtonWidth, recovered.ActionButtonWidth},
		{"sidebar width", baseline.SidebarWidth, recovered.SidebarWidth},
	} {
		if math.Abs(pair.after-pair.before) > 1 {
			t.Fatalf("zoom restore changed %s: baseline=%+v recovered=%+v", pair.name, baseline, recovered)
		}
	}
	assertTitleBarDesktopSidebarLayout(t, "restored zoom 1", recovered)

	if err := page.LoadURL("/settings/general"); err != nil {
		t.Fatal(err)
	}
	waitTitleBarSidebarSettled(t, page, ".settings-sidebar", "/settings/general", titleBarSettingsSidebarWidth)
	settingsBaseline := titleBarProbe(t, page)
	t.Logf("settings baseline zoom 1.00 settled: sidebar=%.2f bar=%.2f controls=%.2f logo=%.2fx%.2f top=%.2f",
		settingsBaseline.SettingsSidebarWidth, settingsBaseline.BarHeight, settingsBaseline.ControlsBottom,
		settingsBaseline.LogoWidth, settingsBaseline.LogoHeight, settingsBaseline.LogoTop)
	assertTitleBarSettingsLayout(t, "settings zoom 1", settingsBaseline)

	if _, err := page.Eval(`window.__titleBarZoomDocument = "settings"`); err != nil {
		t.Fatal(err)
	}
	waitTitleBarSidebarSettled(t, page, ".settings-sidebar", "/settings/general", titleBarSettingsSidebarWidth)
	page.SetZoomFactor(0.25)
	whiteboxWait(t, page, titleBarZoomReady(0.25, settingsBaseline.InsetLeft))
	waitTitleBarSidebarSettled(t, page, ".settings-sidebar", "/settings/general", titleBarSettingsSidebarWidth)
	settingsNarrow := titleBarProbe(t, page)
	t.Logf("settings zoom 0.25 settled: sidebar=%.2f bar=%.2f controls=%.2f logo=%.2fx%.2f top=%.2f",
		settingsNarrow.SettingsSidebarWidth, settingsNarrow.BarHeight, settingsNarrow.ControlsBottom,
		settingsNarrow.LogoWidth, settingsNarrow.LogoHeight, settingsNarrow.LogoTop)
	assertTitleBarSettingsLayout(t, "settings zoom 0.25", settingsNarrow)

	waitTitleBarSidebarSettled(t, page, ".settings-sidebar", "/settings/general", titleBarSettingsSidebarWidth)
	page.SetZoomFactor(1)
	whiteboxWait(t, page, titleBarZoomReady(1, settingsBaseline.InsetLeft))
	waitTitleBarSidebarSettled(t, page, ".settings-sidebar", "/settings/general", titleBarSettingsSidebarWidth)
	settingsSameDocument, err := mygo.EvalAs[bool](page, `window.__titleBarZoomDocument === "settings"`)
	if err != nil {
		t.Fatal(err)
	}
	if !settingsSameDocument {
		t.Fatal("the settings zoom sequence replaced the document")
	}
	settingsRestored := titleBarProbe(t, page)
	t.Logf("settings restored zoom 1.00 settled: sidebar=%.2f bar=%.2f controls=%.2f logo=%.2fx%.2f top=%.2f",
		settingsRestored.SettingsSidebarWidth, settingsRestored.BarHeight, settingsRestored.ControlsBottom,
		settingsRestored.LogoWidth, settingsRestored.LogoHeight, settingsRestored.LogoTop)
	for _, pair := range []struct {
		name          string
		before, after float64
	}{
		{"settings sidebar width", settingsBaseline.SettingsSidebarWidth, settingsRestored.SettingsSidebarWidth},
		{"settings logo top", settingsBaseline.LogoTop, settingsRestored.LogoTop},
		{"settings logo width", settingsBaseline.LogoWidth, settingsRestored.LogoWidth},
		{"settings logo height", settingsBaseline.LogoHeight, settingsRestored.LogoHeight},
		{"settings logo bottom", settingsBaseline.LogoBottom, settingsRestored.LogoBottom},
		{"settings bar height", settingsBaseline.BarHeight, settingsRestored.BarHeight},
	} {
		if math.Abs(pair.after-pair.before) > 1 {
			t.Fatalf("settings zoom restore changed %s: baseline=%+v restored=%+v", pair.name, settingsBaseline, settingsRestored)
		}
	}
	assertTitleBarSettingsLayout(t, "settings restored zoom 1", settingsRestored)

	if _, err := page.Eval(`localStorage.removeItem("linksense.sidebarWidth")`); err != nil {
		t.Fatal(err)
	}
}

// TestNativeImmersiveTitleBarKeepsControlsAndTopAreaUsable covers the P1-09
// desktop visual acceptance: the page fills the frame, the native traffic
// lights stay, and every existing top-area control stays outside their room.
func TestNativeImmersiveTitleBarKeepsControlsAndTopAreaUsable(t *testing.T) {
	nativeWhiteboxSession(t, true)
	desktop := nativeWhitebox.desktop
	desktop.openMainWindow()
	win := desktop.mainWindow()
	t.Cleanup(win.Destroy)
	page := win.Page()
	whiteboxWait(t, page, `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli")`)
	marker, err := page.Eval(`document.documentElement.dataset.desktopPlatform`)
	if err != nil || marker != "darwin" {
		t.Fatalf("the macOS host marker is missing at first render: %v", marker)
	}

	frame, content := win.Bounds(), win.ContentBounds()
	t.Logf("window frame=%+v page content=%+v", frame, content)
	if content.X != frame.X || content.Y != frame.Y ||
		content.Width != frame.Width || content.Height != frame.Height {
		t.Fatalf("the page must fill the hidden-title-bar window: frame=%+v content=%+v", frame, content)
	}

	surface := titleBarProbe(t, page)
	t.Logf("native title bar surface=%+v", surface)
	if surface.InsetLeft <= 0 || surface.ControlsBottom <= 0 || surface.TitleBarHeight <= 0 {
		t.Fatalf("MyGo did not report the native traffic lights: %+v", surface)
	}
	if surface.BrandBarRegion != "drag" {
		t.Fatalf("the sidebar brand is not a drag surface: %+v", surface)
	}
	if !surface.SidebarVisible || surface.BrandTop < surface.ControlsBottom+titleBarFocusClearance-0.5 {
		t.Fatalf("the sidebar brand focus surface is under the traffic lights: %+v", surface)
	}
	if math.Abs(surface.BrandTop-(surface.ControlsBottom+titleBarFocusClearance)) > 1 {
		t.Fatalf("the sidebar brand does not use the reported control buffer: %+v", surface)
	}
	if surface.BrandLogoTop < surface.ControlsBottom+titleBarLogoClearance-0.5 ||
		surface.BrandLogoTop > surface.ControlsBottom+titleBarLogoClearance+2.5 {
		t.Fatalf("the sidebar lockup has the wrong clearance from the traffic lights: %+v", surface)
	}
	if surface.BrandLogoHeight > titleBarLogoMaxHeight+0.5 {
		t.Fatalf("the sidebar lockup is not compact: %+v", surface)
	}
	if surface.BrandBottom > surface.BarHeight+0.5 || surface.BrandLogoBottom > surface.BrandBottom+0.5 {
		t.Fatalf("the sidebar brand escaped the header: %+v", surface)
	}
	if surface.BrandLogoLeft < surface.BrandLeft-0.5 ||
		surface.BrandLogoLeft+surface.BrandLogoWidth > surface.BrandRight+0.5 {
		t.Fatalf("the sidebar lockup escaped its focus surface: %+v", surface)
	}
	if surface.BrandRight > surface.ActionsLeft {
		t.Fatalf("sidebar brand content overlaps its actions: %+v", surface)
	}
	if surface.ActionButtonWidth < 27.5 {
		t.Fatalf("the compact lockup reduced a standard sidebar button: %+v", surface)
	}
	if surface.BrandLogoWidth > 0 && surface.BrandLogoHeight > 0 &&
		math.Abs(surface.BrandLogoWidth/surface.BrandLogoHeight-titleBarLockupAspect) > 0.12 {
		t.Fatalf("the sidebar lockup lost its aspect ratio: %+v", surface)
	}
	if surface.CollapseLeft < surface.InsetLeft {
		t.Fatalf("the sidebar collapse control is under the traffic lights: %+v", surface)
	}

	// Focusing the link must not move the content inside its ring buffer, and
	// both themes must keep the same compact geometry.
	if _, err := page.Eval(`document.querySelector(".sidebar-brand-link")?.focus()`); err != nil {
		t.Fatal(err)
	}
	focused := titleBarProbe(t, page)
	t.Logf("focused surface=%+v", focused)
	if math.Abs(focused.BrandTop-surface.BrandTop) > 0.5 ||
		math.Abs(focused.BrandLogoTop-surface.BrandLogoTop) > 0.5 ||
		math.Abs(focused.BrandLogoHeight-surface.BrandLogoHeight) > 0.5 {
		t.Fatalf("focus moved the sidebar brand inside its ring buffer: %+v", focused)
	}
	if _, err := page.Eval(`document.activeElement?.blur()`); err != nil {
		t.Fatal(err)
	}
	if _, err := page.Eval(`document.documentElement.dataset.theme = "dark"; document.documentElement.classList.add("dark")`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.querySelector(".sidebar-brand-link img")?.getAttribute("src")?.includes("linksense-lockup-on-dark")`)
	darkBrand := titleBarProbe(t, page)
	t.Logf("dark sidebar surface=%+v", darkBrand)
	if math.Abs(darkBrand.BrandTop-surface.BrandTop) > 0.5 ||
		math.Abs(darkBrand.BrandLogoTop-surface.BrandLogoTop) > 0.5 ||
		math.Abs(darkBrand.BrandLogoHeight-surface.BrandLogoHeight) > 0.5 {
		t.Fatalf("dark mode changed the sidebar brand geometry: %+v", darkBrand)
	}
	if _, err := page.Eval(`document.documentElement.dataset.theme = "light"; document.documentElement.classList.remove("dark")`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.querySelector(".sidebar-brand-link img")?.getAttribute("src")?.includes("linksense-lockup-primary")`)

	// A management page shows the shared PageTopBar in the same top area.
	if err := page.LoadURL("/capabilities"); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `location.pathname === "/capabilities" && document.querySelector("[data-slot='page-top-bar']") !== null`)
	management := titleBarProbe(t, page)
	t.Logf("management surface=%+v", management)
	if management.TopBarRegion != "drag" || management.TopBarPadding < 27 {
		t.Fatalf("the shared page top bar is not an inset-free drag surface: %+v", management)
	}

	// The added Mac rules must be inert without the darwin marker.
	setDesktopMarker(t, page, "windows")
	windowsExpanded := titleBarProbe(t, page)
	t.Logf("windows-marker surface=%+v", windowsExpanded)
	setDesktopMarker(t, page, "")
	plainExpanded := titleBarProbe(t, page)
	if windowsExpanded.TopBarRegion != "" || plainExpanded.TopBarRegion != "" ||
		math.Abs(windowsExpanded.BrandTop-plainExpanded.BrandTop) > 0.5 {
		t.Fatalf("a non-darwin marker activated the macOS title-bar rules: %+v / %+v", windowsExpanded, plainExpanded)
	}
	setDesktopMarker(t, page, "darwin")
	darwinExpanded := titleBarProbe(t, page)
	if darwinExpanded.TopBarRegion != "drag" ||
		darwinExpanded.BrandTop < darwinExpanded.ControlsBottom+titleBarFocusClearance-0.5 ||
		darwinExpanded.BrandLogoTop < darwinExpanded.ControlsBottom+titleBarLogoClearance-0.5 {
		t.Fatalf("the darwin marker did not restore the macOS title-bar layout: %+v", darwinExpanded)
	}

	if _, err := page.Eval(`document.querySelector(".sidebar-collapse-control").click()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.querySelector(".app-shell")?.dataset.sidebarCollapsed === "true"`)
	whiteboxWait(t, page, `(document.querySelector(".app-shell")?.getAnimations() ?? []).every(animation => animation.playState === "finished")`)
	collapsed := titleBarProbe(t, page)
	t.Logf("collapsed sidebar surface=%+v", collapsed)
	if collapsed.TriggerDisplay == "none" || collapsed.TriggerLeft < collapsed.InsetLeft {
		t.Fatalf("the restore control is not reachable beside the traffic lights: %+v", collapsed)
	}
	if collapsed.TopBarPadding < 52+collapsed.InsetLeft-1 {
		t.Fatalf("the collapsed top bar does not reserve the native inset: %+v", collapsed)
	}

	setDesktopMarker(t, page, "windows")
	windowsCollapsed := titleBarProbe(t, page)
	t.Logf("windows-marker collapsed surface=%+v", windowsCollapsed)
	if windowsCollapsed.TopBarRegion != "" ||
		math.Abs(windowsCollapsed.TopBarPadding-52) > 0.6 ||
		math.Abs(windowsCollapsed.TriggerLeft-10) > 0.6 {
		t.Fatalf("the Windows marker changed the collapsed top area: %+v", windowsCollapsed)
	}
	setDesktopMarker(t, page, "")
	plainCollapsed := titleBarProbe(t, page)
	if plainCollapsed.TopBarRegion != "" ||
		math.Abs(plainCollapsed.TopBarPadding-52) > 0.6 ||
		math.Abs(plainCollapsed.TriggerLeft-10) > 0.6 {
		t.Fatalf("the markerless collapsed top area changed: %+v", plainCollapsed)
	}
	setDesktopMarker(t, page, "darwin")
	restoredCollapsed := titleBarProbe(t, page)
	if restoredCollapsed.TopBarRegion != "drag" ||
		math.Abs(restoredCollapsed.TopBarPadding-(52+restoredCollapsed.InsetLeft)) > 1 ||
		math.Abs(restoredCollapsed.TriggerLeft-(10+restoredCollapsed.InsetLeft)) > 1 {
		t.Fatalf("the darwin marker did not restore the collapsed top area: %+v", restoredCollapsed)
	}

	if _, err := page.Eval(`document.querySelector(".desktop-sidebar-trigger").click()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.querySelector(".app-shell")?.dataset.sidebarCollapsed !== "true"`)
	whiteboxWait(t, page, `(document.querySelector(".app-shell")?.getAnimations() ?? []).every(animation => animation.playState === "finished")`)

	// The smallest window drops the desktop sidebar and shows the mobile trigger.
	win.SetSize(720, 540)
	whiteboxWait(t, page, `window.innerWidth <= 767`)
	mobile := titleBarProbe(t, page)
	t.Logf("minimum-window surface=%+v", mobile)
	if mobile.SidebarVisible || mobile.TriggerDisplay == "none" {
		t.Fatalf("the minimum window did not switch to the mobile top area: %+v", mobile)
	}
	if mobile.TriggerLeft < mobile.InsetLeft+9 {
		t.Fatalf("the mobile navigation control is under the traffic lights: %+v", mobile)
	}
	if mobile.TopBarPadding < 56+mobile.InsetLeft-1 {
		t.Fatalf("the mobile top bar does not reserve the native inset: %+v", mobile)
	}

	setDesktopMarker(t, page, "windows")
	windowsMobile := titleBarProbe(t, page)
	t.Logf("windows-marker mobile surface=%+v", windowsMobile)
	if windowsMobile.TopBarRegion != "" ||
		math.Abs(windowsMobile.TopBarPadding-56) > 0.6 ||
		math.Abs(windowsMobile.TriggerLeft-10) > 0.6 {
		t.Fatalf("the Windows marker changed the mobile top area: %+v", windowsMobile)
	}
	setDesktopMarker(t, page, "")
	plainMobile := titleBarProbe(t, page)
	if plainMobile.TopBarRegion != "" ||
		math.Abs(plainMobile.TopBarPadding-56) > 0.6 ||
		math.Abs(plainMobile.TriggerLeft-10) > 0.6 {
		t.Fatalf("the markerless mobile top area changed: %+v", plainMobile)
	}
	setDesktopMarker(t, page, "darwin")
	restoredMobile := titleBarProbe(t, page)
	if restoredMobile.TopBarRegion != "drag" ||
		restoredMobile.TopBarPadding < 56+restoredMobile.InsetLeft-1 ||
		restoredMobile.TriggerLeft < restoredMobile.InsetLeft+9 {
		t.Fatalf("the darwin marker did not restore the mobile top area: %+v", restoredMobile)
	}

	if _, err := page.Eval(`document.querySelector(".mobile-shell-trigger").click()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.querySelector(".mobile-navigation-sheet .sidebar-brand-bar") !== null`)
	whiteboxWait(t, page, `(document.querySelector(".mobile-navigation-sheet")?.getAnimations() ?? []).every(animation => animation.playState === "finished")`)
	sheet := titleBarProbe(t, page)
	if sheet.BrandTop >= 0 && (sheet.BrandTop < sheet.ControlsBottom+titleBarFocusClearance-0.5 ||
		sheet.BrandLogoTop < sheet.ControlsBottom+titleBarLogoClearance-0.5 ||
		sheet.BrandRight > sheet.ActionsLeft) {
		t.Fatalf("mobile navigation content is under the traffic lights: %+v", sheet)
	}
	if _, err := page.Eval(`document.querySelector(".mobile-navigation-close")?.click()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.querySelector(".mobile-navigation-sheet") === null || document.querySelector(".mobile-navigation-sheet")?.getClientRects().length === 0`)

	win.SetSize(1200, 800)
	whiteboxWait(t, page, `window.innerWidth > 767`)

	// Page zoom crosses the same breakpoint in CSS pixels; MyGo reports the
	// native control room divided by the zoom.
	page.SetZoomFactor(2)
	whiteboxWait(t, page, `window.innerWidth <= 767`)
	whiteboxWait(t, page, `Math.abs((parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mygo-titlebar-inset-left")) || 0) - 30.5) < 0.6`)
	zoomed := titleBarProbe(t, page)
	t.Logf("zoomed surface=%+v", zoomed)
	if zoomed.SidebarVisible || zoomed.TriggerDisplay == "none" ||
		zoomed.TriggerLeft < zoomed.InsetLeft+9 ||
		zoomed.TopBarPadding < 56+zoomed.InsetLeft-1 {
		t.Fatalf("page zoom did not move the top-area controls clear of the traffic lights: %+v", zoomed)
	}
	page.SetZoomFactor(1)
	whiteboxWait(t, page, `window.innerWidth > 767`)
	whiteboxWait(t, page, `(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mygo-titlebar-inset-left")) || 0) > 60`)
	waitTitleBarSidebarSettled(t, page, "#app-sidebar", "/capabilities", surface.SidebarWidth)

	// Smaller page zoom makes the reported native controls taller. The brand
	// must stay inside the remaining header height, then recover at 100%.
	page.SetZoomFactor(0.5)
	whiteboxWait(t, page, `window.innerWidth > 2000 && (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mygo-titlebar-controls-bottom")) || 0) > 40`)
	waitTitleBarSidebarSettled(t, page, "#app-sidebar", "/capabilities", surface.SidebarWidth)
	large := titleBarProbe(t, page)
	t.Logf("large native-controls surface=%+v", large)
	if !large.SidebarVisible ||
		large.BrandTop < large.ControlsBottom+titleBarFocusClearance-0.5 ||
		large.BrandLogoTop < large.ControlsBottom+titleBarLogoClearance-0.5 ||
		large.BrandLogoBottom > large.BarHeight+0.5 ||
		large.BrandBottom > large.BarHeight+0.5 ||
		large.BrandRight > large.ActionsLeft ||
		large.ActionButtonWidth < 27.5 {
		t.Fatalf("the brand escaped the safe header height under large native controls: %+v", large)
	}
	page.SetZoomFactor(1)
	whiteboxWait(t, page, `window.innerWidth > 767 && (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mygo-titlebar-controls-bottom")) || 0) < 30`)
	waitTitleBarSidebarSettled(t, page, "#app-sidebar", "/capabilities", surface.SidebarWidth)
	recovered := titleBarProbe(t, page)
	t.Logf("recovered surface=%+v", recovered)
	if math.Abs(recovered.BrandTop-surface.BrandTop) > 1 ||
		math.Abs(recovered.BrandLogoTop-surface.BrandLogoTop) > 1 ||
		math.Abs(recovered.BrandLogoHeight-surface.BrandLogoHeight) > 0.5 {
		t.Fatalf("the brand did not recover after the large-controls zoom: %+v", recovered)
	}

	// A user-narrowed sidebar must still keep its brand and actions apart.
	if _, err := page.Eval(`localStorage.setItem("linksense.sidebarWidth", "200")`); err != nil {
		t.Fatal(err)
	}
	whiteboxReload(t, page)
	whiteboxWait(t, page, `location.pathname === "/capabilities" && document.querySelector(".sidebar-brand-bar") !== null`)
	narrow := titleBarProbe(t, page)
	t.Logf("minimum-sidebar surface=%+v", narrow)
	if narrow.TopBarRegion != "drag" || narrow.ActionsLeft < narrow.InsetLeft {
		t.Fatalf("the narrow sidebar top area is not usable: %+v", narrow)
	}
	if narrow.BrandTop >= 0 && (narrow.BrandTop < narrow.ControlsBottom+titleBarFocusClearance-0.5 ||
		narrow.BrandLogoTop < narrow.ControlsBottom+titleBarLogoClearance-0.5 ||
		narrow.BrandLogoBottom > narrow.BarHeight+0.5 ||
		narrow.BrandRight > narrow.ActionsLeft) {
		t.Fatalf("the narrow sidebar brand collides with the traffic lights or its actions: %+v", narrow)
	}
	if narrow.BrandLogoWidth > 0 && narrow.BrandLogoHeight > 0 &&
		math.Abs(narrow.BrandLogoWidth/narrow.BrandLogoHeight-titleBarLockupAspect) > 0.12 {
		t.Fatalf("the narrow sidebar lockup is distorted: %+v", narrow)
	}
	if narrow.ActionButtonWidth < 27.5 {
		t.Fatalf("the narrow sidebar reduced a standard button: %+v", narrow)
	}
	if _, err := page.Eval(`localStorage.removeItem("linksense.sidebarWidth")`); err != nil {
		t.Fatal(err)
	}

	// Full screen hides the native controls; the page must not keep their room.
	// A CLI-launched whitebox app is not active; focus it as a user would,
	// then wait for the native completion instead of the transient style mask.
	mygo.App.Focus()
	win.Focus()
	focusDeadline := time.Now().Add(3 * time.Second)
	for !(mygo.App.IsActive() && win.IsFocused()) && time.Now().Before(focusDeadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if !mygo.App.IsActive() || !win.IsFocused() {
		t.Logf("the whitebox app did not become active (appActive=%t windowFocused=%t); macOS may refuse the full-screen transition", mygo.App.IsActive(), win.IsFocused())
	}
	entered := make(chan struct{}, 1)
	offEnter := win.OnEnterFullScreen(func() {
		select {
		case entered <- struct{}{}:
		default:
		}
	})
	t.Cleanup(offEnter)
	win.SetFullScreen(true)
	waitForNativeFullScreen(t, win, entered, true)
	whiteboxWait(t, page, `(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mygo-titlebar-inset-left")) || 0) === 0`)
	fullscreen := titleBarProbe(t, page)
	t.Logf("full-screen surface=%+v", fullscreen)
	if fullscreen.InsetLeft != 0 || fullscreen.ControlsBottom != 0 || fullscreen.TitleBarHeight != 0 {
		t.Fatalf("full screen retained phantom native control room: %+v", fullscreen)
	}
	if fullscreen.TopBarPadding < 27 || fullscreen.TopBarPadding > 29 {
		t.Fatalf("full screen retained phantom top-bar padding: %+v", fullscreen)
	}
	if math.Abs(fullscreen.BrandLogoTop-(fullscreen.BarHeight-fullscreen.BrandLogoHeight)/2) > 1 ||
		math.Abs((fullscreen.BrandTop+fullscreen.BrandBottom)/2-fullscreen.BarHeight/2) > 1 {
		t.Fatalf("full screen did not restore the centered brand: %+v", fullscreen)
	}
	left := make(chan struct{}, 1)
	offLeave := win.OnLeaveFullScreen(func() {
		select {
		case left <- struct{}{}:
		default:
		}
	})
	t.Cleanup(offLeave)
	win.SetFullScreen(false)
	waitForNativeFullScreen(t, win, left, false)
	whiteboxWait(t, page, `(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mygo-titlebar-inset-left")) || 0) > 0`)
	win.SetSize(1200, 800)
	whiteboxWait(t, page, `window.innerWidth > 767`)

	// Settings reuses the same top area with its own sidebar.
	if err := page.LoadURL("/settings/general"); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `location.pathname === "/settings/general" && document.querySelector(".settings-navigation-header") !== null`)
	settings := titleBarProbe(t, page)
	t.Logf("settings surface=%+v", settings)
	if settings.HeaderRegion != "drag" {
		t.Fatalf("settings navigation is not a drag surface: %+v", settings)
	}
	if settings.LogoTop < settings.ControlsBottom+titleBarLogoClearance-0.5 ||
		settings.LogoHeight > titleBarLogoMaxHeight+0.5 ||
		settings.LogoBottom > settings.BarHeight+0.5 {
		t.Fatalf("settings branding is under the traffic lights or not compact: %+v", settings)
	}
	if settings.LogoWidth > 0 && settings.LogoHeight > 0 &&
		math.Abs(settings.LogoWidth/settings.LogoHeight-titleBarLockupAspect) > 0.12 {
		t.Fatalf("the settings lockup is distorted: %+v", settings)
	}

	setDesktopMarker(t, page, "windows")
	windowsSettingsDesktop := titleBarProbe(t, page)
	t.Logf("windows-marker settings surface=%+v", windowsSettingsDesktop)
	setDesktopMarker(t, page, "")
	plainSettingsDesktop := titleBarProbe(t, page)
	if windowsSettingsDesktop.HeaderRegion != "" || plainSettingsDesktop.HeaderRegion != "" ||
		math.Abs(windowsSettingsDesktop.LogoTop-plainSettingsDesktop.LogoTop) > 0.5 {
		t.Fatalf("a non-darwin marker activated the settings title-bar rules: %+v / %+v", windowsSettingsDesktop, plainSettingsDesktop)
	}
	setDesktopMarker(t, page, "darwin")
	restoredSettingsDesktop := titleBarProbe(t, page)
	if restoredSettingsDesktop.HeaderRegion != "drag" ||
		restoredSettingsDesktop.LogoTop < restoredSettingsDesktop.ControlsBottom+titleBarLogoClearance-0.5 {
		t.Fatalf("the darwin marker did not restore the settings title-bar layout: %+v", restoredSettingsDesktop)
	}

	if _, err := page.Eval(`document.querySelector('.settings-navigation-link[href="/settings/profile"]')?.click()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `location.pathname === "/settings/profile"`)

	// The settings mobile header takes over at the minimum window width.
	win.SetSize(720, 540)
	whiteboxWait(t, page, `window.innerWidth <= 767`)
	whiteboxWait(t, page, `getComputedStyle(document.querySelector(".settings-mobile-header")).display !== "none"`)
	mobileSettings := titleBarProbe(t, page)
	t.Logf("settings mobile surface=%+v", mobileSettings)
	if !mobileSettings.MobileHeader || mobileSettings.MobileHeaderPad < 10+mobileSettings.InsetLeft-1 ||
		mobileSettings.MobileHeaderLeft < mobileSettings.InsetLeft+9 {
		t.Fatalf("the settings mobile header is under the traffic lights: %+v", mobileSettings)
	}

	setDesktopMarker(t, page, "windows")
	windowsSettingsMobile := titleBarProbe(t, page)
	t.Logf("windows-marker settings mobile surface=%+v", windowsSettingsMobile)
	if math.Abs(windowsSettingsMobile.MobileHeaderPad-10) > 0.6 ||
		math.Abs(windowsSettingsMobile.MobileHeaderLeft-10) > 0.6 {
		t.Fatalf("the Windows marker changed the settings mobile header: %+v", windowsSettingsMobile)
	}
	setDesktopMarker(t, page, "")
	plainSettingsMobile := titleBarProbe(t, page)
	if math.Abs(plainSettingsMobile.MobileHeaderPad-10) > 0.6 ||
		math.Abs(plainSettingsMobile.MobileHeaderLeft-10) > 0.6 {
		t.Fatalf("the markerless settings mobile header changed: %+v", plainSettingsMobile)
	}
	setDesktopMarker(t, page, "darwin")
	restoredSettingsMobile := titleBarProbe(t, page)
	if math.Abs(restoredSettingsMobile.MobileHeaderPad-(10+restoredSettingsMobile.InsetLeft)) > 1 ||
		restoredSettingsMobile.MobileHeaderLeft < restoredSettingsMobile.InsetLeft+9 {
		t.Fatalf("the darwin marker did not restore the settings mobile header: %+v", restoredSettingsMobile)
	}
	win.SetSize(1200, 800)
	whiteboxWait(t, page, `window.innerWidth > 767`)

	// Signing out keeps the same window and replaces the shell with the shared
	// authentication layout, whose top row must remain clickable.
	nativeWhiteboxSession(t, false)
	whiteboxReload(t, page)
	whiteboxWait(t, page, `location.pathname === "/login" && document.querySelector("[data-desktop-sign-in]") !== null`)
	auth := titleBarProbe(t, page)
	t.Logf("signed-out surface=%+v", auth)
	if auth.AuthRegion != "drag" || auth.AuthChildRegion != "no-drag" || auth.AuthTopRowRegion != "drag" {
		t.Fatalf("the signed-out layout does not keep an unused drag surface: %+v", auth)
	}
	if auth.AuthButtonLeft < auth.InsetLeft {
		t.Fatalf("the language control is under the traffic lights: %+v", auth)
	}

	setDesktopMarker(t, page, "windows")
	windowsAuth := titleBarProbe(t, page)
	t.Logf("windows-marker signed-out surface=%+v", windowsAuth)
	if windowsAuth.AuthRegion != "" || windowsAuth.AuthChildRegion != "" || windowsAuth.AuthTopRowRegion != "" {
		t.Fatalf("the Windows marker activated the signed-out drag surfaces: %+v", windowsAuth)
	}
	setDesktopMarker(t, page, "")
	plainAuth := titleBarProbe(t, page)
	if plainAuth.AuthRegion != "" || plainAuth.AuthChildRegion != "" || plainAuth.AuthTopRowRegion != "" {
		t.Fatalf("a markerless signed-out layout activated the Mac drag surfaces: %+v", plainAuth)
	}
	setDesktopMarker(t, page, "darwin")
	restoredAuth := titleBarProbe(t, page)
	if restoredAuth.AuthRegion != "drag" || restoredAuth.AuthChildRegion != "no-drag" || restoredAuth.AuthTopRowRegion != "drag" {
		t.Fatalf("the darwin marker did not restore the signed-out drag surfaces: %+v", restoredAuth)
	}

	// Both themes keep the same geometry; native window capture needs TCC.
	if _, err := page.Eval(`document.documentElement.classList.add("dark")`); err != nil {
		t.Fatal(err)
	}
	dark := titleBarProbe(t, page)
	t.Logf("dark signed-out surface=%+v", dark)
	if dark.InsetLeft != auth.InsetLeft || dark.ControlsBottom != auth.ControlsBottom ||
		dark.AuthRegion != "drag" || dark.AuthTopRowRegion != "drag" {
		t.Fatalf("dark mode changed the title-bar geometry: %+v", dark)
	}
	if _, err := page.Eval(`document.documentElement.classList.remove("dark")`); err != nil {
		t.Fatal(err)
	}

	if _, err := page.Eval(`document.querySelector(".account-access-top-row button")?.click()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.querySelector("[role='listbox']") !== null`)

	// The reachable route failure screen shares the same top-area contract.
	nativeWhitebox.bootstrapFail.Store(true)
	t.Cleanup(func() { nativeWhitebox.bootstrapFail.Store(false) })
	whiteboxReload(t, page)
	whiteboxWait(t, page, `document.querySelector("[data-slot='public-failure-screen']") !== null`)
	failure := titleBarProbe(t, page)
	t.Logf("route-failure surface=%+v", failure)
	if failure.FailureRegion != "drag" || failure.FailureChild != "no-drag" {
		t.Fatalf("the route failure screen does not keep an unused drag surface: %+v", failure)
	}

	setDesktopMarker(t, page, "windows")
	windowsFailure := titleBarProbe(t, page)
	t.Logf("windows-marker route-failure surface=%+v", windowsFailure)
	if windowsFailure.FailureRegion != "" || windowsFailure.FailureChild != "" {
		t.Fatalf("the Windows marker activated the route-failure drag surface: %+v", windowsFailure)
	}
	setDesktopMarker(t, page, "")
	plainFailure := titleBarProbe(t, page)
	if plainFailure.FailureRegion != "" || plainFailure.FailureChild != "" {
		t.Fatalf("a markerless route failure activated the Mac drag surface: %+v", plainFailure)
	}
	setDesktopMarker(t, page, "darwin")
	restoredFailure := titleBarProbe(t, page)
	if restoredFailure.FailureRegion != "drag" || restoredFailure.FailureChild != "no-drag" {
		t.Fatalf("the darwin marker did not restore the route-failure drag surface: %+v", restoredFailure)
	}
	nativeWhitebox.bootstrapFail.Store(false)
}
