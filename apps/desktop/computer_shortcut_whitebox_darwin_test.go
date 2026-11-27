//go:build desktop_whitebox && desktop_shortcut_whitebox

package main

// This opt-in fixture registers the two real system-wide emergency chords
// through MyGo's singleton GlobalShortcutModule and the production
// computerEmergencyShortcut. It proves both chords reach Carbon's
// RegisterEventHotKey, that a background app owns both, and that activation and
// quit release them: after each release the same singleton registers the chord
// again, which the pinned darwin RegisterWith can do only when
// RegisterEventHotKey succeeds. It sends no keystrokes, opens no window,
// requests no permission and changes no setting; building with both tags is the
// opt-in, and the default desktop_whitebox suite never compiles it.

import (
	"testing"
	"time"

	"github.com/egoist/mygo"
)

func TestNativeMacComputerEmergencyShortcutsBindAndReleaseNatively(t *testing.T) {
	accelerators := []string{computerEmergencyPauseAccelerator, computerEmergencyStopAccelerator}
	var problems []string
	finished := make(chan struct{})
	mygo.RunOnMain(func() {
		defer close(finished)

		// Fail closed before the fixture changes anything: an existing owner or
		// a chord this Mac cannot register natively would make every later
		// result ambiguous.
		for _, accelerator := range accelerators {
			if mygo.GlobalShortcut.IsRegistered(accelerator) {
				problems = append(problems, "baseline: the application already registered "+accelerator)
			}
		}
		if len(problems) == 0 {
			for _, accelerator := range accelerators {
				if err := mygo.GlobalShortcut.Register(accelerator, func() {}); err != nil {
					problems = append(problems, "baseline: "+accelerator+" cannot register natively: "+err.Error())
					continue
				}
				mygo.GlobalShortcut.Unregister(accelerator)
				if mygo.GlobalShortcut.IsRegistered(accelerator) {
					problems = append(problems, "baseline: "+accelerator+" stayed registered after its probe")
				}
			}
		}
		if len(problems) > 0 {
			return
		}

		shortcut := newComputerEmergencyShortcut(func(string) {}, func(string) {})
		// Release here even if a check below fails, so no registration outlives
		// the one main-thread block. The direct unregister also cleans up after
		// a product release that the checks above find broken; every entry for
		// these chords is this fixture's (the baseline proved they were free).
		defer func() {
			shortcut.quitBinding()
			for _, accelerator := range accelerators {
				mygo.GlobalShortcut.Unregister(accelerator)
			}
		}()

		// Record each result only after the real singleton call returned: the
		// pinned darwin RegisterWith rolls its pending entry back on failure and
		// returns nil only after RegisterEventHotKey succeeded.
		register := shortcut.register
		results := map[string]error{}
		shortcut.register = func(accelerator string, press func()) error {
			err := register(accelerator, press)
			results[accelerator] = err
			return err
		}
		checkOwned := func(when string) {
			for _, accelerator := range accelerators {
				err, attempted := results[accelerator]
				switch {
				case !attempted:
					problems = append(problems, when+": production did not register "+accelerator)
				case err != nil:
					problems = append(problems, when+": "+accelerator+" did not reach the native API: "+err.Error())
				case !mygo.GlobalShortcut.IsRegistered(accelerator):
					problems = append(problems, when+": the singleton does not own "+accelerator)
				}
			}
		}
		// A released chord must be registerable through the singleton again;
		// unregister the probe at once so it reserves nothing for later phases.
		probeAvailable := func(when string) {
			for _, accelerator := range accelerators {
				if mygo.GlobalShortcut.IsRegistered(accelerator) {
					problems = append(problems, when+": "+accelerator+" is still registered")
					continue
				}
				if err := mygo.GlobalShortcut.Register(accelerator, func() {}); err != nil {
					problems = append(problems, when+": "+accelerator+" cannot register after release: "+err.Error())
					continue
				}
				mygo.GlobalShortcut.Unregister(accelerator)
				if mygo.GlobalShortcut.IsRegistered(accelerator) {
					problems = append(problems, when+": the probe left "+accelerator+" registered")
				}
			}
		}

		shortcut.setDesired(shortcutSelectionA, shortcutSelectionA)
		shortcut.setEligible(true)
		shortcut.setForeground(false)
		checkOwned("while backgrounded")

		// Activation is driven directly through the same main-thread release the
		// app's focus hooks use; this makes no claim of a real focus transition.
		shortcut.setForeground(true)
		probeAvailable("after activation")

		// The second background registration must succeed again, which also
		// proves the activation release reached the native API.
		clear(results)
		shortcut.setForeground(false)
		checkOwned("after returning to the background")

		shortcut.quitBinding()
		probeAvailable("after quit")
	})
	select {
	case <-finished:
	case <-time.After(10 * time.Second):
		t.Fatal("the native shortcut fixture did not run on the main thread")
	}
	for _, problem := range problems {
		t.Error(problem)
	}
}
