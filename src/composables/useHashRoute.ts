import { onScopeDispose, readonly, ref } from 'vue'
import { parseHash, routeHash, type Route } from '../utils/route'

export function navigateTo(target: Route): void {
  window.location.hash = routeHash(target)
}

export function useHashRoute() {
  const route = ref<Route>(parseHash(window.location.hash))

  function sync(): void {
    route.value = parseHash(window.location.hash)
    window.scrollTo({ top: 0 })
  }

  window.addEventListener('hashchange', sync)
  onScopeDispose(() => window.removeEventListener('hashchange', sync))

  return { route: readonly(route) }
}
