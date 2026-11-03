package main

import (
	"context"
	"errors"
	"net/url"
	"runtime"
	"strings"
	"sync"

	"github.com/egoist/mygo"
)

type connectionState int

const (
	disconnected connectionState = iota
	connected
	running
	paused
	connectionError
	awaitingApproval
)

// Preview states never grant permission to operate the real desktop.
type desktopApp struct {
	state           connectionState
	preview         bool
	pairing         bool
	settings        bool
	reduceMotion    bool
	theme           int
	language        string
	server          string
	deviceName      string
	message         string
	openWorkspace   func(string) error
	platform        string
	pairingCode     string
	busy            bool
	permissions     permissionState
	credential      *deviceCredentials
	pendingApproval *approvalRequest
	bridge          *desktopBridge
	storage         credentialStorage
	post            func(func())
	show            func()
	cancelAttempt   context.CancelFunc
	attemptID       uint64
	secretMu        sync.Mutex
	permissionStop  context.CancelFunc
	permissionPanel *mygo.Window
}

func newDesktopApp(preview bool, deviceName string) *desktopApp {
	return &desktopApp{
		preview:    preview,
		language:   "zh-CN",
		deviceName: deviceName,
		platform:   runtime.GOOS,
	}
}

func workspaceURL(raw string) (string, error) {
	value, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || value.Hostname() == "" || value.User != nil ||
		value.RawQuery != "" || value.Fragment != "" ||
		(value.Path != "" && value.Path != "/") {
		return "", errors.New("invalid workspace origin")
	}
	if value.Scheme != "https" && value.Scheme != "http" {
		return "", errors.New("workspace origin requires HTTP or HTTPS")
	}
	value.Path = "/"
	return value.String(), nil
}

func (a *desktopApp) stop() {
	if a.preview {
		a.state = paused
		return
	}
	a.pendingApproval = nil
	if a.bridge != nil {
		a.bridge.Pause()
	}
}

func (a *desktopApp) open() {
	endpoint, err := workspaceURL(a.server)
	if err != nil {
		a.message = "invalidURL"
		return
	}
	if a.openWorkspace == nil || a.openWorkspace(workspaceSettingsURL(endpoint)) != nil {
		a.message = "openFailed"
		return
	}
	a.message = ""
}
