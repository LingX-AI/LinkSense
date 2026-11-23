//go:build desktop_whitebox

package main

import (
	"fmt"
	"math"
	"strings"
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
	ControlsBottom       float64          `json:"controlsBottom"`
	TitleBarHeight       float64          `json:"titleBarHeight"`
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
	BrandLogoRight       float64          `json:"brandLogoRight"`
	BrandLogoBottom      float64          `json:"brandLogoBottom"`
	BrandLogoComplete    bool             `json:"brandLogoComplete"`
	BrandLogoNaturalW    float64          `json:"brandLogoNaturalWidth"`
	BrandLogoNaturalH    float64          `json:"brandLogoNaturalHeight"`
	BrandLogoAlt         string           `json:"brandLogoAlt"`
	BrandLogoCurrentSrc  string           `json:"brandLogoCurrentSrc"`
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
	CollapseLeft         float64          `json:"collapseLeft"`
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
	FailureRegion        string           `json:"failureRegion"`
	FailureChild         string           `json:"failureChildRegion"`
	MobileHeader         bool             `json:"mobileHeaderVisible"`
	MobileHeaderPad      float64          `json:"mobileHeaderPadding"`
	MobileHeaderLeft     float64          `json:"mobileHeaderLeft"`
	MobileCloseVisible   bool             `json:"mobileCloseVisible"`
	MobileCloseLeft      float64          `json:"mobileCloseLeft"`
	MobileCloseTop       float64          `json:"mobileCloseTop"`
	MobileCloseWidth     float64          `json:"mobileCloseWidth"`
	MobileCloseHeight    float64          `json:"mobileCloseHeight"`
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
	const mobileClose = document.querySelector(".mobile-navigation-close")
	const br = box(brand), bl = box(brandLogo), bb = box(bar), ar = box(actions), cr = box(collapse), lr = box(logo), tr = box(trigger), ab = box(authButton), mh = box(mobileHeaderLink), af = box(actionButton), sb = box(sidebar), ssb = box(settingsSidebar)
	const actionButtons = Array.from(bar?.querySelectorAll(".sidebar-header-actions button") ?? []).map(button => {
		const rect = box(button)
		return rect ? { label: button.getAttribute("aria-label") || button.textContent.trim(), left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null
	}).filter(Boolean)
	return {
		insetLeft: px("--mygo-titlebar-inset-left"),
		controlsBottom: px("--mygo-titlebar-controls-bottom"),
		titleBarHeight: px("--mygo-titlebar-height"),
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
		brandLogoRight: bl ? bl.right : -1,
		brandLogoBottom: bl ? bl.bottom : -1,
		brandLogoComplete: !!brandLogo && brandLogo.complete,
		brandLogoNaturalWidth: brandLogo ? brandLogo.naturalWidth : -1,
		brandLogoNaturalHeight: brandLogo ? brandLogo.naturalHeight : -1,
		brandLogoAlt: brandLogo ? (brandLogo.getAttribute("alt") || "") : "",
		brandLogoCurrentSrc: brandLogo ? (brandLogo.currentSrc || brandLogo.getAttribute("src") || "") : "",
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
		collapseLeft: cr ? cr.left : -1,
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
		failureRegion: region(failure),
		failureChildRegion: failure ? region(failure.firstElementChild) : "",
		mobileHeaderVisible: visible(mobileHeader),
		mobileHeaderPadding: mobileHeader ? parseFloat(getComputedStyle(mobileHeader).paddingLeft) : -1,
		mobileHeaderLeft: mh ? mh.left : -1,
		mobileCloseVisible: visible(mobileClose),
		mobileCloseLeft: box(mobileClose) ? box(mobileClose).left : -1,
		mobileCloseTop: box(mobileClose) ? box(mobileClose).top : -1,
		mobileCloseWidth: box(mobileClose) ? box(mobileClose).width : -1,
		mobileCloseHeight: box(mobileClose) ? box(mobileClose).height : -1
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

// The link carries the standard 2px focus ring plus its 2px offset, so its
// top must clear the native controls by at least this much. The icon keeps
// its compact clearance at the standard page scale.
const (
	titleBarFocusClearance       = 4.0
	titleBarLogoClearance        = 6.0
	titleBarLogoMaxHeight        = 18.0
	titleBarLockupAspect         = 348.0 / 94.0
	titleBarSidebarWidth         = 200.0
	titleBarWideSidebarWidth     = 440.0
	titleBarDefaultSidebarWidth  = 272.0
	titleBarSettingsSidebarWidth = 272.0
	titleBarBrandInset           = 16.0
	titleBarBrandHit             = 24.0
	titleBarActionButtonWidth    = 28.0
	titleBarActionsWidth         = 99.0
	// The native window applies TrafficLightPosition {X: 14, Y: 14}: the top
	// inset moves the controls down and widens the close-button x-range from
	// the recorded 61px room. The spacer uses the native title-bar height, so
	// the 40px brand/action group centers on the traffic lights at 100%.
	titleBarRecordedDefaultInset = 61.0
	titleBarTrafficLightTopInset = 14.0
	titleBarAlignmentSlop        = 1.25
)

const titleBarGeometrySlop = 0.5

// assertTitleBarNativePosition checks the native position contract: the
// traffic lights moved down by the 14pt top inset, the close-button x-range
// grew from its recorded default, and the brand/actions share the native
// midpoint on a single line.
func assertTitleBarNativePosition(t *testing.T, label string, surface titleBarSurface) {
	t.Helper()
	if math.Abs((surface.TitleBarHeight-surface.ControlsBottom)-titleBarTrafficLightTopInset) > 0.6 {
		t.Fatalf("%s: the native traffic lights did not move down by the 14pt top inset: %+v", label, surface)
	}
	if surface.InsetLeft < titleBarRecordedDefaultInset+5 {
		t.Fatalf("%s: the native traffic-light x-range did not grow from the recorded %.0fpx default: %+v",
			label, titleBarRecordedDefaultInset, surface)
	}
	if surface.BarHeight <= surface.ControlsBottom {
		t.Fatalf("%s: the compact row is not taller than the native controls: %+v", label, surface)
	}
	nativeCenter := surface.TitleBarHeight / 2
	brandCenter := (surface.BrandTop + surface.BrandBottom) / 2
	actionsCenter := (surface.ActionsTop + surface.ActionsBottom) / 2
	if math.Abs(brandCenter-nativeCenter) > titleBarAlignmentSlop ||
		math.Abs(actionsCenter-nativeCenter) > titleBarAlignmentSlop {
		t.Fatalf("%s: the brand/actions are not centered on the native traffic lights (brand %.2f, actions %.2f, native %.2f): %+v",
			label, brandCenter, actionsCenter, nativeCenter, surface)
	}
}

// The app shell animates its grid column for 160ms when the sidebar width
// changes. Wait for that animation to finish instead of a fixed delay.
const titleBarSettled = `(async () => {
	const shell = document.querySelector(".app-shell")
	const transition = Array.from(shell?.getAnimations() ?? []).filter(animation => animation.transitionProperty === "grid-template-columns")
	await Promise.all(transition.map(animation => animation.finished.catch(() => {})))
	return Array.from(shell?.getAnimations() ?? []).filter(animation => animation.transitionProperty === "grid-template-columns").every(animation => animation.playState === "finished")
})()`

// waitTitleBarSidebarSettled waits for the stored sidebar width and the
// app-shell grid animation on the same document. Geometry assertions run only
// after this helper returns.
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

func waitTitleBarIcon(t *testing.T, page *mygo.Page) {
	t.Helper()
	whiteboxWait(t, page, `(() => {
		const logo = document.querySelector(".sidebar-brand-link img")
		return !!logo && logo.complete && logo.naturalWidth > 0 && logo.naturalHeight > 0
	})()`)
}

// assertTitleBarDesktopSidebarLayout checks the Mac desktop brand row at the
// standard page scale: the 24px focus link, the square 18px app icon, the
// three 28px actions, and focus envelopes clear of the native controls. It
// accepts one shared line when it fits and a wrapped group when the stored
// sidebar is physically too narrow.
func assertTitleBarDesktopSidebarLayout(t *testing.T, label string, surface titleBarSurface, wantSidebarWidth float64) {
	t.Helper()
	if !surface.SidebarVisible || surface.SidebarWidth <= 1 {
		t.Fatalf("%s: the desktop sidebar is missing: %+v", label, surface)
	}
	if math.Abs(surface.SidebarWidth-wantSidebarWidth) > 1 {
		t.Fatalf("%s: the stored sidebar width changed: %+v", label, surface)
	}
	brandWidth := surface.BrandRight - surface.BrandLeft
	brandHeight := surface.BrandBottom - surface.BrandTop
	if brandWidth < titleBarBrandHit-titleBarGeometrySlop || brandHeight < titleBarBrandHit-titleBarGeometrySlop ||
		surface.BrandLogoWidth <= 1 || surface.BrandLogoHeight <= 1 ||
		surface.BarRight-surface.BarLeft <= 1 {
		t.Fatalf("%s: the sidebar logo, its 24px focus link, or the brand bar collapsed: %+v", label, surface)
	}
	// A nonempty box is not proof of a loaded icon: WebKit reports the natural
	// size only after the image resource decodes.
	if !surface.BrandLogoComplete || surface.BrandLogoNaturalW <= 0 || surface.BrandLogoNaturalH <= 0 {
		t.Fatalf("%s: the sidebar icon has no loaded intrinsic size: %+v", label, surface)
	}
	if surface.BrandLogoAlt == "" {
		t.Fatalf("%s: the sidebar icon lost its accessible product name: %+v", label, surface)
	}
	if !strings.HasSuffix(surface.BrandLogoCurrentSrc, "/linksense-appicon.svg") {
		t.Fatalf("%s: the Mac brand is not the packaged app icon: %+v", label, surface)
	}
	if math.Abs(surface.BrandLogoWidth/surface.BrandLogoHeight-1) > 0.05 ||
		math.Abs(surface.BrandLogoNaturalW/surface.BrandLogoNaturalH-1) > 0.05 {
		t.Fatalf("%s: the Mac app icon is no longer square: %+v", label, surface)
	}
	if surface.BrandLogoHeight > titleBarLogoMaxHeight+titleBarGeometrySlop {
		t.Fatalf("%s: the app icon grew past the 18px cap: %+v", label, surface)
	}
	if surface.BrandLogoLeft < surface.BrandLeft-titleBarGeometrySlop ||
		surface.BrandLogoRight > surface.BrandRight+titleBarGeometrySlop ||
		surface.BrandLogoTop < surface.BrandTop-titleBarGeometrySlop ||
		surface.BrandLogoBottom > surface.BrandBottom+titleBarGeometrySlop {
		t.Fatalf("%s: the app icon escaped its focus link: %+v", label, surface)
	}
	if math.Abs(surface.ActionsWidth-titleBarActionsWidth) > 1 ||
		math.Abs(surface.ActionButtonWidth-titleBarActionButtonWidth) > 0.5 {
		t.Fatalf("%s: the fixed action row changed size: %+v", label, surface)
	}
	if len(surface.ActionButtons) != 3 {
		t.Fatalf("%s: expected the three existing sidebar actions: %+v", label, surface)
	}
	if surface.BarRight > surface.SidebarWidth+titleBarGeometrySlop ||
		surface.BarRight < surface.SidebarWidth-5 {
		t.Fatalf("%s: the brand bar does not span the stored sidebar width: %+v", label, surface)
	}
	if surface.BrandRight > surface.ActionsLeft+titleBarGeometrySlop {
		t.Fatalf("%s: the brand overlaps its adjacent actions: %+v", label, surface)
	}
	if math.Abs((surface.BrandTop+surface.BrandBottom)/2-(surface.ActionsTop+surface.ActionsBottom)/2) > titleBarGeometrySlop {
		t.Fatalf("%s: the icon and actions are not optically centered on one row: %+v", label, surface)
	}
	if surface.BrandTop-titleBarFocusClearance < surface.ControlsBottom-titleBarGeometrySlop &&
		surface.BrandLeft-titleBarFocusClearance < surface.InsetLeft-titleBarGeometrySlop {
		t.Fatalf("%s: the brand row and its focus ring overlap the native controls: %+v", label, surface)
	}
	if surface.BrandBottom+titleBarFocusClearance > surface.BarHeight+titleBarGeometrySlop {
		t.Fatalf("%s: the brand focus ring escaped the compact bar: %+v", label, surface)
	}
	rowBelowNative := surface.ControlsBottom > 0 &&
		surface.BrandTop-titleBarFocusClearance >= surface.ControlsBottom-titleBarGeometrySlop
	if rowBelowNative {
		if surface.ActionsTop-titleBarFocusClearance < surface.ControlsBottom-titleBarGeometrySlop {
			t.Fatalf("%s: the action group did not wrap below the native controls with the brand: %+v", label, surface)
		}
		if surface.BarHeight < surface.TitleBarHeight+titleBarBrandHit {
			t.Fatalf("%s: the wrapped bar does not hold both flex lines: %+v", label, surface)
		}
	}
	// The brand and actions own the native clearance through their actual
	// focus envelope; the spacer only implements it, so assert the geometry
	// rather than the spacer's internal width expression.
	for _, action := range surface.ActionButtons {
		if action.Label == "" || action.Right-action.Left <= 1 || action.Bottom-action.Top <= 1 {
			t.Fatalf("%s: action %q is missing or collapsed: %+v", label, action.Label, surface)
		}
		if action.Top < -titleBarGeometrySlop || action.Bottom > surface.BarHeight+titleBarGeometrySlop ||
			action.Right > surface.BarRight+titleBarGeometrySlop {
			t.Fatalf("%s: action %q escaped the brand bar: %+v", label, action.Label, surface)
		}
		if action.Left < surface.BrandRight-titleBarGeometrySlop {
			t.Fatalf("%s: action %q overlaps the brand: %+v", label, action.Label, surface)
		}
		// An action may sit level with the native controls only when its focus
		// ring is entirely to their right; otherwise both the button and its
		// 2px ring plus 2px offset need the vertical clearance.
		xClear := action.Left-titleBarFocusClearance >= surface.InsetLeft-titleBarGeometrySlop
		yClear := action.Top-titleBarFocusClearance >= surface.ControlsBottom-titleBarGeometrySlop
		if !xClear && !yClear {
			t.Fatalf("%s: action %q and its focus ring overlap the native controls: %+v", label, action.Label, surface)
		}
		if action.Bottom+titleBarFocusClearance > surface.BarHeight+titleBarGeometrySlop {
			t.Fatalf("%s: action %q focus ring escaped the brand bar: %+v", label, action.Label, surface)
		}
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
	if surface.LogoTop < surface.ControlsBottom+titleBarLogoClearance-titleBarGeometrySlop {
		t.Fatalf("%s: the settings logo is not under the native controls: %+v", label, surface)
	}
	if surface.LogoBottom > surface.BarHeight+titleBarGeometrySlop ||
		surface.LogoHeight > titleBarLogoMaxHeight+titleBarGeometrySlop {
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
	for index, target := range targets {
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
		if index == 0 && (target.Width < titleBarBrandHit-titleBarGeometrySlop ||
			target.Height < titleBarBrandHit-titleBarGeometrySlop) {
			t.Fatalf("%s: the brand icon link lost its 24px hit area: %+v", label, target)
		}
		if !target.CenterHit {
			t.Fatalf("%s: %q center hit %s", label, target.Label, target.Hit)
		}
	}
}

// TestNativeImmersiveTitleBarKeepsBrandInNarrowSidebar runs on its own and
// covers the default 272px same-row layout, a persisted 200px sidebar that
// must wrap its icon/action group below the native controls, and a 440px
// sidebar with room to stay on one line. Every reading is at the standard
// page scale in a real WKWebView.
func TestNativeImmersiveTitleBarKeepsBrandInNarrowSidebar(t *testing.T) {
	nativeWhiteboxSession(t, true)
	desktop := nativeWhitebox.desktop
	desktop.openMainWindow()
	win := desktop.mainWindow()
	t.Cleanup(win.Destroy)
	page := win.Page()
	if got := page.ZoomFactor(); got != 1 {
		t.Fatalf("the native main window did not start at 100%%: %v", got)
	}
	whiteboxWait(t, page, `location.pathname === "/conversations/new" && document.querySelector(".sidebar-brand-bar") !== null`)
	win.SetSize(1200, 800)
	whiteboxWait(t, page, `window.innerWidth > 767`)
	if _, err := page.Eval(`localStorage.setItem("linksense.sidebarWidth", "272")`); err != nil {
		t.Fatal(err)
	}
	whiteboxReload(t, page)
	waitTitleBarSidebarSettled(t, page, "#app-sidebar", "/conversations/new", titleBarDefaultSidebarWidth)
	waitTitleBarIcon(t, page)
	// The Mac workspace never requests the shared wordmark lockup; the small
	// packaged app icon is its only brand resource.
	lockups, err := mygo.EvalAs[[]string](page, `performance.getEntriesByType("resource")
		.map(entry => entry.name)
		.filter(name => name.includes("linksense-lockup"))`)
	if err != nil {
		t.Fatal(err)
	}
	if len(lockups) != 0 {
		t.Fatalf("the Mac workspace loaded a wordmark lockup: %v", lockups)
	}
	defaultBaseline := titleBarProbe(t, page)
	t.Logf("default sidebar: bar=%.2f controls=%.2f inset=%.2f brand=%.2f..%.2f top=%.2f bottom=%.2f icon=%.2fx%.2f actions=%.2f..%.2f top=%.2f",
		defaultBaseline.BarHeight, defaultBaseline.ControlsBottom, defaultBaseline.InsetLeft,
		defaultBaseline.BrandLeft, defaultBaseline.BrandRight, defaultBaseline.BrandTop, defaultBaseline.BrandBottom,
		defaultBaseline.BrandLogoWidth, defaultBaseline.BrandLogoHeight,
		defaultBaseline.ActionsLeft, defaultBaseline.ActionsLeft+defaultBaseline.ActionsWidth, defaultBaseline.ActionsTop)
	if defaultBaseline.InsetLeft <= 0 || defaultBaseline.ControlsBottom <= 0 {
		t.Fatalf("the default width did not report native control room: %+v", defaultBaseline)
	}
	assertTitleBarNativePosition(t, "default sidebar", defaultBaseline)
	if defaultBaseline.BrandTop-titleBarFocusClearance >= defaultBaseline.ControlsBottom-titleBarGeometrySlop {
		t.Fatalf("the default-width header wrapped instead of sharing one row: %+v", defaultBaseline)
	}
	if defaultBaseline.ActionsLeft <= defaultBaseline.BrandRight ||
		defaultBaseline.BrandLeft-titleBarFocusClearance < defaultBaseline.InsetLeft-titleBarGeometrySlop {
		t.Fatalf("the default-width brand is not the compact row beside and right of the traffic lights: %+v", defaultBaseline)
	}
	assertTitleBarDesktopSidebarLayout(t, "default sidebar", defaultBaseline, titleBarDefaultSidebarWidth)
	assertTitleBarFocusTargets(t, "default sidebar", page)

	if _, err := page.Eval(`localStorage.setItem("linksense.sidebarWidth", "200")`); err != nil {
		t.Fatal(err)
	}
	whiteboxReload(t, page)
	waitTitleBarSidebarSettled(t, page, "#app-sidebar", "/conversations/new", titleBarSidebarWidth)
	waitTitleBarIcon(t, page)
	narrow := titleBarProbe(t, page)
	t.Logf("narrow sidebar: bar=%.2f controls=%.2f brand top=%.2f actions top=%.2f", narrow.BarHeight, narrow.ControlsBottom, narrow.BrandTop, narrow.ActionsTop)
	if narrow.InsetLeft <= 0 || narrow.ControlsBottom <= 0 {
		t.Fatalf("the narrow sidebar did not report native control room: %+v", narrow)
	}
	if narrow.BrandTop-titleBarFocusClearance < narrow.ControlsBottom-titleBarGeometrySlop ||
		narrow.ActionsTop-titleBarFocusClearance < narrow.ControlsBottom-titleBarGeometrySlop {
		t.Fatalf("the narrow sidebar did not wrap the group below the traffic lights: %+v", narrow)
	}
	assertTitleBarDesktopSidebarLayout(t, "narrow sidebar", narrow, titleBarSidebarWidth)
	assertTitleBarFocusTargets(t, "narrow sidebar", page)

	if _, err := page.Eval(`localStorage.setItem("linksense.sidebarWidth", "440")`); err != nil {
		t.Fatal(err)
	}
	whiteboxReload(t, page)
	waitTitleBarSidebarSettled(t, page, "#app-sidebar", "/conversations/new", titleBarWideSidebarWidth)
	waitTitleBarIcon(t, page)
	wide := titleBarProbe(t, page)
	t.Logf("wide sidebar: bar=%.2f controls=%.2f inset=%.2f brand=%.2f..%.2f top=%.2f actions=%.2f..%.2f top=%.2f",
		wide.BarHeight, wide.ControlsBottom, wide.InsetLeft,
		wide.BrandLeft, wide.BrandRight, wide.BrandTop,
		wide.ActionsLeft, wide.ActionsLeft+wide.ActionsWidth, wide.ActionsTop)
	if wide.BrandTop-titleBarFocusClearance >= wide.ControlsBottom-titleBarGeometrySlop {
		t.Fatalf("the wide sidebar wrapped the group despite horizontal room: %+v", wide)
	}
	if wide.BrandLeft-titleBarFocusClearance < wide.InsetLeft-titleBarGeometrySlop {
		t.Fatalf("the wide sidebar brand focus envelope overlaps the native x-range: %+v", wide)
	}
	assertTitleBarDesktopSidebarLayout(t, "wide sidebar", wide, titleBarWideSidebarWidth)

	if _, err := page.Eval(`localStorage.removeItem("linksense.sidebarWidth")`); err != nil {
		t.Fatal(err)
	}
}

// TestNativeImmersiveTitleBarKeepsControlsAndTopAreaUsable covers the P1-09
// desktop visual acceptance: the page fills the frame, the native traffic
// lights stay, and every existing top-area control stays outside their room
// at the standard page scale, through real window resizes.
func TestNativeImmersiveTitleBarKeepsControlsAndTopAreaUsable(t *testing.T) {
	nativeWhiteboxSession(t, true)
	desktop := nativeWhitebox.desktop
	desktop.openMainWindow()
	win := desktop.mainWindow()
	t.Cleanup(win.Destroy)
	page := win.Page()
	if got := page.ZoomFactor(); got != 1 {
		t.Fatalf("the native main window did not start at 100%%: %v", got)
	}
	whiteboxWait(t, page, `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli")`)
	marker, err := page.Eval(`document.documentElement.dataset.desktopPlatform`)
	if err != nil || marker != "darwin" {
		t.Fatalf("the macOS host marker is missing at first render: %v", marker)
	}
	if _, err := page.Eval(`localStorage.setItem("linksense.sidebarWidth", "272")`); err != nil {
		t.Fatal(err)
	}
	whiteboxReload(t, page)
	waitTitleBarSidebarSettled(t, page, "#app-sidebar", "/conversations/new", titleBarDefaultSidebarWidth)
	waitTitleBarIcon(t, page)

	frame, content := win.Bounds(), win.ContentBounds()
	t.Logf("window frame=%+v page content=%+v", frame, content)
	if content.X != frame.X || content.Y != frame.Y ||
		content.Width != frame.Width || content.Height != frame.Height {
		t.Fatalf("the page must fill the hidden-title-bar window: frame=%+v content=%+v", frame, content)
	}

	surface := titleBarProbe(t, page)
	t.Logf("native surface: bar=%.2f controls=%.2f inset=%.2f brand=%.2f..%.2f actions=%.2f..%.2f",
		surface.BarHeight, surface.ControlsBottom, surface.InsetLeft,
		surface.BrandLeft, surface.BrandRight, surface.ActionsLeft, surface.ActionsLeft+surface.ActionsWidth)
	if surface.InsetLeft <= 0 || surface.ControlsBottom <= 0 || surface.TitleBarHeight <= 0 {
		t.Fatalf("MyGo did not report the native traffic lights: %+v", surface)
	}
	if surface.BrandBarRegion != "drag" {
		t.Fatalf("the sidebar brand is not a drag surface: %+v", surface)
	}
	assertTitleBarNativePosition(t, "native default-width", surface)
	if !surface.SidebarVisible || surface.BrandTop-titleBarFocusClearance >= surface.ControlsBottom-titleBarGeometrySlop {
		t.Fatalf("the default-width sidebar did not keep the compact same row: %+v", surface)
	}
	if surface.BrandRight > surface.ActionsLeft {
		t.Fatalf("sidebar brand content overlaps its actions: %+v", surface)
	}
	if surface.CollapseLeft < surface.InsetLeft {
		t.Fatalf("the sidebar collapse control is under the traffic lights: %+v", surface)
	}
	assertTitleBarDesktopSidebarLayout(t, "native default-width", surface, titleBarDefaultSidebarWidth)

	// Focusing the link must not move the content inside its ring buffer, and
	// both themes must keep the same icon and compact geometry.
	if _, err := page.Eval(`document.querySelector(".sidebar-brand-link")?.focus()`); err != nil {
		t.Fatal(err)
	}
	focused := titleBarProbe(t, page)
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
	whiteboxWait(t, page, `document.documentElement.classList.contains("dark")`)
	darkBrand := titleBarProbe(t, page)
	if darkBrand.BrandLogoCurrentSrc != surface.BrandLogoCurrentSrc ||
		math.Abs(darkBrand.BrandTop-surface.BrandTop) > 0.5 ||
		math.Abs(darkBrand.BrandLogoTop-surface.BrandLogoTop) > 0.5 ||
		math.Abs(darkBrand.BrandLogoHeight-surface.BrandLogoHeight) > 0.5 {
		t.Fatalf("dark mode changed the sidebar app icon or its geometry: %+v", darkBrand)
	}
	darkLockups, err := mygo.EvalAs[[]string](page, `performance.getEntriesByType("resource")
		.map(entry => entry.name)
		.filter(name => name.includes("linksense-lockup"))`)
	if err != nil {
		t.Fatal(err)
	}
	if len(darkLockups) != 0 {
		t.Fatalf("dark mode loaded a wordmark lockup for the Mac sidebar: %v", darkLockups)
	}
	if _, err := page.Eval(`document.documentElement.dataset.theme = "light"; document.documentElement.classList.remove("dark")`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `!document.documentElement.classList.contains("dark")`)

	// A management page shows the shared PageTopBar in the same top area.
	if err := page.LoadURL("/capabilities"); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `location.pathname === "/capabilities" && document.querySelector("[data-slot='page-top-bar']") !== null`)
	management := titleBarProbe(t, page)
	if management.TopBarRegion != "drag" || management.TopBarPadding < 27 {
		t.Fatalf("the shared page top bar is not an inset-free drag surface: %+v", management)
	}

	// The added Mac rules must be inert without the darwin marker. Host
	// detection stays Mac in this WebView, so only the CSS layout and drag
	// marker are expected to fall back; the plain Web sidebar test covers the
	// shared wordmark baseline.
	setDesktopMarker(t, page, "windows")
	windowsExpanded := titleBarProbe(t, page)
	setDesktopMarker(t, page, "")
	plainExpanded := titleBarProbe(t, page)
	if windowsExpanded.TopBarRegion != "" || plainExpanded.TopBarRegion != "" ||
		math.Abs(windowsExpanded.BrandTop-plainExpanded.BrandTop) > 0.5 {
		t.Fatalf("a non-darwin marker activated the macOS title-bar rules: %+v / %+v", windowsExpanded, plainExpanded)
	}
	setDesktopMarker(t, page, "darwin")
	darwinExpanded := titleBarProbe(t, page)
	if darwinExpanded.TopBarRegion != "drag" ||
		darwinExpanded.BrandLeft-titleBarFocusClearance < darwinExpanded.InsetLeft-titleBarGeometrySlop {
		t.Fatalf("the darwin marker did not restore the compact macOS title-bar layout: %+v", darwinExpanded)
	}
	assertTitleBarDesktopSidebarLayout(t, "darwin-restored", darwinExpanded, titleBarDefaultSidebarWidth)

	if _, err := page.Eval(`document.querySelector(".sidebar-collapse-control").click()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.querySelector(".app-shell")?.dataset.sidebarCollapsed === "true"`)
	whiteboxWait(t, page, `(document.querySelector(".app-shell")?.getAnimations() ?? []).every(animation => animation.playState === "finished")`)
	collapsed := titleBarProbe(t, page)
	if collapsed.TriggerDisplay == "none" || collapsed.TriggerLeft < collapsed.InsetLeft {
		t.Fatalf("the restore control is not reachable beside the traffic lights: %+v", collapsed)
	}
	if collapsed.TopBarPadding < 52+collapsed.InsetLeft-1 {
		t.Fatalf("the collapsed top bar does not reserve the native inset: %+v", collapsed)
	}

	setDesktopMarker(t, page, "windows")
	windowsCollapsed := titleBarProbe(t, page)
	setDesktopMarker(t, page, "")
	plainCollapsed := titleBarProbe(t, page)
	if windowsCollapsed.TopBarRegion != "" ||
		math.Abs(windowsCollapsed.TopBarPadding-52) > 0.6 ||
		math.Abs(windowsCollapsed.TriggerLeft-10) > 0.6 {
		t.Fatalf("the Windows marker changed the collapsed top area: %+v", windowsCollapsed)
	}
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
	setDesktopMarker(t, page, "")
	plainMobile := titleBarProbe(t, page)
	if windowsMobile.TopBarRegion != "" ||
		math.Abs(windowsMobile.TopBarPadding-56) > 0.6 ||
		math.Abs(windowsMobile.TriggerLeft-10) > 0.6 {
		t.Fatalf("the Windows marker changed the mobile top area: %+v", windowsMobile)
	}
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
	whiteboxWait(t, page, `(() => {
		const logo = document.querySelector(".mobile-navigation-sheet .sidebar-brand-link img")
		return !!logo && logo.complete && logo.naturalWidth > 0 && logo.naturalHeight > 0
	})()`)
	sheet := titleBarProbe(t, page)
	if sheet.BrandTop >= 0 && (sheet.BrandTop < sheet.ControlsBottom+titleBarFocusClearance-0.5 ||
		sheet.BrandLogoTop < sheet.ControlsBottom+titleBarLogoClearance-0.5 ||
		sheet.BrandRight > sheet.ActionsLeft ||
		sheet.BrandRight-sheet.BrandLeft < titleBarBrandHit-titleBarGeometrySlop ||
		sheet.BrandBottom-sheet.BrandTop < titleBarBrandHit-titleBarGeometrySlop ||
		sheet.BrandLogoAlt == "" ||
		sheet.BrandLogoHeight > titleBarLogoMaxHeight+0.5 ||
		math.Abs(sheet.BrandLogoWidth/sheet.BrandLogoHeight-1) > 0.05 ||
		!strings.HasSuffix(sheet.BrandLogoCurrentSrc, "/linksense-appicon.svg")) {
		t.Fatalf("mobile navigation content is under the traffic lights or lost its app icon: %+v", sheet)
	}
	if !sheet.MobileCloseVisible || sheet.MobileCloseWidth <= 1 || sheet.MobileCloseHeight <= 1 ||
		sheet.MobileCloseLeft < sheet.InsetLeft+titleBarFocusClearance-titleBarGeometrySlop {
		t.Fatalf("the mobile navigation close control lost its clearance: %+v", sheet)
	}
	if _, err := page.Eval(`document.querySelector(".mobile-navigation-close")?.click()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.querySelector(".mobile-navigation-sheet") === null || document.querySelector(".mobile-navigation-sheet")?.getClientRects().length === 0`)

	win.SetSize(1200, 800)
	whiteboxWait(t, page, `window.innerWidth > 767`)

	// A user-narrowed sidebar must still keep its brand and actions apart.
	if _, err := page.Eval(`localStorage.setItem("linksense.sidebarWidth", "200")`); err != nil {
		t.Fatal(err)
	}
	whiteboxReload(t, page)
	waitTitleBarSidebarSettled(t, page, "#app-sidebar", "/capabilities", titleBarSidebarWidth)
	waitTitleBarIcon(t, page)
	narrow := titleBarProbe(t, page)
	if narrow.TopBarRegion != "drag" || narrow.ActionsLeft < narrow.InsetLeft {
		t.Fatalf("the narrow sidebar top area is not usable: %+v", narrow)
	}
	if narrow.BrandTop-titleBarFocusClearance < narrow.ControlsBottom-titleBarGeometrySlop ||
		narrow.ActionsTop-titleBarFocusClearance < narrow.ControlsBottom-titleBarGeometrySlop {
		t.Fatalf("the narrow sidebar group did not wrap below the traffic lights: %+v", narrow)
	}
	if narrow.BrandLogoWidth > 0 && narrow.BrandLogoHeight > 0 &&
		math.Abs(narrow.BrandLogoWidth/narrow.BrandLogoHeight-1) > 0.05 {
		t.Fatalf("the narrow sidebar app icon is distorted: %+v", narrow)
	}
	assertTitleBarDesktopSidebarLayout(t, "narrow sidebar capabilities", narrow, titleBarSidebarWidth)
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
	t.Logf("full-screen bar=%.2f brand left=%.2f actions=%.2f..%.2f", fullscreen.BarHeight, fullscreen.BrandLeft, fullscreen.ActionsLeft, fullscreen.ActionsLeft+fullscreen.ActionsWidth)
	if fullscreen.InsetLeft != 0 || fullscreen.ControlsBottom != 0 || fullscreen.TitleBarHeight != 0 {
		t.Fatalf("full screen retained phantom native control room: %+v", fullscreen)
	}
	if fullscreen.TopBarPadding < 27 || fullscreen.TopBarPadding > 29 {
		t.Fatalf("full screen retained phantom top-bar padding: %+v", fullscreen)
	}
	if math.Abs(fullscreen.BrandLeft-titleBarBrandInset) > 1 {
		t.Fatalf("full screen retained a phantom native-controls lane: %+v", fullscreen)
	}
	assertTitleBarDesktopSidebarLayout(t, "full screen", fullscreen, narrow.SidebarWidth)
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
	waitTitleBarSidebarSettled(t, page, ".settings-sidebar", "/settings/general", titleBarSettingsSidebarWidth)
	settings := titleBarProbe(t, page)
	if settings.HeaderRegion != "drag" {
		t.Fatalf("settings navigation is not a drag surface: %+v", settings)
	}
	assertTitleBarSettingsLayout(t, "settings", settings)

	setDesktopMarker(t, page, "windows")
	windowsSettingsDesktop := titleBarProbe(t, page)
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
	if !mobileSettings.MobileHeader || mobileSettings.MobileHeaderPad < 10+mobileSettings.InsetLeft-1 ||
		mobileSettings.MobileHeaderLeft < mobileSettings.InsetLeft+9 {
		t.Fatalf("the settings mobile header is under the traffic lights: %+v", mobileSettings)
	}

	setDesktopMarker(t, page, "windows")
	windowsSettingsMobile := titleBarProbe(t, page)
	setDesktopMarker(t, page, "")
	plainSettingsMobile := titleBarProbe(t, page)
	if math.Abs(windowsSettingsMobile.MobileHeaderPad-10) > 0.6 ||
		math.Abs(windowsSettingsMobile.MobileHeaderLeft-10) > 0.6 {
		t.Fatalf("the Windows marker changed the settings mobile header: %+v", windowsSettingsMobile)
	}
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
	if auth.AuthRegion != "drag" || auth.AuthChildRegion != "no-drag" || auth.AuthTopRowRegion != "drag" {
		t.Fatalf("the signed-out layout does not keep an unused drag surface: %+v", auth)
	}
	if auth.AuthButtonLeft < auth.InsetLeft {
		t.Fatalf("the language control is under the traffic lights: %+v", auth)
	}

	setDesktopMarker(t, page, "windows")
	windowsAuth := titleBarProbe(t, page)
	setDesktopMarker(t, page, "")
	plainAuth := titleBarProbe(t, page)
	if windowsAuth.AuthRegion != "" || windowsAuth.AuthChildRegion != "" || windowsAuth.AuthTopRowRegion != "" {
		t.Fatalf("the Windows marker activated the signed-out drag surfaces: %+v", windowsAuth)
	}
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
	if failure.FailureRegion != "drag" || failure.FailureChild != "no-drag" {
		t.Fatalf("the route failure screen does not keep an unused drag surface: %+v", failure)
	}

	setDesktopMarker(t, page, "windows")
	windowsFailure := titleBarProbe(t, page)
	setDesktopMarker(t, page, "")
	plainFailure := titleBarProbe(t, page)
	if windowsFailure.FailureRegion != "" || windowsFailure.FailureChild != "" {
		t.Fatalf("the Windows marker activated the route-failure drag surface: %+v", windowsFailure)
	}
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
