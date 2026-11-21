package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/egoist/mygo"
)

const (
	desktopApplicationAnnotationPreloadFile   = "application-annotation-preload.js"
	desktopApplicationAnnotationConfigGlobal  = "__linksenseDesktopApplicationAnnotationConfig"
	desktopApplicationAnnotationBridgeVersion = 1
	desktopApplicationAnnotationParentOrigin  = "mygo://localhost"
)

type desktopApplicationAnnotationConfig struct {
	Version      int    `json:"version"`
	ServerOrigin string `json:"serverOrigin"`
	ParentOrigin string `json:"parentOrigin"`
}

// desktopServerOrigin serializes the origin the WebView reports for the
// packaged server. It removes explicit default ports, as the URL standard
// does, so the preload compares location.origin exactly.
func desktopServerOrigin(server *url.URL) (string, error) {
	if server == nil || server.Opaque != "" || server.User != nil || server.Host == "" ||
		(server.Path != "" && server.Path != "/") || server.RawQuery != "" || server.Fragment != "" {
		return "", errors.New("DESKTOP_SERVER_ORIGIN_INVALID")
	}
	scheme := strings.ToLower(server.Scheme)
	if scheme != "https" && scheme != "http" {
		return "", errors.New("DESKTOP_SERVER_ORIGIN_INVALID")
	}
	host := strings.ToLower(server.Host)
	if name, port, err := net.SplitHostPort(host); err == nil {
		switch {
		case port == "", scheme == "https" && port == "443", scheme == "http" && port == "80":
			if strings.Contains(name, ":") {
				host = "[" + strings.Trim(name, "[]") + "]"
			} else {
				host = name
			}
		default:
			host = net.JoinHostPort(name, port)
		}
	}
	if scheme == "http" {
		hostname := strings.ToLower(server.Hostname())
		ip := net.ParseIP(hostname)
		if hostname != "localhost" && (ip == nil || !ip.IsLoopback()) {
			return "", errors.New("DESKTOP_SERVER_HTTPS_REQUIRED")
		}
	}
	return scheme + "://" + host, nil
}

func readDesktopApplicationAnnotationPreload(resourcesDir string) (string, error) {
	if resourcesDir == "" {
		return "", fs.ErrNotExist
	}
	for _, candidate := range []string{
		filepath.Join(resourcesDir, "darwin", desktopApplicationAnnotationPreloadFile),
		filepath.Join(resourcesDir, desktopApplicationAnnotationPreloadFile),
	} {
		data, err := os.ReadFile(candidate)
		if err == nil {
			if len(strings.TrimSpace(string(data))) == 0 {
				return "", errors.New("DESKTOP_ANNOTATION_PRELOAD_EMPTY")
			}
			return string(data), nil
		}
		if !errors.Is(err, fs.ErrNotExist) {
			return "", err
		}
	}
	return "", fs.ErrNotExist
}

// desktopApplicationAnnotationPreload builds the page preload only for the Mac
// host. The controller is a fixed first-party bundle from the platform
// resources; only the two origins are supplied here.
func desktopApplicationAnnotationPreload(goos, resourcesDir string, server *url.URL) string {
	if goos != "darwin" {
		return ""
	}
	origin, err := desktopServerOrigin(server)
	if err != nil {
		return ""
	}
	controller, err := readDesktopApplicationAnnotationPreload(resourcesDir)
	if err != nil {
		return ""
	}
	config, err := json.Marshal(desktopApplicationAnnotationConfig{
		Version:      desktopApplicationAnnotationBridgeVersion,
		ServerOrigin: origin,
		ParentOrigin: desktopApplicationAnnotationParentOrigin,
	})
	if err != nil {
		return ""
	}
	return `(function(config) {
		if (window.parent === window || window.parent !== window.top ||
			location.origin !== config.serverOrigin ||
			!location.pathname.startsWith("/api/v1/interactive-app-runtime/")) return;
		window.` + desktopApplicationAnnotationConfigGlobal + ` = config;
` + controller + `
	})(` + string(config) + `);`
}

func desktopApplicationAnnotationPreloadForWindow(server *url.URL) string {
	if runtime.GOOS != "darwin" || server == nil {
		return ""
	}
	resources, err := mygo.App.Path(mygo.PathResources)
	if err != nil {
		log.Print("DESKTOP_ANNOTATION_PRELOAD_UNAVAILABLE")
		return ""
	}
	preload := desktopApplicationAnnotationPreload(runtime.GOOS, resources, server)
	if preload == "" {
		log.Print("DESKTOP_ANNOTATION_PRELOAD_UNAVAILABLE")
	}
	return preload
}
