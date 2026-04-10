// =============================================================================
// prng.ts — Xoshiro128** PRNG (shared by SP-MCTS and IS-MCTS)
// Seeded, deterministic, period 2^128 - 1
// Consumes the full bigint[] worker seed instead of truncating to 32 bits.
// =============================================================================

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) | 0;
}

export class Xoshiro128SS {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: bigint[]) {
    // Mix every 64-bit chunk into 4 × 32-bit lanes via round-robin XOR.
    // Preserves entropy from the full seed array instead of dropping to seed[0].
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
    for (let i = 0; i < seed.length; i++) {
      const lo = Number(seed[i] & 0xFFFFFFFFn) | 0;
      const hi = Number((seed[i] >> 32n) & 0xFFFFFFFFn) | 0;
      switch (i & 3) {
        case 0: s0 ^= lo; s1 ^= hi; break;
        case 1: s2 ^= lo; s3 ^= hi; break;
        case 2: s0 ^= hi; s2 ^= lo; break;
        case 3: s1 ^= hi; s3 ^= lo; break;
      }
    }
    // xoshiro128** requires non-zero state.
    if ((s0 | s1 | s2 | s3) === 0) s0 = 1;
    this.s0 = s0;
    this.s1 = s1;
    this.s2 = s2;
    this.s3 = s3;
  }

  /** Returns a float in [0, 1) */
  next(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9);
    const t = (this.s1 << 9) | 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return (result >>> 0) / 4294967296;
  }
}
