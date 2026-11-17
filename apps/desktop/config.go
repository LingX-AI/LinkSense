package main

import (
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

type desktopConfig struct {
	ServerURL string `json:"serverUrl"`
}

func parseServerURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" ||
		(u.Path != "" && u.Path != "/") || u.Opaque != "" || strings.ContainsAny(raw, "?#\r\n\x00") {
		return nil, errors.New("DESKTOP_SERVER_URL_INVALID")
	}
	host := strings.ToLower(u.Hostname())
	ip := net.ParseIP(host)
	loopback := host == "localhost" || (ip != nil && ip.IsLoopback())
	if u.Scheme != "https" && !(u.Scheme == "http" && loopback) {
		return nil, errors.New("DESKTOP_SERVER_HTTPS_REQUIRED")
	}
	u.Host = strings.ToLower(u.Host)
	u.Path, u.RawPath = "", ""
	return u, nil
}

func loadDesktopConfig(file string) (desktopConfig, error) {
	data, err := os.ReadFile(file)
	if errors.Is(err, os.ErrNotExist) {
		return desktopConfig{}, nil
	}
	if err != nil {
		return desktopConfig{}, err
	}
	var config desktopConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return desktopConfig{}, errors.New("DESKTOP_CONFIG_INVALID")
	}
	if config.ServerURL != "" {
		u, err := parseServerURL(config.ServerURL)
		if err != nil {
			return desktopConfig{}, err
		}
		config.ServerURL = u.String()
	}
	return config, nil
}

func saveDesktopConfig(file string, server *url.URL) error {
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(desktopConfig{ServerURL: server.String()})
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(file), ".config-*")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	if _, err = temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(temp.Name(), file)
}
