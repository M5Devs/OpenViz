#!/usr/bin/env python3
"""
DSP Benchmark tool for verifying logarithmic frequency distribution boundaries
and theoretical Nyquist limits in OpenViz audio analysis.
"""

import math

def log_space(min_freq, max_freq, index, total, k=0.0):
    if total <= 1:
        return min_freq
    t = index / (total - 1)
    if k == 0.0:
        return min_freq * math.exp(t * math.log(max_freq / min_freq))
    else:
        linear = min_freq + t * (max_freq - min_freq)
        logarithmic = min_freq * math.exp(t * math.log(max_freq / min_freq))
        return (1.0 - k) * logarithmic + k * linear

def run_benchmark():
    sample_rate = 44100
    nyquist = sample_rate / 2.0
    min_freq = 20.0
    max_freq = 20000.0
    num_bands = 64

    print("=== OpenViz DSP LogSpace Frequency Benchmark ===")
    print(f"Sample Rate: {sample_rate} Hz | Nyquist Limit: {nyquist} Hz")
    print(f"Bands: {num_bands} | Range: [{min_freq} Hz, {max_freq} Hz]\n")

    f_first = log_space(min_freq, max_freq, 0, num_bands)
    f_last = log_space(min_freq, max_freq, num_bands - 1, num_bands)

    print(f"Band 0 Center: {f_first:.2f} Hz (Expected ~{min_freq} Hz)")
    print(f"Band {num_bands-1} Center: {f_last:.2f} Hz (Expected ~{max_freq} Hz)")

    assert abs(f_first - min_freq) < 1e-3, "First band does not match min_freq"
    assert abs(f_last - max_freq) < 1e-3, "Last band does not match max_freq"
    assert f_last <= nyquist, "Max frequency exceeds Nyquist limit!"

    print("\nAll DSP boundary and Nyquist sanity checks passed successfully!")

if __name__ == "__main__":
    run_benchmark()
