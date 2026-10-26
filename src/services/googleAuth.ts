import { ApiError } from './apiError'

const GIS_SCRIPT_URL: string = 'https://accounts.google.com/gsi/client'
const SHEETS_SCOPE: string = 'https://www.googleapis.com/auth/spreadsheets'
// Tokens are renewed a little early, so a save never starts with one about to expire.
const EXPIRY_MARGIN_MS: number = 60 * 1000

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void
}

interface GoogleIdentity {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string
        scope: string
        callback: (response: TokenResponse) => void
        error_callback?: (error: { type?: string; message?: string }) => void
      }) => TokenClient
      revoke: (token: string, done?: () => void) => void
    }
  }
}

declare global {
  interface Window {
    google?: GoogleIdentity
  }
}

let scriptLoad: Promise<void> | null = null
let tokenClient: TokenClient | null = null
let pending: { resolve: (token: string) => void; reject: (error: ApiError) => void } | null = null
let accessToken: string = ''
let expiresAt: number = 0

export function googleClientId(): string {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim()
}

// The sign-in popup must open inside the click, so the Google script is loaded before the teacher clicks.
export function preloadGoogleSignIn(): Promise<void> {
  if (scriptLoad === null) {
    scriptLoad = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = GIS_SCRIPT_URL
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => {
        scriptLoad = null
        reject(new ApiError(0, 'network', "Google sign-in couldn't load. Check the connection and try again."))
      }
      document.head.appendChild(script)
    })
  }
  return scriptLoad
}

export function currentToken(): string {
  return accessToken !== '' && Date.now() < expiresAt - EXPIRY_MARGIN_MS ? accessToken : ''
}

// Call from a click handler without awaiting anything first, or the browser blocks the popup.
export function requestToken(): Promise<string> {
  const google = window.google
  if (google === undefined) {
    void preloadGoogleSignIn().catch(() => {})
    return Promise.reject(new ApiError(0, 'google_not_ready', 'Google sign-in is still loading. Try again in a moment.'))
  }
  if (tokenClient === null) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: googleClientId(),
      scope: SHEETS_SCOPE,
      callback: (response) => finish(response),
      error_callback: (error) => fail(new ApiError(401, 'google_sign_in_cancelled', `Google sign-in didn't finish (${error.type ?? 'closed'}). Try again.`)),
    })
  }
  return new Promise<string>((resolve, reject) => {
    pending?.reject(new ApiError(401, 'google_sign_in_cancelled', 'Google sign-in was started again.'))
    pending = { resolve, reject }
    tokenClient?.requestAccessToken({ prompt: accessToken === '' ? 'select_account' : '' })
  })
}

export function forgetToken(): void {
  const token = accessToken
  accessToken = ''
  expiresAt = 0
  if (token !== '') {
    window.google?.accounts.oauth2.revoke(token)
  }
}

function finish(response: TokenResponse): void {
  if (response.access_token === undefined || response.error !== undefined) {
    fail(new ApiError(401, 'google_sign_in_refused', response.error_description ?? "Google didn't allow access to the sheet."))
    return
  }
  accessToken = response.access_token
  expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000
  pending?.resolve(accessToken)
  pending = null
}

function fail(error: ApiError): void {
  console.warn('Google sign-in failed', error.message)
  pending?.reject(error)
  pending = null
}
