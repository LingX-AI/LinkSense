//go:build desktop_whitebox

package main

// One child moves the production main window and closes it normally; a fresh
// child with the same private user-data directory must reopen at that readback.
// The saved state-file layout is never inspected.

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

const (
	macWindowStatePhaseEnv = "LINKSENSE_TEST_MAC_WINDOW_STATE_PHASE"
	macWindowStateDirEnv   = "LINKSENSE_TEST_MAC_WINDOW_STATE_DIR"
	macWindowStateReceipt  = "mac-window-geometry.json"
	macWindowStateWrite    = "write"
	macWindowStateRead     = "read"
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
	dir := t.TempDir()
	run := func(phase string) {
		t.Helper()
		ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, binary, "-test.v", "-test.run=^"+t.Name()+"$")
		cmd.Env = append(os.Environ(), macWindowStatePhaseEnv+"="+phase, macWindowStateDirEnv+"="+dir)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("window state child %s: %v\n%s", phase, err, out)
		}
	}
	run(macWindowStateWrite)
	run(macWindowStateRead)
}

// macWindowStateLaunch opens the production main window in the private
// user-data directory, then either saves its nondefault readback or compares
// a fresh launch with that readback, and closes the window normally.
func macWindowStateLaunch(t *testing.T, phase, dir string) {
	if !filepath.IsAbs(dir) {
		t.Fatalf("%s must name the absolute child data directory", macWindowStateDirEnv)
	}
	desktop := nativeWhitebox.desktop
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
