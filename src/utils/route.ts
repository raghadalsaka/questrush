export type Route =
  | { name: 'classrooms' }
  | { name: 'new-classroom' }
  | { name: 'classroom'; slug: string }
  | { name: 'public'; slug: string }
  | { name: 'practice'; slug: string; stageSlug: string }
  | { name: 'not-found' }

const SEGMENT: string = '([A-Za-z0-9_-]{1,128})'
const PATTERNS: readonly { pattern: RegExp; build: (match: RegExpMatchArray) => Route }[] = [
  { pattern: /^$/, build: () => ({ name: 'classrooms' }) },
  { pattern: /^new$/, build: () => ({ name: 'new-classroom' }) },
  { pattern: new RegExp(`^c/${SEGMENT}$`), build: (match) => ({ name: 'classroom', slug: match[1] ?? '' }) },
  { pattern: new RegExp(`^p/${SEGMENT}$`), build: (match) => ({ name: 'public', slug: match[1] ?? '' }) },
  {
    pattern: new RegExp(`^p/${SEGMENT}/practice/${SEGMENT}$`),
    build: (match) => ({ name: 'practice', slug: match[1] ?? '', stageSlug: match[2] ?? '' }),
  },
]

// Hash routes keep every link working on GitHub Pages, which has no server-side rewrites.
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').replace(/\/+$/, '')
  for (const { pattern, build } of PATTERNS) {
    const match = path.match(pattern)
    if (match !== null) {
      return build(match)
    }
  }
  return { name: 'not-found' }
}

export function routeHash(route: Route): string {
  if (route.name === 'new-classroom') {
    return '#/new'
  }
  if (route.name === 'classroom') {
    return `#/c/${route.slug}`
  }
  if (route.name === 'public') {
    return `#/p/${route.slug}`
  }
  if (route.name === 'practice') {
    return `#/p/${route.slug}/practice/${route.stageSlug}`
  }
  return '#/'
}

export function isTeacherRoute(route: Route): boolean {
  return route.name === 'classrooms' || route.name === 'new-classroom' || route.name === 'classroom'
}
