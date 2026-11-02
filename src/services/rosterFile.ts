import { MAX_ROSTER_BYTES } from '../config'
import type { RosterGrid } from '../types/api'
import { readRosterGrid } from '../utils/xlsx'
import { ApiError } from './apiError'

export async function previewRosterFile(file: File): Promise<RosterGrid> {
  if (file.size > MAX_ROSTER_BYTES) {
    throw new ApiError(400, 'file_too_large', `The file is larger than ${MAX_ROSTER_BYTES / 1024} KB.`)
  }
  const result = await readRosterGrid(await file.arrayBuffer())
  if (!result.ok) {
    throw new ApiError(400, 'not_xlsx', result.message)
  }
  return result.grid
}
