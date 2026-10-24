// tts.go — Robot voice: speak what Rudder transcribes in a synthetic voice, so someone can record a video
// that uses dictation without their real voice in it.
//
// PROVIDER: Piper (rhasspy/piper 2023.11.14-2, MIT, archived — a frozen, pinnable release), run here in the
// engine rather than in the page: one small native binary on the CPU, the same audio in the Plugin Studio,
// the desktop webview and the Studio corner, and no WebAssembly runtime shipped through the page.
//
// OFFLINE, NO TELEMETRY (measured 2026-09-28): the bundled ONNX Runtime is 1.14.1, which carries none of
// the telemetry client later versions ship (0 "OneCollector"/events strings); a synthesis traced with strace
// made 0 network calls. The voice files are local and pinned by SHA-256 (setup-runtime.sh).
//
// PRIVACY: the text to speak is never logged — only its length.
//
//	POST /api/rudder/tts          {"text", "voice", "speaker", "speed"} → audio/wav
//	GET  /api/rudder/tts/voices   the voices installed under RUDDER_HOME/tts
//	POST /api/rudder/duck         {"on": bool} — while on, the transcriber hears silence (the robot's own
//	                              voice through a loudspeaker must not be transcribed back into the box)
package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type ttsVoice struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	Speakers   int    `json:"speakers"`
	SampleRate int    `json:"sampleRate"`
	model      string
}

type ttsEngine struct {
	dir   string // RUDDER_TTS_DIR (default RUDDER_HOME/tts): piper/ + <voice>.onnx + <voice>.onnx.json
	piper string
	logs  *ring
	mu    sync.Mutex // one synthesis at a time: CPU is shared with speech-to-text
	// highPerf: the robot voice is ON (experimental "High performance mode"). Off = thin-client mode, the
	// default: no robot process ever runs, and when one does it yields the CPU to speech-to-text.
	highPerf atomic.Bool
}

func newTTS(base string, logs *ring) *ttsEngine {
	dir := envOr("RUDDER_TTS_DIR", filepath.Join(base, "tts"))
	bin := "piper"
	if runtime.GOOS == "windows" {
		bin = "piper.exe"
	}
	return &ttsEngine{dir: dir, piper: envOr("RUDDER_PIPER_BIN", filepath.Join(dir, "piper", bin)), logs: logs}
}

// voices lists every <name>.onnx with its <name>.onnx.json next to it.
func (t *ttsEngine) voices() ([]ttsVoice, error) {
	if _, err := os.Stat(t.piper); err != nil {
		return nil, errors.New("Piper is not installed (run backend/rudder-engine/setup-runtime.sh)")
	}
	matches, _ := filepath.Glob(filepath.Join(t.dir, "*.onnx"))
	var out []ttsVoice
	for _, m := range matches {
		b, err := os.ReadFile(m + ".json")
		if err != nil {
			continue
		}
		var cfg struct {
			Audio struct {
				SampleRate int `json:"sample_rate"`
			} `json:"audio"`
			NumSpeakers int `json:"num_speakers"`
		}
		if json.Unmarshal(b, &cfg) != nil || cfg.Audio.SampleRate == 0 {
			continue
		}
		id := strings.TrimSuffix(filepath.Base(m), ".onnx")
		out = append(out, ttsVoice{ID: id, Label: voiceLabel(id), Speakers: max(cfg.NumSpeakers, 1), SampleRate: cfg.Audio.SampleRate, model: m})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	if len(out) == 0 {
		return nil, errors.New("no Piper voice installed (run backend/rudder-engine/setup-runtime.sh)")
	}
	return out, nil
}

// "en_US-libritts_r-medium" → "English (US) · libritts_r"
func voiceLabel(id string) string {
	parts := strings.Split(id, "-")
	if len(parts) < 2 {
		return id
	}
	lang := map[string]string{"en_US": "English (US)", "en_GB": "English (UK)"}[parts[0]]
	if lang == "" {
		lang = parts[0]
	}
	return lang + " · " + parts[1]
}

var errTTSInput = errors.New("bad request")

func (t *ttsEngine) synthesize(ctx context.Context, text, voiceID string, speaker int, speed float64) ([]byte, error) {
	text = strings.TrimSpace(strings.ReplaceAll(text, "\n", " "))
	if text == "" || len([]rune(text)) > 2000 {
		return nil, fmt.Errorf("%w: text must be 1–2000 characters", errTTSInput)
	}
	vs, err := t.voices()
	if err != nil {
		return nil, err
	}
	v := vs[0]
	for _, x := range vs {
		if x.ID == voiceID {
			v = x
		}
	}
	if speaker < 0 || speaker >= v.Speakers {
		speaker = 0
	}
	// Piper's length_scale is the inverse of speed (1.0 = normal; larger = slower).
	if speed < 0.5 || speed > 2 {
		speed = 1
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, t.piper, "--model", v.model, "--output-raw",
		"--speaker", strconv.Itoa(speaker), "--length_scale", strconv.FormatFloat(1/speed, 'f', 3, 64))
	cmd.Dir = filepath.Dir(t.piper) // its libraries and espeak-ng-data sit next to it
	cmd.Stdin = strings.NewReader(text + "\n")
	var pcm, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &pcm, &stderr
	start := time.Now()
	err = cmd.Start()
	if err == nil {
		if !t.highPerf.Load() {
			yieldCPU(cmd.Process.Pid) // thin-client mode: speech-to-text keeps priority over the robot voice
		}
		err = cmd.Wait()
	}
	if err != nil {
		t.logs.add("robot voice failed after %s: %v", time.Since(start).Round(time.Millisecond), err)
		return nil, errors.New("the voice engine failed — see the engine log")
	}
	t.logs.add("robot voice: %d characters → %.1f s of audio in %s (voice %s, speaker %d)",
		len([]rune(text)), float64(pcm.Len())/2/float64(v.SampleRate), time.Since(start).Round(time.Millisecond), v.ID, speaker)
	return wav(pcm.Bytes(), v.SampleRate), nil
}

// wav wraps 16-bit mono little-endian PCM in a WAV header.
func wav(pcm []byte, rate int) []byte {
	var b bytes.Buffer
	w := func(v any) { _ = binary.Write(&b, binary.LittleEndian, v) }
	b.WriteString("RIFF")
	w(uint32(36 + len(pcm)))
	b.WriteString("WAVEfmt ")
	w(uint32(16))
	w(uint16(1)) // PCM
	w(uint16(1)) // mono
	w(uint32(rate))
	w(uint32(rate * 2))
	w(uint16(2))
	w(uint16(16))
	b.WriteString("data")
	w(uint32(len(pcm)))
	b.Write(pcm)
	return b.Bytes()
}

func registerTTS(mux *http.ServeMux, e *engine, t *ttsEngine) {
	mux.HandleFunc("/api/rudder/tts/voices", func(w http.ResponseWriter, r *http.Request) {
		vs, err := t.voices()
		if err != nil {
			writeJSON(w, 200, event{"available": false, "error": err.Error(), "voices": []ttsVoice{}})
			return
		}
		writeJSON(w, 200, event{"available": true, "provider": "piper", "voices": vs})
	})
	mux.HandleFunc("/api/rudder/tts", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, 405, event{"error": "POST only"})
			return
		}
		var body struct {
			Text    string  `json:"text"`
			Voice   string  `json:"voice"`
			Speaker int     `json:"speaker"`
			Speed   float64 `json:"speed"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body); err != nil {
			writeJSON(w, 400, event{"error": "expected JSON {text, voice, speaker, speed}"})
			return
		}
		if !t.highPerf.Load() {
			// Thin-client mode (the default) never runs the robot voice — not even from an old saved setting.
			writeJSON(w, 409, event{"error": "The robot voice is off — turn it on in Settings (experimental)."})
			return
		}
		audio, err := t.synthesize(r.Context(), body.Text, body.Voice, body.Speaker, body.Speed)
		if err != nil {
			code := 500
			if errors.Is(err, errTTSInput) {
				code = 400
			}
			writeJSON(w, code, event{"error": err.Error()})
			return
		}
		w.Header().Set("Content-Type", "audio/wav")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(audio)
	})
	// POST /api/rudder/mode {"robot": bool} — thin-client mode (default) or the experimental High performance
	// mode the robot voice needs. Refused when the machine is short of memory: crashing someone's laptop with a
	// voice tool would be the worst outcome (the Piper voice needs ~150 MB while it speaks).
	mux.HandleFunc("/api/rudder/mode", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Robot bool `json:"robot"`
		}
		if r.Method == http.MethodPost {
			_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body)
			if body.Robot {
				if avail, ok := memAvailableMB(); ok && avail < 500 {
					writeJSON(w, 409, event{"mode": "thin-client", "error": fmt.Sprintf("Not enough free memory for the robot voice (%d MB free, needs about 500). Close some programs and try again.", avail)})
					return
				}
			}
			if t.highPerf.Swap(body.Robot) != body.Robot {
				e.logs.add("mode: %s", map[bool]string{true: "high performance (robot voice on, experimental)", false: "thin-client (default)"}[body.Robot])
			}
			// Sentence detection follows the robot voice: plain streaming by default (main.go startNemo).
			e.eou.Store(body.Robot)
			go e.applyEOU()
		}
		writeJSON(w, 200, event{"mode": map[bool]string{true: "high-performance", false: "thin-client"}[t.highPerf.Load()]})
	})
	mux.HandleFunc("/api/rudder/duck", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			On bool `json:"on"`
		}
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body)
		// Headphones hear the robot; the mic doesn't — so there is no echo to prevent, and pausing would only
		// throw away whatever the person says while the robot talks.
		if body.On && headphonesInUse() {
			body.On = false
		}
		if e.ducked.Swap(body.On) != body.On {
			e.logs.add("%s", map[bool]string{true: "listening paused: the robot voice is speaking", false: "listening resumed"}[body.On])
		}
		writeJSON(w, 200, event{"ducked": body.On})
	})
}

// headphonesInUse: the default output is a Bluetooth device or a wired headphone port, so the robot voice
// cannot leak back into the microphone. Unknown → false (pause, the safe choice for loudspeakers).
func headphonesInUse() bool {
	b, err := runPactl("get-default-sink")
	if err != nil {
		return false
	}
	sink := strings.TrimSpace(string(b))
	if strings.HasPrefix(sink, "bluez_output.") {
		return true
	}
	b, err = runPactl("-f", "json", "list", "sinks")
	if err != nil {
		return false
	}
	var sinks []struct {
		Name       string `json:"name"`
		ActivePort string `json:"active_port"`
	}
	if json.Unmarshal(b, &sinks) != nil {
		return false
	}
	for _, s := range sinks {
		if s.Name == sink {
			return strings.Contains(strings.ToLower(s.ActivePort), "headphone")
		}
	}
	return false
}

// memAvailableMB reads MemAvailable from /proc/meminfo (Linux). ok=false elsewhere: no guard there.
func memAvailableMB() (int, bool) {
	b, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, false
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "MemAvailable:") {
			f := strings.Fields(line)
			if len(f) >= 2 {
				kb, err := strconv.Atoi(f[1])
				if err == nil {
					return kb / 1024, true
				}
			}
		}
	}
	return 0, false
}
