//go:build darwin

package main

// Private macOS computer-use driver slice.
//
// Scope: inventory -> the user pins one existing accessible window -> observe
// that pinned identity -> click or type a ref from that exact observation ->
// read the effect back, or run one bounded read-only actionability wait on a
// ref from that exact observation. The product reaches this driver only through
// computer_platform_darwin.go, which builds it on demand after the user's
// select gesture, behind the platform gate. There is no direct renderer or MCP
// entry point and no startup probing. All types and the constructor are
// package-private; there is no environment, PATH, shell, or flag passthrough.
//
// Trust boundary: the caller supplies a trusted runtime root, a host-owned
// state parent, an explicit runtime proof, and the live task context. Signed
// proof delegates to the release signer-token verifier in
// macos_signing_proof_darwin.go, which checks the running .app and both fixed
// agent-desktop executables; the caller's runtime root must resolve to that
// canonical bundle runtime or construction fails closed. Developer ID signing
// rewrites executable bytes, so signed proof never falls back to prepared
// hashes. Prepared remains the fake-tested manifest-hash boundary used by
// tests only and makes no code-signature or signed-AX claim. This driver does
// not build a second signing trust chain. The driver never adopts an existing
// state directory: it creates a fresh private child and pins its device/inode.
//
// Every agent-desktop invocation is wrapped in the one fixed
// /usr/bin/sandbox-exec profile below; there is no unsandboxed fallback.
// Verified v1.3.1 default paths: status and permissions without
// --request/--guide use a precomputed report (no helper); list-windows,
// snapshot, headless click and headless type use AX/libproc only. The profile
// turns the pre-parse legacy-host SIGKILL into a no-op and denies the CLI's
// own signal paths. The process_identity kill(pid,0) fallback is denied if
// reached, and helper-spawning operations are not exposed. AX/TCC behavior
// under Seatbelt is unverified; this is a development/test-only path, not
// production-enabled, and makes no signed AX claim. Permission guidance is an
// app-UI concern for MyGo permissionflow, never the CLI's --guide.
//
// Authority contract: Act takes only the caller's context. The product executor
// gate owns the live task, grant, pause/stop, toolCallId/turnId binding and the
// single-use host authorization; this driver models no rival approval layer.
//
// Provenance and host effects (agent-desktop v1.3.1): the driver runs only
// status, permissions, list-apps, list-windows, snapshot, click, type and wait.
// It never passes --headed, --trace, --screenshot, launch, clipboard, batch, or
// arbitrary --arg/--env/--cwd/--cdp values. Inventory makes one unscoped
// list-apps call and one unscoped list-windows call, then joins an exact
// (pid, process_instance) pair to an exact bundle_id. WindowInfo has app_name
// but no bundle_id, so the bundle can only be proven by that join. Observe,
// Act, and Wait never read unscoped: every list-apps, list-windows, and
// snapshot call is scoped by the pinned bundle_id and must reproduce the
// pinned window_id, pid, and process_instance. Wait reuses the session's saved
// refmap and runs one fixed `wait --element <ref> --predicate actionable
// --timeout <ms>` invocation without --app/--window/--text/--value/--action/
// --count/--event/--menu/--notification/--timeout-ms. Its native success
// envelope carries no window or process identity, so Wait re-proves the exact
// pinned identity immediately before and after the read. The checksum-pinned
// clipboard helper is
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
	computerRuntimeProofSignedLabel   = "signed"

	computerMaxAppBytes               = 256
	computerMaxWindowIDBytes          = 128
	computerMaxProcessInstanceBytes   = 128
	computerMaxInventoryWindows       = 256
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
	computerMaxRefmapBytes            = 1 * 1024 * 1024
	computerMaxStderrBytes            = 64 * 1024
	computerListWindowsTimeoutMS      = 5000
	computerSnapshotTimeoutMS         = 5000
	computerActionTimeoutMS           = 15000
	computerWaitMinTimeoutMS          = 100
	computerWaitDefaultTimeoutMS      = 8000
	computerWaitMaxTimeoutMS          = 20000
	computerWaitProcessGrace          = 1 * time.Second
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
	// v1.3.1 validates a snapshot id as 3-64 ASCII letters, digits, '-' or '_'.
	computerSnapshotPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{3,64}$`)
)

// computerDriverAPI is deliberately narrow and package-private. Status,
// Inventory, Observe, and Wait are read-only; Act is the only GUI mutation;
// Close releases the driver-owned state root and must be called exactly once
// by the owner.
type computerDriverAPI interface {
	Status(ctx context.Context) (computerStatus, error)
	Inventory(ctx context.Context) (computerInventory, error)
	Observe(ctx context.Context, target computerTarget) (computerObservation, error)
	Wait(ctx context.Context, request computerWaitRequest) (computerWaitResult, error)
	Act(ctx context.Context, action computerAction) (computerActionResult, error)
	Invalidate()
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

// computerTarget is the complete first-use identity pin. A target without all
// four fields is invalid: Observe and Act must never fall back to a window id,
// a display name, or a fresh process lookup.
type computerTarget struct {
	BundleID        string
	WindowID        string
	PID             int
	ProcessInstance string
}

// computerWindowCandidate is one selectable window for the native selector.
// AppName and Title are display-only and stay in this process; neither is part
// of the observation handed back for a run.
type computerWindowCandidate struct {
	BundleID        string
	AppName         string
	WindowID        string
	PID             int
	ProcessInstance string
	Title           string
}

// computerInventory reports only windows whose owner was joined to an exact
// bundle_id by (pid, process_instance). Complete is false when upstream skipped
// app records, so an absent window is unknown rather than proven absent.
// Truncated is true when the candidate cap was reached.
type computerInventory struct {
	Complete   bool
	Truncated  bool
	Candidates []computerWindowCandidate
}

type computerWindow struct {
	BundleID        string
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

// elementIdentityKey is the coarse (role, depth) pair that bounds where a
// sameElement match can occur. It never carries observed text.
type elementIdentityKey struct {
	Role  string
	Depth int
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

	// Actionable elements occupy the prefix, even in a comparison-only
	// readback whose ref tokens have been cleared.
	actionableCount int
	// Ref-free context may fill the remaining budget even when all refs
	// in the native capture were projected intact.
	actionableIncomplete bool
	// ambiguousRefKeys records the (role, depth) keys of retained ref nodes
	// that an omitted or clipped ref-free candidate could also match. Such a
	// key cannot be proven unique by the retained projection alone.
	ambiguousRefKeys map[elementIdentityKey]struct{}
	// A comparison readback must use the same projection as its observation.
	interactiveOnly bool
}

func (o *computerObservation) public() computerObservation {
	copy := *o
	copy.Elements = append([]computerElement(nil), o.Elements...)
	copy.refs = nil
	copy.ambiguousRefKeys = nil
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
// The product executor gate owns the live task, grant, pause/stop,
// toolCallId/turnId binding and host authorization. This driver models no rival
// approval layer; it enforces only the ref, target identity, resource and
// no-retry fences. Cancel the context on pause, stop, expiry, or task end.

// computerWaitRequest is the fixed read-only element wait: one ref from the
// exact latest observation and a bounded timeout. The predicate is always
// actionable; no selector, app, window, text, value, action, event, or count
// is accepted from a caller.
type computerWaitRequest struct {
	ObservationID string
	Ref           string
	TimeoutMS     int
}

// computerWaitResult reports only the bounded predicate outcome. A native
// wait timeout is a normal observation (timed_out), not a driver error.
type computerWaitResult struct {
	Result   string
	WaitedMS int
}

type computerCommandResult struct {
	stdout             []byte
	exitCode           int
	started            bool
	stdoutOnlyOverflow bool
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
	AppName         string  `json:"app_name"`
	PID             int     `json:"pid"`
	ProcessInstance *string `json:"process_instance"`
	Accessible      *bool   `json:"accessible"`
	Visible         *bool   `json:"visible"`
	Minimized       *bool   `json:"minimized"`
}

// cliApp is the v1.3.1 list-apps app record. Only the identity fields are
// retained; the display name and presentation hint are not needed to join a
// window owner.
type cliApp struct {
	PID             int     `json:"pid"`
	BundleID        *string `json:"bundle_id"`
	ProcessInstance *string `json:"process_instance"`
}

type cliAppInventory struct {
	Apps     []cliApp          `json:"apps"`
	Complete *bool             `json:"complete"`
	Skipped  []json.RawMessage `json:"skipped"`
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

// cliCapturedRef is the identity-only slice of one persisted v1.3.1 RefEntry.
// RefEntry flattens RefProcess and RefSource (refs/ref_entry.rs:4-18), so
// "pid", "process_instance", and "source_window_id" are top-level entry
// fields (refs/ref_process.rs:5-10, refs/ref_source.rs:3-9). Observed text and
// display names in the same entries are deliberately not decoded.
type cliCapturedRef struct {
	PID             int     `json:"pid"`
	ProcessInstance *string `json:"process_instance"`
	SourceWindowID  *string `json:"source_window_id"`
}

// cliCapturedRefMap is the persisted RefMap envelope (refs/mod.rs:40-44).
type cliCapturedRefMap struct {
	Inner map[string]cliCapturedRef `json:"inner"`
}

// cliWaitData is the identity-only slice of the v1.3.1 element wait success
// envelope (commands/wait_element.rs:64-72). Only the bounded predicate result
// is decoded from observed: its other fields can carry captured AX text.
// Pointers distinguish absent or null evidence from a valid zero elapsed or
// false actionable value. Nothing here carries window or process identity.
type cliWaitData struct {
	Found     bool             `json:"found"`
	Ref       string           `json:"ref"`
	Predicate string           `json:"predicate"`
	Observed  *cliWaitObserved `json:"observed"`
	ElapsedMS *int64           `json:"elapsed_ms"`
}

type cliWaitObserved struct {
	Actionable *bool `json:"actionable"`
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
	// Prepared verifies the runtime manifest fields and file hashes produced
	// by scripts/desktop-resources.mjs. It exists for fixture tests only and
	// makes no code-signature or signed-AX claim. Developer ID signing rewrites
	// executable bytes and their hashes, so prepared proof must never stand in
	// for a signed release.
	computerRuntimeProofPrepared
	// Signed verifies the running .app and both fixed agent-desktop
	// executables through the release signer token, and binds the caller's
	// runtime root to that canonical bundle runtime. It fails closed and never
	// falls back to prepared hashes.
	computerRuntimeProofSigned
)

// computerRuntimeProof is supplied by trusted app/release code, never by the
// renderer or model. Do not compute a proof from the candidate at runtime.
type computerRuntimeProof struct {
	Kind computerRuntimeProofKind
}

// newComputerDriverDarwin constructs the private driver. Both roots must come
// from trusted application code, never from the renderer, model, or user input.
// The runtime proof is explicit; a missing, invalid, or unverifiable proof
// blocks construction. ctx bounds signed runtime verification and must be the
// live task context, canceled on pause, stop, expiry, or task end. The state
// root is created owner-only and removed by Close.
func newComputerDriverDarwin(ctx context.Context, runtimeRoot, stateParent string, proof computerRuntimeProof) (*computerDriver, error) {
	if ctx == nil {
		return nil, invalidArgument()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
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
	verifiedRoot, binaryPath, helperPath, proofLabel, err := verifyComputerRuntime(ctx, runtimeRoot, proof)
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
	if pathsOverlap(verifiedRoot, stateRoot) {
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

// verifyComputerRuntime validates the manifest shape, architecture, version,
// fixed executable layout, and both executable files. Prepared proof
// additionally compares the manifest hashes; that boundary is test-only.
// Signed proof delegates to the release signer-token verifier and binds the
// caller's runtime root to the canonical runtime of the running .app. It never
// falls back to prepared hashes.
func verifyComputerRuntime(ctx context.Context, runtimeRoot string, proof computerRuntimeProof) (string, string, string, string, error) {
	if proof.Kind == computerRuntimeProofMissing {
		return "", "", "", "", driverError(computerErrorRuntimeProofMissing)
	}
	info, err := os.Lstat(runtimeRoot)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o022 != 0 {
		return "", "", "", "", runtimeUntrusted()
	}
	binDir := filepath.Join(runtimeRoot, "bin")
	binInfo, err := os.Lstat(binDir)
	if err != nil || !binInfo.IsDir() || binInfo.Mode()&os.ModeSymlink != 0 || binInfo.Mode().Perm()&0o022 != 0 {
		return "", "", "", "", runtimeUntrusted()
	}
	manifestBytes, err := readBoundedRegularFile(filepath.Join(runtimeRoot, "manifest.json"), computerMaxRuntimeManifestBytes)
	if err != nil {
		return "", "", "", "", runtimeUntrusted()
	}
	var manifest runtimeManifest
	if err := decodeSingleJSON(manifestBytes, &manifest); err != nil {
		return "", "", "", "", runtimeUntrusted()
	}
	if !validRuntimeManifest(manifest) {
		return "", "", "", "", runtimeUntrusted()
	}
	expected := map[string]string{computerBinaryRel: "", computerHelperRel: ""}
	for _, file := range manifest.Files {
		if _, ok := expected[file.Path]; !ok {
			continue
		}
		if expected[file.Path] != "" {
			return "", "", "", "", runtimeUntrusted()
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
			return "", "", "", "", runtimeUntrusted()
		}
		if _, err := trustedRuntimeFile(item.path); err != nil {
			return "", "", "", "", err
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
				return "", "", "", "", err
			}
		}
		return runtimeRoot, binaryPath, helperPath, computerRuntimeProofPreparedLabel, nil
	case computerRuntimeProofSigned:
		signedBinary, signedHelper, err := verifyDesktopMacosSignedRuntime(ctx)
		if err != nil {
			return "", "", "", "", computerSignedRuntimeProofError(err)
		}
		// The verifier returns both fixed executables under
		// <current .app>/Contents/Resources/runtime/bin. Recover that canonical
		// root and require the caller's root to resolve to it, so neither an
		// alternate nor a prior install can supply the launched bytes.
		signedRoot := filepath.Dir(filepath.Dir(signedBinary))
		resolvedRoot, err := filepath.EvalSymlinks(runtimeRoot)
		if err != nil || resolvedRoot != signedRoot ||
			signedBinary != filepath.Join(signedRoot, filepath.FromSlash(computerBinaryRel)) ||
			signedHelper != filepath.Join(signedRoot, filepath.FromSlash(computerHelperRel)) {
			return "", "", "", "", runtimeUntrusted()
		}
		return signedRoot, signedBinary, signedHelper, computerRuntimeProofSignedLabel, nil
	default:
		return "", "", "", "", driverError(computerErrorRuntimeProofInvalid)
	}
}

// computerSignedRuntimeProofError maps the signer-token verifier's stable
// failures onto the driver's fail-closed proof errors. Cancellation is returned
// unchanged so callers can distinguish a stopped task from a rejected
// signature. A prepared hash check is never a fallback.
func computerSignedRuntimeProofError(err error) error {
	switch {
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return err
	case errors.Is(err, errDesktopMacosSignerTokenMissing):
		return driverError(computerErrorRuntimeProofMissing)
	case errors.Is(err, errDesktopMacosRuntimeUntrusted):
		return runtimeUntrusted()
	case errors.Is(err, errDesktopMacosSignerTokenInvalid), errors.Is(err, errDesktopMacosSignatureInvalid):
		return driverError(computerErrorRuntimeProofInvalid)
	default:
		return driverError(computerErrorRuntimeProofInvalid)
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

// Inventory lists selectable windows. It is read-only and never prompts for
// permission. Only windows whose exact (pid, process_instance) owner record
// carries an exact bundle_id and reports Accessibility are candidates. Both
// upstream calls are unscoped here because the user has not chosen an app yet;
// observing the chosen pin is always scoped.
func (d *computerDriver) Inventory(ctx context.Context) (computerInventory, error) {
	if ctx == nil {
		return computerInventory{}, invalidArgument()
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		return computerInventory{}, driverError(computerErrorClosed)
	}
	if err := ctx.Err(); err != nil {
		return computerInventory{}, err
	}
	apps, complete, err := d.listApps(ctx, "")
	if err != nil {
		return computerInventory{}, err
	}
	bundles, err := provenBundles(apps)
	if err != nil {
		return computerInventory{}, err
	}
	windows, err := d.listWindows(ctx, "")
	if err != nil {
		return computerInventory{}, err
	}
	inventory := computerInventory{Complete: complete}
	seen := make(map[string]struct{}, len(windows))
	for _, window := range windows {
		if window.ID == "" {
			continue
		}
		if _, ok := seen[window.ID]; ok {
			return computerInventory{}, protocolError()
		}
		seen[window.ID] = struct{}{}
		if !validWindowID(window.ID) || window.PID <= 0 || window.ProcessInstance == nil {
			continue
		}
		bundle, ok := bundles[processKey{pid: window.PID, instance: *window.ProcessInstance}]
		if !ok {
			continue
		}
		if window.Accessible == nil || !*window.Accessible {
			continue
		}
		// v1.3.1 WindowState serializes visible and minimized as independent
		// Option<bool> fields (system/window_state.rs:8-11). Upstream's own
		// inventory test admits any present minimized (macos
		// window_inventory.rs:161); this driver is deliberately stricter. A
		// present false is not evidence: admit only an explicitly visible or
		// explicitly minimized window, so a hidden, non-minimized window is
		// excluded.
		if !((window.Visible != nil && *window.Visible) ||
			(window.Minimized != nil && *window.Minimized)) {
			continue
		}
		if len(inventory.Candidates) >= computerMaxInventoryWindows {
			inventory.Truncated = true
			break
		}
		inventory.Candidates = append(inventory.Candidates, computerWindowCandidate{
			BundleID:        bundle,
			AppName:         boundedText(window.AppName, computerMaxAppBytes),
			WindowID:        window.ID,
			PID:             window.PID,
			ProcessInstance: *window.ProcessInstance,
			Title:           boundedText(window.Title, computerMaxNameBytes),
		})
	}
	return inventory, nil
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
	observation, err := d.observeLocked(ctx, target, nil)
	if err != nil {
		return computerObservation{}, err
	}
	return observation.public(), nil
}

func (d *computerDriver) observeLocked(ctx context.Context, target computerTarget, prior *computerObservation) (*computerObservation, error) {
	before, err := d.resolveWindow(ctx, target)
	if err != nil {
		return nil, err
	}
	if prior != nil && !sameWindow(prior.Window, before) {
		return nil, targetChanged()
	}
	snapshot, err := d.snapshotWindow(ctx, target, prior != nil && prior.interactiveOnly, prior == nil)
	if err != nil {
		return nil, err
	}
	after, err := d.resolveWindow(ctx, target)
	if err != nil {
		return nil, err
	}
	if !sameWindow(before, after) || after.ID != target.WindowID {
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
	// ref from this tree is handed back or stored as actable. That also means
	// no captured AX content or metadata (element role/name/value/description,
	// refs, snapshot id, window title) can be attributed to the pinned target,
	// so none of it survives in the private observation either. Only the
	// synthetic observation id and an unusable quality remain; a later Observe
	// may reprove the authorized selection separately.
	if snapshot.identityUnproven {
		observation.SnapshotID = ""
		observation.TreeQuality = computerTreeQualityUnusable
		observation.Truncated = false
		observation.Actable = false
		observation.Elements = nil
		observation.Window.Title = ""
		return observation, nil
	}
	observation.actionableCount = len(snapshot.refs)
	observation.actionableIncomplete = snapshot.actionableIncomplete
	observation.ambiguousRefKeys = snapshot.ambiguousRefKeys
	observation.interactiveOnly = snapshot.interactiveOnly
	if prior != nil {
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
	return left.BundleID == right.BundleID && left.ID == right.ID && left.PID == right.PID &&
		left.ProcessInstance == right.ProcessInstance
}

// Act performs one click or type. Authority belongs to the caller: the product
// executor gate must have a live task/grant and must cancel ctx on pause, stop,
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
		post, postErr := d.observeLocked(ctx, observation.Target, observation)
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

// Wait runs one bounded read-only actionability wait on a ref from the exact
// latest observation. It reuses the observation's session/refmap, the fixed
// sandbox, and the existing process-group cancellation, but sends no input and
// stores no new observation or refs. A native predicate expiry is returned as
// timed_out; a driver-side process bound, native deadline, protocol error,
// pin mismatch, or parent cancellation is a distinct error, never a retry.
func (d *computerDriver) Wait(ctx context.Context, request computerWaitRequest) (computerWaitResult, error) {
	if ctx == nil {
		return computerWaitResult{}, invalidArgument()
	}
	timeoutMS := request.TimeoutMS
	if timeoutMS == 0 {
		timeoutMS = computerWaitDefaultTimeoutMS
	}
	if !validObservationID(request.ObservationID) || !computerRefPattern.MatchString(request.Ref) ||
		timeoutMS < computerWaitMinTimeoutMS || timeoutMS > computerWaitMaxTimeoutMS {
		return computerWaitResult{}, invalidArgument()
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		return computerWaitResult{}, driverError(computerErrorClosed)
	}
	if err := ctx.Err(); err != nil {
		return computerWaitResult{}, err
	}
	observation := d.latest
	if observation == nil {
		return computerWaitResult{}, driverError(computerErrorNoObservation)
	}
	if request.ObservationID != observation.ID {
		return computerWaitResult{}, driverError(computerErrorStaleObservation)
	}
	if !strings.HasPrefix(request.Ref, "@"+observation.SnapshotID+":") {
		return computerWaitResult{}, driverError(computerErrorStaleRef)
	}
	if _, ok := observation.refs[request.Ref]; !ok {
		return computerWaitResult{}, driverError(computerErrorStaleRef)
	}

	window, err := d.resolveWindow(ctx, observation.Target)
	if err != nil {
		d.latest = nil
		if isTargetGone(err) {
			return computerWaitResult{}, targetChanged()
		}
		return computerWaitResult{}, err
	}
	if !sameWindow(observation.Window, window) {
		d.latest = nil
		return computerWaitResult{}, targetChanged()
	}
	// Accessibility and target identity are proven immediately before the
	// read. The native wait itself carries no window identity, so the exact
	// same identity is proven again below before any result is published.
	if err := d.requireAccessibility(ctx); err != nil {
		d.latest = nil
		return computerWaitResult{}, err
	}
	if err := ctx.Err(); err != nil {
		return computerWaitResult{}, err
	}

	args := d.baseArgs("wait",
		"--element", request.Ref,
		"--predicate", computerWaitPredicateActionable,
		"--timeout", strconv.Itoa(timeoutMS))
	command, err := d.run(ctx, time.Duration(timeoutMS)*time.Millisecond+computerWaitProcessGrace, nil, args...)
	if !command.started {
		if err == nil {
			err = sandboxUnavailable()
		}
		return computerWaitResult{}, err
	}
	if err != nil {
		// A parent cancellation or the driver's own process bound is not a
		// native predicate result and is never retried.
		return computerWaitResult{}, err
	}
	envelope, err := decodeEnvelope(command, "wait")
	if err != nil {
		return computerWaitResult{}, err
	}

	var result computerWaitResult
	if envelope.OK {
		var data cliWaitData
		if json.Unmarshal(envelope.Data, &data) != nil || !data.Found ||
			data.Ref != request.Ref || data.Predicate != computerWaitPredicateActionable ||
			data.Observed == nil || data.Observed.Actionable == nil || !*data.Observed.Actionable ||
			data.ElapsedMS == nil || *data.ElapsedMS < 0 || *data.ElapsedMS > int64(timeoutMS) {
			return computerWaitResult{}, protocolError()
		}
		result = computerWaitResult{Result: computerWaitMet, WaitedMS: int(*data.ElapsedMS)}
	} else {
		code := envelope.Error.Code
		agentCode, agentKind := stableCLICode(envelope.Error), cliErrorKind(envelope.Error)
		switch code {
		case "TIMEOUT":
			// Only the wait's own bounded predicate expiry is a normal
			// timed_out observation. A different native deadline stays an
			// error so it cannot be mistaken for the requested bound.
			var details struct {
				Kind      string `json:"kind"`
				Ref       string `json:"ref"`
				Predicate string `json:"predicate"`
				TimeoutMS *int64 `json:"timeout_ms"`
			}
			if json.Unmarshal(envelope.Error.Details, &details) == nil &&
				details.Kind == "wait_timeout" && details.Ref == request.Ref &&
				details.Predicate == computerWaitPredicateActionable &&
				details.TimeoutMS != nil && *details.TimeoutMS == int64(timeoutMS) {
				result = computerWaitResult{Result: computerWaitTimedOut, WaitedMS: timeoutMS}
				break
			}
			return computerWaitResult{}, &computerDriverError{
				Code: computerErrorTimeout, AgentCode: agentCode, AgentKind: agentKind,
			}
		case "STALE_REF":
			d.latest = nil
			return computerWaitResult{}, &computerDriverError{
				Code: computerErrorStaleRef, AgentCode: agentCode, AgentKind: agentKind,
			}
		case "AMBIGUOUS_TARGET":
			d.latest = nil
			return computerWaitResult{}, &computerDriverError{
				Code: computerErrorTargetChanged, AgentCode: agentCode, AgentKind: agentKind,
			}
		case "PERM_DENIED":
			d.latest = nil
			return computerWaitResult{}, &computerDriverError{
				Code: computerErrorAccessDenied, AgentCode: agentCode, AgentKind: agentKind,
			}
		default:
			return computerWaitResult{}, &computerDriverError{
				Code: computerErrorCommandFailed, AgentCode: agentCode, AgentKind: agentKind,
			}
		}
	}

	// The externally reported result is attributed to the selected live window
	// only while the pinned bundle/window/pid/process instance still resolves
	// exactly. A successor or unprovable identity suppresses met and timed_out.
	after, err := d.resolveWindow(ctx, observation.Target)
	if err != nil {
		d.latest = nil
		if isTargetGone(err) {
			return computerWaitResult{}, targetChanged()
		}
		return computerWaitResult{}, err
	}
	if !sameWindow(observation.Window, after) {
		d.latest = nil
		return computerWaitResult{}, targetChanged()
	}
	return result, nil
}

func postActionReadback(result computerActionResult) bool {
	if !result.Accepted {
		return false
	}
	return result.Delivery == computerDeliveryVerified ||
		result.Delivery == computerDeliveryUnverified
}

// Invalidate clears the refs bound by the last stored observation without
// closing the driver. The state root, session, and sandboxed binary stay
// usable; future input requires a new Observe. A quiesce uses this so stopping
// one selection never tears down the process for a replacement.
func (d *computerDriver) Invalidate() {
	d.mu.Lock()
	d.latest = nil
	d.mu.Unlock()
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
		result.stdoutOnlyOverflow = stdout.overflow && !stderr.overflow
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

// processKey is the exact owner join key. Neither field may be empty.
type processKey struct {
	pid      int
	instance string
}

// provenBundles keeps only exact (pid, process_instance) -> bundle_id joins. A
// blank or malformed field cannot prove a bundle and is dropped. Contradictory
// records for one process are rejected instead of resolved by preference.
func provenBundles(apps []cliApp) (map[processKey]string, error) {
	bundles := make(map[processKey]string, len(apps))
	instances := make(map[int]string, len(apps))
	for _, app := range apps {
		if app.BundleID == nil || app.ProcessInstance == nil || app.PID <= 0 {
			continue
		}
		bundle, instance := *app.BundleID, *app.ProcessInstance
		if !validBundleID(bundle) || !validProcessInstance(instance) {
			continue
		}
		if previous, ok := instances[app.PID]; ok && previous != instance {
			return nil, protocolError()
		}
		instances[app.PID] = instance
		key := processKey{pid: app.PID, instance: instance}
		if previous, ok := bundles[key]; ok {
			if previous != bundle {
				return nil, protocolError()
			}
			continue
		}
		bundles[key] = bundle
	}
	return bundles, nil
}

func (d *computerDriver) listApps(ctx context.Context, bundleID string) ([]cliApp, bool, error) {
	args := []string{"--timeout-ms=" + strconv.Itoa(computerListWindowsTimeoutMS)}
	if bundleID != "" {
		args = append([]string{"--app=" + bundleID}, args...)
	}
	command, err := d.run(ctx, computerListWindowsProcessTimeout, nil, d.baseArgs("list-apps", args...)...)
	if err != nil {
		return nil, false, err
	}
	envelope, err := decodeEnvelope(command, "list-apps")
	if err != nil {
		return nil, false, err
	}
	if !envelope.OK {
		if envelope.Error != nil && envelope.Error.Code == "APP_NOT_FOUND" {
			return nil, false, driverError(computerErrorTargetUnavailable)
		}
		return nil, false, d.commandError(envelope)
	}
	var data cliAppInventory
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		return nil, false, protocolError()
	}
	complete := (data.Complete == nil || *data.Complete) && len(data.Skipped) == 0
	return data.Apps, complete, nil
}

func (d *computerDriver) listWindows(ctx context.Context, bundleID string) ([]cliWindow, error) {
	args := []string{"--timeout-ms=" + strconv.Itoa(computerListWindowsTimeoutMS)}
	if bundleID != "" {
		args = append([]string{"--app=" + bundleID}, args...)
	}
	command, err := d.run(ctx, computerListWindowsProcessTimeout, nil, d.baseArgs("list-windows", args...)...)
	if err != nil {
		return nil, err
	}
	envelope, err := decodeEnvelope(command, "list-windows")
	if err != nil {
		return nil, err
	}
	if !envelope.OK {
		if envelope.Error != nil && (envelope.Error.Code == "APP_NOT_FOUND" || envelope.Error.Code == "WINDOW_NOT_FOUND") {
			return nil, driverError(computerErrorTargetUnavailable)
		}
		return nil, d.commandError(envelope)
	}
	var windows []cliWindow
	if err := json.Unmarshal(envelope.Data, &windows); err != nil {
		return nil, protocolError()
	}
	return windows, nil
}

func (d *computerDriver) resolveWindow(ctx context.Context, target computerTarget) (computerWindow, error) {
	apps, _, err := d.listApps(ctx, target.BundleID)
	if err != nil {
		return computerWindow{}, err
	}
	bundles, err := provenBundles(apps)
	if err != nil {
		return computerWindow{}, err
	}
	windows, err := d.listWindows(ctx, target.BundleID)
	if err != nil {
		return computerWindow{}, err
	}
	var found *cliWindow
	for index := range windows {
		window := windows[index]
		if window.ID == "" || window.ID != target.WindowID {
			continue
		}
		if found != nil {
			return computerWindow{}, protocolError()
		}
		found = &window
	}
	if found == nil {
		return computerWindow{}, driverError(computerErrorTargetUnavailable)
	}
	if found.PID <= 0 || found.ProcessInstance == nil || *found.ProcessInstance == "" {
		return computerWindow{}, protocolError()
	}
	// The pinned id exists under a different pid or launch instance. That is a
	// successor or a reused id, never a target to adopt silently.
	if found.PID != target.PID || *found.ProcessInstance != target.ProcessInstance {
		return computerWindow{}, targetChanged()
	}
	if bundles[processKey{pid: found.PID, instance: *found.ProcessInstance}] != target.BundleID {
		return computerWindow{}, driverError(computerErrorTargetUnavailable)
	}
	if found.Accessible != nil && !*found.Accessible {
		return computerWindow{}, driverError(computerErrorTargetUnavailable)
	}
	return computerWindow{
		BundleID:        target.BundleID,
		ID:              found.ID,
		PID:             found.PID,
		ProcessInstance: *found.ProcessInstance,
		Title:           boundedText(found.Title, computerMaxNameBytes),
	}, nil
}

type parsedSnapshot struct {
	snapshotID           string
	elements             []computerElement
	refs                 map[string]struct{}
	truncated            bool
	actionableIncomplete bool
	ambiguousRefKeys     map[elementIdentityKey]struct{}
	identityUnproven     bool
	quality              string
	interactiveOnly      bool
}

func (d *computerDriver) snapshotWindow(ctx context.Context, target computerTarget, interactiveOnly, allowFallback bool) (parsedSnapshot, error) {
	captureCtx, cancel := context.WithTimeout(ctx, computerSnapshotProcessTimeout)
	defer cancel()
	runCapture := func(interactive bool) (computerCommandResult, error) {
		args := d.baseArgs("snapshot", "--app="+target.BundleID, "--window-id="+target.WindowID)
		if interactive {
			args = append(args, "--interactive-only")
		}
		args = append(args, "--compact", "--max-depth="+strconv.Itoa(computerMaxObservationDepth),
			"--timeout-ms="+strconv.Itoa(computerSnapshotTimeoutMS))
		return d.run(captureCtx, computerSnapshotProcessTimeout, nil, args...)
	}
	// The interactive-only projection drops static feedback needed for effect comparison.
	command, err := runCapture(interactiveOnly)
	if allowFallback && !interactiveOnly && command.stdoutOnlyOverflow && captureCtx.Err() == nil {
		// A large static branch must not make previously usable refs disappear.
		// Reuse the old projection within this capture deadline, on Observe only.
		interactiveOnly = true
		command, err = runCapture(true)
	}
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
		// Display name is only presence-checked. It is not an identity: the
		// bundle can be aliased by a same-display-name app, so the saved
		// capture refmap below is the proof.
		return parsedSnapshot{}, protocolError()
	}
	snapshot, err := flattenSnapshot(data.Tree, data.SnapshotID)
	if err != nil {
		return parsedSnapshot{}, err
	}
	identityUnproven, err := d.verifyCapturedRefIdentity(target, data.SnapshotID, data.RefCount, snapshot.refs)
	if err != nil {
		return parsedSnapshot{}, err
	}
	snapshot.identityUnproven = identityUnproven || data.IdentityUnproven
	if data.Truncated || !*data.Complete || len(snapshot.refs) < data.RefCount {
		snapshot.truncated = true
		snapshot.actionableIncomplete = true
	}
	snapshot.interactiveOnly = interactiveOnly
	snapshot.truncated = snapshot.truncated || interactiveOnly
	snapshot.quality = computerTreeQualityGood
	if snapshot.truncated || snapshot.identityUnproven {
		snapshot.quality = computerTreeQualityPartial
	}
	return snapshot, nil
}

// verifyCapturedRefIdentity proves that the tree and refs returned by one
// snapshot were captured from the pinned target instead of merely being routed
// to a same-titled window. v1.3.1 snapshot output exposes only the app display
// name and the window id/title (commands/snapshot.rs:135-150), so it cannot
// carry the process generation. The capture records that generation locally:
// run_with_context saves the refmap before binding the id it returns
// (snapshot/mod.rs:28-33,174-186), every RefEntry carries the capture owner's
// pid, process_instance, and source window id (refs/ref_alloc.rs:22-56 via
// snapshot/snapshot_owner.rs:47-59), and RefStore keeps the map at
// <state_root>/sessions/<session>/snapshots/<id>/refmap.json
// (refs/refs_store.rs:31-37,220-229; the same 1,048,576-byte cap is
// MAX_REFMAP_BYTES in refs/mod.rs:16). Reading that exact private file is the
// only in-place proof. Only the identity fields are decoded, so observed text
// and display names cannot leak from here and are never trusted.
//
// A different pid, process_instance, or source window means the capture came
// from a successor generation or another window: targetChanged. Missing,
// oversized, malformed, or internally inconsistent evidence (including a tree
// ref absent from the saved map) is protocolError. Zero saved entries cannot
// prove any source, so that result is returned as unproven and the caller must
// hand back a read-only observation rather than actable refs.
func (d *computerDriver) verifyCapturedRefIdentity(target computerTarget, snapshotID string, refCount int, treeRefs map[string]struct{}) (bool, error) {
	path := filepath.Join(d.stateRoot, "sessions", d.sessionID, "snapshots", snapshotID, "refmap.json")
	data, err := readBoundedRegularFile(path, computerMaxRefmapBytes)
	if err != nil {
		return false, protocolError()
	}
	var refmap cliCapturedRefMap
	if err := decodeSingleJSON(data, &refmap); err != nil || refmap.Inner == nil {
		return false, protocolError()
	}
	if len(refmap.Inner) != refCount {
		return false, protocolError()
	}
	for key, entry := range refmap.Inner {
		if !validCapturedRefKey(key) || entry.PID <= 0 || entry.ProcessInstance == nil ||
			!validProcessInstance(*entry.ProcessInstance) ||
			entry.SourceWindowID == nil || !validWindowID(*entry.SourceWindowID) {
			return false, protocolError()
		}
	}
	for _, entry := range refmap.Inner {
		if entry.PID != target.PID || *entry.ProcessInstance != target.ProcessInstance ||
			*entry.SourceWindowID != target.WindowID {
			return false, targetChanged()
		}
	}
	prefix := "@" + snapshotID + ":"
	for ref := range treeRefs {
		if !strings.HasPrefix(ref, prefix) {
			return false, protocolError()
		}
		if _, ok := refmap.Inner["@"+strings.TrimPrefix(ref, prefix)]; !ok {
			return false, protocolError()
		}
	}
	return len(refmap.Inner) == 0, nil
}

// validCapturedRefKey matches the canonical @e<N> keys v1.3.1 writes:
// allocated from 1 (refs/mod.rs:73-80), with 1-10 digits and N>0
// (refs/ref_token.rs:46-53).
func validCapturedRefKey(key string) bool {
	if len(key) < 3 || len(key) > 12 || key[0] != '@' || key[1] != 'e' || key[2] == '0' {
		return false
	}
	for index := 2; index < len(key); index++ {
		if key[index] < '0' || key[index] > '9' {
			return false
		}
	}
	return true
}

func flattenSnapshot(root *cliNode, snapshotID string) (parsedSnapshot, error) {
	if root == nil || strings.TrimSpace(root.Role) == "" {
		return parsedSnapshot{}, protocolError()
	}
	projection := parsedSnapshot{
		snapshotID:       snapshotID,
		elements:         make([]computerElement, 0, 64),
		refs:             make(map[string]struct{}),
		ambiguousRefKeys: make(map[elementIdentityKey]struct{}),
	}
	textBudget := computerMaxObservationTextBytes
	// Only a (role, depth) key already owned by a retained ref node can be the
	// identity of a typing target, so omission evidence stays bounded by those
	// keys. The key holds a sanitized role and a depth, never observed text.
	var refKeys map[elementIdentityKey]struct{}
	noteOmittedCandidate := func(rawRole string, depth int) {
		if refKeys == nil {
			return
		}
		role := boundedText(rawRole, computerMaxRoleBytes)
		if role == "" {
			role = "unknown"
		}
		key := elementIdentityKey{Role: role, Depth: depth}
		if _, ok := refKeys[key]; ok {
			projection.ambiguousRefKeys[key] = struct{}{}
		}
	}

	var walk func(node *cliNode, depth int, actionable bool, incomplete *bool) error
	walk = func(node *cliNode, depth int, actionable bool, incomplete *bool) error {
		if depth > computerMaxObservationDepth || node.SubtreeTruncated || node.ChildrenCount > len(node.Children) {
			// An omitted subtree may still contain refs, regardless of its root.
			*incomplete = true
		}
		if depth > computerMaxObservationDepth {
			return nil
		}
		if (node.RefID != "") == actionable {
			if len(projection.elements) == computerMaxObservationElements {
				*incomplete = true
				if !actionable {
					// The decoded children of an omitted ref-free parent may still
					// hold a comparable candidate, so keep walking them.
					noteOmittedCandidate(node.Role, depth)
				} else {
					return nil
				}
			} else {
				clipped := false
				role := sanitizeText(node.Role, computerMaxRoleBytes, &textBudget, &clipped)
				if role == "" {
					role = "unknown"
					clipped = true
				}
				if actionable {
					if !computerRefPattern.MatchString(node.RefID) || !strings.HasPrefix(node.RefID, "@"+snapshotID+":") {
						return protocolError()
					}
					if _, exists := projection.refs[node.RefID]; exists {
						return protocolError()
					}
					projection.refs[node.RefID] = struct{}{}
				}
				name := sanitizeText(node.Name, computerMaxNameBytes, &textBudget, &clipped)
				value, _ := scalarValue(node.Value)
				valueClipped := false
				value = sanitizeText(value, computerMaxValueBytes, &textBudget, &valueClipped)
				description := sanitizeText(node.Description, computerMaxDescriptionBytes, &textBudget, &clipped)
				if clipped || valueClipped {
					*incomplete = true
					if !actionable && clipped {
						// A clipped identity can equal the target only in its
						// projected form, so mark the key it could have owned.
						noteOmittedCandidate(node.Role, depth)
					}
				}
				projection.elements = append(projection.elements, computerElement{
					Depth:       depth,
					Role:        role,
					Name:        name,
					Value:       value,
					Description: description,
					Ref:         node.RefID,
				})
			}
		}
		for index := range node.Children {
			if err := walk(&node.Children[index], depth+1, actionable, incomplete); err != nil {
				return err
			}
		}
		return nil
	}
	// Keep the engine's ref order and give refs first use of the same element
	// and text budgets so preceding inert labels cannot displace a control.
	if err := walk(root, 0, true, &projection.actionableIncomplete); err != nil {
		return parsedSnapshot{}, err
	}
	// Every element retained by the actionable pass carries a validated ref and
	// occupies the prefix, so these are exactly the ref-bearing identities.
	refKeys = make(map[elementIdentityKey]struct{}, len(projection.refs))
	for _, element := range projection.elements[:len(projection.refs)] {
		refKeys[elementIdentityKey{Role: element.Role, Depth: element.Depth}] = struct{}{}
	}
	if err := walk(root, 0, false, &projection.truncated); err != nil {
		return parsedSnapshot{}, err
	}
	projection.truncated = projection.truncated || projection.actionableIncomplete
	return projection, nil
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
	if !validBundleID(t.BundleID) || !validWindowID(t.WindowID) ||
		t.PID <= 0 || !validProcessInstance(t.ProcessInstance) {
		return invalidArgument()
	}
	return nil
}

func validBundleID(value string) bool {
	return validPrintableToken(value, computerMaxAppBytes)
}

func validProcessInstance(value string) bool {
	return validPrintableToken(value, computerMaxProcessInstanceBytes)
}

func validWindowID(value string) bool {
	return validPrintableToken(value, computerMaxWindowIDBytes)
}

func validPrintableToken(value string, maxBytes int) bool {
	if value == "" || len(value) > maxBytes {
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
	if before.Window.BundleID != after.Window.BundleID ||
		before.Window.ID != after.Window.ID || before.Window.PID != after.Window.PID ||
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

// typedTextChanged requires the action's own ref-bearing field to change and
// the new value to contain the typed text. Only loss of ref-bearing or native
// capture evidence makes that proof incomplete, not omitted inert context.
func typedTextChanged(before, after *computerObservation, ref, text string) bool {
	if before == nil || after == nil || ref == "" || text == "" ||
		before.actionableIncomplete || after.actionableIncomplete {
		return false
	}
	pre, ok := elementByRef(before, ref)
	if !ok {
		return false
	}
	// This bounded tree carries no proven unique element id (native_id is
	// optional and not retained here), so the same field must be the only
	// role/name/description/depth match among ALL retained elements of each
	// observation. A ref-free candidate that an omission or a local clip could
	// hide may still be a twin, so its role/depth key withholds done as well.
	if countElementsMatching(before.Elements, pre) != 1 ||
		ambiguousRefIdentity(before, pre) || ambiguousRefIdentity(after, pre) {
		return false
	}
	// The post match must sit in the ref-bearing prefix: v1.3.1 can retain a
	// ref-able element with no allocated ref, and such a node cannot prove that
	// the typed field itself kept its own validated ref before tokens cleared.
	var match computerElement
	matches, matchIndex := 0, -1
	for index, element := range after.Elements {
		if sameElement(element, pre) {
			match = element
			matches++
			matchIndex = index
		}
	}
	if matches != 1 || matchIndex < 0 || matchIndex >= after.actionableCount {
		return false
	}
	return match.Value != pre.Value && strings.Contains(match.Value, text)
}

// ambiguousRefIdentity reports whether ref-free context that was omitted or
// clipped in this observation could also have the given element's role and
// depth, and therefore could be a hidden sameElement twin.
func ambiguousRefIdentity(observation *computerObservation, element computerElement) bool {
	if observation == nil || len(observation.ambiguousRefKeys) == 0 {
		return false
	}
	_, ambiguous := observation.ambiguousRefKeys[elementIdentityKey{Role: element.Role, Depth: element.Depth}]
	return ambiguous
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
