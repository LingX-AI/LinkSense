//go:build darwin

package main

// Trusted runtime-signing proof for Developer ID release builds.
//
// A --macos-release build compiles main.desktopMacosSignerToken from
// scripts/desktop.mjs. The token is a base64url JSON object carrying the two
// Developer ID requirements that release path generates with
// desktopMacosSigningRequirement. The token is part of the signed app binary,
// so it is package-sourced and cannot be supplied by the renderer, the model,
// or user input. Every other build, including ad hoc and development builds,
// leaves it empty and fails closed.
//
// This file is the validation primitive. The private computer driver's signed
// proof branch calls verifyDesktopMacosSignedRuntime and maps every failure to
// a fail-closed runtime-proof error; a missing or invalid signature is never
// replaced by prepared hashes. Developer ID signing rewrites executable bytes
// and their manifest hashes, so only this signature check can establish a
// release runtime.
//
// Verification delegates to the fixed system /usr/bin/codesign with the same
// commands as the release gate in scripts/desktop.mjs, over the current
// bundle and the fixed two agent-desktop executables. It introduces no second
// signing chain, custom cryptography, or key material.

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	desktopMacosSignerTokenSchema   = 1
	desktopMacosSignerTokenMaxBytes = 4096
	desktopMacosRequirementMaxBytes = 2048
	// The whole proof shares this upper deadline. A caller context with an
	// earlier deadline wins.
	desktopMacosVerificationTimeout = 60 * time.Second
)

var (
	// desktopMacosSignerToken is written only by a --macos-release build.
	// Every other build leaves it empty and fails closed.
	desktopMacosSignerToken string
	// desktopMacosCodesignPath is the fixed system tool in production; tests
	// replace it with a synthetic executable, so no real signature or
	// Keychain state is touched.
	desktopMacosCodesignPath = "/usr/bin/codesign"
	// desktopMacosCurrentAppBundle resolves the running .app bundle. Tests
	// replace it so the fail-closed path is deterministic.
	desktopMacosCurrentAppBundle = currentAppBundle
)

var (
	errDesktopMacosSignerTokenMissing = errors.New("DESKTOP_MACOS_SIGNER_TOKEN_MISSING")
	errDesktopMacosSignerTokenInvalid = errors.New("DESKTOP_MACOS_SIGNER_TOKEN_INVALID")
	errDesktopMacosRuntimeUntrusted   = errors.New("DESKTOP_MACOS_RUNTIME_UNTRUSTED")
	errDesktopMacosSignatureInvalid   = errors.New("DESKTOP_MACOS_SIGNATURE_INVALID")
)

type desktopMacosSignerTokenData struct {
	SchemaVersion      int    `json:"schema_version"`
	AppRequirement     string `json:"app_requirement"`
	RuntimeRequirement string `json:"runtime_requirement"`
}

func loadDesktopMacosSignerToken() (desktopMacosSignerTokenData, error) {
	var token desktopMacosSignerTokenData
	if desktopMacosSignerToken == "" {
		return token, errDesktopMacosSignerTokenMissing
	}
	if len(desktopMacosSignerToken) > base64.RawURLEncoding.EncodedLen(desktopMacosSignerTokenMaxBytes) {
		return token, errDesktopMacosSignerTokenInvalid
	}
	raw, err := base64.RawURLEncoding.DecodeString(desktopMacosSignerToken)
	if err != nil || len(raw) == 0 || len(raw) > desktopMacosSignerTokenMaxBytes {
		return token, errDesktopMacosSignerTokenInvalid
	}
	if err := json.Unmarshal(raw, &token); err != nil || !validDesktopMacosSignerToken(token) {
		return token, errDesktopMacosSignerTokenInvalid
	}
	return token, nil
}

// validDesktopMacosSignerToken checks only the token envelope. The two
// requirement strings are trusted build metadata from the release
// preparation, and codesign enforces their meaning. Parsing team names or
// identifiers back out of them would be a second, weaker rule.
func validDesktopMacosSignerToken(token desktopMacosSignerTokenData) bool {
	return token.SchemaVersion == desktopMacosSignerTokenSchema &&
		validDesktopMacosRequirement(token.AppRequirement) &&
		validDesktopMacosRequirement(token.RuntimeRequirement)
}

func validDesktopMacosRequirement(requirement string) bool {
	return requirement != "" && len(requirement) <= desktopMacosRequirementMaxBytes
}

// verifyDesktopMacosSignedRuntime verifies the running .app bundle and the
// two agent-desktop executables the computer driver launches, and returns
// those executables under the canonical
// <current .app>/Contents/Resources/runtime/bin layout. Every path is derived
// from the current bundle: no caller supplies a root, a file list, or a
// verifier. The caller's context bounds the whole proof, with
// desktopMacosVerificationTimeout as the upper deadline.
func verifyDesktopMacosSignedRuntime(ctx context.Context) (string, string, error) {
	if err := ctx.Err(); err != nil {
		return "", "", err
	}
	token, err := loadDesktopMacosSignerToken()
	if err != nil {
		return "", "", err
	}
	app, binaryPath, helperPath, err := desktopMacosSignedRuntimeFiles()
	if err != nil {
		return "", "", err
	}
	verification, cancel := context.WithTimeout(ctx, desktopMacosVerificationTimeout)
	defer cancel()
	// The sealed bundle, then the exact release app requirement. --deep
	// verifies the nested signatures, including the tools among Resources.
	if err := runDesktopMacosCodesign(verification, "--verify", "--deep", "--strict", app); err != nil {
		return "", "", err
	}
	if err := runDesktopMacosCodesign(verification, "--verify", "--strict", "-R", "="+token.AppRequirement, app); err != nil {
		return "", "", err
	}
	// The two executables the driver runs must also carry the release signer,
	// not merely a valid nested signature.
	for _, target := range []string{binaryPath, helperPath} {
		if err := runDesktopMacosCodesign(verification, "--verify", "--strict", "-R", "="+token.RuntimeRequirement, target); err != nil {
			return "", "", err
		}
	}
	return binaryPath, helperPath, nil
}

// desktopMacosSignedRuntimeFiles resolves the only accepted runtime layout:
// <current app>.app/Contents/Resources/runtime/bin/{agent-desktop,
// agent-desktop-macos-helper}. The app path is canonicalized, and every
// component below it must resolve to itself, so no redirected directory or
// symlinked file can satisfy the proof.
func desktopMacosSignedRuntimeFiles() (string, string, string, error) {
	app := desktopMacosCurrentAppBundle()
	if app == "" {
		return "", "", "", errDesktopMacosRuntimeUntrusted
	}
	app, err := filepath.EvalSymlinks(app)
	if err != nil || !filepath.IsAbs(app) || !strings.HasSuffix(app, ".app") {
		return "", "", "", errDesktopMacosRuntimeUntrusted
	}
	runtimeRoot := filepath.Join(app, "Contents", "Resources", "runtime")
	if resolved, err := filepath.EvalSymlinks(runtimeRoot); err != nil || resolved != runtimeRoot {
		return "", "", "", errDesktopMacosRuntimeUntrusted
	}
	binDir := filepath.Join(runtimeRoot, "bin")
	for _, directory := range []string{runtimeRoot, binDir} {
		info, err := os.Lstat(directory)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", "", "", errDesktopMacosRuntimeUntrusted
		}
	}
	binaryPath := filepath.Join(binDir, "agent-desktop")
	helperPath := filepath.Join(binDir, "agent-desktop-macos-helper")
	for _, file := range []string{binaryPath, helperPath} {
		info, err := os.Lstat(file)
		if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return "", "", "", errDesktopMacosRuntimeUntrusted
		}
	}
	return app, binaryPath, helperPath, nil
}

// runDesktopMacosCodesign discards output so no path or native message can
// reach an error. The passed context is the single deadline for the whole
// proof, so a canceled request stops any remaining command.
func runDesktopMacosCodesign(ctx context.Context, args ...string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	command := exec.CommandContext(ctx, desktopMacosCodesignPath, args...)
	command.Env = []string{"PATH=/usr/bin:/bin"}
	if err := command.Run(); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		return errDesktopMacosSignatureInvalid
	}
	return nil
}
