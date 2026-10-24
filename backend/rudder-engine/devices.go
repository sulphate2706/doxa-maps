// devices.go — microphone discovery, hot-plug, and the sound-server environment.
//
// The Jitsi Meet pattern (lib-jitsi-meet modules/RTC/RTCUtils.js), done natively because Rudder records
// outside the browser:
//
//	Jitsi (browser)                                   Rudder (native, PipeWire/PulseAudio)
//	navigator.mediaDevices.enumerateDevices()     →   pactl -f json list sources
//	'devicechange' event + polling fallback       →   pactl subscribe (+ re-list on every source/card event)
//	compareAvailableMediaDevices(new)             →   sameDevices(old, new) — only emit on a real change
//	getUserMedia({audio:{deviceId:{exact:id}}})   →   parec --device=<id>
//
// Jitsi also reports the device list to analytics (sendDeviceListToAnalytics). Rudder never does:
// the list goes to the local plugin over SSE and nowhere else.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// audioEnv gives child processes a path to the user's sound server even when the engine was launched
// from a context without a desktop session (a detached shell, a service, an agent's terminal). Measured
// 2026-09-27: started with no XDG_RUNTIME_DIR, parec exited instantly with "Connection refused" and every
// recording captured nothing, although the socket sat at /run/user/<uid>/pulse/native all along.
func audioEnv() []string {
	env := os.Environ()
	rt := os.Getenv("XDG_RUNTIME_DIR")
	if rt == "" {
		rt = fmt.Sprintf("/run/user/%d", os.Getuid())
		if st, err := os.Stat(rt); err == nil && st.IsDir() {
			env = append(env, "XDG_RUNTIME_DIR="+rt)
		}
	}
	// systemctl --user (a headset-reset command may restart PipeWire) needs the session bus.
	if os.Getenv("DBUS_SESSION_BUS_ADDRESS") == "" {
		if _, err := os.Stat(rt + "/bus"); err == nil {
			env = append(env, "DBUS_SESSION_BUS_ADDRESS=unix:path="+rt+"/bus")
		}
	}
	if os.Getenv("PULSE_SERVER") == "" {
		if _, err := os.Stat(rt + "/pulse/native"); err == nil {
			env = append(env, "PULSE_SERVER=unix:"+rt+"/pulse/native")
		}
	}
	return env
}

// Device is one microphone as the plugin shows it.
type Device struct {
	ID      string `json:"id"`      // the sound server's source name: what parec --device takes
	Label   string `json:"label"`   // human name ("My Headset", "Built-in Audio Analog Stereo")
	Bus     string `json:"bus"`     // bluetooth | usb | pci | ...
	Default bool   `json:"default"` // the system's default input
	Muted   bool   `json:"muted"`
	Volume  string `json:"volume"` // e.g. "52%"
	State   string `json:"state"`  // RUNNING | IDLE | SUSPENDED
}

// DeviceList is the whole picture: the mics, plus sound cards that have a mic but are switched off
// (the laptop's built-in card, profile "off", is the common case — its mic simply doesn't exist until
// the card is turned on in Sound settings).
type DeviceList struct {
	Devices  []Device `json:"devices"`
	Default  string   `json:"default"`
	OffCards []string `json:"offCards"`
	Error    string   `json:"error,omitempty"`
}

func runPactl(args ...string) ([]byte, error) {
	cmd := exec.Command("pactl", args...)
	cmd.Env = audioEnv()
	return cmd.Output()
}

func listDevices() DeviceList {
	out := DeviceList{Devices: []Device{}, OffCards: []string{}}
	if _, err := exec.LookPath("pactl"); err != nil {
		out.Error = "pactl not found: install pipewire-pulse or pulseaudio-utils to list microphones"
		return out
	}
	if b, err := runPactl("get-default-source"); err == nil {
		out.Default = strings.TrimSpace(string(b))
	}
	b, err := runPactl("-f", "json", "list", "sources")
	if err != nil {
		out.Error = "cannot reach the sound server (pactl list sources failed: " + err.Error() + ")"
		return out
	}
	var raw []struct {
		Name        string         `json:"name"`
		Description string         `json:"description"`
		State       string         `json:"state"`
		Mute        bool           `json:"mute"`
		Volume      map[string]any `json:"volume"`
		Properties  map[string]any `json:"properties"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		out.Error = "unexpected pactl output: " + err.Error()
		return out
	}
	for _, s := range raw {
		// A ".monitor" source is the loopback of a SPEAKER, not a microphone: listing it would let the
		// user "record" their own music. Hidden, as Jitsi lists only audioinput kinds.
		if strings.HasSuffix(s.Name, ".monitor") || s.Properties["device.class"] == "monitor" {
			continue
		}
		d := Device{ID: s.Name, Label: s.Description, State: s.State, Muted: s.Mute, Default: s.Name == out.Default}
		if bus, ok := s.Properties["device.bus"].(string); ok {
			d.Bus = bus
		}
		for _, ch := range s.Volume { // first channel is representative
			if m, ok := ch.(map[string]any); ok {
				if p, ok := m["value_percent"].(string); ok {
					d.Volume = p
					break
				}
			}
		}
		out.Devices = append(out.Devices, d)
	}
	// Cards whose active profile is "off" but which offer an input profile.
	if b, err := runPactl("-f", "json", "list", "cards"); err == nil {
		var cards []struct {
			Name          string         `json:"name"`
			ActiveProfile string         `json:"active_profile"`
			Properties    map[string]any `json:"properties"`
			Profiles      map[string]struct {
				Sources   int  `json:"sources"`
				Available bool `json:"available"`
			} `json:"profiles"`
		}
		if json.Unmarshal(b, &cards) == nil {
			for _, c := range cards {
				if c.ActiveProfile != "off" {
					continue
				}
				for _, p := range c.Profiles {
					if p.Sources > 0 && p.Available {
						label, _ := c.Properties["device.description"].(string)
						if label == "" {
							label = c.Name
						}
						out.OffCards = append(out.OffCards, label)
						break
					}
				}
			}
		}
	}
	return out
}

// sameDevices mirrors Jitsi's compareAvailableMediaDevices: emit only when something a user would
// notice changed (a mic came, went, was muted, or the default moved), not on every state flicker.
func sameDevices(a, b DeviceList) bool {
	if a.Default != b.Default || len(a.Devices) != len(b.Devices) || a.Error != b.Error || len(a.OffCards) != len(b.OffCards) {
		return false
	}
	for i := range a.Devices {
		x, y := a.Devices[i], b.Devices[i]
		if x.ID != y.ID || x.Label != y.Label || x.Muted != y.Muted || x.Volume != y.Volume {
			return false
		}
	}
	return true
}

// deviceWatcher keeps the current list and pushes a "devices" event on every real change. It listens
// to `pactl subscribe` (the native 'devicechange') and, like Jitsi, also polls as a fallback in case
// the subscription dies.
type deviceWatcher struct {
	mu   sync.Mutex
	last DeviceList
	hub  *hub
	logs *ring
}

func (w *deviceWatcher) current() DeviceList {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.last
}

func (w *deviceWatcher) refresh(reason string) {
	now := listDevices()
	w.mu.Lock()
	changed := !sameDevices(w.last, now)
	w.last = now
	w.mu.Unlock()
	if changed {
		w.logs.add("microphones (%s): %d found, default=%s %s", reason, len(now.Devices), now.Default, now.Error)
		w.hub.send(event{"type": "devices", "devices": now})
	}
}

func (w *deviceWatcher) run() {
	w.refresh("startup")
	// Poll fallback (Jitsi polls enumerateDevices when devicechange is unavailable).
	go func() {
		for range time.Tick(5 * time.Second) {
			w.refresh("poll")
		}
	}()
	go func() {
		for {
			cmd := exec.Command("pactl", "subscribe")
			cmd.Env = audioEnv()
			cmd.SysProcAttr = childAttr()
			out, err := cmd.StdoutPipe()
			if err == nil && cmd.Start() == nil {
				sc := bufio.NewScanner(out)
				var debounce *time.Timer
				for sc.Scan() {
					l := sc.Text()
					if strings.Contains(l, " card ") || (strings.Contains(l, " source ") && !strings.Contains(l, "source-output")) {
						w.logs.add("sound-server event: %s", l)
					}
					if strings.Contains(l, " source ") || strings.Contains(l, " card ") || strings.Contains(l, " server ") {
						if debounce != nil {
							debounce.Stop()
						}
						debounce = time.AfterFunc(300*time.Millisecond, func() { w.refresh("hot-plug") })
					}
				}
				_ = cmd.Wait()
			}
			time.Sleep(3 * time.Second) // sound server restarted or unreachable: retry
		}
	}()
}

// micTest records ~3 s from one device WITHOUT transcribing and says, in plain words, whether the mic
// works — Rudder's version of Jitsi's pre-join audio preview. Level events stream to the plugin while
// it runs so the meter moves.
func (e *engine) micTest(device string) event {
	cmds := recorderCmds(device)
	var cmd *exec.Cmd
	for _, c := range cmds {
		if _, err := exec.LookPath(c[0]); err == nil {
			cmd = exec.Command(c[0], c[1:]...)
			break
		}
	}
	if cmd == nil {
		return event{"ok": false, "verdict": "No recorder found (need parec, pw-record or arecord)."}
	}
	cmd.Env = audioEnv()
	cmd.SysProcAttr = childAttr()
	var errBuf strings.Builder
	cmd.Stderr = &errBuf
	out, err := cmd.StdoutPipe()
	if err != nil || cmd.Start() != nil {
		return event{"ok": false, "verdict": "Could not start the recorder."}
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()

	frame := make([]byte, 3200) // 100 ms
	peak, frames, zeroFrames := 0, 0, 0
	var sumSq float64
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		n, err := io.ReadFull(out, frame)
		if err != nil {
			why := strings.TrimSpace(errBuf.String())
			e.logs.add("mic test on %q failed after %d frames: %v | %s", device, frames, err, why)
			return event{"ok": false, "verdict": "The microphone produced no audio. " + why, "recorder": cmd.Path}
		}
		fp := 0
		for i := 0; i+1 < n; i += 2 {
			v := int(int16(uint16(frame[i]) | uint16(frame[i+1])<<8))
			sumSq += float64(v * v)
			if v < 0 {
				v = -v
			}
			if v > fp {
				fp = v
			}
		}
		if fp == 0 {
			zeroFrames++
		}
		if fp > peak {
			peak = fp
		}
		frames++
		e.hub.send(event{"type": "level", "peak": float64(fp) / 32768, "test": true})
	}
	rms := 0.0
	if frames > 0 {
		rms = math.Sqrt(sumSq/float64(frames*1600)) / 32768
	}
	res := event{"ok": true, "peak": float64(peak) / 32768, "rms": rms, "frames": frames}
	switch {
	case zeroFrames == frames:
		res["ok"] = false
		res["verdict"] = "Pure silence — the mic is connected but sends nothing. It may be muted, or a Bluetooth headset's mic link may have dropped (try reconnecting the headset or pick another mic)."
	case peak < 330: // below about -40 dBFS
		res["verdict"] = "Very quiet — Rudder can hear the mic, but barely. Speak closer or raise its input volume."
	default:
		res["verdict"] = "Working — Rudder can hear you."
	}
	e.logs.add("mic test on %q: peak=%d rms=%.4f frames=%d verdict=%s", device, peak, rms, frames, res["verdict"])
	return res
}

// ─── Optional Bluetooth headset reset ─────────────────────────────────────────────────────────────
//
// Some Bluetooth headsets drop the mic side of the HFP link (exact-zero audio while everything looks
// connected; the kernel logs `hci0: corrupted SCO packet`). Re-opening the recorder does not revive
// it; a full reset (disconnect → restart PipeWire/WirePlumber → reconnect) can. That is machine-specific,
// so Rudder only runs one if RUDDER_BT_RESET names an executable that does it (exit 0 = headset works
// again). Rate-limited: never more than once per 20 s.
func btResetPath() string {
	p := os.Getenv("RUDDER_BT_RESET")
	if p == "" {
		return ""
	}
	if st, err := os.Stat(p); err == nil && !st.IsDir() && st.Mode()&0o111 != 0 {
		return p
	}
	return ""
}

var (
	resetMu   sync.Mutex
	lastReset time.Time
)

// runHeadsetReset runs the RUDDER_BT_RESET command and reports whether it said the headset works again.
func runHeadsetReset(logs *ring) (ok bool, ran bool) {
	path := btResetPath()
	if path == "" {
		return false, false
	}
	resetMu.Lock()
	if time.Since(lastReset) < 20*time.Second {
		resetMu.Unlock()
		logs.add("headset reset skipped: last one was %.0fs ago (rate limit 20s)", time.Since(lastReset).Seconds())
		return false, false
	}
	lastReset = time.Now()
	resetMu.Unlock()

	logs.add("running %s (headset reset + CVSD)", path)
	cmd := exec.Command(path)
	cmd.Env = audioEnv()
	done := make(chan struct{})
	var out []byte
	var err error
	go func() { out, err = cmd.CombinedOutput(); close(done) }()
	select {
	case <-done:
	case <-time.After(60 * time.Second):
		_ = cmd.Process.Kill()
		logs.add("headset reset timed out after 60s")
		return false, true
	}
	for _, l := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if l != "" {
			logs.add("[headset reset] %s", l)
		}
	}
	if err != nil {
		logs.add("headset reset failed: %v", err)
		return false, true
	}
	return true, true
}

// ─── Bluetooth voice-profile helpers ────────────────────────────────────────────────────────────

// btCard maps a Bluetooth mic (bluez_input.<MAC>.<n>, or "" = the default input) to its card.
func btCard(device string) string {
	if device == "" {
		if b, err := runPactl("get-default-source"); err == nil {
			device = strings.TrimSpace(string(b))
		}
	}
	if !strings.HasPrefix(device, "bluez_input.") {
		return ""
	}
	mac := strings.TrimPrefix(device, "bluez_input.")
	if i := strings.LastIndex(mac, "."); i > 0 {
		mac = mac[:i]
	}
	return "bluez_card." + mac
}

func currentProfile(card string) string {
	if card == "" {
		return "(not bluetooth)"
	}
	b, err := runPactl("-f", "json", "list", "cards")
	if err != nil {
		return "?"
	}
	var cards []struct {
		Name          string `json:"name"`
		ActiveProfile string `json:"active_profile"`
	}
	if json.Unmarshal(b, &cards) != nil {
		return "?"
	}
	for _, c := range cards {
		if c.Name == card {
			return c.ActiveProfile
		}
	}
	return "?"
}

// switchProfile forces a fresh voice link: CVSD if the card is on anything else, otherwise a bounce
// through mSBC and back to CVSD (a same-profile set is a no-op and would not renegotiate the link).
func switchProfile(card string, logs *ring) error {
	before := currentProfile(card)
	target := "headset-head-unit-cvsd"
	if before == target {
		if _, err := runPactl("set-card-profile", card, "headset-head-unit-msbc"); err != nil {
			logs.add("profile bounce via msbc failed: %v", err)
		}
		time.Sleep(700 * time.Millisecond)
	}
	if out, err := runPactl("set-card-profile", card, target); err != nil {
		return fmt.Errorf("pactl set-card-profile %s %s: %v %s", card, target, err, strings.TrimSpace(string(out)))
	}
	time.Sleep(1500 * time.Millisecond) // let the new SCO link and the source come up
	logs.add("voice profile %s → %s", before, currentProfile(card))
	return nil
}

// watchKernelBluetooth copies kernel Bluetooth messages into the log while a session runs
// (`journalctl -k` is readable without root on this system).
func watchKernelBluetooth(ctx context.Context, logs *ring) {
	cmd := exec.CommandContext(ctx, "journalctl", "-k", "-f", "-n", "0", "-o", "cat")
	out, err := cmd.StdoutPipe()
	if err != nil || cmd.Start() != nil {
		return
	}
	sc := bufio.NewScanner(out)
	for sc.Scan() {
		if l := sc.Text(); strings.Contains(strings.ToLower(l), "bluetooth") {
			logs.add("kernel: %s", l)
		}
	}
	_ = cmd.Wait()
}
