// Llamadas a la API REST con la cookie de sesión. Devuelve el estado HTTP y el cuerpo JSON (o null).
export async function pedir(ruta, { metodo = 'GET', cuerpo } = {}) {
  const opciones = {
    method: metodo,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  };
  if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }

  const respuesta = await fetch(ruta, opciones);
  const datos = await respuesta.json().catch(() => null);

  return { ok: respuesta.ok, estado: respuesta.status, datos };
}
