//go:build linux

package main

import (
	"log"
	"syscall"
)

// childAttr: a child process (the speech server, a recorder) is killed with the engine, so a crash
// never leaves a speech server holding a gigabyte of memory. Linux only: Pdeathsig does not exist on
// macOS or Windows (see procattr_other.go).
func childAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Pdeathsig: syscall.SIGKILL}
}

// yieldCPU lowers a background helper's CPU priority (nice 10), so on a thin client the live transcription
// always wins the CPU over it. Used for the robot voice: its ~1 s burst per sentence must never make the
// words you are speaking fall behind.
//
// ★ RAISING a priority is NOT available here and must not be attempted: an unprivileged process cannot
// set a negative nice (that needs CAP_SYS_NICE), so the call would fail with EPERM. Lowering — which is
// what this does — needs no privilege. The direction matters: the fix for a build starving dictation is
// to nice the BUILD, not to promote the engine (internal/desktop-build.mjs does that).
//
// The error is REPORTED rather than discarded. It was `_ = syscall.Setpriority(...)`, which cannot fail
// visibly: a call that silently does nothing looks exactly like a call that worked, and this one guards
// something a person can hear. Verify with `ps -o ni=` on the pid, never by this returning.
func yieldCPU(pid int) {
	if err := syscall.Setpriority(syscall.PRIO_PROCESS, pid, 10); err != nil {
		log.Printf("rudder: could not lower pid %d to nice 10 (%v); the robot voice will compete with live transcription", pid, err)
	}
}
