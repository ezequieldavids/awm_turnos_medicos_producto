"""Pruebas funcionales de profesionales contra la API real.

Requiere el entorno levantado con el esquema de db/schema.sql. Mismas variables que test_autenticacion.py.
Cada ejecución crea profesionales con DNI y matrícula únicos y los deja en la base: la API no permite borrarlos.
"""

import random
import unittest
import uuid

from test_autenticacion import ADMIN, PACIENTE, PROFESIONAL, RECEPCION, Cliente
from test_pacientes import consultar, dni_unico, sesion


def matricula_unica():
    return f'T-{uuid.uuid4().hex[:10]}'


def datos_profesional(especialidades, **cambios):
    datos = {
        'dni': dni_unico(), 'nombre': 'Doctora', 'apellido': 'Prueba', 'telefono': None, 'email': None,
        'fechaNacimiento': '1980-01-01', 'matricula': matricula_unica(), 'especialidades': especialidades,
    }
    datos.update(cambios)
    return datos


class ProfesionalesTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.admin = sesion(ADMIN)
        cls.recepcion = sesion(RECEPCION)
        _, cuerpo, _ = cls.admin.pedir('GET', '/api/especialidades')
        cls.esp = [e['id'] for e in cuerpo['especialidades'][:3]]
        estado, creada, _ = cls.admin.pedir('POST', '/api/especialidades', {'nombre': f'Inactiva {uuid.uuid4().hex[:8]}'})
        cls.admin.pedir('PUT', f"/api/especialidades/{creada['especialidad']['id']}/estado", {'activa': False})
        cls.esp_inactiva = creada['especialidad']['id']

    def crear(self, **cambios):
        especialidades = cambios.pop('especialidades', self.esp[:2])
        estado, cuerpo, _ = self.admin.pedir('POST', '/api/profesionales', datos_profesional(especialidades, **cambios))
        self.assertEqual(201, estado, cuerpo)
        return cuerpo['profesional']

    def codigo_error(self, metodo, ruta, cuerpo, esperado):
        estado, respuesta, _ = self.admin.pedir(metodo, ruta, cuerpo)
        self.assertEqual(esperado, estado, respuesta)
        return respuesta['error']['codigo']

    def test_ac005_crear_con_dos_especialidades_aparece_y_filtra(self):
        creado = self.crear()
        self.assertEqual(set(self.esp[:2]), {e['id'] for e in creado['especialidades']})
        _, lista, _ = self.admin.pedir('GET', '/api/profesionales')
        self.assertIn(creado['id'], {p['id'] for p in lista['profesionales']})
        for especialidad in self.esp[:2]:
            _, filtrada, _ = self.admin.pedir('GET', f'/api/profesionales?especialidad={especialidad}')
            self.assertIn(creado['id'], {p['id'] for p in filtrada['profesionales']})
        otra = next(e for e in self.esp if e not in self.esp[:2])
        _, filtrada, _ = self.admin.pedir('GET', f'/api/profesionales?especialidad={otra}')
        self.assertNotIn(creado['id'], {p['id'] for p in filtrada['profesionales']})
        _, por_matricula, _ = self.admin.pedir('GET', f"/api/profesionales?q={creado['matricula']}")
        self.assertEqual([creado['id']], [p['id'] for p in por_matricula['profesionales']])

    def test_ac005_rechazos_de_datos(self):
        casos = (
            ({'especialidades': []}, 'especialidades_invalidas', 400),
            ({'especialidades': None}, 'especialidades_invalidas', 400),
            ({'especialidades': ['uno']}, 'especialidades_invalidas', 400),
            ({'especialidades': [999999]}, 'especialidades_invalidas', 400),
            ({'especialidades': [self.esp_inactiva]}, 'especialidades_invalidas', 400),
            ({'matricula': ''}, 'matricula_invalida', 400),
            ({'matricula': 'x' * 31}, 'matricula_invalida', 400),
            ({'nombre': ''}, 'nombre_invalido', 400),
            ({'dni': '12'}, 'dni_invalido', 400),
        )
        for cambios, codigo, estado in casos:
            with self.subTest(cambios=cambios):
                especialidades = cambios.pop('especialidades', self.esp[:1]) if 'especialidades' in cambios else self.esp[:1]
                cuerpo = datos_profesional(especialidades, **cambios)
                if 'especialidades' in cambios:
                    cuerpo['especialidades'] = cambios['especialidades']
                self.assertEqual(codigo, self.codigo_error('POST', '/api/profesionales', cuerpo, estado))

    def test_ac005_matricula_repetida_responde_409_y_no_deja_persona(self):
        creado = self.crear()
        antes = consultar('SELECT COUNT(*) FROM persona')
        self.assertEqual('matricula_duplicada', self.codigo_error(
            'POST', '/api/profesionales', datos_profesional(self.esp[:1], matricula=creado['matricula']), 409))
        self.assertEqual(antes, consultar('SELECT COUNT(*) FROM persona'))

    def test_ac005_dni_repetido_como_profesional_responde_409(self):
        creado = self.crear()
        self.assertEqual('dni_duplicado', self.codigo_error(
            'POST', '/api/profesionales', datos_profesional(self.esp[:1], dni=creado['dni']), 409))

    def test_ac005_vincula_persona_existente_sin_duplicarla(self):
        dni = dni_unico()
        estado, _, _ = self.recepcion.pedir('POST', '/api/pacientes', {
            'dni': dni, 'nombre': 'Antes', 'apellido': 'Paciente', 'fechaNacimiento': '1990-01-01'})
        self.assertEqual(201, estado)
        antes = consultar('SELECT COUNT(*) FROM persona')
        creado = self.crear(dni=dni, nombre='Después')
        self.assertEqual(antes, consultar('SELECT COUNT(*) FROM persona'))
        self.assertEqual('Después', creado['nombre'])
        self.assertEqual(['1', '1'], consultar(
            f"SELECT (SELECT COUNT(*) FROM paciente pa JOIN persona pe USING (id_persona) WHERE pe.dni = '{dni}'), "
            f"(SELECT COUNT(*) FROM profesional pr JOIN persona pe USING (id_persona) WHERE pe.dni = '{dni}')").pop().split('\t'))

    def test_ac006_modificar_reemplaza_especialidades(self):
        creado = self.crear()
        estado, cuerpo, _ = self.admin.pedir('PUT', f"/api/profesionales/{creado['id']}", datos_profesional(
            self.esp[2:3], nombre='Editada', matricula=creado['matricula']))
        self.assertEqual(200, estado, cuerpo)
        self.assertEqual(('Editada', [self.esp[2]]), (cuerpo['profesional']['nombre'], [e['id'] for e in cuerpo['profesional']['especialidades']]))
        self.assertEqual([str(self.esp[2])], consultar(
            f"SELECT id_especialidad FROM profesional_especialidad WHERE id_profesional = {creado['id']}"))

    def test_ac006_modificar_con_matricula_ajena_o_datos_invalidos_no_cambia_nada(self):
        a, b = self.crear(), self.crear()
        self.assertEqual('matricula_duplicada', self.codigo_error(
            'PUT', f"/api/profesionales/{b['id']}", datos_profesional(self.esp[2:3], matricula=a['matricula']), 409))
        self.assertEqual('especialidades_invalidas', self.codigo_error(
            'PUT', f"/api/profesionales/{b['id']}", datos_profesional([], matricula=b['matricula']), 400))
        _, leido, _ = self.admin.pedir('GET', f"/api/profesionales/{b['id']}")
        self.assertEqual((b['matricula'], set(self.esp[:2])), (leido['profesional']['matricula'], {e['id'] for e in leido['profesional']['especialidades']}))

    # Una especialidad desactivada después no impide editar al profesional.
    def test_ac006_especialidad_desactivada_despues_no_impide_editar(self):
        _, nueva, _ = self.admin.pedir('POST', '/api/especialidades', {'nombre': f'Temporal {uuid.uuid4().hex[:8]}'})
        temporal = nueva['especialidad']['id']
        creado = self.crear(especialidades=[self.esp[0], temporal])
        self.admin.pedir('PUT', f'/api/especialidades/{temporal}/estado', {'activa': False})
        estado, cuerpo, _ = self.admin.pedir('PUT', f"/api/profesionales/{creado['id']}", datos_profesional(
            [self.esp[0], temporal], telefono='1155559999', matricula=creado['matricula']))
        self.assertEqual(200, estado, cuerpo)
        self.assertEqual('1155559999', cuerpo['profesional']['telefono'])
        self.assertEqual({self.esp[0], temporal}, {e['id'] for e in cuerpo['profesional']['especialidades']})
        # Una inactiva que el profesional no tenía sigue rechazada, y el mensaje dice cuál.
        estado, cuerpo, _ = self.admin.pedir('PUT', f"/api/profesionales/{creado['id']}", datos_profesional(
            [self.esp[0], self.esp_inactiva], matricula=creado['matricula']))
        self.assertEqual(400, estado)
        self.assertIn(str(self.esp_inactiva), cuerpo['error']['mensaje'])

    def test_ac006_inexistente_responde_404(self):
        self.assertEqual(404, self.admin.pedir('PUT', '/api/profesionales/999999', datos_profesional(self.esp[:1]))[0])
        self.assertEqual(404, self.admin.pedir('GET', '/api/profesionales/999999')[0])
        self.assertEqual(404, self.admin.pedir('PUT', '/api/profesionales/999999/estado', {'activo': False})[0])

    def test_ac006_baja_logica_conserva_fila_y_especialidades(self):
        creado = self.crear()
        estado, cuerpo, _ = self.admin.pedir('PUT', f"/api/profesionales/{creado['id']}/estado", {'activo': False})
        self.assertEqual((200, False), (estado, cuerpo['profesional']['activo']))
        self.assertEqual(['0'], consultar(f"SELECT activo FROM profesional WHERE id_profesional = {creado['id']}"))
        self.assertEqual(['2'], consultar(f"SELECT COUNT(*) FROM profesional_especialidad WHERE id_profesional = {creado['id']}"))
        _, activos, _ = self.admin.pedir('GET', '/api/profesionales')
        self.assertNotIn(creado['id'], {p['id'] for p in activos['profesionales']})
        _, todos, _ = self.admin.pedir('GET', '/api/profesionales?estado=todos')
        self.assertIn(creado['id'], {p['id'] for p in todos['profesionales']})
        self.assertEqual(404, self.recepcion.pedir('GET', f"/api/profesionales/{creado['id']}")[0])
        estado, cuerpo, _ = self.admin.pedir('PUT', f"/api/profesionales/{creado['id']}/estado", {'activo': True})
        self.assertEqual((200, True), (estado, cuerpo['profesional']['activo']))
        self.assertIn(estado, (200,))
        self.assertIn(self.admin.pedir('DELETE', f"/api/profesionales/{creado['id']}")[0], (404, 405))

    def test_ac007_sin_sesion_toda_ruta_responde_401(self):
        anonimo = Cliente()
        for metodo, ruta, cuerpo in (
            ('GET', '/api/profesionales', None), ('GET', '/api/profesionales/1', None), ('POST', '/api/profesionales', {}),
            ('PUT', '/api/profesionales/1', {}), ('PUT', '/api/profesionales/1/estado', {'activo': False}),
        ):
            with self.subTest(metodo=metodo, ruta=ruta):
                self.assertEqual(401, anonimo.pedir(metodo, ruta, cuerpo)[0])

    def test_ac007_solo_el_administrador_escribe(self):
        creado = self.crear()
        for credenciales in (RECEPCION, PROFESIONAL, PACIENTE):
            cliente = sesion(credenciales)
            for metodo, ruta, cuerpo in (
                ('POST', '/api/profesionales', datos_profesional(self.esp[:1])),
                ('PUT', f"/api/profesionales/{creado['id']}", datos_profesional(self.esp[:1])),
                ('PUT', f"/api/profesionales/{creado['id']}/estado", {'activo': False}),
            ):
                with self.subTest(usuario=credenciales[0], metodo=metodo, ruta=ruta):
                    self.assertEqual(403, cliente.pedir(metodo, ruta, cuerpo)[0])
        _, leido, _ = self.admin.pedir('GET', f"/api/profesionales/{creado['id']}")
        self.assertTrue(leido['profesional']['activo'])

    def test_ac007_recepcion_lee_solo_activos_y_otros_roles_no_leen(self):
        creado = self.crear()
        estado, lista, _ = self.recepcion.pedir('GET', '/api/profesionales')
        self.assertEqual(200, estado)
        self.assertIn(creado['id'], {p['id'] for p in lista['profesionales']})
        self.assertEqual(200, self.recepcion.pedir('GET', f"/api/profesionales/{creado['id']}")[0])
        self.assertEqual(403, self.recepcion.pedir('GET', '/api/profesionales?estado=todos')[0])
        for credenciales in (PROFESIONAL, PACIENTE):
            cliente = sesion(credenciales)
            self.assertEqual(403, cliente.pedir('GET', '/api/profesionales')[0])
            self.assertEqual(403, cliente.pedir('GET', f"/api/profesionales/{creado['id']}")[0])


if __name__ == '__main__':
    unittest.main()
