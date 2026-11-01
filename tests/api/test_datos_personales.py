"""Pruebas funcionales de autoconsulta de datos personales del paciente.

Requiere el entorno levantado con el esquema de db/schema.sql. Variables opcionales como en test_autenticacion.py.
Cada ejecución crea pacientes con DNI único y, cuando hace falta, su cuenta de acceso. La lectura de los datos propios
usa el paciente semilla (20000004) sin modificarlo.

Ejecutar desde la raíz del proyecto:
  python3 -B -X utf8 -m unittest discover -s tests/api -p 'test_datos_personales.py' -v
"""

import unittest

from test_autenticacion import ADMIN, PACIENTE, PROFESIONAL, RECEPCION, Cliente
from test_pacientes import consultar, datos_paciente, sesion

CONTRASENA = 'Password123!'

CAMPOS = {'dni', 'nombre', 'apellido', 'telefono', 'email', 'fechaNacimiento', 'obraSocial'}
EDITABLES = ('nombre', 'apellido', 'telefono', 'email', 'fechaNacimiento', 'obraSocial')


def paciente_con_cuenta(recepcion, admin, **cambios):
    # Paciente nuevo con cuenta de acceso propia: así sus datos pueden cambiarse sin tocar la semilla.
    estado, cuerpo, _ = recepcion.pedir('POST', '/api/pacientes', datos_paciente(**cambios))
    assert estado == 201, cuerpo
    paciente = cuerpo['paciente']
    estado, cuerpo, _ = admin.pedir(
        'POST', '/api/usuarios', {'dni': paciente['dni'], 'rol': 'paciente', 'contrasena': CONTRASENA, 'activo': True},
    )
    assert estado == 201, cuerpo
    return paciente, sesion((paciente['dni'], CONTRASENA))


class DatosPersonalesTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.paciente = sesion(PACIENTE)
        cls.admin = sesion(ADMIN)
        cls.recepcion = sesion(RECEPCION)

    def mis_datos(self, cliente=None, ruta='/api/mis-datos'):
        return (cliente or self.paciente).pedir('GET', ruta)

    def test_ac002_devuelve_solo_los_datos_del_registro_de_la_sesion(self):
        estado, cuerpo, _ = self.mis_datos()

        self.assertEqual(200, estado, cuerpo)
        self.assertEqual(CAMPOS, set(cuerpo['datos'].keys()), 'no debe incluir id interno, activo ni datos de cuenta')
        fila = consultar(
            "SELECT pe.dni, pe.nombre, pe.apellido, IFNULL(pe.telefono, ''), IFNULL(pe.email, ''), "
            "IFNULL(DATE_FORMAT(pe.fecha_nacimiento, '%Y-%m-%d'), ''), IFNULL(pa.obra_social, '') FROM paciente pa "
            "JOIN persona pe ON pe.id_persona = pa.id_persona WHERE pe.dni = '20000004'"
        )[0].split('\t')
        datos = cuerpo['datos']
        esperado = [datos[campo] or '' for campo in ('dni', 'nombre', 'apellido', 'telefono', 'email', 'fechaNacimiento', 'obraSocial')]
        self.assertEqual(fila, esperado)

    def test_ac003_campos_sin_cargar_se_devuelven_como_null(self):
        _, cliente = paciente_con_cuenta(self.recepcion, self.admin, telefono=None, email=None, obraSocial=None)

        estado, cuerpo, _ = self.mis_datos(cliente)

        self.assertEqual(200, estado, cuerpo)
        self.assertIsNone(cuerpo['datos']['telefono'])
        self.assertIsNone(cuerpo['datos']['email'])
        self.assertIsNone(cuerpo['datos']['obraSocial'])

    def test_ac004_sin_sesion_responde_401(self):
        estado, cuerpo, _ = Cliente().pedir('GET', '/api/mis-datos')

        self.assertEqual(401, estado, cuerpo)
        self.assertEqual('no_autenticado', cuerpo['error']['codigo'])
        self.assertEqual('Necesitás iniciar sesión para ver este recurso.', cuerpo['error']['mensaje'])

    def test_ac004_otros_roles_responden_403(self):
        for cuenta in (PROFESIONAL, RECEPCION, ADMIN):
            with self.subTest(cuenta=cuenta[0]):
                estado, cuerpo, _ = sesion(cuenta).pedir('GET', '/api/mis-datos')

                self.assertEqual(403, estado, cuerpo)
                self.assertEqual('no_autorizado', cuerpo['error']['codigo'])
                self.assertEqual('Tu rol no tiene acceso a este recurso.', cuerpo['error']['mensaje'])

    def test_registro_inactivo_responde_404_aunque_la_cuenta_siga_activa(self):
        # Dar de baja al paciente por API también inactiva la cuenta; este caso sólo se arma con SQL directo.
        paciente, cliente = paciente_con_cuenta(self.recepcion, self.admin)
        consultar(f"UPDATE paciente SET activo = 0 WHERE id_paciente = {paciente['id']}")

        estado, cuerpo, _ = self.mis_datos(cliente)

        self.assertEqual(404, estado, cuerpo)
        self.assertEqual('no_encontrado', cuerpo['error']['codigo'])
        self.assertEqual('No encontramos tus datos de paciente.', cuerpo['error']['mensaje'])

    def test_ac005_un_identificador_ajeno_no_cambia_la_respuesta(self):
        otro, _ = paciente_con_cuenta(self.recepcion, self.admin)

        for ruta in (f'/api/mis-datos?id={otro["id"]}', f'/api/mis-datos?dni={otro["dni"]}'):
            with self.subTest(ruta=ruta):
                estado, cuerpo, _ = self.mis_datos(ruta=ruta)

                self.assertEqual(200, estado, cuerpo)
                self.assertEqual(PACIENTE[0], cuerpo['datos']['dni'])
                self.assertNotIn(otro['dni'], self.paciente.texto.decode('utf-8'))

    def test_ac006_lo_que_cambia_recepcion_se_refleja_en_la_siguiente_lectura(self):
        paciente, cliente = paciente_con_cuenta(self.recepcion, self.admin)
        telefono = '1199' + paciente['dni']
        cambios = {campo: paciente[campo] for campo in EDITABLES}
        cambios['telefono'] = telefono
        estado, cuerpo, _ = self.recepcion.pedir('PUT', f'/api/pacientes/{paciente["id"]}', cambios)
        self.assertEqual(200, estado, cuerpo)

        estado, cuerpo, _ = self.mis_datos(cliente)

        self.assertEqual(200, estado, cuerpo)
        self.assertEqual(telefono, cuerpo['datos']['telefono'])


if __name__ == '__main__':
    unittest.main()
