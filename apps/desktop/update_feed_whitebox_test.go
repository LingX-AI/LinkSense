//go:build desktop_update_feed

package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

type fixtureUpdateFeed struct {
	api *httptest.Server
}

func (feed fixtureUpdateFeed) Manifest(ctx context.Context, _ bool) (io.ReadCloser, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, feed.api.URL+"/manifest", nil)
	if err != nil {
		return nil, err
	}
	response, err := feed.api.Client().Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, errors.New("fixture manifest unavailable")
	}
	return response.Body, nil
}

func (feed fixtureUpdateFeed) Open(context.Context, string) (io.ReadCloser, error) {
	return nil, errors.New("checking for updates must not download archives")
}

func TestNativeUpdateFeed(t *testing.T) {
	version := mygo.App.Version()
	mygo.App.SetVersion("0.1.0")
	defer mygo.App.SetVersion(version)
	if !mygo.Updater.Enabled() {
		t.Fatal("the update whitebox requires a writable test bundle with an injected feed and public key")
	}
	var requestCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/manifest" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		switch requestCount.Add(1) {
		case 1:
			_, _ = fmt.Fprint(w, `{"version":"0.2.0","url":"fixture-archive","signature":"unused-in-check"}`)
		case 2:
			_, _ = fmt.Fprint(w, `{"version":"0.1.0","url":"fixture-archive","signature":"unused-in-check"}`)
		default:
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	}))
	defer server.Close()
	mygo.Updater.SetSource(fixtureUpdateFeed{api: server})
	defer mygo.Updater.SetSource(nil)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, expected := range []DesktopUpdateResult{
		{State: UpdateAvailable, Version: "0.2.0"},
		{State: UpdateCurrent},
		{State: UpdateFailed},
	} {
		if result := checkDesktopUpdate(ctx, mygo.Updater.Check); result != expected {
			t.Fatalf("unexpected update status: %+v, expected %+v", result, expected)
		}
	}
}
