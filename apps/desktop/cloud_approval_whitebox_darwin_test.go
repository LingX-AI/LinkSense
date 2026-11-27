//go:build desktop_whitebox

package main

// Real-WKWebView coverage for the Mac's local permission modes and the native
// approval card. A created fixture conversation opens the composer's shield
// menu; choosing Bypass must persist through the exact bridge binding. A live
// cloud shell approval must render in the shared Web UI, and one Allow click
// must answer the exact native request while the card disappears. No shell
// command, file change, account, or API approval is executed.

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

const cloudApprovalComposerReady = `document.querySelector(".composer-shell") !== null &&
	document.querySelector('button[aria-label="Choose model and reasoning effort"]') !== null`

func TestNativePermissionModeAndCloudApprovalCard(t *testing.T) {
	nativeWhiteboxSession(t, true)
	desktop := nativeWhitebox.desktop
	desktop.closeDevice()
	fixture := newDeviceJourneyFixture()
	deviceJourneyWhitebox.Store(fixture)
	t.Cleanup(func() {
		desktop.closeDevice()
		deviceJourneyWhitebox.Store(nil)
		fixture.close()
	})

	desktop.openMainWindowInSession(mygo.NewEphemeralSession())
	win := desktop.mainWindow()
	defer win.Destroy()
	win.SetSize(1200, 800)
	page := win.Page()
	whiteboxWait(t, page, `location.pathname === "/conversations/new" && `+cloudApprovalComposerReady)
	deviceJourneyForeground(t, page)

	deviceJourneySetPrompt(t, page, "Native approval flow")
	deviceJourneySubmit(t, page)
	whiteboxWait(t, page, `location.pathname.startsWith("/conversations/") && location.pathname !== "/conversations/new"`)
	rawPath, err := page.Eval(`location.pathname`)
	if err != nil {
		t.Fatal(err)
	}
	path, _ := rawPath.(string)
	conversationID := strings.TrimPrefix(path, "/conversations/")
	if err := page.LoadURL(path); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, cloudApprovalComposerReady)

	// The shield menu keeps the folder access choice and adds the four
	// permission modes, Manual by default. Opening and choosing are retried:
	// the first click can land while the fixture conversation is still
	// settling its composer props.
	whiteboxWait(t, page, `(() => {
		const trigger = document.querySelector('button[aria-label="Folder permissions"]');
		if (!trigger) return false;
		const modes = document.querySelectorAll("[data-permission-mode]");
		if (modes.length !== 4) {
			trigger.click();
			return false;
		}
		return document.querySelector('[data-permission-mode="manual"]').getAttribute("aria-pressed") === "true";
	})()`)
	whiteboxWait(t, page, `(() => {
		const bypass = document.querySelector('[data-permission-mode="bypass"]');
		if (!bypass) {
			document.querySelector('button[aria-label="Folder permissions"]')?.click();
			return false;
		}
		bypass.click();
		return true;
	})()`)
	mode, err := page.Eval(`mygo.call("Desktop.PermissionMode", ` + strconv.Quote(conversationID) + `)`)
	if err != nil || mode != "bypass" {
		t.Fatalf("saved mode = %v, %v", mode, err)
	}

	// One live native approval renders the card; Allow answers the exact
	// request and removes it.
	center := desktop.cloudApprovals
	decision := make(chan string, 1)
	requestError := make(chan error, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	go func() {
		answer, err := center.request(ctx, cloudApprovalRequest{
			ConversationID: conversationID,
			Kind:           cloudApprovalKindCommand,
			Operation:      localShellOperationConstant,
			Command:        "pnpm test",
			Cwd:            "apps/web",
			RootName:       "project",
		})
		if err != nil {
			requestError <- err
			return
		}
		decision <- answer
	}()

	whiteboxWait(t, page, `(() => {
		const card = document.querySelector('[data-testid="cloud-approval-card"]');
		return card !== null &&
			card.getAttribute("data-approval-kind") === "command" &&
			card.textContent.includes("pnpm test") &&
			card.textContent.includes("project/apps/web") &&
			card.querySelector('[data-approval-decision="allow"]') !== null;
	})()`)
	if _, err := page.Eval(`document.querySelector('[data-approval-decision="allow"]').click()`); err != nil {
		t.Fatal(err)
	}
	select {
	case answer := <-decision:
		if answer != cloudApprovalAllow {
			t.Fatalf("native answer = %q", answer)
		}
	case err := <-requestError:
		t.Fatalf("native approval failed: %v", err)
	case <-time.After(10 * time.Second):
		t.Fatal("the native approval was never answered")
	}
	whiteboxWait(t, page, `document.querySelector('[data-testid="cloud-approval-card"]') === null`)

	// Deny is the other fail-closed answer.
	deniedDecision := make(chan string, 1)
	go func() {
		answer, err := center.request(ctx, cloudApprovalRequest{
			ConversationID: conversationID,
			Kind:           cloudApprovalKindCommand,
			Operation:      localShellOperationConstant,
			Command:        "rm -rf .",
			RootName:       "project",
		})
		if err != nil {
			requestError <- err
			return
		}
		deniedDecision <- answer
	}()
	whiteboxWait(t, page, `(() => {
		const card = document.querySelector('[data-testid="cloud-approval-card"]');
		return card !== null && card.textContent.includes("rm -rf .");
	})()`)
	if _, err := page.Eval(`document.querySelector('[data-approval-decision="deny"]').click()`); err != nil {
		t.Fatal(err)
	}
	select {
	case answer := <-deniedDecision:
		if answer != cloudApprovalDeny {
			t.Fatalf("native deny answer = %q", answer)
		}
	case err := <-requestError:
		t.Fatalf("native approval failed: %v", err)
	case <-time.After(10 * time.Second):
		t.Fatal("the native deny was never answered")
	}
}
