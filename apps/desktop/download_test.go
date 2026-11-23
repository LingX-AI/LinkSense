package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

const (
	cloudFileContentForTest = "Downloaded the expected LinkSense desktop artifact.\n"
	downloadAccountA        = "10000000-0000-4000-8000-0000000000a1"
	downloadAccountB        = "10000000-0000-4000-8000-0000000000b1"
)

func downloadTestAccount(t *testing.T, id string) *workspaceAccount {
	t.Helper()
	account := &workspaceAccount{}
	account.set(id, time.Now().Add(time.Hour))
	return account
}

func downloadTestLease(t *testing.T, account *workspaceAccount) accountLease {
	t.Helper()
	lease, ok := account.lease()
	if !ok {
		t.Fatal("the fixture account has no lease")
	}
	return lease
}

func downloadTestFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestArtifactDownloadRequiresExactSaveAndIsSingleUse(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	handle, err := tracker.begin(downloadTestLease(t, account), page)
	if err != nil || handle == "" {
		t.Fatalf("begin = %q, %v", handle, err)
	}
	blob := "blob:mygo://localhost/11111111-1111-4111-8111-111111111111"
	if err := tracker.arm(account, page, handle, blob); err != nil {
		t.Fatal(err)
	}
	path := downloadTestFile(t, t.TempDir(), "report.txt", "authenticated bytes")
	if tracker.started(account, page, blob, path, "report.txt") {
		t.Fatal("the exact blob URL did not bind the MyGo save")
	}
	saved, ok := tracker.completed(account, page, &mygo.Download{URL: blob, Path: path})
	if !ok || saved.Handle != handle || saved.Name != "report.txt" {
		t.Fatalf("completed = %+v, %t", saved, ok)
	}
	ticket, ok := tracker.takeCompleted(page, handle)
	if !ok || ticket.path != path || ticket.name != "report.txt" {
		t.Fatalf("takeCompleted = %+v, %t", ticket, ok)
	}
	if _, ok := tracker.takeCompleted(page, handle); ok {
		t.Fatal("a completed reveal handle was reusable")
	}
	if _, ok := tracker.takeCompleted(page, "unknown"); ok {
		t.Fatal("an unknown reveal handle was accepted")
	}
}

func TestArtifactDownloadIgnoresWrongURLAndWrongPath(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	handle, err := tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	blob := "blob:mygo://localhost/22222222-2222-4222-8222-222222222222"
	if err := tracker.arm(account, page, handle, blob); err != nil {
		t.Fatal(err)
	}
	path := downloadTestFile(t, t.TempDir(), "exact.txt", "bytes")
	otherPath := downloadTestFile(t, t.TempDir(), "other.txt", "other bytes")
	if tracker.started(account, page, "blob:mygo://localhost/other", otherPath, "other.txt") {
		t.Fatal("a different blob URL claimed the ticket")
	}
	if tracker.started(account, page, blob, path, "exact.txt") {
		t.Fatal("the exact blob URL did not start the ticket")
	}
	if _, ok := tracker.completed(account, page, &mygo.Download{
		URL: blob, Path: path + ".other",
	}); ok {
		t.Fatal("a different save path completed the ticket")
	}
	if _, ok := tracker.completed(account, page, &mygo.Download{
		URL: "blob:mygo://localhost/other", Path: path,
	}); ok {
		t.Fatal("a different download URL completed the ticket")
	}
	if _, ok := tracker.completed(account, page, &mygo.Download{URL: blob, Path: path}); !ok {
		t.Fatal("the exact download did not complete the ticket")
	}
}

func TestArtifactDownloadDuplicateNamesStayDistinct(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	dir := t.TempDir()
	firstPath := downloadTestFile(t, dir, "report.txt", "first")
	secondPath := downloadTestFile(t, dir, "report (2).txt", "second")
	for i, path := range []string{firstPath, secondPath} {
		handle, err := tracker.begin(downloadTestLease(t, account), page)
		if err != nil {
			t.Fatal(err)
		}
		blob := "blob:mygo://localhost/concurrent-" + string(rune('1'+i))
		if err := tracker.arm(account, page, handle, blob); err != nil {
			t.Fatal(err)
		}
		if tracker.started(account, page, blob, path, "report.txt") {
			t.Fatalf("save %d was cancelled", i)
		}
		saved, ok := tracker.completed(account, page, &mygo.Download{URL: blob, Path: path})
		if !ok || saved.Name != filepath.Base(path) {
			t.Fatalf("save %d completed = %+v, %t", i, saved, ok)
		}
		ticket, ok := tracker.takeCompleted(page, saved.Handle)
		if !ok || ticket.path != path {
			t.Fatalf("save %d revealed %+v, want %q", i, ticket, path)
		}
	}
}

func TestArtifactDownloadFailureAndMissingFileOfferNothing(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	handle, err := tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	blob := "blob:mygo://localhost/33333333-3333-4333-8333-333333333333"
	if err := tracker.arm(account, page, handle, blob); err != nil {
		t.Fatal(err)
	}
	path := downloadTestFile(t, t.TempDir(), "failed.txt", "partial")
	if tracker.started(account, page, blob, path, "failed.txt") {
		t.Fatal("the failed save was cancelled")
	}
	if _, ok := tracker.completed(account, page, &mygo.Download{
		URL: blob, Path: path, Err: errors.New("interrupted"),
	}); ok {
		t.Fatal("a failed save offered Finder")
	}
	if _, ok := tracker.takeCompleted(page, handle); ok {
		t.Fatal("a failed save left a completed ticket")
	}

	handle, err = tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(t.TempDir(), "missing.txt")
	if err := tracker.arm(account, page, handle, blob); err != nil {
		t.Fatal(err)
	}
	if tracker.started(account, page, blob, missing, "missing.txt") {
		t.Fatal("the missing save was cancelled")
	}
	if _, ok := tracker.completed(account, page, &mygo.Download{URL: blob, Path: missing}); ok {
		t.Fatal("a missing file offered Finder")
	}
	if _, ok := tracker.takeCompleted(page, handle); ok {
		t.Fatal("a missing file left a completed ticket")
	}
}

func TestArtifactDownloadDiscardsRefreshAndAccountChanges(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	blob := "blob:mygo://localhost/44444444-4444-4444-8444-444444444444"

	// An ordinary same-URL document reload keeps the same *mygo.Page but must
	// discard the handle from before the reload.
	handle, err := tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	if err := tracker.arm(account, page, handle, blob); err != nil {
		t.Fatal(err)
	}
	tracker.navigated(page)
	if err := tracker.arm(account, page, handle, blob); !errors.Is(err, errArtifactDownloadStale) {
		t.Fatalf("the pre-reload handle armed again: %v", err)
	}

	// Moving or closing a window does not change the page; another page is a
	// different document and cannot claim the ticket. A new save uses a new
	// blob URL; the pre-reload URL stays invalidated.
	reloadedBlob := "blob:mygo://localhost/44444444-4444-4444-8444-444444444445"
	handle, err = tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	if err := tracker.arm(account, page, handle, reloadedBlob); err != nil {
		t.Fatal(err)
	}
	otherPage := &mygo.Page{}
	path := downloadTestFile(t, t.TempDir(), "same-session.txt", "bytes")
	otherPath := downloadTestFile(t, t.TempDir(), "other-page.txt", "other bytes")
	if tracker.started(account, otherPage, reloadedBlob, otherPath, "other-page.txt") {
		t.Fatal("a new page claimed a ticket from the previous page")
	}
	if tracker.started(account, page, reloadedBlob, path, "same-session.txt") {
		t.Fatal("the existing page's save was cancelled")
	}

	// A token refresh for the same account generation keeps the ticket.
	account.set(downloadAccountA, time.Now().Add(2*time.Hour))
	if _, ok := tracker.completed(account, page, &mygo.Download{URL: reloadedBlob, Path: path}); !ok {
		t.Fatal("an ordinary same-session refresh discarded the ticket")
	}

	handle, err = tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	account.set(downloadAccountB, time.Now().Add(time.Hour))
	if err := tracker.arm(account, page, handle, blob); !errors.Is(err, errAccountRequired) {
		t.Fatalf("an A to B switch armed the old ticket: %v", err)
	}

	accountA := downloadTestAccount(t, downloadAccountA)
	handle, err = tracker.begin(downloadTestLease(t, accountA), page)
	if err != nil {
		t.Fatal(err)
	}
	accountA.clear()
	accountA.set(downloadAccountA, time.Now().Add(time.Hour))
	if err := tracker.arm(accountA, page, handle, blob); !errors.Is(err, errAccountRequired) {
		t.Fatalf("an A to A sign-in armed the old generation: %v", err)
	}
}

func TestArtifactDownloadDiscardsOnlyAnotherWindowPage(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	oldPage := &mygo.Page{}
	newPage := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	handle, err := tracker.begin(downloadTestLease(t, account), oldPage)
	if err != nil {
		t.Fatal(err)
	}
	if err := tracker.arm(account, oldPage, handle, "blob:mygo://localhost/old"); err != nil {
		t.Fatal(err)
	}
	tracker.discardOtherPages(oldPage)
	if err := tracker.arm(account, oldPage, handle, "blob:mygo://localhost/old"); err != nil {
		t.Fatalf("the same window's ticket was discarded: %v", err)
	}
	tracker.discardOtherPages(newPage)
	if err := tracker.arm(account, oldPage, handle, "blob:mygo://localhost/old"); !errors.Is(err, errArtifactDownloadStale) {
		t.Fatalf("a replaced window kept the old ticket: %v", err)
	}
}

func TestArtifactDownloadTicketsAreBoundedAndExpire(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	now := time.Now()
	tracker := &artifactDownloadTracker{now: func() time.Time { return now }}
	handles := make([]string, 0, artifactDownloadMaximum)
	for range artifactDownloadMaximum {
		handle, err := tracker.begin(downloadTestLease(t, account), page)
		if err != nil {
			t.Fatal(err)
		}
		handles = append(handles, handle)
	}
	if _, err := tracker.begin(downloadTestLease(t, account), page); !errors.Is(err, errArtifactDownloadUnavailable) {
		t.Fatalf("the tracker exceeded its bound: %v", err)
	}
	now = now.Add(artifactDownloadLifetime)
	handle, err := tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatalf("expired state was not discarded: %v", err)
	}
	blob := "blob:mygo://localhost/55555555-5555-4555-8555-555555555555"
	if err := tracker.arm(account, page, handles[0], blob); !errors.Is(err, errArtifactDownloadStale) {
		t.Fatalf("an expired handle was accepted: %v", err)
	}
	if err := tracker.arm(account, page, handle, blob); err != nil {
		t.Fatal(err)
	}
}

func TestArtifactDownloadCancelReleasesCompletedSlot(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	dir := t.TempDir()
	handles := make([]string, 0, artifactDownloadMaximum)
	for index := range artifactDownloadMaximum {
		handle, err := tracker.begin(downloadTestLease(t, account), page)
		if err != nil {
			t.Fatalf("begin %d: %v", index, err)
		}
		blob := "blob:mygo://localhost/completed-slot-" + strconv.Itoa(index)
		if err := tracker.arm(account, page, handle, blob); err != nil {
			t.Fatalf("arm %d: %v", index, err)
		}
		path := downloadTestFile(t, dir, "completed-slot-"+strconv.Itoa(index)+".txt", cloudFileContentForTest)
		if tracker.started(account, page, blob, path, filepath.Base(path)) {
			t.Fatalf("save %d was cancelled", index)
		}
		if _, ok := tracker.completed(account, page, &mygo.Download{URL: blob, Path: path}); !ok {
			t.Fatalf("save %d did not complete", index)
		}
		handles = append(handles, handle)
	}
	if _, err := tracker.begin(downloadTestLease(t, account), page); !errors.Is(err, errArtifactDownloadUnavailable) {
		t.Fatalf("completed saves did not fill the bound: %v", err)
	}

	tracker.cancel(page, handles[0])
	if _, err := os.Stat(filepath.Join(dir, "completed-slot-0.txt")); err != nil {
		t.Fatalf("cancel removed the saved file: %v", err)
	}
	if _, ok := tracker.takeCompleted(page, handles[0]); ok {
		t.Fatal("a cancelled completed ticket remained revealable")
	}
	if _, err := tracker.begin(downloadTestLease(t, account), page); err != nil {
		t.Fatalf("cancel did not release a completed save slot: %v", err)
	}
}

func TestArtifactDownloadBlobURLMustMatchThePageOrigin(t *testing.T) {
	for _, tc := range []struct {
		name    string
		raw     string
		pageURL string
		ok      bool
	}{
		{"mac custom scheme", "blob:mygo://localhost/abc", "mygo://localhost/conversations/1", true},
		{"windows origin", "blob:http://mygo.localhost/abc", "http://mygo.localhost/", true},
		{"development origin", "blob:http://localhost:18173/abc", "http://localhost:18173/", true},
		{"other host", "blob:mygo://other/abc", "mygo://localhost/", false},
		{"other scheme", "blob:https://localhost/abc", "mygo://localhost/", false},
		{"other port", "blob:http://localhost:9999/abc", "http://localhost:18173/", false},
		{"not a blob", "https://example.test/abc", "mygo://localhost/", false},
		{"empty", "", "mygo://localhost/", false},
		{"userinfo", "blob:mygo://user@localhost/abc", "mygo://localhost/", false},
		{"fragment", "blob:mygo://localhost/abc#fragment", "mygo://localhost/", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := validArtifactBlobURL(tc.raw, tc.pageURL); got != tc.ok {
				t.Fatalf("validArtifactBlobURL(%q, %q) = %t, want %t", tc.raw, tc.pageURL, got, tc.ok)
			}
		})
	}
}

func TestArtifactDownloadRevealRejectsMissingAndReplacedFiles(t *testing.T) {
	path := downloadTestFile(t, t.TempDir(), "reveal.txt", "bytes")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	ticket := artifactDownloadTicket{path: path, info: info}
	if got, err := artifactDownloadRevealPath(ticket); err != nil || got != path {
		t.Fatalf("reveal path = %q, %v", got, err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, err := artifactDownloadRevealPath(ticket); !errors.Is(err, errArtifactDownloadMissing) {
		t.Fatalf("missing file reveal = %v", err)
	}
	if err := os.WriteFile(path, []byte("replacement"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := artifactDownloadRevealPath(ticket); !errors.Is(err, errArtifactDownloadMissing) {
		t.Fatalf("replaced file reveal = %v", err)
	}
	if got, err := artifactDownloadRevealPath(artifactDownloadTicket{path: "relative.txt"}); !errors.Is(err, errArtifactDownloadStale) || got != "" {
		t.Fatalf("relative path reveal = %q, %v", got, err)
	}
	target := downloadTestFile(t, t.TempDir(), "target.txt", "bytes")
	targetInfo, err := os.Lstat(target)
	if err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(t.TempDir(), "link.txt")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if _, err := artifactDownloadRevealPath(artifactDownloadTicket{path: link, info: targetInfo}); !errors.Is(err, errArtifactDownloadMissing) {
		t.Fatalf("symlink reveal = %v", err)
	}
}

func TestArtifactDownloadCollisionWithTrackedSaveCancelsOnlyTheNewSave(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	dir := t.TempDir()
	path := downloadTestFile(t, dir, "collision.txt", "first")
	firstBlob := "blob:mygo://localhost/collision-first"
	secondBlob := "blob:mygo://localhost/collision-second"
	first, err := tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	second, err := tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	if err := tracker.arm(account, page, first, firstBlob); err != nil {
		t.Fatal(err)
	}
	if err := tracker.arm(account, page, second, secondBlob); err != nil {
		t.Fatal(err)
	}
	if tracker.started(account, page, firstBlob, path, "collision.txt") {
		t.Fatal("the first save was cancelled")
	}
	if !tracker.started(account, page, secondBlob, path, "collision.txt") {
		t.Fatal("a tracked save was allowed to replace an in-progress save")
	}
	if _, ok := tracker.takeCompleted(page, second); ok {
		t.Fatal("the cancelled save left a Finder ticket")
	}
	saved, ok := tracker.completed(account, page, &mygo.Download{URL: firstBlob, Path: path})
	if !ok || saved.Handle != first {
		t.Fatalf("the attributable first save = %+v, %t", saved, ok)
	}
}

func TestArtifactDownloadCollisionWithOrdinarySaveWithdrawsTheOffer(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	path := downloadTestFile(t, t.TempDir(), "ordinary.txt", "ordinary")
	blob := "blob:mygo://localhost/ordinary-collision"
	handle, err := tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	if err := tracker.arm(account, page, handle, blob); err != nil {
		t.Fatal(err)
	}
	// An ordinary download without a ticket starts at the same native path
	// before the tracked save. MyGo will write both to that path.
	if tracker.started(account, page, "blob:mygo://localhost/untracked", path, "ordinary.txt") {
		t.Fatal("an ordinary download was cancelled by the Finder slice")
	}
	if !tracker.started(account, page, blob, path, "ordinary.txt") {
		t.Fatal("the tracked save was not cancelled before sharing the path")
	}
	if _, ok := tracker.completed(account, page, &mygo.Download{URL: "blob:mygo://localhost/untracked", Path: path}); ok {
		t.Fatal("the ordinary save offered Finder")
	}
	if _, ok := tracker.completed(account, page, &mygo.Download{URL: blob, Path: path}); ok {
		t.Fatal("the collided tracked save offered Finder")
	}
}

func TestArtifactDownloadOrdinaryCollisionWithdrawsAnExistingTrackedOffer(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	path := downloadTestFile(t, t.TempDir(), "tracked-first.txt", "tracked")
	blob := "blob:mygo://localhost/tracked-first"
	handle, err := tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	if err := tracker.arm(account, page, handle, blob); err != nil {
		t.Fatal(err)
	}
	if tracker.started(account, page, blob, path, "tracked-first.txt") {
		t.Fatal("the tracked save was cancelled without a collision")
	}
	// The ordinary save proceeds, so the older tracked file may be replaced;
	// its pending Finder offer must be withdrawn.
	if tracker.started(account, page, "blob:mygo://localhost/ordinary-second", path, "tracked-first.txt") {
		t.Fatal("an ordinary download was cancelled by the Finder slice")
	}
	if _, ok := tracker.completed(account, page, &mygo.Download{URL: blob, Path: path}); ok {
		t.Fatal("the replaced tracked save offered Finder")
	}
	if _, ok := tracker.takeCompleted(page, handle); ok {
		t.Fatal("the replaced tracked handle survived the collision")
	}
}

func TestArtifactDownloadPathStaysClosedAcrossAccountInvalidation(t *testing.T) {
	accountA := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	path := downloadTestFile(t, t.TempDir(), "cross-account.txt", "old account")
	oldBlob := "blob:mygo://localhost/cross-account-old"
	newBlob := "blob:mygo://localhost/cross-account-new"
	oldHandle, err := tracker.begin(downloadTestLease(t, accountA), page)
	if err != nil {
		t.Fatal(err)
	}
	if err := tracker.arm(accountA, page, oldHandle, oldBlob); err != nil {
		t.Fatal(err)
	}
	if tracker.started(accountA, page, oldBlob, path, "cross-account.txt") {
		t.Fatal("the first account's save was cancelled")
	}
	tracker.discardAll()
	accountB := downloadTestAccount(t, downloadAccountB)
	newHandle, err := tracker.begin(downloadTestLease(t, accountB), page)
	if err != nil {
		t.Fatal(err)
	}
	if err := tracker.arm(accountB, page, newHandle, newBlob); err != nil {
		t.Fatal(err)
	}
	if !tracker.started(accountB, page, newBlob, path, "cross-account.txt") {
		t.Fatal("a new account was allowed to replace the old in-progress save")
	}
	tracker.completed(accountA, page, &mygo.Download{URL: oldBlob, Path: path})
	// Once the old write ends, a fresh ticket may use the path again.
	retryHandle, err := tracker.begin(downloadTestLease(t, accountB), page)
	if err != nil {
		t.Fatal(err)
	}
	if err := tracker.arm(accountB, page, retryHandle, newBlob); err != nil {
		t.Fatal(err)
	}
	if tracker.started(accountB, page, newBlob, path, "cross-account.txt") {
		t.Fatal("a retry was cancelled after the old save ended")
	}
}

func TestArtifactDownloadMethodsRejectUntrustedCallers(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("the Finder slice is macOS-only")
	}
	desktop := &Desktop{}
	if _, err := desktop.BeginArtifactDownload(context.Background()); err == nil {
		t.Fatal("an unbound caller began a download ticket")
	}
	if _, err := desktop.BeginArtifactPreview(context.Background()); err == nil {
		t.Fatal("an unbound caller began a preview source")
	}
	if err := desktop.ArmArtifactDownload(context.Background(), strings.Repeat("a", 43), "blob:mygo://localhost/x"); err == nil {
		t.Fatal("an unbound caller armed a download ticket")
	}
	if err := desktop.CancelArtifactDownload(context.Background(), strings.Repeat("a", 43)); err == nil {
		t.Fatal("an unbound caller canceled a download ticket")
	}
	if err := desktop.RevealArtifactDownload(context.Background(), strings.Repeat("a", 43)); err == nil {
		t.Fatal("an unbound caller revealed a download")
	}
}

func downloadTestDestinationCancelled(
	account *workspaceAccount,
	tracker *artifactDownloadTracker,
	page, current *mygo.Page,
	blob, path string,
) bool {
	event := &mygo.DownloadEvent{
		URL:           blob,
		Path:          path,
		SuggestedName: filepath.Base(path),
	}
	if artifactDownloadDestination(tracker, account, page, current, event) {
		event.PreventDefault()
	}
	return event.DefaultPrevented()
}

func TestArtifactDownloadDestinationFailsClosedAfterAccountInvalidation(t *testing.T) {
	const blob = "blob:mygo://localhost/invalidated-account"
	for _, tc := range []struct {
		name       string
		invalidate func(t *testing.T, account *workspaceAccount)
		cancelled  bool
	}{
		{
			name: "explicit sign-out",
			invalidate: func(t *testing.T, account *workspaceAccount) {
				account.clear()
			},
			cancelled: true,
		},
		{
			name: "same-user replacement",
			invalidate: func(t *testing.T, account *workspaceAccount) {
				account.clear()
				account.set(downloadAccountA, time.Now().Add(time.Hour))
			},
			cancelled: true,
		},
		{
			name: "same-login token refresh",
			invalidate: func(t *testing.T, account *workspaceAccount) {
				account.set(downloadAccountA, time.Now().Add(2*time.Hour))
			},
			cancelled: false,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			account := downloadTestAccount(t, downloadAccountA)
			tracker := &artifactDownloadTracker{}
			account.setOnClear(func() { tracker.discardAll() })
			page := &mygo.Page{}
			handle, err := tracker.begin(downloadTestLease(t, account), page)
			if err != nil {
				t.Fatal(err)
			}
			if err := tracker.arm(account, page, handle, blob); err != nil {
				t.Fatal(err)
			}
			path := downloadTestFile(t, t.TempDir(), "destination.txt", "fixture")
			tc.invalidate(t, account)
			cancelled := downloadTestDestinationCancelled(account, tracker, page, page, blob, path)
			if cancelled != tc.cancelled {
				t.Fatalf("destination cancelled = %t, want %t", cancelled, tc.cancelled)
			}
			if tc.cancelled {
				if _, ok := tracker.completed(account, page, &mygo.Download{URL: blob, Path: path}); ok {
					t.Fatal("an invalidated account offered Finder")
				}
				if _, ok := tracker.takeCompleted(page, handle); ok {
					t.Fatal("an invalidated account left a reveal handle")
				}
			} else if _, ok := tracker.completed(account, page, &mygo.Download{URL: blob, Path: path}); !ok {
				t.Fatal("a same-login refresh no longer admitted its save")
			}
		})
	}
}

func TestArtifactDownloadDestinationFailsClosedAfterOtherInvalidations(t *testing.T) {
	const blob = "blob:mygo://localhost/invalidated-path"
	for _, tc := range []struct {
		name       string
		invalidate func(t *testing.T, tracker *artifactDownloadTracker, page *mygo.Page, handle string)
		current    func(page *mygo.Page) *mygo.Page
	}{
		{
			name: "cancellation",
			invalidate: func(t *testing.T, tracker *artifactDownloadTracker, page *mygo.Page, handle string) {
				tracker.cancel(page, handle)
			},
			current: func(page *mygo.Page) *mygo.Page { return page },
		},
		{
			name: "active page navigation",
			invalidate: func(t *testing.T, tracker *artifactDownloadTracker, page *mygo.Page, handle string) {
				tracker.navigated(page)
			},
			current: func(page *mygo.Page) *mygo.Page { return page },
		},
		{
			name: "page replacement",
			invalidate: func(t *testing.T, tracker *artifactDownloadTracker, page *mygo.Page, handle string) {
				tracker.discardOtherPages(&mygo.Page{})
			},
			current: func(page *mygo.Page) *mygo.Page { return &mygo.Page{} },
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			account := downloadTestAccount(t, downloadAccountA)
			tracker := &artifactDownloadTracker{}
			page := &mygo.Page{}
			handle, err := tracker.begin(downloadTestLease(t, account), page)
			if err != nil {
				t.Fatal(err)
			}
			if err := tracker.arm(account, page, handle, blob); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "never-written.txt")
			tc.invalidate(t, tracker, page, handle)
			if !downloadTestDestinationCancelled(account, tracker, page, tc.current(page), blob, path) {
				t.Fatal("the invalidated destination was allowed to write")
			}
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Fatalf("the invalidated destination created a file: %v", err)
			}
			if _, ok := tracker.completed(account, page, &mygo.Download{URL: blob, Path: path}); ok {
				t.Fatal("an invalidated destination offered Finder")
			}
		})
	}
}

func TestArtifactDownloadDestinationFailsClosedAfterTicketExpiry(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	now := time.Now()
	tracker := &artifactDownloadTracker{now: func() time.Time { return now }}
	blob := "blob:mygo://localhost/expired-destination"
	handle, err := tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	if err := tracker.arm(account, page, handle, blob); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "expired.txt")
	now = now.Add(artifactDownloadLifetime)
	if !downloadTestDestinationCancelled(account, tracker, page, page, blob, path) {
		t.Fatal("an expired ticket was treated as an ordinary download")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("the expired destination created a file: %v", err)
	}
	if _, ok := tracker.completed(account, page, &mygo.Download{URL: blob, Path: path}); ok {
		t.Fatal("an expired destination offered Finder")
	}
}

func TestArtifactDownloadInvalidatedURLStaysClosedPastExpiryAndPreservesOthers(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	account.setOnClear(func() {})
	page := &mygo.Page{}
	now := time.Now()
	tracker := &artifactDownloadTracker{now: func() time.Time { return now }}
	blob := "blob:mygo://localhost/closed-forever"
	handle, err := tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	if err := tracker.arm(account, page, handle, blob); err != nil {
		t.Fatal(err)
	}
	tracker.discardAll()
	now = now.Add(100 * artifactDownloadLifetime)
	if !downloadTestDestinationCancelled(account, tracker, page, page, blob, filepath.Join(t.TempDir(), "stale.txt")) {
		t.Fatal("an invalidated URL became ordinary after the ticket lifetime")
	}

	// An unrelated ordinary blob save on the same page is still admitted.
	ordinaryPath := downloadTestFile(t, t.TempDir(), "ordinary-after-invalidation.txt", "ordinary")
	ordinary := "blob:mygo://localhost/ordinary-after-invalidation"
	if downloadTestDestinationCancelled(account, tracker, page, page, ordinary, ordinaryPath) {
		t.Fatal("an unrelated ordinary download was cancelled")
	}
	if _, ok := tracker.completed(account, page, &mygo.Download{URL: ordinary, Path: ordinaryPath}); ok {
		t.Fatal("an ordinary download offered Finder")
	}

	// A fresh ticket for the new account generation is still admitted.
	freshAccount := downloadTestAccount(t, downloadAccountB)
	freshBlob := "blob:mygo://localhost/fresh-after-invalidation"
	freshPath := downloadTestFile(t, t.TempDir(), "fresh-after-invalidation.txt", "fresh")
	freshHandle, err := tracker.begin(downloadTestLease(t, freshAccount), page)
	if err != nil {
		t.Fatal(err)
	}
	if err := tracker.arm(freshAccount, page, freshHandle, freshBlob); err != nil {
		t.Fatal(err)
	}
	if downloadTestDestinationCancelled(freshAccount, tracker, page, page, freshBlob, freshPath) {
		t.Fatal("a fresh ticket was cancelled by another account's invalidation")
	}
	if _, ok := tracker.completed(freshAccount, page, &mygo.Download{URL: freshBlob, Path: freshPath}); !ok {
		t.Fatal("a fresh ticket did not complete")
	}
}

func TestArtifactDownloadInvalidatedURLsAreBoundedWithoutEviction(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	account.setOnClear(func() {})
	page := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	firstBlob := ""
	for i := 0; i < artifactDownloadTrackedMaximum; i++ {
		handle, err := tracker.begin(downloadTestLease(t, account), page)
		if err != nil {
			t.Fatalf("begin %d: %v", i, err)
		}
		blob := "blob:mygo://localhost/bounded-" + strconv.Itoa(i)
		if i == 0 {
			firstBlob = blob
		}
		if err := tracker.arm(account, page, handle, blob); err != nil {
			t.Fatalf("arm %d: %v", i, err)
		}
		tracker.discardAll()
	}
	if _, err := tracker.begin(downloadTestLease(t, account), page); !errors.Is(err, errArtifactDownloadUnavailable) {
		t.Fatalf("the invalidated bound did not fail closed: %v", err)
	}
	if !downloadTestDestinationCancelled(account, tracker, page, page, firstBlob, filepath.Join(t.TempDir(), "bounded.txt")) {
		t.Fatal("an invalidated URL was evicted")
	}
}

func TestArtifactDownloadRearmKeepsFirstPendingURL(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	handle, err := tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	firstBlob := "blob:mygo://localhost/rearm-first"
	secondBlob := "blob:mygo://localhost/rearm-second"
	if err := tracker.arm(account, page, handle, firstBlob); err != nil {
		t.Fatal(err)
	}
	// A second arm must not replace the pending URL or its single writer.
	if err := tracker.arm(account, page, handle, secondBlob); !errors.Is(err, errArtifactDownloadInvalid) {
		t.Fatalf("re-arming a bound ticket = %v, want DESKTOP_DOWNLOAD_INVALID", err)
	}
	secondPath := downloadTestFile(t, t.TempDir(), "second.txt", "not the original")
	if tracker.started(account, page, secondBlob, secondPath, "second.txt") {
		t.Fatal("the rejected URL became a cancelled save")
	}
	if _, ok := tracker.completed(account, page, &mygo.Download{URL: secondBlob, Path: secondPath}); ok {
		t.Fatal("the rejected URL offered Finder")
	}
	// MyGo's delayed destination for the first URL must still bind the ticket.
	firstPath := downloadTestFile(t, t.TempDir(), "first.txt", "original bytes")
	if tracker.started(account, page, firstBlob, firstPath, "first.txt") {
		t.Fatal("the original pending URL was cancelled by the rejected re-arm")
	}
	saved, ok := tracker.completed(account, page, &mygo.Download{URL: firstBlob, Path: firstPath})
	if !ok || saved.Handle != handle {
		t.Fatalf("the original pending URL completed = %+v, %t", saved, ok)
	}
	if _, ok := tracker.takeCompleted(page, saved.Handle); !ok {
		t.Fatal("the original save lost its explicit reveal")
	}
	if _, ok := tracker.takeCompleted(page, saved.Handle); ok {
		t.Fatal("the reveal handle was reusable")
	}
}

func TestArtifactDownloadRearmCannotReviveInvalidatedFirstURL(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	firstBlob := "blob:mygo://localhost/invalidated-first"
	secondBlob := "blob:mygo://localhost/invalidated-second"
	handle, err := tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	if err := tracker.arm(account, page, handle, firstBlob); err != nil {
		t.Fatal(err)
	}
	tracker.cancel(page, handle)
	if err := tracker.arm(account, page, handle, secondBlob); !errors.Is(err, errArtifactDownloadStale) {
		t.Fatalf("an invalidated handle re-armed = %v, want DESKTOP_DOWNLOAD_STALE", err)
	}
	path := filepath.Join(t.TempDir(), "invalidated-first.txt")
	if !downloadTestDestinationCancelled(account, tracker, page, page, firstBlob, path) {
		t.Fatal("the invalidated first URL became an ordinary write")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("the invalidated first URL wrote a file: %v", err)
	}
	if _, ok := tracker.completed(account, page, &mygo.Download{URL: secondBlob, Path: path}); ok {
		t.Fatal("the rejected second URL completed a save")
	}
}

func TestArtifactPreviewSourceDerivesDistinctSingleUseSaves(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	source, err := tracker.beginPreview(downloadTestLease(t, account), page)
	if err != nil || source == "" {
		t.Fatalf("beginPreview = %q, %v", source, err)
	}
	if _, ok := tracker.takeCompleted(page, source); ok {
		t.Fatal("a preview source handle offered Finder")
	}

	dir := t.TempDir()
	for index, name := range []string{"preview.txt", "preview (2).txt"} {
		handle, err := tracker.beginFromSource(account, page, source)
		if err != nil || handle == "" {
			t.Fatalf("save %d begin = %q, %v", index, handle, err)
		}
		if handle == source {
			t.Fatal("a save reused the preview source handle")
		}
		blob := "blob:mygo://localhost/preview-save-" + strconv.Itoa(index)
		if err := tracker.arm(account, page, handle, blob); err != nil {
			t.Fatalf("save %d arm: %v", index, err)
		}
		path := downloadTestFile(t, dir, name, cloudFileContentForTest)
		if tracker.started(account, page, blob, path, name) {
			t.Fatalf("save %d was cancelled", index)
		}
		saved, ok := tracker.completed(account, page, &mygo.Download{URL: blob, Path: path})
		if !ok || saved.Handle != handle || saved.Name != name {
			t.Fatalf("save %d completed = %+v, %t", index, saved, ok)
		}
		ticket, ok := tracker.takeCompleted(page, saved.Handle)
		if !ok || ticket.path != path {
			t.Fatalf("save %d reveal = %+v, %t", index, ticket, ok)
		}
		if _, ok := tracker.takeCompleted(page, saved.Handle); ok {
			t.Fatalf("save %d reveal handle was reusable", index)
		}
	}

	// The source survives both saves and a normal same-login token refresh.
	account.set(downloadAccountA, time.Now().Add(2*time.Hour))
	handle, err := tracker.beginFromSource(account, page, source)
	if err != nil || handle == "" {
		t.Fatalf("begin after refresh = %q, %v", handle, err)
	}
	if _, ok := tracker.takeCompleted(page, source); ok {
		t.Fatal("the preview source became a completed save")
	}
}

func TestArtifactPreviewSourceFailsClosedAfterInvalidation(t *testing.T) {
	for _, tc := range []struct {
		name       string
		invalidate func(t *testing.T, tracker *artifactDownloadTracker, account *workspaceAccount, page *mygo.Page, source string)
	}{
		{
			name: "explicit sign-out",
			invalidate: func(t *testing.T, tracker *artifactDownloadTracker, account *workspaceAccount, page *mygo.Page, source string) {
				account.clear()
			},
		},
		{
			name: "same-user replacement",
			invalidate: func(t *testing.T, tracker *artifactDownloadTracker, account *workspaceAccount, page *mygo.Page, source string) {
				account.clear()
				account.set(downloadAccountA, time.Now().Add(time.Hour))
			},
		},
		{
			name: "different owner",
			invalidate: func(t *testing.T, tracker *artifactDownloadTracker, account *workspaceAccount, page *mygo.Page, source string) {
				account.set(downloadAccountB, time.Now().Add(time.Hour))
			},
		},
		{
			name: "active page navigation",
			invalidate: func(t *testing.T, tracker *artifactDownloadTracker, account *workspaceAccount, page *mygo.Page, source string) {
				tracker.navigated(page)
			},
		},
		{
			name: "page replacement",
			invalidate: func(t *testing.T, tracker *artifactDownloadTracker, account *workspaceAccount, page *mygo.Page, source string) {
				tracker.discardOtherPages(&mygo.Page{})
			},
		},
		{
			name: "preview close",
			invalidate: func(t *testing.T, tracker *artifactDownloadTracker, account *workspaceAccount, page *mygo.Page, source string) {
				tracker.cancel(page, source)
			},
		},
		{
			name: "account invalidation",
			invalidate: func(t *testing.T, tracker *artifactDownloadTracker, account *workspaceAccount, page *mygo.Page, source string) {
				tracker.discardAll()
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			account := downloadTestAccount(t, downloadAccountA)
			account.setOnClear(func() {})
			page := &mygo.Page{}
			tracker := &artifactDownloadTracker{}
			source, err := tracker.beginPreview(downloadTestLease(t, account), page)
			if err != nil {
				t.Fatal(err)
			}
			tc.invalidate(t, tracker, account, page, source)
			if _, err := tracker.beginFromSource(account, page, source); !errors.Is(err, errArtifactDownloadStale) {
				t.Fatalf("an invalidated source derived a save: %v", err)
			}
			tracker.mu.Lock()
			remaining := len(tracker.tickets) + len(tracker.sources)
			tracker.mu.Unlock()
			if remaining != 0 {
				t.Fatalf("an invalidated source left %d native entries", remaining)
			}
		})
	}
}

func TestArtifactPreviewSourceBoundsAndFailedBegins(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	sources := make([]string, 0, artifactPreviewMaximum)
	for range artifactPreviewMaximum {
		source, err := tracker.beginPreview(downloadTestLease(t, account), page)
		if err != nil {
			t.Fatal(err)
		}
		sources = append(sources, source)
	}
	if _, err := tracker.beginPreview(downloadTestLease(t, account), page); !errors.Is(err, errArtifactDownloadUnavailable) {
		t.Fatalf("the preview source bound did not fail closed: %v", err)
	}

	tracker.cancel(page, sources[0])
	if _, err := tracker.beginPreview(downloadTestLease(t, account), page); err != nil {
		t.Fatalf("a closed preview source was not reclaimed: %v", err)
	}

	source := sources[1]
	tracker.mu.Lock()
	ticketsBefore := len(tracker.tickets)
	tracker.mu.Unlock()
	if _, err := tracker.beginFromSource(account, page, "unknown"); !errors.Is(err, errArtifactDownloadStale) {
		t.Fatalf("an unknown source derived a save: %v", err)
	}
	tracker.mu.Lock()
	if len(tracker.tickets) != ticketsBefore {
		t.Fatalf("a failed source derivation created %d tickets", len(tracker.tickets)-ticketsBefore)
	}
	tracker.mu.Unlock()

	// The source stays usable when the independent save-ticket bound is full.
	for range artifactDownloadMaximum {
		if _, err := tracker.beginFromSource(account, page, source); err != nil {
			t.Fatalf("deriving the save-ticket bound: %v", err)
		}
	}
	if _, err := tracker.beginFromSource(account, page, source); !errors.Is(err, errArtifactDownloadUnavailable) {
		t.Fatalf("the save-ticket bound did not fail closed: %v", err)
	}
	tracker.cancel(page, source)
	if _, err := tracker.beginFromSource(account, page, source); !errors.Is(err, errArtifactDownloadStale) {
		t.Fatalf("the source survived its close: %v", err)
	}
}

func TestArtifactPreviewSourceHasNoClockExpiryWhileAccountIsValid(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	now := time.Now()
	tracker := &artifactDownloadTracker{now: func() time.Time { return now }}
	source, err := tracker.beginPreview(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(100 * artifactDownloadLifetime)
	handle, err := tracker.beginFromSource(account, page, source)
	if err != nil {
		t.Fatalf("a live preview source expired with the save-ticket lifetime: %v", err)
	}
	blob := "blob:mygo://localhost/long-pending-preview"
	if err := tracker.arm(account, page, handle, blob); err != nil {
		t.Fatal(err)
	}
	path := downloadTestFile(t, t.TempDir(), "long-pending.txt", cloudFileContentForTest)
	if tracker.started(account, page, blob, path, "long-pending.txt") {
		t.Fatal("a save from a long-pending preview was cancelled")
	}
	if _, ok := tracker.completed(account, page, &mygo.Download{URL: blob, Path: path}); !ok {
		t.Fatal("a save from a long-pending preview did not complete")
	}
}

func TestArtifactDownloadRearmSameURLIsIdempotent(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	handle, err := tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	blob := "blob:mygo://localhost/rearm-idempotent"
	if err := tracker.arm(account, page, handle, blob); err != nil {
		t.Fatal(err)
	}
	if err := tracker.arm(account, page, handle, blob); err != nil {
		t.Fatalf("the same URL was not idempotent: %v", err)
	}
	path := downloadTestFile(t, t.TempDir(), "idempotent.txt", "one writer")
	if tracker.started(account, page, blob, path, "idempotent.txt") {
		t.Fatal("the idempotent arm cancelled the save")
	}
	if saved, ok := tracker.completed(account, page, &mygo.Download{URL: blob, Path: path}); !ok || saved.Handle != handle {
		t.Fatalf("the idempotent save completed = %+v, %t", saved, ok)
	}
	if _, ok := tracker.takeCompleted(page, handle); !ok {
		t.Fatal("the idempotent save lost its reveal")
	}
	if _, ok := tracker.takeCompleted(page, handle); ok {
		t.Fatal("the idempotent save created a second reveal")
	}
}

func TestArtifactDownloadRearmKeepsFirstBindingAndTombstone(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	firstHandle, err := tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	firstBlob := "blob:mygo://localhost/rearm-bound-first"
	if err := tracker.arm(account, page, firstHandle, firstBlob); err != nil {
		t.Fatal(err)
	}

	invalidatedHandle, err := tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	invalidatedBlob := "blob:mygo://localhost/rearm-tombstone"
	if err := tracker.arm(account, page, invalidatedHandle, invalidatedBlob); err != nil {
		t.Fatal(err)
	}
	tracker.cancel(page, invalidatedHandle)

	if err := tracker.arm(account, page, firstHandle, invalidatedBlob); !errors.Is(err, errArtifactDownloadInvalid) {
		t.Fatalf("a tombstoned URL replaced the first binding: %v", err)
	}
	invalidatedPath := filepath.Join(t.TempDir(), "tombstoned.txt")
	if !downloadTestDestinationCancelled(account, tracker, page, page, invalidatedBlob, invalidatedPath) {
		t.Fatal("the rejected re-arm consumed the invalidated URL tombstone")
	}
	firstPath := downloadTestFile(t, t.TempDir(), "bound-first.txt", "bound bytes")
	if tracker.started(account, page, firstBlob, firstPath, "bound-first.txt") {
		t.Fatal("the first binding was lost after the rejected re-arm")
	}
	if _, ok := tracker.completed(account, page, &mygo.Download{URL: firstBlob, Path: firstPath}); !ok {
		t.Fatal("the retained first binding did not complete")
	}
}

func TestArtifactDownloadWritersShareOneTotalBound(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	dir := t.TempDir()
	type writer struct{ url, path string }
	writers := make([]writer, 0, artifactDownloadOperationMaximum)
	for index := 0; index < artifactDownloadOperationMaximum; index++ {
		w := writer{
			url:  "blob:mygo://localhost/writer-bound-" + strconv.Itoa(index),
			path: filepath.Join(dir, "writer-bound-"+strconv.Itoa(index)+".txt"),
		}
		writers = append(writers, w)
		if tracker.started(account, page, w.url, w.path, filepath.Base(w.path)) {
			t.Fatalf("ordinary write %d was cancelled below the total cap", index)
		}
	}

	// The 65th ordinary write is cancelled before MyGo writes it; there is no
	// spillover table that would let it proceed unrecorded.
	overflow := writer{
		url:  "blob:mygo://localhost/writer-bound-overflow",
		path: filepath.Join(dir, "overflow.txt"),
	}
	if !tracker.started(account, page, overflow.url, overflow.path, "overflow.txt") {
		t.Fatal("the 65th writer was admitted beyond the total cap")
	}

	// A callback for a page that never admitted the pair frees nothing.
	tracker.released(&mygo.Page{}, &mygo.Download{URL: writers[0].url, Path: writers[0].path})
	if !tracker.started(account, page, overflow.url, overflow.path, "overflow.txt") {
		t.Fatal("a mismatched callback opened a writer slot")
	}

	// Only the matching start/done pair opens exactly one slot.
	tracker.completed(account, page, &mygo.Download{URL: writers[0].url, Path: writers[0].path})
	if tracker.started(account, page, overflow.url, overflow.path, "overflow.txt") {
		t.Fatal("the exact completion did not open a writer slot")
	}
	if !tracker.started(account, page, overflow.url+"-again", overflow.path, "overflow.txt") {
		t.Fatal("one completion opened more than one writer slot")
	}
}

func TestArtifactDownloadActiveOrdinaryWriterSurvivesClockJump(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	now := time.Now()
	tracker := &artifactDownloadTracker{now: func() time.Time { return now }}
	dir := t.TempDir()
	path := filepath.Join(dir, "active.txt")
	ordinaryBlob := "blob:mygo://localhost/active-writer"
	if tracker.started(account, page, ordinaryBlob, path, "active.txt") {
		t.Fatal("the ordinary write was cancelled")
	}
	// Ticket expiry, a same-document reload, and an account invalidation must
	// not make the live ordinary writer look idle.
	tracker.navigated(page)
	tracker.discardAll()
	now = now.Add(100 * artifactDownloadLifetime)

	handle, err := tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	blob := "blob:mygo://localhost/active-writer-tracked"
	if err := tracker.arm(account, page, handle, blob); err != nil {
		t.Fatal(err)
	}
	if !tracker.started(account, page, blob, path, "active.txt") {
		t.Fatal("a clock jump made an active ordinary writer look idle")
	}
	if _, ok := tracker.takeCompleted(page, handle); ok {
		t.Fatal("the rejected save left a Finder ticket")
	}

	// Only the exact terminal pair releases the active writer.
	tracker.completed(account, page, &mygo.Download{URL: ordinaryBlob, Path: path})
	downloadTestFile(t, dir, "active.txt", cloudFileContentForTest)
	handle, err = tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	if err := tracker.arm(account, page, handle, blob); err != nil {
		t.Fatal(err)
	}
	if tracker.started(account, page, blob, path, "active.txt") {
		t.Fatal("the completed ordinary writer still blocked the path")
	}
	if saved, ok := tracker.completed(account, page, &mygo.Download{URL: blob, Path: path}); !ok || saved.Handle != handle {
		t.Fatalf("the save after completion = %+v, %t", saved, ok)
	}
}

func TestArtifactDownloadOldPageWriteStaysClosedUntilItsExactDone(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	oldPage := &mygo.Page{}
	currentPage := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	dir := t.TempDir()
	path := filepath.Join(dir, "old-page.txt")
	oldBlob := "blob:mygo://localhost/old-page-write"
	if downloadTestDestinationCancelled(account, tracker, oldPage, currentPage, oldBlob, path) {
		t.Fatal("an old page's ordinary download was cancelled")
	}

	handle, err := tracker.begin(downloadTestLease(t, account), currentPage)
	if err != nil {
		t.Fatal(err)
	}
	blob := "blob:mygo://localhost/old-page-tracked"
	if err := tracker.arm(account, currentPage, handle, blob); err != nil {
		t.Fatal(err)
	}
	if !tracker.started(account, currentPage, blob, path, "old-page.txt") {
		t.Fatal("a tracked save reused an old page write's path")
	}

	// A mismatched URL or a page that never admitted the pair cannot release
	// the live writer's slot.
	tracker.released(currentPage, &mygo.Download{URL: oldBlob + "-other", Path: path})
	tracker.released(&mygo.Page{}, &mygo.Download{URL: oldBlob, Path: path})
	handle, err = tracker.begin(downloadTestLease(t, account), currentPage)
	if err != nil {
		t.Fatal(err)
	}
	if err := tracker.arm(account, currentPage, handle, blob); err != nil {
		t.Fatal(err)
	}
	if !tracker.started(account, currentPage, blob, path, "old-page.txt") {
		t.Fatal("a mismatched done callback released the old page write")
	}

	// The exact page's pair releases it; a fresh save can use the path.
	tracker.released(oldPage, &mygo.Download{URL: oldBlob, Path: path})
	downloadTestFile(t, dir, "old-page.txt", cloudFileContentForTest)
	handle, err = tracker.begin(downloadTestLease(t, account), currentPage)
	if err != nil {
		t.Fatal(err)
	}
	if err := tracker.arm(account, currentPage, handle, blob); err != nil {
		t.Fatal(err)
	}
	if tracker.started(account, currentPage, blob, path, "old-page.txt") {
		t.Fatal("the released old page path still rejected a tracked save")
	}
	if saved, ok := tracker.completed(account, currentPage, &mygo.Download{URL: blob, Path: path}); !ok || saved.Handle != handle {
		t.Fatalf("the save after release completed = %+v, %t", saved, ok)
	}
}

// An old page's admitted write replaces the bytes at its exact path, so it must
// withdraw a Finder offer for that path just like a current-page write. A write
// that is rejected before MyGo writes it must withdraw nothing.
func TestArtifactDownloadOldPageAdmissionWithdrawsSamePathOffer(t *testing.T) {
	for _, pending := range []bool{false, true} {
		name := "completed offer"
		if pending {
			name = "pending offer"
		}
		t.Run(name, func(t *testing.T) {
			account := downloadTestAccount(t, downloadAccountA)
			currentPage := &mygo.Page{}
			oldPage := &mygo.Page{}
			tracker := &artifactDownloadTracker{}
			path := downloadTestFile(t, t.TempDir(), "old-page-offer.txt", cloudFileContentForTest)
			blob := "blob:mygo://localhost/old-page-offer"
			handle, err := tracker.begin(downloadTestLease(t, account), currentPage)
			if err != nil {
				t.Fatal(err)
			}
			if err := tracker.arm(account, currentPage, handle, blob); err != nil {
				t.Fatal(err)
			}
			if tracker.started(account, currentPage, blob, path, "old-page-offer.txt") {
				t.Fatal("the tracked save was cancelled")
			}
			if !pending {
				if _, ok := tracker.completed(account, currentPage, &mygo.Download{URL: blob, Path: path}); !ok {
					t.Fatal("the tracked save did not complete")
				}
			}
			ordinary := "https://downloads.example.test/old-page-replacement"
			if downloadTestDestinationCancelled(account, tracker, oldPage, currentPage, ordinary, path) {
				t.Fatal("an old page's ordinary write was cancelled")
			}
			if _, ok := tracker.takeCompleted(currentPage, handle); ok {
				t.Fatal("an admitted old page write kept a Finder offer for its exact path")
			}
			if _, ok := tracker.completed(account, currentPage, &mygo.Download{URL: blob, Path: path}); ok {
				t.Fatal("an admitted old page write left a pending Finder offer for its exact path")
			}
		})
	}
}

// The single writer bound applies to old-page writes too: with no slot they are
// cancelled before writing, and a rejected write must not withdraw an offer.
func TestArtifactDownloadRejectedWriterKeepsExistingOffer(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	oldPage := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	dir := t.TempDir()

	offer := func(name string) (string, string) {
		t.Helper()
		path := downloadTestFile(t, dir, name, cloudFileContentForTest)
		blob := "blob:mygo://localhost/" + name
		handle, err := tracker.begin(downloadTestLease(t, account), page)
		if err != nil {
			t.Fatal(err)
		}
		if err := tracker.arm(account, page, handle, blob); err != nil {
			t.Fatal(err)
		}
		if tracker.started(account, page, blob, path, name) {
			t.Fatalf("offer %q was cancelled", name)
		}
		if _, ok := tracker.completed(account, page, &mygo.Download{URL: blob, Path: path}); !ok {
			t.Fatalf("offer %q did not complete", name)
		}
		return path, handle
	}
	oldPath, oldHandle := offer("old-page-kept.txt")
	pagePath, pageHandle := offer("current-page-kept.txt")

	type writer struct{ url, path string }
	fillers := make([]writer, 0, artifactDownloadOperationMaximum)
	for index := 0; index < artifactDownloadOperationMaximum; index++ {
		fill := writer{
			url:  "blob:mygo://localhost/rejected-writer-" + strconv.Itoa(index),
			path: filepath.Join(dir, "rejected-writer-"+strconv.Itoa(index)+".txt"),
		}
		fillers = append(fillers, fill)
		if tracker.started(account, page, fill.url, fill.path, filepath.Base(fill.path)) {
			t.Fatalf("ordinary write %d was cancelled below the total cap", index)
		}
	}

	if !downloadTestDestinationCancelled(account, tracker, oldPage, page,
		"https://downloads.example.test/rejected-old-page", oldPath) {
		t.Fatal("the 65th writer was admitted beyond the total cap")
	}
	if _, ok := tracker.takeCompleted(page, oldHandle); !ok {
		t.Fatal("a rejected old page write withdrew a completed Finder offer")
	}
	if !downloadTestDestinationCancelled(account, tracker, page, page,
		"https://downloads.example.test/rejected-current-page", pagePath) {
		t.Fatal("the 66th writer was admitted beyond the total cap")
	}
	if _, ok := tracker.takeCompleted(page, pageHandle); !ok {
		t.Fatal("a rejected current page write withdrew a completed Finder offer")
	}

	// One exact completion opens one slot; the admitted write now withdraws the
	// offer at the path it replaces.
	tracker.completed(account, page, &mygo.Download{URL: fillers[0].url, Path: fillers[0].path})
	if downloadTestDestinationCancelled(account, tracker, page, page,
		"https://downloads.example.test/admitted-current-page", pagePath) {
		t.Fatal("the freed writer slot was not admitted")
	}
	if _, ok := tracker.takeCompleted(page, pageHandle); ok {
		t.Fatal("an admitted write kept the Finder offer for its exact path")
	}
}

// Writer occupancy is per page as well as URL and path: a done callback from a
// page that never admitted the pair discharges nothing, and two pages may share
// one non-blob URL and path below the cap.
func TestArtifactDownloadWriterReleaseIsPageScoped(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	desktop := &Desktop{}
	tracker := &desktop.downloads
	currentPage := &mygo.Page{}
	oldPage := &mygo.Page{}
	thirdPage := &mygo.Page{}
	dir := t.TempDir()
	const sharedURL = "https://downloads.example.test/shared.bin"
	path := filepath.Join(dir, "shared.bin")
	if downloadTestDestinationCancelled(account, tracker, currentPage, currentPage, sharedURL, path) {
		t.Fatal("the current page's ordinary write was cancelled")
	}
	// A page that never admitted this pair cannot discharge the live writer.
	desktop.artifactDownloadFinished(thirdPage, &mygo.Download{URL: sharedURL, Path: path})

	blob := "blob:mygo://localhost/shared-writer"
	armSave := func() string {
		t.Helper()
		handle, err := tracker.begin(downloadTestLease(t, account), currentPage)
		if err != nil {
			t.Fatal(err)
		}
		if err := tracker.arm(account, currentPage, handle, blob); err != nil {
			t.Fatal(err)
		}
		return handle
	}
	armSave()
	if !tracker.started(account, currentPage, blob, path, "shared.bin") {
		t.Fatal("a page that never admitted the pair released its writer")
	}

	// The old page may share the same exact URL and path while a slot remains.
	if downloadTestDestinationCancelled(account, tracker, oldPage, currentPage, sharedURL, path) {
		t.Fatal("the old page's ordinary write was cancelled")
	}
	desktop.artifactDownloadFinished(oldPage, &mygo.Download{URL: sharedURL, Path: path})
	armSave()
	if !tracker.started(account, currentPage, blob, path, "shared.bin") {
		t.Fatal("the old page's completion consumed the current page's writer")
	}

	// Only the current page's exact completion releases the last writer.
	desktop.artifactDownloadFinished(currentPage, &mygo.Download{URL: sharedURL, Path: path})
	downloadTestFile(t, dir, "shared.bin", cloudFileContentForTest)
	handle := armSave()
	if tracker.started(account, currentPage, blob, path, "shared.bin") {
		t.Fatal("the released shared path still rejected a tracked save")
	}
	if saved, ok := tracker.completed(account, currentPage, &mygo.Download{URL: blob, Path: path}); !ok || saved.Handle != handle {
		t.Fatalf("the save after release completed = %+v, %t", saved, ok)
	}
}

func TestArtifactDownloadOperationCapAppliesAcrossOnePath(t *testing.T) {
	account := downloadTestAccount(t, downloadAccountA)
	page := &mygo.Page{}
	tracker := &artifactDownloadTracker{}
	dir := t.TempDir()
	hotPath := filepath.Join(dir, "hot.txt")
	hotURLs := make([]string, 0, artifactDownloadOperationMaximum)
	for index := 0; index < artifactDownloadOperationMaximum; index++ {
		blob := "blob:mygo://localhost/operation-cap-" + strconv.Itoa(index)
		hotURLs = append(hotURLs, blob)
		if tracker.started(account, page, blob, hotPath, "hot.txt") {
			t.Fatalf("ordinary write %d was cancelled", index)
		}
	}

	// One path holds the whole budget. The cap is total, not per path, so a
	// Finder save on another path must still fail closed.
	newPath := filepath.Join(dir, "new.txt")
	handle, err := tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	blob := "blob:mygo://localhost/operation-cap-tracked"
	if err := tracker.arm(account, page, handle, blob); err != nil {
		t.Fatal(err)
	}
	if !tracker.started(account, page, blob, newPath, "new.txt") {
		t.Fatal("the total operation cap admitted a tracked save")
	}
	if _, ok := tracker.takeCompleted(page, handle); ok {
		t.Fatal("the rejected save left a Finder ticket")
	}

	// A terminal match frees one slot for a fresh save.
	tracker.completed(account, page, &mygo.Download{URL: hotURLs[0], Path: hotPath})
	downloadTestFile(t, dir, "new.txt", cloudFileContentForTest)
	handle, err = tracker.begin(downloadTestLease(t, account), page)
	if err != nil {
		t.Fatal(err)
	}
	if err := tracker.arm(account, page, handle, blob); err != nil {
		t.Fatal(err)
	}
	if tracker.started(account, page, blob, newPath, "new.txt") {
		t.Fatal("the released operation slot still rejected a tracked save")
	}
	if saved, ok := tracker.completed(account, page, &mygo.Download{URL: blob, Path: newPath}); !ok || saved.Handle != handle {
		t.Fatalf("the save after release = %+v, %t", saved, ok)
	}
}
