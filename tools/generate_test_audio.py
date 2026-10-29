#!/usr/bin/env python3
"""
Synthetic test audio signal generator for OpenViz audio visualizer testing.
Uses pure Python standard libraries (wave, struct, math).
"""

import os
import math
import struct
import wave
import argparse

SAMPLE_RATE = 44100

def generate_sine_wave(freq, duration, amplitude=0.5):
    num_samples = int(SAMPLE_RATE * duration)
    samples = []
    for i in range(num_samples):
        t = i / SAMPLE_RATE
        val = math.sin(2 * math.pi * freq * t) * amplitude
        int_val = int(val * 32767)
        samples.append(struct.pack('<h', int_val))
    return b''.join(samples)

def generate_subbass_bursts(out_path, duration=5.0):
    num_samples = int(SAMPLE_RATE * duration)
    samples = []
    freq = 80.0
    for i in range(num_samples):
        t = i / SAMPLE_RATE
        in_burst = (t % 0.5) < 0.1
        amp = 0.8 if in_burst else 0.0
        val = math.sin(2 * math.pi * freq * t) * amp
        int_val = int(val * 32767)
        samples.append(struct.pack('<h', int_val))

    data = b''.join(samples)
    save_wav(out_path, data)

def generate_log_sweep(out_path, duration=5.0, start_freq=20.0, end_freq=20000.0):
    num_samples = int(SAMPLE_RATE * duration)
    samples = []
    log_ratio = math.log(end_freq / start_freq)
    for i in range(num_samples):
        t = i / SAMPLE_RATE
        inst_freq = start_freq * math.exp(log_ratio * (t / duration))
        phase = 2 * math.pi * start_freq * duration / log_ratio * (math.exp(log_ratio * (t / duration)) - 1)
        val = math.sin(phase) * 0.5
        int_val = int(val * 32767)
        samples.append(struct.pack('<h', int_val))

    data = b''.join(samples)
    save_wav(out_path, data)

def generate_stepped_tones(out_path):
    tones = [100.0, 1000.0, 10000.0]
    data = b''
    for f in tones:
        data += generate_sine_wave(f, 2.0, 0.5)
    save_wav(out_path, data)

def save_wav(out_path, raw_data):
    with wave.open(out_path, 'wb') as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(raw_data)
    print(f"Generated test WAV audio: {out_path}")

def main():
    parser = argparse.ArgumentParser(description="Generate synthetic test WAV audio files for visualizer validation.")
    parser.add_argument("--output-dir", "-o", default="./test_audio", help="Output directory for generated WAV files")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    generate_subbass_bursts(os.path.join(args.output_dir, "subbass_bursts.wav"))
    generate_log_sweep(os.path.join(args.output_dir, "log_frequency_sweep.wav"))
    generate_stepped_tones(os.path.join(args.output_dir, "stepped_frequency_tones.wav"))

if __name__ == "__main__":
    main()
