package main

import (
	"encoding/json"
	"image"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
	"github.com/egoist/mygo/transfer"
	"github.com/egoist/mygo/ui"
)

var languages = []string{"zh-CN", "en-US", "es-ES", "pt-BR", "fr-FR", "ja-JP"}

func TestHelperNameMatchesBundleAndAllLocales(t *testing.T) {
	data, err := os.ReadFile("mygo.json")
	if err != nil {
		t.Fatal(err)
	}
	var config struct{ Name, Identifier string }
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatal(err)
	}
	if config.Name != "LinkSense helper" || config.Identifier != "org.linksense.desktop" {
		t.Fatal("helper must use the new display name without changing its installed identity")
	}
	for _, language := range languages {
		if locales.In(language).AppTitle() != config.Name {
			t.Fatalf("%s uses a different application name", language)
		}
	}
}

func TestSettingsIconIsCenteredAndOpensSettings(t *testing.T) {
	for _, size := range [][2]int{{400, 480}, {480, 570}, {720, 900}} {
		for _, dark := range []bool{false, true} {
			a := newDesktopApp(false, "Test computer")
			tt := ui.NewTester(a.view, size[0], size[1])
			tt.SetDark(dark)
			tt.SetScale(2)
			if !tt.HasText(locales.In(a.language).AppTitle()) {
				t.Fatal("title bar must show the current application name")
			}
			bounds, found := tt.Find(locales.In(a.language).Settings())
			if !found {
				t.Fatal("settings button is missing")
			}
			picture := tt.Image()
			ink := image.Rectangle{}
			for y := int((bounds.Y + 3) * 2); y < int((bounds.Y+bounds.H-3)*2); y++ {
				for x := int((bounds.X + 3) * 2); x < int((bounds.X+bounds.W-3)*2); x++ {
					pixel := picture.RGBAAt(x, y)
					brightness := int(pixel.R) + int(pixel.G) + int(pixel.B)
					if !dark && brightness < 400 || dark && brightness > 600 {
						ink = ink.Union(image.Rect(x, y, x+1, y+1))
					}
				}
			}
			if ink.Empty() || math.Abs(float64(ink.Min.X+ink.Max.X)/2-float64((bounds.X+bounds.W/2)*2)) > 1 ||
				math.Abs(float64(ink.Min.Y+ink.Max.Y)/2-float64((bounds.Y+bounds.H/2)*2)) > 1 {
				t.Fatalf("%v dark=%v: settings icon %v is off-center in %v", size, dark, ink, bounds)
			}
			if err := tt.Click(locales.In(a.language).Settings()); err != nil || !a.settings {
				t.Fatal("centered settings control must still open settings")
			}
		}
	}
}

func TestNativeClientKeepsDeviceControlsWithoutPromotionalCopy(t *testing.T) {
	a := newDesktopApp(false, "Test computer")
	tt := ui.NewTester(a.view, 480, 570)
	for _, slogan := range []string{
		"让任务走出浏览器。",
		"连接这台电脑，让 LinkSense 在你的授权下协助操作。",
		"始终由你掌控",
		"每次任务单独授权，可从本机随时暂停。不读取未授权内容。",
		"轻量连接，安心协作",
	} {
		if tt.HasText(slogan) {
			t.Fatalf("promotional copy remains visible: %q", slogan)
		}
	}
	l := locales.In(a.language)
	labels := []string{l.Connect(), l.DeviceLabel(), l.WorkspaceLabel(), l.DesktopAccess()}
	if a.platform == "darwin" {
		labels = []string{l.Connect(), l.DeviceLabel(), l.WorkspaceLabel(), l.Accessibility(), l.ScreenCapture()}
	}
	for _, label := range labels {
		if !tt.HasText(label) {
			t.Fatalf("required device control is missing: %q", label)
		}
	}
}

func TestPermissionControlsMatchThePlatformInAllLocales(t *testing.T) {
	for _, language := range languages {
		for _, platform := range []string{"darwin", "windows"} {
			a := newDesktopApp(false, "Test computer")
			a.language, a.platform = language, platform
			tt := ui.NewTester(a.view, 480, 570)
			l := locales.In(language)
			if tt.HasText(l.Accessibility()) != (platform == "darwin") ||
				tt.HasText(l.ScreenCapture()) != (platform == "darwin") ||
				tt.HasText(l.DesktopAccess()) != (platform == "windows") {
				t.Fatalf("%s on %s shows the wrong permission controls", language, platform)
			}
		}
	}
}

func TestPermissionDragPanelOffersThePackagedApp(t *testing.T) {
	bundle := filepath.Join(t.TempDir(), "LinkSense helper.app")
	if err := os.MkdirAll(bundle, 0o755); err != nil {
		t.Fatal(err)
	}
	data, err := transfer.FileData(bundle)
	if err != nil {
		t.Fatal(err)
	}
	a := newDesktopApp(false, "Test computer")
	tt := ui.NewTester(func(c *ui.Context) {
		a.permissionDragView(c, func() {}, data)
	}, 280, 190)
	l := locales.In(a.language)
	if !tt.HasText(l.AppTitle()) || !tt.HasText(l.DragToSettings()) {
		t.Fatal("screen recording panel does not expose the draggable app")
	}
	if directory := os.Getenv("LINKSENSE_DESKTOP_SCREENSHOTS"); directory != "" {
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal(err)
		}
		file, err := os.Create(filepath.Join(directory, "permission-drag.png"))
		if err != nil {
			t.Fatal(err)
		}
		encodeErr := png.Encode(file, tt.Image())
		closeErr := file.Close()
		if encodeErr != nil || closeErr != nil {
			t.Fatalf("save permission drag panel: %v %v", encodeErr, closeErr)
		}
	}
}

func TestPermissionDragPanelCanBeClosedWithKeyboard(t *testing.T) {
	for _, escape := range []bool{false, true} {
		a := newDesktopApp(false, "Test computer")
		closed := false
		tt := ui.NewTester(func(c *ui.Context) {
			a.permissionDragView(c, func() { closed = true }, transfer.Data{})
		}, 280, 190)
		if escape {
			tt.Key(0, ui.KeyEscape)
		} else {
			tt.Key(0, ui.KeyTab)
			tt.Key(0, ui.KeySpace)
		}
		if !closed {
			t.Fatalf("keyboard cannot close the permission panel (Escape=%v)", escape)
		}
	}
}

func TestTranslationsCoverEverySupportedLocale(t *testing.T) {
	var source map[string]json.RawMessage
	for _, language := range languages {
		data, err := os.ReadFile(filepath.Join("locales", language+".json"))
		if err != nil {
			t.Fatal(err)
		}
		var catalog map[string]json.RawMessage
		if err := json.Unmarshal(data, &catalog); err != nil {
			t.Fatal(err)
		}
		if source == nil {
			source = catalog
		}
		if len(catalog) != len(source) {
			t.Fatalf("%s: translation key count differs", language)
		}
		for key := range source {
			var value string
			if err := json.Unmarshal(catalog[key], &value); err != nil || value == "" {
				t.Fatalf("%s: missing translation %q", language, key)
			}
		}
	}
}

func TestNativePreviewPausesWithoutDesktopActionsInAllLocales(t *testing.T) {
	for _, language := range languages {
		t.Run(language, func(t *testing.T) {
			a := newDesktopApp(true, "Test computer")
			a.language, a.state = language, running
			l := locales.In(language)
			tt := ui.NewTester(a.view, 560, 840)
			if !tt.HasText(l.PreviewDescription()) {
				t.Fatal("preview must clearly disclose that no real computer is controlled")
			}
			if err := tt.Click(l.Stop()); err != nil {
				t.Fatal(err)
			}
			tt.Advance(time.Second)
			if a.state != paused || !tt.HasText(l.StatePaused()) {
				t.Fatal("pause did not update the visible state")
			}
			if tt.FramePending() {
				t.Fatal("an idle client must not keep scheduling animation frames")
			}
		})
	}
}

func TestWorkspaceDialogValidatesOriginAndPreservesDisconnectedState(t *testing.T) {
	a := newDesktopApp(false, "Test computer")
	l := locales.In(a.language)
	tt := ui.NewTester(a.view, 560, 840)
	if err := tt.Click(l.Connect()); err != nil {
		t.Fatal(err)
	}
	if !tt.HasText(l.SetupTitle()) {
		t.Fatal("workspace dialog did not open")
	}
	if err := tt.Click(l.OpenBrowser()); err != nil {
		t.Fatal(err)
	}
	if a.state != disconnected || !tt.HasText(l.InvalidURL()) {
		t.Fatal("invalid URL must show feedback without pairing")
	}
	tt.Key(0, ui.KeyEscape)
	if a.pairing {
		t.Fatal("Escape must dismiss the dialog")
	}
}

func TestNativeClientSizesThemesAndReducedMotion(t *testing.T) {
	for _, size := range [][2]int{{400, 480}, {480, 570}, {720, 900}} {
		for _, dark := range []bool{false, true} {
			a := newDesktopApp(false, "Test computer")
			tt := ui.NewTester(a.view, size[0], size[1])
			tt.SetDark(dark)
			tt.SetPreferences(ui.Preferences{ReduceMotion: true})
			l := locales.In(a.language)
			for _, label := range []string{l.Connect(), l.Settings()} {
				box, found := tt.Find(label)
				if !found || box.X < 0 || box.Y < 0 ||
					box.X+box.W > float32(size[0])+1 || box.Y+box.H > float32(size[1])+1 {
					t.Fatalf("%v dark=%v: action %q is outside the window", size, dark, label)
				}
			}
		}
	}
}

func TestBackgroundPermissionCheckRefreshesVisibleControls(t *testing.T) {
	a := newDesktopApp(false, "Test computer")
	engine := &fakeDesktopEngine{}
	bridge := &desktopBridge{engine: engine}
	a.bridge = bridge
	updates := make(chan func(), 4)
	a.post = func(fn func()) { updates <- fn }
	bridge.onPermission = func(permissions permissionState) {
		a.update(func() { a.permissions = permissions })
	}
	l := locales.In(a.language)
	tt := ui.NewTester(a.view, 480, 570)
	a.checkPermissions()
	for range 2 {
		select {
		case fn := <-updates:
			fn()
		case <-time.After(time.Second):
			t.Fatal("permission result did not return to the UI")
		}
	}
	tt.Advance(time.Second)
	if a.busy || a.permissions.Accessibility != "granted" {
		t.Fatal("permission check did not clear its busy state")
	}
	if err := tt.Click(l.Connect()); err != nil || !a.pairing {
		t.Fatal("permission check left the connection control disabled")
	}
}

func TestLocalPauseRemainsAvailableDuringBackgroundWork(t *testing.T) {
	a := newDesktopApp(false, "Test computer")
	a.state, a.busy = connected, true
	engine := &fakeDesktopEngine{}
	a.bridge = &desktopBridge{engine: engine, generation: 1}
	tt := ui.NewTester(a.view, 480, 570)
	if err := tt.Click(locales.In(a.language).Stop()); err != nil {
		t.Fatal(err)
	}
	a.bridge.mu.Lock()
	paused := a.bridge.paused
	a.bridge.mu.Unlock()
	if !paused || engine.stops.Load() != 1 {
		t.Fatal("background work disabled the local emergency pause")
	}
}

func TestRenderReviewScreens(t *testing.T) {
	directory := os.Getenv("LINKSENSE_DESKTOP_SCREENSHOTS")
	if directory == "" {
		return
	}
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		name  string
		state connectionState
		dark  bool
	}{
		{"disconnected", disconnected, false},
		{"connected", connected, false},
		{"running", running, false},
		{"paused", paused, false},
		{"dark", connected, true},
	} {
		a := newDesktopApp(item.state != disconnected, "My Mac")
		a.state = item.state
		height := 570
		if a.preview {
			height = 620
		}
		tt := ui.NewTester(a.view, 480, height)
		tt.SetDark(item.dark)
		tt.Advance(time.Second)
		file, err := os.Create(filepath.Join(directory, item.name+".png"))
		if err != nil {
			t.Fatal(err)
		}
		err = png.Encode(file, tt.Image())
		closeErr := file.Close()
		if err != nil || closeErr != nil {
			t.Fatalf("save review screen: %v %v", err, closeErr)
		}
	}
}
