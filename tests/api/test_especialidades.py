"""Pruebas funcionales de TUR-002 contra la API real (T-002, AC-001 a AC-005).

Requiere el entorno levantado con el esquema de db/schema.sql. Mismas variables que test_autenticacion.py
(API_URL y, para la consulta directa de AC-004, DB_HOST, DB_PORT, DB_NAME, DB_USUARIO, DB_PASSWORD).
Cada ejecución crea especialidades con un nombre único y las deja inactivas: la API no permite borrarlas.

Ejecutar desde la raíz del proyecto:
  python3 -m unittest discover -s tests/api -v
"""

import unittest
import uuid

from test_autenticacion import ADMIN, PACIENTE, RECEPCION, Cliente
import test_autenticacion


def nombre_unico(prefijo='Esp'):
    return f'{prefijo} {uuid.uuid4().hex[:12]}'


def sesion(credenciales):
    cliente = Cliente()
    estado, _, _ = cliente.login(*credenciales)
    assert estado == 200
    return cliente


class EspecialidadesTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.admin = sesion(ADMIN)

    def crear(self, nombre=None, descripcion='Descripción de prueba'):
        nombre = nombre or nombre_unico()
        estado, cuerpo, _ = self.admin.pedir('POST', '/api/especialidades', {'nombre': nombre, 'descripcion': descripcion})
        self.assertEqual(201, estado, cuerpo)
        return cuerpo['especialidad']

    def ids_listados(self, cliente, estado_pedido=None):
        ruta = '/api/especialidades' + (f'?estado={estado_pedido}' if estado_pedido else '')
        estado, cuerpo, _ = cliente.pedir('GET', ruta)
        self.assertEqual(200, estado)
        return {e['id'] for e in cuerpo['especialidades']}

    # AC-001
    def test_ac001_crear_responde_201_y_aparece_en_el_listado(self):
        creada = self.crear(descripcion='Con acentos: niño, ñandú')
        self.assertTrue(creada['activa'])
        self.assertEqual('Con acentos: niño, ñandú', creada['descripcion'])
        self.assertIn(creada['id'], self.ids_listados(self.admin))
        estado, cuerpo, _ = self.admin.pedir('GET', f"/api/especialidades/{creada['id']}")
        self.assertEqual((200, creada['nombre']), (estado, cuerpo['especialidad']['nombre']))

    def test_ac001_la_descripcion_es_opcional(self):
        estado, cuerpo, _ = self.admin.pedir('POST', '/api/especialidades', {'nombre': nombre_unico()})
        self.assertEqual(201, estado)
        self.assertIsNone(cuerpo['especialidad']['descripcion'])

    def test_semilla_incluye_el_catalogo_de_41_especialidades(self):
        estado, cuerpo, _ = self.admin.pedir('GET', '/api/especialidades?estado=todas')
        self.assertEqual(200, estado)
        nombres = {e['nombre'] for e in cuerpo['especialidades']}
        self.assertTrue({'Cardiología', 'Ginecología y Obstetricia', 'Urología'} <= nombres)
        self.assertGreaterEqual(len(nombres), 41)

    # AC-002
    def test_ac002_nombre_vacio_o_ausente_o_no_texto_responde_400(self):
        for cuerpo_enviado in ({'nombre': ''}, {'nombre': '   '}, {'nombre': '\u00a0\u00a0'}, {'nombre': '\u2003'}, {}, {'nombre': 5}):
            with self.subTest(cuerpo=cuerpo_enviado):
                estado, cuerpo, _ = self.admin.pedir('POST', '/api/especialidades', cuerpo_enviado)
                self.assertEqual(400, estado)
                self.assertEqual('nombre_invalido', cuerpo['error']['codigo'])

    def test_ac002_nombre_largo_y_descripcion_larga_responden_400(self):
        estado, cuerpo, _ = self.admin.pedir('POST', '/api/especialidades', {'nombre': 'a' * 81})
        self.assertEqual((400, 'nombre_invalido'), (estado, cuerpo['error']['codigo']))
        estado, cuerpo, _ = self.admin.pedir('POST', '/api/especialidades', {'nombre': nombre_unico(), 'descripcion': 'd' * 256})
        self.assertEqual((400, 'descripcion_invalida'), (estado, cuerpo['error']['codigo']))

    def test_ac002_nombre_de_80_caracteres_es_valido(self):
        estado, _, _ = self.admin.pedir('POST', '/api/especialidades', {'nombre': uuid.uuid4().hex[:16] * 5})
        self.assertEqual(201, estado)

    def test_ac002_duplicado_sin_distinguir_mayusculas_acentos_ni_espacios_responde_409(self):
        base = f'Cardiología {uuid.uuid4().hex[:8]}'
        self.crear(base)
        for variante in (base, base.upper(), base.replace('í', 'i'), f'  {base}  '):
            with self.subTest(variante=variante):
                estado, cuerpo, _ = self.admin.pedir('POST', '/api/especialidades', {'nombre': variante})
                self.assertEqual((409, 'nombre_duplicado'), (estado, cuerpo['error']['codigo']))

    def test_ac002_modificar_a_un_nombre_ya_usado_responde_409(self):
        a, b = self.crear(), self.crear()
        estado, cuerpo, _ = self.admin.pedir('PUT', f"/api/especialidades/{b['id']}", {'nombre': a['nombre'].lower()})
        self.assertEqual((409, 'nombre_duplicado'), (estado, cuerpo['error']['codigo']))

    def test_ac002_cuerpo_vacio_responde_400(self):
        estado, _, _ = self.admin.pedir('POST', '/api/especialidades', None)
        self.assertEqual(400, estado)

    # AC-003
    def test_ac003_modificar_actualiza_nombre_y_descripcion(self):
        creada = self.crear()
        nuevo = nombre_unico('Nuevo')
        estado, cuerpo, _ = self.admin.pedir('PUT', f"/api/especialidades/{creada['id']}", {'nombre': nuevo, 'descripcion': ''})
        self.assertEqual(200, estado)
        self.assertEqual(nuevo, cuerpo['especialidad']['nombre'])
        self.assertIsNone(cuerpo['especialidad']['descripcion'])
        _, leida, _ = self.admin.pedir('GET', f"/api/especialidades/{creada['id']}")
        self.assertEqual(nuevo, leida['especialidad']['nombre'])

    def test_ac003_modificar_con_su_mismo_nombre_es_valido(self):
        creada = self.crear()
        estado, _, _ = self.admin.pedir('PUT', f"/api/especialidades/{creada['id']}", {'nombre': creada['nombre'], 'descripcion': 'otra'})
        self.assertEqual(200, estado)

    def test_ac003_inexistente_responde_404(self):
        for metodo, ruta, cuerpo in (
            ('PUT', '/api/especialidades/99999999', {'nombre': 'X'}),
            ('GET', '/api/especialidades/99999999', None),
            ('PUT', '/api/especialidades/99999999/estado', {'activa': False}),
        ):
            with self.subTest(ruta=ruta):
                estado, _, _ = self.admin.pedir(metodo, ruta, cuerpo)
                self.assertEqual(404, estado)

    # AC-004
    def test_ac004_baja_logica_y_reactivacion(self):
        creada = self.crear()
        ruta = f"/api/especialidades/{creada['id']}/estado"

        estado, cuerpo, _ = self.admin.pedir('PUT', ruta, {'activa': False})
        self.assertEqual((200, False), (estado, cuerpo['especialidad']['activa']))
        self.assertNotIn(creada['id'], self.ids_listados(self.admin))
        self.assertIn(creada['id'], self.ids_listados(self.admin, 'todas'))
        fila = self.consultar(f"SELECT activa FROM especialidad WHERE id_especialidad = {creada['id']}")
        self.assertEqual(['0'], fila, 'la fila debe conservarse con activa = 0')

        estado, cuerpo, _ = self.admin.pedir('PUT', ruta, {'activa': True})
        self.assertEqual((200, True), (estado, cuerpo['especialidad']['activa']))
        self.assertIn(creada['id'], self.ids_listados(self.admin))

    def test_ac004_estado_invalido_responde_400(self):
        creada = self.crear()
        for cuerpo_enviado in ({}, {'activa': 'no'}, {'activa': 1}):
            with self.subTest(cuerpo=cuerpo_enviado):
                estado, _, _ = self.admin.pedir('PUT', f"/api/especialidades/{creada['id']}/estado", cuerpo_enviado)
                self.assertEqual(400, estado)

    def test_ac004_no_existe_el_borrado_fisico(self):
        creada = self.crear()
        for ruta in ('/api/especialidades', f"/api/especialidades/{creada['id']}", f"/api/especialidades/{creada['id']}/estado"):
            with self.subTest(ruta=ruta):
                estado, _, _ = self.admin.pedir('DELETE', ruta)
                self.assertEqual(405, estado)
        self.assertEqual(['1'], self.consultar(f"SELECT COUNT(*) FROM especialidad WHERE id_especialidad = {creada['id']}"))

    def test_ac004_la_inactiva_no_se_ve_para_otros_roles(self):
        creada = self.crear()
        self.admin.pedir('PUT', f"/api/especialidades/{creada['id']}/estado", {'activa': False})
        paciente = sesion(PACIENTE)
        estado, _, _ = paciente.pedir('GET', f"/api/especialidades/{creada['id']}")
        self.assertEqual(404, estado)

    def consultar(self, sql):
        return test_autenticacion.ContrasenasTest.consultar(self, sql)

    # AC-005
    def test_ac005_sin_sesion_toda_ruta_responde_401(self):
        anonimo = Cliente()
        for metodo, ruta, cuerpo in (
            ('GET', '/api/especialidades', None),
            ('GET', '/api/especialidades?estado=todas', None),
            ('GET', '/api/especialidades/1', None),
            ('POST', '/api/especialidades', {'nombre': 'X'}),
            ('PUT', '/api/especialidades/1', {'nombre': 'X'}),
            ('PUT', '/api/especialidades/1/estado', {'activa': False}),
        ):
            with self.subTest(metodo=metodo, ruta=ruta):
                estado, _, _ = anonimo.pedir(metodo, ruta, cuerpo)
                self.assertEqual(401, estado)

    def test_ac005_roles_no_administrador_no_pueden_escribir(self):
        creada = self.crear()
        for credenciales in (RECEPCION, PACIENTE):
            cliente = sesion(credenciales)
            for metodo, ruta, cuerpo in (
                ('POST', '/api/especialidades', {'nombre': nombre_unico()}),
                ('PUT', f"/api/especialidades/{creada['id']}", {'nombre': nombre_unico()}),
                ('PUT', f"/api/especialidades/{creada['id']}/estado", {'activa': False}),
                ('GET', '/api/especialidades?estado=todas', None),
            ):
                with self.subTest(usuario=credenciales[0], metodo=metodo, ruta=ruta):
                    estado, _, _ = cliente.pedir(metodo, ruta, cuerpo)
                    self.assertEqual(403, estado)
        # Nada cambió.
        _, leida, _ = self.admin.pedir('GET', f"/api/especialidades/{creada['id']}")
        self.assertEqual((creada['nombre'], True), (leida['especialidad']['nombre'], leida['especialidad']['activa']))

    def test_ac005_cualquier_rol_autenticado_lee_las_activas(self):
        creada = self.crear()
        for credenciales in (RECEPCION, PACIENTE):
            with self.subTest(usuario=credenciales[0]):
                self.assertIn(creada['id'], self.ids_listados(sesion(credenciales)))

    # Seguridad: el texto se guarda tal cual y la API no lo interpreta.
    def test_texto_con_html_se_guarda_como_texto(self):
        nombre = f'<img src=x onerror=alert(1)> {uuid.uuid4().hex[:8]}'
        creada = self.crear(nombre)
        self.assertEqual(nombre, creada['nombre'])

    def test_inyeccion_sql_se_trata_como_texto(self):
        nombre = f"x'); DROP TABLE especialidad;-- {uuid.uuid4().hex[:6]}"
        creada = self.crear(nombre)
        self.assertEqual(nombre, creada['nombre'])
        self.assertGreaterEqual(len(self.ids_listados(self.admin)), 41)


if __name__ == '__main__':
    unittest.main()
