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
)

const (
	completionNotificationIDPrefix = "linksense:completion:"
	testNotificationID             = "linksense:notification-test"
	notificationBodyMaxBytes       = 512
)

var (
	errNotificationInvalid      = errors.New("DESKTOP_NOTIFICATION_INVALID")
	errNotificationsUnsupported = errors.New("DESKTOP_NOTIFICATIONS_UNSUPPORTED")
	errNotificationsDenied      = errors.New("DESKTOP_NOTIFICATIONS_DENIED")
	errNotificationsCanceled    = errors.New("DESKTOP_NOTIFICATIONS_CANCELED")
	errNotificationsFailed      = errors.New("DESKTOP_NOTIFICATIONS_FAILED")
	desktopNativeNotifications  = func() bool { return runtime.GOOS == "darwin" && mygo.NotificationsSupported() }
	showSystemNotification      = func(ctx context.Context, options mygo.NotificationOptions) error {
		return mygo.NewNotification(options).ShowContext(ctx)
	}
	desktopNotificationClick = mygo.NewEvent[DesktopNotificationClick]("desktop:notification-click")
)

// DesktopNotificationClick names the account and conversation of a clicked
// notification. The page checks the account before opening the conversation.
type DesktopNotificationClick struct {
	UserID         string `json:"userId"`
	ConversationID string `json:"conversationId"`
}

// CompletionNotificationInput carries only IDs and the localized status.
type CompletionNotificationInput struct {
	UserID         string `json:"userId"`
	ConversationID string `json:"conversationId"`
	TurnID         string `json:"turnId"`
	Body           string `json:"body"`
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

func (d *Desktop) showNotification(ctx context.Context, options mygo.NotificationOptions) error {
	if !desktopNativeNotifications() {
		return errNotificationsUnsupported
	}
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
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
		if desktopNativeNotifications() {
			mygo.NewNotification(mygo.NotificationOptions{ID: id}).Close()
		}
	})
}

func (d *Desktop) completionNotificationPrefix() string {
	return completionNotificationIDPrefix + serverCredentialKey(d.server, "server") + ":"
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
