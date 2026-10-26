import { describe, expect, it } from 'vitest'
import { isTeacherRoute, parseHash, routeHash, type Route } from '../../src/utils/route'

describe('hash routes', () => {
  const routes: Route[] = [
    { name: 'classrooms' },
    { name: 'new-classroom' },
    { name: 'classroom', slug: 'demo-year-3-explorers' },
    { name: 'public', slug: 'demo-year-3-explorers-2' },
    { name: 'practice', slug: 'demo-year-3-explorers-2', stageSlug: 'addition-harbour' },
  ]

  it.each(routes)('round-trips %o', (route) => {
    expect(parseHash(routeHash(route))).toEqual(route)
  })

  it('accepts an empty hash and trailing slashes', () => {
    expect(parseHash('')).toEqual({ name: 'classrooms' })
    expect(parseHash('#/p/abc/')).toEqual({ name: 'public', slug: 'abc' })
  })

  it('rejects unknown paths and unsafe segments', () => {
    expect(parseHash('#/p/abc/edit')).toEqual({ name: 'not-found' })
    expect(parseHash('#/c/../secrets')).toEqual({ name: 'not-found' })
  })

  it('keeps public pages out of the teacher sign-in', () => {
    expect(isTeacherRoute({ name: 'public', slug: 'abc' })).toBe(false)
    expect(isTeacherRoute({ name: 'practice', slug: 'abc', stageSlug: 'x' })).toBe(false)
    expect(isTeacherRoute({ name: 'classroom', slug: 'x' })).toBe(true)
  })
})
