export class FFT {
  private size: number;
  private bitReverseTable: Int32Array;
  private cosTable: Float64Array;
  private sinTable: Float64Array;

  private static cache: Map<number, FFT> = new Map();

  public static get(size: number): FFT {
    let instance = FFT.cache.get(size);
    if (!instance) {
      instance = new FFT(size);
      FFT.cache.set(size, instance);
    }
    return instance;
  }

  constructor(size: number) {
    if (size <= 0 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of 2, got ${size}`);
    }
    this.size = size;
    const n = size;

    this.bitReverseTable = new Int32Array(n);
    let numBits = 0;
    while ((1 << numBits) < n) numBits++;

    for (let i = 0; i < n; i++) {
      let rev = 0;
      for (let j = 0; j < numBits; j++) {
        if ((i >> j) & 1) {
          rev |= 1 << (numBits - 1 - j);
        }
      }
      this.bitReverseTable[i] = rev;
    }

    const halfN = n / 2;
    this.cosTable = new Float64Array(halfN);
    this.sinTable = new Float64Array(halfN);
    for (let k = 0; k < halfN; k++) {
      const angle = (-2 * Math.PI * k) / n;
      this.cosTable[k] = Math.cos(angle);
      this.sinTable[k] = Math.sin(angle);
    }
  }

  public getSize(): number {
    return this.size;
  }

  /**
   * In-place Radix-2 FFT.
   * Modifies real and imag buffers in place.
   * Both real and imag must be of length equal to size.
   */
  public transform(real: Float32Array | Float64Array, imag: Float32Array | Float64Array): void {
    const n = this.size;
    if (real.length < n || imag.length < n) {
      throw new Error(`Buffers must be at least length ${n}`);
    }

    const bitReverse = this.bitReverseTable;
    const cosTable = this.cosTable;
    const sinTable = this.sinTable;

    // 1. Bit reversal permutation
    for (let i = 0; i < n; i++) {
      const j = bitReverse[i];
      if (i < j) {
        const tempR = real[i];
        real[i] = real[j];
        real[j] = tempR;

        const tempI = imag[i];
        imag[i] = imag[j];
        imag[j] = tempI;
      }
    }

    // 2. Cooley-Tukey Radix-2 iterative FFT
    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < halfLen; j++) {
          const tableIdx = j * step;
          const wr = cosTable[tableIdx];
          const wi = sinTable[tableIdx];

          const k = i + j + halfLen;
          const ur = real[i + j];
          const ui = imag[i + j];

          const vr = real[k];
          const vi = imag[k];

          const tr = vr * wr - vi * wi;
          const ti = vr * wi + vi * wr;

          real[i + j] = ur + tr;
          imag[i + j] = ui + ti;
          real[k] = ur - tr;
          imag[k] = ui - ti;
        }
      }
    }
  }
}
