package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/egoist/mygo"
)

const (
	// A save ticket covers the authenticated fetch and the WebView save, then
	// waits only long enough for the user to choose the explicit Finder action.
	// Reusable preview sources are not clock-expired; they follow the account
	// lease and page epoch and are bounded by artifactPreviewMaximum.
	artifactDownloadLifetime = 15 * time.Minute
	// Concurrent saves are few; the bound keeps a page from accumulating
	// unbounded native state.
	artifactDownloadMaximum = 8
	artifactPreviewMaximum  = 8
	// Every native write admitted before MyGo's destination callback takes one
	// slot in one bounded table, ordinary or Finder and whatever its path. With
	// no slot the callback is cancelled before MyGo writes anything; only that
	// write's exact terminal callback frees the slot.
	artifactDownloadOperationMaximum = 64
	// Tickets and invalidated URLs share one bounded state budget. Invalidated
	// URLs are never evicted; once the budget is full, new tickets fail closed.
	artifactDownloadTrackedMaximum = 64
	artifactDownloadHandleBytes    = 32
	artifactDownloadURLMaxBytes    = 4096
)

var (
	errArtifactDownloadUnavailable = errors.New("DESKTOP_DOWNLOAD_UNAVAILABLE")
	errArtifactDownloadInvalid     = errors.New("DESKTOP_DOWNLOAD_INVALID")
	errArtifactDownloadStale       = errors.New("DESKTOP_DOWNLOAD_STALE")
	errArtifactDownloadMissing     = errors.New("DESKTOP_DOWNLOAD_MISSING")
	// showItemInFolder is the exact MyGo primitive the explicit action uses.
	// Tests replace it so no fixture can activate Finder.
	showItemInFolder = func(path string) { mygo.Shell.ShowItemInFolder(path) }
)

// ArtifactDownloadSaved identifies a successful save without exposing its
// path. The page uses the opaque handle only for the explicit Finder action.
type ArtifactDownloadSaved struct {
	Handle string `json:"handle"`
	Name   string `json:"name"`
}

var desktopArtifactSaved = mygo.NewEvent[ArtifactDownloadSaved]("desktop:artifact-saved")

type artifactDownloadPhase uint8

const (
	artifactDownloadArmed artifactDownloadPhase = iota
	artifactDownloadStarted
	artifactDownloadCompleted
)

type artifactDownloadTicket struct {
	handle    string
	lease     accountLease
	page      *mygo.Page
	pageEpoch uint64
	phase     artifactDownloadPhase
	blobURL   string
	path      string
	name      string
	info      os.FileInfo
	createdAt time.Time
}

// artifactPreviewSource is one live preview's reusable provenance. It owns no
// bytes, path, or writer: it proves which account generation and page document
// loaded the bytes that a later save may use. Save tickets are derived from it.
type artifactPreviewSource struct {
	lease     accountLease
	page      *mygo.Page
	pageEpoch uint64
}

// artifactDownloadWriter identifies one admitted MyGo write. MyGo's start and
// done callbacks share exactly this page, URL, and path, so only that callback
// may release the slot; another page with the same URL and path is a different
// writer.
type artifactDownloadWriter struct {
	page *mygo.Page
	url  string
	path string
}

// artifactDownloadTracker keeps only bounded, single-use tickets. It never
// accepts a caller path; the path and file identity come from the exact MyGo
// OnWillDownload/OnDownloadDone pair.
type artifactDownloadTracker struct {
	mu      sync.Mutex
	tickets map[string]*artifactDownloadTicket
	// sources are reusable preview provenance handles. They are separate from
	// single-use save tickets and are never armed, completed, or revealed.
	sources map[string]*artifactPreviewSource
	// invalidated holds exact armed blob URLs whose ticket was discarded
	// before MyGo's destination callback. They are never evicted or expired:
	// a late callback must still be cancelled instead of becoming an
	// ordinary write. The entry is consumed only when that callback arrives.
	invalidated map[string]struct{}
	// writers records every admitted MyGo write in one table. The total slot
	// count bounds the table even when one path holds many writers. Only the
	// matching terminal callback releases a slot; no clock, sign-out, ticket
	// expiry, or document reload does.
	// shortcut: a destroyed window may drop MyGo's done callback, so its slot
	// stays occupied until app restart; exact lexical paths are not a general
	// filesystem lock.
	writers    map[artifactDownloadWriter]int
	operations int
	epochs     map[*mygo.Page]uint64
	now        func() time.Time
	random     func([]byte) (int, error)
}

func (t *artifactDownloadTracker) clock() time.Time {
	if t.now != nil {
		return t.now()
	}
	return time.Now()
}

func (t *artifactDownloadTracker) randomBytes(buf []byte) (int, error) {
	if t.random != nil {
		return t.random(buf)
	}
	return rand.Read(buf)
}

func (t *artifactDownloadTracker) epochLocked(page *mygo.Page) uint64 {
	if t.epochs == nil {
		t.epochs = make(map[*mygo.Page]uint64)
	}
	return t.epochs[page]
}

func (t *artifactDownloadTracker) trackedLocked() int {
	return len(t.tickets) + len(t.invalidated) + len(t.sources)
}

func (t *artifactDownloadTracker) newHandleLocked() (string, error) {
	for attempt := 0; attempt < 4; attempt++ {
		var raw [artifactDownloadHandleBytes]byte
		if _, err := t.randomBytes(raw[:]); err != nil {
			return "", errArtifactDownloadUnavailable
		}
		handle := base64.RawURLEncoding.EncodeToString(raw[:])
		if t.tickets[handle] == nil && t.sources[handle] == nil {
			return handle, nil
		}
	}
	return "", errArtifactDownloadUnavailable
}

func (t *artifactDownloadTracker) addTicketLocked(
	lease accountLease, page *mygo.Page, pageEpoch uint64, now time.Time,
) (string, error) {
	handle, err := t.newHandleLocked()
	if err != nil {
		return "", err
	}
	if t.tickets == nil {
		t.tickets = make(map[string]*artifactDownloadTicket)
	}
	t.tickets[handle] = &artifactDownloadTicket{
		handle: handle, lease: lease, page: page,
		pageEpoch: pageEpoch, phase: artifactDownloadArmed, createdAt: now,
	}
	return handle, nil
}

// invalidateLocked remembers an armed URL that must not write after its
// ticket was dropped. The URL is unique per save and is only matched against
// MyGo's exact destination event.
func (t *artifactDownloadTracker) invalidateLocked(rawURL string) {
	if rawURL == "" {
		return
	}
	if t.invalidated == nil {
		t.invalidated = make(map[string]struct{})
	}
	t.invalidated[rawURL] = struct{}{}
}

func (t *artifactDownloadTracker) takeInvalidatedLocked(rawURL string) bool {
	if rawURL == "" || t.invalidated == nil {
		return false
	}
	if _, ok := t.invalidated[rawURL]; !ok {
		return false
	}
	delete(t.invalidated, rawURL)
	return true
}

// takeInvalidated consumes the tombstone when MyGo's single WKDownload
// destination decision arrives. Cancelling that callback ends the attempt;
// the URL is not a path lookup and cannot be reused by the normal save flow.
func (t *artifactDownloadTracker) takeInvalidated(rawURL string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.takeInvalidatedLocked(rawURL)
}

// discardTicketLocked drops one ticket and remembers its armed URL. An
// unarmed ticket has no destination to cancel and is simply forgotten.
func (t *artifactDownloadTracker) discardTicketLocked(handle string, ticket *artifactDownloadTicket) {
	if ticket.phase == artifactDownloadArmed {
		t.invalidateLocked(ticket.blobURL)
	}
	delete(t.tickets, handle)
}

// pruneLocked expires save tickets only. Preview sources intentionally have no
// clock expiry: an open preview must remain saveable while its exact account
// lease and page document are still valid. Active writer occupancy has no age
// either: MyGo pairs each start with one terminal callback, and a clock jump,
// sign-out, ticket expiry, or document reload must not make a live write look
// idle. Only the exact done callback releases its slot.
func (t *artifactDownloadTracker) pruneLocked(now time.Time) {
	for handle, ticket := range t.tickets {
		if now.Sub(ticket.createdAt) >= artifactDownloadLifetime {
			// An expired armed ticket must still cancel its late destination
			// event. Expiry is not permission to treat the URL as ordinary.
			t.discardTicketLocked(handle, ticket)
		}
	}
}

func (t *artifactDownloadTracker) begin(lease accountLease, page *mygo.Page) (string, error) {
	if page == nil || lease.id == "" {
		return "", errArtifactDownloadStale
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.clock()
	t.pruneLocked(now)
	if len(t.tickets) >= artifactDownloadMaximum ||
		t.trackedLocked() >= artifactDownloadTrackedMaximum {
		return "", errArtifactDownloadUnavailable
	}
	return t.addTicketLocked(lease, page, t.epochLocked(page), now)
}

// beginPreview keeps one reusable provenance handle for a live preview. Its
// lifetime follows the exact account lease and page epoch rather than the save
// ticket timeout, so an open preview can still start a save later in the same
// valid session. It is bounded separately from save tickets.
func (t *artifactDownloadTracker) beginPreview(lease accountLease, page *mygo.Page) (string, error) {
	if page == nil || lease.id == "" {
		return "", errArtifactDownloadStale
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.pruneLocked(t.clock())
	if len(t.sources) >= artifactPreviewMaximum ||
		t.trackedLocked() >= artifactDownloadTrackedMaximum {
		return "", errArtifactDownloadUnavailable
	}
	handle, err := t.newHandleLocked()
	if err != nil {
		return "", err
	}
	if t.sources == nil {
		t.sources = make(map[string]*artifactPreviewSource)
	}
	t.sources[handle] = &artifactPreviewSource{
		lease: lease, page: page, pageEpoch: t.epochLocked(page),
	}
	return handle, nil
}

// beginFromSource derives a fresh, single-use save ticket only after proving
// that the preview source still belongs to the original account generation and
// the same page document. A failed derivation leaves no ticket.
func (t *artifactDownloadTracker) beginFromSource(
	account *workspaceAccount, page *mygo.Page, sourceHandle string,
) (string, error) {
	if page == nil || sourceHandle == "" {
		return "", errArtifactDownloadStale
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.clock()
	t.pruneLocked(now)
	source := t.sources[sourceHandle]
	if source == nil {
		return "", errArtifactDownloadStale
	}
	if source.page != page || source.pageEpoch != t.epochLocked(page) ||
		account == nil || !account.matches(source.lease) {
		delete(t.sources, sourceHandle)
		return "", errArtifactDownloadStale
	}
	if len(t.tickets) >= artifactDownloadMaximum ||
		t.trackedLocked() >= artifactDownloadTrackedMaximum {
		return "", errArtifactDownloadUnavailable
	}
	handle, err := t.addTicketLocked(source.lease, source.page, source.pageEpoch, now)
	if err != nil {
		return "", err
	}
	return handle, nil
}

func (t *artifactDownloadTracker) arm(
	account *workspaceAccount, page *mygo.Page, handle, blobURL string,
) error {
	if page == nil || handle == "" || blobURL == "" {
		return errArtifactDownloadInvalid
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.clock()
	t.pruneLocked(now)
	ticket := t.tickets[handle]
	if ticket == nil || ticket.page != page || ticket.pageEpoch != t.epochLocked(page) ||
		ticket.phase != artifactDownloadArmed {
		return errArtifactDownloadStale
	}
	if account == nil || !account.matches(ticket.lease) {
		t.discardTicketLocked(handle, ticket)
		return errAccountRequired
	}
	// MyGo emits one destination callback per started save. Once this ticket
	// is bound, a second URL would replace the writer whose callback is still
	// pending and leave the first arrival unattributable. Re-arming the same
	// URL is idempotent; a different URL is rejected without changing the
	// original binding or its invalidated-URL tombstone.
	if ticket.blobURL != "" {
		if ticket.blobURL == blobURL {
			return nil
		}
		return errArtifactDownloadInvalid
	}
	if _, invalidated := t.invalidated[blobURL]; invalidated {
		t.discardTicketLocked(handle, ticket)
		return errArtifactDownloadStale
	}
	for otherHandle, other := range t.tickets {
		if otherHandle != handle && other.blobURL == blobURL &&
			(other.phase == artifactDownloadArmed || other.phase == artifactDownloadStarted) {
			return errArtifactDownloadInvalid
		}
	}
	ticket.blobURL = blobURL
	return nil
}

func validArtifactDownloadPath(path string) bool {
	return path != "" && filepath.IsAbs(path) && filepath.Clean(path) == path
}

// invalidatePathLocked withdraws every pending or completed Finder offer for a
// path that is being written again. The save itself is MyGo's and is untouched.
func (t *artifactDownloadTracker) invalidatePathLocked(path string) {
	for handle, ticket := range t.tickets {
		if ticket.path == path {
			delete(t.tickets, handle)
		}
	}
}

// reserveLocked records one in-flight MyGo write for this exact page, URL, and
// path. It fails when the single total slot bound is full; callers must then
// cancel the download before MyGo writes anything.
func (t *artifactDownloadTracker) reserveLocked(page *mygo.Page, rawURL, path string) bool {
	if t.operations >= artifactDownloadOperationMaximum {
		return false
	}
	if t.writers == nil {
		t.writers = make(map[artifactDownloadWriter]int)
	}
	t.writers[artifactDownloadWriter{page: page, url: rawURL, path: path}]++
	t.operations++
	return true
}

// releaseLocked consumes one exact MyGo start/done pair. A callback for a
// page, URL, or path that was never admitted, or a duplicate callback, changes
// nothing and cannot free another writer's slot.
func (t *artifactDownloadTracker) releaseLocked(page *mygo.Page, rawURL, path string) bool {
	key := artifactDownloadWriter{page: page, url: rawURL, path: path}
	count := t.writers[key]
	if count == 0 {
		return false
	}
	if count <= 1 {
		delete(t.writers, key)
	} else {
		t.writers[key] = count - 1
	}
	t.operations--
	return true
}

// pathActiveLocked reports whether any admitted write, from any page, is still
// live at this exact path.
func (t *artifactDownloadTracker) pathActiveLocked(path string) bool {
	for key := range t.writers {
		if key.path == path {
			return true
		}
	}
	return false
}

// started binds one armed ticket to the exact URL and path MyGo reports. It
// never changes the event's path. A tracked save that would replace another
// in-progress save, or that lost its account lease, is cancelled before any
// bytes are written. Collisions with ordinary downloads only withdraw Finder
// offers and leave MyGo's unrelated download intact.
func (t *artifactDownloadTracker) started(
	account *workspaceAccount, page *mygo.Page, rawURL, path, suggested string,
) bool {
	if page == nil {
		return false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.clock()
	t.pruneLocked(now)
	if t.takeInvalidatedLocked(rawURL) {
		return true
	}
	epoch := t.epochLocked(page)
	var targetHandle string
	var target *artifactDownloadTicket
	for handle, ticket := range t.tickets {
		if ticket.page == page && ticket.pageEpoch == epoch &&
			ticket.phase == artifactDownloadArmed && ticket.blobURL == rawURL {
			targetHandle, target = handle, ticket
			break
		}
	}
	if !validArtifactDownloadPath(path) {
		// MyGo chose no valid destination, so no writer can be recorded. Cancel
		// before writing rather than leaving an untracked file.
		if target != nil {
			delete(t.tickets, targetHandle)
		}
		return true
	}
	stateActive := t.pathActiveLocked(path)
	if target != nil {
		if account == nil || !account.matches(target.lease) || stateActive {
			delete(t.tickets, targetHandle)
			return true
		}
		if !t.reserveLocked(page, rawURL, path) {
			delete(t.tickets, targetHandle)
			return true
		}
		// The admitted write replaces whatever was at this path, so any older
		// Finder offer for it is withdrawn. A rejected write withdraws nothing.
		t.invalidatePathLocked(path)
		target.phase = artifactDownloadStarted
		target.path = path
		target.name = artifactDownloadName(path, suggested)
		return false
	}
	// No ticket means an ordinary page download. It still reserves the exact
	// write so a concurrent Finder save can never be attributed to the wrong
	// operation. With no slot it is cancelled before MyGo writes anything.
	if !t.reserveLocked(page, rawURL, path) {
		return true
	}
	t.invalidatePathLocked(path)
	return false
}

// completed accepts only the same ticket's exact URL and path. A failed,
// vanished, symlinked, or unstarted save leaves no Finder offer.
func (t *artifactDownloadTracker) completed(
	account *workspaceAccount, page *mygo.Page, download *mygo.Download,
) (ArtifactDownloadSaved, bool) {
	if download == nil {
		return ArtifactDownloadSaved{}, false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.clock()
	t.pruneLocked(now)
	seen := t.releaseLocked(page, download.URL, download.Path)
	epoch := t.epochLocked(page)
	for handle, ticket := range t.tickets {
		if ticket.page != page || ticket.pageEpoch != epoch ||
			ticket.phase != artifactDownloadStarted ||
			ticket.blobURL != download.URL || ticket.path != download.Path {
			continue
		}
		if !seen || download.Err != nil || account == nil || !account.matches(ticket.lease) {
			delete(t.tickets, handle)
			return ArtifactDownloadSaved{}, false
		}
		info, err := os.Lstat(ticket.path)
		if err != nil || !info.Mode().IsRegular() {
			delete(t.tickets, handle)
			return ArtifactDownloadSaved{}, false
		}
		ticket.phase = artifactDownloadCompleted
		ticket.info = info
		ticket.name = filepath.Base(ticket.path)
		return ArtifactDownloadSaved{Handle: ticket.handle, Name: ticket.name}, true
	}
	return ArtifactDownloadSaved{}, false
}

// released consumes a terminal MyGo callback for a download whose page is no
// longer the main window's page. It releases only that page's exact writer slot
// and can never complete a Finder ticket. A callback for a pair this page never
// admitted releases nothing.
func (t *artifactDownloadTracker) released(page *mygo.Page, download *mygo.Download) {
	if page == nil || download == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.pruneLocked(t.clock())
	t.releaseLocked(page, download.URL, download.Path)
}

// untracked admits an ordinary download from a page that cannot bind a Finder
// ticket, such as a page that is no longer the main window's page. It reserves
// the exact write and withdraws Finder offers for the path it will replace, but
// it can never create an offer. An unrecordable path or a full slot bound fails
// closed before any bytes are written, and then withdraws nothing.
func (t *artifactDownloadTracker) untracked(page *mygo.Page, rawURL, path string) bool {
	if page == nil || !validArtifactDownloadPath(path) {
		return false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.pruneLocked(t.clock())
	if !t.reserveLocked(page, rawURL, path) {
		return false
	}
	t.invalidatePathLocked(path)
	return true
}

func (t *artifactDownloadTracker) takeCompleted(
	page *mygo.Page, handle string,
) (artifactDownloadTicket, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.clock()
	t.pruneLocked(now)
	ticket := t.tickets[handle]
	if ticket == nil || ticket.page != page || ticket.pageEpoch != t.epochLocked(page) ||
		ticket.phase != artifactDownloadCompleted {
		return artifactDownloadTicket{}, false
	}
	delete(t.tickets, handle)
	return *ticket, true
}

func (t *artifactDownloadTracker) cancel(page *mygo.Page, handle string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if source := t.sources[handle]; source != nil && source.page == page {
		delete(t.sources, handle)
		return
	}
	if ticket := t.tickets[handle]; ticket != nil && ticket.page == page {
		t.discardTicketLocked(handle, ticket)
	}
}

// navigated discards tickets from before a document reload, including a
// same-URL refresh that leaves the *mygo.Page identity unchanged.
func (t *artifactDownloadTracker) navigated(page *mygo.Page) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.epochs == nil {
		t.epochs = make(map[*mygo.Page]uint64)
	}
	t.epochs[page]++
	for handle, ticket := range t.tickets {
		if ticket.page == page {
			t.discardTicketLocked(handle, ticket)
		}
	}
	for handle, source := range t.sources {
		if source.page == page {
			delete(t.sources, handle)
		}
	}
}

func (t *artifactDownloadTracker) discardAll() {
	t.mu.Lock()
	defer t.mu.Unlock()
	for handle, ticket := range t.tickets {
		t.discardTicketLocked(handle, ticket)
	}
	t.tickets = nil
	t.sources = nil
	t.epochs = nil
	// Keep active writer slots and invalidated URLs: an invalidated save may
	// still be writing, and a newer account must not reuse that path for an
	// offer. Only the exact MyGo done callback releases a slot; sign-out and the
	// clock never do. Armed URLs stay invalidated until their exact destination
	// event, then disappear only after that event is cancelled.
}

func (t *artifactDownloadTracker) discardOtherPages(page *mygo.Page) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for handle, ticket := range t.tickets {
		if ticket.page != page {
			t.discardTicketLocked(handle, ticket)
		}
	}
	for handle, source := range t.sources {
		if source.page != page {
			delete(t.sources, handle)
		}
	}
}

func artifactDownloadName(path, suggested string) string {
	name := filepath.Base(filepath.Clean(path))
	if name == "" || name == "." || name == string(filepath.Separator) || !utf8.ValidString(name) {
		name = suggested
	}
	if !utf8.ValidString(name) || len(name) > 512 {
		name = "download"
	}
	return name
}

// validArtifactBlobURL accepts only a blob URL of the current page's own
// origin. The native host never resolves a page-supplied path or navigates to
// the URL; it uses the string only to match MyGo's exact download event.
func validArtifactBlobURL(raw, pageURL string) bool {
	if raw == "" || len(raw) > artifactDownloadURLMaxBytes || !utf8.ValidString(raw) {
		return false
	}
	outer, err := url.Parse(raw)
	if err != nil || outer.Scheme != "blob" || outer.User != nil ||
		outer.Fragment != "" || outer.RawQuery != "" {
		return false
	}
	inner, err := url.Parse(outer.Opaque)
	if err != nil || inner.User != nil || inner.Host == "" ||
		inner.Fragment != "" || inner.RawQuery != "" {
		return false
	}
	page, err := url.Parse(pageURL)
	if err != nil || page.User != nil || page.Host == "" {
		return false
	}
	return strings.EqualFold(inner.Scheme, page.Scheme) &&
		strings.EqualFold(inner.Host, page.Host) &&
		inner.Port() == page.Port()
}

func artifactDownloadRevealPath(ticket artifactDownloadTicket) (string, error) {
	if ticket.path == "" || !filepath.IsAbs(ticket.path) ||
		filepath.Clean(ticket.path) != ticket.path || ticket.info == nil {
		return "", errArtifactDownloadStale
	}
	info, err := os.Lstat(ticket.path)
	if err != nil || !info.Mode().IsRegular() || !os.SameFile(ticket.info, info) {
		return "", errArtifactDownloadMissing
	}
	return ticket.path, nil
}

// BeginArtifactDownload issues one opaque, single-use save ticket. With a
// preview source handle it derives the ticket from that preview's original
// account and page provenance; otherwise it starts a direct download ticket.
// The caller supplies no path or file name.
func (d *Desktop) BeginArtifactDownload(ctx context.Context, sourceHandle ...string) (string, error) {
	if runtime.GOOS != "darwin" {
		return "", errArtifactDownloadUnavailable
	}
	if len(sourceHandle) > 1 {
		return "", errArtifactDownloadInvalid
	}
	if err := d.checkCaller(ctx); err != nil {
		return "", err
	}
	win := d.mainWindow()
	if win == nil || win.Page() == nil {
		return "", errArtifactDownloadStale
	}
	lease, err := requireAccount(&d.account)
	if err != nil {
		return "", err
	}
	if len(sourceHandle) == 1 {
		if sourceHandle[0] == "" {
			return "", errArtifactDownloadInvalid
		}
		return d.downloads.beginFromSource(&d.account, win.Page(), sourceHandle[0])
	}
	return d.downloads.begin(lease, win.Page())
}

// BeginArtifactPreview retains one reusable provenance handle for the preview
// bytes loaded by this page. It creates no writer, path, or Finder offer.
func (d *Desktop) BeginArtifactPreview(ctx context.Context) (string, error) {
	if runtime.GOOS != "darwin" {
		return "", errArtifactDownloadUnavailable
	}
	if err := d.checkCaller(ctx); err != nil {
		return "", err
	}
	win := d.mainWindow()
	if win == nil || win.Page() == nil {
		return "", errArtifactDownloadStale
	}
	lease, err := requireAccount(&d.account)
	if err != nil {
		return "", err
	}
	return d.downloads.beginPreview(lease, win.Page())
}

// ArmArtifactDownload binds the ticket to the exact blob URL created for the
// authenticated bytes. It is still not a download target.
func (d *Desktop) ArmArtifactDownload(ctx context.Context, handle, rawURL string) error {
	if runtime.GOOS != "darwin" {
		return errArtifactDownloadUnavailable
	}
	if err := d.checkCaller(ctx); err != nil {
		return err
	}
	win := d.mainWindow()
	if win == nil || win.Page() == nil {
		return errArtifactDownloadStale
	}
	page := win.Page()
	if !validArtifactBlobURL(rawURL, page.URL()) {
		return errArtifactDownloadInvalid
	}
	return d.downloads.arm(&d.account, page, handle, rawURL)
}

// CancelArtifactDownload discards a ticket whose fetch or save did not reach
// the completion event.
func (d *Desktop) CancelArtifactDownload(ctx context.Context, handle string) error {
	if runtime.GOOS != "darwin" {
		return errArtifactDownloadUnavailable
	}
	if err := d.checkCaller(ctx); err != nil {
		return err
	}
	win := d.mainWindow()
	if win == nil || win.Page() == nil {
		return errArtifactDownloadStale
	}
	d.downloads.cancel(win.Page(), handle)
	return nil
}

// RevealArtifactDownload is the explicit user action. It moves the final
// checks and MyGo's synchronous Shell.ShowItemInFolder call to the main thread
// before taking any account or tracker lock. The ticket is consumed once; an
// expired account, replaced page, changed file, or symlink cannot activate
// Finder.
func (d *Desktop) RevealArtifactDownload(ctx context.Context, handle string) error {
	if runtime.GOOS != "darwin" {
		return errArtifactDownloadUnavailable
	}
	if err := d.checkCaller(ctx); err != nil {
		return err
	}
	win := d.mainWindow()
	if win == nil || win.Page() == nil {
		return errArtifactDownloadStale
	}
	page := win.Page()
	result := errArtifactDownloadStale
	mygo.RunOnMain(func() {
		result = d.revealArtifactOnMain(ctx, page, handle)
	})
	return result
}

// revealArtifactOnMain runs only on the main thread, where MyGo's ShowItemInFolder
// runs synchronously instead of waiting for a dispatch. It holds no tracker
// lock and waits for no other main-thread work while the account lease is held.
func (d *Desktop) revealArtifactOnMain(ctx context.Context, page *mygo.Page, handle string) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	win := d.mainWindow()
	if win == nil || win.Page() != page || mygo.CallerPage(ctx) != page {
		return errArtifactDownloadStale
	}
	ticket, ok := d.downloads.takeCompleted(page, handle)
	if !ok {
		return errArtifactDownloadStale
	}
	return d.account.withLease(ticket.lease, func() error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		current := d.mainWindow()
		if current == nil || current.Page() != page || mygo.CallerPage(ctx) != page {
			return errArtifactDownloadStale
		}
		path, err := artifactDownloadRevealPath(ticket)
		if err != nil {
			return err
		}
		showItemInFolder(path)
		return nil
	})
}

func (d *Desktop) artifactDownloadStarted(page *mygo.Page, event *mygo.DownloadEvent) {
	var current *mygo.Page
	if win := d.mainWindow(); win != nil {
		current = win.Page()
	}
	// The event's Path was chosen by MyGo, never by the page. Only the exact
	// URL of an armed ticket binds it to the explicit reveal offer. A tracked
	// save that would replace another in-progress save, or that lost its
	// account lease, is cancelled before writing; ordinary downloads proceed.
	if artifactDownloadDestination(&d.downloads, &d.account, page, current, event) {
		event.PreventDefault()
	}
}

// artifactDownloadDestination is the destination decision for one page
// callback. current is the main window's page at callback time. A URL whose
// ticket was invalidated is cancelled even when the callback's page has been
// replaced. Any other page may still admit its ordinary write, but it can
// never bind or complete a Finder ticket.
func artifactDownloadDestination(
	tracker *artifactDownloadTracker,
	account *workspaceAccount,
	page, current *mygo.Page,
	event *mygo.DownloadEvent,
) bool {
	if runtime.GOOS != "darwin" || event == nil || page == nil {
		return false
	}
	if tracker.takeInvalidated(event.URL) {
		return true
	}
	if current == nil || current != page {
		// A write from a page that is no longer the main window cannot bind a
		// Finder ticket, but its exact path must still stay closed to one.
		return !tracker.untracked(page, event.URL, event.Path)
	}
	return tracker.started(account, page, event.URL, event.Path, event.SuggestedName)
}

func (d *Desktop) artifactDownloadFinished(page *mygo.Page, download *mygo.Download) {
	if runtime.GOOS != "darwin" || download == nil || page == nil {
		return
	}
	win := d.mainWindow()
	if win == nil || win.Page() != page {
		// The write still ended; release that page's exact slot even though no
		// Finder offer can belong to this page anymore. A destroyed window may
		// never report this callback, so the slot stays occupied instead.
		d.downloads.released(page, download)
		return
	}
	saved, ok := d.downloads.completed(&d.account, page, download)
	if !ok {
		return
	}
	if err := desktopArtifactSaved.Emit(win, saved); err != nil {
		d.downloads.cancel(page, saved.Handle)
	}
}

func (d *Desktop) artifactDownloadNavigated(page *mygo.Page) {
	if page != nil {
		d.downloads.navigated(page)
	}
}
