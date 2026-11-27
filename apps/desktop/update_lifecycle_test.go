package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	jsonv2 "encoding/json/v2"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
	"github.com/egoist/mygo"
)

func newUpdateTestKey(t *testing.T) ed25519.PublicKey {
	t.Helper()
	publicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return publicKey
}

type fakeUpdateLease struct {
	releases atomic.Int32
}

func (lease *fakeUpdateLease) release() { lease.releases.Add(1) }

type updateHarness struct {
	mu            sync.Mutex
	prefs         map[string]any
	preferenceErr error
	opened        string
	sources       []mygo.UpdateSource
	quit          atomic.Int32
	relaunch      atomic.Int32
}

func (h *updateHarness) getPreference(key string, value any) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	raw, ok := h.prefs[key]
	if !ok {
		return false
	}
	target, ok := value.(*string)
	if !ok {
		return false
	}
	text, ok := raw.(string)
	if !ok {
		return false
	}
	*target = text
	return true
}

func (h *updateHarness) setPreference(key string, value any) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.preferenceErr != nil {
		return h.preferenceErr
	}
	h.prefs[key] = value
	return nil
}

func (h *updateHarness) applySource(source mygo.UpdateSource) {
	h.mu.Lock()
	h.sources = append(h.sources, source)
	h.mu.Unlock()
}

func (h *updateHarness) sourceCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.sources)
}

func isolateUpdateGlobals(t *testing.T) {
	t.Helper()
	feed, beta, installer, key := desktopUpdateFeed, desktopUpdateBetaFeed, desktopUpdateInstallerURL, desktopUpdateManifestKey
	desktopUpdateFeed, desktopUpdateBetaFeed, desktopUpdateInstallerURL, desktopUpdateManifestKey = "", "", "", ""
	t.Cleanup(func() {
		desktopUpdateFeed, desktopUpdateBetaFeed, desktopUpdateInstallerURL, desktopUpdateManifestKey = feed, beta, installer, key
	})
}

func newUpdateFixture(t *testing.T, configure ...func(*desktopUpdates, *updateHarness)) (*desktopUpdates, *updateHarness) {
	t.Helper()
	isolateUpdateGlobals(t)
	if desktopUpdateFeed == "" {
		desktopUpdateFeed = "https://updates.example.test/update-darwin-arm64.json"
	}
	if desktopUpdateManifestKey == "" {
		desktopUpdateManifestKey = base64.StdEncoding.EncodeToString(newUpdateTestKey(t))
	}
	h := &updateHarness{prefs: map[string]any{}}
	u := newDesktopUpdates(nil)
	u.enabled = func() bool { return true }
	u.check = func(context.Context) (*mygo.Update, error) { return nil, nil }
	u.install = func(context.Context, *mygo.Update, func(int64, int64)) error { return nil }
	u.acquire = func(context.Context) (updateLease, error) { return &fakeUpdateLease{}, nil }
	u.relaunch = func() { h.relaunch.Add(1) }
	u.quit = func() { h.quit.Add(1) }
	u.openInstaller = func(raw string) error {
		h.mu.Lock()
		h.opened = raw
		h.mu.Unlock()
		return nil
	}
	u.getPreference = h.getPreference
	u.setPreference = h.setPreference
	u.applySource = h.applySource
	if len(configure) > 0 {
		configure[0](u, h)
	}
	u.setPreferences(true)
	u.start()
	return u, h
}

func makeUpdateAvailable(t *testing.T, u *desktopUpdates, version string) DesktopUpdateResult {
	t.Helper()
	u.check = func(context.Context) (*mygo.Update, error) {
		return &mygo.Update{Version: version, Notes: "untrusted release notes"}, nil
	}
	result, err := u.checkRequest(context.Background())
	if err != nil || result.State != UpdateAvailable || result.Version != version {
		t.Fatalf("check did not offer %s: %+v, %v", version, result, err)
	}
	return result
}

func TestUpdateCheckOffersOnlyValidatedVersion(t *testing.T) {
	if state := newDesktopUpdates(nil).stateRequest(); state.State != UpdateUnavailable {
		t.Fatalf("an unstarted lifecycle returned %+v", state)
	}
	u, _ := newUpdateFixture(t)
	current, err := u.checkRequest(context.Background())
	if err != nil || current.State != UpdateCurrent || current.Revision == 0 {
		t.Fatalf("an up-to-date check returned %+v, %v", current, err)
	}

	available := makeUpdateAvailable(t, u, "1.2.3")
	if available.Revision <= current.Revision {
		t.Fatal("check did not advance the revision")
	}
	if available.Channel != UpdateChannelStable || available.BetaAvailable ||
		!available.InstallAvailable || available.DownloadAvailable {
		t.Fatalf("unexpected capability metadata: %+v", available)
	}
	if available.Notes != "untrusted release notes" {
		t.Fatalf("verified candidate notes = %q", available.Notes)
	}
	raw, err := json.Marshal(available)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"notes":"untrusted release notes"`) {
		t.Fatalf("verified candidate notes missing from result: %s", raw)
	}

	u.check = func(context.Context) (*mygo.Update, error) {
		return &mygo.Update{Version: "1.2.3\nuntrusted"}, nil
	}
	failed, err := u.checkRequest(context.Background())
	if err != nil || failed.State != UpdateFailed || failed.Version != "" || failed.Revision <= available.Revision {
		t.Fatalf("a malformed version returned %+v, %v", failed, err)
	}

	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := u.checkRequest(canceled); !errors.Is(err, errDesktopUpdateBusy) {
		t.Fatalf("a canceled caller context started a check: %v", err)
	}
	u.check = func(context.Context) (*mygo.Update, error) { return nil, mygo.ErrUpdatesDisabled }
	disabled, err := u.checkRequest(context.Background())
	if err != nil || disabled.State != UpdateUnavailable {
		t.Fatalf("a disabled feed returned %+v, %v", disabled, err)
	}
}

func TestUpdateNotesAreBoundedValidText(t *testing.T) {
	limit := strings.Repeat("a", maxUpdateNotesBytes)
	for _, test := range []struct {
		name  string
		notes string
		want  string
	}{
		{"trims surrounding blanks", "  <b>literal</b>\nline\t", "<b>literal</b>\nline"},
		{"keeps internal whitespace", "one\n\ntwo   three", "one\n\ntwo   three"},
		{"rejects invalid utf8", string([]byte{0xff, 0xfe}), ""},
		{"rejects control characters", "bad\x00text", ""},
		{"rejects oversized notes", limit + "a", ""},
		{"accepts the byte limit", limit, limit},
		{"rejects blank notes", " \n\t ", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := sanitizeDesktopUpdateNotes(test.notes); got != test.want {
				t.Fatalf("sanitized notes = %q, want %q", got, test.want)
			}
		})
	}
}

func TestUpdateNotesFollowCandidateRevisionAndReset(t *testing.T) {
	notesA := "Release notes <b>literal</b> & https://updates.example.test/notes\nSecond line"
	u, _ := newUpdateFixture(t)
	u.check = func(context.Context) (*mygo.Update, error) {
		return &mygo.Update{Version: "0.2.0", Notes: notesA}, nil
	}
	available, err := u.checkRequest(context.Background())
	if err != nil || available.State != UpdateAvailable || available.Notes != notesA {
		t.Fatalf("verified candidate notes = %+v, %v", available, err)
	}
	u.acquire = func(context.Context) (updateLease, error) { return &fakeUpdateLease{}, nil }
	u.install = func(context.Context, *mygo.Update, func(int64, int64)) error {
		return errors.New("staging failed")
	}
	failed, err := u.installRequest(context.Background(), available.Revision)
	if err != nil || failed.State != UpdateInstallFailed || failed.Notes != notesA {
		t.Fatalf("retry snapshot lost its candidate notes: %+v, %v", failed, err)
	}
	u.install = func(context.Context, *mygo.Update, func(int64, int64)) error { return nil }
	staged, err := u.installRequest(context.Background(), failed.Revision)
	if err != nil || staged.State != UpdateStaged || staged.Notes != notesA {
		t.Fatalf("staged snapshot lost its candidate notes: %+v, %v", staged, err)
	}

	u2, _ := newUpdateFixture(t, func(_ *desktopUpdates, _ *updateHarness) {
		desktopUpdateBetaFeed = "https://updates.example.test/beta/update-darwin-arm64.json"
	})
	u2.check = func(context.Context) (*mygo.Update, error) {
		return &mygo.Update{Version: "0.3.0", Notes: "New candidate notes"}, nil
	}
	next, err := u2.checkRequest(context.Background())
	if err != nil || next.State != UpdateAvailable || next.Notes != "New candidate notes" {
		t.Fatalf("new candidate notes = %+v, %v", next, err)
	}
	switched, err := u2.setChannelRequest(string(UpdateChannelBeta))
	if err != nil || switched.State != UpdateIdle || switched.Notes != "" {
		t.Fatalf("channel change kept candidate notes: %+v, %v", switched, err)
	}
	u2.check = func(context.Context) (*mygo.Update, error) {
		return &mygo.Update{Version: "0.4.0", Notes: "Beta candidate notes"}, nil
	}
	beta, err := u2.checkRequest(context.Background())
	if err != nil || beta.State != UpdateAvailable || beta.Channel != UpdateChannelBeta ||
		beta.Notes != "Beta candidate notes" {
		t.Fatalf("beta candidate notes = %+v, %v", beta, err)
	}
	u2.check = func(context.Context) (*mygo.Update, error) { return nil, nil }
	current, err := u2.checkRequest(context.Background())
	if err != nil || current.State != UpdateCurrent || current.Notes != "" {
		t.Fatalf("no-candidate snapshot kept notes: %+v, %v", current, err)
	}
}

func TestUpdateInstallFailureReleasesLeaseAndKeepsVersionForRetry(t *testing.T) {
	u, h := newUpdateFixture(t)
	available := makeUpdateAvailable(t, u, "0.2.0")
	lease := &fakeUpdateLease{}
	u.acquire = func(context.Context) (updateLease, error) { return lease, nil }
	u.install = func(context.Context, *mygo.Update, func(int64, int64)) error {
		return errors.New("staging failed")
	}
	result, err := u.installRequest(context.Background(), available.Revision)
	if err != nil {
		t.Fatalf("install failure surfaced as an RPC error: %v", err)
	}
	if result.State != UpdateInstallFailed || result.Version != "0.2.0" || result.Revision <= available.Revision {
		t.Fatalf("install failure lost its retry state: %+v", result)
	}
	if lease.releases.Load() != 1 {
		t.Fatalf("failed install released its lease %d times", lease.releases.Load())
	}
	if h.quit.Load() != 0 || h.relaunch.Load() != 0 {
		t.Fatal("a failed install quit or relaunched the app")
	}

	retry := &fakeUpdateLease{}
	u.acquire = func(context.Context) (updateLease, error) { return retry, nil }
	u.install = func(context.Context, *mygo.Update, func(int64, int64)) error { return nil }
	staged, err := u.installRequest(context.Background(), result.Revision)
	if err != nil || staged.State != UpdateStaged || staged.Version != "0.2.0" {
		t.Fatalf("retry did not stage: %+v, %v", staged, err)
	}
	if staged.Revision <= result.Revision {
		t.Fatal("staging did not advance the revision")
	}
	if retry.releases.Load() != 0 {
		t.Fatal("a staged install released the runner lease")
	}
	if h.relaunch.Load() != 0 {
		t.Fatal("staging installed without an explicit restart")
	}
}

func TestUpdateInstallCancellationReleasesLease(t *testing.T) {
	u, _ := newUpdateFixture(t)
	available := makeUpdateAvailable(t, u, "0.2.0")
	lease := &fakeUpdateLease{}
	u.acquire = func(context.Context) (updateLease, error) { return lease, nil }
	installStarted := make(chan struct{})
	u.install = func(ctx context.Context, _ *mygo.Update, _ func(int64, int64)) error {
		close(installStarted)
		<-ctx.Done()
		return ctx.Err()
	}
	done := make(chan DesktopUpdateResult, 1)
	go func() {
		result, _ := u.installRequest(context.Background(), available.Revision)
		done <- result
	}()
	<-installStarted
	u.mu.Lock()
	cancel := u.requestCancel
	u.mu.Unlock()
	if cancel == nil {
		t.Fatal("install exposed no cancellation")
	}
	cancel()
	result := <-done
	if result.State != UpdateInstallFailed || result.Version != "0.2.0" {
		t.Fatalf("cancelled install returned %+v", result)
	}
	if lease.releases.Load() != 1 {
		t.Fatalf("cancelled install released its lease %d times", lease.releases.Load())
	}
}

func TestStagedUpdateKeepsLeaseAndRequiresExplicitRestart(t *testing.T) {
	u, h := newUpdateFixture(t, func(_ *desktopUpdates, _ *updateHarness) {
		desktopUpdateBetaFeed = "https://updates.example.test/beta/update-darwin-arm64.json"
	})
	available := makeUpdateAvailable(t, u, "0.2.0")
	lease := &fakeUpdateLease{}
	u.acquire = func(context.Context) (updateLease, error) { return lease, nil }
	result, err := u.installRequest(context.Background(), available.Revision)
	if err != nil || result.State != UpdateStaged || result.Revision <= available.Revision {
		t.Fatalf("staging returned %+v, %v", result, err)
	}
	if lease.releases.Load() != 0 {
		t.Fatal("staged update released the runner lease")
	}
	if h.relaunch.Load() != 0 || h.quit.Load() != 0 {
		t.Fatal("staging auto-installed or restarted")
	}

	checkCalls := 0
	u.check = func(context.Context) (*mygo.Update, error) {
		checkCalls++
		return nil, nil
	}
	checked, err := u.checkRequest(context.Background())
	if err != nil || checked.State != UpdateStaged || checkCalls != 0 {
		t.Fatalf("check disturbed a staged update: %+v, calls=%d, %v", checked, checkCalls, err)
	}
	if _, err := u.installRequest(context.Background(), result.Revision); !errors.Is(err, errDesktopUpdateStale) {
		t.Fatalf("a staged update was installed again: %v", err)
	}

	changed, err := u.setChannelRequest(string(UpdateChannelBeta))
	if err != nil || changed.State != UpdateStaged || changed.Channel != UpdateChannelBeta {
		t.Fatalf("channel change disturbed staging: %+v, %v", changed, err)
	}
	if changed.Revision <= result.Revision {
		t.Fatal("channel change did not advance the revision")
	}

	if err := u.restartRequest(); err != nil || h.relaunch.Load() != 1 {
		t.Fatalf("explicit restart failed: %v, relaunches=%d", err, h.relaunch.Load())
	}
	if err := u.restartRequest(); !errors.Is(err, errDesktopUpdateBusy) {
		t.Fatalf("double restart returned %v", err)
	}
	if !u.beforeQuit(false) {
		t.Fatal("a staged update blocked an ordinary quit")
	}
}

func TestUpdateProgressUsesRealCountsAndEmitsStrictlyIncreasingSnapshots(t *testing.T) {
	u, _ := newUpdateFixture(t)
	available := makeUpdateAvailable(t, u, "0.2.0")
	u.acquire = func(context.Context) (updateLease, error) { return &fakeUpdateLease{}, nil }
	var first, duplicate, second, reset DesktopUpdateResult
	u.install = func(_ context.Context, _ *mygo.Update, progress func(int64, int64)) error {
		progress(0, 100)
		first = u.stateRequest()
		progress(0, 100)
		duplicate = u.stateRequest()
		progress(50, 100)
		second = u.stateRequest()
		// The delta failed: MyGo restarts with the whole archive.
		progress(10, 1000)
		reset = u.stateRequest()
		for _, invalid := range [][2]int64{{-1, 100}, {5, 0}, {2000, 1000}, {1, maxUpdateDownloadSize + 1}} {
			progress(invalid[0], invalid[1])
		}
		return nil
	}
	staged, err := u.installRequest(context.Background(), available.Revision)
	if err != nil || staged.State != UpdateStaged {
		t.Fatalf("install returned %+v, %v", staged, err)
	}
	if first.Downloaded == nil || *first.Downloaded != 0 || first.Total == nil || *first.Total != 100 {
		t.Fatalf("zero-with-positive-total was not observable: %+v", first)
	}
	raw, err := json.Marshal(first)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"downloaded":0`) || !strings.Contains(string(raw), `"total":100`) {
		t.Fatalf("zero progress JSON = %s", raw)
	}
	if duplicate.Revision != first.Revision {
		t.Fatal("an unchanged progress callback advanced the revision")
	}
	if !(first.Revision < second.Revision && second.Revision < reset.Revision && reset.Revision < staged.Revision) {
		t.Fatalf("progress revisions are not strictly increasing: %d, %d, %d, %d",
			first.Revision, second.Revision, reset.Revision, staged.Revision)
	}
	if second.Downloaded == nil || *second.Downloaded != 50 || second.Total == nil || *second.Total != 100 {
		t.Fatalf("second progress = %+v", second)
	}
	if reset.Downloaded == nil || *reset.Downloaded != 10 || reset.Total == nil || *reset.Total != 1000 {
		t.Fatalf("delta fallback progress = %+v", reset)
	}
	if staged.Revision != u.stateRequest().Revision || staged.Revision == 0 {
		t.Fatalf("staged snapshot revision = %d, state revision = %d", staged.Revision, u.stateRequest().Revision)
	}
}

func TestUpdateInstallRequiresTheRevisionThatProducedTheSelection(t *testing.T) {
	u, _ := newUpdateFixture(t)
	available := makeUpdateAvailable(t, u, "0.2.0")
	acquireCalls := 0
	u.acquire = func(context.Context) (updateLease, error) {
		acquireCalls++
		return &fakeUpdateLease{}, nil
	}
	for _, revision := range []int64{0, available.Revision - 1, available.Revision + 1} {
		if _, err := u.installRequest(context.Background(), revision); !errors.Is(err, errDesktopUpdateStale) {
			t.Fatalf("stale revision %d returned %v", revision, err)
		}
	}
	if acquireCalls != 0 {
		t.Fatal("a stale selection reached the runner admission")
	}

	rechecked := makeUpdateAvailable(t, u, "0.3.0")
	if _, err := u.installRequest(context.Background(), available.Revision); !errors.Is(err, errDesktopUpdateStale) {
		t.Fatalf("an older check's revision was accepted: %v", err)
	}
	u.mu.Lock()
	u.available.Version = "9.9.9"
	u.mu.Unlock()
	if _, err := u.installRequest(context.Background(), rechecked.Revision); !errors.Is(err, errDesktopUpdateStale) {
		t.Fatalf("a mismatched version was accepted: %v", err)
	}

	u.mu.Lock()
	u.available.Version = "0.3.0"
	u.mu.Unlock()
	u.mu.Lock()
	u.betaSource = &desktopUpdateSource{}
	u.mu.Unlock()
	if _, err := u.setChannelRequest(string(UpdateChannelBeta)); err != nil {
		t.Fatal(err)
	}
	if _, err := u.installRequest(context.Background(), rechecked.Revision); !errors.Is(err, errDesktopUpdateStale) {
		t.Fatalf("a check from before a channel change was accepted: %v", err)
	}

	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	available = makeUpdateAvailable(t, u, "0.4.0")
	if _, err := u.installRequest(canceled, available.Revision); !errors.Is(err, errDesktopUpdateBusy) {
		t.Fatalf("a canceled caller context started an install: %v", err)
	}
	if acquireCalls != 0 {
		t.Fatal("a canceled caller context reached the runner admission")
	}
}

func TestUpdateInstallUsesAppContextAfterAdmission(t *testing.T) {
	u, _ := newUpdateFixture(t)
	available := makeUpdateAvailable(t, u, "0.2.0")
	granted := make(chan struct{})
	proceed := make(chan struct{})
	u.acquire = func(context.Context) (updateLease, error) {
		close(granted)
		return &fakeUpdateLease{}, nil
	}
	u.install = func(ctx context.Context, _ *mygo.Update, _ func(int64, int64)) error {
		<-proceed
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return nil
	}
	caller, cancel := context.WithCancel(context.Background())
	done := make(chan DesktopUpdateResult, 1)
	go func() {
		result, _ := u.installRequest(caller, available.Revision)
		done <- result
	}()
	<-granted
	cancel()
	close(proceed)
	if result := <-done; result.State != UpdateStaged {
		t.Fatalf("install followed the unloaded caller context: %+v", result)
	}
}

func TestUpdateInstallReportsBusyAdmissionAndAllowsRetry(t *testing.T) {
	u, _ := newUpdateFixture(t)
	available := makeUpdateAvailable(t, u, "0.2.0")
	u.acquire = func(context.Context) (updateLease, error) { return nil, errUpdateAdmissionBusy }
	result, err := u.installRequest(context.Background(), available.Revision)
	if err != nil || result.State != UpdateBusy || result.Version != "0.2.0" || result.Revision <= available.Revision {
		t.Fatalf("busy runner returned %+v, %v", result, err)
	}
	u.acquire = func(context.Context) (updateLease, error) { return &fakeUpdateLease{}, nil }
	result, err = u.installRequest(context.Background(), result.Revision)
	if err != nil || result.State != UpdateStaged {
		t.Fatalf("retry after busy returned %+v, %v", result, err)
	}
}

func TestUpdateInstallAdmitsWithoutARunner(t *testing.T) {
	isolateUpdateGlobals(t)
	desktopUpdateFeed = "https://updates.example.test/update-darwin-arm64.json"
	desktopUpdateManifestKey = base64.StdEncoding.EncodeToString(newUpdateTestKey(t))
	// The v1 app has no local runtime; an install must not require one.
	d := &Desktop{}
	u := newDesktopUpdates(d)
	u.enabled = func() bool { return true }
	u.install = func(context.Context, *mygo.Update, func(int64, int64)) error { return nil }
	u.relaunch = func() {}
	u.quit = func() {}
	u.applySource = func(mygo.UpdateSource) {}
	u.getPreference = func(string, any) bool { return false }
	u.setPreference = func(string, any) error { return nil }
	u.setPreferences(true)
	u.start()
	available := makeUpdateAvailable(t, u, "0.2.0")
	result, err := u.installRequest(context.Background(), available.Revision)
	if err != nil || result.State != UpdateStaged {
		t.Fatalf("runtime-free install returned %+v, %v", result, err)
	}
}

func TestUpdateInstallFailsClosedOnANilLease(t *testing.T) {
	u, _ := newUpdateFixture(t)
	u.acquire = func(context.Context) (updateLease, error) { return nil, nil }
	available := makeUpdateAvailable(t, u, "0.2.0")
	result, err := u.installRequest(context.Background(), available.Revision)
	if !errors.Is(err, errUpdateAdmissionUnavailable) {
		t.Fatalf("a nil lease reported %v", err)
	}
	if result.State != UpdateInstallFailed || result.Version != "0.2.0" {
		t.Fatalf("a nil lease returned %+v", result)
	}
}

func TestUpdateQuitDuringInstallReleasesThenQuits(t *testing.T) {
	u, h := newUpdateFixture(t)
	available := makeUpdateAvailable(t, u, "0.2.0")
	lease := &fakeUpdateLease{}
	u.acquire = func(context.Context) (updateLease, error) { return lease, nil }
	installStarted := make(chan struct{})
	u.install = func(ctx context.Context, _ *mygo.Update, _ func(int64, int64)) error {
		close(installStarted)
		<-ctx.Done()
		return ctx.Err()
	}
	done := make(chan DesktopUpdateResult, 1)
	go func() {
		result, _ := u.installRequest(context.Background(), available.Revision)
		done <- result
	}()
	<-installStarted
	if u.beforeQuit(false) {
		t.Fatal("an ordinary quit proceeded during install")
	}
	result := <-done
	if result.State != UpdateInstallFailed || result.Version != "0.2.0" {
		t.Fatalf("cancelled install returned %+v", result)
	}
	if lease.releases.Load() != 1 {
		t.Fatal("quit cancellation did not release the runner lease")
	}
	if h.quit.Load() != 1 {
		t.Fatalf("deferred quit ran %d times", h.quit.Load())
	}
	if h.relaunch.Load() != 0 {
		t.Fatal("a cancelled install relaunched")
	}
}

func TestUpdateSessionEndingCancelsInstallAndNeverDefersQuit(t *testing.T) {
	u, h := newUpdateFixture(t)
	available := makeUpdateAvailable(t, u, "0.2.0")
	lease := &fakeUpdateLease{}
	u.acquire = func(context.Context) (updateLease, error) { return lease, nil }
	installStarted := make(chan struct{})
	u.install = func(ctx context.Context, _ *mygo.Update, _ func(int64, int64)) error {
		close(installStarted)
		<-ctx.Done()
		return ctx.Err()
	}
	done := make(chan struct{})
	go func() {
		_, _ = u.installRequest(context.Background(), available.Revision)
		close(done)
	}()
	<-installStarted
	if !u.beforeQuit(true) {
		t.Fatal("a session end was treated as cancelable")
	}
	<-done
	if lease.releases.Load() != 1 {
		t.Fatal("session end did not release the runner lease")
	}
	if h.quit.Load() != 0 {
		t.Fatal("an OS session end deferred a second quit")
	}
	shutdownDone := make(chan struct{})
	go func() {
		u.shutdown()
		close(shutdownDone)
	}()
	select {
	case <-shutdownDone:
	case <-time.After(2 * time.Second):
		t.Fatal("shutdown waited on a finished install")
	}
}

func TestUpdateQuitAcceptedRefusesAllNewWork(t *testing.T) {
	u, _ := newUpdateFixture(t)
	available := makeUpdateAvailable(t, u, "0.2.0")
	acquireCalls := 0
	u.acquire = func(context.Context) (updateLease, error) {
		acquireCalls++
		return &fakeUpdateLease{}, nil
	}
	if !u.beforeQuit(false) {
		t.Fatal("idle quit was blocked")
	}
	if _, err := u.installRequest(context.Background(), available.Revision); !errors.Is(err, errDesktopUpdateBusy) {
		t.Fatalf("install after quit returned %v", err)
	}
	if _, err := u.checkRequest(context.Background()); !errors.Is(err, errDesktopUpdateBusy) {
		t.Fatalf("check after quit returned %v", err)
	}
	if _, err := u.setChannelRequest(string(UpdateChannelBeta)); !errors.Is(err, errDesktopUpdateBusy) {
		t.Fatalf("channel change after quit returned %v", err)
	}
	if err := u.openInstallerRequest(); !errors.Is(err, errDesktopUpdateBusy) {
		t.Fatalf("installer after quit returned %v", err)
	}
	if acquireCalls != 0 {
		t.Fatal("work reached the runner after quit was accepted")
	}
	u.quitCanceled()
	if u.quitAccepted {
		t.Fatal("a canceled quit left the app unable to update")
	}
}

func TestUpdateConcurrentInstallCheckAndChannelAreSerialized(t *testing.T) {
	u, _ := newUpdateFixture(t)
	available := makeUpdateAvailable(t, u, "0.2.0")
	acquireStarted := make(chan struct{})
	releaseAcquire := make(chan struct{})
	lease := &fakeUpdateLease{}
	u.acquire = func(context.Context) (updateLease, error) {
		close(acquireStarted)
		<-releaseAcquire
		return lease, nil
	}
	u.install = func(context.Context, *mygo.Update, func(int64, int64)) error { return nil }
	done := make(chan DesktopUpdateResult, 1)
	go func() {
		result, _ := u.installRequest(context.Background(), available.Revision)
		done <- result
	}()
	<-acquireStarted
	if _, err := u.installRequest(context.Background(), available.Revision); !errors.Is(err, errDesktopUpdateBusy) {
		t.Fatalf("double install returned %v", err)
	}
	if _, err := u.checkRequest(context.Background()); !errors.Is(err, errDesktopUpdateBusy) {
		t.Fatalf("check during install returned %v", err)
	}
	if _, err := u.setChannelRequest(string(UpdateChannelBeta)); !errors.Is(err, errDesktopUpdateBusy) {
		t.Fatalf("channel change during install returned %v", err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				_ = u.stateRequest()
			}
		}()
	}
	close(releaseAcquire)
	result := <-done
	wg.Wait()
	if result.State != UpdateStaged {
		t.Fatalf("serialized install returned %+v", result)
	}
}

func TestUpdateShutdownWaitsForInFlightInstall(t *testing.T) {
	u, _ := newUpdateFixture(t)
	available := makeUpdateAvailable(t, u, "0.2.0")
	installStarted := make(chan struct{})
	releaseInstall := make(chan struct{})
	var shutdownReturned atomic.Bool
	u.acquire = func(context.Context) (updateLease, error) { return &fakeUpdateLease{}, nil }
	u.install = func(ctx context.Context, _ *mygo.Update, _ func(int64, int64)) error {
		close(installStarted)
		<-ctx.Done()
		<-releaseInstall
		return ctx.Err()
	}
	go func() { _, _ = u.installRequest(context.Background(), available.Revision) }()
	<-installStarted
	done := make(chan struct{})
	go func() {
		u.shutdown()
		shutdownReturned.Store(true)
		close(done)
	}()
	time.Sleep(20 * time.Millisecond)
	if shutdownReturned.Load() {
		t.Fatal("shutdown returned before the install unwound")
	}
	close(releaseInstall)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("shutdown did not wait for the install")
	}
	u.mu.Lock()
	requestDone := u.requestDone
	u.mu.Unlock()
	if requestDone == nil {
		t.Fatal("install completion channel was cleared")
	}
}

func TestUpdateChannelPreferencePersistsAndFailsClosed(t *testing.T) {
	u, h := newUpdateFixture(t, func(_ *desktopUpdates, h *updateHarness) {
		desktopUpdateBetaFeed = "https://updates.example.test/beta/update-darwin-arm64.json"
		h.prefs[updateChannelPreference] = string(UpdateChannelBeta)
	})
	state := u.stateRequest()
	if state.Channel != UpdateChannelBeta || !state.BetaAvailable || !state.InstallAvailable {
		t.Fatalf("stored beta channel was not restored: %+v", state)
	}
	before := state.Revision
	switched, err := u.setChannelRequest(string(UpdateChannelStable))
	if err != nil || switched.Channel != UpdateChannelStable || switched.State != UpdateIdle {
		t.Fatalf("channel switch returned %+v, %v", switched, err)
	}
	if switched.Revision <= before {
		t.Fatal("channel switch did not advance the revision")
	}
	h.mu.Lock()
	stored := h.prefs[updateChannelPreference]
	h.mu.Unlock()
	if stored != string(UpdateChannelStable) {
		t.Fatalf("channel was not persisted: %v", stored)
	}

	h.mu.Lock()
	h.preferenceErr = errors.New("disk full")
	h.mu.Unlock()
	if _, err := u.setChannelRequest(string(UpdateChannelBeta)); !errors.Is(err, errDesktopUpdatePreferenceFailed) {
		t.Fatalf("failed preference write returned %v", err)
	}
	if u.stateRequest().Channel != UpdateChannelStable {
		t.Fatal("failed preference write changed the channel")
	}
	h.mu.Lock()
	h.preferenceErr = nil
	h.mu.Unlock()
	u.setPreferences(false)
	if _, err := u.setChannelRequest(string(UpdateChannelBeta)); !errors.Is(err, errDesktopUpdatePreferenceFailed) {
		t.Fatalf("unwritable preferences returned %v", err)
	}
}

func TestReadOnlyUpdateReturnsUnavailableWithInstallerFallback(t *testing.T) {
	u, h := newUpdateFixture(t, func(u *desktopUpdates, _ *updateHarness) {
		u.enabled = func() bool { return false }
		desktopUpdateInstallerURL = "https://updates.example.test/install"
	})
	state := u.stateRequest()
	if state.State != UpdateUnavailable || state.InstallAvailable || !state.DownloadAvailable {
		t.Fatalf("read-only install position returned %+v", state)
	}
	if state.Channel != "" || state.BetaAvailable {
		t.Fatalf("read-only result exposed channel controls: %+v", state)
	}
	checks := 0
	u.check = func(context.Context) (*mygo.Update, error) {
		checks++
		return nil, nil
	}
	if result, err := u.checkRequest(context.Background()); err != nil || result.State != UpdateUnavailable || checks != 0 {
		t.Fatalf("read-only check returned %+v, %v, calls=%d", result, err, checks)
	}
	if _, err := u.installRequest(context.Background(), 1); !errors.Is(err, errDesktopUpdateUnavailable) {
		t.Fatalf("read-only install returned %v", err)
	}
	if err := u.openInstallerRequest(); err != nil {
		t.Fatal(err)
	}
	h.mu.Lock()
	opened := h.opened
	h.mu.Unlock()
	if opened != "https://updates.example.test/install" {
		t.Fatalf("installer opened %q", opened)
	}
	u.openInstaller = func(string) error { return errors.New("no browser") }
	if err := u.openInstallerRequest(); !errors.Is(err, errDesktopUpdateInstallerUnavailable) {
		t.Fatalf("installer failure returned %v", err)
	}
	if h.sourceCount() != 0 {
		t.Fatal("a read-only build changed MyGo's update source")
	}
}

func TestInvalidUpdateFeedFailsClosed(t *testing.T) {
	u, h := newUpdateFixture(t, func(_ *desktopUpdates, _ *updateHarness) {
		desktopUpdateFeed = "file:///tmp/update-darwin-arm64.json"
	})
	state := u.stateRequest()
	if state.State != UpdateUnavailable || state.InstallAvailable {
		t.Fatalf("invalid feed returned %+v", state)
	}
	checks := 0
	u.check = func(context.Context) (*mygo.Update, error) {
		checks++
		return nil, nil
	}
	if _, err := u.checkRequest(context.Background()); err != nil {
		t.Fatal(err)
	}
	if checks != 0 {
		t.Fatal("an invalid feed reached the updater")
	}
	if h.sourceCount() != 0 {
		t.Fatal("an invalid feed changed MyGo's update source")
	}
	if _, err := u.installRequest(context.Background(), 1); !errors.Is(err, errDesktopUpdateUnavailable) {
		t.Fatalf("invalid feed install returned %v", err)
	}
}

func TestUpdateInstallerAllowsHTTPAndHTTPS(t *testing.T) {
	for _, test := range []struct {
		raw  string
		want string
	}{
		{"https://updates.example.test/install", "https://updates.example.test/install"},
		{"https://updates.example.test/install?lang=zh", "https://updates.example.test/install?lang=zh"},
		{"http://updates.example.test/install", "http://updates.example.test/install"},
		{"http://127.0.0.1:8080/install", "http://127.0.0.1:8080/install"},
		{"https://user@updates.example.test/install", ""},
		{"https://updates.example.test/install#fragment", ""},
		{"javascript:alert(1)", ""},
	} {
		if got := parseDesktopUpdateInstaller(test.raw); got != test.want {
			t.Fatalf("installer %q parsed to %q, want %q", test.raw, got, test.want)
		}
	}
}

func TestLegacyUpdateCheckKeepsPackageFeedAndInstallerFallback(t *testing.T) {
	isolateUpdateGlobals(t)
	desktopUpdateInstallerURL = "https://updates.example.test/install"
	available := legacyDesktopUpdate(context.Background(), func(context.Context) (*mygo.Update, error) {
		return &mygo.Update{Version: "0.2.0", Notes: "untrusted"}, nil
	})
	if available.State != UpdateAvailable || available.Version != "0.2.0" ||
		!available.DownloadAvailable || available.InstallAvailable || available.Revision != 0 {
		t.Fatalf("legacy available result = %+v", available)
	}
	if available.Notes != "" {
		t.Fatalf("legacy check exposed release notes: %+v", available)
	}
	disabled := legacyDesktopUpdate(context.Background(), func(context.Context) (*mygo.Update, error) {
		return nil, mygo.ErrUpdatesDisabled
	})
	if disabled.State != UpdateUnavailable || !disabled.DownloadAvailable || disabled.InstallAvailable {
		t.Fatalf("legacy disabled result = %+v", disabled)
	}
	desktopUpdateInstallerURL = ""
	if result := legacyDesktopUpdate(context.Background(), func(context.Context) (*mygo.Update, error) {
		return &mygo.Update{Version: "0.2.0"}, nil
	}); result.DownloadAvailable {
		t.Fatalf("legacy result without an installer page = %+v", result)
	}
}

func newUpdateTestKeyPair(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return publicKey, privateKey
}

func updateSignedEnvelope(rawURL string, manifest []byte, privateKey ed25519.PrivateKey) []byte {
	message := make([]byte, 0, len(updateManifestSignaturePrefix)+len(rawURL)+len(manifest)+2)
	message = append(message, updateManifestSignaturePrefix...)
	message = append(message, '\n')
	message = append(message, rawURL...)
	message = append(message, '\n')
	message = append(message, manifest...)
	signature := base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, message))
	envelope := make([]byte, 0, len(signature)+1+len(manifest))
	envelope = append(envelope, signature...)
	envelope = append(envelope, '\n')
	return append(envelope, manifest...)
}

func TestDesktopUpdateSourceFetchesOnlyItsOwnOrigin(t *testing.T) {
	publicKey, privateKey := newUpdateTestKeyPair(t)
	manifest := []byte(`{"version":"1.0.0"}`)
	var mu sync.Mutex
	var envelope []byte
	var sawUserAgent string
	var sawAuthorization atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			sawAuthorization.Store(true)
		}
		mu.Lock()
		data, userAgent := envelope, r.Header.Get("User-Agent")
		sawUserAgent = userAgent
		mu.Unlock()
		switch r.URL.Path {
		case "/update.json.signed":
			_, _ = w.Write(data)
		case "/archive":
			_, _ = io.WriteString(w, "archive-bytes")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	mu.Lock()
	envelope = updateSignedEnvelope(server.URL+"/update.json", manifest, privateKey)
	mu.Unlock()
	source, err := newDesktopUpdateSource(server.URL+"/update.json", publicKey, server.Client().Transport)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	body, err := source.Manifest(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(body)
	_ = body.Close()
	if !bytes.Equal(got, manifest) {
		t.Fatalf("manifest = %q", got)
	}
	body, err = source.Open(ctx, server.URL+"/archive")
	if err != nil {
		t.Fatal(err)
	}
	artifact, _ := io.ReadAll(body)
	_ = body.Close()
	if string(artifact) != "archive-bytes" {
		t.Fatalf("artifact = %q", artifact)
	}
	if sawAuthorization.Load() {
		t.Fatal("update request carried credentials")
	}
	mu.Lock()
	userAgent := sawUserAgent
	mu.Unlock()
	if userAgent != "mygo-updater" {
		t.Fatalf("User-Agent = %q", userAgent)
	}

	other := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer other.Close()
	for _, raw := range []string{
		other.URL + "/archive",
		"https://other.example.test/archive",
		"http://updates.example.test/archive",
		server.URL + "/archive?token=1",
		strings.Replace(server.URL, "http://", "http://user@", 1) + "/archive",
	} {
		if _, err := source.Open(ctx, raw); err == nil {
			t.Fatalf("artifact URL was accepted: %s", raw)
		}
	}
}

func TestDesktopUpdateSourceVerifiesSignedManifestEnvelope(t *testing.T) {
	publicKey, privateKey := newUpdateTestKeyPair(t)
	manifest := []byte("{\n  \"version\" : \"1.0.0\",\n  \"url\": \"archive\", \"signature\": \"fixture\"\n}\n")
	var mu sync.Mutex
	var current []byte
	setEnvelope := func(data []byte) {
		mu.Lock()
		current = data
		mu.Unlock()
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		data := current
		mu.Unlock()
		_, _ = w.Write(data)
	}))
	defer server.Close()
	rawURL := server.URL + "/update.json"
	source, err := newDesktopUpdateSource(rawURL, publicKey, server.Client().Transport)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	setEnvelope(updateSignedEnvelope(rawURL, manifest, privateKey))
	body, err := source.Manifest(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(body)
	_ = body.Close()
	if !bytes.Equal(got, manifest) {
		t.Fatalf("verified manifest bytes changed: %q", got)
	}

	modified := append([]byte(nil), updateSignedEnvelope(rawURL, manifest, privateKey)...)
	modified[len(modified)-2] ^= 0x01
	setEnvelope(modified)
	if _, err := source.Manifest(ctx, false); err == nil {
		t.Fatal("a modified manifest envelope was accepted")
	}

	_, otherPrivate := newUpdateTestKeyPair(t)
	setEnvelope(updateSignedEnvelope(rawURL, manifest, otherPrivate))
	if _, err := source.Manifest(ctx, false); err == nil {
		t.Fatal("a manifest signed by another key was accepted")
	}

	setEnvelope(manifest)
	if _, err := source.Manifest(ctx, false); err == nil {
		t.Fatal("an unsigned manifest was accepted")
	}

	setEnvelope(updateSignedEnvelope(server.URL+"/other.json", manifest, privateKey))
	if _, err := source.Manifest(ctx, false); err == nil {
		t.Fatal("a manifest signed for another URL was accepted")
	}
}

func TestDesktopUpdateManifestKeyIsCanonicalBase64(t *testing.T) {
	publicKey, _ := newUpdateTestKeyPair(t)
	valid := base64.StdEncoding.EncodeToString(publicKey)
	if _, err := parseDesktopUpdateManifestKey(valid); err != nil {
		t.Fatalf("valid key rejected: %v", err)
	}
	for _, invalid := range []string{
		"",
		"not base64!",
		base64.StdEncoding.EncodeToString(publicKey[:16]),
		base64.RawStdEncoding.EncodeToString(publicKey),
	} {
		if _, err := parseDesktopUpdateManifestKey(invalid); err == nil {
			t.Fatalf("invalid key %q was accepted", invalid)
		}
	}
}

func TestInvalidManifestKeyFailsClosed(t *testing.T) {
	u, h := newUpdateFixture(t, func(_ *desktopUpdates, _ *updateHarness) {
		desktopUpdateManifestKey = "not-a-key"
	})
	state := u.stateRequest()
	if state.State != UpdateUnavailable || state.InstallAvailable {
		t.Fatalf("invalid manifest key returned %+v", state)
	}
	checks := 0
	u.check = func(context.Context) (*mygo.Update, error) {
		checks++
		return nil, nil
	}
	if _, err := u.checkRequest(context.Background()); err != nil {
		t.Fatal(err)
	}
	if checks != 0 || h.sourceCount() != 0 {
		t.Fatalf("invalid key reached the updater: checks=%d sources=%d", checks, h.sourceCount())
	}
	if _, err := u.installRequest(context.Background(), 1); !errors.Is(err, errDesktopUpdateUnavailable) {
		t.Fatalf("invalid key install returned %v", err)
	}
}

func TestDesktopUpdateSourceRejectsRedirects(t *testing.T) {
	publicKey, _ := newUpdateTestKeyPair(t)
	targetHits := atomic.Int32{}
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		targetHits.Add(1)
		_, _ = io.WriteString(w, "should not be fetched")
	}))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/archive", http.StatusFound)
	}))
	defer redirect.Close()
	source, err := newDesktopUpdateSource(redirect.URL+"/update.json", publicKey, redirect.Client().Transport)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.Manifest(context.Background(), false); err == nil {
		t.Fatal("a redirect was followed")
	}
	if targetHits.Load() != 0 {
		t.Fatal("the redirect target was contacted")
	}
}

func TestDesktopUpdateSourceRejectsOversizeManifestEnvelope(t *testing.T) {
	publicKey, _ := newUpdateTestKeyPair(t)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(bytes.Repeat([]byte("x"), maxUpdateSignedEnvelopeSize+1))
	}))
	defer server.Close()
	source, err := newDesktopUpdateSource(server.URL+"/update.json", publicKey, server.Client().Transport)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.Manifest(context.Background(), false); err == nil {
		t.Fatal("an oversized manifest envelope was accepted")
	}
}

func TestDesktopUpdateSourceStallsOnlyItsOwnFetch(t *testing.T) {
	publicKey, _ := newUpdateTestKeyPair(t)
	previous := updateStallTimeout
	updateStallTimeout = 100 * time.Millisecond
	t.Cleanup(func() { updateStallTimeout = previous })
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
		}
	}))
	defer server.Close()
	source, err := newDesktopUpdateSource(server.URL+"/update.json", publicKey, server.Client().Transport)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := time.Now()
	if _, err := source.Manifest(ctx, false); err == nil {
		t.Fatal("a stalled manifest was accepted")
	}
	if ctx.Err() != nil {
		t.Fatal("the stall canceled the caller's install context")
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("stall cancellation took %v", elapsed)
	}
	body, err := source.Open(ctx, server.URL+"/delta")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.ReadAll(body); err == nil {
		t.Fatal("a stalled artifact was accepted")
	}
	_ = body.Close()
	if ctx.Err() != nil {
		t.Fatal("the artifact stall canceled the caller's install context")
	}
}

func TestDesktopUpdateURLAllowsHTTPAndHTTPS(t *testing.T) {
	for _, test := range []struct {
		raw string
		ok  bool
	}{
		{"https://updates.example.test/app/update-darwin-arm64.json", true},
		{"http://127.0.0.1:8080/app/update.json", true},
		{"http://localhost/app/update.json", true},
		{"http://[::1]:8080/app/update.json", true},
		{"http://updates.example.test/app/update.json", true},
		{"http://10.0.0.1/app/update.json", true},
		{"https://user:pass@updates.example.test/app/update.json", false},
		{"https://updates.example.test/app/update.json?token=1", false},
		{"https://updates.example.test/app/update.json?", false},
		{"https://updates.example.test/app/update.json#fragment", false},
		{"https:///app/update.json", false},
		{"file:///tmp/update.json", false},
		{"mailto:update@example.test", false},
		{"https://updates.example.test/app/\x00", false},
	} {
		_, err := parseDesktopUpdateURL(test.raw)
		if (err == nil) != test.ok {
			t.Fatalf("URL %q accepted=%v, want %v (%v)", test.raw, err == nil, test.ok, err)
		}
	}
	if !sameUpdateOrigin(mustUpdateURL(t, "https://updates.example.test:443/app/a"), *mustUpdateURL(t, "https://updates.example.test")) {
		t.Fatal("default HTTPS port was not equivalent")
	}
	if sameUpdateOrigin(mustUpdateURL(t, "https://updates.example.test:444/app/a"), *mustUpdateURL(t, "https://updates.example.test")) {
		t.Fatal("a different port was treated as the same origin")
	}
}

func mustUpdateURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestBackgroundUpdateCheckNeverInstallsAndSkipsStagedOrQuitting(t *testing.T) {
	u, _ := newUpdateFixture(t)
	var checks, installs atomic.Int32
	u.check = func(context.Context) (*mygo.Update, error) {
		checks.Add(1)
		return nil, nil
	}
	u.install = func(context.Context, *mygo.Update, func(int64, int64)) error {
		installs.Add(1)
		return nil
	}
	u.backgroundCheck()
	if checks.Load() != 1 || installs.Load() != 0 {
		t.Fatalf("initial background check: checks=%d installs=%d", checks.Load(), installs.Load())
	}
	u.mu.Lock()
	u.result = u.resultFor(UpdateStaged, "1.0.0")
	u.mu.Unlock()
	u.backgroundCheck()
	if checks.Load() != 1 {
		t.Fatal("a staged update was checked again")
	}
	u.mu.Lock()
	u.result = u.resultFor(UpdateIdle, "")
	u.mu.Unlock()
	u.beforeQuit(false)
	u.backgroundCheck()
	if checks.Load() != 1 {
		t.Fatal("a quitting app checked again")
	}
	if installs.Load() != 0 {
		t.Fatal("a background check installed")
	}
}

func newUpdateNotificationFixture(t *testing.T) (*desktopUpdates, *Desktop, DesktopUpdateResult) {
	t.Helper()
	u, _ := newUpdateFixture(t)
	desktop := &Desktop{updates: u}
	desktop.account.set(notificationUserID, time.Now().Add(time.Hour))
	u.desktop = desktop
	available := makeUpdateAvailable(t, u, "0.2.0")
	return u, desktop, available
}

func captureUpdateNotifications(t *testing.T) *[]mygo.NotificationOptions {
	t.Helper()
	supported, show := desktopNativeNotifications, showSystemNotification
	calls := &[]mygo.NotificationOptions{}
	desktopNativeNotifications = func() bool { return true }
	showSystemNotification = func(_ context.Context, options mygo.NotificationOptions) error {
		*calls = append(*calls, options)
		return nil
	}
	t.Cleanup(func() {
		desktopNativeNotifications, showSystemNotification = supported, show
	})
	return calls
}

func TestUpdateNotificationUsesTheExactAvailableCandidate(t *testing.T) {
	u, desktop, available := newUpdateNotificationFixture(t)
	calls := captureUpdateNotifications(t)

	if err := u.showNotificationRequest(context.Background(), 0); !errors.Is(err, errDesktopUpdateNotificationInvalid) {
		t.Fatalf("a zero revision returned %v", err)
	}
	if err := u.showNotificationRequest(context.Background(), available.Revision-1); !errors.Is(err, errDesktopUpdateStale) {
		t.Fatalf("a stale revision returned %v", err)
	}
	if len(*calls) != 0 {
		t.Fatalf("a stale revision notified: %+v", *calls)
	}
	if err := u.showNotificationRequest(context.Background(), available.Revision); err != nil {
		t.Fatalf("the exact candidate did not notify: %v", err)
	}
	if len(*calls) != 1 {
		t.Fatalf("notification calls = %d, want 1", len(*calls))
	}
	notification := (*calls)[0]
	if notification.ID != updateNotificationID || !notification.Silent {
		t.Fatalf("unexpected native notification: %+v", notification)
	}
	if !strings.Contains(notification.Body, available.Version) || strings.Contains(notification.Body, "untrusted release notes") ||
		strings.Contains(notification.Body, "https://") {
		t.Fatalf("native notification body leaked or omitted content: %q", notification.Body)
	}

	// A periodic check may offer the same version under a new revision; that
	// does not authorize a second notification from the old snapshot.
	next := makeUpdateAvailable(t, u, available.Version)
	if next.Revision <= available.Revision {
		t.Fatalf("the repeated availability revision did not advance: %+v", next)
	}
	if err := u.showNotificationRequest(context.Background(), available.Revision); !errors.Is(err, errDesktopUpdateStale) {
		t.Fatalf("the replaced revision returned %v", err)
	}

	// A staged snapshot must not notify even for the old candidate.
	u.mu.Lock()
	u.available = nil
	u.result = u.resultFor(UpdateStaged, available.Version)
	u.mu.Unlock()
	if err := u.showNotificationRequest(context.Background(), next.Revision); !errors.Is(err, errDesktopUpdateStale) {
		t.Fatalf("a staged update notified: %v", err)
	}

	desktop.account.clear()
	if err := u.showNotificationRequest(context.Background(), next.Revision); !errors.Is(err, errAccountRequired) {
		t.Fatalf("a signed-out account returned %v", err)
	}
	if len(*calls) != 1 {
		t.Fatalf("stale or unauthenticated requests notified: %+v", *calls)
	}
}

func TestUpdateNotificationCancelsWhenTheSnapshotOrAccountChanges(t *testing.T) {
	u, desktop, available := newUpdateNotificationFixture(t)
	supported, show := desktopNativeNotifications, showSystemNotification
	desktopNativeNotifications = func() bool { return true }
	started := make(chan struct{})
	showSystemNotification = func(ctx context.Context, _ mygo.NotificationOptions) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}
	t.Cleanup(func() {
		desktopNativeNotifications, showSystemNotification = supported, show
	})

	done := make(chan error, 1)
	go func() { done <- u.showNotificationRequest(context.Background(), available.Revision) }()
	<-started
	u.mu.Lock()
	u.emitLocked(u.resultFor(UpdateChecking, available.Version))
	u.mu.Unlock()
	select {
	case err := <-done:
		if !errors.Is(err, errDesktopUpdateStale) {
			t.Fatalf("a changed snapshot returned %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("a changed update snapshot deadlocked the pending notification")
	}

	available = makeUpdateAvailable(t, u, "0.2.1")
	started = make(chan struct{})
	desktop.account.setOnClear(u.cancelUpdateNotification)
	go func() { done <- u.showNotificationRequest(context.Background(), available.Revision) }()
	<-started
	desktop.account.clear()
	select {
	case err := <-done:
		if !errors.Is(err, errDesktopUpdateStale) {
			t.Fatalf("an account change returned %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("an account change deadlocked the pending notification")
	}
}

func TestUpdateNotificationReplacesAStalePendingAttemptForANewCandidate(t *testing.T) {
	u, _, available := newUpdateNotificationFixture(t)
	supported, show := desktopNativeNotifications, showSystemNotification
	desktopNativeNotifications = func() bool { return true }
	started := make(chan int, 2)
	calls := 0
	showSystemNotification = func(ctx context.Context, _ mygo.NotificationOptions) error {
		calls++
		started <- calls
		if calls == 1 {
			<-ctx.Done()
			return ctx.Err()
		}
		return nil
	}
	t.Cleanup(func() {
		desktopNativeNotifications, showSystemNotification = supported, show
	})

	oldDone := make(chan error, 1)
	go func() { oldDone <- u.showNotificationRequest(context.Background(), available.Revision) }()
	<-started
	next := makeUpdateAvailable(t, u, "0.2.1")
	newDone := make(chan error, 1)
	go func() { newDone <- u.showNotificationRequest(context.Background(), next.Revision) }()
	select {
	case err := <-oldDone:
		if !errors.Is(err, errDesktopUpdateStale) {
			t.Fatalf("the replaced attempt returned %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the replaced notification did not unwind")
	}
	select {
	case err := <-newDone:
		if err != nil {
			t.Fatalf("the new candidate did not notify: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the new candidate waited forever for the old attempt")
	}
	if calls != 2 {
		t.Fatalf("notification calls = %d, want 2", calls)
	}
}

func TestUpdateNotificationKeepsTheFixedIDUntilStaleCleanupFinishes(t *testing.T) {
	u, _, available := newUpdateNotificationFixture(t)
	supported, show, closeNotice := desktopNativeNotifications, showSystemNotification, closeUpdateNotification
	t.Cleanup(func() {
		desktopNativeNotifications, showSystemNotification, closeUpdateNotification = supported, show, closeNotice
	})
	desktopNativeNotifications = func() bool { return true }

	showStarted := make(chan struct{})
	releaseShow := make(chan struct{})
	closeStarted := make(chan struct{})
	releaseClose := make(chan struct{})
	var releaseShowOnce, releaseCloseOnce sync.Once
	releaseOldShow := func() { releaseShowOnce.Do(func() { close(releaseShow) }) }
	releaseStaleClose := func() { releaseCloseOnce.Do(func() { close(releaseClose) }) }
	defer releaseOldShow()
	defer releaseStaleClose()

	var traceMu sync.Mutex
	var trace []string
	record := func(event string) {
		traceMu.Lock()
		trace = append(trace, event)
		traceMu.Unlock()
	}
	calls := 0
	showSystemNotification = func(_ context.Context, _ mygo.NotificationOptions) error {
		calls++
		if calls == 1 {
			close(showStarted)
			<-releaseShow
			return nil
		}
		record("show")
		return nil
	}
	closeUpdateNotification = func() {
		record("close")
		close(closeStarted)
		<-releaseClose
	}

	oldDone := make(chan error, 1)
	go func() { oldDone <- u.showNotificationRequest(context.Background(), available.Revision) }()
	<-showStarted
	next := makeUpdateAvailable(t, u, "0.2.1")

	// The old show succeeded but its candidate is stale. It must retain the
	// fixed-id slot while its cleanup removes that exact notice.
	releaseOldShow()
	select {
	case <-closeStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("the stale successful show did not clean up its notice")
	}
	u.mu.Lock()
	slot := u.notification
	u.mu.Unlock()
	if slot == nil {
		t.Fatal("the stale cleanup released the fixed-id slot before closing the notice")
	}

	newDone := make(chan error, 1)
	go func() { newDone <- u.showNotificationRequest(context.Background(), next.Revision) }()
	releaseStaleClose()
	if err := <-oldDone; !errors.Is(err, errDesktopUpdateStale) {
		t.Fatalf("the replaced attempt returned %v", err)
	}
	if err := <-newDone; err != nil {
		t.Fatalf("the replacement did not notify after stale cleanup: %v", err)
	}
	if calls != 2 {
		t.Fatalf("notification calls = %d, want 2", calls)
	}
	traceMu.Lock()
	defer traceMu.Unlock()
	if len(trace) != 2 || trace[0] != "close" || trace[1] != "show" {
		t.Fatalf("stale close and replacement show order = %v", trace)
	}
}

func TestUpdateNotificationReplacementWaitsAcrossSameUserSignIn(t *testing.T) {
	u, desktop, available := newUpdateNotificationFixture(t)
	supported, show, closeNotice := desktopNativeNotifications, showSystemNotification, closeUpdateNotification
	t.Cleanup(func() {
		desktopNativeNotifications, showSystemNotification, closeUpdateNotification = supported, show, closeNotice
	})
	desktopNativeNotifications = func() bool { return true }
	closeUpdateNotification = func() {}
	desktop.account.setOnClear(u.cancelUpdateNotification)

	showStarted := make(chan struct{})
	releaseOldShow := make(chan struct{})
	calls := 0
	showSystemNotification = func(_ context.Context, _ mygo.NotificationOptions) error {
		calls++
		if calls == 1 {
			close(showStarted)
			<-releaseOldShow
		}
		return nil
	}

	oldDone := make(chan error, 1)
	go func() { oldDone <- u.showNotificationRequest(context.Background(), available.Revision) }()
	<-showStarted
	next := makeUpdateAvailable(t, u, "0.2.1")

	// Sign out and back in as the same user. The replacement is admitted under
	// the new generation only after the older delivery has fully unwound.
	desktop.account.clear()
	desktop.account.set(notificationUserID, time.Now().Add(time.Hour))
	waiting := make(chan struct{}, 1)
	u.notifyWaiting = func() {
		select {
		case waiting <- struct{}{}:
		default:
		}
	}
	newDone := make(chan error, 1)
	go func() { newDone <- u.showNotificationRequest(context.Background(), next.Revision) }()
	select {
	case <-waiting:
	case <-time.After(2 * time.Second):
		t.Fatal("the replacement did not wait for the older attempt")
	}
	close(releaseOldShow)
	if err := <-oldDone; !errors.Is(err, errDesktopUpdateStale) {
		t.Fatalf("the signed-out attempt returned %v", err)
	}
	if err := <-newDone; err != nil {
		t.Fatalf("the same-user replacement did not notify: %v", err)
	}
	if calls != 2 {
		t.Fatalf("notification calls = %d, want 2", calls)
	}
}

func TestUpdateNotificationPinnedLeaseDoesNotCrossSameUserSignIn(t *testing.T) {
	u, desktop, available := newUpdateNotificationFixture(t)
	supported, show, closeNotice := desktopNativeNotifications, showSystemNotification, closeUpdateNotification
	t.Cleanup(func() {
		desktopNativeNotifications, showSystemNotification, closeUpdateNotification = supported, show, closeNotice
	})
	desktopNativeNotifications = func() bool { return true }
	closeUpdateNotification = func() {}
	desktop.account.setOnClear(u.cancelUpdateNotification)

	showStarted := make(chan struct{})
	releaseOldShow := make(chan struct{})
	defer func() {
		select {
		case <-releaseOldShow:
		default:
			close(releaseOldShow)
		}
	}()
	calls := 0
	showSystemNotification = func(_ context.Context, _ mygo.NotificationOptions) error {
		calls++
		if calls == 1 {
			close(showStarted)
			<-releaseOldShow
		}
		return nil
	}

	oldDone := make(chan error, 1)
	go func() { oldDone <- u.showNotificationRequest(context.Background(), available.Revision) }()
	<-showStarted
	next := makeUpdateAvailable(t, u, "0.2.1")
	waiting := make(chan struct{}, 1)
	u.notifyWaiting = func() {
		select {
		case waiting <- struct{}{}:
		default:
		}
	}
	newDone := make(chan error, 1)
	go func() { newDone <- u.showNotificationRequest(context.Background(), next.Revision) }()
	select {
	case <-waiting:
	case <-time.After(2 * time.Second):
		t.Fatal("the replacement did not wait for the older attempt")
	}

	// The waiting request pinned the pre-sign-in generation. Re-signing in as
	// the same user must invalidate it instead of authorizing a late notice.
	desktop.account.clear()
	desktop.account.set(notificationUserID, time.Now().Add(time.Hour))
	close(releaseOldShow)
	if err := <-oldDone; !errors.Is(err, errDesktopUpdateStale) {
		t.Fatalf("the signed-out attempt returned %v", err)
	}
	if err := <-newDone; !errors.Is(err, errDesktopUpdateStale) {
		t.Fatalf("the old-generation replacement returned %v", err)
	}
	if calls != 1 {
		t.Fatalf("an old-generation replacement notified: calls=%d", calls)
	}
}

func TestUpdateNotificationCallerCancellationDoesNotReportSuccess(t *testing.T) {
	u, _, available := newUpdateNotificationFixture(t)
	supported, show, closeNotice := desktopNativeNotifications, showSystemNotification, closeUpdateNotification
	t.Cleanup(func() {
		desktopNativeNotifications, showSystemNotification, closeUpdateNotification = supported, show, closeNotice
	})
	desktopNativeNotifications = func() bool { return true }
	var closed atomic.Int32
	closeUpdateNotification = func() { closed.Add(1) }
	showStarted := make(chan struct{})
	showSystemNotification = func(ctx context.Context, _ mygo.NotificationOptions) error {
		close(showStarted)
		<-ctx.Done()
		// MyGo can return nil after its caller gave up; the updater must still
		// treat the delivery as abandoned.
		return nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- u.showNotificationRequest(ctx, available.Revision) }()
	<-showStarted
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("a canceled caller got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the canceled delivery did not finish")
	}
	if closed.Load() != 1 {
		t.Fatalf("abandoned notice cleanup calls = %d, want 1", closed.Load())
	}
	u.mu.Lock()
	retained := u.notification
	u.mu.Unlock()
	if retained != nil {
		t.Fatal("the canceled delivery retained the notification slot")
	}
}

func TestUpdateNotificationLeaseExpiryCancelsInFlightDelivery(t *testing.T) {
	for _, tc := range []struct {
		name    string
		expiry  time.Duration
		refresh bool
	}{
		{name: "session expiry", expiry: 500 * time.Millisecond},
		{name: "same-generation refresh does not extend the pinned attempt", expiry: time.Second, refresh: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			u, desktop, available := newUpdateNotificationFixture(t)
			supported, show, closeNotice := desktopNativeNotifications, showSystemNotification, closeUpdateNotification
			t.Cleanup(func() {
				desktopNativeNotifications, showSystemNotification, closeUpdateNotification = supported, show, closeNotice
			})
			desktopNativeNotifications = func() bool { return true }
			var closed atomic.Int32
			closeUpdateNotification = func() { closed.Add(1) }
			showStarted := make(chan struct{})
			showCtxErr := make(chan error, 1)
			showSystemNotification = func(ctx context.Context, _ mygo.NotificationOptions) error {
				close(showStarted)
				select {
				case <-ctx.Done():
					showCtxErr <- ctx.Err()
				case <-time.After(2 * time.Second):
					showCtxErr <- errors.New("native delivery outlived the pinned lease")
				}
				// A late nil cannot turn an expired attempt into a delivered success.
				return nil
			}

			desktop.account.set(notificationUserID, time.Now().Add(tc.expiry))
			done := make(chan error, 1)
			go func() { done <- u.showNotificationRequest(context.Background(), available.Revision) }()
			<-showStarted
			if tc.refresh {
				// A same-generation refresh extends future requests only. This attempt
				// stays pinned to the expiry its lease was admitted with.
				desktop.account.set(notificationUserID, time.Now().Add(time.Hour))
			}
			select {
			case err := <-done:
				if !errors.Is(err, errDesktopUpdateStale) {
					t.Fatalf("an expired pinned attempt returned %v", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("an expired pinned attempt did not unwind")
			}
			select {
			case err := <-showCtxErr:
				if !errors.Is(err, context.DeadlineExceeded) {
					t.Fatalf("native delivery context = %v, want the lease deadline", err)
				}
			case <-time.After(time.Second):
				t.Fatal("native delivery never observed its lease deadline")
			}
			if closed.Load() != 1 {
				t.Fatalf("expired delivery cleanup calls = %d, want 1", closed.Load())
			}
			u.mu.Lock()
			retained := u.notification
			u.mu.Unlock()
			if retained != nil {
				t.Fatal("an expired delivery retained the notification slot")
			}
		})
	}
}

func TestUpdateNotificationRevokedLeaseCannotReserveOrDeliver(t *testing.T) {
	u, desktop, available := newUpdateNotificationFixture(t)
	calls := captureUpdateNotifications(t)
	closeNotice := closeUpdateNotification
	closeUpdateNotification = func() {}
	t.Cleanup(func() { closeUpdateNotification = closeNotice })
	desktop.account.setOnClear(u.cancelUpdateNotification)

	admitted := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	u.notifyAdmission = func() {
		once.Do(func() {
			close(admitted)
			<-release
		})
	}
	done := make(chan error, 1)
	go func() { done <- u.showNotificationRequest(context.Background(), available.Revision) }()
	<-admitted

	// The request pinned the old generation. Invalidate it before the request
	// can reserve the slot; re-signing in with the same id must not revive it.
	desktop.account.clear()
	desktop.account.set(notificationUserID, time.Now().Add(time.Hour))
	close(release)

	select {
	case err := <-done:
		if !errors.Is(err, errDesktopUpdateStale) {
			t.Fatalf("a revoked lease returned %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("a revoked lease did not leave admission")
	}
	if len(*calls) != 0 {
		t.Fatalf("a revoked lease reached delivery: %+v", *calls)
	}
}

func TestUpdateNotificationRevokedLeaseCannotCancelANewerAttempt(t *testing.T) {
	u, desktop, available := newUpdateNotificationFixture(t)
	closeNotice := closeUpdateNotification
	closeUpdateNotification = func() {}
	t.Cleanup(func() { closeUpdateNotification = closeNotice })
	desktop.account.setOnClear(u.cancelUpdateNotification)

	admitted := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	u.notifyAdmission = func() {
		once.Do(func() {
			close(admitted)
			<-release
		})
	}
	done := make(chan error, 1)
	go func() { done <- u.showNotificationRequest(context.Background(), available.Revision) }()
	<-admitted

	desktop.account.clear()
	desktop.account.set(notificationUserID, time.Now().Add(time.Hour))
	lease, ok := desktop.account.lease()
	if !ok {
		t.Fatal("the replacement account has no lease")
	}
	canceled := make(chan struct{})
	next := &updateNotificationAttempt{
		cancel: func() { close(canceled) }, lease: lease,
		revision: available.Revision, version: available.Version,
		done: make(chan struct{}),
	}
	u.mu.Lock()
	u.notification = next
	u.mu.Unlock()
	defer func() {
		u.mu.Lock()
		if u.notification == next {
			u.notification = nil
			close(next.done)
		}
		u.mu.Unlock()
	}()
	close(release)

	select {
	case err := <-done:
		if !errors.Is(err, errDesktopUpdateStale) {
			t.Fatalf("a revoked lease returned %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("a revoked lease disturbed a newer valid attempt")
	}
	select {
	case <-canceled:
		t.Fatal("an obsolete lease canceled a newer valid attempt")
	default:
	}
}

func TestUpdateNotificationSameRevisionRetryAfterCanceledDelivery(t *testing.T) {
	t.Run("does not duplicate a delivered notice", func(t *testing.T) {
		u, _, available := newUpdateNotificationFixture(t)
		supported, show, closeNotice := desktopNativeNotifications, showSystemNotification, closeUpdateNotification
		t.Cleanup(func() {
			desktopNativeNotifications, showSystemNotification, closeUpdateNotification = supported, show, closeNotice
		})
		desktopNativeNotifications = func() bool { return true }
		var closed atomic.Int32
		closeUpdateNotification = func() { closed.Add(1) }
		firstStarted := make(chan struct{})
		releaseFirst := make(chan struct{})
		calls := 0
		showSystemNotification = func(_ context.Context, _ mygo.NotificationOptions) error {
			calls++
			if calls == 1 {
				close(firstStarted)
				<-releaseFirst
			}
			return nil
		}

		firstCtx, firstCancel := context.WithCancel(context.Background())
		firstDone := make(chan error, 1)
		go func() { firstDone <- u.showNotificationRequest(firstCtx, available.Revision) }()
		<-firstStarted
		firstCancel()

		waiting := make(chan struct{}, 1)
		u.notifyWaiting = func() {
			select {
			case waiting <- struct{}{}:
			default:
			}
		}
		retryDone := make(chan error, 1)
		go func() { retryDone <- u.showNotificationRequest(context.Background(), available.Revision) }()
		select {
		case <-waiting:
		case <-time.After(2 * time.Second):
		}
		close(releaseFirst)
		if err := <-firstDone; !errors.Is(err, context.Canceled) {
			t.Fatalf("the abandoned caller returned %v", err)
		}
		if err := <-retryDone; !errors.Is(err, errDesktopUpdateBusy) {
			t.Fatalf("the repeated delivery returned %v", err)
		}
		if calls != 1 || closed.Load() != 1 {
			t.Fatalf("delivery calls=%d cleanup=%d, want one delivered notice cleaned once", calls, closed.Load())
		}
	})

	t.Run("retries a notice that never reached delivery", func(t *testing.T) {
		u, _, available := newUpdateNotificationFixture(t)
		supported, show, closeNotice := desktopNativeNotifications, showSystemNotification, closeUpdateNotification
		t.Cleanup(func() {
			desktopNativeNotifications, showSystemNotification, closeUpdateNotification = supported, show, closeNotice
		})
		desktopNativeNotifications = func() bool { return true }
		closeUpdateNotification = func() {}
		firstStarted := make(chan struct{})
		releaseFirst := make(chan struct{})
		calls := 0
		showSystemNotification = func(ctx context.Context, _ mygo.NotificationOptions) error {
			calls++
			if calls == 1 {
				close(firstStarted)
				<-releaseFirst
				return ctx.Err()
			}
			return nil
		}

		firstCtx, firstCancel := context.WithCancel(context.Background())
		firstDone := make(chan error, 1)
		go func() { firstDone <- u.showNotificationRequest(firstCtx, available.Revision) }()
		<-firstStarted
		firstCancel()

		waiting := make(chan struct{}, 1)
		u.notifyWaiting = func() {
			select {
			case waiting <- struct{}{}:
			default:
			}
		}
		retryDone := make(chan error, 1)
		go func() { retryDone <- u.showNotificationRequest(context.Background(), available.Revision) }()
		select {
		case <-waiting:
		case <-time.After(2 * time.Second):
		}
		close(releaseFirst)
		if err := <-firstDone; !errors.Is(err, context.Canceled) {
			t.Fatalf("the abandoned caller returned %v", err)
		}
		if err := <-retryDone; err != nil {
			t.Fatalf("the same-revision retry did not notify: %v", err)
		}
		if calls != 2 {
			t.Fatalf("notification calls = %d, want 2", calls)
		}
	})
}

func TestUpdateNotificationDelayedAccountClearDoesNotCancelANewerSession(t *testing.T) {
	u, desktop, available := newUpdateNotificationFixture(t)
	supported, show, closeNotice := desktopNativeNotifications, showSystemNotification, closeUpdateNotification
	t.Cleanup(func() {
		desktopNativeNotifications, showSystemNotification, closeUpdateNotification = supported, show, closeNotice
	})
	desktopNativeNotifications = func() bool { return true }
	closeUpdateNotification = func() {}
	desktop.account.setOnClear(u.cancelUpdateNotification)

	oldStarted := make(chan struct{})
	newStarted := make(chan struct{})
	releaseNew := make(chan struct{})
	calls := 0
	showSystemNotification = func(ctx context.Context, _ mygo.NotificationOptions) error {
		calls++
		switch calls {
		case 1:
			close(oldStarted)
			<-ctx.Done()
			return ctx.Err()
		default:
			close(newStarted)
			select {
			case <-releaseNew:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}

	oldDone := make(chan error, 1)
	go func() { oldDone <- u.showNotificationRequest(context.Background(), available.Revision) }()
	<-oldStarted
	desktop.account.clear()
	if err := <-oldDone; !errors.Is(err, errDesktopUpdateStale) {
		t.Fatalf("the cleared account's attempt returned %v", err)
	}
	desktop.account.set(notificationUserID, time.Now().Add(time.Hour))
	next := makeUpdateAvailable(t, u, "0.2.1")

	newDone := make(chan error, 1)
	go func() { newDone <- u.showNotificationRequest(context.Background(), next.Revision) }()
	<-newStarted
	// A delayed callback for the old sign-out must not cancel this newer,
	// still-valid generation.
	u.cancelUpdateNotification()
	close(releaseNew)
	if err := <-newDone; err != nil {
		t.Fatalf("a delayed old account clear canceled the new notice: %v", err)
	}
}

func TestNativeUpdateNotificationIsLocalized(t *testing.T) {
	for locale, want := range map[string]string{
		"zh-CN": "版本 1.2.3 可用。",
		"en-US": "Version 1.2.3 is available.",
		"es-ES": "La versión 1.2.3 está disponible.",
		"pt-BR": "A versão 1.2.3 está disponível.",
		"fr-FR": "La version 1.2.3 est disponible.",
		"ja-JP": "バージョン 1.2.3 が利用可能です。",
	} {
		if got := locales.In(locale).UpdateAvailableNotice("1.2.3"); got != want {
			t.Fatalf("%s notification body = %q, want %q", locale, got, want)
		}
	}
}

func TestUpdateEventAndBridgeRejectUntrustedPages(t *testing.T) {
	if desktopUpdateChanged.Name() != "desktop:update-changed" {
		t.Fatalf("event name = %q", desktopUpdateChanged.Name())
	}
	desktop := &Desktop{}
	ctx := context.Background()
	for name, call := range map[string]func() error{
		"check": func() error { _, err := desktop.CheckForUpdate(ctx); return err },
		"state": func() error { _, err := desktop.GetUpdateState(ctx); return err },
		"install": func() error {
			_, err := desktop.InstallUpdate(ctx, 1)
			return err
		},
		"channel": func() error {
			_, err := desktop.SetUpdateChannel(ctx, string(UpdateChannelStable))
			return err
		},
		"restart":             func() error { return desktop.RestartAfterUpdate(ctx) },
		"installer":           func() error { return desktop.OpenUpdateInstaller(ctx) },
		"update notification": func() error { return desktop.ShowUpdateNotification(ctx, 1) },
	} {
		if err := call(); err == nil || err.Error() != "DESKTOP_CALLER_FORBIDDEN" {
			t.Fatalf("%s accepted an untrusted page: %v", name, err)
		}
	}
}

func TestUpdateChannelValidation(t *testing.T) {
	u, _ := newUpdateFixture(t)
	for _, channel := range []string{"", "beta ", "stable\n", "nightly", "BETA"} {
		if _, err := u.setChannelRequest(channel); !errors.Is(err, errDesktopUpdateInvalidChannel) {
			t.Fatalf("channel %q returned %v", channel, err)
		}
	}
	if _, err := u.setChannelRequest(string(UpdateChannelBeta)); !errors.Is(err, errDesktopUpdateUnavailable) {
		t.Fatalf("beta without a beta feed returned %v", err)
	}
	if _, err := u.setChannelRequest(string(UpdateChannelStable)); err != nil {
		t.Fatalf("stable channel returned %v", err)
	}
}

func TestNativeUpdateMenuIsLocalized(t *testing.T) {
	for locale, want := range map[string]string{
		"zh-CN": "桌面更新…",
		"en-US": "Desktop updates…",
		"es-ES": "Actualizaciones de escritorio…",
		"pt-BR": "Atualizações do aplicativo…",
		"fr-FR": "Mises à jour de l’application…",
		"ja-JP": "デスクトップの更新…",
	} {
		if got := locales.In(locale).DesktopUpdates(); got != want {
			t.Fatalf("%s menu label = %q, want %q", locale, got, want)
		}
	}
}

func TestNativeMenuDesktopUpdatesOpensSettings(t *testing.T) {
	d := &Desktop{}
	app, _ := d.shellMenus(locales.In("en-US"))
	item := app.ItemByID("desktop-updates")
	if item == nil || item.Label != "Desktop updates…" || item.Click == nil {
		t.Fatalf("update menu item = %+v", item)
	}
	settings := app.ItemByID("settings")
	if settings == nil || settings.Click == nil {
		t.Fatal("settings menu item is missing")
	}
}

func TestUpdateAdmissionStopsWhenTheCallerUnloadsBeforeGrant(t *testing.T) {
	u, _ := newUpdateFixture(t)
	available := makeUpdateAvailable(t, u, "0.2.0")
	admissionStarted := make(chan struct{})
	u.acquire = func(ctx context.Context) (updateLease, error) {
		close(admissionStarted)
		<-ctx.Done()
		return nil, ctx.Err()
	}
	caller, cancel := context.WithCancel(context.Background())
	done := make(chan DesktopUpdateResult, 1)
	go func() {
		result, _ := u.installRequest(caller, available.Revision)
		done <- result
	}()
	<-admissionStarted
	cancel()
	result := <-done
	if result.State != UpdateInstallFailed || result.Version != "0.2.0" {
		t.Fatalf("unloaded caller returned %+v", result)
	}
}

func TestUpdateRevisionOmitsZeroUnderJSONV2(t *testing.T) {
	zero, err := jsonv2.Marshal(DesktopUpdateResult{State: UpdateUnavailable})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(zero, []byte(`"revision"`)) {
		t.Fatalf("zero revision was serialized: %s", zero)
	}
	if bytes.Contains(zero, []byte(`"downloaded"`)) || bytes.Contains(zero, []byte(`"total"`)) {
		t.Fatalf("absent progress counts were serialized: %s", zero)
	}
	positive := DesktopUpdateResult{State: UpdateAvailable, Version: "0.2.0", Revision: 7}
	raw, err := jsonv2.Marshal(positive)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`"revision":7`)) {
		t.Fatalf("positive revision was not serialized: %s", raw)
	}
	downloaded, total := int64(0), int64(100)
	progress, err := jsonv2.Marshal(DesktopUpdateResult{State: UpdateDownloading, Revision: 8, Downloaded: &downloaded, Total: &total})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(progress, []byte(`"downloaded":0`)) || !bytes.Contains(progress, []byte(`"total":100`)) || !bytes.Contains(progress, []byte(`"revision":8`)) {
		t.Fatalf("zero progress was not observable: %s", progress)
	}
}

func TestUpdateDisabledAfterInstallNoLongerOffersInPlaceInstall(t *testing.T) {
	u, _ := newUpdateFixture(t, func(_ *desktopUpdates, _ *updateHarness) {
		desktopUpdateInstallerURL = "https://updates.example.test/install"
	})
	initial := u.stateRequest()
	if initial.State != UpdateIdle || !initial.InstallAvailable || !initial.DownloadAvailable {
		t.Fatalf("initial in-place capability = %+v", initial)
	}
	checks := 0
	u.check = func(context.Context) (*mygo.Update, error) {
		checks++
		return nil, mygo.ErrUpdatesDisabled
	}
	result, err := u.checkRequest(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.State != UpdateUnavailable || result.InstallAvailable || !result.DownloadAvailable {
		t.Fatalf("disabled install location returned %+v", result)
	}
	if result.Channel != "" || result.BetaAvailable {
		t.Fatalf("disabled install location exposed channel controls: %+v", result)
	}
	u.mu.Lock()
	available := u.available
	u.mu.Unlock()
	if available != nil {
		t.Fatal("disabled install location kept an installable update")
	}
	if _, err := u.installRequest(context.Background(), result.Revision); !errors.Is(err, errDesktopUpdateUnavailable) {
		t.Fatalf("disabled install path returned %v", err)
	}
	if _, err := u.checkRequest(context.Background()); err != nil {
		t.Fatal(err)
	}
	if checks != 1 {
		t.Fatalf("disabled install location checked again: %d", checks)
	}
}
