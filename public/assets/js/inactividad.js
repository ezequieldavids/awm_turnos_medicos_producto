import { pedir } from '/assets/js/api.js';

// Cierre por inactividad: cuenta clic, tecla, toque y desplazamiento; renueva la sesión en el servidor
// como mucho cada 60 segundos. Al vencer el límite que informa /api/sesion, la pestaña vuelve al inicio con el aviso.
// No llama a /api/logout: la sesión es compartida por todas las pestañas del navegador y vence en el servidor
// (decisión del usuario).
const RENOVACION_MS = 60_000;
const EVENTOS = ['pointerdown', 'keydown', 'touchstart', 'scroll'];

function irAlInicioPorInactividad() {
  // replace: el botón atrás no vuelve a la pantalla que ya no tiene sesión.
  location.replace('/?sesion=inactividad');
}

export function iniciarInactividad(limiteSegundos) {
  const limiteMs = limiteSegundos * 1000;
  // Como máximo cada 60 s, y con límites cortos (pruebas) al menos tres renovaciones dentro del límite.
  const intervaloMs = Math.min(RENOVACION_MS, limiteMs / 3);
  let temporizador = null;
  let renovadoEn = Date.now();

  function vencer() {
    irAlInicioPorInactividad();
  }

  async function renovar() {
    renovadoEn = Date.now();
    try {
      const respuesta = await pedir('/api/sesion');
      if (respuesta.estado === 401 && respuesta.datos?.error?.codigo === 'sesion_expirada') {
        irAlInicioPorInactividad();
      }
    } catch {
      // Sin red: la renovación se reintenta con la próxima actividad.
    }
  }

  function actividad() {
    clearTimeout(temporizador);
    temporizador = setTimeout(vencer, limiteMs);
    if (Date.now() - renovadoEn >= intervaloMs) {
      renovar();
    }
  }

  for (const evento of EVENTOS) {
    addEventListener(evento, actividad, { passive: true });
  }
  actividad();
}
