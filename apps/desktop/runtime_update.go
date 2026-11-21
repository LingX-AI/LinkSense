package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"
)

const (
	updateAcquireRequestType = "update.acquire"
	updateReleaseRequestType = "update.release"
	updateAcquireResultType  = "update.acquire.result"
	updateAdmissionWait      = 5 * time.Second
)

var (
	errUpdateAdmissionBusy        = errors.New("DESKTOP_UPDATE_BUSY")
	errUpdateAdmissionUnavailable = errors.New("DESKTOP_RUNTIME_UNAVAILABLE")
)

// updateAdmission holds at most one native reservation. A non-nil reservation
// fences every runtime generation: the supervisor neither publishes a child
// nor waits for one until that exact reservation is finished. It is installed
// before update.acquire is written, so a pending request also owns admission.
type updateAdmission struct {
	mu          sync.Mutex
	reservation *updateReservation
	changed     chan struct{}
}

type updateReservation struct {
	requestID string
	pipe      *runtimePipe
}

// runtimeUpdateGuard is the acknowledged reservation. release is idempotent
// and safe after the runner or app has stopped; a staged install intentionally
// never calls it.
type runtimeUpdateGuard struct {
	supervisor *runtimeSupervisor
	requestID  string
	pipe       *runtimePipe
	once       sync.Once
}

func (guard *runtimeUpdateGuard) release() {
	if guard == nil {
		return
	}
	guard.once.Do(func() {
		guard.supervisor.releaseUpdateAdmission(guard.requestID, guard.pipe)
	})
}

type pendingUpdateRequest struct {
	requestID string
	reply     chan updateAdmissionResult
}

type updateAdmissionResult struct {
	Type      string
	RequestID string
	OK        bool
	ErrorCode string
}

// The shared schema requires a JSON boolean ok and no error_code on success.
// RawMessage keeps a present error_code distinguishable from an absent one,
// and a pointer rejects a missing or null ok instead of accepting Go's zero.
type updateAdmissionResultWire struct {
	Type      string          `json:"type"`
	RequestID string          `json:"request_id"`
	OK        *bool           `json:"ok"`
	ErrorCode json.RawMessage `json:"error_code"`
}

func parseUpdateAdmissionResult(raw json.RawMessage) (updateAdmissionResult, error) {
	var wire updateAdmissionResultWire
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if !json.Valid(raw) || decoder.Decode(&wire) != nil ||
		wire.Type != updateAcquireResultType || !validUUID(wire.RequestID) || wire.OK == nil {
		return updateAdmissionResult{}, errors.New("invalid update admission result")
	}
	if *wire.OK {
		if wire.ErrorCode != nil {
			return updateAdmissionResult{}, errors.New("invalid update admission result")
		}
		return updateAdmissionResult{Type: wire.Type, RequestID: wire.RequestID, OK: true}, nil
	}
	errorCode, err := parseUpdateAdmissionError(wire.ErrorCode)
	if err != nil {
		return updateAdmissionResult{}, err
	}
	return updateAdmissionResult{Type: wire.Type, RequestID: wire.RequestID, ErrorCode: errorCode}, nil
}

func parseUpdateAdmissionError(raw json.RawMessage) (string, error) {
	var errorCode string
	if raw == nil || json.Unmarshal(raw, &errorCode) != nil {
		return "", errors.New("invalid update admission result")
	}
	if errorCode != "DESKTOP_UPDATE_BUSY" && errorCode != "DESKTOP_RUNTIME_UNAVAILABLE" {
		return "", errors.New("invalid update admission result")
	}
	return errorCode, nil
}

func (pipe *runtimePipe) deliverUpdateAdmissionResult(raw string) bool {
	result, err := parseUpdateAdmissionResult(json.RawMessage(raw))
	if err != nil {
		return false
	}
	pipe.mu.Lock()
	pending := pipe.update
	if pending == nil || pending.requestID != result.RequestID {
		// A late or stale well-formed result must never admit or release work.
		pipe.mu.Unlock()
		return true
	}
	pipe.update = nil
	pipe.mu.Unlock()
	select {
	case pending.reply <- result:
	default:
	}
	return true
}

func pipeEnded(pipe *runtimePipe) bool {
	select {
	case <-pipe.done:
		return true
	default:
		return false
	}
}

// acquireUpdateAdmission reserves this supervisor against the current and all
// future runtime generations, then waits for the captured pipe's bounded
// acknowledgement. The returned guard owns the runner gate; release it only
// after staging is known to have failed, otherwise hold it until the app exits.
// A busy app turn or cleanup is reported as errUpdateAdmissionBusy; a missing,
// stopped, or replaced runtime as errUpdateAdmissionUnavailable.
func (s *runtimeSupervisor) acquireUpdateAdmission(ctx context.Context) (*runtimeUpdateGuard, error) {
	// One bounded context covers the writer wait and the acknowledgement.
	waitCtx, cancel := context.WithTimeout(ctx, updateAdmissionWait)
	defer cancel()
	requestID, err := randomControlRequestID()
	if err != nil {
		return nil, errUpdateAdmissionUnavailable
	}

	s.update.mu.Lock()
	if s.update.reservation != nil {
		s.update.mu.Unlock()
		return nil, errUpdateAdmissionBusy
	}
	if waitCtx.Err() != nil {
		s.update.mu.Unlock()
		return nil, waitCtx.Err()
	}
	pipe := s.pipe.Load()
	if pipe == nil || !s.ready.Load() {
		s.update.mu.Unlock()
		return nil, errUpdateAdmissionUnavailable
	}
	// Reserve before the frame exists. From here the supervisor cannot publish
	// a replacement child, even if this pipe dies before the acknowledgement.
	reservation := &updateReservation{requestID: requestID, pipe: pipe}
	s.update.reservation = reservation
	s.update.notifyLocked()
	s.update.mu.Unlock()

	// Every failure before a successful write clears the reservation without a
	// release: the runner never saw this request.
	notSent := func(err error) (*runtimeUpdateGuard, error) {
		s.clearUpdateReservation(reservation)
		return nil, err
	}

	pending := &pendingUpdateRequest{requestID: requestID, reply: make(chan updateAdmissionResult, 1)}
	pipe.mu.Lock()
	// A workspace relay may have held the writer. Recheck the one bounded
	// context and the captured generation immediately before this attempt's
	// only possible frame; a cancelled or ended attempt writes nothing.
	if waitCtx.Err() != nil {
		pipe.mu.Unlock()
		return notSent(waitCtx.Err())
	}
	if pipeEnded(pipe) {
		pipe.mu.Unlock()
		return notSent(errUpdateAdmissionUnavailable)
	}
	pipe.update = pending
	writeErr := pipe.writeLocked(runtimePipeMessage{Type: updateAcquireRequestType, RequestID: requestID})
	if writeErr != nil {
		pipe.update = nil
	}
	pipe.mu.Unlock()
	if writeErr != nil {
		// writeLocked closes the pipe on a write error, so no complete acquire
		// reached the runner and there is no gate to fence.
		return notSent(errUpdateAdmissionUnavailable)
	}

	select {
	case <-waitCtx.Done():
		// The request may have reached the runner: fence it with a release.
		s.releaseUpdateReservation(reservation)
		return nil, waitCtx.Err()
	case <-pipe.done:
		// The process owns no surviving gate; no release frame is needed.
		s.clearUpdateReservation(reservation)
		return nil, errUpdateAdmissionUnavailable
	case result := <-pending.reply:
		if !result.OK {
			s.clearUpdateReservation(reservation)
			if result.ErrorCode == "DESKTOP_UPDATE_BUSY" {
				return nil, errUpdateAdmissionBusy
			}
			return nil, errUpdateAdmissionUnavailable
		}
		// Match the full acknowledgement on the captured, still-healthy
		// generation. A late acknowledgement racing cancellation is fenced with
		// the same release, and a dead or replaced generation fails closed.
		if waitCtx.Err() != nil || pipeEnded(pipe) || !s.updateReservationCurrent(reservation) {
			s.releaseUpdateReservation(reservation)
			if waitCtx.Err() != nil {
				return nil, waitCtx.Err()
			}
			return nil, errUpdateAdmissionUnavailable
		}
		return &runtimeUpdateGuard{supervisor: s, requestID: requestID, pipe: pipe}, nil
	}
}

func (s *runtimeSupervisor) updateReservationCurrent(reservation *updateReservation) bool {
	s.update.mu.Lock()
	defer s.update.mu.Unlock()
	return s.update.reservation == reservation
}

func (s *runtimeSupervisor) clearUpdateReservation(reservation *updateReservation) {
	s.finishUpdateReservation(reservation, false)
}

func (s *runtimeSupervisor) releaseUpdateReservation(reservation *updateReservation) {
	s.finishUpdateReservation(reservation, true)
}

func (s *runtimeSupervisor) finishUpdateReservation(reservation *updateReservation, releaseFrame bool) {
	s.update.mu.Lock()
	defer s.update.mu.Unlock()
	if s.update.reservation != reservation {
		return
	}
	s.finishUpdateReservationLocked(reservation, releaseFrame)
}

// finishUpdateReservationLocked keeps the admission lock while the release
// frame is ordered and the reservation is cleared. Replacement generations
// therefore start only after the runner was told to drop this exact gate.
func (s *runtimeSupervisor) finishUpdateReservationLocked(reservation *updateReservation, releaseFrame bool) {
	if s.update.reservation != reservation {
		return
	}
	if releaseFrame {
		reservation.pipe.mu.Lock()
		_ = reservation.pipe.writeLocked(runtimePipeMessage{
			Type: updateReleaseRequestType, RequestID: reservation.requestID,
		})
		reservation.pipe.mu.Unlock()
	}
	s.update.reservation = nil
	s.update.notifyLocked()
}

func (s *runtimeSupervisor) releaseUpdateAdmission(requestID string, pipe *runtimePipe) {
	s.update.mu.Lock()
	defer s.update.mu.Unlock()
	reservation := s.update.reservation
	if reservation == nil || reservation.requestID != requestID || reservation.pipe != pipe {
		return
	}
	s.finishUpdateReservationLocked(reservation, true)
}

func (update *updateAdmission) notifyLocked() {
	if update.changed != nil {
		close(update.changed)
	}
	update.changed = make(chan struct{})
}
