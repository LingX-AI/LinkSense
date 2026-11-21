//go:build darwin

package main

// Private macOS computer-use driver slice.
//
// Scope: status -> observe a caller-trusted window identity -> click or type a
// ref from that exact observation -> read the effect back. This file is not
// wired to IPC, MCP, a dispatcher, or application boot. All types and the
// constructor are package-private; there is no renderer/model-reachable entry
// point and no environment, PATH, shell, or flag passthrough.
//
// Trust boundary: the caller supplies a trusted runtime root, a host-owned
// state parent, and an explicit runtime proof. Only the prepared boundary is
// supported: the runtime manifest fields and file hashes produced by
// scripts/desktop-resources.mjs. That boundary is fake-tested and makes no
// code-signature or signed-AX claim. Signed proof is recognized but
// fail-closed until the existing verified installer/build path can supply it;
// this driver does not build a second signing trust chain. The driver never
// adopts an existing state directory: it creates a fresh private child and
// pins its device/inode.
//
// Every agent-desktop invocation is wrapped in the one fixed
// /usr/bin/sandbox-exec profile below; there is no unsandboxed fallback.
// Verified v1.3.1 default paths: status and permissions without
// --request/--guide use a precomputed report (no helper); list-windows,
// snapshot, headless click and headless type use AX/libproc only. The profile
// turns the pre-parse legacy-host SIGKILL into a no-op and denies the CLI's
// own signal paths. The process_identity kill(pid,0) fallback is denied if
// reached, and helper-spawning operations are not exposed. AX/TCC behavior
// under Seatbelt is unverified; this is a private candidate, not a live
// feature, and makes no signed AX claim. Permission guidance is an app-UI
// concern for MyGo permissionflow, never the CLI's --guide.
//
// Authority contract: Act takes only the caller's context. The future executor
// owns live-task, grant, pause/stop, toolCallId/turnId, risk and approval
// checks. This driver models no rival approval layer.
//
// Provenance and host effects (agent-desktop v1.3.1): the driver runs only
// status, permissions, list-windows, snapshot, click and type. It never passes
// --headed, --trace, --screenshot, launch, clipboard, batch, or arbitrary
// --arg/--env/--cwd/--cdp values. The checksum-pinned clipboard helper is
// unused here; v1.3.1 spawns it only for clipboard commands, in its own
// process group, and reaps it. Every invocation also runs upstream
// stop_legacy_command_hosts, which scans for same-uid processes carrying the
// exact AGENT_DESKTOP_INTERNAL_COMMAND_HOST=1 marker and an agent-desktop code
// identity; the fixed profile denies its SIGKILL, so the cleanup is a no-op
// on this Mac (signal-layer isolation test). The per-user
// /tmp/agent-desktop-<uid>/interaction.lock is shared by
// all agent-desktop processes and is deliberately not removed by Close.
// Refmaps under AGENT_DESKTOP_HOME can contain observed app text; they are
// private to the state root and removed by Close.

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	goruntime "runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"
)

const (
	computerAgentDesktopVersion = "1.3.1"
	computerEnvelopeVersion     = "2.6"

	computerRuntimeApplication        = "org.linksense.desktop"
	computerBinaryRel                 = "bin/agent-desktop"
	computerHelperRel                 = "bin/agent-desktop-macos-helper"
	computerSandboxExec               = "/usr/bin/sandbox-exec"
	computerSandboxProfile            = "(version 1) (allow default) (deny signal)"
	computerRuntimeProofPreparedLabel = "prepared"

	computerMaxAppBytes               = 256
	computerMaxWindowIDBytes          = 128
	computerMaxActionTextBytes        = 8 * 1024
	computerMaxObservationElements    = 400
	computerMaxObservationDepth       = 10
	computerMaxRoleBytes              = 64
	computerMaxNameBytes              = 512
	computerMaxValueBytes             = 2048
	computerMaxDescriptionBytes       = 512
	computerMaxObservationTextBytes   = 64 * 1024
	computerMaxSurfaceBytes           = 32
	computerMaxSupportedSurfaces      = 16
	computerMaxRuntimeManifestBytes   = 1 * 1024 * 1024
	computerMaxRuntimeFileBytes       = 256 * 1024 * 1024
	computerMaxStdoutBytes            = 8 * 1024 * 1024
	computerMaxStderrBytes            = 64 * 1024
	computerListWindowsTimeoutMS      = 5000
	computerSnapshotTimeoutMS         = 5000
	computerActionTimeoutMS           = 15000
	computerStatusProcessTimeout      = 10 * time.Second
	computerPermissionsProcessTimeout = 10 * time.Second
	computerListWindowsProcessTimeout = 10 * time.Second
	computerSnapshotProcessTimeout    = 10 * time.Second
	computerActionProcessTimeout      = 20 * time.Second
	computerTerminationWait           = 2 * time.Second
)

const (
	computerErrorSandboxUnavailable  = "COMPUTER_USE_SANDBOX_UNAVAILABLE"
	computerErrorRuntimeUntrusted    = "COMPUTER_USE_RUNTIME_UNTRUSTED"
	computerErrorRuntimeProofMissing = "COMPUTER_USE_RUNTIME_PROOF_MISSING"
	computerErrorRuntimeProofInvalid = "COMPUTER_USE_RUNTIME_PROOF_INVALID"
	computerErrorRuntimeProofUnwired = "COMPUTER_USE_RUNTIME_PROOF_UNWIRED"
	computerErrorStateUnavailable    = "COMPUTER_USE_STATE_UNAVAILABLE"
	computerErrorClosed              = "COMPUTER_USE_CLOSED"
	computerErrorAccessDenied        = "COMPUTER_USE_ACCESS_DENIED"
	computerErrorCommandFailed       = "COMPUTER_USE_COMMAND_FAILED"
	computerErrorInvalidArgument     = "COMPUTER_USE_INVALID_ARGUMENT"
	computerErrorUnsupportedAction   = "COMPUTER_USE_UNSUPPORTED_ACTION"
	computerErrorNoObservation       = "COMPUTER_USE_NO_OBSERVATION"
	computerErrorStaleObservation    = "COMPUTER_USE_STALE_OBSERVATION"
	computerErrorStaleRef            = "COMPUTER_USE_STALE_REF"
	computerErrorTargetUnavailable   = "COMPUTER_USE_TARGET_UNAVAILABLE"
	computerErrorTargetChanged       = "COMPUTER_USE_TARGET_CHANGED"
	computerErrorProtocol            = "COMPUTER_USE_PROTOCOL_ERROR"
	computerErrorOutputLimit         = "COMPUTER_USE_OUTPUT_LIMIT"
	computerErrorTimeout             = "COMPUTER_USE_TIMEOUT"
)

const (
	computerDeliveryUnknown      = "unknown"
	computerDeliveryNotDelivered = "not_delivered"
	computerDeliveryUncertain    = "delivery_uncertain"
	computerDeliveryUnverified   = "delivered_unverified"
	computerDeliveryVerified     = "delivered_verified"
	computerRetryUnknown         = "unknown"
	computerRetrySafe            = "safe"
	computerRetryUnsafe          = "unsafe"
	computerEffectDone           = "done"
	computerEffectSmallChange    = "small_change"
	computerEffectNoEffect       = "no_effect"
	computerEffectPlaceChanged   = "place_changed"
	computerEffectUnknown        = "unknown"
	computerTreeQualityGood      = "good"
	computerTreeQualityPartial   = "partial"
	computerTreeQualityUnusable  = "unusable"
)

var (
	// v1.3.1 validates a snapshot id as 3-64 ASCII letters, digits, '-' or '_'
	// and a ref as @<snapshot_id>:e<digits>. The driver additionally requires
	// every ref prefix to equal the snapshot id it just observed.
	computerRefPattern      = regexp.MustCompile(`^@[A-Za-z0-9_-]{3,64}:e[0-9]{1,10}$`)
	computerSnapshotPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{3,64}$`)
)

// computerDriverAPI is deliberately narrow and package-private. Status and
// Observe are read-only; Act is the only GUI mutation; Close releases the
// driver-owned state root and must be called exactly once by the owner.
type computerDriverAPI interface {
	Status(ctx context.Context) (computerStatus, error)
	Observe(ctx context.Context, target computerTarget) (computerObservation, error)
	Act(ctx context.Context, action computerAction) (computerActionResult, error)
	Close() error
}

type computerDriver struct {
	binaryPath   string
	stateRoot    string
	stateInfo    os.FileInfo
	sessionID    string
	runtimeProof string
	environment  []string

	mu     sync.Mutex
	closed bool
	latest *computerObservation
}

var _ computerDriverAPI = (*computerDriver)(nil)

// computerDriverError carries only stable codes. Raw stdout/stderr, native
// messages, app text, paths, and caller identifiers never reach Error().
type computerDriverError struct {
	Code      string
	AgentCode string
	AgentKind string
	Delivery  string
	Retry     string
	Sent      bool
	Cause     error
}

func (e *computerDriverError) Error() string { return e.Code }
func (e *computerDriverError) Unwrap() error { return e.Cause }

type computerStatus struct {
	// PermissionsReady reports only that the CLI sees Accessibility granted
	// and a window surface. It is not a signed AX or product-availability
	// claim.
	PermissionsReady    bool
	AgentDesktopVersion string
	Accessibility       string
	SessionID           string
	RuntimeProof        string
}

type computerTarget struct {
	App      string
	WindowID string
}

type computerWindow struct {
	ID              string
	PID             int
	ProcessInstance string
	Title           string
}

type computerElement struct {
	Depth       int
	Role        string
	Name        string
	Value       string
	Description string
	Ref         string
}

type computerObservation struct {
	ID          string
	Target      computerTarget
	Window      computerWindow
	SnapshotID  string
	TreeQuality string
	Truncated   bool
	// Actable is false when identity_unproven forced a read-only tree. Such an
	// observation is never stored and all element refs are cleared.
	Actable  bool
	Elements []computerElement

	// refs is the exact set of actionable refs from this observation. It is
	// never exposed; Act checks the caller's ref against this set.
	refs map[string]struct{}
}

func (o *computerObservation) public() computerObservation {
	copy := *o
	copy.Elements = append([]computerElement(nil), o.Elements...)
	copy.refs = nil
	return copy
}

type computerActionKind string

const (
	computerActionClick computerActionKind = "click"
	computerActionType  computerActionKind = "type"
)

type computerAction struct {
	ObservationID string
	Kind          computerActionKind
	Ref           string
	Text          string
}

type computerActionResult struct {
	Action      string
	Sent        bool
	Accepted    bool
	Delivery    string
	Retry       string
	Effect      string
	EffectError string
	Surfaces    []string
	AgentCode   string
	AgentKind   string
}

// Authority contract: Act performs one action on the caller-supplied context.
// The future executor owns the live-task, grant, pause/stop, toolCallId/turnId
// binding, risk and approval checks. This driver models no rival approval
// layer; it enforces only the ref, target identity, resource and no-retry
// fences. Cancel the context on pause, stop, expiry, or task end.

type computerCommandResult struct {
	stdout   []byte
	exitCode int
	started  bool
}

type cliEnvelope struct {
	Version string          `json:"version"`
	OK      bool            `json:"ok"`
	Command string          `json:"command"`
	Data    json.RawMessage `json:"data"`
	Error   *cliError       `json:"error"`
}

type cliError struct {
	Code        string          `json:"code"`
	Disposition *cliDisposition `json:"disposition"`
	Details     json.RawMessage `json:"details"`
}

type cliDisposition struct {
	Delivery string `json:"delivery"`
	Retry    string `json:"retry"`
}

// cliSurfaceInfo is the bounded overlay report an action can carry. Only the
// stable kind is retained; ids and item counts are not needed here.
type cliSurfaceInfo struct {
	Type string `json:"type"`
}

type cliPermissionState struct {
	State string `json:"state"`
}

type cliPermissionReport struct {
	Accessibility cliPermissionState `json:"accessibility"`
}

type cliStatusData struct {
	Platform          string              `json:"platform"`
	Version           string              `json:"version"`
	Permissions       cliPermissionReport `json:"permissions"`
	SessionID         *string             `json:"session_id"`
	Tracing           bool                `json:"tracing"`
	SupportedSurfaces []string            `json:"supported_surfaces"`
	StateRoot         string              `json:"state_root"`
}

type cliWindow struct {
	ID              string  `json:"id"`
	Title           string  `json:"title"`
	PID             int     `json:"pid"`
	ProcessInstance *string `json:"process_instance"`
	Accessible      *bool   `json:"accessible"`
}

type cliSnapshotData struct {
	App              string             `json:"app"`
	SnapshotID       string             `json:"snapshot_id"`
	RefCount         int                `json:"ref_count"`
	Complete         *bool              `json:"complete"`
	Tree             *cliNode           `json:"tree"`
	Window           *cliSnapshotWindow `json:"window"`
	Truncated        bool               `json:"truncated"`
	IdentityUnproven bool               `json:"identity_unproven"`
}

type cliSnapshotWindow struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type cliNode struct {
	Role             string          `json:"role"`
	Name             string          `json:"name"`
	Value            json.RawMessage `json:"value"`
	Description      string          `json:"description"`
	RefID            string          `json:"ref_id"`
	ChildrenCount    int             `json:"children_count"`
	SubtreeTruncated bool            `json:"subtree_truncated"`
	Children         []cliNode       `json:"children"`
}

type runtimeManifest struct {
	SchemaVersion int    `json:"schema_version"`
	Application   string `json:"application"`
	Target        string `json:"target"`
	RuntimeArch   string `json:"runtime_arch"`
	Versions      struct {
		AgentDesktop string `json:"agent_desktop"`
	} `json:"versions"`
	Files []struct {
		Path   string `json:"path"`
		SHA256 string `json:"sha256"`
	} `json:"files"`
}

type computerRuntimeProofKind int

const (
	// Zero value is deliberately missing: no proof, no driver.
	computerRuntimeProofMissing computerRuntimeProofKind = iota
	// Prepared is the only supported boundary: the runtime manifest and its
	// file hashes, as produced by scripts/desktop-resources.mjs. It is the
	// fake-tested candidate and makes no code-signature or signed-AX claim.
	computerRuntimeProofPrepared
	// Signed is recognized but fail-closed until the existing verified
	// installer/build path can hand the driver a signed proof.
	computerRuntimeProofSigned
)

// computerRuntimeProof is supplied by trusted app/release code, never by the
// renderer or model. Do not compute a proof from the candidate at runtime.
type computerRuntimeProof struct {
	Kind computerRuntimeProofKind
}

// newComputerDriverDarwin constructs the private driver. Both roots must come
// from trusted application code, never from the renderer, model, or user input.
// The runtime proof is explicit; a missing or invalid proof blocks construction.
// The state root is created owner-only and removed by Close.
func newComputerDriverDarwin(runtimeRoot, stateParent string, proof computerRuntimeProof) (*computerDriver, error) {
	runtimeRoot, err := cleanAbsolutePath(runtimeRoot)
	if err != nil {
		return nil, err
	}
	stateParent, err = cleanAbsolutePath(stateParent)
	if err != nil {
		return nil, err
	}
	if pathWithin(runtimeRoot, stateParent) {
		return nil, invalidArgument()
	}
	binaryPath, helperPath, proofLabel, err := verifyComputerRuntime(runtimeRoot, proof)
	if err != nil {
		return nil, err
	}
	if err := verifySandboxExec(); err != nil {
		return nil, err
	}
	sessionID, err := randomIdentifier("linksense-", 16)
	if err != nil {
		return nil, stateUnavailable()
	}
	stateRoot, stateInfo, err := createPrivateStateDir(stateParent)
	if err != nil {
		return nil, err
	}
	if pathsOverlap(runtimeRoot, stateRoot) {
		_ = removeCreatedStateDirectory(stateRoot, stateInfo)
		return nil, invalidArgument()
	}
	return &computerDriver{
		binaryPath:   binaryPath,
		stateRoot:    stateRoot,
		stateInfo:    stateInfo,
		sessionID:    sessionID,
		runtimeProof: proofLabel,
		environment: []string{
			"AGENT_DESKTOP_HOME=" + stateRoot,
			"AGENT_DESKTOP_MACOS_HELPER_PATH=" + helperPath,
			// AGENT_DESKTOP_HOME is the documented state root; HOME is set too
			// so no incidental fallback can reach the real ~/.agent-desktop.
			"HOME=" + stateRoot,
		},
	}, nil
}

// createPrivateStateDir creates a fresh child under the host-owned parent and
// pins its device/inode. The driver never adopts an existing directory and
// Close cleans only this exact child.
func createPrivateStateDir(parent string) (string, os.FileInfo, error) {
	info, err := os.Lstat(parent)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 ||
		info.Mode().Perm()&0o022 != 0 {
		return "", nil, stateUnavailable()
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != uint32(os.Getuid()) {
		return "", nil, stateUnavailable()
	}
	root, err := os.MkdirTemp(parent, "computer-use-")
	if err != nil {
		return "", nil, stateUnavailable()
	}
	fail := func() (string, os.FileInfo, error) {
		_ = os.RemoveAll(root)
		return "", nil, stateUnavailable()
	}
	if err := os.Chmod(root, 0o700); err != nil {
		return fail()
	}
	child, err := os.Lstat(root)
	if err != nil || !child.IsDir() || child.Mode()&os.ModeSymlink != 0 || child.Mode().Perm() != 0o700 {
		return fail()
	}
	childStat, ok := child.Sys().(*syscall.Stat_t)
	if !ok || childStat.Uid != uint32(os.Getuid()) {
		return fail()
	}
	return root, child, nil
}

func cleanAbsolutePath(path string) (string, error) {
	if path == "" || !filepath.IsAbs(path) {
		return "", invalidArgument()
	}
	return filepath.Clean(path), nil
}

func pathsOverlap(a, b string) bool {
	return pathWithin(a, b) || pathWithin(b, a)
}

func pathWithin(parent, child string) bool {
	rel, err := filepath.Rel(parent, child)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

func verifySandboxExec() error {
	info, err := os.Lstat(computerSandboxExec)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 ||
		info.Mode().Perm()&0o022 != 0 || info.Mode().Perm()&0o111 == 0 {
		return driverError(computerErrorSandboxUnavailable)
	}
	return nil
}

func verifyComputerRuntime(runtimeRoot string, proof computerRuntimeProof) (string, string, string, error) {
	if proof.Kind == computerRuntimeProofMissing {
		return "", "", "", driverError(computerErrorRuntimeProofMissing)
	}
	info, err := os.Lstat(runtimeRoot)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o022 != 0 {
		return "", "", "", runtimeUntrusted()
	}
	binDir := filepath.Join(runtimeRoot, "bin")
	binInfo, err := os.Lstat(binDir)
	if err != nil || !binInfo.IsDir() || binInfo.Mode()&os.ModeSymlink != 0 || binInfo.Mode().Perm()&0o022 != 0 {
		return "", "", "", runtimeUntrusted()
	}
	manifestBytes, err := readBoundedRegularFile(filepath.Join(runtimeRoot, "manifest.json"), computerMaxRuntimeManifestBytes)
	if err != nil {
		return "", "", "", runtimeUntrusted()
	}
	var manifest runtimeManifest
	if err := decodeSingleJSON(manifestBytes, &manifest); err != nil {
		return "", "", "", runtimeUntrusted()
	}
	if !validRuntimeManifest(manifest) {
		return "", "", "", runtimeUntrusted()
	}
	expected := map[string]string{computerBinaryRel: "", computerHelperRel: ""}
	for _, file := range manifest.Files {
		if _, ok := expected[file.Path]; !ok {
			continue
		}
		if expected[file.Path] != "" {
			return "", "", "", runtimeUntrusted()
		}
		expected[file.Path] = file.SHA256
	}
	binaryPath := filepath.Join(runtimeRoot, filepath.FromSlash(computerBinaryRel))
	helperPath := filepath.Join(runtimeRoot, filepath.FromSlash(computerHelperRel))
	for _, item := range []struct {
		path string
		rel  string
	}{
		{binaryPath, computerBinaryRel},
		{helperPath, computerHelperRel},
	} {
		if expected[item.rel] == "" || !validSHA256(expected[item.rel]) {
			return "", "", "", runtimeUntrusted()
		}
		if _, err := trustedRuntimeFile(item.path); err != nil {
			return "", "", "", err
		}
	}

	switch proof.Kind {
	case computerRuntimeProofPrepared:
		for _, item := range []struct {
			path string
			rel  string
		}{
			{binaryPath, computerBinaryRel},
			{helperPath, computerHelperRel},
		} {
			if err := verifyRuntimeFileHash(item.path, expected[item.rel]); err != nil {
				return "", "", "", err
			}
		}
		return binaryPath, helperPath, computerRuntimeProofPreparedLabel, nil
	case computerRuntimeProofSigned:
		// Existing installer/build verification is not wired here. Do not
		// invent a second signing trust chain; fail closed.
		return "", "", "", driverError(computerErrorRuntimeProofUnwired)
	default:
		return "", "", "", driverError(computerErrorRuntimeProofInvalid)
	}
}

func validRuntimeManifest(manifest runtimeManifest) bool {
	return manifest.SchemaVersion == 1 &&
		manifest.Application == computerRuntimeApplication &&
		manifest.Target == "darwin/"+goruntime.GOARCH &&
		manifest.RuntimeArch == goruntime.GOARCH &&
		manifest.Versions.AgentDesktop == computerAgentDesktopVersion
}

func validSHA256(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
}

func trustedRuntimeFile(path string) (os.FileInfo, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 ||
		info.Mode().Perm()&0o022 != 0 || info.Mode().Perm()&0o111 == 0 ||
		info.Size() <= 0 || info.Size() > computerMaxRuntimeFileBytes {
		return nil, runtimeUntrusted()
	}
	return info, nil
}

func verifyRuntimeFileHash(path, expectedHex string) error {
	expected, err := hex.DecodeString(expectedHex)
	if err != nil || len(expected) != sha256.Size {
		return runtimeUntrusted()
	}
	file, err := os.Open(path)
	if err != nil {
		return runtimeUntrusted()
	}
	defer file.Close()
	hash := sha256.New()
	written, err := io.Copy(hash, io.LimitReader(file, computerMaxRuntimeFileBytes+1))
	if err != nil || written > computerMaxRuntimeFileBytes {
		return runtimeUntrusted()
	}
	if subtle.ConstantTimeCompare(hash.Sum(nil), expected) != 1 {
		return runtimeUntrusted()
	}
	return nil
}

func readBoundedRegularFile(path string, limit int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 ||
		info.Mode().Perm()&0o022 != 0 || info.Size() < 0 || info.Size() > limit {
		return nil, errors.New("untrusted file")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || int64(len(data)) > limit {
		return nil, errors.New("untrusted file")
	}
	return data, nil
}

func randomIdentifier(prefix string, size int) (string, error) {
	buf := make([]byte, size)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return prefix + hex.EncodeToString(buf), nil
}

func (d *computerDriver) Status(ctx context.Context) (computerStatus, error) {
	if ctx == nil {
		return computerStatus{}, invalidArgument()
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		return computerStatus{}, driverError(computerErrorClosed)
	}
	if err := ctx.Err(); err != nil {
		return computerStatus{}, err
	}
	result, err := d.run(ctx, computerStatusProcessTimeout, nil, d.baseArgs("status")...)
	if err != nil {
		return computerStatus{}, err
	}
	envelope, err := decodeEnvelope(result, "status")
	if err != nil {
		return computerStatus{}, err
	}
	if !envelope.OK {
		return computerStatus{}, d.commandError(envelope)
	}
	var data cliStatusData
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		return computerStatus{}, protocolError()
	}
	return d.validateStatus(data)
}

func (d *computerDriver) validateStatus(data cliStatusData) (computerStatus, error) {
	if data.Platform != "macos" || data.Version != computerAgentDesktopVersion {
		return computerStatus{}, runtimeUntrusted()
	}
	accessibility := permissionState(data.Permissions.Accessibility.State)
	if accessibility == "" {
		return computerStatus{}, protocolError()
	}
	if data.SessionID == nil || *data.SessionID != d.sessionID || data.Tracing {
		return computerStatus{}, protocolError()
	}
	if data.StateRoot == "" || !sameDirectory(data.StateRoot, d.stateRoot) {
		return computerStatus{}, stateUnavailable()
	}
	surfaces, ok := boundedSurfaces(data.SupportedSurfaces)
	if !ok {
		return computerStatus{}, protocolError()
	}
	return computerStatus{
		PermissionsReady:    accessibility == "granted" && containsString(surfaces, "window"),
		AgentDesktopVersion: data.Version,
		Accessibility:       accessibility,
		SessionID:           d.sessionID,
		RuntimeProof:        d.runtimeProof,
	}, nil
}

func (d *computerDriver) Observe(ctx context.Context, target computerTarget) (computerObservation, error) {
	if ctx == nil {
		return computerObservation{}, invalidArgument()
	}
	if err := target.validate(); err != nil {
		return computerObservation{}, err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		return computerObservation{}, driverError(computerErrorClosed)
	}
	if err := ctx.Err(); err != nil {
		return computerObservation{}, err
	}
	// A failed refresh must not leave older refs actable.
	d.latest = nil
	observation, err := d.observeLocked(ctx, target, nil, true)
	if err != nil {
		return computerObservation{}, err
	}
	return observation.public(), nil
}

func (d *computerDriver) observeLocked(ctx context.Context, target computerTarget, expected *computerWindow, store bool) (*computerObservation, error) {
	before, err := d.resolveWindow(ctx, target)
	if err != nil {
		return nil, err
	}
	if expected != nil && !sameWindow(*expected, before) {
		return nil, targetChanged()
	}
	snapshot, err := d.snapshotWindow(ctx, target)
	if err != nil {
		return nil, err
	}
	after, err := d.resolveWindow(ctx, target)
	if err != nil {
		return nil, err
	}
	if !sameWindow(before, after) || after.ID != target.WindowID ||
		(expected != nil && !sameWindow(*expected, after)) {
		return nil, targetChanged()
	}
	observationID, err := randomIdentifier("", 16)
	if err != nil {
		return nil, stateUnavailable()
	}
	observation := &computerObservation{
		ID:          observationID,
		Target:      target,
		Window:      before,
		SnapshotID:  snapshot.snapshotID,
		TreeQuality: snapshot.quality,
		Truncated:   snapshot.truncated,
		Actable:     !snapshot.identityUnproven,
		Elements:    snapshot.elements,
	}
	// v1.3.1 refs require a positive pid and nonempty process_instance
	// (refs/refs_validate.rs), resolve only the recorded source window with
	// matching pid/generation (refs/resolve_saved_ref.rs recorded_window /
	// belongs_to_entry), and refuse a no-address entry without
	// unique_at_capture as identity_not_unique (resolve_saved_ref.rs:97-100).
	// identity_unproven means the whole-window proof was not obtained, so no
	// ref from this tree is handed back or stored as actable.
	if snapshot.identityUnproven {
		observation.TreeQuality = computerTreeQualityUnusable
		for index := range observation.Elements {
			observation.Elements[index].Ref = ""
		}
		return observation, nil
	}
	if !store {
		// A transient post-action readback is comparison evidence only. It is
		// never stored and carries no refs; future input needs a new Observe.
		observation.Actable = false
		for index := range observation.Elements {
			observation.Elements[index].Ref = ""
		}
		return observation, nil
	}
	observation.refs = snapshot.refs
	d.latest = observation
	return observation, nil
}

func sameWindow(left, right computerWindow) bool {
	return left.ID == right.ID && left.PID == right.PID &&
		left.ProcessInstance == right.ProcessInstance
}

// Act performs one click or type. Authority belongs to the caller: the future
// executor must have a live task/grant and must cancel ctx on pause, stop,
// expiry, or task end. The driver enforces only ref provenance, target
// identity, Accessibility, resource caps, one action and at most one
// post-action readback; it never retries.
func (d *computerDriver) Act(ctx context.Context, action computerAction) (computerActionResult, error) {
	result := computerActionResult{Delivery: computerDeliveryUnknown, Retry: computerRetryUnknown, Effect: computerEffectUnknown}
	if action.Kind == computerActionClick || action.Kind == computerActionType {
		result.Action = string(action.Kind)
	}
	if ctx == nil {
		return result, invalidArgument()
	}
	if err := action.validate(); err != nil {
		return result, err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		return result, driverError(computerErrorClosed)
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	observation := d.latest
	if observation == nil {
		return result, driverError(computerErrorNoObservation)
	}
	if action.ObservationID != observation.ID {
		return result, driverError(computerErrorStaleObservation)
	}
	if !strings.HasPrefix(action.Ref, "@"+observation.SnapshotID+":") {
		return result, driverError(computerErrorStaleRef)
	}
	if _, ok := observation.refs[action.Ref]; !ok {
		return result, driverError(computerErrorStaleRef)
	}

	window, err := d.resolveWindow(ctx, observation.Target)
	if err != nil {
		d.latest = nil
		if isTargetGone(err) {
			return result, targetChanged()
		}
		return result, err
	}
	if window.ID != observation.Window.ID || window.PID != observation.Window.PID ||
		window.ProcessInstance != observation.Window.ProcessInstance {
		d.latest = nil
		return result, targetChanged()
	}
	// Accessibility and target identity are checked immediately before input.
	if err := d.requireAccessibility(ctx); err != nil {
		d.latest = nil
		return result, err
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}

	args := d.baseArgs(string(action.Kind), action.Ref, "--timeout-ms="+strconv.Itoa(computerActionTimeoutMS))
	var stdin []byte
	if action.Kind == computerActionType {
		args = d.baseArgs("type", action.Ref, "--stdin", "--timeout-ms="+strconv.Itoa(computerActionTimeoutMS))
		stdin = []byte(action.Text)
	}
	// From here on the pre-action observation is never reused. One action is
	// sent; the post-observe below is read-only and never a retry.
	d.latest = nil
	command, err := d.run(ctx, computerActionProcessTimeout, stdin, args...)
	result.Sent = command.started
	if !command.started {
		result.Delivery = computerDeliveryNotDelivered
		result.Retry = computerRetrySafe
		return result, err
	}

	var actionErr error
	if err != nil {
		actionErr = err
	} else {
		envelope, decodeErr := decodeEnvelope(command, string(action.Kind))
		switch {
		case decodeErr != nil:
			actionErr = decodeErr
		case envelope.OK:
			delivery, retry, surfaces, dispositionErr := actionReport(envelope.Data, string(action.Kind))
			if dispositionErr != nil {
				actionErr = dispositionErr
			} else {
				result.Accepted = true
				result.Delivery, result.Retry = delivery, retry
				result.Surfaces = surfaces
			}
		default:
			result.AgentCode, result.AgentKind = stableCLICode(envelope.Error), cliErrorKind(envelope.Error)
			delivery, retry, dispositionErr := errorDisposition(envelope)
			if dispositionErr != nil {
				actionErr = dispositionErr
			} else {
				result.Delivery, result.Retry = delivery, retry
				actionErr = actionCommandError(result)
			}
		}
	}

	// A reported overlay means the window tree behind it is the wrong target.
	// This slice does not observe overlay surfaces, so it returns place_changed
	// and does not hand back actable window refs.
	if len(result.Surfaces) > 0 {
		result.Effect = computerEffectPlaceChanged
		return result, actionErr
	}
	// Accepted verified and unverified actions each get exactly one transient
	// same-window readback while the caller's context is live. The projection is
	// comparison evidence only: it is never stored, never returned, and carries
	// no executable refs. The original disposition and retry stay unchanged.
	// Errors and non-delivery get no readback. Future input needs a new Observe.
	if postActionReadback(result) && ctx.Err() == nil {
		post, postErr := d.observeLocked(ctx, observation.Target, &observation.Window, false)
		if postErr == nil {
			if post.TreeQuality != computerTreeQualityUnusable {
				result.Effect = classifyEffect(observation, post, action)
			}
		} else {
			result.EffectError = driverErrorCode(postErr)
			if isTargetGone(postErr) {
				result.Effect = computerEffectPlaceChanged
			}
		}
	}
	if command.started {
		actionErr = markActionErrorSent(actionErr)
	}
	return result, actionErr
}

func postActionReadback(result computerActionResult) bool {
	if !result.Accepted {
		return false
	}
	return result.Delivery == computerDeliveryVerified ||
		result.Delivery == computerDeliveryUnverified
}

func (d *computerDriver) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		return nil
	}
	d.closed = true
	d.latest = nil
	return removeCreatedStateDirectory(d.stateRoot, d.stateInfo)
}

func (d *computerDriver) baseArgs(command string, rest ...string) []string {
	args := make([]string, 0, 2+len(rest)+1)
	args = append(args, "--session", d.sessionID, command)
	return append(args, rest...)
}

func sandboxExecArgs(binary string, args []string) []string {
	result := make([]string, 0, 4+len(args))
	result = append(result, "-p", computerSandboxProfile, "--", binary)
	return append(result, args...)
}

func (d *computerDriver) run(ctx context.Context, timeout time.Duration, stdin []byte, args ...string) (computerCommandResult, error) {
	var result computerCommandResult
	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	if err := execCtx.Err(); err != nil {
		return result, err
	}
	command := exec.CommandContext(execCtx, computerSandboxExec, sandboxExecArgs(d.binaryPath, args)...)
	command.Env = d.environment
	command.Dir = d.stateRoot
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	command.Cancel = func() error {
		if command.Process == nil {
			return os.ErrProcessDone
		}
		if err := syscall.Kill(-command.Process.Pid, syscall.SIGKILL); err != nil {
			if errors.Is(err, syscall.ESRCH) {
				return os.ErrProcessDone
			}
			return err
		}
		return nil
	}
	command.WaitDelay = computerTerminationWait
	if stdin != nil {
		command.Stdin = bytes.NewReader(stdin)
	}
	stdout := &limitedBuffer{limit: computerMaxStdoutBytes}
	stderr := &limitedBuffer{limit: computerMaxStderrBytes}
	command.Stdout = stdout
	command.Stderr = stderr

	// Run is Start+Wait exactly once. CommandContext cancels by killing the
	// whole process group; WaitDelay bounds pipe closure. No command or state
	// cleanup proceeds while this wait is unresolved.
	waitErr := command.Run()
	if command.ProcessState != nil {
		result.started = true
		result.exitCode = command.ProcessState.ExitCode()
	}
	if stdout.overflow || stderr.overflow {
		return result, driverError(computerErrorOutputLimit)
	}
	if ctxErr := ctx.Err(); ctxErr != nil {
		return result, ctxErr
	}
	if execCtx.Err() != nil {
		return result, &computerDriverError{Code: computerErrorTimeout, Cause: context.DeadlineExceeded}
	}
	if !result.started {
		return result, driverError(computerErrorSandboxUnavailable)
	}
	if waitErr != nil {
		var exitErr *exec.ExitError
		if !errors.As(waitErr, &exitErr) {
			return result, commandFailed()
		}
		if result.exitCode < 0 || result.exitCode > 2 {
			if len(stdout.bytes()) == 0 {
				return result, sandboxUnavailable()
			}
			return result, commandFailed()
		}
	}
	result.stdout = stdout.bytes()
	return result, nil
}

func (d *computerDriver) commandError(envelope *cliEnvelope) error {
	if envelope.Error == nil {
		return protocolError()
	}
	code := stableCLICode(envelope.Error)
	kind := cliErrorKind(envelope.Error)
	if envelope.Error.Code == "PERM_DENIED" {
		return &computerDriverError{Code: computerErrorAccessDenied, AgentCode: code, AgentKind: kind}
	}
	delivery, retry, err := errorDisposition(envelope)
	if err != nil {
		return err
	}
	return &computerDriverError{Code: computerErrorCommandFailed, AgentCode: code, AgentKind: kind, Delivery: delivery, Retry: retry}
}

// requireAccessibility uses permissions without --request/--guide. In v1.3.1
// crates/core/src/commands/permissions.rs returns the precomputed report on
// that path; only --request spawns the bounded helper. Status passes both
// false too, so neither command path can spawn a permission helper.
func (d *computerDriver) requireAccessibility(ctx context.Context) error {
	command, err := d.run(ctx, computerPermissionsProcessTimeout, nil, d.baseArgs("permissions")...)
	if err != nil {
		return err
	}
	envelope, err := decodeEnvelope(command, "permissions")
	if err != nil {
		return err
	}
	if !envelope.OK {
		return d.commandError(envelope)
	}
	var data cliPermissionReport
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		return protocolError()
	}
	state := permissionState(data.Accessibility.State)
	if state == "" {
		return protocolError()
	}
	if state != "granted" {
		return driverError(computerErrorAccessDenied)
	}
	return nil
}

func (d *computerDriver) resolveWindow(ctx context.Context, target computerTarget) (computerWindow, error) {
	command, err := d.run(ctx, computerListWindowsProcessTimeout, nil,
		d.baseArgs("list-windows", "--app="+target.App, "--timeout-ms="+strconv.Itoa(computerListWindowsTimeoutMS))...)
	if err != nil {
		return computerWindow{}, err
	}
	envelope, err := decodeEnvelope(command, "list-windows")
	if err != nil {
		return computerWindow{}, err
	}
	if !envelope.OK {
		if envelope.Error != nil && (envelope.Error.Code == "APP_NOT_FOUND" || envelope.Error.Code == "WINDOW_NOT_FOUND") {
			return computerWindow{}, driverError(computerErrorTargetUnavailable)
		}
		return computerWindow{}, d.commandError(envelope)
	}
	var windows []cliWindow
	if err := json.Unmarshal(envelope.Data, &windows); err != nil {
		return computerWindow{}, protocolError()
	}
	var found *cliWindow
	for index := range windows {
		window := windows[index]
		if window.ID == "" {
			continue
		}
		if window.ID == target.WindowID {
			if found != nil {
				return computerWindow{}, protocolError()
			}
			found = &window
		}
	}
	if found == nil {
		return computerWindow{}, driverError(computerErrorTargetUnavailable)
	}
	if found.PID <= 0 || found.ProcessInstance == nil || *found.ProcessInstance == "" {
		return computerWindow{}, protocolError()
	}
	if found.Accessible != nil && !*found.Accessible {
		return computerWindow{}, driverError(computerErrorTargetUnavailable)
	}
	return computerWindow{
		ID:              found.ID,
		PID:             found.PID,
		ProcessInstance: *found.ProcessInstance,
		Title:           boundedText(found.Title, computerMaxNameBytes),
	}, nil
}

type parsedSnapshot struct {
	snapshotID       string
	elements         []computerElement
	refs             map[string]struct{}
	truncated        bool
	identityUnproven bool
	quality          string
}

func (d *computerDriver) snapshotWindow(ctx context.Context, target computerTarget) (parsedSnapshot, error) {
	command, err := d.run(ctx, computerSnapshotProcessTimeout, nil,
		d.baseArgs("snapshot",
			"--app="+target.App,
			"--window-id="+target.WindowID,
			"--interactive-only",
			"--compact",
			"--max-depth="+strconv.Itoa(computerMaxObservationDepth),
			"--timeout-ms="+strconv.Itoa(computerSnapshotTimeoutMS))...)
	if err != nil {
		return parsedSnapshot{}, err
	}
	envelope, err := decodeEnvelope(command, "snapshot")
	if err != nil {
		return parsedSnapshot{}, err
	}
	if !envelope.OK {
		if envelope.Error != nil && (envelope.Error.Code == "APP_NOT_FOUND" || envelope.Error.Code == "WINDOW_NOT_FOUND") {
			return parsedSnapshot{}, driverError(computerErrorTargetUnavailable)
		}
		return parsedSnapshot{}, d.commandError(envelope)
	}
	var data cliSnapshotData
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		return parsedSnapshot{}, protocolError()
	}
	if data.Complete == nil || data.Tree == nil || data.Window == nil {
		return parsedSnapshot{}, protocolError()
	}
	if !computerSnapshotPattern.MatchString(data.SnapshotID) || data.RefCount < 0 {
		return parsedSnapshot{}, protocolError()
	}
	if data.Window.ID != target.WindowID {
		return parsedSnapshot{}, targetChanged()
	}
	if data.App == "" {
		return parsedSnapshot{}, protocolError()
	}
	elements, refs, textTruncated, err := flattenSnapshot(data.Tree, data.SnapshotID)
	if err != nil {
		return parsedSnapshot{}, err
	}
	truncated := data.Truncated || textTruncated || !*data.Complete
	quality := computerTreeQualityGood
	if !*data.Complete || truncated || data.IdentityUnproven {
		quality = computerTreeQualityPartial
	}
	return parsedSnapshot{
		snapshotID:       data.SnapshotID,
		elements:         elements,
		refs:             refs,
		truncated:        truncated,
		identityUnproven: data.IdentityUnproven,
		quality:          quality,
	}, nil
}

func flattenSnapshot(root *cliNode, snapshotID string) ([]computerElement, map[string]struct{}, bool, error) {
	if root == nil || strings.TrimSpace(root.Role) == "" {
		return nil, nil, false, protocolError()
	}
	elements := make([]computerElement, 0, 64)
	refs := make(map[string]struct{})
	truncated := false
	textBudget := computerMaxObservationTextBytes

	var walk func(node *cliNode, depth int) error
	walk = func(node *cliNode, depth int) error {
		if node == nil {
			return protocolError()
		}
		if depth > computerMaxObservationDepth || len(elements) >= computerMaxObservationElements {
			truncated = true
			return nil
		}
		role := sanitizeText(node.Role, computerMaxRoleBytes, &textBudget, &truncated)
		if role == "" {
			role = "unknown"
			truncated = true
		}
		ref := ""
		if node.RefID != "" {
			if !computerRefPattern.MatchString(node.RefID) || !strings.HasPrefix(node.RefID, "@"+snapshotID+":") {
				return protocolError()
			}
			if _, exists := refs[node.RefID]; exists {
				return protocolError()
			}
			refs[node.RefID] = struct{}{}
			ref = node.RefID
		}
		value, _ := scalarValue(node.Value)
		element := computerElement{
			Depth:       depth,
			Role:        role,
			Name:        sanitizeText(node.Name, computerMaxNameBytes, &textBudget, &truncated),
			Value:       sanitizeText(value, computerMaxValueBytes, &textBudget, &truncated),
			Description: sanitizeText(node.Description, computerMaxDescriptionBytes, &textBudget, &truncated),
			Ref:         ref,
		}
		if node.SubtreeTruncated || node.ChildrenCount > len(node.Children) {
			truncated = true
		}
		elements = append(elements, element)
		for index := range node.Children {
			if err := walk(&node.Children[index], depth+1); err != nil {
				return err
			}
		}
		return nil
	}
	if err := walk(root, 0); err != nil {
		return nil, nil, false, err
	}
	return elements, refs, truncated, nil
}

func decodeEnvelope(result computerCommandResult, expectedCommand string) (*cliEnvelope, error) {
	if result.exitCode < 0 || result.exitCode > 2 || len(result.stdout) == 0 {
		return nil, protocolError()
	}
	var envelope cliEnvelope
	if err := decodeSingleJSON(result.stdout, &envelope); err != nil {
		return nil, protocolError()
	}
	if envelope.Version != computerEnvelopeVersion || envelope.Command != expectedCommand {
		return nil, protocolError()
	}
	if envelope.OK {
		if envelope.Error != nil || len(bytes.TrimSpace(envelope.Data)) == 0 ||
			bytes.Equal(bytes.TrimSpace(envelope.Data), []byte("null")) {
			return nil, protocolError()
		}
		return &envelope, nil
	}
	if envelope.Error == nil || envelope.Error.Code == "" {
		return nil, protocolError()
	}
	return &envelope, nil
}

func decodeSingleJSON(data []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	if err := decoder.Decode(value); err != nil {
		return err
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errors.New("trailing JSON")
	}
	return nil
}

func actionReport(data json.RawMessage, expectedAction string) (string, string, []string, error) {
	var report struct {
		Action      string           `json:"action"`
		Disposition *cliDisposition  `json:"disposition"`
		Surfaces    []cliSurfaceInfo `json:"surfaces"`
	}
	if err := json.Unmarshal(data, &report); err != nil || report.Disposition == nil ||
		report.Action != expectedAction {
		return computerDeliveryUnknown, computerRetryUnknown, nil, protocolError()
	}
	// ActionResult only deserializes these three on success.
	switch report.Disposition.Delivery {
	case computerDeliveryNotDelivered, computerDeliveryUnverified, computerDeliveryVerified:
	default:
		return computerDeliveryUnknown, computerRetryUnknown, nil, protocolError()
	}
	if !validDisposition(report.Disposition.Delivery, report.Disposition.Retry) {
		return computerDeliveryUnknown, computerRetryUnknown, nil, protocolError()
	}
	if len(report.Surfaces) > computerMaxSupportedSurfaces {
		return computerDeliveryUnknown, computerRetryUnknown, nil, protocolError()
	}
	surfaces := make([]string, 0, len(report.Surfaces))
	for _, surface := range report.Surfaces {
		kind := stableToken(surface.Type)
		if kind == "" || len(kind) > computerMaxSurfaceBytes {
			return computerDeliveryUnknown, computerRetryUnknown, nil, protocolError()
		}
		surfaces = append(surfaces, kind)
	}
	return report.Disposition.Delivery, report.Disposition.Retry, surfaces, nil
}

func errorDisposition(envelope *cliEnvelope) (string, string, error) {
	if envelope.Error == nil || envelope.Error.Disposition == nil {
		return computerDeliveryUnknown, computerRetryUnknown, protocolError()
	}
	if !validDisposition(envelope.Error.Disposition.Delivery, envelope.Error.Disposition.Retry) {
		return computerDeliveryUnknown, computerRetryUnknown, protocolError()
	}
	return envelope.Error.Disposition.Delivery, envelope.Error.Disposition.Retry, nil
}

func validDisposition(delivery, retry string) bool {
	switch delivery {
	case computerDeliveryNotDelivered:
		return retry == computerRetrySafe
	case computerDeliveryUnknown:
		return retry == computerRetryUnknown
	case computerDeliveryUncertain, computerDeliveryUnverified, computerDeliveryVerified:
		return retry == computerRetryUnsafe
	default:
		return false
	}
}

func stableCLICode(error *cliError) string {
	if error == nil {
		return ""
	}
	return stableToken(error.Code)
}

func cliErrorKind(error *cliError) string {
	if error == nil || len(error.Details) == 0 {
		return ""
	}
	var details struct {
		Kind string `json:"kind"`
	}
	if json.Unmarshal(error.Details, &details) != nil {
		return ""
	}
	return stableToken(details.Kind)
}

func stableToken(value string) string {
	if value == "" || len(value) > 96 {
		return ""
	}
	for index := 0; index < len(value); index++ {
		char := value[index]
		if !(char >= 'A' && char <= 'Z') && !(char >= 'a' && char <= 'z') &&
			!(char >= '0' && char <= '9') && char != '-' && char != '_' {
			return ""
		}
	}
	return value
}

func permissionState(value string) string {
	switch value {
	case "granted", "denied", "not_required", "unknown":
		return value
	default:
		return ""
	}
}

func boundedSurfaces(surfaces []string) ([]string, bool) {
	if len(surfaces) > computerMaxSupportedSurfaces {
		return nil, false
	}
	result := make([]string, 0, len(surfaces))
	for _, surface := range surfaces {
		if len(surface) == 0 || len(surface) > computerMaxSurfaceBytes || stableToken(surface) == "" {
			return nil, false
		}
		result = append(result, surface)
	}
	return result, true
}

func containsString(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

func (t computerTarget) validate() error {
	if !validAppName(t.App) || !validWindowID(t.WindowID) {
		return invalidArgument()
	}
	return nil
}

func validAppName(value string) bool {
	if value == "" || len(value) > computerMaxAppBytes || strings.TrimSpace(value) == "" || !utf8.ValidString(value) {
		return false
	}
	for _, char := range value {
		if char == 0 || char < 0x20 || char == 0x7f {
			return false
		}
	}
	return true
}

func validWindowID(value string) bool {
	if value == "" || len(value) > computerMaxWindowIDBytes {
		return false
	}
	for index := 0; index < len(value); index++ {
		if value[index] < 0x21 || value[index] > 0x7e {
			return false
		}
	}
	return true
}

func (a computerAction) validate() error {
	if !validObservationID(a.ObservationID) {
		return invalidArgument()
	}
	switch a.Kind {
	case computerActionClick:
		if a.Text != "" || !computerRefPattern.MatchString(a.Ref) {
			return invalidArgument()
		}
	case computerActionType:
		if !computerRefPattern.MatchString(a.Ref) || !validActionText(a.Text) {
			return invalidArgument()
		}
	default:
		return driverError(computerErrorUnsupportedAction)
	}
	return nil
}

func validObservationID(value string) bool {
	if len(value) != 32 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func validActionText(value string) bool {
	if value == "" || len(value) > computerMaxActionTextBytes || !utf8.ValidString(value) {
		return false
	}
	for _, char := range value {
		if char == 0 {
			return false
		}
		if char < 0x20 && char != '\n' && char != '\r' && char != '\t' {
			return false
		}
		if char >= 0x7f && char <= 0x9f {
			return false
		}
	}
	return true
}

func scalarValue(raw json.RawMessage) (string, bool) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return "", false
	}
	switch raw[0] {
	case '"':
		var text string
		if json.Unmarshal(raw, &text) != nil {
			return "", false
		}
		return text, true
	case '{', '[':
		return "", false
	default:
		return string(raw), true
	}
}

func sanitizeText(value string, maxBytes int, budget *int, truncated *bool) string {
	if value == "" || maxBytes <= 0 || *budget <= 0 {
		if value != "" {
			*truncated = true
		}
		return ""
	}
	if !utf8.ValidString(value) {
		value = strings.ToValidUTF8(value, "�")
		*truncated = true
	}
	output := make([]byte, 0, min(len(value), maxBytes))
	for _, char := range value {
		if char == 0 || (char < 0x20 && char != '\n' && char != '\t') || (char >= 0x7f && char <= 0x9f) {
			char = ' '
			*truncated = true
		}
		size := utf8.RuneLen(char)
		if size < 0 {
			size = len(string(utf8.RuneError))
		}
		if len(output)+size > maxBytes || size > *budget {
			*truncated = true
			break
		}
		output = utf8.AppendRune(output, char)
		*budget -= size
	}
	return string(output)
}

func boundedText(value string, maxBytes int) string {
	budget := maxBytes
	truncated := false
	return sanitizeText(value, maxBytes, &budget, &truncated)
}

func observationSignature(observation *computerObservation) [32]byte {
	hash := sha256.New()
	var sizeBuffer [8]byte
	writeUint := func(value uint64) {
		binary.LittleEndian.PutUint64(sizeBuffer[:], value)
		_, _ = hash.Write(sizeBuffer[:])
	}
	writeString := func(value string) {
		writeUint(uint64(len(value)))
		_, _ = hash.Write([]byte(value))
	}
	writeString(observation.Window.Title)
	for _, element := range observation.Elements {
		writeUint(uint64(element.Depth))
		writeString(element.Role)
		writeString(element.Name)
		writeString(element.Value)
		writeString(element.Description)
	}
	var signature [32]byte
	copy(signature[:], hash.Sum(nil))
	return signature
}

func classifyEffect(before, after *computerObservation, action computerAction) string {
	if before == nil || after == nil {
		return computerEffectUnknown
	}
	if before.Window.ID != after.Window.ID || before.Window.PID != after.Window.PID ||
		before.Window.ProcessInstance != after.Window.ProcessInstance {
		return computerEffectPlaceChanged
	}
	if action.Kind == computerActionType && typedTextChanged(before, after, action.Ref, action.Text) {
		return computerEffectDone
	}
	if observationSignature(before) != observationSignature(after) {
		return computerEffectSmallChange
	}
	if before.Truncated || after.Truncated {
		return computerEffectUnknown
	}
	return computerEffectNoEffect
}

// typedTextChanged requires the action's own element to change and the new
// value to contain the typed text. Text already present in that or another
// field does not count, and an ambiguous post match is not "done".
func typedTextChanged(before, after *computerObservation, ref, text string) bool {
	if before == nil || after == nil || ref == "" || text == "" ||
		before.Truncated || after.Truncated {
		return false
	}
	pre, ok := elementByRef(before, ref)
	if !ok {
		return false
	}
	// This bounded tree carries no proven unique element id (native_id is
	// optional and not retained here), so the same field must be the only
	// role/name/description/depth match in both complete observations. Twins or
	// truncation cannot claim an exact input effect.
	if countElementsMatching(before.Elements, pre) != 1 {
		return false
	}
	var match computerElement
	matches := 0
	for _, element := range after.Elements {
		if sameElement(element, pre) {
			match = element
			matches++
		}
	}
	return matches == 1 && match.Value != pre.Value && strings.Contains(match.Value, text)
}

func countElementsMatching(elements []computerElement, target computerElement) int {
	count := 0
	for _, element := range elements {
		if sameElement(element, target) {
			count++
		}
	}
	return count
}

func elementByRef(observation *computerObservation, ref string) (computerElement, bool) {
	if observation == nil {
		return computerElement{}, false
	}
	for _, element := range observation.Elements {
		if element.Ref == ref {
			return element, true
		}
	}
	return computerElement{}, false
}

func sameElement(left, right computerElement) bool {
	return left.Depth == right.Depth && left.Role == right.Role &&
		left.Name == right.Name && left.Description == right.Description
}

func isTargetGone(err error) bool {
	var driverErr *computerDriverError
	if !errors.As(err, &driverErr) {
		return false
	}
	return driverErr.Code == computerErrorTargetUnavailable || driverErr.Code == computerErrorTargetChanged
}

func driverErrorCode(err error) string {
	var driverErr *computerDriverError
	if errors.As(err, &driverErr) {
		return driverErr.Code
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return computerErrorTimeout
	}
	return computerErrorCommandFailed
}

func sameDirectory(a, b string) bool {
	first, err := os.Stat(a)
	if err != nil {
		return false
	}
	second, err := os.Stat(b)
	if err != nil {
		return false
	}
	return os.SameFile(first, second)
}

func removeCreatedStateDirectory(root string, created os.FileInfo) error {
	info, err := os.Lstat(root)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return stateUnavailable()
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != uint32(os.Getuid()) || !os.SameFile(created, info) {
		return stateUnavailable()
	}
	if err := os.RemoveAll(root); err != nil {
		return stateUnavailable()
	}
	return nil
}

// markActionErrorSent makes a post-dispatch failure explicit to callers that
// inspect only the error: the action process started, so delivery may be
// unknown and the action must not be replayed automatically.
func markActionErrorSent(err error) error {
	if err == nil {
		return nil
	}
	var driverErr *computerDriverError
	if errors.As(err, &driverErr) {
		driverErr.Sent = true
		if driverErr.Delivery == "" {
			driverErr.Delivery = computerDeliveryUnknown
		}
		if driverErr.Retry == "" {
			driverErr.Retry = computerRetryUnknown
		}
		return err
	}
	return &computerDriverError{
		Code:     driverErrorCode(err),
		Delivery: computerDeliveryUnknown,
		Retry:    computerRetryUnknown,
		Sent:     true,
		Cause:    err,
	}
}

func driverError(code string) *computerDriverError {
	return &computerDriverError{Code: code}
}

func invalidArgument() error    { return driverError(computerErrorInvalidArgument) }
func sandboxUnavailable() error { return driverError(computerErrorSandboxUnavailable) }
func runtimeUntrusted() error   { return driverError(computerErrorRuntimeUntrusted) }
func stateUnavailable() error   { return driverError(computerErrorStateUnavailable) }
func targetChanged() error      { return driverError(computerErrorTargetChanged) }
func commandFailed() error      { return driverError(computerErrorCommandFailed) }
func protocolError() error      { return driverError(computerErrorProtocol) }

func actionCommandError(result computerActionResult) error {
	code := computerErrorCommandFailed
	if result.AgentCode == "PERM_DENIED" {
		code = computerErrorAccessDenied
	}
	return &computerDriverError{
		Code:      code,
		AgentCode: result.AgentCode,
		AgentKind: result.AgentKind,
		Delivery:  result.Delivery,
		Retry:     result.Retry,
		Sent:      true,
	}
}

type limitedBuffer struct {
	limit    int
	buffer   bytes.Buffer
	overflow bool
}

func (b *limitedBuffer) Write(data []byte) (int, error) {
	if b.overflow {
		return 0, io.ErrShortWrite
	}
	remaining := b.limit - b.buffer.Len()
	if remaining <= 0 {
		b.overflow = true
		return 0, io.ErrShortWrite
	}
	if len(data) > remaining {
		_, _ = b.buffer.Write(data[:remaining])
		b.overflow = true
		return remaining, io.ErrShortWrite
	}
	return b.buffer.Write(data)
}

func (b *limitedBuffer) bytes() []byte {
	return b.buffer.Bytes()
}
