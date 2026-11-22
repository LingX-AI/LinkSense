//go:build darwin

package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

const (
	testDesktopMacosAppReq     = `identifier "org.linksense.desktop" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "ABCDE12345" and ! (entitlement["com.apple.security.get-task-allow"] exists)`
	testDesktopMacosRuntimeReq = `anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "ABCDE12345" and ! (entitlement["com.apple.security.get-task-allow"] exists)`
)

const (
	desktopMacosFakeCodesignSucceeds    = "exit 0"
	desktopMacosFakeCodesignFails       = "exit 1"
	desktopMacosFakeCodesignFailsBinary = `if [ "${last##*/}" = "agent-desktop" ]; then exit 1; fi
exit 0`
	desktopMacosFakeCodesignFailsHelper = `if [ "${last##*/}" = "agent-desktop-macos-helper" ]; then exit 1; fi
exit 0`
	desktopMacosFakeCodesignSleeps = "exec sleep 10"
)

func desktopMacosTestToken(t *testing.T, mutate func(*desktopMacosSignerTokenData)) string {
	t.Helper()
	token := desktopMacosSignerTokenData{
		SchemaVersion:      desktopMacosSignerTokenSchema,
		AppRequirement:     testDesktopMacosAppReq,
		RuntimeRequirement: testDesktopMacosRuntimeReq,
	}
	if mutate != nil {
		mutate(&token)
	}
	raw, err := json.Marshal(token)
	if err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}

func setDesktopMacosSigningTestSeam(t *testing.T, token, codesign, app string) {
	t.Helper()
	previousToken, previousCodesign, previousApp := desktopMacosSignerToken, desktopMacosCodesignPath, desktopMacosCurrentAppBundle
	desktopMacosSignerToken, desktopMacosCodesignPath = token, codesign
	desktopMacosCurrentAppBundle = func() string { return app }
	t.Cleanup(func() {
		desktopMacosSignerToken, desktopMacosCodesignPath = previousToken, previousCodesign
		desktopMacosCurrentAppBundle = previousApp
	})
}

// desktopMacosFakeTree returns canonical paths because verification
// canonicalizes the bundle before deriving the expected runtime root.
func desktopMacosFakeTree(t *testing.T) (string, string, string, string) {
	t.Helper()
	app := filepath.Join(t.TempDir(), "LinkSense.app")
	runtimeRoot := filepath.Join(app, "Contents", "Resources", "runtime")
	binary := filepath.Join(runtimeRoot, "bin", "agent-desktop")
	helper := filepath.Join(runtimeRoot, "bin", "agent-desktop-macos-helper")
	for _, file := range []string{binary, helper} {
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte("fixture"), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	resolved, err := filepath.EvalSymlinks(app)
	if err != nil {
		t.Fatal(err)
	}
	runtimeRoot = filepath.Join(resolved, "Contents", "Resources", "runtime")
	return resolved, runtimeRoot, filepath.Join(runtimeRoot, "bin", "agent-desktop"),
		filepath.Join(runtimeRoot, "bin", "agent-desktop-macos-helper")
}

func desktopMacosFakeRuntime(t *testing.T) string {
	t.Helper()
	runtimeRoot := filepath.Join(t.TempDir(), "runtime")
	for _, file := range []string{"agent-desktop", "agent-desktop-macos-helper"} {
		path := filepath.Join(runtimeRoot, "bin", file)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("fixture"), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	return runtimeRoot
}

func writeDesktopMacosFakeCodesign(t *testing.T, behavior string) (string, string) {
	t.Helper()
	directory := t.TempDir()
	log := filepath.Join(directory, "codesign-calls")
	script := filepath.Join(directory, "codesign")
	body := "#!/bin/sh\n" +
		"last=\n" +
		"for arg in \"$@\"; do\n" +
		"  printf '%s\\n' \"$arg\" >> " + desktopMacosShellQuote(log) + "\n" +
		"  last=$arg\n" +
		"done\n" +
		behavior + "\n"
	if err := os.WriteFile(script, []byte(body), 0o700); err != nil {
		t.Fatal(err)
	}
	return script, log
}

func desktopMacosShellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

func desktopMacosCalls(t *testing.T, log string) []string {
	t.Helper()
	raw, err := os.ReadFile(log)
	if err != nil {
		t.Fatal(err)
	}
	return strings.Split(strings.TrimSuffix(string(raw), "\n"), "\n")
}

func desktopMacosNoCalls(t *testing.T, log string) {
	t.Helper()
	if _, err := os.Lstat(log); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("codesign ran unexpectedly: %v", err)
	}
}

func TestDesktopMacosSignedRuntimeUsesTheReleaseRequirements(t *testing.T) {
	app, _, binary, helper := desktopMacosFakeTree(t)
	codesign, log := writeDesktopMacosFakeCodesign(t, desktopMacosFakeCodesignSucceeds)
	setDesktopMacosSigningTestSeam(t, desktopMacosTestToken(t, nil), codesign, app)

	gotBinary, gotHelper, err := verifyDesktopMacosSignedRuntime(context.Background())
	if err != nil {
		t.Fatalf("verifyDesktopMacosSignedRuntime = %v", err)
	}
	if gotBinary != binary || gotHelper != helper {
		t.Fatalf("verified files = %q, %q, want %q, %q", gotBinary, gotHelper, binary, helper)
	}
	want := []string{
		"--verify", "--deep", "--strict", app,
		"--verify", "--strict", "-R", "=" + testDesktopMacosAppReq, app,
		"--verify", "--strict", "-R", "=" + testDesktopMacosRuntimeReq, binary,
		"--verify", "--strict", "-R", "=" + testDesktopMacosRuntimeReq, helper,
	}
	if got := desktopMacosCalls(t, log); !slices.Equal(got, want) {
		t.Fatalf("codesign calls = %q, want %q", got, want)
	}
}

func TestDesktopMacosSignedRuntimeRejectsAMissingOrMalformedToken(t *testing.T) {
	app, _, _, _ := desktopMacosFakeTree(t)
	codesign, _ := writeDesktopMacosFakeCodesign(t, desktopMacosFakeCodesignSucceeds)
	oversized := []byte(`{"schema_version":1,"app_requirement":"` + testDesktopMacosAppReq +
		`","runtime_requirement":"` + testDesktopMacosRuntimeReq + `"}` + strings.Repeat(" ", desktopMacosSignerTokenMaxBytes))
	malformed := map[string]string{
		"invalid base64":        "not-base64!",
		"invalid JSON":          base64.RawURLEncoding.EncodeToString([]byte("{")),
		"wrong schema":          desktopMacosTestToken(t, func(token *desktopMacosSignerTokenData) { token.SchemaVersion = 2 }),
		"empty app requirement": desktopMacosTestToken(t, func(token *desktopMacosSignerTokenData) { token.AppRequirement = "" }),
		"empty runtime requirement": desktopMacosTestToken(t, func(token *desktopMacosSignerTokenData) {
			token.RuntimeRequirement = ""
		}),
		"oversized requirement": desktopMacosTestToken(t, func(token *desktopMacosSignerTokenData) {
			token.RuntimeRequirement = strings.Repeat("a", desktopMacosRequirementMaxBytes+1)
		}),
		"oversized token": base64.RawURLEncoding.EncodeToString(oversized),
	}

	t.Run("ad hoc build has no release token", func(t *testing.T) {
		codesign, log := writeDesktopMacosFakeCodesign(t, desktopMacosFakeCodesignSucceeds)
		setDesktopMacosSigningTestSeam(t, "", codesign, app)
		if _, _, err := verifyDesktopMacosSignedRuntime(context.Background()); !errors.Is(err, errDesktopMacosSignerTokenMissing) {
			t.Fatalf("error = %v, want %v", err, errDesktopMacosSignerTokenMissing)
		}
		desktopMacosNoCalls(t, log)
	})
	for name, token := range malformed {
		t.Run(name, func(t *testing.T) {
			setDesktopMacosSigningTestSeam(t, token, codesign, app)
			if _, _, err := verifyDesktopMacosSignedRuntime(context.Background()); !errors.Is(err, errDesktopMacosSignerTokenInvalid) {
				t.Fatalf("error = %v, want %v", err, errDesktopMacosSignerTokenInvalid)
			}
		})
	}
}

func TestDesktopMacosSignedRuntimeFailsClosedOnVerificationError(t *testing.T) {
	app, _, binary, helper := desktopMacosFakeTree(t)

	t.Run("bundle fails verification", func(t *testing.T) {
		codesign, log := writeDesktopMacosFakeCodesign(t, desktopMacosFakeCodesignFails)
		setDesktopMacosSigningTestSeam(t, desktopMacosTestToken(t, nil), codesign, app)
		if _, _, err := verifyDesktopMacosSignedRuntime(context.Background()); !errors.Is(err, errDesktopMacosSignatureInvalid) {
			t.Fatalf("error = %v, want %v", err, errDesktopMacosSignatureInvalid)
		}
		want := []string{"--verify", "--deep", "--strict", app}
		if got := desktopMacosCalls(t, log); !slices.Equal(got, want) {
			t.Fatalf("codesign calls = %q, want %q", got, want)
		}
	})
	t.Run("driver executable has another signer", func(t *testing.T) {
		codesign, log := writeDesktopMacosFakeCodesign(t, desktopMacosFakeCodesignFailsBinary)
		setDesktopMacosSigningTestSeam(t, desktopMacosTestToken(t, nil), codesign, app)
		if _, _, err := verifyDesktopMacosSignedRuntime(context.Background()); !errors.Is(err, errDesktopMacosSignatureInvalid) {
			t.Fatalf("error = %v, want %v", err, errDesktopMacosSignatureInvalid)
		}
		calls := desktopMacosCalls(t, log)
		if len(calls) == 0 || calls[len(calls)-1] != binary {
			t.Fatalf("last codesign target = %q, want %q", calls, binary)
		}
		// The helper is never reached after the first executable fails.
		if slices.Contains(calls, helper) {
			t.Fatalf("codesign verified the helper after the driver failed: %q", calls)
		}
	})
	t.Run("helper executable has another signer", func(t *testing.T) {
		codesign, log := writeDesktopMacosFakeCodesign(t, desktopMacosFakeCodesignFailsHelper)
		setDesktopMacosSigningTestSeam(t, desktopMacosTestToken(t, nil), codesign, app)
		if _, _, err := verifyDesktopMacosSignedRuntime(context.Background()); !errors.Is(err, errDesktopMacosSignatureInvalid) {
			t.Fatalf("error = %v, want %v", err, errDesktopMacosSignatureInvalid)
		}
		calls := desktopMacosCalls(t, log)
		if len(calls) == 0 || calls[len(calls)-1] != helper {
			t.Fatalf("last codesign target = %q, want %q", calls, helper)
		}
	})
}

func TestDesktopMacosSignedRuntimeRejectsARedirectedRuntime(t *testing.T) {
	codesign, log := writeDesktopMacosFakeCodesign(t, desktopMacosFakeCodesignSucceeds)

	t.Run("unpackaged executable", func(t *testing.T) {
		setDesktopMacosSigningTestSeam(t, desktopMacosTestToken(t, nil), codesign, "")
		if _, _, err := verifyDesktopMacosSignedRuntime(context.Background()); !errors.Is(err, errDesktopMacosRuntimeUntrusted) {
			t.Fatalf("error = %v, want %v", err, errDesktopMacosRuntimeUntrusted)
		}
		desktopMacosNoCalls(t, log)
	})
	t.Run("not an app bundle", func(t *testing.T) {
		setDesktopMacosSigningTestSeam(t, desktopMacosTestToken(t, nil), codesign, t.TempDir())
		if _, _, err := verifyDesktopMacosSignedRuntime(context.Background()); !errors.Is(err, errDesktopMacosRuntimeUntrusted) {
			t.Fatalf("error = %v, want %v", err, errDesktopMacosRuntimeUntrusted)
		}
		desktopMacosNoCalls(t, log)
	})
	t.Run("missing runtime", func(t *testing.T) {
		missing, err := os.MkdirTemp(t.TempDir(), "LinkSense-")
		if err != nil {
			t.Fatal(err)
		}
		missing += ".app"
		if err := os.MkdirAll(filepath.Join(missing, "Contents"), 0o755); err != nil {
			t.Fatal(err)
		}
		setDesktopMacosSigningTestSeam(t, desktopMacosTestToken(t, nil), codesign, missing)
		if _, _, err := verifyDesktopMacosSignedRuntime(context.Background()); !errors.Is(err, errDesktopMacosRuntimeUntrusted) {
			t.Fatalf("error = %v, want %v", err, errDesktopMacosRuntimeUntrusted)
		}
		desktopMacosNoCalls(t, log)
	})
	t.Run("runtime is a symlink", func(t *testing.T) {
		app, _, _, _ := desktopMacosFakeTree(t)
		outside := desktopMacosFakeRuntime(t)
		if err := os.RemoveAll(filepath.Join(app, "Contents", "Resources", "runtime")); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(outside, filepath.Join(app, "Contents", "Resources", "runtime")); err != nil {
			t.Fatal(err)
		}
		setDesktopMacosSigningTestSeam(t, desktopMacosTestToken(t, nil), codesign, app)
		if _, _, err := verifyDesktopMacosSignedRuntime(context.Background()); !errors.Is(err, errDesktopMacosRuntimeUntrusted) {
			t.Fatalf("error = %v, want %v", err, errDesktopMacosRuntimeUntrusted)
		}
		desktopMacosNoCalls(t, log)
	})
	t.Run("resources directory is redirected", func(t *testing.T) {
		app := filepath.Join(t.TempDir(), "LinkSense.app")
		redirected := filepath.Dir(desktopMacosFakeRuntime(t))
		if err := os.MkdirAll(filepath.Join(app, "Contents"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(redirected, filepath.Join(app, "Contents", "Resources")); err != nil {
			t.Fatal(err)
		}
		setDesktopMacosSigningTestSeam(t, desktopMacosTestToken(t, nil), codesign, app)
		if _, _, err := verifyDesktopMacosSignedRuntime(context.Background()); !errors.Is(err, errDesktopMacosRuntimeUntrusted) {
			t.Fatalf("error = %v, want %v", err, errDesktopMacosRuntimeUntrusted)
		}
		desktopMacosNoCalls(t, log)
	})
	t.Run("bin directory is redirected", func(t *testing.T) {
		app, runtimeRoot, _, _ := desktopMacosFakeTree(t)
		outside := t.TempDir()
		for _, file := range []string{"agent-desktop", "agent-desktop-macos-helper"} {
			if err := os.WriteFile(filepath.Join(outside, file), []byte("fixture"), 0o700); err != nil {
				t.Fatal(err)
			}
		}
		if err := os.RemoveAll(filepath.Join(runtimeRoot, "bin")); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(outside, filepath.Join(runtimeRoot, "bin")); err != nil {
			t.Fatal(err)
		}
		setDesktopMacosSigningTestSeam(t, desktopMacosTestToken(t, nil), codesign, app)
		if _, _, err := verifyDesktopMacosSignedRuntime(context.Background()); !errors.Is(err, errDesktopMacosRuntimeUntrusted) {
			t.Fatalf("error = %v, want %v", err, errDesktopMacosRuntimeUntrusted)
		}
		desktopMacosNoCalls(t, log)
	})
	t.Run("driver executable is a symlink", func(t *testing.T) {
		app, _, binary, helper := desktopMacosFakeTree(t)
		if err := os.Remove(helper); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(binary, helper); err != nil {
			t.Fatal(err)
		}
		setDesktopMacosSigningTestSeam(t, desktopMacosTestToken(t, nil), codesign, app)
		if _, _, err := verifyDesktopMacosSignedRuntime(context.Background()); !errors.Is(err, errDesktopMacosRuntimeUntrusted) {
			t.Fatalf("error = %v, want %v", err, errDesktopMacosRuntimeUntrusted)
		}
		desktopMacosNoCalls(t, log)
	})
	t.Run("driver executable is missing", func(t *testing.T) {
		app, _, binary, _ := desktopMacosFakeTree(t)
		if err := os.Remove(binary); err != nil {
			t.Fatal(err)
		}
		setDesktopMacosSigningTestSeam(t, desktopMacosTestToken(t, nil), codesign, app)
		if _, _, err := verifyDesktopMacosSignedRuntime(context.Background()); !errors.Is(err, errDesktopMacosRuntimeUntrusted) {
			t.Fatalf("error = %v, want %v", err, errDesktopMacosRuntimeUntrusted)
		}
		desktopMacosNoCalls(t, log)
	})
}

func TestDesktopMacosSignedRuntimeHonorsCallerCancellation(t *testing.T) {
	app, _, _, _ := desktopMacosFakeTree(t)

	t.Run("canceled before verification", func(t *testing.T) {
		codesign, log := writeDesktopMacosFakeCodesign(t, desktopMacosFakeCodesignSucceeds)
		setDesktopMacosSigningTestSeam(t, desktopMacosTestToken(t, nil), codesign, app)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if _, _, err := verifyDesktopMacosSignedRuntime(ctx); !errors.Is(err, context.Canceled) {
			t.Fatalf("error = %v, want %v", err, context.Canceled)
		}
		desktopMacosNoCalls(t, log)
	})
	t.Run("deadline stops a running verifier", func(t *testing.T) {
		codesign, _ := writeDesktopMacosFakeCodesign(t, desktopMacosFakeCodesignSleeps)
		setDesktopMacosSigningTestSeam(t, desktopMacosTestToken(t, nil), codesign, app)
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		started := time.Now()
		_, _, err := verifyDesktopMacosSignedRuntime(ctx)
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("error = %v, want %v", err, context.DeadlineExceeded)
		}
		if elapsed := time.Since(started); elapsed > 5*time.Second {
			t.Fatalf("verification ignored the caller deadline for %v", elapsed)
		}
	})
}

func TestDesktopMacosSignedRuntimeForwardsTheTrustedRequirementsVerbatim(t *testing.T) {
	app, _, binary, helper := desktopMacosFakeTree(t)
	codesign, log := writeDesktopMacosFakeCodesign(t, desktopMacosFakeCodesignSucceeds)
	// The requirement strings are release metadata, not caller input. The
	// verifier must forward them to codesign unchanged instead of parsing
	// team or identifier text out of them.
	const appRequirement = "release app requirement fixture"
	const runtimeRequirement = "release runtime requirement fixture"
	token := desktopMacosTestToken(t, func(token *desktopMacosSignerTokenData) {
		token.AppRequirement = appRequirement
		token.RuntimeRequirement = runtimeRequirement
	})
	setDesktopMacosSigningTestSeam(t, token, codesign, app)
	if _, _, err := verifyDesktopMacosSignedRuntime(context.Background()); err != nil {
		t.Fatalf("verifyDesktopMacosSignedRuntime = %v", err)
	}
	want := []string{
		"--verify", "--deep", "--strict", app,
		"--verify", "--strict", "-R", "=" + appRequirement, app,
		"--verify", "--strict", "-R", "=" + runtimeRequirement, binary,
		"--verify", "--strict", "-R", "=" + runtimeRequirement, helper,
	}
	if got := desktopMacosCalls(t, log); !slices.Equal(got, want) {
		t.Fatalf("codesign calls = %q, want %q", got, want)
	}
}
