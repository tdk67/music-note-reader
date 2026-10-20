"""
Multi-Instrument Audio & MIDI Synthesizer from MusicXML
-------------------------------------------------------
Converts MusicXML into:
1. 16-bit PCM WAV with selectable instrument timbres:
   - piano: Acoustic Grand Piano
   - organ: Church / Pipe Organ
   - strings: Bowed String Ensemble (Violin/Cello)
   - flute: Woodwind / Flute with gentle vibrato
   - epiano: Electric Piano / Rhodes bell-tine
   - music_box: Celesta / Music Box chime
   - chiptune: 8-Bit Retro Pulse Wave
2. Standard MIDI (Type 0 SMF) file.
"""

import os
import sys
import wave
import xml.etree.ElementTree as ET
import numpy as np
import scipy.signal as signal


STEP_SEMITONES = {
    "C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11
}


def pitch_to_midi(step: str, octave: int, alter: int = 0) -> int:
    """Converts (step, octave, alter) to MIDI note number (C4 = 60)."""
    base = 12 * (octave + 1) + STEP_SEMITONES.get(step.upper(), 0)
    return base + alter


def midi_to_freq(midi_note: int) -> float:
    """Converts MIDI note to frequency in Hz (A4 = 69 -> 440 Hz)."""
    return 440.0 * (2.0 ** ((midi_note - 69.0) / 12.0))


def write_vlq(value: int) -> bytes:
    """Encodes an integer into MIDI Variable-Length Quantity (VLQ)."""
    buf = []
    buf.append(value & 0x7F)
    value >>= 7
    while value > 0:
        buf.append((value & 0x7F) | 0x80)
        value >>= 7
    return bytes(reversed(buf))


def parse_musicxml(xml_path: str, default_bpm=116):
    """Parses MusicXML and returns timed note events and score metadata."""
    tree = ET.parse(xml_path)
    root = tree.getroot()

    part = root.find("part")
    if part is None:
        raise ValueError("No <part> found in MusicXML file.")

    divisions = 4
    current_time_div = 0
    timed_notes = []

    last_note_start = 0
    last_note_dur = 0

    measures = part.findall("measure")
    first_m = measures[0] if measures else None

    # Metadata extraction
    key_fifths = 0
    time_sig = "4/4"
    clef_str = "G2"
    if first_m is not None:
        for attr in first_m.findall("attributes"):
            k = attr.find("key/fifths")
            if k is not None and k.text:
                key_fifths = int(k.text)
            beats = attr.find("time/beats")
            b_type = attr.find("time/beat-type")
            if beats is not None and b_type is not None:
                time_sig = f"{beats.text}/{b_type.text}"
            cs = attr.find("clef/sign")
            cl = attr.find("clef/line")
            if cs is not None and cl is not None:
                clef_str = f"{cs.text}{cl.text}"

    title_elem = root.find("work/work-title")
    title = title_elem.text if (title_elem is not None and title_elem.text) else "Untitled Piece"

    for m in measures:
        measure_start_div = current_time_div
        cursor_div = measure_start_div
        measure_max_div = measure_start_div

        for elem in m:
            if elem.tag == "attributes":
                div_elem = elem.find("divisions")
                if div_elem is not None and div_elem.text:
                    divisions = max(1, int(div_elem.text))

            elif elem.tag == "note":
                is_chord = elem.find("chord") is not None
                is_rest = elem.find("rest") is not None
                dur_elem = elem.find("duration")
                dur_div = int(dur_elem.text) if (dur_elem is not None and dur_elem.text) else divisions

                if is_chord:
                    note_start = last_note_start
                else:
                    note_start = cursor_div
                    last_note_start = cursor_div
                    last_note_dur = dur_div
                    cursor_div += dur_div

                measure_max_div = max(measure_max_div, cursor_div)

                if not is_rest:
                    pitch_elem = elem.find("pitch")
                    if pitch_elem is not None:
                        step = pitch_elem.findtext("step", "C")
                        octave = int(pitch_elem.findtext("octave", "4"))
                        alter_text = pitch_elem.findtext("alter", "0")
                        alter = int(float(alter_text))

                        midi_val = pitch_to_midi(step, octave, alter)
                        freq = midi_to_freq(midi_val)
                        staff_num = int(elem.findtext("staff", "1"))
                        vol = 0.85 if staff_num == 1 else 0.65

                        timed_notes.append({
                            "start_div": note_start,
                            "dur_div": dur_div,
                            "freq": freq,
                            "midi": midi_val,
                            "step": step,
                            "octave": octave,
                            "vol": vol
                        })

            elif elem.tag == "backup":
                dur_elem = elem.find("duration")
                if dur_elem is not None and dur_elem.text:
                    b_dur = int(dur_elem.text)
                    cursor_div = max(measure_start_div, cursor_div - b_dur)

            elif elem.tag == "forward":
                dur_elem = elem.find("duration")
                if dur_elem is not None and dur_elem.text:
                    f_dur = int(dur_elem.text)
                    cursor_div += f_dur
                    measure_max_div = max(measure_max_div, cursor_div)

        current_time_div = measure_max_div

    sec_per_div = (60.0 / default_bpm) / divisions
    events = []
    for n in timed_notes:
        events.append({
            "start_sec": n["start_div"] * sec_per_div,
            "dur_sec": max(0.08, n["dur_div"] * sec_per_div),
            "freq": n["freq"],
            "midi": n["midi"],
            "vol": n["vol"]
        })

    metadata = {
        "title": title,
        "measures": len(measures),
        "total_notes": len(events),
        "key_fifths": key_fifths,
        "time_signature": time_sig,
        "clef": clef_str,
        "bpm": default_bpm
    }

    return events, metadata


def render_instrument_note(instrument: str, freq: float, dur: float, vel: float, sample_rate: int = 44100) -> np.ndarray:
    """Renders an individual musical note using dedicated physical and acoustic modeling per instrument."""
    n_samples = int(dur * sample_rate)
    if n_samples <= 0:
        return np.zeros(0, dtype=np.float32)
    t = np.linspace(0, dur, n_samples, endpoint=False)

    if instrument == "piano":
        # Acoustic Grand Piano: 3-string detuning + inharmonicity + dual prompt/aftersound decay
        detunes = [0.9996, 1.0, 1.0004]
        weights = [0.30, 0.45, 0.30]
        B = 0.00015
        harmonics = [1, 2, 3, 4, 5, 6, 7, 8]
        base_amps = [1.0, 0.60, 0.35, 0.20, 0.12, 0.07, 0.04, 0.02]
        p_decay = 1.0 + (freq / 440.0) * 0.7
        note = np.zeros(n_samples, dtype=np.float32)
        for det, w in zip(detunes, weights):
            f_d = freq * det
            for k, h_amp in zip(harmonics, base_amps):
                f_k = k * f_d * np.sqrt(1 + B * (k ** 2))
                if f_k >= sample_rate / 2:
                    continue
                # Velocity-sensitive brightness
                h_amp_vel = h_amp * (vel ** (1.0 + 0.08 * (k - 1)))
                decay_k = p_decay + 0.55 * k
                # Two-stage decay: prompt sound + sympathetic aftersound
                env = 0.75 * np.exp(-decay_k * t) + 0.25 * np.exp(-0.35 * decay_k * t)
                note += (w * h_amp_vel * np.sin(2 * np.pi * f_k * t) * env).astype(np.float32)

        # Soft low-frequency hammer felt thump (not harsh white noise)
        knock_len = min(int(0.012 * sample_rate), n_samples)
        if knock_len > 0:
            k_t = np.linspace(0, 0.012, knock_len)
            knock = np.sin(2 * np.pi * 140 * k_t) * np.exp(-k_t * 300) * 0.15 * vel
            note[:knock_len] += knock.astype(np.float32)

        # Smooth release damper
        rel_len = min(int(0.08 * sample_rate), n_samples // 4)
        if rel_len > 0:
            note[-rel_len:] *= np.linspace(1, 0, rel_len)
        return note * 0.75 * vel

    elif instrument == "organ":
        # Cathedral Pipe Organ: 6 multi-octave pipe mixture ranks with subtle pipe detuning chorus
        ranks = [
            (0.5, 0.50, 0.9995),   # 16' Sub-bass
            (1.0, 1.00, 1.0000),   # 8' Principal
            (2.0, 0.60, 1.0007),   # 4' Octave
            (3.0, 0.28, 0.9992),   # 2-2/3' Twelfth
            (4.0, 0.35, 1.0012),   # 2' Superoctave
            (5.0, 0.15, 0.9988),   # 1-3/5' Tierce
        ]
        note = np.zeros(n_samples, dtype=np.float32)
        for ratio, amp, det in ranks:
            f_pipe = freq * ratio * det
            if f_pipe < 25 or f_pipe >= sample_rate / 2:
                continue
            phase = float(np.sin(ratio * 2.3))
            note += (amp * np.sin(2 * np.pi * f_pipe * t + phase)).astype(np.float32)

        # Soft pipe chiff (musical harmonic onset transient)
        chiff_len = min(int(0.02 * sample_rate), n_samples)
        if chiff_len > 0:
            ch_t = np.linspace(0, 0.02, chiff_len)
            chiff = (0.25 * np.sin(2 * np.pi * freq * 3.0 * ch_t) + 0.15 * np.sin(2 * np.pi * freq * 5.0 * ch_t)) * np.exp(-ch_t * 220)
            note[:chiff_len] += chiff.astype(np.float32) * vel

        # Organ attack & release
        att_len = min(int(0.02 * sample_rate), n_samples // 4)
        if att_len > 0:
            note[:att_len] *= np.linspace(0, 1, att_len)
        rel_len = min(int(0.09 * sample_rate), n_samples // 4)
        if rel_len > 0:
            note[-rel_len:] *= np.linspace(1, 0, rel_len)
        return note * 0.38 * vel

    elif instrument == "strings":
        # Bowed String Ensemble: 3-section detuned chorus + wooden body resonance + lyrical vibrato
        detunes = [0.9982, 1.0, 1.0018]
        vib_rate = 5.2
        vib_env = np.clip((t - 0.12) / 0.25, 0.0, 1.0)
        note = np.zeros(n_samples, dtype=np.float32)
        for i, det in enumerate(detunes):
            f_s = freq * det
            v_phase = -(f_s * 0.0055 * vib_env / vib_rate) * np.cos(2 * np.pi * vib_rate * t + i * 1.8)
            str_sig = np.zeros(n_samples, dtype=np.float32)
            for k in range(1, 16):
                f_k = k * f_s
                if f_k >= sample_rate / 2:
                    break
                h_amp = (1.0 / (k ** 0.95)) * np.exp(-k * freq / 14000.0)
                phi = 2 * np.pi * f_k * t + (k * v_phase)
                str_sig += (h_amp * np.sin(phi)).astype(np.float32)
            note += str_sig * (1.0 / len(detunes))

        # Warm wooden instrument body resonance
        low_cut = max(20.0, min(250.0, freq * 0.7))
        high_cut = max(low_cut + 100.0, min(6500.0, sample_rate * 0.45))
        b, a = signal.butter(2, [low_cut / (sample_rate / 2), high_cut / (sample_rate / 2)], btype='band')
        note = signal.lfilter(b, a, note)

        # Expressive bow swell attack and smooth release
        att_len = min(int(0.07 * sample_rate), n_samples // 3)
        if att_len > 0:
            note[:att_len] *= (np.sin(np.linspace(0, np.pi / 2, att_len)) ** 2)
        rel_len = min(int(0.12 * sample_rate), n_samples // 3)
        if rel_len > 0:
            note[-rel_len:] *= np.linspace(1, 0, rel_len)
        return note * 0.45 * vel

    elif instrument == "flute":
        # Concert Flute: Pure woodwind tone + embouchure breath transient + expressive vibrato
        vib_rate = 5.4
        vib_env = np.clip((t - 0.10) / 0.22, 0.0, 1.0)
        v_phase = -(freq * 0.006 * vib_env / vib_rate) * np.cos(2 * np.pi * vib_rate * t)
        tone = (np.sin(2 * np.pi * freq * t + v_phase) +
                0.22 * np.sin(4 * np.pi * freq * t + 2 * v_phase) +
                0.05 * np.sin(6 * np.pi * freq * t + 3 * v_phase)).astype(np.float32)

        # Gentle embouchure breath transient at onset (fades out, not continuous noise)
        b_len = min(int(0.045 * sample_rate), n_samples)
        if b_len > 0:
            noise = np.random.randn(b_len).astype(np.float32)
            b, a = signal.butter(1, [min(2200.0, sample_rate * 0.4) / (sample_rate / 2),
                                     min(4800.0, sample_rate * 0.45) / (sample_rate / 2)], btype='band')
            breath = signal.lfilter(b, a, noise) * np.exp(-np.linspace(0, 4, b_len))
            tone[:b_len] += breath * 0.035 * vel

        att_len = min(int(0.035 * sample_rate), n_samples // 3)
        if att_len > 0:
            tone[:att_len] *= np.linspace(0, 1, att_len)
        rel_len = min(int(0.08 * sample_rate), n_samples // 3)
        if rel_len > 0:
            tone[-rel_len:] *= np.linspace(1, 0, rel_len)
        return tone * 0.65 * vel

    elif instrument == "epiano":
        # Vintage Electric Piano (Rhodes): Warm fundamental + 2nd harmonic + bell tine chime with velocity bite
        fundamental = np.sin(2 * np.pi * freq * t) * np.exp(-1.1 * t)
        h2 = 0.32 * np.sin(4 * np.pi * freq * t) * np.exp(-1.8 * t)
        # Metallic bell chime partials
        tine = (0.28 * np.sin(2 * np.pi * freq * 3.0 * t) * np.exp(-8.0 * t) +
                0.15 * np.sin(2 * np.pi * freq * 4.0 * t) * np.exp(-14.0 * t)) * (vel ** 1.3)
        note = (fundamental + h2 + tine).astype(np.float32)

        att_len = min(int(0.005 * sample_rate), n_samples // 6)
        if att_len > 0:
            note[:att_len] *= np.linspace(0, 1, att_len)
        rel_len = min(int(0.07 * sample_rate), n_samples // 4)
        if rel_len > 0:
            note[-rel_len:] *= np.linspace(1, 0, rel_len)
        return note * 0.68 * vel

    elif instrument == "music_box":
        # Victorian Music Box / Celesta: Tuned crystalline harmonics with rapid high-frequency damping
        partials = [
            (1.0, 1.00, 1.6),
            (2.0, 0.42, 3.2),
            (3.0, 0.16, 6.0),
            (4.0, 0.08, 11.0),
            (5.4, 0.04, 18.0),
        ]
        note = np.zeros(n_samples, dtype=np.float32)
        for ratio, amp, decay_rate in partials:
            f_p = freq * ratio
            if f_p >= sample_rate / 2:
                continue
            note += (amp * np.sin(2 * np.pi * f_p * t) * np.exp(-decay_rate * t)).astype(np.float32)

        att_len = min(int(0.002 * sample_rate), n_samples // 8)
        if att_len > 0:
            note[:att_len] *= np.linspace(0, 1, att_len)
        return note * 0.65 * vel

    else:  # chiptune
        # Retro 8-Bit Arcade NES: Pure pulse wave at true musical pitch with crisp ADSR
        phase = (freq * t) % 1.0
        pulse = np.where(phase < 0.50, 1.0, -1.0).astype(np.float32)

        # Snappy NES ADSR
        att_len = min(int(0.004 * sample_rate), n_samples // 8)
        dec_len = min(int(0.030 * sample_rate), n_samples // 4)
        rel_len = min(int(0.020 * sample_rate), n_samples // 6)
        env = np.ones(n_samples, dtype=np.float32)
        if att_len > 0:
            env[:att_len] = np.linspace(0, 1.0, att_len)
        if dec_len > 0 and len(env) > att_len + dec_len:
            env[att_len:att_len + dec_len] = np.linspace(1.0, 0.82, dec_len)
            env[att_len + dec_len:] = 0.82
        if rel_len > 0:
            env[-rel_len:] *= np.linspace(1.0, 0.0, rel_len)

        raw = pulse * env * vel * 0.45
        # Authentic 4-bit (16-step) DAC volume quantization
        quantized = np.round(raw * 15.0) / 15.0
        return quantized


SOUNDFONT_PATH = os.path.join(os.path.dirname(__file__), "soundfonts", "TimGM6mb.sf2")

MIDI_PROGRAM_MAP = {
    "piano": 0,          # Acoustic Grand Piano
    "epiano": 4,         # Electric Piano 1 (Rhodes)
    "harpsichord": 6,    # Harpsichord
    "music_box": 10,     # Music Box
    "organ": 19,         # Church Organ
    "guitar": 24,        # Acoustic Nylon Guitar
    "strings": 48,       # String Ensemble 1
    "trumpet": 56,       # Trumpet
    "flute": 73,         # Flute
    "chiptune": 80,      # Lead 1 (square wave)
}


def render_soundfont_wav(events: list, output_wav: str, instrument: str = "piano", sample_rate: int = 44100) -> bool:
    """Renders events using authentic recorded acoustic instrument multi-samples via TinySoundFont."""
    if not os.path.exists(SOUNDFONT_PATH):
        return False
    try:
        import tinysoundfont
    except ImportError:
        return False

    program_num = MIDI_PROGRAM_MAP.get(instrument.lower(), 0)

    try:
        synth = tinysoundfont.Synth()
        sfid = synth.sfload(SOUNDFONT_PATH)
        synth.program_select(0, sfid, 0, program_num)

        if not events:
            total_samples = sample_rate
        else:
            total_dur = max(e["start_sec"] + e["dur_sec"] for e in events) + 2.5
            total_samples = int(total_dur * sample_rate)

        block_size = 512
        actions = []
        for e in events:
            start_s = int(e["start_sec"] * sample_rate)
            # Natural sustain release extension for plucked/struck instruments
            mult = 1.35 if instrument in ["piano", "epiano", "music_box", "guitar", "harpsichord"] else 1.0
            dur_s = int(max(0.12, e["dur_sec"] * mult) * sample_rate)
            vel = int(np.clip(e["vol"] * 125, 1, 127))
            actions.append((start_s, 'on', int(e["midi"]), vel))
            actions.append((start_s + dur_s, 'off', int(e["midi"]), 0))

        actions.sort(key=lambda x: (x[0], 0 if x[1] == 'off' else 1))

        out_chunks = []
        curr_sample = 0
        action_idx = 0
        n_actions = len(actions)

        while curr_sample < total_samples:
            n = min(block_size, total_samples - curr_sample)
            next_sample = curr_sample + n
            while action_idx < n_actions and actions[action_idx][0] < next_sample:
                _, act, midi, vel = actions[action_idx]
                if act == 'on':
                    synth.noteon(0, midi, vel)
                else:
                    synth.noteoff(0, midi)
                action_idx += 1

            buf = synth.generate(n)
            out_chunks.append(np.frombuffer(buf, dtype=np.float32).copy())
            curr_sample = next_sample

        audio = np.concatenate(out_chunks)  # Interleaved stereo float32
        peak = float(np.max(np.abs(audio)))
        if peak > 1e-5:
            audio = (audio / peak) * 0.92

        int16_data = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
        with wave.open(output_wav, "wb") as wf:
            wf.setnchannels(2)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(int16_data.tobytes())
        return True
    except Exception as e:
        print(f"[SoundFont Engine Warning] Fallback triggered: {e}", file=sys.stderr)
        return False


def synthesize_wav(events: list, output_wav: str, instrument: str = "piano", sample_rate=44100):
    """Renders polyphonic synthesized 16-bit Stereo WAV audio with spatial panning and acoustic reverb.
    First tries authentic General MIDI SoundFont sampling; falls back to physical synthesis if unavailable."""
    if render_soundfont_wav(events, output_wav, instrument=instrument, sample_rate=sample_rate):
        return
    if not events:
        total_samples = sample_rate
        audio_l = np.zeros(total_samples, dtype=np.float32)
        audio_r = np.zeros(total_samples, dtype=np.float32)
    else:
        total_dur = max(e["start_sec"] + e["dur_sec"] for e in events) + 2.5
        total_samples = int(total_dur * sample_rate)

        audio_l = np.zeros(total_samples, dtype=np.float32)
        audio_r = np.zeros(total_samples, dtype=np.float32)

        # Instrument-tailored duration extension for natural ring
        ring_mult = {
            "piano": 1.45,
            "music_box": 1.75,
            "epiano": 1.35,
            "strings": 1.08,
            "organ": 1.00,
            "flute": 1.00,
            "chiptune": 1.00
        }.get(instrument, 1.1)

        min_dur = {
            "piano": 0.22,
            "music_box": 0.35,
            "epiano": 0.20,
            "strings": 0.18,
            "organ": 0.08,
            "flute": 0.08,
            "chiptune": 0.08
        }.get(instrument, 0.1)

        for e in events:
            start_idx = int(e["start_sec"] * sample_rate)
            dur = max(min_dur, e["dur_sec"] * ring_mult)
            note_sig = render_instrument_note(instrument, e["freq"], dur, e["vol"], sample_rate)
            n_len = len(note_sig)
            if n_len <= 0:
                continue

            end_idx = min(start_idx + n_len, total_samples)
            valid_len = end_idx - start_idx

            # Stereo acoustic stage panning based on pitch
            pan = np.clip((e["midi"] - 60) / 45.0, -0.55, 0.55)

            # Epiano vintage suitcase auto-pan tremolo
            if instrument == "epiano":
                pan_t = np.linspace(e["start_sec"], e["start_sec"] + dur, valid_len)
                pan_mod = 0.35 * np.sin(2 * np.pi * 4.2 * pan_t)
                pan = np.clip(pan + pan_mod, -0.75, 0.75)
                left_gain = np.cos((pan + 1.0) * (np.pi / 4.0))
                right_gain = np.sin((pan + 1.0) * (np.pi / 4.0))
                audio_l[start_idx:end_idx] += note_sig[:valid_len] * left_gain
                audio_r[start_idx:end_idx] += note_sig[:valid_len] * right_gain
            else:
                left_gain = float(np.cos((pan + 1.0) * (np.pi / 4.0)))
                right_gain = float(np.sin((pan + 1.0) * (np.pi / 4.0)))
                audio_l[start_idx:end_idx] += note_sig[:valid_len] * left_gain
                audio_r[start_idx:end_idx] += note_sig[:valid_len] * right_gain

        # Studio Concert Hall Acoustic Reverb with Early Reflections & Energy Normalization
        if instrument != "chiptune":
            reverb_configs = {
                "organ": {"rt60": 1.5, "wet": 0.22, "lp": 3200},      # Majestic cathedral
                "strings": {"rt60": 1.2, "wet": 0.17, "lp": 3600},    # Concert hall
                "piano": {"rt60": 0.85, "wet": 0.13, "lp": 3800},     # Recital hall
                "flute": {"rt60": 0.95, "wet": 0.14, "lp": 4000},     # Woodwind chamber
                "epiano": {"rt60": 0.65, "wet": 0.10, "lp": 3000},    # Studio room
                "music_box": {"rt60": 1.05, "wet": 0.15, "lp": 4200}, # Chime chamber
            }
            cfg = reverb_configs.get(instrument, {"rt60": 0.85, "wet": 0.13, "lp": 3500})
            rt60 = cfg["rt60"]
            wet = cfg["wet"]
            lp_freq = cfg["lp"]

            ir_len = int(rt60 * sample_rate)
            t_ir = np.linspace(0, rt60, ir_len, endpoint=False)
            decay = np.exp(-6.91 * t_ir / rt60).astype(np.float32)

            # High-density diffuse tail
            tail_l = np.random.randn(ir_len).astype(np.float32) * decay
            tail_r = np.random.randn(ir_len).astype(np.float32) * decay

            # Warm acoustic lowpass absorption
            b, a = signal.butter(2, min(lp_freq, sample_rate * 0.45) / (sample_rate / 2), btype='low')
            tail_l = signal.lfilter(b, a, tail_l)
            tail_r = signal.lfilter(b, a, tail_r)

            # Discrete early reflections for realistic room depth
            early_taps = [
                (int(0.007 * sample_rate), 0.40, -0.20),
                (int(0.014 * sample_rate), -0.32, 0.35),
                (int(0.023 * sample_rate), 0.26, 0.22),
                (int(0.037 * sample_rate), -0.20, -0.24),
                (int(0.051 * sample_rate), 0.15, -0.18),
                (int(0.068 * sample_rate), -0.12, 0.14),
            ]
            for tap_idx, gain_l, gain_r in early_taps:
                if tap_idx < ir_len:
                    tail_l[tap_idx] += gain_l
                    tail_r[tap_idx] += gain_r

            # STRICT ENERGY NORMALIZATION to preserve direct instrument clarity
            norm_l = np.sqrt(np.sum(tail_l ** 2))
            norm_r = np.sqrt(np.sum(tail_r ** 2))
            if norm_l > 1e-6:
                tail_l /= norm_l
            if norm_r > 1e-6:
                tail_r /= norm_r

            rev_l = signal.fftconvolve(audio_l, tail_l, mode='full')[:total_samples]
            rev_r = signal.fftconvolve(audio_r, tail_r, mode='full')[:total_samples]

            audio_l = (1.0 - wet) * audio_l + wet * rev_l
            audio_r = (1.0 - wet) * audio_r + wet * rev_r

    # Peak normalization with clean 0.90 headroom
    peak = max(float(np.max(np.abs(audio_l))), float(np.max(np.abs(audio_r))), 1e-6)
    audio_l = (audio_l / peak) * 0.90
    audio_r = (audio_r / peak) * 0.90

    # Interleave to 16-bit PCM Stereo
    stereo_interleaved = np.empty((total_samples * 2,), dtype=np.int16)
    stereo_interleaved[0::2] = (audio_l * 32767).astype(np.int16)
    stereo_interleaved[1::2] = (audio_r * 32767).astype(np.int16)

    with wave.open(output_wav, "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(stereo_interleaved.tobytes())




def generate_midi(events: list, output_mid: str, instrument: str = "piano", default_bpm=116, ticks_per_quarter=480):
    """Encodes note events into standard Type 0 SMF MIDI with instrument program change."""
    ticks_per_sec = (default_bpm / 60.0) * ticks_per_quarter
    raw_events = []
    for e in events:
        start_tick = int(e["start_sec"] * ticks_per_sec)
        end_tick = start_tick + max(int(ticks_per_quarter * 0.25), int(e["dur_sec"] * ticks_per_sec))
        raw_events.append((start_tick, 0x90, e["midi"], int(e["vol"] * 100)))
        raw_events.append((end_tick, 0x80, e["midi"], 0))

    raw_events.sort(key=lambda x: (x[0], 0 if x[1] == 0x80 else 1))

    track_data = bytearray()
    us_per_quarter = int(60_000_000 / default_bpm)
    track_data.extend(b"\x00\xFF\x51\x03")
    track_data.append((us_per_quarter >> 16) & 0xFF)
    track_data.append((us_per_quarter >> 8) & 0xFF)
    track_data.append(us_per_quarter & 0xFF)

    # General MIDI Program Change event: 0xCn program
    program_num = MIDI_PROGRAM_MAP.get(instrument, 0)
    track_data.extend(bytes([0x00, 0xC0, program_num]))

    last_tick = 0
    for tick, status, note, vel in raw_events:
        delta = max(0, tick - last_tick)
        track_data.extend(write_vlq(delta))
        track_data.extend(bytes([status, note, vel]))
        last_tick = tick

    track_data.extend(b"\x00\xFF\x2F\x00")

    header = bytearray(b"MThd\x00\x00\x00\x06\x00\x00\x00\x01")
    header.append((ticks_per_quarter >> 8) & 0xFF)
    header.append(ticks_per_quarter & 0xFF)

    track_chunk = bytearray(b"MTrk")
    t_len = len(track_data)
    track_chunk.append((t_len >> 24) & 0xFF)
    track_chunk.append((t_len >> 16) & 0xFF)
    track_chunk.append((t_len >> 8) & 0xFF)
    track_chunk.append(t_len & 0xFF)
    track_chunk.extend(track_data)

    with open(output_mid, "wb") as f:
        f.write(bytes(header + track_chunk))
