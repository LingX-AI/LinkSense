//go:build desktop_whitebox

package main

import (
	"math"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

type titleBarSurface struct {
	InsetLeft        float64 `json:"insetLeft"`
	InsetRight       float64 `json:"insetRight"`
	ControlsBottom   float64 `json:"controlsBottom"`
	TitleBarHeight   float64 `json:"titleBarHeight"`
	ViewportWidth    float64 `json:"viewportWidth"`
	SidebarVisible   bool    `json:"sidebarVisible"`
	BrandBarRegion   string  `json:"brandBarRegion"`
	BrandLeft        float64 `json:"brandLeft"`
	BrandTop         float64 `json:"brandTop"`
	BrandRight       float64 `json:"brandRight"`
	BrandLogoWidth   float64 `json:"brandLogoWidth"`
	BrandLogoHeight  float64 `json:"brandLogoHeight"`
	BarHeight        float64 `json:"barHeight"`
	ActionsLeft      float64 `json:"actionsLeft"`
	ActionsWidth     float64 `json:"actionsWidth"`
	TopBarRegion     string  `json:"topBarRegion"`
	TopBarPadding    float64 `json:"topBarPadding"`
	TriggerDisplay   string  `json:"triggerDisplay"`
	TriggerLeft      float64 `json:"triggerLeft"`
	TriggerTop       float64 `json:"triggerTop"`
	CollapseLeft     float64 `json:"collapseLeft"`
	CollapseTop      float64 `json:"collapseTop"`
	CollapseBottom   float64 `json:"collapseBottom"`
	HeaderPadding    float64 `json:"headerPadding"`
	HeaderRegion     string  `json:"headerRegion"`
	LogoLeft         float64 `json:"logoLeft"`
	LogoTop          float64 `json:"logoTop"`
	AuthRegion       string  `json:"authRegion"`
	AuthChildRegion  string  `json:"authChildRegion"`
	AuthTopRowRegion string  `json:"authTopRowRegion"`
	AuthButtonLeft   float64 `json:"authButtonLeft"`
	AuthButtonTop    float64 `json:"authButtonTop"`
	AuthButtonRight  float64 `json:"authButtonRight"`
	FailureRegion    string  `json:"failureRegion"`
	FailureChild     string  `json:"failureChildRegion"`
	MobileHeader     bool    `json:"mobileHeaderVisible"`
	MobileHeaderPad  float64 `json:"mobileHeaderPadding"`
	MobileHeaderLeft float64 `json:"mobileHeaderLeft"`
}

// nativeTitleBarProbe reads the native control room MyGo reported and the
// geometry of the surfaces that consume it. It does not trigger a drag.
const nativeTitleBarProbe = `(() => {
	const root = getComputedStyle(document.documentElement)
	const px = name => parseFloat(root.getPropertyValue(name)) || 0
	const region = element => element ? getComputedStyle(element).getPropertyValue("--app-region").trim() : ""
	const box = element => element ? element.getBoundingClientRect() : null
	const visible = element => !!element && getComputedStyle(element).display !== "none" && element.getClientRects().length > 0
	const bar = Array.from(document.querySelectorAll(".sidebar-brand-bar")).find(visible) ?? document.querySelector(".sidebar-brand-bar")
	const brand = bar?.querySelector(".sidebar-brand-link")
	const brandLogo = brand?.querySelector("img")
	const actions = bar?.querySelector(".sidebar-header-actions")
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
	const br = box(brand), bl = box(brandLogo), bb = box(bar), ar = box(actions), cr = box(collapse), lr = box(logo), tr = box(trigger), ab = box(authButton), mh = box(mobileHeaderLink)
	return {
		insetLeft: px("--mygo-titlebar-inset-left"),
		insetRight: px("--mygo-titlebar-inset-right"),
		controlsBottom: px("--mygo-titlebar-controls-bottom"),
		titleBarHeight: px("--mygo-titlebar-height"),
		viewportWidth: innerWidth,
		sidebarVisible: visible(document.querySelector("#app-sidebar")),
		brandBarRegion: region(bar),
		brandLeft: br ? br.left : -1,
		brandTop: br ? br.top : -1,
		brandRight: br ? br.right : -1,
		brandLogoWidth: bl ? bl.width : -1,
		brandLogoHeight: bl ? bl.height : -1,
		barHeight: bb ? bb.height : -1,
		actionsLeft: ar ? ar.left : -1,
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
	if !surface.SidebarVisible || surface.BrandTop < surface.ControlsBottom {
		t.Fatalf("sidebar brand content is not clear of the traffic lights: %+v", surface)
	}
	if surface.BrandRight > surface.ActionsLeft {
		t.Fatalf("sidebar brand content overlaps its actions: %+v", surface)
	}
	if surface.BrandLogoWidth > 0 && surface.BrandLogoHeight > 0 &&
		math.Abs(surface.BrandLogoWidth/surface.BrandLogoHeight-348.0/94.0) > 0.12 {
		t.Fatalf("the squeezed sidebar lockup lost its aspect ratio: %+v", surface)
	}
	if surface.CollapseLeft < surface.InsetLeft {
		t.Fatalf("the sidebar collapse control is under the traffic lights: %+v", surface)
	}

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
		darwinExpanded.ControlsBottom > plainExpanded.BrandTop &&
			darwinExpanded.BrandTop < darwinExpanded.ControlsBottom-0.5 {
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
	if sheet.BrandTop >= 0 && sheet.BrandTop < sheet.ControlsBottom ||
		sheet.BrandRight > sheet.ActionsLeft {
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

	// Smaller page zoom makes the reported native controls taller. The brand
	// must stay inside the remaining header height, then recover at 100%.
	page.SetZoomFactor(0.5)
	whiteboxWait(t, page, `window.innerWidth > 2000 && (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mygo-titlebar-controls-bottom")) || 0) > 40`)
	large := titleBarProbe(t, page)
	t.Logf("large native-controls surface=%+v", large)
	if !large.SidebarVisible ||
		large.BrandTop < large.ControlsBottom-0.5 ||
		large.BrandTop+large.BrandLogoHeight > large.BarHeight+0.5 ||
		large.BrandRight > large.ActionsLeft {
		t.Fatalf("the brand escaped the safe header height under large native controls: %+v", large)
	}
	page.SetZoomFactor(1)
	whiteboxWait(t, page, `window.innerWidth > 767 && (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mygo-titlebar-controls-bottom")) || 0) < 30`)
	recovered := titleBarProbe(t, page)
	t.Logf("recovered surface=%+v", recovered)
	if math.Abs(recovered.BrandTop-surface.BrandTop) > 1 ||
		math.Abs(recovered.BrandLogoHeight-24) > 0.5 {
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
	if narrow.BrandTop >= 0 && (narrow.BrandTop < narrow.ControlsBottom || narrow.BrandRight > narrow.ActionsLeft) {
		t.Fatalf("the narrow sidebar brand collides with the traffic lights or its actions: %+v", narrow)
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
	if math.Abs(fullscreen.BrandTop-(fullscreen.BarHeight-fullscreen.BrandLogoHeight)/2) > 1 {
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
	if settings.LogoTop < settings.ControlsBottom {
		t.Fatalf("settings branding is under the traffic lights: %+v", settings)
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
		restoredSettingsDesktop.ControlsBottom > plainSettingsDesktop.LogoTop &&
			restoredSettingsDesktop.LogoTop < restoredSettingsDesktop.ControlsBottom-0.5 {
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
