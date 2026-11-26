package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/netproxy"
	"github.com/egoist/mygo/plugins/preferences"
)

type DesktopUpdateState string

const (
	UpdateIdle          DesktopUpdateState = "idle"
	UpdateChecking      DesktopUpdateState = "checking"
	UpdateAvailable     DesktopUpdateState = "available"
	UpdateCurrent       DesktopUpdateState = "current"
	UpdateUnavailable   DesktopUpdateState = "unavailable"
	UpdateFailed        DesktopUpdateState = "failed"
	UpdateBusy          DesktopUpdateState = "busy"
	UpdateDownloading   DesktopUpdateState = "downloading"
	UpdateStaged        DesktopUpdateState = "staged"
	UpdateInstallFailed DesktopUpdateState = "install_failed"
)

// DesktopUpdateChannel is the update feed the app follows. It is a named
// string so the generated client exposes the stable/beta union.
type DesktopUpdateChannel string

const (
	UpdateChannelStable DesktopUpdateChannel = "stable"
	UpdateChannelBeta   DesktopUpdateChannel = "beta"
)

// DesktopUpdateResult is the only update state the WebView receives: a
// validated status, version, bounded plain-text release notes, capabilities
// and real byte counts, never a URL, an upstream error or renderable HTML.
type DesktopUpdateResult struct {
	State         DesktopUpdateState   `json:"state"`
	Version       string               `json:"version,omitempty"`
	Notes         string               `json:"notes,omitempty"`
	Channel       DesktopUpdateChannel `json:"channel,omitempty"`
	BetaAvailable bool                 `json:"betaAvailable,omitempty"`
	// InstallAvailable means this build may install in place; DownloadAvailable
	// means the build configured a fixed manual installer page.
	InstallAvailable  bool   `json:"installAvailable,omitempty"`
	DownloadAvailable bool   `json:"downloadAvailable,omitempty"`
	Downloaded        *int64 `json:"downloaded,omitempty"`
	Total             *int64 `json:"total,omitempty"`
	Revision          int64  `json:"revision,omitempty,omitzero"`
}

var desktopUpdateChanged = mygo.NewEvent[DesktopUpdateResult]("desktop:update-changed")

// Injected by the release build. The feed is the full manifest URL of C's
// self-hosted URL-directory workflow; without it the app keeps its legacy
// check-only behavior. The installer page is an explicit HTTPS fallback.
var (
	desktopUpdateFeed         string
	desktopUpdateBetaFeed     string
	desktopUpdateInstallerURL string
	// desktopUpdateManifestKey is the same base64 Ed25519 public key as
	// updates.publicKey, injected by the release build to authenticate the
	// signed manifest envelope.
	desktopUpdateManifestKey string
)

const (
	updateChannelPreference   = "desktop.updateChannel"
	updateNotificationID      = "linksense:update-available"
	desktopUpdateSettingsPath = "/settings/general#desktop-update-heading"

	maxUpdateManifestSize       = 1 << 20
	maxUpdateSignedEnvelopeSize = maxUpdateManifestSize + 128
	maxUpdateDownloadSize       = 1 << 30
	maxUpdateNotesBytes         = 4096

	desktopUpdateCheckTimeout  = 15 * time.Second
	desktopUpdateCheckInterval = 4 * time.Hour
	desktopUpdateInstallLimit  = time.Hour
)

const updateManifestSignaturePrefix = "LinkSense desktop update manifest v1"

var (
	updateVersion = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.+-]+)?$`)

	// updateStallTimeout bounds how long a response body may send nothing.
	// The value is a test seam; production uses the upstream-compatible 15s.
	updateStallTimeout = 15 * time.Second

	errDesktopUpdateBusy                 = errors.New("DESKTOP_UPDATE_BUSY")
	errDesktopUpdateStale                = errors.New("DESKTOP_UPDATE_STALE")
	errDesktopUpdateUnavailable          = errors.New("DESKTOP_UPDATE_UNAVAILABLE")
	errDesktopUpdateNotStaged            = errors.New("DESKTOP_UPDATE_NOT_STAGED")
	errDesktopUpdateInstallerUnavailable = errors.New("DESKTOP_UPDATE_INSTALLER_UNAVAILABLE")
	errDesktopUpdatePreferenceFailed     = errors.New("DESKTOP_PREFERENCES_SAVE_FAILED")
	errDesktopUpdateInvalidChannel       = errors.New("VALIDATION_ERROR")
	errDesktopUpdateNotificationInvalid  = errors.New("DESKTOP_UPDATE_NOTIFICATION_INVALID")
)

func checkDesktopUpdate(ctx context.Context, check func(context.Context) (*mygo.Update, error)) DesktopUpdateResult {
	update, err := check(ctx)
	state, version := classifyDesktopUpdate(update, err)
	return DesktopUpdateResult{State: state, Version: version}
}

func classifyDesktopUpdate(update *mygo.Update, err error) (DesktopUpdateState, string) {
	switch {
	case errors.Is(err, mygo.ErrUpdatesDisabled):
		return UpdateUnavailable, ""
	case err != nil:
		return UpdateFailed, ""
	case update == nil:
		return UpdateCurrent, ""
	case len(update.Version) > 80 || !updateVersion.MatchString(update.Version):
		return UpdateFailed, ""
	default:
		return UpdateAvailable, update.Version
	}
}

// updateLease is the runner gate of runtime_update.go. The concrete guard is a
// *runtimeUpdateGuard; tests use a counter to prove release and hold.
type updateLease interface {
	release()
}

// updateNotificationAttempt fences one native update notification to the exact
// revision and account generation that made it eligible. A new check, stage,
// candidate or account invalidates it before its delivery wait completes.
type updateNotificationAttempt struct {
	ctx      context.Context
	cancel   context.CancelFunc
	lease    accountLease
	revision int64
	version  string
	canceled bool
	// delivered records that MyGo accepted the show. A repeated request after
	// its caller abandoned the call must not display the same notice twice.
	delivered bool
	done      chan struct{}
}

// closeUpdateNotification removes the one fixed update notice. It is a seam so
// the lifecycle tests can hold a stale cleanup in the same slot a replacement
// must not enter.
var closeUpdateNotification = func() { closeNotification(updateNotificationID) }

// desktopUpdates owns the self-hosted update lifecycle of one app run. It
// exists only when the release build injected a valid update feed; legacy
// package feeds keep using CheckForUpdate and can never stage an install.
type desktopUpdates struct {
	desktop *Desktop

	enabled       func() bool
	check         func(context.Context) (*mygo.Update, error)
	install       func(context.Context, *mygo.Update, func(int64, int64)) error
	acquire       func(context.Context) (updateLease, error)
	relaunch      func()
	quit          func()
	openInstaller func(string) error
	getPreference func(string, any) bool
	setPreference func(string, any) error
	applySource   func(mygo.UpdateSource)

	appCtx    context.Context
	cancelApp context.CancelFunc

	mu             sync.Mutex
	started        bool
	canPersist     bool
	installEnabled bool
	channel        DesktopUpdateChannel
	stableSource   *desktopUpdateSource
	betaSource     *desktopUpdateSource
	installerURL   string
	checking       bool
	installing     bool
	requestCancel  context.CancelFunc
	requestDone    chan struct{}
	notification   *updateNotificationAttempt
	// notifyWaiting is a test seam; tests use it to pin a request before an
	// account change instead of racing a scheduler sleep.
	notifyWaiting func()
	// notifyAdmission is a test seam; it runs before a request enters the update
	// lock, so a race test can invalidate the pinned account after the request
	// started but before it can reserve the notification slot.
	notifyAdmission func()
	result          DesktopUpdateResult
	revision        int64
	available       *mygo.Update
	quitAccepted    bool
	quitRequested   bool
	restarting      bool
}

func newDesktopUpdates(desktop *Desktop) *desktopUpdates {
	ctx, cancel := context.WithCancel(context.Background())
	return &desktopUpdates{
		desktop: desktop,
		enabled: func() bool {
			return runtime.GOOS == "darwin" && mygo.Updater.Enabled()
		},
		check: mygo.Updater.Check,
		install: func(ctx context.Context, update *mygo.Update, progress func(int64, int64)) error {
			return update.Install(ctx, progress)
		},
		acquire: func(ctx context.Context) (updateLease, error) {
			if desktop == nil || desktop.localRuntime == nil {
				return nil, errUpdateAdmissionUnavailable
			}
			return desktop.localRuntime.acquireUpdateAdmission(ctx)
		},
		// App.Quit posts to the main thread itself; no main-thread call waits here.
		relaunch: func() { mygo.App.Relaunch() },
		quit:     mygo.App.Quit,
		openInstaller: func(raw string) error {
			if desktop == nil {
				return errDesktopUpdateInstallerUnavailable
			}
			return desktop.openInSystemBrowser(raw)
		},
		getPreference: preferences.Get,
		setPreference: preferences.Set,
		applySource:   mygo.Updater.SetSource,
		appCtx:        ctx,
		cancelApp:     cancel,
		channel:       UpdateChannelStable,
		canPersist:    true,
		result:        DesktopUpdateResult{State: UpdateIdle},
	}
}

// start runs after installShell's corrupt-preference guard, so a JSON null
// preferences file has already been removed before preferences.Get loads it.
func (u *desktopUpdates) start() {
	u.mu.Lock()
	if u.started {
		u.mu.Unlock()
		return
	}
	u.started = true
	var stored string
	if u.getPreference(updateChannelPreference, &stored) {
		if candidate := DesktopUpdateChannel(stored); candidate == UpdateChannelStable || candidate == UpdateChannelBeta {
			u.channel = candidate
		}
	}
	u.installerURL = parseDesktopUpdateInstaller(desktopUpdateInstallerURL)
	if desktopUpdateFeed != "" {
		if key, err := parseDesktopUpdateManifestKey(desktopUpdateManifestKey); err != nil {
			log.Print("DESKTOP_UPDATE_MANIFEST_KEY_INVALID")
		} else {
			u.stableSource = parseDesktopUpdateSource(desktopUpdateFeed, key, "DESKTOP_UPDATE_FEED_INVALID")
			if u.stableSource != nil {
				u.betaSource = parseDesktopUpdateSource(desktopUpdateBetaFeed, key, "DESKTOP_UPDATE_BETA_FEED_INVALID")
				u.installEnabled = u.enabled()
			}
		}
	}
	if u.channel == UpdateChannelBeta && u.betaSource == nil {
		u.channel = UpdateChannelStable
	}
	state := UpdateUnavailable
	if u.installEnabled {
		u.applySourceLocked()
		state = UpdateIdle
	}
	u.emitLocked(u.resultFor(state, ""))
	startBackground := u.installEnabled && u.desktop != nil
	u.mu.Unlock()
	if startBackground {
		go u.backgroundChecks()
	}
}

func (u *desktopUpdates) setPreferences(canPersist bool) {
	u.mu.Lock()
	u.canPersist = canPersist
	u.mu.Unlock()
}

func (u *desktopUpdates) applySourceLocked() {
	if !u.installEnabled {
		return
	}
	if u.channel == UpdateChannelBeta && u.betaSource != nil {
		u.applySource(u.betaSource)
		return
	}
	u.applySource(u.stableSource)
}

func (u *desktopUpdates) resultFor(state DesktopUpdateState, version string) DesktopUpdateResult {
	result := DesktopUpdateResult{
		State:             state,
		Version:           version,
		InstallAvailable:  u.installEnabled,
		DownloadAvailable: u.installerURL != "",
	}
	if u.installEnabled {
		result.Channel = u.channel
		result.BetaAvailable = u.betaSource != nil
		result.Notes = u.candidateNotesLocked(version)
	}
	return result
}

// candidateNotesLocked accepts notes only from the verified candidate that
// matches this snapshot's version. MyGo reads Notes from the signed manifest,
// but the publisher still controls the text: bound it, require valid UTF-8
// and text characters, trim blanks, and let the WebView render it as text.
func (u *desktopUpdates) candidateNotesLocked(version string) string {
	if version == "" || u.available == nil || u.available.Version != version {
		return ""
	}
	return sanitizeDesktopUpdateNotes(u.available.Notes)
}

func sanitizeDesktopUpdateNotes(notes string) string {
	if len(notes) > maxUpdateNotesBytes || !utf8.ValidString(notes) {
		return ""
	}
	notes = strings.TrimSpace(notes)
	if notes == "" {
		return ""
	}
	for _, r := range notes {
		if r == '\n' || r == '\r' || r == '\t' {
			continue
		}
		if unicode.IsControl(r) {
			return ""
		}
	}
	return notes
}

// emitLocked is the single snapshot publisher: every distinct state gets a
// strictly monotonic revision before the event is enqueued. MyGo's Emit only
// appends to the window outbox and posts a flush, so it never waits on the UI.
func (u *desktopUpdates) emitLocked(result DesktopUpdateResult) DesktopUpdateResult {
	u.revision++
	result.Revision = u.revision
	u.cancelStaleNotificationLocked(result)
	u.result = result
	u.publish(result)
	return result
}

func (u *desktopUpdates) cancelStaleNotificationLocked(result DesktopUpdateResult) {
	attempt := u.notification
	if attempt == nil {
		return
	}
	if result.State == UpdateAvailable && result.Revision == attempt.revision &&
		result.Version == attempt.version {
		return
	}
	attempt.canceled = true
	attempt.cancel()
}

func (u *desktopUpdates) readyLocked() bool {
	return u.started && u.installEnabled
}

func (u *desktopUpdates) requestBusyLocked() bool {
	return u.quitAccepted || u.checking || u.installing
}

func (u *desktopUpdates) stateRequest() DesktopUpdateResult {
	u.mu.Lock()
	defer u.mu.Unlock()
	if !u.started {
		return DesktopUpdateResult{State: UpdateUnavailable}
	}
	return u.result
}

func (u *desktopUpdates) checkRequest(ctx context.Context) (DesktopUpdateResult, error) {
	u.mu.Lock()
	if !u.readyLocked() {
		result := u.result
		u.mu.Unlock()
		return result, nil
	}
	if u.requestBusyLocked() {
		result := u.result
		u.mu.Unlock()
		return result, errDesktopUpdateBusy
	}
	if u.result.State == UpdateStaged {
		result := u.result
		u.mu.Unlock()
		return result, nil
	}
	if ctx.Err() != nil {
		result := u.result
		u.mu.Unlock()
		return result, errDesktopUpdateBusy
	}
	previous, previousAvailable := u.result, u.available
	checkCtx, cancel := context.WithTimeout(ctx, desktopUpdateCheckTimeout)
	u.checking = true
	u.requestCancel = cancel
	u.requestDone = make(chan struct{})
	done := u.requestDone
	u.emitLocked(u.resultFor(UpdateChecking, previous.Version))
	u.mu.Unlock()

	update, err := u.check(checkCtx)
	canceled := ctx.Err() != nil || checkCtx.Err() == context.Canceled
	cancel()

	u.mu.Lock()
	u.checking = false
	u.requestCancel = nil
	if canceled {
		// A page navigation or app shutdown is not a failed feed.
		u.available = previousAvailable
		u.emitLocked(previous)
	} else {
		state, version := classifyDesktopUpdate(update, err)
		if errors.Is(err, mygo.ErrUpdatesDisabled) {
			// The install location or build can no longer update in place.
			// Drop the install capability so the UI offers the fixed manual
			// installer page instead of a dead install action.
			u.installEnabled = false
		}
		if state == UpdateAvailable {
			u.available = update
		} else {
			u.available = nil
		}
		u.emitLocked(u.resultFor(state, version))
	}
	result := u.result
	close(done)
	u.mu.Unlock()
	return result, nil
}

// showNotificationRequest shows one quiet notice for the exact available
// candidate the page rendered. It accepts no URL, text or version from the
// WebView; the localized body and ID come from the verified native snapshot.
func (u *desktopUpdates) showNotificationRequest(ctx context.Context, revision int64) error {
	if revision <= 0 {
		return errDesktopUpdateNotificationInvalid
	}
	if u.desktop == nil {
		return errDesktopUpdateUnavailable
	}
	// Pin the account generation for the whole call. Waiting for an earlier
	// attempt or an account change must not let this request act for a newer
	// session that happens to use the same user id.
	lease, err := requireAccount(&u.desktop.account)
	if err != nil {
		return err
	}
	// A notification request waits at most once for an earlier delivery. A
	// second canceled attempt in the same call means contention the page can
	// retry from a later eligible event, never an unbounded wait.
	waited := false
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if u.notifyAdmission != nil {
			u.notifyAdmission()
		}
		var attempt *updateNotificationAttempt
		var waiting *updateNotificationAttempt
		waitedSameAttempt := false
		u.mu.Lock()
		// Admission and slot reservation are one bounded section. withLease
		// holds the account read lease, so a clear either lands before it (and no
		// slot is reserved) or after it (and its callback sees the reserved
		// attempt). Neither lock is held across the native delivery or a wait.
		err = u.desktop.account.withLease(lease, func() error {
			if !u.readyLocked() {
				return errDesktopUpdateUnavailable
			}
			if u.result.State != UpdateAvailable || u.result.Revision != revision ||
				u.available == nil || u.available.Version == "" || u.available.Version != u.result.Version {
				return errDesktopUpdateStale
			}
			// The caller may have unloaded while this request waited for the lock.
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if u.requestBusyLocked() {
				return errDesktopUpdateBusy
			}
			if previous := u.notification; previous != nil {
				if waited {
					return errDesktopUpdateBusy
				}
				sameAttempt := previous.revision == revision && previous.version == u.result.Version
				sameLease := previous.lease.id == lease.id &&
					previous.lease.generation == lease.generation
				if sameAttempt && sameLease && !previous.canceled && previous.ctx.Err() == nil {
					// The same live delivery is still pending: never stack a second
					// notice for it.
					return errDesktopUpdateBusy
				}
				// A canceled or superseded attempt may still hold the fixed-ID
				// slot while it cleans up. Wait outside every lock; a notice that
				// was already delivered is not shown again.
				previous.canceled = true
				previous.cancel()
				waiting = previous
				waitedSameAttempt = sameAttempt && sameLease
				return nil
			}
			notificationCtx, cancel := context.WithDeadline(ctx, lease.expiresAt)
			attempt = &updateNotificationAttempt{
				ctx: notificationCtx, cancel: cancel, lease: lease,
				revision: revision, version: u.result.Version,
				done: make(chan struct{}),
			}
			u.notification = attempt
			return nil
		})
		if errors.Is(err, errAccountRequired) {
			// The pinned session was invalidated between requireAccount and
			// admission; it must never reserve the slot or reach delivery.
			err = errDesktopUpdateStale
		}
		u.mu.Unlock()
		if err != nil {
			return err
		}
		if waiting != nil {
			if u.notifyWaiting != nil {
				u.notifyWaiting()
			}
			select {
			case <-waiting.done:
			case <-ctx.Done():
				return ctx.Err()
			}
			if waitedSameAttempt && waiting.delivered {
				return errDesktopUpdateBusy
			}
			waited = true
			continue
		}
		if attempt == nil {
			// Admission returns nil only after reserving a slot or a wait.
			return errDesktopUpdateStale
		}
		body := locales.UpdateAvailableNotice(attempt.version)
		// An account or candidate change may have canceled the reserved attempt
		// after admission released the locks. Recheck the exact lease and the
		// cancellation before entering the native delivery seam; a cancel that
		// lands after this point cannot recall an OS banner already displayed.
		if attempt.ctx.Err() != nil || !u.desktop.account.matches(attempt.lease) {
			attempt.cancel()
			u.finishNotificationAttempt(attempt)
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return errDesktopUpdateStale
		}

		showErr := u.desktop.showNotification(attempt.ctx, mygo.NotificationOptions{
			ID: updateNotificationID, Body: body, Silent: true,
		})

		// A successful acknowledgement and the slot release share this bounded
		// admission section. An account clear either invalidates the lease
		// before it, so the delivery is treated as stale, or waits until the
		// success has been published and the slot released. Inspect the caller's
		// context here too: a page that unloaded during the native call must not
		// keep a success or leave a notice the WebView no longer owns.
		delivered := showErr == nil
		accepted := false
		u.mu.Lock()
		accountErr := u.desktop.account.withLease(attempt.lease, func() error {
			attempt.delivered = delivered
			if ctx.Err() != nil {
				return ctx.Err()
			}
			// The attempt stays pinned to the lease expiry it was admitted with.
			// A same-generation refresh may extend the account for later
			// requests, but it must not revive this expired native attempt.
			if attempt.ctx.Err() != nil || attempt.canceled || u.notification != attempt ||
				u.result.State != UpdateAvailable || u.result.Revision != attempt.revision ||
				u.available == nil || u.available.Version != attempt.version {
				return errDesktopUpdateStale
			}
			u.finishNotificationAttemptLocked(attempt)
			accepted = true
			return nil
		})
		u.mu.Unlock()
		if accepted {
			attempt.cancel()
			return showErr
		}
		if delivered {
			// Keep this slot occupied until the fixed-ID notice is really gone.
			// Closing after releasing the slot could delete a replacement that
			// reused the same id in the gap.
			closeUpdateNotification()
		}
		u.finishNotificationAttempt(attempt)
		attempt.cancel()
		if accountErr != nil && !errors.Is(accountErr, errAccountRequired) {
			return accountErr
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errDesktopUpdateStale
	}
}

// finishNotificationAttempt releases the single notification slot and lets a
// replacement proceed. The caller owns the attempt and calls it once.
func (u *desktopUpdates) finishNotificationAttempt(attempt *updateNotificationAttempt) {
	u.mu.Lock()
	u.finishNotificationAttemptLocked(attempt)
	u.mu.Unlock()
}

// finishNotificationAttemptLocked is finishNotificationAttempt for a caller
// that already holds the update mutex, so acknowledgement and slot release
// linearize with the account check.
func (u *desktopUpdates) finishNotificationAttemptLocked(attempt *updateNotificationAttempt) {
	if u.notification == attempt {
		u.notification = nil
	}
	close(attempt.done)
}

// cancelUpdateNotification cancels only an attempt whose exact account lease is
// no longer current. A delayed invalidation for an older session must not
// cancel a notice admitted for the new session, even for the same user id.
func (u *desktopUpdates) cancelUpdateNotification() {
	if u.desktop == nil {
		return
	}
	u.mu.Lock()
	attempt := u.notification
	u.mu.Unlock()
	if attempt == nil || u.desktop.account.matches(attempt.lease) {
		return
	}
	u.mu.Lock()
	if !attempt.canceled {
		attempt.canceled = true
		attempt.cancel()
	}
	u.mu.Unlock()
}

func (u *desktopUpdates) installRequest(ctx context.Context, revision int64) (DesktopUpdateResult, error) {
	u.mu.Lock()
	if !u.readyLocked() {
		result := u.result
		u.mu.Unlock()
		return result, errDesktopUpdateUnavailable
	}
	if u.requestBusyLocked() {
		result := u.result
		u.mu.Unlock()
		return result, errDesktopUpdateBusy
	}
	retryable := u.result.State == UpdateAvailable || u.result.State == UpdateInstallFailed || u.result.State == UpdateBusy
	if !retryable || u.result.Revision != revision || u.available == nil || u.available.Version != u.result.Version {
		result := u.result
		u.mu.Unlock()
		return result, errDesktopUpdateStale
	}
	// The WebView may have unloaded while this call waited for the mutex.
	if ctx.Err() != nil {
		result := u.result
		u.mu.Unlock()
		return result, errDesktopUpdateBusy
	}
	update, version := u.available, u.result.Version
	// Admission still follows the caller: a page that unloads before the
	// runner grants the lease aborts the attempt.
	admissionCtx, cancelAdmission := context.WithTimeout(ctx, desktopUpdateInstallLimit)
	u.installing = true
	u.requestCancel = cancelAdmission
	u.requestDone = make(chan struct{})
	done := u.requestDone
	u.emitLocked(u.resultFor(UpdateBusy, version))
	u.mu.Unlock()

	guard, err := u.acquire(admissionCtx)
	cancelAdmission()
	if err != nil || guard == nil {
		if guard != nil {
			guard.release()
		}
		if err == nil {
			err = errUpdateAdmissionUnavailable
		}
		return u.finishInstallFailure(done, nil, err, version)
	}

	u.mu.Lock()
	if u.quitAccepted || u.quitRequested {
		u.installing = false
		u.requestCancel = nil
		result := u.result
		scheduleQuit := u.quitRequested && !u.quitAccepted
		if scheduleQuit {
			u.quitRequested = false
		}
		u.mu.Unlock()
		guard.release()
		close(done)
		if scheduleQuit {
			u.quit()
		}
		return result, errDesktopUpdateBusy
	}
	// Once admitted, an app-owned context keeps the install independent of
	// the caller's page or route.
	installCtx, cancelInstall := context.WithTimeout(u.appCtx, desktopUpdateInstallLimit)
	u.requestCancel = cancelInstall
	u.emitLocked(u.resultFor(UpdateDownloading, version))
	u.mu.Unlock()

	err = u.install(installCtx, update, u.reportProgress)
	cancelInstall()
	if err != nil {
		return u.finishInstallFailure(done, guard, err, version)
	}
	return u.finishInstallStaged(done, version)
}

// finishInstallFailure releases the runner lease before publishing a
// retryable snapshot: the next install must not start from a state that still
// owns the gate, and the Web store must never see idle before the release.
func (u *desktopUpdates) finishInstallFailure(done chan struct{}, guard updateLease, cause error, version string) (DesktopUpdateResult, error) {
	if guard != nil {
		guard.release()
	}
	u.mu.Lock()
	u.installing = false
	u.requestCancel = nil
	quitAccepted := u.quitAccepted
	var result DesktopUpdateResult
	if quitAccepted {
		// Quit already owns the process; leave the last published state alone.
		result = u.result
	} else if errors.Is(cause, errUpdateAdmissionBusy) {
		result = u.emitLocked(u.resultFor(UpdateBusy, version))
	} else {
		result = u.emitLocked(u.resultFor(UpdateInstallFailed, version))
	}
	scheduleQuit := u.quitRequested && !quitAccepted
	if scheduleQuit {
		u.quitRequested = false
	}
	u.mu.Unlock()
	close(done)
	if scheduleQuit {
		u.quit()
	}
	switch {
	case quitAccepted:
		return result, errDesktopUpdateBusy
	case errors.Is(cause, errUpdateAdmissionBusy):
		return result, nil
	case errors.Is(cause, errUpdateAdmissionUnavailable):
		return result, errUpdateAdmissionUnavailable
	default:
		return result, nil
	}
}

// finishInstallStaged intentionally leaves the supervisor's lease held: the
// staged bundle applies at exit, however the app exits.
func (u *desktopUpdates) finishInstallStaged(done chan struct{}, version string) (DesktopUpdateResult, error) {
	u.mu.Lock()
	u.installing = false
	u.requestCancel = nil
	u.available = nil
	result := u.result
	result.State = UpdateStaged
	result.Version = version
	result = u.emitLocked(result)
	scheduleQuit := u.quitRequested && !u.quitAccepted
	if scheduleQuit {
		u.quitRequested = false
	}
	u.mu.Unlock()
	close(done)
	if scheduleQuit {
		u.quit()
	}
	return result, nil
}

func (u *desktopUpdates) reportProgress(downloaded, total int64) {
	if downloaded < 0 || total <= 0 || total > maxUpdateDownloadSize || downloaded > total {
		return
	}
	u.mu.Lock()
	if !u.installing || u.quitAccepted {
		u.mu.Unlock()
		return
	}
	if u.result.State == UpdateDownloading && u.result.Downloaded != nil && u.result.Total != nil &&
		*u.result.Downloaded == downloaded && *u.result.Total == total {
		u.mu.Unlock()
		return
	}
	result := u.result
	result.State = UpdateDownloading
	result.Downloaded, result.Total = &downloaded, &total
	u.emitLocked(result)
	u.mu.Unlock()
}

func (u *desktopUpdates) setChannelRequest(raw string) (DesktopUpdateResult, error) {
	channel := DesktopUpdateChannel(raw)
	if channel != UpdateChannelStable && channel != UpdateChannelBeta {
		return u.stateRequest(), errDesktopUpdateInvalidChannel
	}
	u.mu.Lock()
	if !u.readyLocked() {
		result := u.result
		u.mu.Unlock()
		return result, errDesktopUpdateUnavailable
	}
	if u.requestBusyLocked() {
		result := u.result
		u.mu.Unlock()
		return result, errDesktopUpdateBusy
	}
	if channel == u.channel {
		result := u.result
		u.mu.Unlock()
		return result, nil
	}
	if channel == UpdateChannelBeta && u.betaSource == nil {
		result := u.result
		u.mu.Unlock()
		return result, errDesktopUpdateUnavailable
	}
	if !u.canPersist {
		result := u.result
		u.mu.Unlock()
		return result, errDesktopUpdatePreferenceFailed
	}
	if err := u.setPreference(updateChannelPreference, raw); err != nil {
		log.Print("DESKTOP_PREFERENCES_SAVE_FAILED")
		result := u.result
		u.mu.Unlock()
		return result, errDesktopUpdatePreferenceFailed
	}
	u.channel = channel
	u.applySourceLocked()
	var result DesktopUpdateResult
	if u.result.State == UpdateStaged {
		// The staged bundle stays locked in; the channel applies next launch.
		u.available = nil
		next := u.result
		next.Channel = channel
		next.BetaAvailable = u.betaSource != nil
		result = u.emitLocked(next)
	} else {
		u.available = nil
		result = u.emitLocked(u.resultFor(UpdateIdle, ""))
	}
	u.mu.Unlock()
	return result, nil
}

func (u *desktopUpdates) restartRequest() error {
	u.mu.Lock()
	if u.result.State != UpdateStaged {
		u.mu.Unlock()
		return errDesktopUpdateNotStaged
	}
	if u.quitAccepted || u.restarting {
		u.mu.Unlock()
		return errDesktopUpdateBusy
	}
	u.restarting = true
	relaunch := u.relaunch
	u.mu.Unlock()
	relaunch()
	return nil
}

func (u *desktopUpdates) openInstallerRequest() error {
	u.mu.Lock()
	if u.quitAccepted {
		u.mu.Unlock()
		return errDesktopUpdateBusy
	}
	raw := u.installerURL
	open := u.openInstaller
	u.mu.Unlock()
	if raw == "" {
		return errDesktopUpdateInstallerUnavailable
	}
	if err := open(raw); err != nil {
		return errDesktopUpdateInstallerUnavailable
	}
	return nil
}

// beforeQuit reports whether the ordinary quit may proceed. While an install
// (or its admission wait) is in flight it prevents the quit, cancels the
// bounded install, and the install goroutine quits again once it has released
// its lease. An OS session end cannot be prevented.
func (u *desktopUpdates) beforeQuit(sessionEnding bool) bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.quitAccepted {
		return true
	}
	if sessionEnding {
		u.quitAccepted = true
		u.quitRequested = false
		if u.requestCancel != nil {
			u.requestCancel()
		}
		return true
	}
	if u.installing {
		u.quitRequested = true
		if u.requestCancel != nil {
			u.requestCancel()
		}
		return false
	}
	if u.requestCancel != nil {
		u.requestCancel()
	}
	u.quitAccepted = true
	return true
}

// quitCanceled runs after another listener cancels a quit. A staged restart
// can then be requested again.
func (u *desktopUpdates) quitCanceled() {
	u.mu.Lock()
	u.quitAccepted = false
	u.restarting = false
	u.mu.Unlock()
}

// shutdown waits synchronously, on the main thread, for any in-flight update
// work before runtime and device shutdown. It makes no native UI call.
func (u *desktopUpdates) shutdown() {
	u.mu.Lock()
	u.quitAccepted = true
	u.quitRequested = false
	u.cancelApp()
	if u.requestCancel != nil {
		u.requestCancel()
	}
	if u.notification != nil {
		u.notification.canceled = true
		u.notification.cancel()
	}
	done := u.requestDone
	u.mu.Unlock()
	if done != nil {
		<-done
	}
}

func (u *desktopUpdates) backgroundChecks() {
	u.backgroundCheck()
	ticker := time.NewTicker(desktopUpdateCheckInterval)
	defer ticker.Stop()
	for {
		select {
		case <-u.appCtx.Done():
			return
		case <-ticker.C:
			u.backgroundCheck()
		}
	}
}

func (u *desktopUpdates) backgroundCheck() {
	u.mu.Lock()
	skip := !u.readyLocked() || u.requestBusyLocked() || u.result.State == UpdateStaged
	u.mu.Unlock()
	if !skip {
		_, _ = u.checkRequest(u.appCtx)
	}
}

func (u *desktopUpdates) publish(result DesktopUpdateResult) {
	if u.desktop == nil {
		return
	}
	win := u.desktop.mainWindow()
	if win == nil {
		return
	}
	_ = desktopUpdateChanged.Emit(win, result)
}

func parseDesktopUpdateManifestKey(raw string) (ed25519.PublicKey, error) {
	raw = strings.TrimSpace(raw)
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(key) != ed25519.PublicKeySize || base64.StdEncoding.EncodeToString(key) != raw {
		return nil, errors.New("DESKTOP_UPDATE_MANIFEST_KEY_INVALID")
	}
	return ed25519.PublicKey(key), nil
}

func parseDesktopUpdateSource(raw string, key ed25519.PublicKey, errorCode string) *desktopUpdateSource {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	source, err := newDesktopUpdateSource(raw, key, nil)
	if err != nil {
		log.Print(errorCode)
		return nil
	}
	return source
}

func parseDesktopUpdateInstaller(raw string) string {
	installer, ok := validUpdateInstaller(raw)
	if !ok && strings.TrimSpace(raw) != "" {
		log.Print("DESKTOP_UPDATE_INSTALLER_INVALID")
	}
	return installer
}

// packagedUpdateInstaller returns the fixed installer page, if the build
// configured one, without logging on every read.
func packagedUpdateInstaller() string {
	installer, _ := validUpdateInstaller(desktopUpdateInstallerURL)
	return installer
}

func validUpdateInstaller(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil ||
		u.Fragment != "" || u.Opaque != "" || strings.ContainsAny(raw, "\x00\r\n") {
		return "", false
	}
	return u.String(), true
}

// desktopUpdateSource is the minimal transport of the self-hosted feeds. The
// manifest is fetched from the configured URL with ".signed" appended and is
// authenticated as a detached Ed25519 envelope; the verified JSON bytes are
// returned unchanged to MyGo. Artifacts stay same-origin HTTP(S) downloads;
// the signed envelope, not TLS, is the integrity boundary.
type desktopUpdateSource struct {
	manifestURL string // exact configured URL covered by the signature
	signedURL   string // manifestURL + ".signed"
	origin      url.URL
	manifestKey ed25519.PublicKey
	client      *http.Client
}

func newDesktopUpdateSource(raw string, key ed25519.PublicKey, transport http.RoundTripper) (*desktopUpdateSource, error) {
	if raw != strings.TrimSpace(raw) {
		return nil, errors.New("DESKTOP_UPDATE_URL_FORBIDDEN")
	}
	u, err := parseDesktopUpdateURL(raw)
	if err != nil {
		return nil, err
	}
	signedURL := raw + ".signed"
	if _, err := parseDesktopUpdateURL(signedURL); err != nil {
		return nil, err
	}
	if len(key) != ed25519.PublicKeySize {
		return nil, errors.New("DESKTOP_UPDATE_MANIFEST_KEY_INVALID")
	}
	if transport == nil {
		t := netproxy.Transport().Clone()
		t.ResponseHeaderTimeout = 30 * time.Second
		t.TLSHandshakeTimeout = 10 * time.Second
		transport = t
	}
	client := &http.Client{
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	return &desktopUpdateSource{
		manifestURL: raw,
		signedURL:   signedURL,
		origin:      url.URL{Scheme: u.Scheme, Host: u.Host},
		manifestKey: key,
		client:      client,
	}, nil
}

func parseDesktopUpdateURL(raw string) (*url.URL, error) {
	if strings.ContainsAny(raw, "\x00\r\n") {
		return nil, errors.New("DESKTOP_UPDATE_URL_FORBIDDEN")
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || u.User != nil || u.Fragment != "" || u.Opaque != "" ||
		u.RawQuery != "" || u.ForceQuery {
		return nil, errors.New("DESKTOP_UPDATE_URL_FORBIDDEN")
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return nil, errors.New("DESKTOP_UPDATE_URL_FORBIDDEN")
	}
	return u, nil
}

func (s *desktopUpdateSource) Manifest(ctx context.Context, _ bool) (io.ReadCloser, error) {
	body, err := s.open(ctx, s.signedURL)
	if err != nil {
		return nil, err
	}
	defer body.Close()
	envelope, err := io.ReadAll(io.LimitReader(body, maxUpdateSignedEnvelopeSize+1))
	if err != nil {
		return nil, err
	}
	if len(envelope) > maxUpdateSignedEnvelopeSize {
		return nil, errors.New("update manifest envelope too large")
	}
	signatureText, manifest, found := bytes.Cut(envelope, []byte("\n"))
	if !found || len(manifest) == 0 || len(manifest) > maxUpdateManifestSize {
		return nil, errors.New("invalid update manifest envelope")
	}
	signature, err := base64.StdEncoding.DecodeString(string(signatureText))
	if err != nil || len(signature) != ed25519.SignatureSize ||
		base64.StdEncoding.EncodeToString(signature) != string(signatureText) {
		return nil, errors.New("invalid update manifest signature")
	}
	message := make([]byte, 0, len(updateManifestSignaturePrefix)+len(s.manifestURL)+len(manifest)+2)
	message = append(message, updateManifestSignaturePrefix...)
	message = append(message, '\n')
	message = append(message, s.manifestURL...)
	message = append(message, '\n')
	message = append(message, manifest...)
	if !ed25519.Verify(s.manifestKey, message, signature) {
		return nil, errors.New("the update manifest signature is invalid")
	}
	// MyGo parses and later verifies artifacts from these exact bytes; this
	// transport never reserializes the manifest or reimplements its parser.
	return io.NopCloser(bytes.NewReader(manifest)), nil
}

func (s *desktopUpdateSource) Open(ctx context.Context, raw string) (io.ReadCloser, error) {
	return s.open(ctx, raw)
}

func (s *desktopUpdateSource) open(ctx context.Context, raw string) (io.ReadCloser, error) {
	u, err := parseDesktopUpdateURL(raw)
	if err != nil || !sameUpdateOrigin(u, s.origin) {
		return nil, errors.New("DESKTOP_UPDATE_URL_FORBIDDEN")
	}
	requestCtx, cancel := context.WithCancel(ctx)
	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, u.String(), nil)
	if err != nil {
		cancel()
		return nil, err
	}
	request.Header.Set("User-Agent", "mygo-updater")
	response, err := s.client.Do(request)
	if err != nil {
		cancel()
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		cancel()
		return nil, fmt.Errorf("GET %s: %s", u.Redacted(), response.Status)
	}
	return newUpdateStallBody(response.Body, cancel), nil
}

// updateStallBody cancels one HTTP fetch when its body stops arriving. The
// cancel is bound to the child request context, never the caller's install
// context: MyGo must still be able to fall back from a failed delta to the
// full archive.
type updateStallBody struct {
	body      io.ReadCloser
	cancel    context.CancelFunc
	timeout   time.Duration
	last      atomic.Int64
	stalled   atomic.Bool
	done      chan struct{}
	closeOnce sync.Once
}

func newUpdateStallBody(body io.ReadCloser, cancel context.CancelFunc) *updateStallBody {
	stalled := &updateStallBody{body: body, cancel: cancel, timeout: updateStallTimeout, done: make(chan struct{})}
	stalled.last.Store(time.Now().UnixNano())
	go stalled.watch()
	return stalled
}

func (b *updateStallBody) watch() {
	interval := b.timeout / 4
	if interval <= 0 {
		interval = time.Millisecond
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-b.done:
			return
		case <-ticker.C:
			if time.Since(time.Unix(0, b.last.Load())) >= b.timeout {
				b.stalled.Store(true)
				b.cancel()
				return
			}
		}
	}
}

func (b *updateStallBody) Read(p []byte) (int, error) {
	n, err := b.body.Read(p)
	if n > 0 {
		b.last.Store(time.Now().UnixNano())
	}
	if err != nil && b.stalled.Load() {
		return n, errors.New("the update download stalled: the connection sent nothing")
	}
	return n, err
}

func (b *updateStallBody) Close() error {
	b.closeOnce.Do(func() {
		close(b.done)
		b.cancel()
	})
	return b.body.Close()
}

func sameUpdateOrigin(u *url.URL, origin url.URL) bool {
	return strings.EqualFold(u.Scheme, origin.Scheme) &&
		strings.EqualFold(u.Hostname(), origin.Hostname()) &&
		effectivePort(u) == effectivePort(&origin)
}

// legacyDesktopUpdate keeps the package-feed check-only behavior on builds
// that did not receive the self-hosted feed. It adds only the fixed installer
// capability, and callers can never stage an install from this result.
func legacyDesktopUpdate(ctx context.Context, check func(context.Context) (*mygo.Update, error)) DesktopUpdateResult {
	result := checkDesktopUpdate(ctx, check)
	if runtime.GOOS == "darwin" {
		result.DownloadAvailable = packagedUpdateInstaller() != ""
	}
	return result
}

func (d *Desktop) CheckForUpdate(ctx context.Context) (DesktopUpdateResult, error) {
	if err := d.checkCaller(ctx); err != nil {
		return DesktopUpdateResult{}, err
	}
	if d.updates == nil {
		ctx, cancel := context.WithTimeout(ctx, desktopUpdateCheckTimeout)
		defer cancel()
		return legacyDesktopUpdate(ctx, mygo.Updater.Check), nil
	}
	return d.updates.checkRequest(ctx)
}

func (d *Desktop) GetUpdateState(ctx context.Context) (DesktopUpdateResult, error) {
	if err := d.checkCaller(ctx); err != nil {
		return DesktopUpdateResult{}, err
	}
	if d.updates == nil {
		result := DesktopUpdateResult{State: UpdateUnavailable}
		if runtime.GOOS == "darwin" {
			result.DownloadAvailable = packagedUpdateInstaller() != ""
		}
		return result, nil
	}
	return d.updates.stateRequest(), nil
}

// ShowUpdateNotification shows one quiet system notice for the exact signed
// candidate revision. The page supplies no text, version or URL, and the
// native controller rechecks the account, snapshot and candidate under lock.
func (d *Desktop) ShowUpdateNotification(ctx context.Context, revision int64) error {
	if err := d.checkCaller(ctx); err != nil {
		return err
	}
	if !desktopNativeNotifications() {
		return errNotificationsUnsupported
	}
	if revision <= 0 {
		return errDesktopUpdateNotificationInvalid
	}
	if win := d.mainWindow(); win != nil && win.IsVisible() && win.IsFocused() {
		// The foreground app already shows the in-app availability toast.
		return errDesktopUpdateStale
	}
	if d.updates == nil {
		return errDesktopUpdateUnavailable
	}
	return d.updates.showNotificationRequest(ctx, revision)
}

func (d *Desktop) InstallUpdate(ctx context.Context, revision int64) (DesktopUpdateResult, error) {
	if err := d.checkCaller(ctx); err != nil {
		return DesktopUpdateResult{}, err
	}
	if d.updates == nil {
		return DesktopUpdateResult{State: UpdateUnavailable}, errDesktopUpdateUnavailable
	}
	return d.updates.installRequest(ctx, revision)
}

func (d *Desktop) SetUpdateChannel(ctx context.Context, channel string) (DesktopUpdateResult, error) {
	if err := d.checkCaller(ctx); err != nil {
		return DesktopUpdateResult{}, err
	}
	if d.updates == nil {
		return DesktopUpdateResult{State: UpdateUnavailable}, errDesktopUpdateUnavailable
	}
	return d.updates.setChannelRequest(channel)
}

func (d *Desktop) RestartAfterUpdate(ctx context.Context) error {
	if err := d.checkCaller(ctx); err != nil {
		return err
	}
	if d.updates == nil {
		return errDesktopUpdateNotStaged
	}
	return d.updates.restartRequest()
}

func (d *Desktop) OpenUpdateInstaller(ctx context.Context) error {
	if err := d.checkCaller(ctx); err != nil {
		return err
	}
	if d.updates == nil {
		if runtime.GOOS != "darwin" {
			return errDesktopUpdateInstallerUnavailable
		}
		raw := packagedUpdateInstaller()
		if raw == "" {
			return errDesktopUpdateInstallerUnavailable
		}
		if err := d.openInSystemBrowser(raw); err != nil {
			return errDesktopUpdateInstallerUnavailable
		}
		return nil
	}
	return d.updates.openInstallerRequest()
}

func (d *Desktop) startUpdates() {
	if d.updates == nil {
		return
	}
	d.updates.setPreferences(d.preferencesWritable)
	d.updates.start()
}

func (d *Desktop) beforeQuit(event *mygo.QuitEvent) {
	if d.updates != nil && !d.updates.beforeQuit(event.SessionEnding) {
		event.PreventDefault()
	}
}

func (d *Desktop) updateQuitCanceled() {
	if d.updates != nil {
		d.updates.quitCanceled()
	}
}
