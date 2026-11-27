//go:build darwin && desktop_runtime_package

package main

// TestComputerDeviceGateway is the reusable stdio seam for the M1b fixture.
// It runs the real device bridge against the origin supplied on stdin and
// replaces only the runtime pipe with a synthetic one. It adds no HTTP or
// WebSocket server and never touches a real driver, AX, window or permission.
//
// See cu-route-go-interop.txt for the exact protocol.

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

func TestComputerDeviceGateway(t *testing.T) {
	input := bufio.NewScanner(os.Stdin)
	input.Buffer(make([]byte, 64<<10), desktopFrameLimit+4096)
	var fixture struct {
		Origin     string           `json:"origin"`
		Credential deviceCredential `json:"credential"`
		Selection  struct {
			OwnerID           string `json:"owner_id"`
			ConversationID    string `json:"conversation_id"`
			RuntimeGeneration string `json:"runtime_generation"`
			TurnID            string `json:"turn_id"`
			SessionID         string `json:"session_id"`
			SelectionID       string `json:"selection_id"`
			ExpiresAt         string `json:"expires_at"`
		} `json:"selection"`
	}
	if !input.Scan() || json.Unmarshal(input.Bytes(), &fixture) != nil {
		t.Fatal("expected a computer gateway fixture on stdin")
	}
	origin, err := url.Parse(fixture.Origin)
	if err != nil || origin.Host == "" || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" {
		t.Fatal("the computer gateway fixture must name a plain origin")
	}
	if !fixture.Credential.valid() || !strings.EqualFold(fixture.Credential.OwnerID, fixture.Selection.OwnerID) {
		t.Fatal("the computer gateway fixture credential or owner is invalid")
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, fixture.Selection.ExpiresAt)
	if err != nil {
		t.Fatal("the computer gateway selection expiry is invalid")
	}
	target := m1bComputerSelection{
		OwnerID: fixture.Selection.OwnerID, ConversationID: fixture.Selection.ConversationID,
		RuntimeGeneration: fixture.Selection.RuntimeGeneration, TurnID: fixture.Selection.TurnID,
		SessionID: fixture.Selection.SessionID, SelectionID: fixture.Selection.SelectionID,
		ExpiresAt: expiresAt,
	}
	fake := newFixtureComputerExecutor(target)
	host := newM1BComputerHost(fake)

	runtime, pipe, messages := newFixtureRuntime(t)
	device := newFixtureDeviceConnection(t, origin, fixture.Credential)
	device.runtime = runtime
	device.computer = host
	go device.run()
	t.Cleanup(func() {
		device.cancel()
		waitDeviceDone(t, device)
		_ = pipe.input.Close()
	})

	// Runtime-pipe input is exactly what the parent reads: link.open first,
	// then server commands/cancels/results. The fake selection link is filled
	// from the real ready generation before the line is published.
	outputDone := make(chan struct{})
	go func() {
		defer close(outputDone)
		for message := range messages {
			if message.Type == "link.open" {
				fake.setLink(message.LinkID)
			}
			data, err := json.Marshal(message)
			if err != nil {
				continue
			}
			_, _ = fmt.Fprintln(os.Stdout, string(data))
		}
	}()

	// Subsequent stdin lines are the supervised runtime's output frames. Feed
	// them through the real pipe so the real bridge forwards them unchanged.
	lines := make(chan []byte, 4)
	go func() {
		defer close(lines)
		for input.Scan() {
			lines <- append([]byte(nil), input.Bytes()...)
		}
	}()
	for {
		select {
		case line, ok := <-lines:
			if !ok {
				device.cancel()
				waitDeviceDone(t, device)
				_ = pipe.input.Close()
				<-outputDone
				return
			}
			pipe.deliver(string(line))
		case <-device.done:
			t.Fatalf("the device bridge stopped: %s", device.Status().ErrorCode)
		}
	}
}
