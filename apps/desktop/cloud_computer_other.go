//go:build !darwin

package main

func newCloudComputer(*Desktop) cloudComputerHost { return nil }
