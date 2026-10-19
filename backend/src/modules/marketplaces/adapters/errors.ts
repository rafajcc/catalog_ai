// Translates a raw marketplace HTTP/network error into a message an admin can
// act on. `marketplace` is the human label shown to the user, so the same
// translator serves every marketplace the registry can resolve.
export function translateMarketplaceError(error: unknown, marketplace = 'Marketplace'): string {
  const raw = error instanceof Error ? error.message : String(error);

  if (/Invalid PrestaShop API key/i.test(raw)) return `La clave de API de ${marketplace} no es válida. Revisa la configuración del marketplace`;
  if (/returned a page in HTML instead of the Webservice API/i.test(raw))
    return `PrestaShop devolvió una página HTML en lugar de la API Webservice. Verifica que la URL base apunte a la API Webservice (la raíz de la tienda más /api, p. ej. https://shop.example.com/api), no a una ruta del panel de administración, y que el Webservice esté habilitado`;
  if (/\b401\b/.test(raw)) return `La clave de API de ${marketplace} no es válida. Revisa la configuración del marketplace`;
  if (/\b403\b/.test(raw)) return `${marketplace} denegó el acceso. Verifica los permisos de tu clave de API`;
  if (/\b404\b/.test(raw)) return `${marketplace} no encontró el recurso solicitado. Verifica la URL y los parámetros`;
  if (/\b429\b/.test(raw)) return `${marketplace} respondió que se alcanzó el límite de solicitudes. Espera un momento e intenta de nuevo`;
  if (/\b5[0-9][0-9]\b/.test(raw)) return `${marketplace} tuvo un error interno. Intenta de nuevo más tarde`;
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH/i.test(raw)) return `No se pudo conectar con ${marketplace}. Verifica la URL base y que la tienda esté disponible`;
  if (/timeout/i.test(raw)) return `${marketplace} tardó demasiado en responder. Intenta de nuevo`;
  if (/network|fetch failed/i.test(raw)) return `Error de red al contactar ${marketplace}`;
  return `Error al conectar con ${marketplace}: ${raw}`;
}
