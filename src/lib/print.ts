export async function printAppRoute(route: string): Promise<{ ok: boolean; error?: string }> {
  if (window.desktopAPI?.print) {
    return window.desktopAPI.print.route(route);
  }

  const popup = window.open(getRouteUrl(route), "_blank");
  return popup ? { ok: true } : { ok: false, error: "popup_blocked" };
}

export async function savePdfAppRoute(route: string): Promise<{ ok: boolean; error?: string; path?: string }> {
  if (window.desktopAPI?.print?.savePdfRoute) {
    const result = await window.desktopAPI.print.savePdfRoute(route);
    if (result.ok || result.error !== "popup_blocked") return result;
  }

  window.print();
  return { ok: true };
}

function getRouteUrl(route: string): string {
  return `${window.location.origin}${window.location.pathname}#${route}`;
}
