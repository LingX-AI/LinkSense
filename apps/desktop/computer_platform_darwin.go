//go:build darwin

package main

// Production macOS platform for the computer control host. Everything here is
// inert until the user's select gesture: eligibility only stats the signed
// runtime layout, and the driver is constructed on demand from the release
// signer token. There is no prepared-hash or ad hoc fallback.

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

const (
	desktopBundleIdentifier = "org.linksense.desktop"

	computerRuntimeManifestBytes   = 1 << 20
	computerRuntimeExecutableBytes = 256 << 20
)

// desktopComputerRuntimeRoot returns the canonical signed runtime root of the
// running .app. A development or packaged-elsewhere build fails closed.
func desktopComputerRuntimeRoot() (string, error) {
	app := currentAppBundle()
	if app == "" {
		return "", errComputerUnavailable
	}
	canonical, err := filepath.EvalSymlinks(app)
	if err != nil || !filepath.IsAbs(canonical) || !strings.HasSuffix(canonical, ".app") {
		return "", errComputerUnavailable
	}
	root := filepath.Join(canonical, "Contents", "Resources", "runtime")
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil || resolved != root {
		return "", errComputerUnavailable
	}
	return root, nil
}

// desktopComputerDriverEligible is the side-effect-free readiness check behind
// DeviceConnectionStatus.ComputerReady. It never runs codesign, the CLI, or a
// permission read; it only requires the release token compiled into this build
// and the fixed signed-runtime layout.
// desktopComputerShortcutEligible enables the global emergency shortcut only
// where the same signed runtime this shell would build is present. It reads no
// TCC state, runs no CLI and never prompts.
func desktopComputerShortcutEligible(desktop *Desktop) bool {
	return desktopComputerDriverEligible(desktop)
}

func desktopComputerDriverEligible(desktop *Desktop) bool {
	if desktop == nil || desktop.dataRoot == "" || desktopMacosSignerToken == "" {
		return false
	}
	root, err := desktopComputerRuntimeRoot()
	if err != nil {
		return false
	}
	if info, err := os.Lstat(filepath.Join(root, "manifest.json")); err != nil ||
		!info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 ||
		info.Size() <= 0 || info.Size() > computerRuntimeManifestBytes {
		return false
	}
	for _, name := range []string{"agent-desktop", "agent-desktop-macos-helper"} {
		info, err := os.Lstat(filepath.Join(root, "bin", name))
		if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 ||
			info.Mode().Perm()&0o111 == 0 || info.Size() <= 0 ||
			info.Size() > computerRuntimeExecutableBytes {
			return false
		}
	}
	return true
}

// ensureComputerStateRoot creates the owner-only parent the signed driver uses
// for its private refmaps. It is called only after the select gesture.
func ensureComputerStateRoot(desktop *Desktop) (string, error) {
	if desktop == nil || desktop.dataRoot == "" {
		return "", errComputerUnavailable
	}
	root := filepath.Join(desktop.dataRoot, "computer-use")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", errComputerUnavailable
	}
	info, err := os.Lstat(root)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 ||
		info.Mode().Perm()&0o022 != 0 {
		return "", errComputerUnavailable
	}
	if stat, ok := info.Sys().(*syscall.Stat_t); !ok || stat.Uid != uint32(os.Getuid()) {
		return "", errComputerUnavailable
	}
	return root, nil
}

type darwinComputerPlatform struct {
	desktop *Desktop
}

func (platform darwinComputerPlatform) driverEligible() bool {
	return desktopComputerDriverEligible(platform.desktop)
}

func (platform darwinComputerPlatform) pickTarget(ctx context.Context, desktop *Desktop) (computerSelectedTarget, error) {
	root, err := desktopComputerRuntimeRoot()
	if err != nil {
		return computerSelectedTarget{}, errComputerPickerUnavailable
	}
	stateParent, err := ensureComputerStateRoot(desktop)
	if err != nil {
		return computerSelectedTarget{}, errComputerPickerUnavailable
	}
	// The signed proof is verified here, on the user's gesture, before the
	// driver is allowed to list a single window.
	driver, err := newComputerDriverDarwin(ctx, root, stateParent, computerRuntimeProof{Kind: computerRuntimeProofSigned})
	if err != nil {
		return computerSelectedTarget{}, errComputerPickerUnavailable
	}
	defer driver.Close()
	inventory, err := driver.Inventory(ctx)
	if err != nil {
		return computerSelectedTarget{}, errComputerPickerUnavailable
	}
	candidates := make([]computerPickerCandidate, 0, len(inventory.Candidates))
	for _, candidate := range inventory.Candidates {
		// Never offer LinkSense itself: the picker window and the app's own
		// controls must not become a model-controlled target.
		if candidate.BundleID == desktopBundleIdentifier {
			continue
		}
		candidates = append(candidates, computerPickerCandidate{
			AppName: candidate.AppName,
			Title:   candidate.Title,
			Target: computerSelectedTarget{
				BundleID: candidate.BundleID, WindowID: candidate.WindowID,
				PID: candidate.PID, ProcessInstance: candidate.ProcessInstance,
			},
		})
	}
	options := computerPickerOptions(candidates)
	target, err := showComputerTargetPicker(ctx, desktop.mainWindow(), options)
	if err != nil {
		return computerSelectedTarget{}, err
	}
	if err := target.validate(); err != nil {
		return computerSelectedTarget{}, errComputerPickerUnavailable
	}
	return target, nil
}

func (platform darwinComputerPlatform) newExecutor(ctx context.Context, desktop *Desktop, target computerSelectedTarget, selection m1bComputerSelection) (computerProductExecutor, error) {
	if target.BundleID == desktopBundleIdentifier {
		// Defense in depth: the picker already excludes LinkSense, but the
		// executor must never be constructed for the host's own application.
		return nil, errComputerInvalid
	}
	root, err := desktopComputerRuntimeRoot()
	if err != nil {
		return nil, err
	}
	stateParent, err := ensureComputerStateRoot(desktop)
	if err != nil {
		return nil, err
	}
	driverTarget := computerTarget{
		BundleID: target.BundleID, WindowID: target.WindowID,
		PID: target.PID, ProcessInstance: target.ProcessInstance,
	}
	if err := driverTarget.validate(); err != nil {
		return nil, errComputerInvalid
	}
	executor, err := newComputerExecutorDarwin(ctx, driverTarget, selection, root, stateParent,
		computerRuntimeProof{Kind: computerRuntimeProofSigned})
	if err != nil {
		return nil, errComputerUnavailable
	}
	return executor, nil
}
