"""Pruebas funcionales de pacientes contra la API real.

Requiere el entorno levantado con el esquema de db/schema.sql. Mismas variables que test_autenticacion.py.
Cada ejecución crea pacientes con DNI único y los deja inactivos o activos: la API no permite borrarlos.

Ejecutar desde la raíz del proyecto:
  python3 -m unittest discover -s tests/api -v
"""

import random
import unittest
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from test_autenticacion import ADMIN, PACIENTE, PROFESIONAL, RECEPCION, Cliente
import test_autenticacion


def dni_unico():
    # 8 dígitos fuera de los rangos de la semilla (20…, 30…, 40…).
    return str(random.randint(50000000, 99999999))


def sesion(credenciales):
    cliente = Cliente()
    estado, _, _ = cliente.login(*credenciales)
    assert estado == 200
    return cliente


def datos_paciente(**cambios):
    datos = {
        'dni': dni_unico(), 'nombre': 'Prueba', 'apellido': 'Paciente', 'telefono': '1155550000',
        'email': None, 'fechaNacimiento': '1990-05-17', 'obraSocial': 'OSDE',
    }
    datos.update(cambios)
    return datos


def consultar(sql):
    return test_autenticacion.ContrasenasTest.consultar(None, sql)


class PacientesTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.admin = sesion(ADMIN)
        cls.recepcion = sesion(RECEPCION)

    def crear(self, cliente=None, **cambios):
        estado, cuerpo, _ = (cliente or self.recepcion).pedir('POST', '/api/pacientes', datos_paciente(**cambios))
        self.assertEqual(201, estado, cuerpo)
        return cuerpo['paciente']

    def codigo_error(self, metodo, ruta, cuerpo, esperado):
        estado, respuesta, _ = self.admin.pedir(metodo, ruta, cuerpo)
        self.assertEqual(esperado, estado, respuesta)
        return respuesta['error']['codigo']

    def test_ac001_crear_responde_201_aparece_y_se_busca_por_dni_y_apellido(self):
        for cliente in (self.admin, self.recepcion):
            creado = self.crear(cliente, apellido='Ñandú-Ç', email=None)
            self.assertTrue(creado['activo'])
            self.assertEqual('Ñandú-Ç', creado['apellido'])
            _, lista, _ = cliente.pedir('GET', '/api/pacientes')
            self.assertIn(creado['id'], {p['id'] for p in lista['pacientes']})
            _, por_dni, _ = cliente.pedir('GET', f"/api/pacientes?q={creado['dni']}")
            self.assertEqual([creado['id']], [p['id'] for p in por_dni['pacientes']])
            _, por_apellido, _ = cliente.pedir('GET', '/api/pacientes?q=%C3%91and%C3%BA')
            self.assertIn(creado['id'], {p['id'] for p in por_apellido['pacientes']})

    def test_ac001_campos_opcionales_pueden_faltar(self):
        estado, cuerpo, _ = self.recepcion.pedir('POST', '/api/pacientes', {
            'dni': dni_unico(), 'nombre': 'Solo', 'apellido': 'Obligatorios', 'fechaNacimiento': '2000-01-01'})
        self.assertEqual(201, estado, cuerpo)
        self.assertIsNone(cuerpo['paciente']['obraSocial'])
        self.assertIsNone(cuerpo['paciente']['email'])

    def test_ac002_validaciones_responden_400_con_codigo_de_campo(self):
        casos = (
            ({'nombre': ''}, 'nombre_invalido'),
            ({'nombre': '   '}, 'nombre_invalido'),
            ({'apellido': ''}, 'apellido_invalido'),
            ({'dni': '123'}, 'dni_invalido'),
            ({'dni': 'abcdefgh'}, 'dni_invalido'),
            ({'dni': '123456789'}, 'dni_invalido'),
            ({'email': 'sin-arroba'}, 'email_invalido'),
            ({'fechaNacimiento': ''}, 'fecha_nacimiento_invalida'),
            ({'fechaNacimiento': '2999-01-01'}, 'fecha_nacimiento_invalida'),
            ({'fechaNacimiento': '2020-02-31'}, 'fecha_nacimiento_invalida'),
            ({'fechaNacimiento': 'ayer'}, 'fecha_nacimiento_invalida'),
            ({'nombre': 'x' * 101}, 'nombre_invalido'),
            ({'obraSocial': 'x' * 101}, 'obra_social_invalida'),
        )
        for cambios, esperado in casos:
            with self.subTest(cambios=cambios):
                self.assertEqual(esperado, self.codigo_error('POST', '/api/pacientes', datos_paciente(**cambios), 400))

    def test_ac002_dni_repetido_como_paciente_responde_409(self):
        creado = self.crear()
        self.assertEqual('dni_duplicado', self.codigo_error('POST', '/api/pacientes', datos_paciente(dni=creado['dni']), 409))

    def test_ac002_email_de_otra_persona_responde_409_y_no_deja_filas(self):
        email = f'p{dni_unico()}@ejemplo.test'
        self.crear(email=email)
        antes = consultar('SELECT COUNT(*) FROM persona')
        self.assertEqual('email_duplicado', self.codigo_error('POST', '/api/pacientes', datos_paciente(email=email), 409))
        self.assertEqual(antes, consultar('SELECT COUNT(*) FROM persona'), 'la transacción debe deshacerse')

    def test_ac002_modificar_con_datos_invalidos_no_guarda(self):
        creado = self.crear()
        self.assertEqual('nombre_invalido', self.codigo_error('PUT', f"/api/pacientes/{creado['id']}", datos_paciente(nombre=''), 400))
        _, leido, _ = self.admin.pedir('GET', f"/api/pacientes/{creado['id']}")
        self.assertEqual('Prueba', leido['paciente']['nombre'])

    def test_ac003_modificar_actualiza_y_el_dni_no_cambia(self):
        creado = self.crear()
        estado, cuerpo, _ = self.recepcion.pedir('PUT', f"/api/pacientes/{creado['id']}", datos_paciente(
            dni='11111111', nombre='Editado', obraSocial='PAMI'))
        self.assertEqual(200, estado, cuerpo)
        self.assertEqual(('Editado', 'PAMI', creado['dni']), (cuerpo['paciente']['nombre'], cuerpo['paciente']['obraSocial'], cuerpo['paciente']['dni']))

    def test_ac003_modificar_o_leer_inexistente_responde_404(self):
        for metodo, ruta in (('PUT', '/api/pacientes/999999'), ('GET', '/api/pacientes/999999'), ('PUT', '/api/pacientes/999999/estado')):
            with self.subTest(ruta=ruta, metodo=metodo):
                estado, _, _ = self.admin.pedir(metodo, ruta, datos_paciente() if 'estado' not in ruta else {'activo': False})
                self.assertEqual(404, estado)

    def test_ac003_baja_logica_conserva_la_fila_y_reactiva(self):
        creado = self.crear()
        estado, cuerpo, _ = self.recepcion.pedir('PUT', f"/api/pacientes/{creado['id']}/estado", {'activo': False})
        self.assertEqual((200, False), (estado, cuerpo['paciente']['activo']))
        self.assertEqual(['0'], consultar(f"SELECT activo FROM paciente WHERE id_paciente = {creado['id']}"))
        _, activos, _ = self.recepcion.pedir('GET', '/api/pacientes')
        self.assertNotIn(creado['id'], {p['id'] for p in activos['pacientes']})
        _, todos, _ = self.recepcion.pedir('GET', '/api/pacientes?estado=todos')
        self.assertIn(creado['id'], {p['id'] for p in todos['pacientes']})
        estado, cuerpo, _ = self.recepcion.pedir('PUT', f"/api/pacientes/{creado['id']}/estado", {'activo': True})
        self.assertEqual((200, True), (estado, cuerpo['paciente']['activo']))
        _, activos, _ = self.recepcion.pedir('GET', '/api/pacientes')
        self.assertIn(creado['id'], {p['id'] for p in activos['pacientes']})

    def test_ac003_estado_requiere_booleano_y_delete_no_existe(self):
        creado = self.crear()
        self.assertEqual('datos_invalidos', self.codigo_error('PUT', f"/api/pacientes/{creado['id']}/estado", {'activo': 'no'}, 400))
        estado, _, _ = self.admin.pedir('DELETE', f"/api/pacientes/{creado['id']}")
        self.assertIn(estado, (404, 405))
        self.assertEqual(['1'], consultar(f"SELECT COUNT(*) FROM paciente WHERE id_paciente = {creado['id']}"))

    def test_ac004_dni_de_persona_existente_agrega_el_rol_sin_duplicar_persona(self):
        # Una persona que ya es profesional y todavía no es paciente.
        _, esp, _ = self.admin.pedir('GET', '/api/especialidades')
        dni = dni_unico()
        estado, cuerpo, _ = self.admin.pedir('POST', '/api/profesionales', {
            'dni': dni, 'nombre': 'Doble', 'apellido': 'Rol', 'matricula': f'D-{dni}',
            'especialidades': [esp['especialidades'][0]['id']]})
        self.assertEqual(201, estado, cuerpo)
        self.assertEqual(['0'], consultar(f"SELECT COUNT(*) FROM paciente pa JOIN persona pe USING (id_persona) WHERE pe.dni = '{dni}'"))
        personas_antes = consultar('SELECT COUNT(*) FROM persona')
        estado, cuerpo, _ = self.recepcion.pedir('POST', '/api/pacientes', datos_paciente(
            dni=dni, nombre='Doble', apellido='Rol', fechaNacimiento='1980-02-02', obraSocial='Galeno'))
        self.assertEqual(201, estado, cuerpo)
        self.assertEqual(personas_antes, consultar('SELECT COUNT(*) FROM persona'))
        self.assertEqual(['1'], consultar(f"SELECT COUNT(*) FROM persona WHERE dni = '{dni}'"))
        self.assertEqual(['1980-02-02'], consultar(f"SELECT fecha_nacimiento FROM persona WHERE dni = '{dni}'"))
        self.assertEqual(['1'], consultar(f"SELECT COUNT(*) FROM profesional pr JOIN persona pe USING (id_persona) WHERE pe.dni = '{dni}'"))
        self.assertEqual('dni_duplicado', self.codigo_error('POST', '/api/pacientes', datos_paciente(dni=dni), 409))

    # Al vincular, lo no enviado conserva su valor; en una edición, vacío borra.
    def test_ac004_vincular_conserva_datos_opcionales_no_enviados(self):
        _, esp, _ = self.admin.pedir('GET', '/api/especialidades')
        dni = dni_unico()
        estado, cuerpo, _ = self.admin.pedir('POST', '/api/profesionales', {
            'dni': dni, 'nombre': 'Con', 'apellido': 'Email', 'email': f'c{dni}@ejemplo.test', 'telefono': '1100000000',
            'fechaNacimiento': '1970-01-01', 'matricula': f'E-{dni}', 'especialidades': [esp['especialidades'][0]['id']]})
        self.assertEqual(201, estado, cuerpo)
        estado, cuerpo, _ = self.recepcion.pedir('POST', '/api/pacientes', {
            'dni': dni, 'nombre': 'Con', 'apellido': 'Email', 'fechaNacimiento': '1970-01-02'})
        self.assertEqual(201, estado, cuerpo)
        self.assertEqual((f'c{dni}@ejemplo.test', '1100000000', '1970-01-02'),
                         (cuerpo['paciente']['email'], cuerpo['paciente']['telefono'], cuerpo['paciente']['fechaNacimiento']))
        estado, cuerpo, _ = self.recepcion.pedir('PUT', f"/api/pacientes/{cuerpo['paciente']['id']}", {
            'nombre': 'Con', 'apellido': 'Email', 'fechaNacimiento': '1970-01-02'})
        self.assertEqual((200, None), (estado, cuerpo['paciente']['email']))

    # «Hoy» se calcula en hora de Argentina.
    def test_ac002_fecha_de_nacimiento_usa_la_fecha_local(self):
        hoy = datetime.now(ZoneInfo('America/Argentina/Buenos_Aires')).date()
        self.crear(fechaNacimiento=hoy.isoformat())
        self.assertEqual('fecha_nacimiento_invalida', self.codigo_error(
            'POST', '/api/pacientes', datos_paciente(fechaNacimiento=(hoy + timedelta(days=1)).isoformat()), 400))

    def test_ac007_sin_sesion_toda_ruta_responde_401(self):
        anonimo = Cliente()
        for metodo, ruta, cuerpo in (
            ('GET', '/api/pacientes', None), ('GET', '/api/pacientes/1', None), ('POST', '/api/pacientes', {}),
            ('PUT', '/api/pacientes/1', {}), ('PUT', '/api/pacientes/1/estado', {'activo': False}),
        ):
            with self.subTest(metodo=metodo, ruta=ruta):
                self.assertEqual(401, anonimo.pedir(metodo, ruta, cuerpo)[0])

    def test_ac007_profesional_y_paciente_no_acceden(self):
        creado = self.crear()
        for credenciales in (PROFESIONAL, PACIENTE):
            cliente = sesion(credenciales)
            for metodo, ruta, cuerpo in (
                ('GET', '/api/pacientes', None), ('GET', f"/api/pacientes/{creado['id']}", None),
                ('POST', '/api/pacientes', datos_paciente()), ('PUT', f"/api/pacientes/{creado['id']}", datos_paciente()),
                ('PUT', f"/api/pacientes/{creado['id']}/estado", {'activo': False}),
            ):
                with self.subTest(usuario=credenciales[0], metodo=metodo, ruta=ruta):
                    self.assertEqual(403, cliente.pedir(metodo, ruta, cuerpo)[0])
        _, leido, _ = self.admin.pedir('GET', f"/api/pacientes/{creado['id']}")
        self.assertEqual((creado['nombre'], True), (leido['paciente']['nombre'], leido['paciente']['activo']))

    # Seguridad
    def test_html_y_sql_se_guardan_como_texto(self):
        creado = self.crear(nombre='<img src=x onerror=alert(1)>', apellido="O'); DROP TABLE paciente;--")
        self.assertEqual("O'); DROP TABLE paciente;--", creado['apellido'])
        self.assertEqual('<img src=x onerror=alert(1)>', creado['nombre'])
        _, lista, _ = self.admin.pedir('GET', "/api/pacientes?q=%27%20OR%201%3D1%20--")
        self.assertEqual([], lista['pacientes'])


if __name__ == '__main__':
    unittest.main()
