//go:build desktop_whitebox

package main

// One child moves the production main window and closes it normally; a fresh
// child with the same private user-data directory must reopen at that readback.
// Another fresh child seeds a saved rectangle beyond every connected display's
// current work area through MyGo's public WindowStateStore and must reopen with
// a point in its top area on a connected display at the saved size. Those saved
// bounds only simulate a window state left by a display that is no longer
// connected; they do not prove a display was actually removed. The saved
// state-file layout is never inspected.

import (
	"context"
	"encoding/json"
	"fmt"
	"image"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

const (
	macWindowStatePhaseEnv  = "LINKSENSE_TEST_MAC_WINDOW_STATE_PHASE"
	macWindowStateDirEnv    = "LINKSENSE_TEST_MAC_WINDOW_STATE_DIR"
	macWindowStateReceipt   = "mac-window-geometry.json"
	macWindowStateWrite     = "write"
	macWindowStateRead      = "read"
	macWindowStateOffscreen = "offscreen"
)

func TestNativeMacMainWindowGeometrySurvivesRelaunch(t *testing.T) {
	if phase := os.Getenv(macWindowStatePhaseEnv); phase != "" {
		macWindowStateLaunch(t, phase, os.Getenv(macWindowStateDirEnv))
		return
	}

	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	run := func(phase, dir string) {
		t.Helper()
		ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, binary, "-test.v", "-test.run=^"+t.Name()+"$")
		cmd.Env = append(os.Environ(), macWindowStatePhaseEnv+"="+phase, macWindowStateDirEnv+"="+dir)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("window state child %s: %v\n%s", phase, err, out)
		}
	}
	persisted := t.TempDir()
	run(macWindowStateWrite, persisted)
	run(macWindowStateRead, persisted)
	// A separate user-data directory proves the seeded store, not a leftover
	// window-state.json, is what this relaunch restores.
	run(macWindowStateOffscreen, t.TempDir())
}

// macWindowStateLaunch opens the production main window in the private
// user-data directory, then saves its nondefault readback, compares a fresh
// launch with that readback, or checks that a seeded off-screen state reopens
// with its top area on a connected display at its saved size, and closes the
// window normally.
func macWindowStateLaunch(t *testing.T, phase, dir string) {
	if !filepath.IsAbs(dir) {
		t.Fatalf("%s must name the absolute child data directory", macWindowStateDirEnv)
	}
	desktop := nativeWhitebox.desktop
	var (
		displays []mygo.Display
		saved    mygo.Rectangle
	)
	if phase == macWindowStateOffscreen {
		displays = mygo.Screen.Displays()
		if len(displays) == 0 {
			t.Fatal("no connected display to save a window outside of")
		}
		var err error
		// The production window requests 1200x800, so the helper yields a
		// nondefault saved size that the primary work area fits.
		saved, err = macWindowStateTarget(mygo.Screen.PrimaryDisplay().WorkArea, mygo.Rectangle{Width: 1200, Height: 800})
		if err != nil {
			t.Fatal(err)
		}
		// Move only X past the rightmost current work area; Y keeps the
		// reachable target, so one axis puts the seeded bounds strictly off
		// every work area. This mimics a state saved while a display to the
		// right existed; it does not prove that display was actually removed.
		rightmost := displays[0].WorkArea.X + displays[0].WorkArea.Width
		for _, d := range displays[1:] {
			rightmost = max(rightmost, d.WorkArea.X+d.WorkArea.Width)
		}
		saved.X = rightmost + saved.Width
		seeded := image.Rect(saved.X, saved.Y, saved.X+saved.Width, saved.Y+saved.Height)
		for _, d := range displays {
			work := d.WorkArea
			if seeded.Overlaps(image.Rect(work.X, work.Y, work.X+work.Width, work.Y+work.Height)) {
				t.Fatalf("the seeded saved rectangle %+v overlaps the current work area %+v", saved, work)
			}
		}
		mygo.App.SetWindowStateStore(macWindowStateStore{"desktop-main": mygo.WindowState{
			X: saved.X, Y: saved.Y, Width: saved.Width, Height: saved.Height,
		}})
	}
	mygo.RunOnMain(func() {
		mygo.App.SetPath(mygo.PathUserData, dir)
		desktop.openMainWindow()
	})
	win := desktop.mainWindow()
	if win == nil {
		t.Fatal("the native main window was not created")
	}
	switch phase {
	case macWindowStateWrite:
		initial := win.Bounds()
		target, err := macWindowStateTarget(mygo.Screen.PrimaryDisplay().WorkArea, initial)
		if err != nil {
			t.Fatal(err)
		}
		win.SetBounds(target)
		observed := win.Bounds()
		if observed == initial {
			t.Fatalf("SetBounds(%+v) left the initial geometry %+v", target, initial)
		}
		data, err := json.Marshal(observed)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, macWindowStateReceipt), data, 0o600); err != nil {
			t.Fatal(err)
		}
	case macWindowStateRead:
		data, err := os.ReadFile(filepath.Join(dir, macWindowStateReceipt))
		if err != nil {
			t.Fatal(err)
		}
		var expected mygo.Rectangle
		if err := json.Unmarshal(data, &expected); err != nil {
			t.Fatal(err)
		}
		if restored := win.Bounds(); restored != expected {
			t.Fatalf("restored main window geometry %+v, want the first process's readback %+v", restored, expected)
		}
	case macWindowStateOffscreen:
		restored := win.Bounds()
		// 50 DIP right and 25 DIP down from the restored top-left is in the
		// window's top area, where the normal controls are, so that point on a
		// connected work area lets a user reach the window.
		topArea := image.Pt(restored.X+50, restored.Y+25)
		onDisplay := false
		for _, d := range displays {
			work := d.WorkArea
			if topArea.In(image.Rect(work.X, work.Y, work.X+work.Width, work.Y+work.Height)) {
				onDisplay = true
				break
			}
		}
		if !onDisplay {
			t.Fatalf("restored main window %+v has no reachable top area on a connected display", restored)
		}
		// A launch that ignored the seeded state opens at the production
		// default size, so matching the saved size shows the StateKey restored
		// the seeded state.
		if restored.Width != saved.Width || restored.Height != saved.Height {
			t.Fatalf("restored main window size %dx%d, want the saved %dx%d", restored.Width, restored.Height, saved.Width, saved.Height)
		}
	default:
		t.Fatalf("unknown window state phase %q", phase)
	}
	win.Close()
	if !win.IsDestroyed() {
		t.Fatal("the main window did not close normally")
	}
}

// macWindowStateTarget returns a deterministic rectangle inside the primary
// work area: the production 720x540 minimum, 40 DIP from the work area's
// edges, shrunk from the initial window where possible. It fails rather than
// fall back when the display cannot hold that geometry.
func macWindowStateTarget(work, initial mygo.Rectangle) (mygo.Rectangle, error) {
	const margin, minWidth, minHeight = 40, 720, 540
	if work.Width < minWidth+2*margin || work.Height < minHeight+2*margin {
		return mygo.Rectangle{}, fmt.Errorf("the primary work area %+v cannot fit a %dx%d window with %d DIP margins; use a larger display", work, minWidth, minHeight, margin)
	}
	target := mygo.Rectangle{
		X:      work.X + margin,
		Y:      work.Y + margin,
		Width:  min(max(minWidth, initial.Width-100), work.Width-2*margin),
		Height: min(max(minHeight, initial.Height-100), work.Height-2*margin),
	}
	if target == initial {
		target.X = work.X + work.Width - margin - target.Width
		target.Y = work.Y + work.Height - margin - target.Height
	}
	if target == initial {
		return mygo.Rectangle{}, fmt.Errorf("the primary work area %+v cannot place a nondefault %+v rectangle away from the initial window", work, target)
	}
	return target, nil
}

// macWindowStateStore stands in for the state a previous launch persisted, so
// the offscreen case needs no window-state.json of its own.
type macWindowStateStore map[string]mygo.WindowState

func (s macWindowStateStore) LoadWindowStates() (map[string]mygo.WindowState, error) {
	return s, nil
}

func (macWindowStateStore) SaveWindowStates(map[string]mygo.WindowState) error { return nil }
