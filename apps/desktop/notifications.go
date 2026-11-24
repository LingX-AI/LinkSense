package main

import (
	"context"
	"errors"
	"log"
	"runtime"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/egoist/mygo"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
)

const (
	completionNotificationIDPrefix = "linksense:completion:"
	approvalNotificationIDPrefix   = "linksense:approval:"
	testNotificationID             = "linksense:notification-test"
	notificationBodyMaxBytes       = 512
	// Keep the bound on one OS delivery, and never wait past the approval
	// request's own three-minute server deadline.
	notificationShowTimeout         = 90 * time.Second
	approvalNotificationMaxLifetime = 3 * time.Minute
)

var (
	errNotificationInvalid                = errors.New("DESKTOP_NOTIFICATION_INVALID")
	errDesktopApprovalNotificationInvalid = errors.New("DESKTOP_APPROVAL_NOTIFICATION_INVALID")
	errDesktopApprovalNotificationStale   = errors.New("DESKTOP_APPROVAL_NOTIFICATION_STALE")
	errNotificationsUnsupported           = errors.New("DESKTOP_NOTIFICATIONS_UNSUPPORTED")
	errNotificationsDenied                = errors.New("DESKTOP_NOTIFICATIONS_DENIED")
	errNotificationsCanceled              = errors.New("DESKTOP_NOTIFICATIONS_CANCELED")
	errNotificationsFailed                = errors.New("DESKTOP_NOTIFICATIONS_FAILED")
	desktopNativeNotifications            = func() bool { return runtime.GOOS == "darwin" && mygo.NotificationsSupported() }
	showSystemNotification                = func(ctx context.Context, options mygo.NotificationOptions) error {
		return mygo.NewNotification(options).ShowContext(ctx)
	}
	desktopNotificationClick = mygo.NewEvent[DesktopNotificationClick]("desktop:notification-click")
)

// DesktopNotificationClick names the account and conversation of a clicked
// notification. The page checks the account before opening the conversation.
// RequestID is present only for an approval reminder; the page rechecks the
// exact pair with the server before opening the conversation, and the click
// itself never answers the approval.
type DesktopNotificationClick struct {
	UserID         string `json:"userId"`
	ConversationID string `json:"conversationId"`
	RequestID      string `json:"requestId,omitempty"`
}

// CompletionNotificationInput carries only IDs and the localized status.
type CompletionNotificationInput struct {
	UserID         string `json:"userId"`
	ConversationID string `json:"conversationId"`
	TurnID         string `json:"turnId"`
	Body           string `json:"body"`
}

// DesktopApprovalNotificationInput carries only identifiers and the server
// deadline. The reminder has no command, path, text, route, or decision.
type DesktopApprovalNotificationInput struct {
	UserID         string    `json:"userId"`
	ConversationID string    `json:"conversationId"`
	RequestID      string    `json:"requestId"`
	ExpiresAt      time.Time `json:"expiresAt"`
}

// NotificationsSupported reports whether this build can show notifications,
// as MyGo reports it for packaged apps.
func (d *Desktop) NotificationsSupported(ctx context.Context) (bool, error) {
	if err := d.checkCaller(ctx); err != nil {
		return false, err
	}
	return desktopNativeNotifications(), nil
}

// ShowCompletionNotification shows one task-completion notification. It uses
// only the app name and localized status; task content stays in the app.
func (d *Desktop) ShowCompletionNotification(ctx context.Context, input CompletionNotificationInput) error {
	if err := d.checkCaller(ctx); err != nil {
		return err
	}
	if !validUUID(input.UserID) || !validUUID(input.ConversationID) || !validUUID(input.TurnID) ||
		!validNotificationText(input.Body) {
		return errNotificationInvalid
	}
	prefix := d.completionNotificationPrefix()
	id := prefix + input.UserID + ":" + input.ConversationID + ":" + input.TurnID
	return d.showNotification(ctx, mygo.NotificationOptions{
		ID: id, Group: prefix + input.UserID + ":" + input.ConversationID, Body: input.Body,
	})
}

// ShowTestNotification shows the notification that exercises the system's
// authorization prompt when the user enables notifications.
func (d *Desktop) ShowTestNotification(ctx context.Context, body string) error {
	if err := d.checkCaller(ctx); err != nil {
		return err
	}
	if !validNotificationText(body) {
		return errNotificationInvalid
	}
	return d.showNotification(ctx, mygo.NotificationOptions{
		ID: testNotificationID, Body: body,
	})
}

// ShowApprovalNotification shows one generic reminder for the live approval
// request the page observed. It accepts only IDs and the server deadline; the
// native host rechecks its own account lease and never answers the request.
func (d *Desktop) ShowApprovalNotification(ctx context.Context, input DesktopApprovalNotificationInput) error {
	if err := d.checkCaller(ctx); err != nil {
		return err
	}
	if !desktopNativeNotifications() {
		return errNotificationsUnsupported
	}
	if win := d.mainWindow(); win != nil && win.IsVisible() && win.IsFocused() {
		// The foreground approval card is already visible.
		return errDesktopApprovalNotificationStale
	}
	if !validUUID(input.UserID) || !validUUID(input.ConversationID) || !validUUID(input.RequestID) {
		return errDesktopApprovalNotificationInvalid
	}
	now := time.Now()
	if !approvalDeadlineValid(input.ExpiresAt, now) {
		return errDesktopApprovalNotificationStale
	}
	lease, err := requireAccount(&d.account)
	if err != nil || lease.id != strings.ToLower(input.UserID) {
		return errDesktopApprovalNotificationStale
	}
	return d.deliverApprovalNotification(ctx, input, lease)
}

// deliverApprovalNotification pins one admitted request to the account lease.
// The deadline is the earliest of the request, the native session, and the
// existing delivery timeout; MyGo's ShowContext observes cancellation.
func (d *Desktop) deliverApprovalNotification(
	ctx context.Context, input DesktopApprovalNotificationInput, lease accountLease,
) error {
	if !d.account.matches(lease) || leaseSessionCanceled(lease) {
		return errDesktopApprovalNotificationStale
	}
	// Pin delivery to the request deadline or the native session, whichever is
	// earlier. The existing show helper adds its own 90-second bound.
	deadline := input.ExpiresAt
	if lease.expiresAt.Before(deadline) {
		deadline = lease.expiresAt
	}
	showCtx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	// A sign-out or same-id replacement cancels exactly this generation's
	// session context. A same-generation refresh keeps it and cannot extend the
	// deadline pinned above. Neither account lock is held across MyGo.
	if lease.sessionCtx != nil {
		stop := context.AfterFunc(lease.sessionCtx, cancel)
		defer stop()
	}
	if !d.account.matches(lease) || leaseSessionCanceled(lease) {
		return errDesktopApprovalNotificationStale
	}
	if err := showCtx.Err(); err != nil {
		return notificationShowError(err)
	}
	prefix := d.approvalNotificationPrefix()
	showErr := d.showNotification(showCtx, mygo.NotificationOptions{
		ID:     approvalNotificationID(prefix, input.UserID, input.ConversationID, input.RequestID),
		Group:  prefix + strings.ToLower(input.UserID) + ":" + input.ConversationID,
		Body:   locales.ApprovalRequestNotice(),
		Silent: true,
	})
	// The receipt is not delivery proof: an expired wait or an invalidated
	// account must not report the banner as shown, even if the system call
	// returned late with no error.
	if !d.account.matches(lease) || leaseSessionCanceled(lease) {
		return errDesktopApprovalNotificationStale
	}
	if err := showCtx.Err(); err != nil {
		return notificationShowError(err)
	}
	return showErr
}

func leaseSessionCanceled(lease accountLease) bool {
	return lease.sessionCtx != nil && lease.sessionCtx.Err() != nil
}

// approvalDeadlineValid bounds a client-supplied deadline to the server's
// three-minute approval TTL. The snapshot can be a few seconds old when the
// page shows it, but never extends native trust past a live request.
func approvalDeadlineValid(expiresAt, now time.Time) bool {
	return expiresAt.After(now) && !expiresAt.After(now.Add(approvalNotificationMaxLifetime))
}

func (d *Desktop) showNotification(ctx context.Context, options mygo.NotificationOptions) error {
	if !desktopNativeNotifications() {
		return errNotificationsUnsupported
	}
	ctx, cancel := context.WithTimeout(ctx, notificationShowTimeout)
	defer cancel()
	options.Title = mygo.App.Name()
	return notificationShowError(showSystemNotification(ctx, options))
}

func notificationShowError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, mygo.ErrNotificationsDenied):
		return errNotificationsDenied
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return errNotificationsCanceled
	case errors.Is(err, errors.ErrUnsupported):
		return errNotificationsUnsupported
	default:
		return errNotificationsFailed
	}
}

func validNotificationText(value string) bool {
	if value == "" || len(value) > notificationBodyMaxBytes || !utf8.ValidString(value) {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

// handleNotificationClick runs on the main thread. A notification can outlive
// the run that showed it, so only IDs this app wrote are accepted.
func (d *Desktop) handleNotificationClick(id string) {
	if id == updateNotificationID {
		d.handleUpdateNotificationClick()
		return
	}
	if strings.HasPrefix(id, approvalNotificationIDPrefix) {
		d.handleApprovalNotificationClick(id)
		return
	}
	if !strings.HasPrefix(id, completionNotificationIDPrefix) {
		return
	}
	mygo.App.WhenReady(func() {
		if d.server == nil {
			return
		}
		target, ok := parseCompletionNotificationID(id, d.completionNotificationPrefix())
		if !ok {
			return
		}
		win := d.presentMainWindow()
		if win == nil {
			return
		}
		if err := desktopNotificationClick.Emit(win, target); err != nil {
			log.Print("DESKTOP_NOTIFICATION_NAVIGATION_UNAVAILABLE")
			return
		}
		closeNotification(id)
	})
}

// handleUpdateNotificationClick opens only the fixed update section through the
// same protected launch path as other native notifications. It carries no
// account identity and performs no update action.
func (d *Desktop) handleUpdateNotificationClick() {
	mygo.App.WhenReady(func() {
		if d.server == nil {
			return
		}
		win := d.presentMainWindow()
		if win == nil {
			return
		}
		if err := desktopNavigate.Emit(win, desktopUpdateSettingsPath); err != nil {
			log.Print("DESKTOP_NOTIFICATION_NAVIGATION_UNAVAILABLE")
			return
		}
		closeNotification(updateNotificationID)
	})
}

// handleApprovalNotificationClick opens the existing protected launch handoff.
// The page performs the exact-pair server recheck before routing, so this
// click never answers the approval.
func (d *Desktop) handleApprovalNotificationClick(id string) {
	mygo.App.WhenReady(func() {
		if d.server == nil {
			return
		}
		target, ok := parseApprovalNotificationID(id, d.approvalNotificationPrefix())
		if !ok {
			return
		}
		win := d.presentMainWindow()
		if win == nil {
			return
		}
		if err := desktopNotificationClick.Emit(win, target); err != nil {
			log.Print("DESKTOP_NOTIFICATION_NAVIGATION_UNAVAILABLE")
			return
		}
		closeNotification(id)
	})
}

func closeNotification(id string) {
	if desktopNativeNotifications() {
		mygo.NewNotification(mygo.NotificationOptions{ID: id}).Close()
	}
}

func (d *Desktop) completionNotificationPrefix() string {
	return completionNotificationIDPrefix + serverCredentialKey(d.server, "server") + ":"
}

func (d *Desktop) approvalNotificationPrefix() string {
	return approvalNotificationIDPrefix + serverCredentialKey(d.server, "server") + ":"
}

func approvalNotificationID(prefix, userID, conversationID, requestID string) string {
	return prefix + strings.ToLower(userID) + ":" + conversationID + ":" + requestID
}

func parseApprovalNotificationID(id, prefix string) (DesktopNotificationClick, bool) {
	rest, ok := strings.CutPrefix(id, prefix)
	if !ok {
		return DesktopNotificationClick{}, false
	}
	parts := strings.Split(rest, ":")
	if len(parts) != 3 || !validUUID(parts[0]) || !validUUID(parts[1]) || !validUUID(parts[2]) {
		return DesktopNotificationClick{}, false
	}
	return DesktopNotificationClick{
		UserID: parts[0], ConversationID: parts[1], RequestID: parts[2],
	}, true
}

func parseCompletionNotificationID(id, prefix string) (DesktopNotificationClick, bool) {
	rest, ok := strings.CutPrefix(id, prefix)
	if !ok {
		return DesktopNotificationClick{}, false
	}
	parts := strings.Split(rest, ":")
	if len(parts) != 3 || !validUUID(parts[0]) || !validUUID(parts[1]) || !validUUID(parts[2]) {
		return DesktopNotificationClick{}, false
	}
	return DesktopNotificationClick{UserID: parts[0], ConversationID: parts[1]}, true
}
