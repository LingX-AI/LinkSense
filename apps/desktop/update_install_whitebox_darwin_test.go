//go:build darwin && desktop_update_install

package main

// Repeatable, opt-in whitebox of the real MyGo v0.10.0 macOS updater:
//
//	go test -tags desktop_update_install -run TestSignedUpdateInstallWhitebox -count=1 -timeout=10m ./...
//
// It builds tiny MyGo fixture apps with the pinned CLI (`mygo keygen`, then
// `mygo build -sign - -skip-dmg -skip-notarize`) from a throwaway project in
// t.TempDir, signs real full archives and a real delta from consecutive
// builds, and serves them over a loopback TLS feed. The apps run from
// disposable bundle paths, so the real installTarget/Enabled, archive and
// delta verification, installAfterExit helper, bundle replacement and
// Relaunch are exercised without touching an installed application.
//
// What this does not prove: Developer ID signing, Apple notarization,
// Gatekeeper on a downloaded DMG, or the LinkSense product app's own feed.
// Those are P1-12/packaging acceptance, not this fixture. LinkSense's
// update-admission gate around Install is covered by the Runner/desktop
// whitebox; MyGo has no pre-Install hook to assert here.

import (
	"bytes"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const (
	fixtureAppName   = "UpdateWhitebox"
	fixtureSlug      = "linksense-update-whitebox"
	fixtureTarget    = "darwin-arm64"
	fixtureOld       = "0.1.0"
	fixtureNew       = "0.2.0"
	fixtureBeta      = "0.3.0-beta.1"
	fixtureBlobBytes = 512 << 10
)

// The fixture app is compiled by `mygo build` for every version. It reports
// into a JSON file; only modes that need MyGo's quit/relaunch machinery run
// App.Run. The v2 instance of the relaunch test proves that Launch Services
// opened the replaced bundle.
const fixtureMain = `package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"time"

	"github.com/egoist/mygo"
)

type progressSample struct {
	Downloaded int64 ` + "`json:\"downloaded\"`" + `
	Total      int64 ` + "`json:\"total\"`" + `
}

type result struct {
	Mode         string           ` + "`json:\"mode\"`" + `
	AppVersion   string           ` + "`json:\"app_version\"`" + `
	Enabled      bool             ` + "`json:\"enabled\"`" + `
	State        string           ` + "`json:\"state,omitempty\"`" + `
	Offer        string           ` + "`json:\"offer,omitempty\"`" + `
	Error        string           ` + "`json:\"error,omitempty\"`" + `
	InstallError string           ` + "`json:\"install_error,omitempty\"`" + `
	Progress     []progressSample ` + "`json:\"progress,omitempty\"`" + `
	PID          int              ` + "`json:\"pid\"`" + `
}

func writeResult(path string, r result) {
	b, err := json.Marshal(r)
	if err != nil {
		return
	}
	if err := os.WriteFile(path+".tmp", b, 0600); err != nil {
		return
	}
	_ = os.Rename(path+".tmp", path)
}

func find() (*mygo.Update, string, string) {
	pre, _ := strconv.ParseBool(os.Getenv("FIXTURE_PRERELEASES"))
	mygo.Updater.SetPrereleases(pre)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	up, err := mygo.Updater.Check(ctx)
	switch {
	case errors.Is(err, mygo.ErrUpdatesDisabled):
		return nil, "unavailable", ""
	case err != nil:
		return nil, "failed", err.Error()
	case up == nil:
		return nil, "current", ""
	default:
		return up, "available", ""
	}
}

func install(mode, out string) result {
	r := result{Mode: mode, AppVersion: mygo.App.Version(), Enabled: mygo.Updater.Enabled(), PID: os.Getpid()}
	up, state, message := find()
	r.State, r.Error = state, message
	if up == nil {
		return r
	}
	r.Offer = up.Version
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	err := up.Install(ctx, func(downloaded, total int64) {
		if len(r.Progress) < 8192 {
			r.Progress = append(r.Progress, progressSample{Downloaded: downloaded, Total: total})
		}
	})
	if err != nil {
		r.InstallError = err.Error()
	}
	return r
}

func main() {
	// The instance that the update helper opens after the swap.
	if len(os.Args) >= 3 && os.Args[1] == "--relaunched" {
		writeResult(os.Args[2], result{Mode: "relaunched", AppVersion: mygo.App.Version(), PID: os.Getpid()})
		return
	}
	out := os.Getenv("FIXTURE_OUT")
	mode := os.Getenv("FIXTURE_MODE")
	if mode == "version" {
		writeResult(out, result{Mode: mode, AppVersion: mygo.App.Version(), PID: os.Getpid()})
		return
	}
	if mode == "relaunch" {
		// An accessory app has no Dock tile and takes no focus when opened.
		mygo.App.SetActivationPolicy(mygo.ActivationPolicyAccessory)
		mygo.App.WhenReady(func() {
			r := install(mode, out)
			writeResult(out, r)
			if r.InstallError == "" && r.Offer != "" {
				mygo.App.Relaunch("--relaunched", os.Getenv("FIXTURE_MARKER"))
				return
			}
			mygo.App.Quit()
		})
		if err := mygo.App.Run(); err != nil {
			writeResult(out, result{Mode: mode, Error: err.Error(), PID: os.Getpid()})
			os.Exit(1)
		}
		return
	}
	var r result
	if mode == "install" {
		r = install(mode, out)
	} else {
		up, state, message := find()
		r = result{Mode: mode, AppVersion: mygo.App.Version(), Enabled: mygo.Updater.Enabled(), State: state, Error: message, PID: os.Getpid()}
		if up != nil {
			r.Offer = up.Version
		}
	}
	writeResult(out, r)
	// Keep the old bundle provably on disk until this process exits.
	if ms, _ := strconv.Atoi(os.Getenv("FIXTURE_HOLD_MS")); ms > 0 {
		time.Sleep(time.Duration(ms) * time.Millisecond)
	}
}
`

// fixtureManifest mirrors the update manifest of MyGo v0.10.0 (internal
// package, so it cannot be imported). Only the fields the fixture inspects
// or varies are named; manifests themselves are not signed, which is why a
// variant may change them without reimplementing the archive or signature
// formats.
type fixtureDelta struct {
	From      string `json:"from"`
	URL       string `json:"url"`
	Size      int64  `json:"size"`
	Signature string `json:"signature"`
}

type fixtureArchive struct {
	Version   string `json:"version"`
	URL       string `json:"url"`
	Size      int64  `json:"size"`
	Signature string `json:"signature"`
}

type fixtureManifest struct {
	Version   string           `json:"version"`
	Notes     string           `json:"notes,omitempty"`
	Date      string           `json:"date,omitempty"`
	URL       string           `json:"url"`
	Size      int64            `json:"size"`
	Signature string           `json:"signature"`
	Deltas    []fixtureDelta   `json:"deltas,omitempty"`
	Previous  []fixtureArchive `json:"previous,omitempty"`
}

type fixtureBuild struct {
	app      string
	archive  string
	manifest fixtureManifest
}

type fixtureResult struct {
	Mode         string `json:"mode"`
	AppVersion   string `json:"app_version"`
	Enabled      bool   `json:"enabled"`
	State        string `json:"state"`
	Offer        string `json:"offer"`
	Error        string `json:"error"`
	InstallError string `json:"install_error"`
	Progress     []struct {
		Downloaded int64 `json:"downloaded"`
		Total      int64 `json:"total"`
	} `json:"progress"`
	PID int `json:"pid"`
}

// updateFeed serves the signed artifacts over the loopback TLS server the
// fixture apps were built against, with one non-signed manifest variant per
// scenario (the manifest only carries the signed archive's URL, size and
// signature).
type updateFeed struct {
	dir      string
	mu       sync.Mutex
	requests map[string]int
	variants map[string][]byte
	variant  string
}

func (f *updateFeed) reset(variant string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requests = map[string]int{}
	f.variant = variant
}

func (f *updateFeed) counts() map[string]int {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[string]int, len(f.requests))
	for k, v := range f.requests {
		out[k] = v
	}
	return out
}

func (f *updateFeed) setVariant(name string, body []byte) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.variants[name] = body
}

func (f *updateFeed) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.requests[r.URL.Path]++
	variant := f.variant
	body, hasVariant := f.variants[variant]
	f.mu.Unlock()
	if r.URL.Path == "/update-"+fixtureTarget+".json" && hasVariant && variant != "real" {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
		return
	}
	http.FileServer(http.Dir(f.dir)).ServeHTTP(w, r)
}

type updateWhitebox struct {
	t          *testing.T
	root       string
	repo       string
	project    string
	cli        string
	keys       string
	identifier string
	feedDir    string
	feed       *updateFeed
	server     *httptest.Server
	certFile   string
	private    string
	parent     string
	old        fixtureBuild
	new        fixtureBuild
	beta       fixtureBuild
}

func newUpdateWhitebox(t *testing.T) *updateWhitebox {
	t.Helper()
	repo, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	h := &updateWhitebox{
		t: t, root: t.TempDir(), repo: repo,
		// A dummy identifier unique to this run keeps the fixture out of
		// any real app's preferences, Keychain or Launch Services entry.
		identifier: fmt.Sprintf("org.linksense.updatewhitebox.p122-%d-%d", os.Getpid(), time.Now().UnixNano()),
	}
	h.project = filepath.Join(h.root, "project")
	h.feedDir = filepath.Join(h.root, "feed")
	h.keys = filepath.Join(h.root, "keys")
	h.parent = filepath.Join(h.root, "Applications")
	for _, dir := range []string{h.project, h.feedDir, h.keys, h.parent, filepath.Join(h.project, "resources")} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	h.writeProject()
	h.buildCLI()
	// The fixture app is compiled with this feed, so it must live through
	// every build and scenario. Only the loopback certificate is trusted
	// through SSL_CERT_FILE; the system trust store is not changed.
	h.feed = &updateFeed{dir: h.feedDir, requests: map[string]int{}, variants: map[string][]byte{}}
	h.server = httptest.NewTLSServer(h.feed)
	t.Cleanup(h.server.Close)
	h.certFile = filepath.Join(h.root, "feed-cert.pem")
	cert := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: h.server.Certificate().Raw})
	if err := os.WriteFile(h.certFile, cert, 0o600); err != nil {
		t.Fatal(err)
	}
	h.keygen()
	h.old = h.build(fixtureOld, 0)
	h.publish(h.old)
	h.new = h.build(fixtureNew, 1)
	h.publish(h.new)
	if len(h.new.manifest.Deltas) != 1 || h.new.manifest.Deltas[0].From != fixtureOld {
		t.Fatalf("the second build published no delta from %s: %+v", fixtureOld, h.new.manifest)
	}
	h.beta = h.build(fixtureBeta, 0)
	h.prepareVariants()
	return h
}

func (h *updateWhitebox) writeProject() {
	h.t.Helper()
	mod, err := os.ReadFile(filepath.Join(h.repo, "apps/desktop/go.mod"))
	if err != nil {
		h.t.Fatal(err)
	}
	mod = bytes.Replace(mod, []byte("module github.com/LingX-AI/linksense/apps/desktop"), []byte("module linksense.updatewhitebox.fixture"), 1)
	sum, err := os.ReadFile(filepath.Join(h.repo, "apps/desktop/go.sum"))
	if err != nil {
		h.t.Fatal(err)
	}
	for name, data := range map[string][]byte{"go.mod": mod, "go.sum": sum, "main.go": []byte(fixtureMain)} {
		if err := os.WriteFile(filepath.Join(h.project, name), data, 0o644); err != nil {
			h.t.Fatal(err)
		}
	}
	// An unchanged large resource makes the delta a small download, while
	// the archive stays large enough to report progress in several reads.
	blob := make([]byte, fixtureBlobBytes)
	for i := range blob {
		blob[i] = byte((i*31 + i/251) % 251)
	}
	if err := os.WriteFile(filepath.Join(h.project, "resources", "blob.bin"), blob, 0o644); err != nil {
		h.t.Fatal(err)
	}
}

func (h *updateWhitebox) buildCLI() {
	h.t.Helper()
	binDir := filepath.Join(h.root, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		h.t.Fatal(err)
	}
	h.cli = filepath.Join(binDir, "mygo")
	cmd := exec.Command("go", "build", "-o", h.cli, "github.com/egoist/mygo/cmd/mygo")
	cmd.Dir = filepath.Join(h.repo, "apps/desktop")
	if out, err := cmd.CombinedOutput(); err != nil {
		h.t.Fatalf("building the pinned mygo CLI: %v\n%s", err, out)
	}
}

func (h *updateWhitebox) keygen() {
	h.t.Helper()
	cmd := exec.Command(h.cli, "keygen", "-o", h.keys)
	if out, err := cmd.CombinedOutput(); err != nil {
		h.t.Fatalf("mygo keygen: %v\n%s", err, out)
	}
	secret, err := os.ReadFile(filepath.Join(h.keys, "mygo-update.key"))
	if err != nil {
		h.t.Fatal(err)
	}
	if _, err := os.ReadFile(filepath.Join(h.keys, "mygo-update.pub")); err != nil {
		h.t.Fatal(err)
	}
	h.private = strings.TrimSpace(string(secret))
}

func (h *updateWhitebox) writeConfig(config map[string]any) error {
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(h.project, "mygo.json"), append(data, '\n'), 0o644)
}

// build runs the official CLI; the update private key travels only in the
// environment and is scrubbed from anything a failing test prints.
func (h *updateWhitebox) build(version string, deltas int) fixtureBuild {
	h.t.Helper()
	pub, err := os.ReadFile(filepath.Join(h.keys, "mygo-update.pub"))
	if err != nil {
		h.t.Fatal(err)
	}
	config := map[string]any{
		"name":       fixtureAppName,
		"slug":       fixtureSlug,
		"identifier": h.identifier,
		"version":    version,
		"out":        "dist-" + version,
		"macos":      map[string]any{"infoPlist": map[string]any{"LSUIElement": true}},
		"updates": map[string]any{
			"publicKey": strings.TrimSpace(string(pub)),
			"url":       h.server.URL,
			"deltas":    deltas,
		},
	}
	if err := h.writeConfig(config); err != nil {
		h.t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(h.project, "resources", "marker.txt"), []byte(version), 0o644); err != nil {
		h.t.Fatal(err)
	}
	out := filepath.Join(h.project, "dist-"+version)
	cmd := exec.Command(h.cli, "build", "-platform", "darwin/arm64", "-sign", "-", "-skip-dmg", "-skip-notarize", "-o", out)
	cmd.Dir = h.project
	cmd.Env = envWith(os.Environ(),
		"MYGO_UPDATER_PRIVATE_KEY="+h.private,
		"MYGO_LDFLAGS=",
		"SSL_CERT_FILE="+h.certFile,
		"GOTOOLCHAIN=auto",
		"GOFLAGS=-mod=mod",
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		h.t.Fatalf("mygo build %s: %v\n%s", version, err, bytes.ReplaceAll(output, []byte(h.private), []byte("[redacted]")))
	}
	dir := filepath.Join(out, fixtureTarget)
	build := fixtureBuild{app: filepath.Join(dir, fixtureAppName+".app")}
	entries, err := os.ReadDir(dir)
	if err != nil {
		h.t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		switch {
		case strings.HasSuffix(name, ".tar.gz"):
			build.archive = filepath.Join(dir, name)
		case name == "update-"+fixtureTarget+".json":
			data, err := os.ReadFile(filepath.Join(dir, name))
			if err != nil {
				h.t.Fatal(err)
			}
			if err := json.Unmarshal(data, &build.manifest); err != nil {
				h.t.Fatalf("manifest %s: %v", name, err)
			}
		}
	}
	if build.app == "" || build.archive == "" || build.manifest.Version != version {
		h.t.Fatalf("the build of %s is incomplete: %+v", version, build)
	}
	if _, err := os.Stat(build.app); err != nil {
		h.t.Fatalf("the build of %s holds no app: %v", version, err)
	}
	return build
}

// publish copies the signed artifacts the manifest names into the feed
// directory, keeping the older archive that a later delta build reads.
func (h *updateWhitebox) publish(build fixtureBuild) {
	h.t.Helper()
	dir := filepath.Dir(build.app)
	entries, err := os.ReadDir(dir)
	if err != nil {
		h.t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			h.t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(h.feedDir, entry.Name()), data, 0o644); err != nil {
			h.t.Fatal(err)
		}
	}
}

func (h *updateWhitebox) prepareVariants() {
	h.t.Helper()
	real, err := json.Marshal(h.new.manifest)
	if err != nil {
		h.t.Fatal(err)
	}
	h.feed.setVariant("real", real)

	full := h.new.manifest
	full.Deltas = nil
	if full.URL != h.server.URL+"/"+filepath.Base(h.new.archive) {
		h.t.Fatalf("the manifest does not name the archive on the fixture feed: %s", full.URL)
	}
	h.feed.setVariant("full", mustJSON(h.t, full))

	tampered := filepath.Join(h.feedDir, "tampered.tar.gz")
	mutateCopy(h.t, h.new.archive, tampered, func(data []byte) {
		data[len(data)/2] ^= 0xff
	})
	signed := full
	signed.URL = h.server.URL + "/tampered.tar.gz"
	h.feed.setVariant("tampered-archive", mustJSON(h.t, signed))

	corrupt := h.new.manifest
	if len(corrupt.Deltas) != 1 {
		h.t.Fatal("the build published no delta to corrupt")
	}
	// Copy the slice: the manifest struct shares it with h.new.manifest.
	corrupt.Deltas = append([]fixtureDelta(nil), corrupt.Deltas...)
	deltaPath := filepath.Join(h.feedDir, filepath.Base(fixtureURL(h.t, corrupt.Deltas[0].URL).Path))
	mutateCopy(h.t, deltaPath, filepath.Join(h.feedDir, "corrupt.delta"), func(data []byte) {
		data[len(data)/2] ^= 0xff
	})
	corrupt.Deltas[0].URL = h.server.URL + "/corrupt.delta"
	h.feed.setVariant("corrupt-delta", mustJSON(h.t, corrupt))
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func fixtureURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}

func mutateCopy(t *testing.T, source, target string, mutate func([]byte)) {
	t.Helper()
	data, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) < 2 {
		t.Fatalf("%s is too small to mutate", source)
	}
	mutate(data)
	if err := os.WriteFile(target, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

// install copies a built bundle to a disposable install location, which is
// what Enabled and installTarget consider the application.
func (h *updateWhitebox) install(t *testing.T, build fixtureBuild, name string) (app, parent string) {
	t.Helper()
	parent = filepath.Join(h.parent, name)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		t.Fatal(err)
	}
	app = filepath.Join(parent, fixtureAppName+".app")
	if err := copyTree(build.app, app); err != nil {
		t.Fatal(err)
	}
	return app, parent
}

func copyTree(source, target string) error {
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		dst := filepath.Join(target, rel)
		info, err := entry.Info()
		if err != nil {
			return err
		}
		switch {
		case entry.IsDir():
			return os.MkdirAll(dst, info.Mode().Perm())
		case info.Mode()&fs.ModeSymlink != 0:
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			return os.Symlink(link, dst)
		default:
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			return os.WriteFile(dst, data, info.Mode().Perm())
		}
	})
}

type runningFixture struct {
	cmd    *exec.Cmd
	out    string
	stderr *bytes.Buffer
	done   chan error
	exited atomic.Bool
}

func (h *updateWhitebox) start(t *testing.T, app, mode, marker string, hold time.Duration) *runningFixture {
	t.Helper()
	out := filepath.Join(t.TempDir(), "result.json")
	env := []string{
		"FIXTURE_MODE=" + mode,
		"FIXTURE_OUT=" + out,
		"FIXTURE_MARKER=" + marker,
		"FIXTURE_HOLD_MS=" + fmt.Sprint(hold.Milliseconds()),
		"SSL_CERT_FILE=" + h.certFile,
	}
	cmd := exec.Command(filepath.Join(app, "Contents", "MacOS", fixtureAppName))
	cmd.Env = envWith(os.Environ(), env...)
	stderr := &bytes.Buffer{}
	cmd.Stderr = stderr
	if err := cmd.Start(); err != nil {
		t.Fatalf("starting the fixture app: %v", err)
	}
	run := &runningFixture{cmd: cmd, out: out, stderr: stderr, done: make(chan error, 1)}
	go func() {
		err := cmd.Wait()
		run.exited.Store(true)
		run.done <- err
	}()
	t.Cleanup(func() {
		if !run.exited.Load() {
			_ = run.cmd.Process.Kill()
		}
	})
	return run
}

func (h *updateWhitebox) check(t *testing.T, app string) fixtureResult {
	t.Helper()
	run := h.start(t, app, "check", "", 0)
	if err := run.wait(t, 45*time.Second); err != nil {
		t.Fatalf("check process: %v\n%s", err, run.stderr)
	}
	return run.result(t)
}

func (r *runningFixture) result(t *testing.T) fixtureResult {
	t.Helper()
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(r.out)
		if err == nil && len(data) > 0 {
			var result fixtureResult
			if err := json.Unmarshal(data, &result); err != nil {
				t.Fatalf("fixture result: %v", err)
			}
			return result
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("the fixture wrote no result")
	return fixtureResult{}
}

func (r *runningFixture) wait(t *testing.T, timeout time.Duration) error {
	t.Helper()
	select {
	case err := <-r.done:
		return err
	case <-time.After(timeout):
		_ = r.cmd.Process.Kill()
		return errors.New("timeout")
	}
}

func (r *runningFixture) alive() bool {
	return !r.exited.Load()
}

// readBundleVersion returns nothing while the install helper is between its
// two renames, which is not a test failure.
func readBundleVersion(app string) string {
	output, err := exec.Command("/usr/bin/plutil", "-extract", "CFBundleShortVersionString", "raw", "-o", "-",
		filepath.Join(app, "Contents", "Info.plist")).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

func bundleVersion(t *testing.T, app string) string {
	t.Helper()
	version := readBundleVersion(app)
	if version == "" {
		t.Fatalf("reading the bundle version of %s", app)
	}
	return version
}

func readBundleMarker(app string) string {
	data, err := os.ReadFile(filepath.Join(app, "Contents", "Resources", "marker.txt"))
	if err != nil {
		return ""
	}
	return string(data)
}

func bundleMarker(t *testing.T, app string) string {
	t.Helper()
	marker := readBundleMarker(app)
	if marker == "" {
		t.Fatalf("reading the bundle marker of %s", app)
	}
	return marker
}

func waitFor(t *testing.T, timeout time.Duration, what string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func updateWorkDirs(t *testing.T, parent string) []string {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(parent, "."+fixtureAppName+".app.update-*"))
	if err != nil {
		t.Fatal(err)
	}
	return matches
}

func countPath(requests map[string]int, path string) int {
	return requests[path]
}

func artifactPaths(build fixtureBuild) (archive, delta string) {
	archive = filepath.Base(build.archive)
	if len(build.manifest.Deltas) > 0 {
		parsed, err := url.Parse(build.manifest.Deltas[0].URL)
		if err == nil {
			delta = filepath.Base(parsed.Path)
		}
	}
	return archive, delta
}

func envWith(base []string, values ...string) []string {
	remove := make(map[string]bool, len(values))
	for _, value := range values {
		key, _, _ := strings.Cut(value, "=")
		remove[key] = true
	}
	out := make([]string, 0, len(base)+len(values))
	for _, entry := range base {
		key, _, _ := strings.Cut(entry, "=")
		if !remove[key] {
			out = append(out, entry)
		}
	}
	return append(out, values...)
}

func runVersion(t *testing.T, h *updateWhitebox, app string) fixtureResult {
	t.Helper()
	run := h.start(t, app, "version", "", 0)
	if err := run.wait(t, 30*time.Second); err != nil {
		t.Fatalf("version process: %v\n%s", err, run.stderr)
	}
	return run.result(t)
}

func TestSignedUpdateInstallWhitebox(t *testing.T) {
	if testing.Short() {
		t.Skip("the signed update whitebox builds fixture apps")
	}
	h := newUpdateWhitebox(t)

	t.Run("check reads only the manifest", func(t *testing.T) {
		app, _ := h.install(t, h.old, "check")
		if version := bundleVersion(t, app); version != fixtureOld {
			t.Fatalf("fixture install is %s, not %s", version, fixtureOld)
		}
		h.feed.reset("real")
		result := h.check(t, app)
		if result.State != "available" || result.Offer != fixtureNew {
			t.Fatalf("unexpected check result: %+v", result)
		}
		if !result.Enabled {
			t.Fatal("the writable fixture bundle did not enable updates")
		}
		if result.AppVersion != fixtureOld {
			t.Fatalf("fixture runs %s, not %s", result.AppVersion, fixtureOld)
		}
		counts := h.feed.counts()
		manifestPath := "/update-" + fixtureTarget + ".json"
		if counts[manifestPath] == 0 {
			t.Fatalf("the check did not read the manifest: %v", counts)
		}
		archive, delta := artifactPaths(h.new)
		for path, count := range counts {
			if path != manifestPath {
				t.Fatalf("checking for updates downloaded %s (%d requests); all requests: %v", path, count, counts)
			}
		}
		if countPath(counts, "/"+archive) != 0 || delta != "" && countPath(counts, "/"+delta) != 0 {
			t.Fatalf("checking for updates downloaded an artifact: %v", counts)
		}
	})

	t.Run("signed full archive installs after exit", func(t *testing.T) {
		app, parent := h.install(t, h.old, "full")
		h.feed.reset("full")
		run := h.start(t, app, "install", "", 3*time.Second)
		result := run.result(t)
		if result.InstallError != "" || result.State != "available" {
			t.Fatalf("full install failed: %+v", result)
		}
		if !run.alive() {
			t.Fatal("the app exited before the old bundle was checked")
		}
		if version := bundleVersion(t, app); version != fixtureOld {
			t.Fatalf("the bundle was replaced to %s while the app still ran", version)
		}
		if marker := bundleMarker(t, app); marker != fixtureOld {
			t.Fatalf("the bundle image changed to %q while the app still ran", marker)
		}
		if err := run.wait(t, 30*time.Second); err != nil {
			t.Fatalf("fixture exit: %v\n%s", err, run.stderr)
		}
		waitFor(t, 20*time.Second, "the staged bundle replacement", func() bool {
			return readBundleVersion(app) == fixtureNew
		})
		if marker := bundleMarker(t, app); marker != fixtureNew {
			t.Fatalf("the replaced bundle holds %q, not %s", marker, fixtureNew)
		}
		// The helper removes its work directory right after the swap.
		waitFor(t, 20*time.Second, "the update work directory cleanup", func() bool {
			return len(updateWorkDirs(t, parent)) == 0
		})
		if version := runVersion(t, h, app).AppVersion; version != fixtureNew {
			t.Fatalf("the replaced executable reports %s, not %s", version, fixtureNew)
		}
		archive, _ := artifactPaths(h.new)
		counts := h.feed.counts()
		if countPath(counts, "/"+archive) != 1 {
			t.Fatalf("the full archive was not downloaded exactly once: %v", counts)
		}
		if len(result.Progress) == 0 {
			t.Fatal("the full archive reported no progress")
		}
		last := result.Progress[len(result.Progress)-1]
		if last.Total != h.new.manifest.Size || last.Downloaded != h.new.manifest.Size {
			t.Fatalf("progress did not complete: last=%+v size=%d", last, h.new.manifest.Size)
		}
	})

	t.Run("signature mismatch refuses and keeps the old copy", func(t *testing.T) {
		app, parent := h.install(t, h.old, "tampered")
		h.feed.reset("tampered-archive")
		run := h.start(t, app, "install", "", 0)
		if err := run.wait(t, 90*time.Second); err != nil {
			t.Fatalf("fixture exit: %v\n%s", err, run.stderr)
		}
		result := run.result(t)
		if result.InstallError == "" {
			t.Fatalf("a tampered archive installed: %+v", result)
		}
		if !strings.Contains(result.InstallError, "not signed with the app's key") {
			t.Fatalf("unexpected install failure: %s", result.InstallError)
		}
		if version := bundleVersion(t, app); version != fixtureOld {
			t.Fatalf("the refused update replaced the bundle with %s", version)
		}
		if marker := bundleMarker(t, app); marker != fixtureOld {
			t.Fatalf("the refused update changed the bundle image to %q", marker)
		}
		if dirs := updateWorkDirs(t, parent); len(dirs) != 0 {
			t.Fatalf("the refused update left work directories: %v", dirs)
		}
	})

	t.Run("signed delta installs when the current version matches", func(t *testing.T) {
		app, _ := h.install(t, h.old, "delta")
		h.feed.reset("real")
		run := h.start(t, app, "install", "", 2*time.Second)
		result := run.result(t)
		if result.InstallError != "" || result.State != "available" {
			t.Fatalf("delta install failed: %+v", result)
		}
		if err := run.wait(t, 30*time.Second); err != nil {
			t.Fatalf("fixture exit: %v\n%s", err, run.stderr)
		}
		waitFor(t, 20*time.Second, "the delta install", func() bool {
			return readBundleVersion(app) == fixtureNew
		})
		archive, delta := artifactPaths(h.new)
		counts := h.feed.counts()
		if delta == "" || countPath(counts, "/"+delta) != 1 {
			t.Fatalf("the delta was not downloaded once: %v", counts)
		}
		if countPath(counts, "/"+archive) != 0 {
			t.Fatalf("a working delta also downloaded the archive: %v", counts)
		}
		total := h.new.manifest.Deltas[0].Size
		for _, sample := range result.Progress {
			if sample.Total != total {
				t.Fatalf("delta progress reported total %d, want %d: %+v", sample.Total, total, result.Progress[:min(len(result.Progress), 5)])
			}
		}
		if len(result.Progress) == 0 {
			t.Fatal("the delta reported no progress")
		}
		if last := result.Progress[len(result.Progress)-1]; last.Downloaded != total {
			t.Fatalf("delta progress did not complete: %+v", last)
		}
	})

	t.Run("corrupt delta falls back to the full archive", func(t *testing.T) {
		app, _ := h.install(t, h.old, "corrupt")
		h.feed.reset("corrupt-delta")
		run := h.start(t, app, "install", "", 2*time.Second)
		result := run.result(t)
		if result.InstallError != "" || result.State != "available" {
			t.Fatalf("fallback install failed: %+v", result)
		}
		if err := run.wait(t, 30*time.Second); err != nil {
			t.Fatalf("fixture exit: %v\n%s", err, run.stderr)
		}
		waitFor(t, 20*time.Second, "the fallback install", func() bool {
			return readBundleVersion(app) == fixtureNew
		})
		archive, _ := artifactPaths(h.new)
		counts := h.feed.counts()
		if countPath(counts, "/corrupt.delta") != 1 || countPath(counts, "/"+archive) != 1 {
			t.Fatalf("the corrupt delta did not fall back to the archive: %v", counts)
		}
		// The delta download reports its own size first; the archive
		// download then restarts progress at zero with the archive size.
		deltaSize, archiveSize := h.new.manifest.Deltas[0].Size, h.new.manifest.Size
		var sawDelta, sawArchive bool
		firstArchiveDownloaded := int64(-1)
		for _, sample := range result.Progress {
			switch sample.Total {
			case deltaSize:
				sawDelta = true
			case archiveSize:
				sawArchive = true
				if firstArchiveDownloaded < 0 {
					firstArchiveDownloaded = sample.Downloaded
				}
			}
		}
		if !sawDelta || !sawArchive {
			t.Fatalf("progress did not restart for the full archive (delta=%d archive=%d): %.20v", deltaSize, archiveSize, result.Progress)
		}
		if firstArchiveDownloaded >= archiveSize {
			t.Fatalf("progress did not restart at the beginning of the archive download: %d of %d", firstArchiveDownloaded, archiveSize)
		}
	})

	t.Run("beta does not downgrade to stable", func(t *testing.T) {
		app, _ := h.install(t, h.beta, "beta")
		h.feed.reset("real")
		result := h.check(t, app)
		if result.AppVersion != fixtureBeta {
			t.Fatalf("fixture runs %s, not %s", result.AppVersion, fixtureBeta)
		}
		if result.State != "current" || result.Offer != "" {
			t.Fatalf("a beta was offered the older stable version: %+v", result)
		}
		counts := h.feed.counts()
		for path := range counts {
			if path != "/update-"+fixtureTarget+".json" {
				t.Fatalf("the beta check downloaded %s: %v", path, counts)
			}
		}
	})

	t.Run("read-only installation is unavailable without network", func(t *testing.T) {
		if os.Geteuid() == 0 {
			t.Skip("root can write next to a read-only bundle")
		}
		app, parent := h.install(t, h.old, "readonly")
		if err := os.Chmod(parent, 0o555); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Chmod(parent, 0o755) })
		h.feed.reset("real")
		result := h.check(t, app)
		if result.State != "unavailable" || result.Enabled {
			t.Fatalf("a read-only install did not degrade: %+v", result)
		}
		if counts := h.feed.counts(); len(counts) != 0 {
			t.Fatalf("a read-only install reached the network: %v", counts)
		}
	})

	t.Run("relaunch opens the replaced bundle", func(t *testing.T) {
		app, _ := h.install(t, h.old, "relaunch")
		h.feed.reset("full")
		marker := filepath.Join(t.TempDir(), "relaunched.json")
		run := h.start(t, app, "relaunch", marker, 0)
		result := run.result(t)
		if result.InstallError != "" || result.State != "available" {
			t.Fatalf("relaunch install failed: %+v", result)
		}
		if err := run.wait(t, 90*time.Second); err != nil {
			t.Fatalf("the first instance did not exit: %v\n%s", err, run.stderr)
		}
		waitFor(t, 30*time.Second, "the relaunched bundle", func() bool {
			return readBundleVersion(app) == fixtureNew
		})
		var relaunched fixtureResult
		waitFor(t, 30*time.Second, "the relaunched process marker", func() bool {
			data, err := os.ReadFile(marker)
			if err != nil {
				return false
			}
			return json.Unmarshal(data, &relaunched) == nil
		})
		if relaunched.AppVersion != fixtureNew {
			t.Fatalf("Launch Services opened %s, not %s", relaunched.AppVersion, fixtureNew)
		}
		if relaunched.PID == result.PID {
			t.Fatalf("the relaunched marker came from the old process %d", result.PID)
		}
	})
}
