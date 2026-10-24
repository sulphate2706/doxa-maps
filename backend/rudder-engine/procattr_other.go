//go:build !linux

package main

import "syscall"

// childAttr: macOS and Windows have no parent-death signal. In the desktop app the Tauri shell owns the
// engine's lifetime and the engine kills its children on a normal exit (shutdown); a crashed engine can
// leave its speech server running until the app is next closed.
func childAttr() *syscall.SysProcAttr {
	return nil
}

// yieldCPU: best effort only on Linux (see procattr_linux.go); elsewhere a no-op.
func yieldCPU(pid int) {}
