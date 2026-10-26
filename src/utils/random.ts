export type RandomInt = (exclusiveMax: number) => number

const UINT32_RANGE: number = 2 ** 32

export const cryptoRandomInt: RandomInt = (exclusiveMax) => {
  if (!Number.isInteger(exclusiveMax) || exclusiveMax < 1 || exclusiveMax > UINT32_RANGE) {
    throw new RangeError(`exclusiveMax must be an integer from 1 to 2^32, got ${exclusiveMax}`)
  }
  const unbiasedLimit = UINT32_RANGE - (UINT32_RANGE % exclusiveMax)
  const buffer = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buffer)
    const value = buffer[0] ?? 0
    if (value < unbiasedLimit) {
      return value % exclusiveMax
    }
  }
}

export function pickRandom<T>(items: readonly T[], randomInt: RandomInt): T {
  if (items.length === 0) {
    throw new RangeError('Cannot pick from an empty list')
  }
  return items[randomInt(items.length)] as T
}
