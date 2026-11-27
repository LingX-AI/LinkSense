package main

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
)

func stubDesktopLocale(t *testing.T, goos, chosen string) *[]string {
	t.Helper()
	originalGOOS := desktopLocaleGOOS
	originalChosen := desktopChosenLocale
	originalSet := desktopSetLocale
	originalRunOnMain := desktopRunOnMain
	originalCaller := desktopLocaleCaller
	calls := make([]string, 0, 1)
	desktopLocaleGOOS = goos
	desktopChosenLocale = func() string { return chosen }
	desktopSetLocale = func(tag string) { calls = append(calls, tag) }
	desktopRunOnMain = func(fn func()) { fn() }
	desktopLocaleCaller = func(*Desktop, context.Context) error { return nil }
	t.Cleanup(func() {
		desktopLocaleGOOS = originalGOOS
		desktopChosenLocale = originalChosen
		desktopSetLocale = originalSet
		desktopRunOnMain = originalRunOnMain
		desktopLocaleCaller = originalCaller
	})
	return &calls
}

func TestDesktopLocaleAcceptsOnlyExactCatalogLanguages(t *testing.T) {
	calls := stubDesktopLocale(t, "darwin", "")
	for _, tag := range locales.Catalog.Languages() {
		if err := applyDesktopLocale(context.Background(), &Desktop{}, tag); err != nil {
			t.Fatalf("catalog language %q was rejected: %v", tag, err)
		}
	}
	if len(*calls) != len(locales.Catalog.Languages()) {
		t.Fatalf("native language calls = %v", *calls)
	}
	*calls = (*calls)[:0]
	for _, tag := range []string{"", "de-DE", "zh-Hans", "EN-US", "en"} {
		if err := applyDesktopLocale(context.Background(), &Desktop{}, tag); err == nil || err.Error() != "VALIDATION_ERROR" {
			t.Fatalf("tag %q error = %v, want VALIDATION_ERROR", tag, err)
		}
	}
	if len(*calls) != 0 {
		t.Fatalf("invalid tags reached the native language: %v", *calls)
	}
}

func TestDesktopLocaleDoesNotRepeatTheChosenLanguage(t *testing.T) {
	calls := stubDesktopLocale(t, "darwin", "en-US")
	if err := applyDesktopLocale(context.Background(), &Desktop{}, "en-US"); err != nil {
		t.Fatal(err)
	}
	if len(*calls) != 0 {
		t.Fatalf("the already chosen language was set again: %v", *calls)
	}
}

func TestDesktopLocaleUpdatesADifferentChosenTag(t *testing.T) {
	calls := stubDesktopLocale(t, "darwin", "en")
	if err := applyDesktopLocale(context.Background(), &Desktop{}, "en-US"); err != nil {
		t.Fatal(err)
	}
	if len(*calls) != 1 || (*calls)[0] != "en-US" {
		t.Fatalf("native language calls = %v, want [en-US]", *calls)
	}
}

func TestDesktopLocaleAppliesOnTheMainThread(t *testing.T) {
	stubDesktopLocale(t, "darwin", "")
	var order []string
	desktopRunOnMain = func(fn func()) {
		order = append(order, "main")
		fn()
		order = append(order, "done")
	}
	desktopLocaleCaller = func(*Desktop, context.Context) error {
		order = append(order, "caller")
		return nil
	}
	desktopChosenLocale = func() string {
		order = append(order, "chosen")
		return ""
	}
	desktopSetLocale = func(string) { order = append(order, "set") }

	if err := applyDesktopLocale(context.Background(), &Desktop{}, "ja-JP"); err != nil {
		t.Fatal(err)
	}
	if want := []string{"main", "caller", "chosen", "set", "done"}; !slices.Equal(order, want) {
		t.Fatalf("native language applied outside one main-thread callback: %v", order)
	}
}

func TestDesktopLocaleRechecksTheCallerBeforeApplying(t *testing.T) {
	calls := stubDesktopLocale(t, "darwin", "")
	checks := 0
	desktopLocaleCaller = func(*Desktop, context.Context) error {
		checks++
		if checks == 2 {
			return errors.New("DESKTOP_CALLER_FORBIDDEN")
		}
		return nil
	}

	err := (&Desktop{}).SetLocale(context.Background(), "en-US")
	if err == nil || err.Error() != "DESKTOP_CALLER_FORBIDDEN" {
		t.Fatalf("navigated caller error = %v, want DESKTOP_CALLER_FORBIDDEN", err)
	}
	if checks != 2 {
		t.Fatalf("caller checks = %d, want the check at application too", checks)
	}
	if len(*calls) != 0 {
		t.Fatalf("a stale caller changed the native language: %v", *calls)
	}
}

func TestDesktopLocaleFailsClosedWhenTheMainThreadIsGone(t *testing.T) {
	calls := stubDesktopLocale(t, "darwin", "")
	desktopRunOnMain = func(func()) {}

	err := applyDesktopLocale(context.Background(), &Desktop{}, "en-US")
	if err == nil || err.Error() != "DESKTOP_HOST_UNAVAILABLE" {
		t.Fatalf("quit application error = %v, want DESKTOP_HOST_UNAVAILABLE", err)
	}
	if len(*calls) != 0 {
		t.Fatalf("a change was applied without the main thread: %v", *calls)
	}
}

func TestDesktopLocaleRejectsOtherPlatforms(t *testing.T) {
	for _, goos := range []string{"windows", "linux"} {
		calls := stubDesktopLocale(t, goos, "")
		if err := applyDesktopLocale(context.Background(), &Desktop{}, "en-US"); err == nil || err.Error() != "DESKTOP_HOST_UNAVAILABLE" {
			t.Fatalf("%s error = %v, want DESKTOP_HOST_UNAVAILABLE", goos, err)
		}
		if len(*calls) != 0 {
			t.Fatalf("%s changed the native language: %v", goos, *calls)
		}
	}
}

func TestDesktopLocaleRequiresTheMainPage(t *testing.T) {
	calls := stubDesktopLocale(t, "darwin", "")
	desktopLocaleCaller = func(d *Desktop, ctx context.Context) error {
		return d.checkCaller(ctx)
	}
	if err := (&Desktop{}).SetLocale(context.Background(), "en-US"); err == nil || err.Error() != "DESKTOP_CALLER_FORBIDDEN" {
		t.Fatalf("unbound caller error = %v, want DESKTOP_CALLER_FORBIDDEN", err)
	}
	if len(*calls) != 0 {
		t.Fatalf("an unbound caller changed the native language: %v", *calls)
	}
}
