import { describeError } from '../utils/errors'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const GENERIC_ERROR_MESSAGE: string = 'Something went wrong. Please try again.'

export function networkError(error: unknown): ApiError {
  return new ApiError(0, 'network', `Can't reach the QuestRush server. Check the connection and try again. (${describeError(error)})`)
}

export function notSignedIn(): ApiError {
  return new ApiError(401, 'not_signed_in', 'Please sign in.')
}
