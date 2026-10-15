/**
 * Lightweight SPA route-change signal used by legacy enhancement modules.
 * It replaces global DOM MutationObservers with history/popstate events.
 */
const EVENT_NAME = 'postyar:routechange';
const FLAG = '__POSTYAR_ROUTE_EVENTS_INSTALLED__';

type RouteAwareWindow = Window & { [FLAG]?: boolean };

function install(): void {
  const w = window as RouteAwareWindow;
  if (w[FLAG]) return;
  w[FLAG] = true;

  const historyRef = window.history;
  const pushState = historyRef.pushState.bind(historyRef);
  const replaceState = historyRef.replaceState.bind(historyRef);

  historyRef.pushState = ((state: unknown, unused: string, url?: string | URL | null) => {
    const result = pushState(state, unused, url);
    window.dispatchEvent(new Event(EVENT_NAME));
    return result;
  }) as History['pushState'];

  historyRef.replaceState = ((state: unknown, unused: string, url?: string | URL | null) => {
    const result = replaceState(state, unused, url);
    window.dispatchEvent(new Event(EVENT_NAME));
    return result;
  }) as History['replaceState'];
}

export function notifyRouteChange(): void {
  install();
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function onRouteChange(handler: () => void): () => void {
  install();
  window.addEventListener(EVENT_NAME, handler);
  window.addEventListener('popstate', handler, { passive: true });
  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    window.removeEventListener('popstate', handler);
  };
}
