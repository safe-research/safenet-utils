// Blockies identicons, as Safe{Wallet}, block explorers and most wallets show next to addresses, so that an address
// here is recognisable at a glance as the same one shown there.
//
// This is implemented in-house rather than pulled from npm: the algorithm is tiny and stable (the public domain
// original is https://github.com/ethereum/blockies), while the available packages are either unmaintained or
// single-maintainer packages with recent, unattested releases. Not worth the supply-chain risk for an arbitration app.

export type Hsl = { hue: number; saturation: number; lightness: number }

export type Blockies = {
  // Width and height of the square image in cells.
  size: number
  // Row-major palette indices: 0 for `background`, 1 for `color` and 2 for `spot`.
  cells: (0 | 1 | 2)[]
  background: Hsl
  color: Hsl
  spot: Hsl
}

const SIZE = 8

// The original's xorshift PRNG, seeded from the lowercased address. The exact sequence of draws below must match the
// original for the identicon to look the same as elsewhere.
function seededRandom(seed: string): () => number {
  // Int32Array storage wraps to 32 bits, matching the original's implicit ToInt32 conversions of every operand.
  const state = new Int32Array(4)
  for (let i = 0; i < seed.length; i++) {
    state[i % 4] = (state[i % 4] << 5) - state[i % 4] + seed.charCodeAt(i)
  }
  return () => {
    const t = state[0] ^ (state[0] << 11)
    state[0] = state[1]
    state[1] = state[2]
    state[2] = state[3]
    state[3] = state[3] ^ (state[3] >> 19) ^ t ^ (t >> 8)
    return (state[3] >>> 0) / 2 ** 31
  }
}

function randomColor(random: () => number): Hsl {
  return {
    hue: Math.floor(random() * 360),
    // Saturation of at least 40% avoids greyish colors.
    saturation: random() * 60 + 40,
    // Summing four draws gives lightness a bell-shaped distribution around 50%.
    lightness: (random() + random() + random() + random()) * 25,
  }
}

export function blockies(address: string): Blockies {
  const random = seededRandom(address.toLowerCase())
  const color = randomColor(random)
  const background = randomColor(random)
  const spot = randomColor(random)

  const cells: Blockies["cells"] = []
  for (let y = 0; y < SIZE; y++) {
    // Only the left half is random, mirrored onto the right half. Background and color each have a ~43% chance, the
    // spot color ~13%.
    const left = Array.from({ length: SIZE / 2 }, () => Math.floor(random() * 2.3) as 0 | 1 | 2)
    cells.push(...left, ...left.toReversed())
  }
  return { size: SIZE, cells, background, color, spot }
}

export const hslCss = ({ hue, saturation, lightness }: Hsl) => `hsl(${hue} ${saturation}% ${lightness}%)`
