/**
 * Navigate to a sub-page of the current dashboard (e.g. 'batteries' -> /apple-home/batteries)
 * using Home Assistant's location-changed event.
 */
export function navigateToDashboardPath(path: string): void {
  const pathParts = window.location.pathname.split('/').filter(part => part.length > 0);
  const basePath = pathParts.length > 0 ? `/${pathParts[0]}/` : '/lovelace/';
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;

  window.history.pushState(null, '', `${basePath}${cleanPath}`);
  window.dispatchEvent(new Event('location-changed', { bubbles: true, composed: true }));
}
