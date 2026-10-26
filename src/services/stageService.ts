import { STAGES_DIR } from '../config'
import type { StageLoadResult } from '../types/stage'
import { describeError } from '../utils/errors'
import { validateStage } from '../utils/validateStage'

const cache = new Map<string, Promise<StageLoadResult>>()

// A failed load is dropped from the cache, so Try again refetches.
export function loadStage(slug: string): Promise<StageLoadResult> {
  const cached = cache.get(slug)
  if (cached !== undefined) {
    return cached
  }
  const pending = fetchStage(slug).then((result) => {
    if (!result.ok) {
      cache.delete(slug)
    }
    return result
  })
  cache.set(slug, pending)
  return pending
}

async function fetchStage(slug: string): Promise<StageLoadResult> {
  const url = `${import.meta.env.BASE_URL}${STAGES_DIR}/${slug}.json`
  let response: Response
  try {
    // no-cache revalidates with the server, so an edited stage file is not hidden behind a CDN or browser cache.
    response = await fetch(url, { cache: 'no-cache' })
  } catch (error) {
    return { ok: false, errors: [`Could not reach ${url}. (${describeError(error)})`] }
  }
  if (!response.ok) {
    return { ok: false, errors: [`Loading ${url} failed with HTTP ${response.status} ${response.statusText}.`.trim()] }
  }
  let data: unknown
  try {
    data = JSON.parse(await response.text())
  } catch (error) {
    return { ok: false, errors: [`${slug}.json is not valid JSON: ${describeError(error)}`] }
  }
  const result = validateStage(data)
  if (!result.ok) {
    console.error(`Stage file ${slug}.json is invalid`, result.errors)
  }
  return result
}
