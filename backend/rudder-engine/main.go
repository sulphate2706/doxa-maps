// rudder-engine — the local speech backend for the rudder-voice plugin.
//
// WHY THIS EXISTS: rudder-voice is a DESKTOP-target plugin. Speech-to-text runs on the user's own
// machine, never in the browser and never on a server. In dev, `bun run dev` starts this process and
// Vite forwards /api/rudder/* to it; in the desktop app, Tauri runs it as a sidecar. Same binary,
// same API, so "works in the Plugin Studio" means "works on desktop".
//
//	browser / webview ──HTTP+SSE──► rudder-engine (127.0.0.1:RUDDER_PORT)
//	                                   ├─ recorder: parec → pw-record → arecord (mic open ONLY while recording)
//	                                   └─ WebSocket ──► nemo-speech serve (127.0.0.1:RUDDER_NEMO_PORT)
//	                                                      NVIDIA NeMo-Speech.cpp + Nemotron 3.5 ASR GGUF
//
// NO TELEMETRY, NO NETWORK: the runtime is NVIDIA NeMo-Speech.cpp (ggml). ONNX-based runtimes were
// REJECTED: measured 2026-09-26, the tested ONNX GenAI runtime looked up a vendor telemetry host even
// with telemetry "disabled". NeMo-Speech.cpp was traced with strace: zero sockets, zero DNS.
// Its only network path is an optional model download that shells out to `curl` when the model is not
// a local file — so this engine REFUSES to start unless RUDDER_MODEL is an existing local file.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

// ─── Config (env, with local defaults) ──────────────────────────────────────────────────────────

type config struct {
	Port       string // this engine's HTTP port
	NemoPort   string // the warm NeMo-Speech server's port (loopback only)
	NemoBin    string // path to the nemo-speech executable
	Model      string // local GGUF path — MUST exist (see the no-network note above)
	Language   string // default language code
	EndpointMs int    // silence that ends an utterance
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

// defaultNemoBin: where setup puts NVIDIA's NeMo-Speech.cpp 0.1.0 CPU release for THIS platform — the
// release folders are named nemo-speech-0.1.0-<linux|macos|windows>-<x86_64|aarch64>-cpu.
func defaultNemoBin(base string) string {
	osName := map[string]string{"darwin": "macos"}[runtime.GOOS]
	if osName == "" {
		osName = runtime.GOOS
	}
	arch := map[string]string{"amd64": "x86_64", "arm64": "aarch64"}[runtime.GOARCH]
	exe := "nemo-speech"
	if runtime.GOOS == "windows" {
		exe += ".exe"
	}
	return filepath.Join(base, "bin", "nemo-speech-0.1.0-"+osName+"-"+arch+"-cpu", "bin", exe)
}

func loadConfig() config {
	home, _ := os.UserHomeDir()
	// RUDDER_HOME is where setup-runtime.sh installed the runtime and model (a server keeps it on a volume).
	base := envOr("RUDDER_HOME", filepath.Join(home, ".local", "share", "rudder"))
	return config{
		Port:       envOr("RUDDER_PORT", "5193"),
		NemoPort:   envOr("RUDDER_NEMO_PORT", "5194"),
		NemoBin:    envOr("RUDDER_NEMO_BIN", defaultNemoBin(base)),
		Model:      envOr("RUDDER_MODEL", filepath.Join(base, "models", "nemotron-3.5-asr-streaming-0.6b.q8_0.gguf")),
		Language:   envOr("RUDDER_LANG", "en-US"),
		EndpointMs: 800,
	}
}

// ─── Log ring: every line is also served at /api/rudder/log so the Debug panel can copy it ──────

type ring struct {
	mu    sync.Mutex
	lines []string
}

// ★ PRIVACY: the log is what people paste to an agent (🐞 Debug → copy report), so it must never carry
// anything that identifies them. Every line is redacted as it is written: device MAC addresses (inside
// Bluetooth device names like bluez_input.AA_BB_…) and the home folder (which contains the username).
// Transcribed words are never logged at all.
var (
	macRe   = regexp.MustCompile(`(?i)\b([0-9a-f]{2}[:_]){5}[0-9a-f]{2}\b`)
	homeDir = func() string { h, _ := os.UserHomeDir(); return h }()
)

func redact(s string) string {
	s = macRe.ReplaceAllString(s, "XX:XX:XX:XX:XX:XX")
	if homeDir != "" && homeDir != "/" {
		s = strings.ReplaceAll(s, homeDir, "~")
	}
	return s
}

func (r *ring) add(format string, a ...any) {
	line := redact(time.Now().Format("15:04:05.000") + " " + fmt.Sprintf(format, a...))
	log.Println(line)
	r.mu.Lock()
	r.lines = append(r.lines, line)
	if len(r.lines) > 3000 {
		r.lines = r.lines[len(r.lines)-3000:]
	}
	r.mu.Unlock()
}

func (r *ring) text() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return strings.Join(r.lines, "\n")
}

// ─── Event hub: Server-Sent Events to every open plugin ─────────────────────────────────────────

type event map[string]any

type hub struct {
	mu      sync.Mutex
	clients map[chan []byte]struct{}
}

func (h *hub) subscribe() chan []byte {
	c := make(chan []byte, 64)
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
	return c
}

func (h *hub) unsubscribe(c chan []byte) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
}

func (h *hub) send(e event) {
	b, _ := json.Marshal(e)
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		select {
		case c <- b:
		default: // a slow client drops an event rather than stalling the audio path
		}
	}
}

// ─── Engine: supervises nemo-speech serve and one recording session at a time ───────────────────

type engine struct {
	cfg  config
	logs *ring
	hub  *hub

	mu          sync.Mutex
	state       string // starting | ready | error
	stateErr    string
	nemo        *exec.Cmd
	recording   bool
	recorder    string
	language    string
	stopSession func()
	device      string
	devs        *deviceWatcher
	nemoKey     string
	eou         atomic.Bool // wanted: sentence detection (robot voice on)
	nemoEOU     bool        // what the running speech server was started with
	ducked      atomic.Bool // the robot voice is speaking: feed the transcriber silence
}

func (e *engine) setState(s, errText string) {
	e.mu.Lock()
	e.state, e.stateErr = s, errText
	e.mu.Unlock()
	e.hub.send(event{"type": "status", "engine": s, "error": errText})
}

func (e *engine) status() event {
	e.mu.Lock()
	defer e.mu.Unlock()
	return event{
		// A browser session belongs to one reader; everyone else sees only that the engine is in use.
		"engine": e.state, "error": e.stateErr, "recording": e.recording && !browserAudio(), "inUse": e.recording, "recorder": e.recorder,
		"language": e.language, "defaultLanguage": e.cfg.Language, "device": e.device,
		"runtime": "NVIDIA NeMo-Speech.cpp (ggml, CPU)", "model": filepath.Base(e.cfg.Model),
		"audio": map[bool]string{true: "browser", false: "local"}[browserAudio()],
	}
}

// startNemo launches the warm speech server. The model loads and warms up once (~20 s on CPU),
// so starting and stopping a recording is instant afterwards.
func (e *engine) startNemo() {
	if st, err := os.Stat(e.cfg.Model); err != nil || st.IsDir() {
		e.setState("error", "model file not found: "+e.cfg.Model+" (refusing to start: a non-local model would make the runtime download it)")
		return
	}
	if _, err := os.Stat(e.cfg.NemoBin); err != nil {
		e.setState("error", "nemo-speech runtime not found: "+e.cfg.NemoBin)
		return
	}
	e.setState("starting", "")
	// A fresh random key each start: the speech server answers only this engine, not any other local
	// program or web page that finds its port.
	cmd := exec.Command(e.cfg.NemoBin, "serve",
		"--host", "127.0.0.1", "--port", e.cfg.NemoPort,
		"--asr-model", e.cfg.Model, "--device", "cpu", "--no-ui", "--api-key", e.nemoKey)
	// ★ SENTENCE DETECTION ONLY FOR THE ROBOT VOICE (2026-09-28). With asr.endpointing.enable the server ends an
	// utterance at every ~0.8 s pause and the next one starts fresh; it was switched on for the robot voice, and
	// plain dictation was found to be "doing better before". So the DEFAULT is plain streaming — the server as
	// it shipped, no pause cutting, full context — and the flag is added only while the robot voice is on
	// (POST /api/rudder/mode), where speaking sentence by sentence needs it. Changing it restarts this server.
	eou := e.eou.Load()
	if eou {
		cmd.Args = append(cmd.Args, "--asr.endpointing.enable=true")
	}
	cmd.SysProcAttr = childAttr() // dies with us
	out, _ := cmd.StdoutPipe()
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		e.setState("error", "could not start nemo-speech: "+err.Error())
		return
	}
	e.mu.Lock()
	e.nemo = cmd
	e.nemoEOU = eou
	e.mu.Unlock()
	e.logs.add("nemo-speech serve started (pid %d) on 127.0.0.1:%s, sentence detection %s", cmd.Process.Pid, e.cfg.NemoPort, map[bool]string{true: "ON (robot voice)", false: "off (plain streaming)"}[eou])
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := out.Read(buf)
			for _, l := range strings.Split(strings.TrimSpace(string(buf[:n])), "\n") {
				if l != "" {
					e.logs.add("[nemo] %s", l)
				}
			}
			if err != nil {
				return
			}
		}
	}()
	go func() {
		err := cmd.Wait()
		e.mu.Lock()
		replaced := e.nemo != cmd // a planned restart (applyEOU) already moved on — not a crash
		e.mu.Unlock()
		if !replaced {
			e.setState("error", fmt.Sprintf("nemo-speech exited: %v", err))
		}
	}()
	// Ready = the model list answers.
	go func() {
		url := "http://127.0.0.1:" + e.cfg.NemoPort + "/v1/models"
		for i := 0; i < 600; i++ {
			time.Sleep(500 * time.Millisecond)
			req, _ := http.NewRequest(http.MethodGet, url, nil)
			req.Header.Set("Authorization", "Bearer "+e.nemoKey)
			resp, err := http.DefaultClient.Do(req)
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode == 200 {
					e.logs.add("nemo-speech ready after %.1fs", float64(i+1)*0.5)
					e.setState("ready", "")
					return
				}
			}
			e.mu.Lock()
			s := e.state
			e.mu.Unlock()
			if s == "error" {
				return
			}
		}
		e.setState("error", "nemo-speech did not become ready within 5 minutes")
	}()
}

// recorderCmds: raw s16le 16 kHz mono PCM on stdout. parec first — on PipeWire/Bluetooth desktops it
// talks to the sound server directly (the old Rudder's hardest-won lesson: PortAudio/ALSA-only
// capture stalls on Bluetooth headsets).
// RUDDER_RECORDER overrides the list with one space-separated command (e.g. a test that replays a
// PCM file), so the engine can be tested end to end without a microphone.
// device is a sound-server source name from /api/rudder/devices; empty = the system default input.
func recorderCmds(device string) [][]string {
	if v := os.Getenv("RUDDER_RECORDER"); v != "" {
		return [][]string{strings.Fields(v)}
	}
	parec := []string{"parec", "--format=s16le", "--rate=16000", "--channels=1", "--raw", "--latency-msec=100"}
	pw := []string{"pw-record", "--format=s16", "--rate=16000", "--channels=1"}
	if device != "" {
		parec = append(parec, "--device="+device)
		pw = append(pw, "--target="+device)
	}
	pw = append(pw, "-")
	cmds := [][]string{parec, pw}
	if device == "" { // arecord can't address a sound-server source by name
		cmds = append(cmds, []string{"arecord", "-q", "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "raw"})
	}
	return cmds
}

// browserAudio: RUDDER_AUDIO=browser — the engine runs on a server (the cloud dev server), where there is
// no microphone of the reader's to record. The page captures its own mic and streams 16 kHz s16le PCM to
// /api/rudder/stream; that stream feeds the same pump and speech session as a local recorder.
func browserAudio() bool { return os.Getenv("RUDDER_AUDIO") == "browser" }

func (e *engine) start(lang, device string) error { return e.startWith(lang, device, nil, nil) }

// startWith starts a session. src, when set, is the audio source (a browser stream); nil spawns a local recorder.
func (e *engine) startWith(lang, device string, src *recorderProc, sink func(event)) error {
	browser := src != nil
	// A session's events go to ITS reader (a browser session's own socket), captured here, so a session
	// still draining its last words after Stop never writes into the next reader's session.
	emit := func(ev event) {
		if sink != nil {
			sink(ev)
			return
		}
		e.hub.send(ev)
	}
	e.mu.Lock()
	if e.state != "ready" {
		e.mu.Unlock()
		return fmt.Errorf("engine is %s — wait for it to be ready", e.state)
	}
	if e.recording {
		e.mu.Unlock()
		if browser {
			return errors.New("busy — someone else is recording on this server; try again when they stop")
		}
		return nil
	}
	if lang == "" {
		lang = e.cfg.Language
	}
	e.mu.Unlock()

	// dial opens a transcription stream on the speech server; used again to RECONNECT mid-recording.
	dial := func() (*websocket.Conn, error) {
		c, _, err := websocket.DefaultDialer.Dial("ws://127.0.0.1:"+e.cfg.NemoPort+"/v1/audio/transcriptions/realtime",
			http.Header{"Authorization": {"Bearer " + e.nemoKey}})
		if err != nil {
			return nil, fmt.Errorf("connect to speech server: %w", err)
		}
		upd, _ := json.Marshal(event{"type": "session.update", "session": event{
			"sample_rate": 16000, "language": lang, "automatic_punctuation": true, "endpointing_ms": e.cfg.EndpointMs,
		}})
		if err := c.WriteMessage(websocket.TextMessage, upd); err != nil {
			c.Close()
			return nil, fmt.Errorf("session.update: %w", err)
		}
		return c, nil
	}
	ws, err := dial()
	if err != nil {
		return err
	}

	// Bluetooth headsets start on CVSD, not mSBC. Measured 2026-09-27 on a Bluetooth headset: on mSBC the
	// mic link died 3-5 s into EVERY session that had speech (kernel: corrupted SCO packets); after
	// switching to CVSD it ran 9.5 minutes without a drop. CVSD is 8 kHz, and Nemotron's transcript of an
	// 8 kHz copy of the test clip differed by one word. RUDDER_KEEP_MSBC=1 opts out.
	if card := btCard(device); !browser && card != "" && os.Getenv("RUDDER_KEEP_MSBC") == "" {
		if p := currentProfile(card); p == "headset-head-unit-msbc" {
			e.logs.add("bluetooth headset on mSBC — switching to CVSD before recording (stable voice link)")
			emit(event{"type": "recovering", "message": "Switching your Bluetooth headset to its stable voice mode…"})
			if err := switchProfile(card, e.logs); err != nil {
				e.logs.add("pre-switch to CVSD failed: %v", err)
			} else {
				emit(event{"type": "recovered", "message": "Headset is in its stable voice mode — go ahead and talk."})
			}
		}
	}

	first := src
	if first == nil {
		first, err = spawnRecorder(device, e.logs)
		if err != nil {
			ws.Close()
			return err
		}
	}
	recName := first.name
	var recMu sync.Mutex
	cur := first // the live recorder; replaced when a dead mic link is recovered

	ctx, cancel := context.WithCancel(context.Background())
	var writeMu sync.Mutex // guards ws and done, which a reconnect replaces
	var done chan struct{}
	var lastWords atomic.Int64 // unix ms of the last text from the speech server (falling-behind detector)
	lastWords.Store(time.Now().UnixMilli())

	e.mu.Lock()
	e.recording, e.recorder, e.language, e.device = true, recName, lang, device
	e.stopSession = func() {
		cancel()
		recMu.Lock()
		cur.kill()
		recMu.Unlock()
		writeMu.Lock()
		// The streaming model holds back the last fraction of a second (its right context) until more audio
		// or a pause arrives, and a commit alone does not flush it (measured: a Stop mid-sentence lost "what
		// your country…"). 1.2 s of silence first lets it finish the words already spoken.
		silence := make([]byte, 3200)
		for i := 0; i < 12; i++ {
			_ = ws.WriteMessage(websocket.BinaryMessage, silence)
		}
		_ = ws.WriteMessage(websocket.TextMessage, []byte(`{"type":"input_audio_buffer.commit"}`))
		curWS, curDone := ws, done
		writeMu.Unlock()
		// Let the final words arrive. A shared server's CPU can run behind real time (measured: a loaded
		// 8-core box finished an 11 s clip ~15 s after it ended), so a browser session waits longer.
		wait := 4 * time.Second
		if browser {
			wait = 30 * time.Second
		}
		select {
		case <-curDone:
		case <-time.After(wait):
		}
		curWS.Close()
		emit(event{"type": "recording", "recording": false})
	}
	e.mu.Unlock()
	if browser {
		e.logs.add("recording started: recorder=browser language=%s", lang)
	} else {
		e.logs.add("recording started: recorder=%s device=%q language=%s profile=%s", recName, device, lang, currentProfile(btCard(device)))
		go watchKernelBluetooth(ctx, e.logs)
	}
	emit(event{"type": "recording", "recording": true, "recorder": recName, "language": lang, "device": device})
	for _, d := range e.devs.current().Devices {
		if (d.ID == device || (device == "" && d.Default)) && d.Muted {
			emit(event{"type": "warning", "message": "Your microphone \"" + d.Label + "\" is muted in the system sound settings — unmute it or nothing will be heard."})
		}
	}

	var reconnect func(why string) // assigned below, with the reader it restarts
	// Audio pump: 100 ms frames → speech server, plus a level meter and dead-mic RECOVERY.
	go func() {
		frame := make([]byte, 3200)
		var silentSince time.Time
		recoveries := 0
		var recovering atomic.Bool
		var resetting atomic.Bool
		tracePeak, lastTrace := 0, time.Now()
		var lastLoud time.Time
		behindWarned := false
		var healthySince time.Time // a mic that stays healthy 30 s earns back its 3 reconnects
		gaveUp := false
		lastLevel := time.Time{}
		for {
			recMu.Lock()
			r := cur
			recMu.Unlock()
			if _, err := io.ReadFull(r.out, frame); err != nil {
				if ctx.Err() != nil {
					return
				}
				recMu.Lock()
				swapped := cur != r
				recMu.Unlock()
				if swapped { // we killed it ourselves during a recovery: read from the new one
					continue
				}
				// A headset reset restarts PipeWire, which kills parec mid-read. That is expected:
				// wait for the reset to hand over a fresh recorder instead of ending the session.
				if resetting.Load() {
					for resetting.Load() && ctx.Err() == nil {
						time.Sleep(200 * time.Millisecond)
					}
					continue
				}
				if browser {
					e.logs.add("browser audio stream ended: %v", err)
					emit(event{"type": "error", "message": "The browser stopped sending microphone audio (the page was closed or lost its connection)."})
					go e.stop()
					return
				}
				// The recorder died on its own (bad device, sound server unreachable, device unplugged).
				// End the session so the UI stops showing "Listening", and say WHY in plain words.
				_ = r.cmd.Wait()
				why := strings.TrimSpace(r.errBuf.String())
				e.logs.add("recorder %s ended unexpectedly: %v | stderr: %s", r.name, err, why)
				msg := "The microphone stopped delivering audio."
				switch {
				case strings.Contains(why, "Connection refused") || strings.Contains(why, "pa_context_connect"):
					msg = "Can't reach the computer's sound system (PipeWire/PulseAudio). Is it running?"
				case strings.Contains(why, "No such entity") || strings.Contains(why, "not found"):
					msg = "That microphone isn't available any more — it may have been unplugged or disconnected. Pick another one."
				}
				if why != "" {
					msg += " (" + r.name + ": " + why + ")"
				}
				emit(event{"type": "error", "message": msg})
				go e.stop()
				return
			}
			peak := 0
			for i := 0; i+1 < len(frame); i += 2 {
				v := int(int16(binary.LittleEndian.Uint16(frame[i:])))
				if v < 0 {
					v = -v
				}
				if v > peak {
					peak = v
				}
			}
			// ★ DEAD MIC LINK. Exact-zero samples are not quiet speech (a live mic always has a noise
			// floor). Measured 2026-09-27 on a Bluetooth headset (HFP, mSBC): four words
			// transcribed, then literal zeros while parec stayed "healthy" — the old Rudder's BUG 1,
			// the headset losing the mic side of the link. Re-opening the source restarts the audio
			// stream; the speech session and the transcript carry on untouched.
			// ROBOT VOICE SPEAKING (tts.go, /api/rudder/duck): the transcriber hears silence, so the robot's own
			// voice through a loudspeaker is never transcribed back into the box — and that deliberate silence
			// must not look like a dead mic link to the check below.
			if e.ducked.Load() {
				clear(frame)
				silentSince = time.Time{}
			} else if peak == 0 && !browser {
				if silentSince.IsZero() {
					silentSince = time.Now()
				} else if !gaveUp && !resetting.Load() && time.Since(silentSince) > 1500*time.Millisecond {
					recoveries++
					switch {
					case recoveries == 1:
						// Step 1: reopen the recorder (cheap; fixes a stalled stream).
						e.logs.add("mic link dead (exact zeros 1.5s) — step 1: reopening the microphone")
						emit(event{"type": "recovering", "attempt": recoveries, "message": "Microphone went silent — reconnecting it…"})
						if next, err := spawnRecorder(device, e.logs); err == nil {
							recMu.Lock()
							old := cur
							cur = next
							recMu.Unlock()
							old.kill()
							recovering.Store(true)
						}
					case recoveries == 2 && btCard(device) != "":
						// Step 2: force a NEW Bluetooth voice link by switching the headset's voice profile to
						// CVSD (the old Rudder's proven-stabler choice). Unlike a detect-first reset script this does not
						// "detect first", so it can't decide a dead link is fine.
						card := btCard(device)
						e.logs.add("mic still dead — step 2: forcing a new voice link: %s → headset-head-unit-cvsd", card)
						emit(event{"type": "recovering", "attempt": recoveries, "message": "Microphone still silent — switching your Bluetooth headset to its more stable voice mode…"})
						resetting.Store(true)
						go func() {
							defer resetting.Store(false)
							if err := switchProfile(card, e.logs); err != nil {
								emit(event{"type": "warning", "message": "Couldn't switch the headset's voice mode: " + err.Error()})
								return
							}
							if next, err := spawnRecorder(device, e.logs); err == nil {
								recMu.Lock()
								old := cur
								cur = next
								recMu.Unlock()
								old.kill()
								recovering.Store(true)
							}
						}()
					case recoveries == 3 && btResetPath() != "":
						// Step 3: full headset reset (disconnect → restart PipeWire → reconnect).
						e.logs.add("mic still dead — step 3: full headset reset via RUDDER_BT_RESET")
						emit(event{"type": "recovering", "attempt": recoveries, "message": "Still silent — fully resetting your Bluetooth headset (about 15 seconds)…"})
						resetting.Store(true)
						go func() {
							defer resetting.Store(false)
							ok, ran := runHeadsetReset(e.logs)
							if !ran {
								return
							}
							if !ok {
								emit(event{"type": "warning", "message": "The headset reset didn't bring the mic back — is the headset on and in range?"})
							}
							if next, err := spawnRecorder(device, e.logs); err == nil {
								recMu.Lock()
								old := cur
								cur = next
								recMu.Unlock()
								old.kill()
								recovering.Store(true)
							}
						}()
					default:
						gaveUp = true
						e.logs.add("mic still dead after reopen + headset resets — giving up for this session")
						msg := "Your microphone keeps going silent. This is the Bluetooth headset dropping its mic link (the kernel reports corrupted voice packets), not Rudder. Try a wired or built-in mic, or turn off the headset's noise cancellation / adaptive audio in its app."
						if btResetPath() == "" {
							msg += " (No headset-reset command is configured — see RUDDER_BT_RESET.)"
						}
						emit(event{"type": "warning", "message": msg})
					}
					silentSince = time.Now()
				}
			} else {
				if recovering.Load() {
					recovering.Store(false)
					healthySince = time.Now()
					e.logs.add("mic recovered after %d reconnect(s)", recoveries)
					emit(event{"type": "recovered", "message": "Microphone is back — keep talking."})
				}
				if recoveries > 0 && !healthySince.IsZero() && time.Since(healthySince) > 30*time.Second {
					recoveries, gaveUp, healthySince = 0, false, time.Time{}
				}
				silentSince = time.Time{}
			}
			// Flight recorder: the mic level twice a second, so a drop can be lined up against kernel and
			// sound-server events in the same log (/api/rudder/log).
			tracePeak = max(tracePeak, peak)
			if time.Since(lastTrace) >= 500*time.Millisecond {
				e.logs.add("trace level peak=%d", tracePeak)
				tracePeak, lastTrace = 0, time.Now()
			}
			if time.Since(lastLevel) > 150*time.Millisecond {
				lastLevel = time.Now()
				emit(event{"type": "level", "peak": float64(peak) / 32768})
			}
			// ★ FALLING BEHIND: the mic clearly carries speech but no words have come back for 10 s — the speech
			// server is starved of CPU (measured 2026-09-28: another heavy process maxed the CPU and the stream
			// froze with no message). Say so once; it clears as soon as words arrive again.
			if peak > 2500 {
				lastLoud = time.Now()
			}
			if !behindWarned && time.Since(lastLoud) < 2*time.Second && time.Now().UnixMilli()-lastWords.Load() > 10000 {
				behindWarned = true
				e.logs.add("falling behind: speech in, no words for 10 s")
				emit(event{"type": "warning", "message": "The speech engine is falling behind — another program is using a lot of CPU. Your words will catch up; closing heavy programs helps."})
			} else if behindWarned && time.Now().UnixMilli()-lastWords.Load() < 2000 {
				behindWarned = false
				emit(event{"type": "recovered", "message": "Caught up."})
			}
			writeMu.Lock()
			err := ws.WriteMessage(websocket.BinaryMessage, frame)
			writeMu.Unlock()
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				reconnect("send: " + err.Error()) // keep streaming; frames during the reconnect are dropped
				continue
			}
		}
	}()

	// Result reader: map the server's events onto the plugin's small vocabulary. One reader per stream;
	// a RECONNECT starts a new one on the new stream.
	var reconnecting atomic.Bool
	var startReader func(ws *websocket.Conn)
	// ★ RECONNECT (measured 2026-09-28: "speech server connection lost: … broken pipe" ended a live
	// recording). When the stream to the speech server breaks mid-recording, open a new one and keep going.
	// The words that were still in flight on the old stream are finalised, so the box keeps them.
	reconnect = func(why string) {
		if ctx.Err() != nil || !reconnecting.CompareAndSwap(false, true) {
			return
		}
		e.logs.add("speech stream broke (%s) — reconnecting", why)
		emit(event{"type": "recovering", "message": "Reconnecting to the speech engine…"})
		go func() {
			defer reconnecting.Store(false)
			for attempt := 1; attempt <= 5 && ctx.Err() == nil; attempt++ {
				nws, err := dial()
				if err == nil {
					writeMu.Lock()
					old := ws
					ws = nws
					startReader(nws)
					writeMu.Unlock()
					old.Close()
					lastWords.Store(time.Now().UnixMilli())
					e.logs.add("speech stream reconnected (attempt %d)", attempt)
					emit(event{"type": "recovered", "message": "Reconnected — keep talking."})
					return
				}
				e.logs.add("reconnect attempt %d failed: %v", attempt, err)
				time.Sleep(time.Duration(attempt) * time.Second)
			}
			if ctx.Err() == nil {
				emit(event{"type": "error", "message": "The speech engine stopped answering. Press Record to try again."})
				go e.stop()
			}
		}()
	}
	startReader = func(ws *websocket.Conn) {
		d := make(chan struct{})
		done = d
		go func() {
			defer close(d)
			committed := false
			var inFlight strings.Builder // this stream's words not yet finalised
			for {
				_, msg, err := ws.ReadMessage()
				if err != nil {
					if !committed && ctx.Err() == nil {
						if inFlight.Len() > 0 {
							emit(event{"type": "final", "text": inFlight.String(), "at": time.Now().Format(time.RFC3339)})
						}
						reconnect("read: " + err.Error())
					}
					return
				}
				var m map[string]any
				if json.Unmarshal(msg, &m) != nil {
					continue
				}
				t, _ := m["type"].(string)
				text := firstString(m, "transcript", "delta", "text")
				switch {
				case strings.HasSuffix(t, "input_audio_transcription.delta"):
					if committed {
						_ = ws.SetReadDeadline(time.Now().Add(6 * time.Second))
					}
					// Deltas APPEND to the utterance in progress; the server sends many empty ones.
					if text != "" {
						lastWords.Store(time.Now().UnixMilli())
						inFlight.WriteString(text)
						emit(event{"type": "partial", "text": text})
					}
				case strings.HasSuffix(t, "input_audio_transcription.completed"):
					lastWords.Store(time.Now().UnixMilli())
					inFlight.Reset()
					emit(event{"type": "final", "text": text, "at": time.Now().Format(time.RFC3339)})
					if committed {
						return // the last utterance after Stop is in
					}
				case t == "error":
					e.logs.add("speech server error: %s", string(msg))
					emit(event{"type": "error", "message": string(msg)})
				case t == "input_audio_buffer.committed":
					// The commit acknowledges Stop; the words for the audio before it can still follow (measured: a
					// Stop mid-word lost "what your country…"). Keep reading until the final text or 6 s of quiet (a loaded server can take seconds per backlog chunk).
					committed = true
					e.logs.add("speech server committed the stream; reading its last words")
					_ = ws.SetReadDeadline(time.Now().Add(6 * time.Second))
					continue
				default:
					e.logs.add("speech event: %s", t)
				}
			}
		}()
	}
	writeMu.Lock()
	startReader(ws)
	writeMu.Unlock()
	return nil
}

// recorderProc is one running recorder process.
type recorderProc struct {
	cmd    *exec.Cmd
	out    io.ReadCloser
	name   string
	errBuf *bytes.Buffer
	closer io.Closer // a browser source: closing it ends the stream
}

func (r *recorderProc) kill() {
	if r != nil && r.closer != nil {
		_ = r.closer.Close()
	}
	if r != nil && r.cmd != nil && r.cmd.Process != nil {
		_ = r.cmd.Process.Kill()
		go func() { _ = r.cmd.Wait() }()
	}
}

// spawnRecorder starts the first recorder that works for this device.
func spawnRecorder(device string, logs *ring) (*recorderProc, error) {
	for _, c := range recorderCmds(device) {
		if _, err := exec.LookPath(c[0]); err != nil {
			continue
		}
		cmd := exec.Command(c[0], c[1:]...)
		cmd.Env = audioEnv()
		cmd.SysProcAttr = childAttr()
		errBuf := &bytes.Buffer{}
		cmd.Stderr = errBuf
		out, err := cmd.StdoutPipe()
		if err != nil {
			continue
		}
		if err := cmd.Start(); err != nil {
			logs.add("recorder %s failed to start: %v", c[0], err)
			continue
		}
		return &recorderProc{cmd: cmd, out: out, name: c[0], errBuf: errBuf}, nil
	}
	return nil, errors.New("no microphone recorder found (need parec, pw-record or arecord)")
}

func firstString(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if s, ok := m[k].(string); ok {
			return s
		}
	}
	if item, ok := m["item"].(map[string]any); ok {
		return firstString(item, keys...)
	}
	return ""
}

// applyEOU restarts the speech server when the wanted sentence-detection setting differs from the running one.
// Never mid-recording: then it waits, and stop() applies it.
func (e *engine) applyEOU() {
	e.mu.Lock()
	if e.recording || e.nemoEOU == e.eou.Load() || e.nemo == nil {
		e.mu.Unlock()
		return
	}
	old := e.nemo
	e.nemo = nil
	e.mu.Unlock()
	e.logs.add("restarting the speech server: sentence detection %s", map[bool]string{true: "on", false: "off"}[e.eou.Load()])
	if old.Process != nil {
		_ = old.Process.Kill()
	}
	for i := 0; i < 30; i++ { // let the port free up before the new server binds it
		c, err := net.DialTimeout("tcp", "127.0.0.1:"+e.cfg.NemoPort, 200*time.Millisecond)
		if err != nil {
			break
		}
		c.Close()
		time.Sleep(100 * time.Millisecond)
	}
	e.startNemo()
}

func (e *engine) stop() {
	e.mu.Lock()
	stop := e.stopSession
	e.stopSession = nil
	was := e.recording
	e.recording = false
	e.mu.Unlock()
	if !was || stop == nil {
		return
	}
	e.logs.add("recording stopping")
	stop()          // sends "recording false" to the session's own reader once its last words are in
	go e.applyEOU() // a robot-voice switch made while recording is applied now
}

func (e *engine) shutdown() {
	e.stop()
	e.mu.Lock()
	n := e.nemo
	e.mu.Unlock()
	if n != nil && n.Process != nil {
		_ = n.Process.Kill()
	}
}

// ─── HTTP API ────────────────────────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// guard: two protections for a server that streams what you say.
//   - Host check (DNS rebinding): a web page on any domain can make the browser resolve its own hostname
//     to 127.0.0.1 and then read this API as "same-origin". Only requests addressed to 127.0.0.1 or
//     localhost are served.
//   - CORS: only the desktop webview's origin (tauri://localhost, or http://tauri.localhost on Windows)
//     may read responses cross-origin. The Plugin Studio needs none: it reaches /api/rudder through the
//     dev server's same-origin proxy. RUDDER_ALLOW_ORIGIN adds one more exact origin (tests).
//
// allowedHost: RUDDER_ALLOW_HOST (comma-separated) names the public host of a server deployment, whose own
// sign-in (oauth2-proxy) sits in front of the dev server that proxies /api/rudder here. Unset = loopback only.
func allowedHost(host string) bool {
	for _, h := range strings.Split(os.Getenv("RUDDER_ALLOW_HOST"), ",") {
		if h = strings.TrimSpace(h); h != "" && h == host {
			return true
		}
	}
	return false
}

func guard(next http.Handler) http.Handler {
	extra := os.Getenv("RUDDER_ALLOW_ORIGIN")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if i := strings.LastIndex(host, ":"); i >= 0 && !strings.HasSuffix(host, "]") {
			host = host[:i]
		}
		if host != "127.0.0.1" && host != "localhost" && host != "[::1]" && !allowedHost(host) {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		o := r.Header.Get("Origin")
		if o == "tauri://localhost" || o == "http://tauri.localhost" || (extra != "" && o == extra) {
			w.Header().Set("Access-Control-Allow-Origin", o)
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	cfg := loadConfig()
	logs := &ring{}
	h := &hub{clients: map[chan []byte]struct{}{}}
	key := make([]byte, 24)
	if _, err := rand.Read(key); err != nil {
		log.Fatal("no randomness for the speech-server key: ", err)
	}
	e := &engine{cfg: cfg, logs: logs, hub: h, state: "starting", devs: &deviceWatcher{hub: h, logs: logs}, nemoKey: hex.EncodeToString(key)}
	e.devs.run()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/rudder/status", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, e.status())
	})
	mux.HandleFunc("/api/rudder/start", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, 405, event{"error": "POST only"})
			return
		}
		var body struct {
			Language string `json:"language"`
			Device   string `json:"device"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if browserAudio() {
			writeJSON(w, 409, event{"error": "this engine takes the browser's microphone: stream to /api/rudder/stream"})
			return
		}
		if err := e.start(body.Language, body.Device); err != nil {
			e.logs.add("start failed: %v", err)
			writeJSON(w, 409, event{"error": err.Error()})
			return
		}
		writeJSON(w, 200, e.status())
	})
	// /api/rudder/stream (RUDDER_AUDIO=browser): a WebSocket of binary 16 kHz mono s16le PCM frames from the
	// page's microphone. Opening it starts a session, closing it stops one; the text comes back on /events.
	// The upgrader's default origin check (Origin must match Host) keeps other sites out.
	// Origin: the page's own host (the dev server proxy), a desktop app's webview (tauri://localhost, or
	// http://tauri.localhost on Windows — the same origins guard() answers CORS for), or RUDDER_ALLOW_ORIGIN.
	// Anything else is another site and is refused.
	upgrader := websocket.Upgrader{ReadBufferSize: 8192, CheckOrigin: func(r *http.Request) bool {
		o := r.Header.Get("Origin")
		if o == "" || o == "tauri://localhost" || o == "http://tauri.localhost" || (os.Getenv("RUDDER_ALLOW_ORIGIN") != "" && o == os.Getenv("RUDDER_ALLOW_ORIGIN")) {
			return true
		}
		u, err := url.Parse(o)
		return err == nil && strings.EqualFold(u.Host, r.Host)
	}}
	mux.HandleFunc("/api/rudder/stream", func(w http.ResponseWriter, r *http.Request) {
		if !browserAudio() {
			writeJSON(w, 409, event{"error": "this engine records a local microphone (RUDDER_AUDIO is not browser)"})
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		pr, pw := io.Pipe()
		src := &recorderProc{out: pr, name: "browser", errBuf: &bytes.Buffer{}, closer: pr}
		var wmu sync.Mutex
		sink := func(ev event) {
			b, _ := json.Marshal(ev)
			wmu.Lock()
			_ = conn.WriteMessage(websocket.TextMessage, b)
			wmu.Unlock()
		}
		if err := e.startWith(r.URL.Query().Get("language"), "", src, sink); err != nil {
			e.logs.add("stream start failed: %v", err)
			_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(4409, err.Error()))
			return
		}
		for {
			t, b, err := conn.ReadMessage()
			if err != nil {
				break
			}
			if t != websocket.BinaryMessage {
				// {"type":"stop"}: end the session but keep the socket open, so the last words (sent after the
				// speech server's commit) still reach this reader; the page closes the socket after "recording false".
				if bytes.Contains(b, []byte(`"stop"`)) {
					go e.stop()
				}
				continue
			}
			if _, err := pw.Write(b); err != nil {
				break // the session stopped (its pipe was closed)
			}
		}
		e.stop()
	})
	mux.HandleFunc("/api/rudder/stop", func(w http.ResponseWriter, r *http.Request) {
		e.stop()
		writeJSON(w, 200, e.status())
	})
	mux.HandleFunc("/api/rudder/devices", func(w http.ResponseWriter, r *http.Request) {
		e.devs.refresh("request")
		writeJSON(w, 200, e.devs.current())
	})
	mux.HandleFunc("/api/rudder/test", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Device string `json:"device"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		writeJSON(w, 200, e.micTest(body.Device))
	})
	registerTTS(mux, e, newTTS(filepath.Dir(filepath.Dir(cfg.Model)), logs))
	mux.HandleFunc("/api/rudder/log", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = io.WriteString(w, logs.text())
	})
	mux.HandleFunc("/api/rudder/events", func(w http.ResponseWriter, r *http.Request) {
		fl, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", 500)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Accel-Buffering", "no")
		c := e.hub.subscribe()
		defer e.hub.unsubscribe(c)
		first, _ := json.Marshal(event{"type": "status", "status": e.status()})
		fmt.Fprintf(w, "data: %s\n\n", first)
		devs, _ := json.Marshal(event{"type": "devices", "devices": e.devs.current()})
		fmt.Fprintf(w, "data: %s\n\n", devs)
		fl.Flush()
		ping := time.NewTicker(15 * time.Second)
		defer ping.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case b := <-c:
				fmt.Fprintf(w, "data: %s\n\n", b)
				fl.Flush()
			case <-ping.C:
				fmt.Fprint(w, ": ping\n\n")
				fl.Flush()
			}
		}
	})

	srv := &http.Server{Addr: "127.0.0.1:" + cfg.Port, Handler: guard(mux)}
	logs.add("rudder-engine listening on http://127.0.0.1:%s (runtime=%s model=%s)", cfg.Port, cfg.NemoBin, cfg.Model)
	e.startNemo()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sig
		e.shutdown()
		os.Exit(0)
	}()
	if err := srv.ListenAndServe(); err != nil {
		e.shutdown()
		log.Fatal(err)
	}
}
