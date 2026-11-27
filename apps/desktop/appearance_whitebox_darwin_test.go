//go:build desktop_whitebox

package main

import (
	"testing"

	"github.com/egoist/mygo"
)

type appearanceUiSurface struct {
	CSSFontSize    string `json:"cssFontSize"`
	InlineFontSize string `json:"inlineFontSize"`
	DataFontSize   string `json:"dataFontSize"`
	StoredFontSize string `json:"storedFontSize"`
	FontControl    bool   `json:"fontControl"`
	FontPreview    bool   `json:"fontPreview"`
	FontCards      int    `json:"fontCards"`
	FontCopy       bool   `json:"fontCopy"`
	SampleCopy     bool   `json:"sampleCopy"`
}

const appearanceUiProbe = `(() => ({
	cssFontSize: getComputedStyle(document.documentElement).getPropertyValue("--app-ui-font-size").trim(),
	inlineFontSize: document.documentElement.style.getPropertyValue("--app-ui-font-size").trim(),
	dataFontSize: document.documentElement.dataset.uiFontSize || "",
	storedFontSize: localStorage.getItem("linksense.uiFontSize") || "",
	fontControl: document.querySelector("#appearance-font-size") !== null,
	fontPreview: document.querySelector(".appearance-font-size-control") !== null,
	fontCards: document.querySelectorAll('[data-slot="settings-card"]').length,
	fontCopy: document.body.innerText.includes("UI font size"),
	sampleCopy: document.body.innerText.includes("Your AI partner for knowledge, analysis, and everyday work.")
}))()`

func appearanceSurface(t *testing.T, page *mygo.Page) appearanceUiSurface {
	t.Helper()
	surface, err := mygo.EvalAs[appearanceUiSurface](page, appearanceUiProbe)
	if err != nil {
		t.Fatal(err)
	}
	return surface
}

func assertFixedAppearanceFontSize(t *testing.T, label string, surface appearanceUiSurface) {
	t.Helper()
	if surface.CSSFontSize != "14px" || surface.InlineFontSize != "14px" || surface.DataFontSize != "14" {
		t.Fatalf("%s did not keep the fixed 14px UI font: %+v", label, surface)
	}
	if surface.StoredFontSize != "18" {
		t.Fatalf("%s rewrote the stored font size: %+v", label, surface)
	}
}

// TestNativeAppearanceKeepsMacUiFontSizeFixed seeds the old persisted size,
// reloads the real WKWebView, and checks the document-start initialization plus
// the theme-only Settings page. It does not resize the native window.
func TestNativeAppearanceKeepsMacUiFontSizeFixed(t *testing.T) {
	nativeWhiteboxSession(t, true)
	desktop := nativeWhitebox.desktop
	desktop.openMainWindow()
	win := desktop.mainWindow()
	if win == nil {
		t.Fatal("the main window did not open")
	}
	t.Cleanup(win.Destroy)
	page := win.Page()
	if got := page.ZoomFactor(); got != 1 {
		t.Fatalf("the native main window did not start at 100%%: %v", got)
	}
	whiteboxWait(t, page, `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli")`)
	if _, err := page.Eval(`localStorage.setItem("linksense.uiFontSize", "18"); localStorage.setItem("linksense.language", "en-US")`); err != nil {
		t.Fatal(err)
	}
	whiteboxReload(t, page)
	whiteboxWait(t, page, `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli")`)
	assertFixedAppearanceFontSize(t, "the reloaded Mac app", appearanceSurface(t, page))

	if err := page.LoadURL("/settings/general"); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `location.pathname === "/settings/general" && document.querySelector('.settings-navigation-link[href="/settings/appearance"]') !== null`)
	if _, err := page.Eval(`document.querySelector('.settings-navigation-link[href="/settings/appearance"]')?.click()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `location.pathname === "/settings/appearance" && document.querySelector('[role="radiogroup"]') !== null`)
	surface := appearanceSurface(t, page)
	assertFixedAppearanceFontSize(t, "Mac Appearance", surface)
	if surface.FontControl || surface.FontPreview || surface.FontCards != 0 || surface.FontCopy || surface.SampleCopy {
		t.Fatalf("Mac Appearance retained the font-size control or copy: %+v", surface)
	}

	if _, err := page.Eval(`document.querySelector('label[for="appearance-theme-dark"]')?.click()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.documentElement.dataset.themePreference === "dark"`)
	assertFixedAppearanceFontSize(t, "Mac Appearance in dark", appearanceSurface(t, page))

	if _, err := page.Eval(`document.querySelector('label[for="appearance-theme-light"]')?.click()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.documentElement.dataset.themePreference === "light"`)
	assertFixedAppearanceFontSize(t, "Mac Appearance in light", appearanceSurface(t, page))
}
