"""Pruebas funcionales de TUR-004: consultorios y agendas contra la API real (T-002 y T-003; AC-001 a AC-007).

Requiere el entorno levantado con el esquema de db/schema.sql (sección TUR-004). Mismas variables que test_autenticacion.py.
Cada ejecución crea consultorios, profesionales y agendas nuevos: la API no permite borrarlos. Para que las pruebas no se
crucen entre sí ni con la semilla, cada una usa un profesional recién creado (salvo la que actúa como el profesional de la
cuenta de prueba, que usa un horario aleatorio fuera del lunes de la semilla) y una vigencia en un año aleatorio lejano.
"""

import os
import pathlib
import random
import subprocess
import time
import unittest
import uuid

import test_autenticacion
from test_autenticacion import ADMIN, PACIENTE, PROFESIONAL, RECEPCION, Cliente
from test_pacientes import sesion

RAIZ = pathlib.Path(__file__).resolve().parents[2]

# Miércoles por defecto: la semilla no tiene agendas ese día.
DIA_PRUEBA = 3


def numero_unico():
    return f'N{uuid.uuid4().hex[:10]}'


ANIO_MINIMO, ANIO_MAXIMO = 2200, 9000
_anios_entregados = set()


def anio_unico():
    # Años lejanos y aleatorios que no tengan ya agendas en la base: los reportes de un año (test_reportes) cuentan
    # todos los turnos de ese año, así que un año usado por una corrida anterior daría totales de más.
    ocupados = {int(anio) for anio in consultar('SELECT DISTINCT YEAR(vigente_desde) FROM agenda')} | _anios_entregados
    for _ in range(1000):
        anio = random.randint(ANIO_MINIMO, ANIO_MAXIMO)
        if anio not in ocupados:
            _anios_entregados.add(anio)
            return anio
    raise RuntimeError('No quedan años libres para las vigencias de prueba: limpiar la base de pruebas.')


def datos_consultorio(**cambios):
    datos = {'numero': numero_unico(), 'piso': 'Piso de prueba', 'ubicacion': 'Ala de prueba'}
    datos.update(cambios)
    return datos


def datos_agenda(profesional, consultorio, especialidad, anio, **cambios):
    datos = {
        'profesional': profesional, 'consultorio': consultorio, 'especialidad': especialidad,
        'diaSemana': DIA_PRUEBA, 'horaInicio': '09:00', 'horaFin': '10:00', 'duracionMinutos': 15,
        'vigenteDesde': f'{anio}-01-01', 'vigenteHasta': f'{anio}-12-31',
    }
    datos.update(cambios)
    return datos


def horario_aleatorio():
    # Días 2 a 7 y horas de 6 a 20: evita el lunes de la semilla del profesional de la cuenta de prueba (sin fin de vigencia).
    hora = random.randint(6, 20)
    return {'diaSemana': random.randint(2, 7), 'horaInicio': f'{hora:02d}:00', 'horaFin': f'{hora + 1:02d}:00'}


def consultar(sql):
    return test_autenticacion.ContrasenasTest.consultar(None, sql)


def comando_auxiliar(script, *argumentos):
    # Con Docker Compose el auxiliar corre dentro del contenedor de la aplicación (mismo código, misma base).
    contenedor = os.environ.get('DB_CONTENEDOR')
    cadena = [str(a) for a in argumentos]
    if contenedor:
        app = os.environ.get('APP_CONTENEDOR', contenedor.replace('-db-1', '-app-1'))
        return ['docker', 'exec', app, 'php', f'/app/tests/api/{script}', *cadena]
    return ['php', str(RAIZ / 'tests/api' / script), *cadena]


def profesional_por_matricula(admin, matricula):
    _, cuerpo, _ = admin.pedir('GET', '/api/profesionales?estado=todos')
    return next(p for p in cuerpo['profesionales'] if p['matricula'] == matricula)


def especialidad_por_nombre(admin, nombre):
    _, cuerpo, _ = admin.pedir('GET', '/api/especialidades')
    return next(e['id'] for e in cuerpo['especialidades'] if e['nombre'] == nombre)


def consultorio_semilla(admin, numero):
    _, cuerpo, _ = admin.pedir('GET', '/api/consultorios?estado=todos')
    return next(c['id'] for c in cuerpo['consultorios'] if c['numero'] == numero)


class ConsultoriosTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.admin = sesion(ADMIN)
        cls.recepcion = sesion(RECEPCION)
        cls.profesional = sesion(PROFESIONAL)
        cls.paciente = sesion(PACIENTE)

    def crear(self, **cambios):
        estado, cuerpo, _ = self.admin.pedir('POST', '/api/consultorios', datos_consultorio(**cambios))
        self.assertEqual(201, estado, cuerpo)
        return cuerpo['consultorio']

    def codigo_error(self, cliente, metodo, ruta, cuerpo, esperado):
        estado, respuesta, _ = cliente.pedir(metodo, ruta, cuerpo)
        self.assertEqual(esperado, estado, respuesta)
        return respuesta['error']['codigo']

    # AC-001
    def test_ac001_administrador_crea_y_el_listado_lo_muestra(self):
        creado = self.crear()
        self.assertEqual('N', creado['numero'][:1])
        _, lista, _ = self.admin.pedir('GET', '/api/consultorios')
        self.assertIn(creado['id'], {c['id'] for c in lista['consultorios']})
        estado, detalle, _ = self.admin.pedir('GET', f"/api/consultorios/{creado['id']}")
        self.assertEqual(200, estado)
        self.assertEqual(creado['numero'], detalle['consultorio']['numero'])

    def test_ac001_piso_y_ubicacion_son_opcionales(self):
        creado = self.crear(piso=None, ubicacion=None)
        self.assertIsNone(creado['piso'])
        self.assertIsNone(creado['ubicacion'])

    def test_ac001_escritura_solo_del_administrador(self):
        existente = self.crear()
        for nombre, cliente in (('recepcion', self.recepcion), ('profesional', self.profesional), ('paciente', self.paciente)):
            with self.subTest(rol=nombre):
                self.assertEqual(403, cliente.pedir('POST', '/api/consultorios', datos_consultorio())[0])
                self.assertEqual(403, cliente.pedir('PUT', f"/api/consultorios/{existente['id']}", datos_consultorio())[0])

    # AC-002
    def test_ac002_rechazos_de_datos_y_duplicado(self):
        casos = (
            ({'numero': ''}, 'numero_invalido'),
            ({'numero': '   '}, 'numero_invalido'),
            ({'numero': 'x' * 21}, 'numero_invalido'),
            ({'piso': 'x' * 21}, 'piso_invalido'),
            ({'ubicacion': 'x' * 101}, 'ubicacion_invalida'),
        )
        for cambios, codigo in casos:
            with self.subTest(cambios=cambios):
                self.assertEqual(codigo, self.codigo_error(self.admin, 'POST', '/api/consultorios', datos_consultorio(**cambios), 400))
        existente = self.crear()
        self.assertEqual('numero_duplicado', self.codigo_error(
            self.admin, 'POST', '/api/consultorios', datos_consultorio(numero=existente['numero']), 409))
        otro = self.crear()
        self.assertEqual('numero_duplicado', self.codigo_error(
            self.admin, 'PUT', f"/api/consultorios/{otro['id']}", datos_consultorio(numero=existente['numero']), 409))

    # AC-003
    def test_ac003_modificar_inexistente_responde_404(self):
        self.assertEqual(404, self.admin.pedir('PUT', '/api/consultorios/999999', datos_consultorio())[0])

    def test_ac003_modificar_actualiza_datos(self):
        creado = self.crear()
        estado, cuerpo, _ = self.admin.pedir('PUT', f"/api/consultorios/{creado['id']}", datos_consultorio(ubicacion='Nueva'))
        self.assertEqual(200, estado, cuerpo)
        self.assertEqual('Nueva', cuerpo['consultorio']['ubicacion'])

    def test_ac003_no_se_desactiva_con_agendas_activas(self):
        # Consultorio propio con una agenda y sin turnos: el 409 es sólo por la agenda activa (TUR-007 revisa turnos antes).
        creado = self.crear()
        profesional = profesional_por_matricula(self.admin, 'MP-10001')['id']
        especialidad = especialidad_por_nombre(self.admin, 'Clínica Médica')
        estado, cuerpo, _ = self.admin.pedir('POST', '/api/agendas', datos_agenda(profesional, creado['id'], especialidad, anio_unico()))
        self.assertEqual(201, estado, cuerpo)
        estado, cuerpo, _ = self.admin.pedir('PUT', f"/api/consultorios/{creado['id']}/estado", {'activo': False})
        self.assertEqual(409, estado, cuerpo)
        self.assertEqual('consultorio_con_agendas', cuerpo['error']['codigo'])
        self.assertTrue(self.admin.pedir('GET', f"/api/consultorios/{creado['id']}")[1]['consultorio']['activo'])

    def test_ac003_desactivar_conserva_la_fila_y_reactivar_la_devuelve(self):
        creado = self.crear()
        estado, cuerpo, _ = self.admin.pedir('PUT', f"/api/consultorios/{creado['id']}/estado", {'activo': False})
        self.assertEqual(200, estado, cuerpo)
        self.assertFalse(cuerpo['consultorio']['activo'])
        _, activos, _ = self.admin.pedir('GET', '/api/consultorios')
        self.assertNotIn(creado['id'], {c['id'] for c in activos['consultorios']})
        _, todos, _ = self.admin.pedir('GET', '/api/consultorios?estado=todos')
        self.assertIn(creado['id'], {c['id'] for c in todos['consultorios']})
        estado, cuerpo, _ = self.admin.pedir('PUT', f"/api/consultorios/{creado['id']}/estado", {'activo': True})
        self.assertEqual(200, estado)
        self.assertTrue(cuerpo['consultorio']['activo'])

    def test_ac003_no_hay_borrado_fisico(self):
        creado = self.crear()
        self.assertEqual(405, self.admin.pedir('DELETE', f"/api/consultorios/{creado['id']}")[0])

    # AC-007 (lectura por rol)
    def test_ac007_lectura_por_rol_y_sin_sesion(self):
        self.assertEqual(401, Cliente().pedir('GET', '/api/consultorios')[0])
        self.assertEqual(200, self.recepcion.pedir('GET', '/api/consultorios')[0])
        self.assertEqual(200, self.profesional.pedir('GET', '/api/consultorios')[0])
        self.assertEqual(403, self.profesional.pedir('GET', '/api/consultorios?estado=todos')[0])
        self.assertEqual(403, self.paciente.pedir('GET', '/api/consultorios')[0])


class AgendasTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.admin = sesion(ADMIN)
        cls.recepcion = sesion(RECEPCION)
        cls.profesional = sesion(PROFESIONAL)  # cuenta de prueba: MP-10001
        cls.paciente = sesion(PACIENTE)
        cls.p1 = profesional_por_matricula(cls.admin, 'MP-10001')['id']
        cls.p_inactivo = profesional_por_matricula(cls.admin, 'MP-10003')['id']  # inactivo; Dermatología
        cls.clinica = especialidad_por_nombre(cls.admin, 'Clínica Médica')
        cls.cardiologia = especialidad_por_nombre(cls.admin, 'Cardiología')
        cls.dermatologia = especialidad_por_nombre(cls.admin, 'Dermatología')
        cls.consultorio_inactivo = consultorio_semilla(cls.admin, '299')

    def consultorio(self):
        estado, cuerpo, _ = self.admin.pedir('POST', '/api/consultorios', datos_consultorio())
        self.assertEqual(201, estado, cuerpo)
        return cuerpo['consultorio']['id']

    def profesional_nuevo(self, especialidades=None):
        datos = {
            'dni': str(random.randint(50000000, 99999999)), 'nombre': 'Agenda', 'apellido': 'Prueba', 'telefono': None,
            'email': None, 'fechaNacimiento': '1980-01-01', 'matricula': f'AG-{uuid.uuid4().hex[:10]}',
            'especialidades': especialidades or [self.clinica],
        }
        estado, cuerpo, _ = self.admin.pedir('POST', '/api/profesionales', datos)
        self.assertEqual(201, estado, cuerpo)
        return cuerpo['profesional']['id']

    def crear(self, cliente=None, anio=None, **cambios):
        profesional = cambios.pop('profesional', None) or self.profesional_nuevo()
        consultorio = cambios.pop('consultorio', None) or self.consultorio()
        especialidad = cambios.pop('especialidad', self.clinica)
        datos = datos_agenda(profesional, consultorio, especialidad, anio or anio_unico(), **cambios)
        estado, cuerpo, _ = (cliente or self.admin).pedir('POST', '/api/agendas', datos)
        self.assertEqual(201, estado, cuerpo)
        return cuerpo['agenda']

    def codigo_error(self, metodo, ruta, cuerpo, esperado, cliente=None):
        estado, respuesta, _ = (cliente or self.admin).pedir(metodo, ruta, cuerpo)
        self.assertEqual(esperado, estado, respuesta)
        return respuesta['error']['codigo']

    # AC-004
    def test_ac004_alta_aparece_y_se_filtra_por_profesional_y_consultorio(self):
        profesional = self.profesional_nuevo()
        consultorio = self.consultorio()
        creada = self.crear(profesional=profesional, consultorio=consultorio, especialidad=self.clinica)
        self.assertEqual(profesional, creada['profesional']['id'])
        self.assertEqual(self.clinica, creada['especialidad']['id'])
        self.assertEqual('09:00', creada['horaInicio'])
        self.assertTrue(creada['activa'])
        _, por_profesional, _ = self.admin.pedir('GET', f'/api/agendas?profesional={profesional}')
        self.assertEqual([creada['id']], [a['id'] for a in por_profesional['agendas']])
        _, por_consultorio, _ = self.admin.pedir('GET', f'/api/agendas?consultorio={consultorio}')
        self.assertEqual([creada['id']], [a['id'] for a in por_consultorio['agendas']])
        self.assertEqual(200, self.admin.pedir('GET', f"/api/agendas/{creada['id']}")[0])
        # Consulta de la tabla: especialidad, día, hora de inicio y estado guardados tal cual.
        self.assertEqual([f"{self.clinica}\t3\t09:00\t1"], consultar(
            f"SELECT id_especialidad, dia_semana, TIME_FORMAT(hora_inicio, '%H:%i'), activa FROM agenda WHERE id_agenda = {creada['id']}"))

    def test_ac004_vigencia_sin_fin_se_guarda_como_nula(self):
        creada = self.crear(vigenteHasta=None)
        self.assertIsNone(creada['vigenteHasta'])

    def test_ac004_rechazos_de_datos(self):
        profesional = self.profesional_nuevo()
        anio = anio_unico()
        casos = (
            ({'horaInicio': '10:00', 'horaFin': '09:00'}, 'horario_invalido', 400),
            ({'horaFin': '09:00'}, 'horario_invalido', 400),
            ({'horaInicio': '9:00'}, 'hora_invalida', 400),
            ({'horaFin': 'mediodia'}, 'hora_invalida', 400),
            ({'duracionMinutos': 4}, 'duracion_invalida', 400),
            ({'duracionMinutos': 121}, 'duracion_invalida', 400),
            ({'duracionMinutos': '15'}, 'duracion_invalida', 400),
            ({'diaSemana': 0}, 'dia_invalido', 400),
            ({'diaSemana': 8}, 'dia_invalido', 400),
            ({'vigenteDesde': '2026-02-30'}, 'vigencia_desde_invalida', 400),
            ({'vigenteDesde': None}, 'vigencia_desde_invalida', 400),
            ({'vigenteHasta': f'{anio - 1}-12-31'}, 'vigencia_hasta_invalida', 400),
            ({'vigenteHasta': 'mañana'}, 'vigencia_hasta_invalida', 400),
            ({'vigenteDesde': f'{anio}-1-5'}, 'vigencia_desde_invalida', 400),
            ({'vigenteDesde': '0000-01-01'}, 'vigencia_desde_invalida', 400),
            ({'vigenteHasta': f'{anio}-1-5'}, 'vigencia_hasta_invalida', 400),
            ({'horaFin': '10:00\n'}, 'hora_invalida', 400),
            ({'especialidad': self.dermatologia}, 'especialidad_invalida', 400),
            ({'especialidad': 999999}, 'especialidad_invalida', 400),
            ({'profesional': 999999}, 'profesional_invalido', 400),
            ({'consultorio': 999999}, 'consultorio_invalido', 400),
            ({'profesional': self.p_inactivo, 'especialidad': self.dermatologia}, 'profesional_inactivo', 409),
            ({'consultorio': self.consultorio_inactivo}, 'consultorio_inactivo', 409),
        )
        antes = consultar('SELECT COUNT(*) FROM agenda')
        for cambios, codigo, estado in casos:
            with self.subTest(cambios=cambios):
                datos = datos_agenda(profesional, self.consultorio(), self.clinica, anio)
                datos.update(cambios)
                self.assertEqual(codigo, self.codigo_error('POST', '/api/agendas', datos, estado))
        # REV-006: ningún rechazo deja filas en la tabla.
        self.assertEqual(antes, consultar('SELECT COUNT(*) FROM agenda'))

    def test_ac004_profesional_configura_solo_su_agenda(self):
        opciones = self.profesional.pedir('GET', '/api/agendas/opciones')[1]
        self.assertEqual([self.p1], [p['id'] for p in opciones['profesionales']])
        creada = self.crear(cliente=self.profesional, profesional=self.p1, **horario_aleatorio())
        self.assertEqual(self.p1, creada['profesional']['id'])
        # sin campo «profesional» también se usa el propio
        datos = datos_agenda(None, self.consultorio(), self.clinica, anio_unico(), **horario_aleatorio())
        del datos['profesional']
        estado, cuerpo, _ = self.profesional.pedir('POST', '/api/agendas', datos)
        self.assertEqual(201, estado, cuerpo)
        self.assertEqual(self.p1, cuerpo['agenda']['profesional']['id'])
        ajeno = self.profesional_nuevo([self.cardiologia])
        self.assertEqual('no_autorizado', self.codigo_error('POST', '/api/agendas',
                         datos_agenda(ajeno, self.consultorio(), self.cardiologia, anio_unico()), 403, self.profesional))
        self.assertEqual('especialidad_invalida', self.codigo_error('POST', '/api/agendas',
                         datos_agenda(self.p1, self.consultorio(), self.cardiologia, anio_unico()), 400, self.profesional))

    # AC-005
    def test_ac005_superposicion_por_profesional_o_por_consultorio(self):
        anio = anio_unico()
        profesional = self.profesional_nuevo()
        otro = self.profesional_nuevo()
        consultorio = self.consultorio()
        self.crear(anio=anio, profesional=profesional, consultorio=consultorio)  # base: 09:00 a 10:00
        self.assertEqual('agenda_superpuesta', self.codigo_error(
            'POST', '/api/agendas', datos_agenda(profesional, self.consultorio(), self.clinica, anio, horaInicio='09:30', horaFin='10:30'), 409))
        self.assertEqual('agenda_superpuesta', self.codigo_error(
            'POST', '/api/agendas', datos_agenda(otro, consultorio, self.clinica, anio, horaInicio='09:30', horaFin='10:30'), 409))
        # Consulta de la tabla: sólo la base; los dos rechazos no dejaron filas.
        self.assertEqual(['1'], consultar(
            f"SELECT COUNT(*) FROM agenda WHERE id_profesional = {profesional} AND vigente_desde = '{anio}-01-01'"))
        self.assertEqual(['1'], consultar(
            f"SELECT COUNT(*) FROM agenda WHERE id_consultorio = {consultorio} AND vigente_desde = '{anio}-01-01'"))

    def test_ac005_limites_que_solo_se_tocan_y_vigencias_separadas_se_aceptan(self):
        anio = anio_unico()
        profesional = self.profesional_nuevo()
        self.crear(anio=anio, profesional=profesional, horaInicio='09:00', horaFin='10:00')
        self.crear(anio=anio, profesional=profesional, horaInicio='10:00', horaFin='11:00')  # empieza donde termina la otra
        self.crear(anio=anio, profesional=profesional, horaInicio='08:00', horaFin='09:00')  # termina donde empieza la otra
        self.crear(anio=anio, profesional=profesional, diaSemana=4)  # mismo horario, otro día
        self.crear(anio=anio + 1000, profesional=profesional)  # mismo día y horario, vigencia de otro año
        self.crear(anio=anio, profesional=self.profesional_nuevo(), horaInicio='09:00', horaFin='10:00')  # otro profesional y consultorio

    def test_ac005_vigencia_sin_fin_se_cruza_con_las_posteriores(self):
        profesional = self.profesional_nuevo()
        anio = anio_unico()
        self.crear(anio=anio, profesional=profesional, vigenteHasta=None)  # desde 1 de enero del año, sin fin
        self.assertEqual('agenda_superpuesta', self.codigo_error(
            'POST', '/api/agendas', datos_agenda(profesional, self.consultorio(), self.clinica, anio + 5), 409))

    def test_ac005_agenda_inactiva_no_bloquea(self):
        profesional = self.profesional_nuevo()
        anio = anio_unico()
        base = self.crear(anio=anio, profesional=profesional)
        self.assertEqual(200, self.admin.pedir('PUT', f"/api/agendas/{base['id']}/estado", {'activa': False})[0])
        self.crear(anio=anio, profesional=profesional)

    def test_ac005_el_alta_espera_al_bloqueo_y_luego_detecta_la_superposicion(self):
        # Otro proceso retiene el bloqueo del profesional y confirma una agenda que se superpone con la que enviamos por la API.
        # La API debe esperar a esa confirmación y responder 409. Sin el bloqueo respondería 201 (tests/api/bloqueo_agendas.php).
        profesional = self.profesional_nuevo()
        consultorio = self.consultorio()
        anio = anio_unico()
        auxiliar = subprocess.Popen(comando_auxiliar('bloqueo_agendas.php', profesional, consultorio, self.clinica, anio, 3),
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.assertEqual('bloqueado', auxiliar.stdout.readline().strip(), 'el auxiliar no retuvo el bloqueo')
            inicio = time.monotonic()
            estado, cuerpo, _ = self.admin.pedir('POST', '/api/agendas', datos_agenda(profesional, consultorio, self.clinica, anio))
            espera = time.monotonic() - inicio
        finally:
            salida, error = auxiliar.communicate(timeout=60)
        self.assertEqual('confirmado', salida.strip(), error)
        self.assertEqual(409, estado, cuerpo)
        self.assertEqual('agenda_superpuesta', cuerpo['error']['codigo'])
        self.assertGreater(espera, 1.0, 'el alta debía esperar a que se liberara el bloqueo')
        self.assertEqual(['1'], consultar(
            f"SELECT COUNT(*) FROM agenda WHERE id_profesional = {profesional} AND vigente_desde = '{anio}-01-01'"))

    # AC-006
    def test_ac006_modificar_excluye_la_propia_agenda(self):
        creada = self.crear()
        estado, cuerpo, _ = self.admin.pedir('PUT', f"/api/agendas/{creada['id']}", datos_agenda(
            creada['profesional']['id'], creada['consultorio']['id'], self.clinica, creada['vigenteDesde'][:4], duracionMinutos=20))
        self.assertEqual(200, estado, cuerpo)
        self.assertEqual(20, cuerpo['agenda']['duracionMinutos'])

    def test_ac006_modificar_que_se_superpone_responde_409(self):
        anio = anio_unico()
        profesional = self.profesional_nuevo()
        a = self.crear(anio=anio, profesional=profesional, horaInicio='09:00', horaFin='10:00')
        self.crear(anio=anio, profesional=profesional, horaInicio='11:00', horaFin='12:00')
        self.assertEqual('agenda_superpuesta', self.codigo_error('PUT', f"/api/agendas/{a['id']}", datos_agenda(
            profesional, a['consultorio']['id'], self.clinica, anio, horaFin='11:30'), 409))

    def test_ac006_inexistente_y_ajena_para_el_profesional(self):
        self.assertEqual(404, self.admin.pedir('PUT', '/api/agendas/999999', datos_agenda(self.p1, self.consultorio(), self.clinica, anio_unico()))[0])
        ajena = self.crear(profesional=self.profesional_nuevo([self.cardiologia]), especialidad=self.cardiologia)
        self.assertEqual(403, self.profesional.pedir('PUT', f"/api/agendas/{ajena['id']}", datos_agenda(
            ajena['profesional']['id'], ajena['consultorio']['id'], self.cardiologia, anio_unico()))[0])
        self.assertEqual(403, self.profesional.pedir('PUT', f"/api/agendas/{ajena['id']}/estado", {'activa': False})[0])

    def test_ac006_desactivar_y_reactivar_con_revalidacion(self):
        profesional = self.profesional_nuevo()
        anio = anio_unico()
        a = self.crear(anio=anio, profesional=profesional)
        self.assertEqual(200, self.admin.pedir('PUT', f"/api/agendas/{a['id']}/estado", {'activa': False})[0])
        self.assertEqual(['0'], consultar(f"SELECT activa FROM agenda WHERE id_agenda = {a['id']}"))  # la fila sigue
        c = self.crear(anio=anio, profesional=profesional)  # ocupa el hueco mientras a está inactiva
        self.assertEqual('agenda_superpuesta', self.codigo_error('PUT', f"/api/agendas/{a['id']}/estado", {'activa': True}, 409))
        self.assertEqual(200, self.admin.pedir('PUT', f"/api/agendas/{c['id']}/estado", {'activa': False})[0])
        estado, cuerpo, _ = self.admin.pedir('PUT', f"/api/agendas/{a['id']}/estado", {'activa': True})
        self.assertEqual(200, estado, cuerpo)
        self.assertTrue(cuerpo['agenda']['activa'])
        self.assertEqual(['1'], consultar(f"SELECT activa FROM agenda WHERE id_agenda = {a['id']}"))

    # REV-007: profesional o consultorio inactivos bloquean editar y reactivar, no sólo crear.
    def test_ac006_profesional_o_consultorio_inactivos_bloquean_editar_y_reactivar(self):
        profesional = self.profesional_nuevo()
        anio = anio_unico()
        a = self.crear(anio=anio, profesional=profesional)
        self.assertEqual(200, self.admin.pedir('PUT', f'/api/profesionales/{profesional}/estado', {'activo': False})[0])
        self.assertEqual('profesional_inactivo', self.codigo_error('PUT', f"/api/agendas/{a['id']}", datos_agenda(
            profesional, a['consultorio']['id'], self.clinica, anio, duracionMinutos=20), 409))
        self.assertEqual(200, self.admin.pedir('PUT', f"/api/agendas/{a['id']}/estado", {'activa': False})[0])
        self.assertEqual('profesional_inactivo', self.codigo_error('PUT', f"/api/agendas/{a['id']}/estado", {'activa': True}, 409))

        consultorio = self.consultorio()
        b = self.crear(anio=anio, consultorio=consultorio)
        self.assertEqual(200, self.admin.pedir('PUT', f"/api/agendas/{b['id']}/estado", {'activa': False})[0])
        self.assertEqual(200, self.admin.pedir('PUT', f'/api/consultorios/{consultorio}/estado', {'activo': False})[0])
        self.assertEqual('consultorio_inactivo', self.codigo_error('PUT', f"/api/agendas/{b['id']}/estado", {'activa': True}, 409))
        self.assertEqual('consultorio_inactivo', self.codigo_error('PUT', f"/api/agendas/{b['id']}", datos_agenda(
            b['profesional']['id'], consultorio, self.clinica, anio), 409))

    # A-05 (TUR-004): desactivar al profesional desactiva sus agendas; reactivarlo no las reactiva.
    def test_ac006_desactivar_profesional_desactiva_sus_agendas(self):
        profesional = self.profesional_nuevo()
        anio = anio_unico()
        a = self.crear(anio=anio, profesional=profesional, horaInicio='09:00', horaFin='10:00')
        self.crear(anio=anio, profesional=profesional, horaInicio='11:00', horaFin='12:00')
        self.assertEqual(200, self.admin.pedir('PUT', f'/api/profesionales/{profesional}/estado', {'activo': False})[0])
        filas = f"SELECT activa FROM agenda WHERE id_profesional = {profesional} ORDER BY id_agenda"
        self.assertEqual(['0', '0'], consultar(filas))
        self.assertEqual(200, self.admin.pedir('PUT', f'/api/profesionales/{profesional}/estado', {'activo': True})[0])
        self.assertEqual(['0', '0'], consultar(filas))  # reactivar al profesional no reactiva sus agendas
        estado, cuerpo, _ = self.admin.pedir('PUT', f"/api/agendas/{a['id']}/estado", {'activa': True})
        self.assertEqual(200, estado, cuerpo)  # cada agenda se reactiva por separado, con sus validaciones

    # A-05 (TUR-004): quitar una especialidad desactiva sólo las agendas que la usan.
    def test_ac004_quitar_especialidad_desactiva_solo_las_agendas_de_esa_especialidad(self):
        profesional = self.profesional_nuevo([self.clinica, self.cardiologia])
        anio = anio_unico()
        con_clinica = self.crear(anio=anio, profesional=profesional, especialidad=self.clinica, horaInicio='09:00', horaFin='10:00')
        con_cardio = self.crear(anio=anio, profesional=profesional, especialidad=self.cardiologia, horaInicio='11:00', horaFin='12:00')
        actual = self.admin.pedir('GET', f'/api/profesionales/{profesional}')[1]['profesional']
        estado, cuerpo, _ = self.admin.pedir('PUT', f'/api/profesionales/{profesional}', {
            'nombre': actual['nombre'], 'apellido': actual['apellido'], 'telefono': None, 'email': None,
            'fechaNacimiento': actual['fechaNacimiento'], 'matricula': actual['matricula'], 'especialidades': [self.clinica],
        })
        self.assertEqual(200, estado, cuerpo)
        self.assertEqual(['1', '0'], consultar(
            f"SELECT activa FROM agenda WHERE id_agenda IN ({con_clinica['id']}, {con_cardio['id']}) ORDER BY id_agenda"))
        # Consecuencia: reactivar la agenda sin esa especialidad exige cambiarla antes (400 especialidad_invalida).
        self.assertEqual('especialidad_invalida', self.codigo_error(
            'PUT', f"/api/agendas/{con_cardio['id']}/estado", {'activa': True}, 400))

    # REV-TUR-004-019: quitar una especialidad espera a un alta concurrente del profesional y desactiva también la agenda
    # que esa alta confirma. Sin el bloqueo del profesional al empezar modificar(), la prueba recibe agendasDesactivadas 0.
    def test_ac004_quitar_especialidad_espera_al_alta_concurrente_y_desactiva_su_agenda(self):
        profesional = self.profesional_nuevo([self.clinica, self.cardiologia])
        anio = anio_unico()
        auxiliar = subprocess.Popen(comando_auxiliar('bloqueo_agendas.php', profesional, self.consultorio(), self.cardiologia, anio, 3),
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.assertEqual('bloqueado', auxiliar.stdout.readline().strip(), 'el auxiliar no retuvo el bloqueo')
            actual = self.admin.pedir('GET', f'/api/profesionales/{profesional}')[1]['profesional']
            estado, cuerpo, _ = self.admin.pedir('PUT', f'/api/profesionales/{profesional}', {
                'nombre': actual['nombre'], 'apellido': actual['apellido'], 'telefono': None, 'email': None,
                'fechaNacimiento': actual['fechaNacimiento'], 'matricula': actual['matricula'], 'especialidades': [self.clinica],
            })
        finally:
            salida, error = auxiliar.communicate(timeout=60)
        self.assertEqual('confirmado', salida.strip(), error)
        self.assertEqual(200, estado, cuerpo)
        self.assertEqual(1, cuerpo['agendasDesactivadas'])
        self.assertEqual(['0'], consultar(
            f"SELECT activa FROM agenda WHERE id_profesional = {profesional} AND vigente_desde = '{anio}-01-01'"))

    # REV-TUR-004-016 (A-05): una alta con una especialidad que se está desactivando espera y responde 400; no queda
    # una agenda activa con especialidad inactiva. Sin FOR SHARE en la alta, la prueba recibe 201.
    def test_ac005_alta_con_especialidad_que_se_desactiva_espera_y_se_rechaza(self):
        especialidad = self.admin.pedir('POST', '/api/especialidades', {'nombre': f'Carrera A05 {uuid.uuid4().hex[:8]}'})[1]['especialidad']['id']
        profesional = self.profesional_nuevo([especialidad])
        anio = anio_unico()
        auxiliar = subprocess.Popen(comando_auxiliar('bloqueo_especialidad.php', especialidad, 3),
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.assertEqual('bloqueado', auxiliar.stdout.readline().strip(), 'el auxiliar no retuvo la especialidad')
            inicio = time.monotonic()
            estado, cuerpo, _ = self.admin.pedir('POST', '/api/agendas', datos_agenda(profesional, self.consultorio(), especialidad, anio))
            espera = time.monotonic() - inicio
        finally:
            salida, error = auxiliar.communicate(timeout=60)
        self.assertEqual('confirmado', salida.strip(), error)
        self.assertEqual(400, estado, cuerpo)  # sin la espera, el alta se confirma con 201
        self.assertEqual('especialidad_invalida', cuerpo['error']['codigo'])
        self.assertGreater(espera, 1.0, 'el alta debía esperar a que se confirmara la desactivación')
        self.assertEqual(['0'], consultar(f"SELECT COUNT(*) FROM agenda WHERE id_profesional = {profesional}"))

    # REV-TUR-004-014 (A-05): las respuestas indican cuántas agendas se desactivaron o reactivaron.
    def test_ac006_respuestas_indican_las_agendas_desactivadas(self):
        profesional = self.profesional_nuevo([self.clinica, self.cardiologia])
        anio = anio_unico()
        self.crear(anio=anio, profesional=profesional, horaInicio='09:00', horaFin='10:00')
        self.crear(anio=anio, profesional=profesional, especialidad=self.cardiologia, horaInicio='11:00', horaFin='12:00')
        actual = self.admin.pedir('GET', f'/api/profesionales/{profesional}')[1]['profesional']
        estado, cuerpo, _ = self.admin.pedir('PUT', f'/api/profesionales/{profesional}', {
            'nombre': actual['nombre'], 'apellido': actual['apellido'], 'telefono': None, 'email': None,
            'fechaNacimiento': actual['fechaNacimiento'], 'matricula': actual['matricula'], 'especialidades': [self.clinica],
        })
        self.assertEqual((200, 1), (estado, cuerpo['agendasDesactivadas']))  # quitar cardiología desactiva una agenda
        estado, cuerpo, _ = self.admin.pedir('PUT', f'/api/profesionales/{profesional}/estado', {'activo': False})
        self.assertEqual((200, 1), (estado, cuerpo['agendasDesactivadas']))  # la de clínica
        estado, cuerpo, _ = self.admin.pedir('PUT', f'/api/profesionales/{profesional}/estado', {'activo': True})
        self.assertEqual((200, 0), (estado, cuerpo['agendasDesactivadas']))  # reactivar no reactiva agendas

    # A-05 (TUR-004 y TUR-002): desactivar una especialidad desactiva las agendas que la usan; reactivarla no las reactiva.
    def test_ac006_desactivar_especialidad_desactiva_sus_agendas(self):
        especialidad = self.admin.pedir('POST', '/api/especialidades', {'nombre': f'Acuerdo A05 {uuid.uuid4().hex[:8]}'})[1]['especialidad']['id']
        profesional = self.profesional_nuevo([especialidad])
        a = self.crear(anio=anio_unico(), profesional=profesional, especialidad=especialidad)
        estado, cuerpo, _ = self.admin.pedir('PUT', f'/api/especialidades/{especialidad}/estado', {'activa': False})
        self.assertEqual((200, 1), (estado, cuerpo['agendasDesactivadas']))
        self.assertEqual(['0'], consultar(f"SELECT activa FROM agenda WHERE id_agenda = {a['id']}"))
        estado, cuerpo, _ = self.admin.pedir('PUT', f'/api/especialidades/{especialidad}/estado', {'activa': True})
        self.assertEqual((200, 0), (estado, cuerpo['agendasDesactivadas']))
        self.assertEqual(['0'], consultar(f"SELECT activa FROM agenda WHERE id_agenda = {a['id']}"))

    def test_ac006_no_hay_borrado_fisico(self):
        creada = self.crear()
        self.assertEqual(405, self.admin.pedir('DELETE', f"/api/agendas/{creada['id']}")[0])

    # AC-007
    def test_ac007_control_de_acceso(self):
        datos = datos_agenda(self.p1, self.consultorio_inactivo, self.clinica, 2200)
        self.assertEqual(401, Cliente().pedir('GET', '/api/agendas')[0])
        self.assertEqual(401, Cliente().pedir('POST', '/api/agendas', datos)[0])
        self.assertEqual(403, self.recepcion.pedir('POST', '/api/agendas', datos)[0])
        self.assertEqual(403, self.paciente.pedir('GET', '/api/agendas')[0])
        self.assertEqual(403, self.recepcion.pedir('GET', '/api/agendas?estado=todas')[0])
        self.assertEqual(403, self.recepcion.pedir('GET', '/api/agendas/opciones')[0])
        self.assertEqual(200, self.recepcion.pedir('GET', '/api/agendas')[0])

    def test_ac007_sin_sesion_todas_las_rutas_responden_401(self):
        rutas = (
            ('GET', '/api/consultorios'), ('POST', '/api/consultorios'), ('GET', '/api/consultorios/1'),
            ('PUT', '/api/consultorios/1'), ('PUT', '/api/consultorios/1/estado'),
            ('GET', '/api/agendas'), ('POST', '/api/agendas'), ('GET', '/api/agendas/opciones'),
            ('GET', '/api/agendas/1'), ('PUT', '/api/agendas/1'), ('PUT', '/api/agendas/1/estado'),
        )
        for metodo, ruta in rutas:
            with self.subTest(metodo=metodo, ruta=ruta):
                self.assertEqual(401, Cliente().pedir(metodo, ruta, {})[0])

    def test_ac007_profesional_lee_solo_las_suyas(self):
        ajena = self.crear(profesional=self.profesional_nuevo([self.cardiologia]), especialidad=self.cardiologia)
        propia = self.crear(profesional=self.p1, **horario_aleatorio())
        _, lista, _ = self.profesional.pedir('GET', '/api/agendas?estado=todas')
        self.assertIn(propia['id'], {a['id'] for a in lista['agendas']})
        self.assertNotIn(ajena['id'], {a['id'] for a in lista['agendas']})
        self.assertEqual(403, self.profesional.pedir('GET', f"/api/agendas?profesional={ajena['profesional']['id']}")[0])
        self.assertEqual(403, self.profesional.pedir('GET', f"/api/agendas/{ajena['id']}")[0])
        self.assertEqual(200, self.profesional.pedir('GET', f"/api/agendas/{propia['id']}")[0])

    def test_recepcion_lee_solo_activas(self):
        inactiva = self.crear()
        self.admin.pedir('PUT', f"/api/agendas/{inactiva['id']}/estado", {'activa': False})
        _, lista, _ = self.recepcion.pedir('GET', '/api/agendas')
        self.assertTrue(all(a['activa'] for a in lista['agendas']))
        self.assertEqual(404, self.recepcion.pedir('GET', f"/api/agendas/{inactiva['id']}")[0])


if __name__ == '__main__':
    unittest.main()
