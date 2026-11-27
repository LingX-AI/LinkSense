//go:build desktop_whitebox

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

const (
	whiteboxOwner           = "10000000-0000-4000-8000-000000000001"
	whiteboxOtherOwner      = "90000000-0000-4000-8000-000000000001"
	whiteboxWorkspaceA      = "40000000-0000-4000-8000-00000000000a"
	whiteboxWorkspaceB      = "40000000-0000-4000-8000-00000000000b"
	whiteboxWorkspaceC      = "40000000-0000-4000-8000-00000000000c"
	whiteboxWorkspaceD      = "40000000-0000-4000-8000-00000000000d"
	whiteboxWorkspaceE      = "40000000-0000-4000-8000-00000000000e"
	whiteboxClearedTitle    = "Local task files were cleared"
	whiteboxWorkspaceOrigin = "https://other.example.test"
)

func whiteboxWorkspaceSession(
	t *testing.T, root, owner, conversation, origin string, lastUsedAt int64, content string,
) string {
	t.Helper()
	directory := filepath.Join(root, owner, "services", conversation)
	workspace := filepath.Join(directory, "home", "workspace")
	if err := os.MkdirAll(workspace, 0o700); err != nil {
		t.Fatal(err)
	}
	if content != "" {
		if err := os.WriteFile(filepath.Join(workspace, "fixture.txt"), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	marker, err := json.Marshal(map[string]any{
		"version": 2, "origin": origin, "ownerId": owner,
		"conversationId": conversation, "lastUsedAt": lastUsedAt,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "desktop-session.json"), marker, 0o600); err != nil {
		t.Fatal(err)
	}
	return workspace
}

func whiteboxLegacyWorkspace(t *testing.T, root, owner, conversation string, lastUsedAt int64, content string) string {
	t.Helper()
	directory := filepath.Join(root, owner, "services", conversation)
	workspace := filepath.Join(directory, "home", "workspace")
	if err := os.MkdirAll(workspace, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "legacy.txt"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	marker, err := json.Marshal(map[string]any{
		"version": 1, "ownerId": owner, "conversationId": conversation, "lastUsedAt": lastUsedAt,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "desktop-session.json"), marker, 0o600); err != nil {
		t.Fatal(err)
	}
	return workspace
}

func whiteboxPendingOutbox(t *testing.T, root, owner, conversation string) {
	t.Helper()
	outbox := filepath.Join(root, owner, "services", conversation, "control", "workspaces", conversation, "outbox")
	if err := os.MkdirAll(outbox, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outbox,
		"0000000000000001-40000000-0000-4000-8000-00000000000f.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func whiteboxNavigate(t *testing.T, page *mygo.Page, route string) {
	t.Helper()
	if _, err := page.Eval(fmt.Sprintf(`(() => {
		history.pushState(null, "", %q);
		window.dispatchEvent(new PopStateEvent("popstate"));
		return location.pathname;
	})()`, route)); err != nil {
		t.Fatal(err)
	}
	if _, err := page.Eval(fmt.Sprintf(`location.pathname === %q`, route)); err != nil {
		t.Fatal(err)
	}
}

func whiteboxUsage(t *testing.T, page *mygo.Page) map[string]float64 {
	t.Helper()
	value, err := page.Eval(`mygo.call("Desktop.WorkspaceUsage").then(usage => ({bytes: usage.bytes, files: usage.files, sessions: usage.sessions}))`)
	if err != nil {
		t.Fatal(err)
	}
	usage, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("workspace usage bridge returned %#v", value)
	}
	result := map[string]float64{}
	for _, key := range []string{"bytes", "files", "sessions"} {
		number, ok := usage[key].(float64)
		if !ok {
			t.Fatalf("workspace usage %s was %#v", key, usage[key])
		}
		result[key] = number
	}
	return result
}

func whiteboxWorkspaceLabels(t *testing.T, page *mygo.Page) map[string]string {
	t.Helper()
	value, err := page.Eval(`(() => {
		const labels = {};
		for (const row of document.querySelectorAll("dl > div")) {
			const key = row.querySelector("dt")?.textContent?.trim();
			const text = row.querySelector("dd")?.textContent?.trim();
			if (key && text) labels[key] = text;
		}
		return labels;
	})()`)
	if err != nil {
		t.Fatal(err)
	}
	labels, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("workspace labels were %#v", value)
	}
	result := map[string]string{}
	for key, text := range labels {
		result[key], _ = text.(string)
	}
	return result
}

// TestNativeWorkspaceUsageCleanupAndNotice drives the shared Settings and
// conversation UI inside the real WKWebView against a disposable supervised
// runner. Fixtures cover this account, another account, a foreign origin, a
// legacy v1 session, and unresolved outbox work.
func TestNativeWorkspaceUsageCleanupAndNotice(t *testing.T) {
	runtimeRoot := os.Getenv("LINKSENSE_DESKTOP_RUNTIME_DIST")
	if !filepath.IsAbs(runtimeRoot) {
		t.Skip("LINKSENSE_DESKTOP_RUNTIME_DIST must select a packaged runtime for the whitebox runner")
	}
	nativeWhiteboxSession(t, true)
	desktop := nativeWhitebox.desktop
	runtimeDataRoot := filepath.Join(nativeWhitebox.dataRoot, "local-runtime")
	runtime := superviseRuntime(runtimeDataRoot, runtimeRoot, nativeWhitebox.server.URL)
	desktop.localRuntime = runtime
	t.Cleanup(func() {
		runtime.close()
		desktop.localRuntime = nil
	})
	deadline := time.Now().Add(30 * time.Second)
	for !runtime.ready.Load() && time.Now().Before(deadline) {
		select {
		case <-runtime.done:
			t.Fatal("whitebox runtime did not start")
		case <-time.After(50 * time.Millisecond):
		}
	}
	if !runtime.ready.Load() {
		t.Fatal("whitebox runtime readiness timed out")
	}

	now := time.Now().Add(-20 * 24 * time.Hour).UnixMilli()
	origin := nativeWhitebox.server.URL
	workspaceA := whiteboxWorkspaceSession(t, runtimeDataRoot, whiteboxOwner, whiteboxWorkspaceA, origin, now, "12345")
	workspaceB := whiteboxWorkspaceSession(t, runtimeDataRoot, whiteboxOwner, whiteboxWorkspaceB, whiteboxWorkspaceOrigin, now, "foreign")
	workspaceC := whiteboxLegacyWorkspace(t, runtimeDataRoot, whiteboxOwner, whiteboxWorkspaceC, now, "legacy")
	workspaceD := whiteboxWorkspaceSession(t, runtimeDataRoot, whiteboxOwner, whiteboxWorkspaceD, origin, now, "pending")
	whiteboxPendingOutbox(t, runtimeDataRoot, whiteboxOwner, whiteboxWorkspaceD)
	workspaceE := whiteboxWorkspaceSession(t, runtimeDataRoot, whiteboxOtherOwner, whiteboxWorkspaceE, origin, now, "other-owner")

	desktop.openMainWindow()
	win := desktop.mainWindow()
	defer win.Destroy()
	page := win.Page()
	whiteboxWait(t, page, `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli")`)

	whiteboxNavigate(t, page, "/settings/general")
	whiteboxWait(t, page, `document.body.innerText.includes("Local workspaces") && document.body.innerText.includes("Clean up now")`)
	// The aggregate is fetched asynchronously; wait for the rendered rows before
	// reading labels so this test observes the UI rather than a loading frame.
	whiteboxWait(t, page, `document.querySelectorAll("dl > div").length >= 3`)
	usage := whiteboxUsage(t, page)
	if usage["bytes"] != 12 || usage["files"] != 2 || usage["sessions"] != 2 {
		t.Fatalf("settings usage was not scoped to this account and origin: %#v", usage)
	}
	labels := whiteboxWorkspaceLabels(t, page)
	if labels["Files"] != "2" || labels["Workspaces"] != "2" || labels["Size"] == "" {
		t.Fatalf("settings did not show usage: %#v", labels)
	}

	if _, err := page.Eval(`Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "Clean up now")?.click()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.body.innerText.includes("Cleanup finished")`)
	if _, err := os.Lstat(workspaceA); !os.IsNotExist(err) {
		t.Fatal("the eligible owned workspace was not cleared")
	}
	for name, workspace := range map[string]string{
		"foreign origin": workspaceB, "legacy v1": workspaceC,
		"unresolved outbox": workspaceD, "other account": workspaceE,
	} {
		if _, err := os.Lstat(workspace); err != nil {
			t.Fatalf("%s workspace was removed: %v", name, err)
		}
	}
	after := whiteboxUsage(t, page)
	if after["bytes"] != 7 || after["files"] != 1 || after["sessions"] != 1 {
		t.Fatalf("cleanup freed ineligible bytes or lost retained usage: %#v", after)
	}
	// The settings card refreshes usage after the cleanup result; wait for that
	// render before asserting the displayed rows.
	whiteboxWait(t, page, `(() => {
		const rows = Array.from(document.querySelectorAll("dl > div"));
		return rows.length >= 3 && rows.some(row => row.querySelector("dd")?.textContent?.trim() === "1");
	})()`)
	labels = whiteboxWorkspaceLabels(t, page)
	if labels["Files"] != "1" || labels["Workspaces"] != "1" {
		t.Fatalf("settings did not refresh the scoped usage: %#v", labels)
	}

	// Only the explicitly cleared conversation reports a notice.
	cleared, err := page.Eval(fmt.Sprintf(`Promise.all([
		mygo.call("Desktop.WorkspaceNotice", %q).then(value => value.cleared),
		mygo.call("Desktop.WorkspaceNotice", %q).then(value => value.cleared),
		mygo.call("Desktop.WorkspaceNotice", %q).then(value => value.cleared),
		mygo.call("Desktop.WorkspaceNotice", %q).then(value => value.cleared)
	])`, whiteboxWorkspaceA, whiteboxWorkspaceB, whiteboxWorkspaceC, whiteboxWorkspaceD))
	if err != nil {
		t.Fatal(err)
	}
	flags, ok := clearResults(cleared)
	if !ok || !flags[0] || flags[1] || flags[2] || flags[3] {
		t.Fatalf("workspace notice was not limited to the confirmed clear: %#v", cleared)
	}

	whiteboxNavigate(t, page, "/conversations/"+whiteboxWorkspaceA)
	whiteboxWait(t, page, fmt.Sprintf(`document.body.innerText.includes(%q)`, whiteboxClearedTitle))
	// The notice is read from disk, so a WebView reload keeps showing it.
	whiteboxReload(t, page)
	whiteboxWait(t, page, fmt.Sprintf(`document.body.innerText.includes(%q)`, whiteboxClearedTitle))

	// Sign-out invalidates the native account; the same id signing in again
	// must go through a native refresh before usage is admitted again.
	if _, err := page.Eval(`mygo.call("Desktop.ClearSession")`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `mygo.call("Desktop.WorkspaceUsage").then(() => false, () => true)`)
	nativeWhiteboxSession(t, true)
	whiteboxReload(t, page)
	whiteboxWait(t, page, `document.body.innerText.includes("Eli")`)
	whiteboxWait(t, page, `mygo.call("Desktop.WorkspaceUsage").then(usage => usage.bytes === 7)`)
}

func clearResults(value any) ([]bool, bool) {
	items, ok := value.([]any)
	if !ok || len(items) != 4 {
		return nil, false
	}
	result := make([]bool, 0, len(items))
	for _, item := range items {
		flag, ok := item.(bool)
		if !ok {
			return nil, false
		}
		result = append(result, flag)
	}
	return result, true
}
