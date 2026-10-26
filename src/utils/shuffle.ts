import type { RandomInt } from './random'

export function shuffled<T>(items: readonly T[], randomInt: RandomInt): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) {
    const swap = randomInt(index + 1)
    const item = result[index] as T
    result[index] = result[swap] as T
    result[swap] = item
  }
  return result
}
