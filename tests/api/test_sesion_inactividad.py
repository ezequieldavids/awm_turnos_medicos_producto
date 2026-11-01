"""Pruebas funcionales de TUR-008: cierre de sesión por inactividad contra la API real (T-001; AC-001, AC-002, AC-006, AC-007).

Las pruebas de expiración necesitan el stack con SESION_INACTIVIDAD_SEGUNDOS=10; con otro valor se omiten con motivo,
para que la suite completa con el valor por defecto (900 s) siga siendo estable. AC-007 siempre se ejecuta: compara el
valor informado por /api/sesion con SESION_ESPERADA (por defecto 900).

Ejecutar desde la raíz del proyecto, con el stack levantado con SESION_INACTIVIDAD_SEGUNDOS=10:
  python3 -B -X utf8 -m unittest discover -s tests/api -p 'test_sesion_inactividad.py' -v
"""

import os
import time
import unittest

from test_autenticacion import ADMIN, PACIENTE, PROFESIONAL, RECEPCION, Cliente

LIMITE_DE_PRUEBA = 10
MOTIVO_OMISION = 'requiere el stack con SESION_INACTIVIDAD_SEGUNDOS=10'
MENSAJE_EXPIRADA = 'Tu sesión se cerró por inactividad. Volvé a iniciar sesión.'


def sesion_de(credenciales):
    cliente = Cliente()
    estado, cuerpo, _ = cliente.login(*credenciales)
    assert estado == 200, cuerpo
    return cliente


class SesionInactividadTest(unittest.TestCase):

    def limite_del_stack(self):
        estado, cuerpo, _ = sesion_de(PACIENTE).pedir('GET', '/api/sesion')
        self.assertEqual(200, estado, cuerpo)
        return cuerpo['inactividadSegundos']

    def test_ac001_peticiones_dentro_del_limite_mantienen_la_sesion(self):
        if self.limite_del_stack() != LIMITE_DE_PRUEBA:
            self.skipTest(MOTIVO_OMISION)
        cliente = sesion_de(PACIENTE)

        # Tres pausas de 4 s: en total 12 s, más que el límite, pero cada hueco es menor que el límite.
        for _ in range(4):
            estado, cuerpo, _ = cliente.pedir('GET', '/api/sesion')
            self.assertEqual(200, estado, cuerpo)
            time.sleep(4)

    def test_ac002_vencido_el_limite_la_sesion_se_cierra_con_sesion_expirada(self):
        if self.limite_del_stack() != LIMITE_DE_PRUEBA:
            self.skipTest(MOTIVO_OMISION)
        cliente = sesion_de(PACIENTE)
        time.sleep(LIMITE_DE_PRUEBA + 2)

        estado, cuerpo, _ = cliente.pedir('GET', '/api/sesion')
        self.assertEqual(401, estado, cuerpo)
        self.assertEqual('sesion_expirada', cuerpo['error']['codigo'])
        self.assertEqual(MENSAJE_EXPIRADA, cuerpo['error']['mensaje'])

        estado, cuerpo, _ = cliente.pedir('GET', '/api/sesion')
        self.assertEqual(401, estado, cuerpo)
        self.assertEqual('no_autenticado', cuerpo['error']['codigo'])

    def test_ac006_todos_los_roles_reciben_sesion_expirada(self):
        if self.limite_del_stack() != LIMITE_DE_PRUEBA:
            self.skipTest(MOTIVO_OMISION)
        clientes = {cuenta[0]: sesion_de(cuenta) for cuenta in (ADMIN, RECEPCION, PROFESIONAL, PACIENTE)}
        time.sleep(LIMITE_DE_PRUEBA + 2)

        for dni, cliente in clientes.items():
            with self.subTest(dni=dni):
                estado, cuerpo, _ = cliente.pedir('GET', '/api/sesion')
                self.assertEqual(401, estado, cuerpo)
                self.assertEqual('sesion_expirada', cuerpo['error']['codigo'])

    def test_ac007_el_limite_informado_coincide_con_el_configurado(self):
        esperado = int(os.environ.get('SESION_ESPERADA', '900'))
        estado, cuerpo, _ = sesion_de(PACIENTE).pedir('GET', '/api/sesion')

        self.assertEqual(200, estado, cuerpo)
        self.assertIsInstance(cuerpo['inactividadSegundos'], int)
        self.assertEqual(esperado, cuerpo['inactividadSegundos'])


if __name__ == '__main__':
    unittest.main()
