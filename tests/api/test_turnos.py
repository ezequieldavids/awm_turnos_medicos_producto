"""Pruebas funcionales de turnos y disponibilidad contra la API real.

Requiere el entorno levantado con el esquema de db/schema.sql. Mismas variables que
test_agendas.py. Cada ejecución crea profesionales, consultorios, agendas, pacientes y turnos nuevos; la API no borra
registros. Para que las pruebas no se crucen entre sí ni con la semilla, cada una usa un año lejano y aleatorio.
"""

import datetime
import random
import subprocess
import time
import unittest
import uuid

from test_agendas import (DIA_PRUEBA, anio_unico, comando_auxiliar, consultar, consultorio_semilla, datos_agenda,
                          datos_consultorio, especialidad_por_nombre, profesional_por_matricula)
from test_autenticacion import ADMIN, PACIENTE, PROFESIONAL, RECEPCION, Cliente
from test_pacientes import sesion

# Paciente de la semilla: 30000001 tiene un turno confirmado ya pasado (2026-10-05) con MP-10001.
DNI_PACIENTE_CUENTA = '20000004'


def dni_unico():
    return str(random.randint(50000000, 99999999))


def nombre_unico():
    return f'Turno {uuid.uuid4().hex[:8]}'


def primera_fecha(anio, dia_semana):
    # Primera fecha del año que cae en el día de la semana pedido (1 = lunes … 7 = domingo).
    fecha = datetime.date(anio, 1, 1)
    while fecha.isoweekday() != dia_semana:
        fecha += datetime.timedelta(days=1)
    return fecha.isoformat()


def datos_paciente():
    return {
        'dni': dni_unico(), 'nombre': 'Paciente', 'apellido': 'Turnos', 'telefono': None, 'email': None,
        'fechaNacimiento': '1990-05-17', 'obraSocial': None,
    }


def cuerpo_reserva(agenda, fecha, hora, **cambios):
    datos = {'agenda': agenda, 'fecha': fecha, 'horaInicio': hora}
    datos.update(cambios)
    return datos


def paciente_de_cuenta(admin):
    _, cuerpo, _ = admin.pedir('GET', '/api/pacientes?estado=todos')
    return next(p['id'] for p in cuerpo['pacientes'] if p['dni'] == DNI_PACIENTE_CUENTA)


def turnos_de(cliente, **filtros):
    consulta = '&'.join(f'{k}={v}' for k, v in filtros.items())
    estado, cuerpo, _ = cliente.pedir('GET', f'/api/turnos?{consulta}')
    return estado, cuerpo


def horas_libres(cliente, especialidad, fecha, profesional=None):
    consulta = f'especialidad={especialidad}&fecha_desde={fecha}&fecha_hasta={fecha}'
    if profesional is not None:
        consulta += f'&profesional={profesional}'
    estado, cuerpo, _ = cliente.pedir('GET', f'/api/disponibilidad?{consulta}')
    return estado, cuerpo


class TurnosBase(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.admin = sesion(ADMIN)
        cls.recepcion = sesion(RECEPCION)
        cls.profesional = sesion(PROFESIONAL)  # cuenta de prueba: MP-10001
        cls.paciente = sesion(PACIENTE)  # paciente 20000004
        cls.clinica = especialidad_por_nombre(cls.admin, 'Clínica Médica')
        cls.cardiologia = especialidad_por_nombre(cls.admin, 'Cardiología')
        cls.p_cuenta = profesional_por_matricula(cls.admin, 'MP-10001')['id']
        cls.paciente_cuenta = paciente_de_cuenta(cls.admin)

    def paciente_nuevo(self):
        estado, cuerpo, _ = self.recepcion.pedir('POST', '/api/pacientes', datos_paciente())
        self.assertEqual(201, estado, cuerpo)
        return cuerpo['paciente']['id']

    def profesional_nuevo(self, especialidades=None):
        dni = dni_unico()
        datos = {
            'dni': dni, 'nombre': 'Turnos', 'apellido': 'Prueba', 'telefono': None, 'email': None,
            'fechaNacimiento': '1980-01-01', 'matricula': f'TU-{uuid.uuid4().hex[:10]}',
            'especialidades': especialidades or [self.clinica],
        }
        estado, cuerpo, _ = self.admin.pedir('POST', '/api/profesionales', datos)
        self.assertEqual(201, estado, cuerpo)
        return cuerpo['profesional']['id']

    def consultorio(self):
        estado, cuerpo, _ = self.admin.pedir('POST', '/api/consultorios', datos_consultorio())
        self.assertEqual(201, estado, cuerpo)
        return cuerpo['consultorio']['id']

    def agenda(self, anio=None, profesional=None, especialidad=None, **cambios):
        anio = anio or anio_unico()
        profesional = profesional or self.profesional_nuevo([especialidad or self.clinica])
        consultorio = self.consultorio()
        datos = datos_agenda(profesional, consultorio, especialidad or self.clinica, anio, **cambios)
        estado, cuerpo, _ = self.admin.pedir('POST', '/api/agendas', datos)
        self.assertEqual(201, estado, cuerpo)
        return {'id': cuerpo['agenda']['id'], 'profesional': profesional, 'consultorio': consultorio, 'anio': anio,
                'fecha': primera_fecha(anio, DIA_PRUEBA)}

    def reservar(self, cliente, agenda, hora, paciente=None, **cambios):
        cuerpo = cuerpo_reserva(agenda['id'], agenda['fecha'], hora, **cambios)
        if paciente is not None:
            cuerpo['paciente'] = paciente
        return cliente.pedir('POST', '/api/turnos', cuerpo)

    def turno_en(self, cliente, agenda, hora, paciente=None):
        estado, cuerpo, _ = self.reservar(cliente, agenda, hora, paciente)
        self.assertEqual(201, estado, cuerpo)
        return cuerpo['turno']


class DisponibilidadTest(TurnosBase):

    # Franjas libres de la agenda; las ocupadas no aparecen, las canceladas vuelven a estar libres.
    def test_ac001_excluye_ocupadas_y_reaparece_al_cancelar(self):
        agenda = self.agenda()  # 09:00 a 10:00, de 15 minutos: 4 franjas
        turno = self.turno_en(self.recepcion, agenda, '09:00', self.paciente_nuevo())

        _, cuerpo = horas_libres(self.paciente, self.clinica, agenda['fecha'], agenda['profesional'])
        self.assertEqual(['09:15', '09:30', '09:45'], [f['horaInicio'] for f in cuerpo['franjas']])

        self.assertEqual(200, self.recepcion.pedir('PUT', f"/api/turnos/{turno['id']}/estado", {'estado': 'cancelado'})[0])
        _, cuerpo = horas_libres(self.paciente, self.clinica, agenda['fecha'], agenda['profesional'])
        self.assertEqual(['09:00', '09:15', '09:30', '09:45'], [f['horaInicio'] for f in cuerpo['franjas']])

    # Todos los roles autenticados consultan la disponibilidad.
    def test_ac001_todos_los_roles_leen_y_sin_sesion_401(self):
        agenda = self.agenda()
        for nombre, cliente in (('paciente', self.paciente), ('profesional', self.profesional),
                                ('recepcion', self.recepcion), ('administrador', self.admin)):
            with self.subTest(rol=nombre):
                self.assertEqual(200, horas_libres(cliente, self.clinica, agenda['fecha'], agenda['profesional'])[0])
        self.assertEqual(401, Cliente().pedir('GET', f"/api/disponibilidad?especialidad={self.clinica}"
                                                   f"&fecha_desde={agenda['fecha']}&fecha_hasta={agenda['fecha']}")[0])

    # Parámetros y rango inválidos responden 400.
    def test_ac001_parametros_y_rango_invalidos_responden_400(self):
        fecha = '2300-03-01'
        casos = [
            f'fecha_desde={fecha}&fecha_hasta={fecha}',  # falta especialidad
            f'especialidad={self.clinica}&fecha_desde={fecha}',  # falta fecha de fin
            f'especialidad={self.clinica}&fecha_desde=2300-13-01&fecha_hasta=2300-13-02',  # fecha inexistente
            f'especialidad={self.clinica}&fecha_desde=2300-03-05&fecha_hasta=2300-03-01',  # inicio posterior al fin
            f'especialidad={self.clinica}&fecha_desde=2300-01-01&fecha_hasta=2300-02-01',  # más de 31 días
        ]
        for consulta in casos:
            with self.subTest(consulta=consulta):
                estado, cuerpo, _ = self.paciente.pedir('GET', f'/api/disponibilidad?{consulta}')
                self.assertEqual(400, estado, cuerpo)


class ReservaTest(TurnosBase):

    # El paciente reserva para sí mismo y aparece en su listado.
    def test_ac002_paciente_reserva_para_si_mismo(self):
        agenda = self.agenda()
        estado, cuerpo, _ = self.reservar(self.paciente, agenda, '09:30', motivo='  Control de rutina  ')
        self.assertEqual(201, estado, cuerpo)
        self.assertEqual('confirmado', cuerpo['turno']['estado'])
        self.assertEqual('Control de rutina', cuerpo['turno']['motivo'])
        self.assertEqual(self.paciente_cuenta, cuerpo['turno']['paciente']['id'])
        _, listado = turnos_de(self.paciente, desde=agenda['fecha'], hasta=agenda['fecha'])
        self.assertIn(cuerpo['turno']['id'], [t['id'] for t in listado['turnos']])

    # Recepción y administrador reservan para cualquier paciente.
    def test_ac002_recepcion_y_administrador_reservan_para_un_paciente(self):
        agenda = self.agenda()
        paciente = self.paciente_nuevo()
        for cliente, hora in ((self.recepcion, '09:00'), (self.admin, '09:15')):
            with self.subTest(hora=hora):
                estado, cuerpo, _ = self.reservar(cliente, agenda, hora, paciente)
                self.assertEqual(201, estado, cuerpo)
                self.assertEqual(paciente, cuerpo['turno']['paciente']['id'])

    # El paciente no reserva para otro (403) y la recepción debe indicar el paciente (400).
    def test_ac002_paciente_no_reserva_para_otro_y_recepcion_exige_paciente(self):
        agenda = self.agenda()
        self.assertEqual(403, self.reservar(self.paciente, agenda, '09:00', paciente=self.paciente_nuevo())[0])
        estado, cuerpo, _ = self.reservar(self.recepcion, agenda, '09:00')
        self.assertEqual(400, estado, cuerpo)
        self.assertEqual('datos_invalidos', cuerpo['error']['codigo'])

    # Franjas que no corresponden a la agenda, fechas pasadas, datos mal formados.
    def test_ac002_rechazos_de_franja_fecha_y_datos(self):
        agenda = self.agenda()
        otro_dia = (datetime.date.fromisoformat(agenda['fecha']) + datetime.timedelta(days=1)).isoformat()
        fuera_de_vigencia = primera_fecha(agenda['anio'] + 1, DIA_PRUEBA)
        seed = self.seed_agenda_lunes()
        casos = [
            ('franja_invalida', self.reservar(self.paciente, agenda, '09:05')),  # no está en la grilla de 15 minutos
            ('franja_invalida', self.reservar(self.paciente, agenda, '08:45')),  # antes del horario de la agenda
            ('franja_invalida', self.reservar(self.paciente, agenda, '10:00')),  # termina después de la agenda
            ('franja_invalida', self.reservar(self.paciente, {**agenda, 'fecha': otro_dia}, '09:00')),  # otro día
            ('franja_invalida', self.reservar(self.paciente, {**agenda, 'fecha': fuera_de_vigencia}, '09:00')),
            ('fecha_pasada', self.reservar(self.paciente, {**seed, 'fecha': '2026-10-05'}, '08:30')),  # ya pasó
            ('datos_invalidos', self.reservar(self.paciente, agenda, '9:00')),  # formato de hora
            ('datos_invalidos', self.reservar(self.paciente, agenda, '09:00', motivo='x' * 256)),
            ('paciente_invalido', self.reservar(self.recepcion, agenda, '09:00', paciente=999999999)),
            ('agenda_invalida', self.reservar(self.paciente, {**agenda, 'id': 999999999}, '09:00')),
        ]
        for codigo, (estado, cuerpo, _) in casos:
            with self.subTest(codigo=codigo):
                self.assertEqual(400, estado, cuerpo)
                self.assertEqual(codigo, cuerpo['error']['codigo'])

    def seed_agenda_lunes(self):
        # Agenda de la semilla: MP-10001, lunes de 08:00 a 12:00 (vigencia sin fin).
        _, cuerpo, _ = self.admin.pedir('GET', f'/api/agendas?profesional={self.p_cuenta}')
        agenda = next(a for a in cuerpo['agendas'] if a['diaSemana'] == 1 and a['horaInicio'] == '08:00')
        return {'id': agenda['id'], 'profesional': self.p_cuenta, 'anio': 2026, 'fecha': '2026-10-12'}


class SuperposicionTest(TurnosBase):

    # Otro paciente no puede tomar la misma franja del profesional.
    def test_ac003_franja_ocupada_por_el_mismo_profesional(self):
        agenda = self.agenda()
        self.turno_en(self.recepcion, agenda, '09:00', self.paciente_nuevo())
        estado, cuerpo, _ = self.reservar(self.recepcion, agenda, '09:00', self.paciente_nuevo())
        self.assertEqual((409, 'franja_ocupada'), (estado, cuerpo['error']['codigo']))
        _, listado = turnos_de(self.recepcion, profesional=agenda['profesional'], desde=agenda['fecha'], hasta=agenda['fecha'])
        self.assertEqual(1, len(listado['turnos']))

    # El mismo paciente no puede tener dos turnos superpuestos con profesionales distintos.
    def test_ac003_paciente_no_se_superpone_con_otro_profesional(self):
        paciente = self.paciente_nuevo()
        primera = self.agenda(anio=2400)
        otra = self.agenda(anio=primera['anio'])  # mismo día y horario, otro profesional y consultorio
        self.turno_en(self.recepcion, primera, '09:00', paciente)
        estado, cuerpo, _ = self.reservar(self.recepcion, otra, '09:00', paciente)
        self.assertEqual((409, 'paciente_superpuesto'), (estado, cuerpo['error']['codigo']))

    # Franjas que sólo se tocan en el límite se aceptan.
    def test_ac003_franjas_contiguas_se_aceptan(self):
        agenda = self.agenda()
        paciente = self.paciente_nuevo()
        self.turno_en(self.recepcion, agenda, '09:00', paciente)
        self.turno_en(self.recepcion, agenda, '09:15', paciente)

    # Un turno cancelado no ocupa la franja.
    def test_ac003_turno_cancelado_libera_la_franja(self):
        agenda = self.agenda()
        turno = self.turno_en(self.recepcion, agenda, '09:00', self.paciente_nuevo())
        self.recepcion.pedir('PUT', f"/api/turnos/{turno['id']}/estado", {'estado': 'cancelado'})
        self.turno_en(self.recepcion, agenda, '09:00', self.paciente_nuevo())

    # Una agenda inactiva no admite turnos.
    def test_ac003_agenda_inactiva_rechaza_la_reserva(self):
        agenda = self.agenda()
        self.assertEqual(200, self.admin.pedir('PUT', f"/api/agendas/{agenda['id']}/estado", {'activa': False})[0])
        estado, cuerpo, _ = self.reservar(self.recepcion, agenda, '09:00', self.paciente_nuevo())
        self.assertEqual((409, 'agenda_inactiva'), (estado, cuerpo['error']['codigo']))

    # Una reserva que llega mientras otra transacción retiene el profesional espera el bloqueo y, al liberarse,
    # detecta la franja ocupada (409), sin confirmar un turno duplicado.
    def test_ac003_la_reserva_espera_al_bloqueo_y_detecta_la_franja_ocupada(self):
        agenda = self.agenda()
        retiene = self.paciente_nuevo()
        pide = self.paciente_nuevo()
        auxiliar = subprocess.Popen(comando_auxiliar('bloqueo_turnos.php', agenda['id'], retiene, agenda['fecha'], '09:00', 3),
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.assertEqual('bloqueado', auxiliar.stdout.readline().strip(), 'el auxiliar no retuvo el bloqueo')
            inicio = time.monotonic()
            estado, cuerpo, _ = self.reservar(self.recepcion, agenda, '09:00', pide)
            espera = time.monotonic() - inicio
        finally:
            salida, error = auxiliar.communicate(timeout=60)
        self.assertEqual('confirmado', salida.strip(), error)
        self.assertEqual((409, 'franja_ocupada'), (estado, cuerpo['error']['codigo']))
        self.assertGreater(espera, 1.0, 'la reserva debía esperar a que se liberara el bloqueo')
        _, listado = turnos_de(self.recepcion, profesional=agenda['profesional'], desde=agenda['fecha'], hasta=agenda['fecha'])
        self.assertEqual([retiene], [t['paciente']['id'] for t in listado['turnos']])


class CancelacionTest(TurnosBase):

    # El paciente cancela su turno; la franja vuelve a estar libre.
    def test_ac004_paciente_cancela_su_turno(self):
        agenda = self.agenda()
        turno = self.turno_en(self.paciente, agenda, '09:00')
        estado, cuerpo, _ = self.paciente.pedir('PUT', f"/api/turnos/{turno['id']}/estado", {'estado': 'cancelado'})
        self.assertEqual(200, estado, cuerpo)
        self.assertEqual('cancelado', cuerpo['turno']['estado'])
        _, libres = horas_libres(self.paciente, self.clinica, agenda['fecha'], agenda['profesional'])
        self.assertIn('09:00', [f['horaInicio'] for f in libres['franjas']])

    # Sólo cancela sus propios turnos; cancelar dos veces, o cambiar a otro estado, se rechaza.
    def test_ac004_ajeno_repetido_y_estado_invalido(self):
        agenda = self.agenda()
        turno = self.turno_en(self.recepcion, agenda, '09:00', self.paciente_nuevo())
        self.assertEqual(403, self.paciente.pedir('PUT', f"/api/turnos/{turno['id']}/estado", {'estado': 'cancelado'})[0])
        # Un turno no vuelve a «confirmado» (409); un valor desconocido sigue siendo un dato inválido (400).
        self.assertEqual(409, self.recepcion.pedir('PUT', f"/api/turnos/{turno['id']}/estado", {'estado': 'confirmado'})[0])
        self.assertEqual(400, self.recepcion.pedir('PUT', f"/api/turnos/{turno['id']}/estado", {'estado': 'otro'})[0])
        self.assertEqual(200, self.recepcion.pedir('PUT', f"/api/turnos/{turno['id']}/estado", {'estado': 'cancelado'})[0])
        estado, cuerpo, _ = self.recepcion.pedir('PUT', f"/api/turnos/{turno['id']}/estado", {'estado': 'cancelado'})
        self.assertEqual((409, 'turno_cancelado'), (estado, cuerpo['error']['codigo']))

    # Un turno ya pasado no se cancela; el profesional no cancela.
    def test_ac004_turno_pasado_y_profesional_no_cancelan(self):
        pasado = self.seed_turno_pasado()
        estado, cuerpo, _ = self.recepcion.pedir('PUT', f"/api/turnos/{pasado['id']}/estado", {'estado': 'cancelado'})
        self.assertEqual((409, 'turno_pasado'), (estado, cuerpo['error']['codigo']))
        agenda = self.agenda()
        turno = self.turno_en(self.recepcion, agenda, '09:00', self.paciente_nuevo())
        self.assertEqual(403, self.profesional.pedir('PUT', f"/api/turnos/{turno['id']}/estado", {'estado': 'cancelado'})[0])

    def seed_turno_pasado(self):
        _, cuerpo = turnos_de(self.admin, desde='2026-10-05', hasta='2026-10-05')
        return next(t for t in cuerpo['turnos'] if t['paciente']['dni'] == '30000001')


class BloqueoTest(TurnosBase):

    # Cancelar espera el bloqueo del profesional (orden paciente → profesional → consultorio → turno)
    # y luego se confirma, en vez de fallar con 1213 o responder un conflicto falso.
    def test_ac004_cancelar_espera_al_bloqueo_del_profesional_y_confirma(self):
        agenda = self.agenda()
        turno = self.turno_en(self.recepcion, agenda, '09:00', self.paciente_nuevo())
        auxiliar = subprocess.Popen(comando_auxiliar('bloqueo_turnos.php', agenda['id'], self.paciente_nuevo(), agenda['fecha'], '09:30', 3),
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.assertEqual('bloqueado', auxiliar.stdout.readline().strip(), 'el auxiliar no retuvo el bloqueo')
            inicio = time.monotonic()
            estado, cuerpo, _ = self.recepcion.pedir('PUT', f"/api/turnos/{turno['id']}/estado", {'estado': 'cancelado'})
            espera = time.monotonic() - inicio
        finally:
            salida, error = auxiliar.communicate(timeout=60)
        self.assertEqual('confirmado', salida.strip(), error)
        self.assertEqual(200, estado, cuerpo)
        self.assertEqual('cancelado', cuerpo['turno']['estado'])
        self.assertGreater(espera, 1.0, 'la cancelación debía esperar al bloqueo del profesional')


class ReprogramacionTest(TurnosBase):

    # Cambia de profesional dentro de la misma especialidad; conserva el id y libera la franja anterior.
    def test_ac005_reprograma_a_otro_profesional_de_la_misma_especialidad(self):
        paciente = self.paciente_nuevo()
        origen = self.agenda(anio=2500)
        destino = self.agenda(anio=origen['anio'])
        turno = self.turno_en(self.recepcion, origen, '09:00', paciente)
        estado, cuerpo, _ = self.recepcion.pedir('PUT', f"/api/turnos/{turno['id']}/reprogramacion",
                                                 cuerpo_reserva(destino['id'], destino['fecha'], '09:15'))
        self.assertEqual(200, estado, cuerpo)
        self.assertEqual(turno['id'], cuerpo['turno']['id'])
        self.assertEqual(destino['profesional'], cuerpo['turno']['profesional']['id'])
        self.assertEqual('09:15', cuerpo['turno']['horaInicio'])
        _, libres = horas_libres(self.recepcion, self.clinica, origen['fecha'], origen['profesional'])
        self.assertIn('09:00', [f['horaInicio'] for f in libres['franjas']])

    # Una franja ocupada rechaza el cambio y el turno no se mueve.
    def test_ac005_franja_ocupada_no_mueve_el_turno(self):
        agenda = self.agenda()
        turno = self.turno_en(self.recepcion, agenda, '09:00', self.paciente_nuevo())
        self.turno_en(self.recepcion, agenda, '09:30', self.paciente_nuevo())
        estado, cuerpo, _ = self.recepcion.pedir('PUT', f"/api/turnos/{turno['id']}/reprogramacion",
                                                 cuerpo_reserva(agenda['id'], agenda['fecha'], '09:30'))
        self.assertEqual((409, 'franja_ocupada'), (estado, cuerpo['error']['codigo']))
        _, actual = turnos_de(self.recepcion, profesional=agenda['profesional'], desde=agenda['fecha'], hasta=agenda['fecha'])
        self.assertIn(('09:00', turno['id']), [(t['horaInicio'], t['id']) for t in actual['turnos']])

    # Sólo misma especialidad; cancelados y pasados no se reprograman; el paciente no mueve turnos ajenos.
    def test_ac005_especialidad_estado_y_propiedad(self):
        agenda = self.agenda()
        turno = self.turno_en(self.recepcion, agenda, '09:00', self.paciente_nuevo())
        otra = self.agenda(especialidad=self.cardiologia, profesional=self.profesional_nuevo([self.cardiologia]))
        estado, cuerpo, _ = self.recepcion.pedir('PUT', f"/api/turnos/{turno['id']}/reprogramacion",
                                                 cuerpo_reserva(otra['id'], otra['fecha'], '09:00'))
        self.assertEqual((400, 'especialidad_distinta'), (estado, cuerpo['error']['codigo']))
        self.assertEqual(403, self.paciente.pedir('PUT', f"/api/turnos/{turno['id']}/reprogramacion",
                                                  cuerpo_reserva(agenda['id'], agenda['fecha'], '09:15'))[0])
        self.recepcion.pedir('PUT', f"/api/turnos/{turno['id']}/estado", {'estado': 'cancelado'})
        estado, cuerpo, _ = self.recepcion.pedir('PUT', f"/api/turnos/{turno['id']}/reprogramacion",
                                                 cuerpo_reserva(agenda['id'], agenda['fecha'], '09:15'))
        self.assertEqual((409, 'turno_cancelado'), (estado, cuerpo['error']['codigo']))


class HistorialTest(TurnosBase):

    # El paciente ve sus turnos pasados y futuros, y no los de otros.
    def test_ac006_paciente_ve_solo_sus_turnos(self):
        agenda = self.agenda()
        ajeno = self.turno_en(self.recepcion, agenda, '09:00', self.paciente_nuevo())
        propio = self.turno_en(self.paciente, agenda, '09:15')
        _, cuerpo = turnos_de(self.paciente)
        ids = [t['id'] for t in cuerpo['turnos']]
        self.assertIn(propio['id'], ids)
        self.assertNotIn(ajeno['id'], ids)
        self.assertEqual(403, self.paciente.pedir('GET', f"/api/turnos/{ajeno['id']}")[0])
        self.assertTrue(all(t['paciente']['id'] == self.paciente_cuenta for t in cuerpo['turnos']))

    # Recepción lista con filtros por fecha, profesional y estado.
    def test_ac006_recepcion_filtra_por_fecha_profesional_y_estado(self):
        agenda = self.agenda()
        confirmado = self.turno_en(self.recepcion, agenda, '09:00', self.paciente_nuevo())
        cancelado = self.turno_en(self.recepcion, agenda, '09:15', self.paciente_nuevo())
        self.recepcion.pedir('PUT', f"/api/turnos/{cancelado['id']}/estado", {'estado': 'cancelado'})
        _, cuerpo = turnos_de(self.recepcion, profesional=agenda['profesional'], desde=agenda['fecha'],
                              hasta=agenda['fecha'], estado='cancelado')
        self.assertEqual([cancelado['id']], [t['id'] for t in cuerpo['turnos']])
        _, cuerpo = turnos_de(self.recepcion, profesional=agenda['profesional'], estado='confirmado',
                              desde=agenda['fecha'], hasta=agenda['fecha'])
        self.assertEqual([confirmado['id']], [t['id'] for t in cuerpo['turnos']])
        self.assertEqual(400, turnos_de(self.recepcion, estado='otro')[0])

    # El profesional lista los turnos de sus agendas, con los datos del paciente; no los ajenos.
    def test_ac006_profesional_ve_los_turnos_de_sus_agendas(self):
        _, cuerpo = turnos_de(self.profesional, desde='2026-10-05', hasta='2026-10-05')
        self.assertTrue(cuerpo['turnos'])
        self.assertTrue(all(t['profesional']['id'] == self.p_cuenta for t in cuerpo['turnos']))
        self.assertEqual('30000001', cuerpo['turnos'][0]['paciente']['dni'])
        self.assertIn('telefono', cuerpo['turnos'][0]['paciente'])
        ajeno = self.turno_en(self.recepcion, self.agenda(), '09:00', self.paciente_nuevo())
        self.assertEqual(403, self.profesional.pedir('GET', f"/api/turnos/{ajeno['id']}")[0])

    # Filtrar por otro profesional no muestra turnos ajenos al paciente.
    def test_ac006_filtro_por_otro_profesional_no_muestra_ajenos(self):
        _, cuerpo = turnos_de(self.paciente, profesional=self.profesional_nuevo())
        self.assertEqual([], cuerpo['turnos'])


class AccesoTest(TurnosBase):

    # Sin sesión, toda ruta de turnos responde 401.
    def test_ac007_sin_sesion_responde_401(self):
        anonimo = Cliente()
        self.assertEqual(401, anonimo.pedir('GET', '/api/turnos')[0])
        self.assertEqual(401, anonimo.pedir('POST', '/api/turnos', {})[0])
        self.assertEqual(401, anonimo.pedir('GET', '/api/turnos/1')[0])
        self.assertEqual(401, anonimo.pedir('PUT', '/api/turnos/1/estado', {'estado': 'cancelado'})[0])
        self.assertEqual(401, anonimo.pedir('PUT', '/api/turnos/1/reprogramacion', {})[0])

    # El profesional lee; no reserva, no cancela ni reprograma.
    def test_ac007_profesional_solo_lee(self):
        turno = self.turno_en(self.recepcion, self.agenda(), '09:00', self.paciente_nuevo())
        self.assertEqual(403, self.profesional.pedir('POST', '/api/turnos', cuerpo_reserva(1, '2300-03-01', '09:00'))[0])
        self.assertEqual(403, self.profesional.pedir('PUT', f"/api/turnos/{turno['id']}/estado", {'estado': 'cancelado'})[0])
        self.assertEqual(403, self.profesional.pedir('PUT', f"/api/turnos/{turno['id']}/reprogramacion",
                                                     cuerpo_reserva(1, '2300-03-01', '09:00'))[0])

    # El paciente no reserva para otros ni lista turnos de otro paciente por filtro.
    def test_ac007_paciente_no_reserva_para_otro_ni_lista_ajeno(self):
        self.assertEqual(403, self.paciente.pedir('POST', '/api/turnos',
                                                  cuerpo_reserva(1, '2300-03-01', '09:00', paciente=self.paciente_nuevo()))[0])
        self.assertEqual(403, self.paciente.pedir('GET', f'/api/turnos?paciente={self.paciente_nuevo()}')[0])


class DesactivacionTest(TurnosBase):

    # Decisión del usuario: desactivar un paciente con turnos futuros responde 409 y no cambia nada;
    # tras cancelar sus turnos, la desactivación se acepta.
    def test_ac008_desactivar_paciente_con_turno_futuro_responde_turnos_futuros(self):
        paciente = self.paciente_nuevo()
        turno = self.turno_en(self.recepcion, self.agenda(), '09:00', paciente)
        estado, cuerpo, _ = self.recepcion.pedir('PUT', f'/api/pacientes/{paciente}/estado', {'activo': False})
        self.assertEqual((409, 'turnos_futuros'), (estado, cuerpo['error']['codigo']))
        self.assertEqual(['1'], consultar(f'SELECT activo FROM paciente WHERE id_paciente = {paciente}'))
        self.recepcion.pedir('PUT', f"/api/turnos/{turno['id']}/estado", {'estado': 'cancelado'})
        self.assertEqual(200, self.recepcion.pedir('PUT', f'/api/pacientes/{paciente}/estado', {'activo': False})[0])

    # Una agenda con turnos futuros no se desactiva; tras cancelarlos, sí.
    def test_ac008_agenda_con_turno_futuro_no_se_desactiva(self):
        agenda = self.agenda()
        turno = self.turno_en(self.recepcion, agenda, '09:00', self.paciente_nuevo())
        estado, cuerpo, _ = self.admin.pedir('PUT', f"/api/agendas/{agenda['id']}/estado", {'activa': False})
        self.assertEqual((409, 'turnos_futuros'), (estado, cuerpo['error']['codigo']))
        self.assertEqual(['1'], consultar(f"SELECT activa FROM agenda WHERE id_agenda = {agenda['id']}"))
        self.recepcion.pedir('PUT', f"/api/turnos/{turno['id']}/estado", {'estado': 'cancelado'})
        self.assertEqual(200, self.admin.pedir('PUT', f"/api/agendas/{agenda['id']}/estado", {'activa': False})[0])

    # Desactivar un profesional con turnos futuros responde 409 y no cambia sus agendas.
    def test_ac008_desactivar_profesional_con_turno_futuro_no_cambia_nada(self):
        agenda = self.agenda()
        self.turno_en(self.recepcion, agenda, '09:00', self.paciente_nuevo())
        estado, cuerpo, _ = self.admin.pedir('PUT', f"/api/profesionales/{agenda['profesional']}/estado", {'activo': False})
        self.assertEqual((409, 'turnos_futuros'), (estado, cuerpo['error']['codigo']))
        self.assertEqual(['1'], consultar(f"SELECT activo FROM profesional WHERE id_profesional = {agenda['profesional']}"))
        self.assertEqual(['1'], consultar(f"SELECT activa FROM agenda WHERE id_agenda = {agenda['id']}"))

    # Desactivar una especialidad con turnos futuros responde 409 y no cambia nada.
    def test_ac008_desactivar_especialidad_con_turno_futuro_no_cambia_nada(self):
        _, creada, _ = self.admin.pedir('POST', '/api/especialidades', {'nombre': nombre_unico()})
        especialidad = creada['especialidad']['id']
        agenda = self.agenda(especialidad=especialidad, profesional=self.profesional_nuevo([especialidad]))
        self.turno_en(self.recepcion, agenda, '09:00', self.paciente_nuevo())
        estado, cuerpo, _ = self.admin.pedir('PUT', f'/api/especialidades/{especialidad}/estado', {'activa': False})
        self.assertEqual((409, 'turnos_futuros'), (estado, cuerpo['error']['codigo']))
        self.assertEqual(['1'], consultar(f'SELECT activa FROM especialidad WHERE id_especialidad = {especialidad}'))
        self.assertEqual(['1'], consultar(f"SELECT activa FROM agenda WHERE id_agenda = {agenda['id']}"))

    # Quitar una especialidad a un profesional con turnos futuros en esa especialidad responde 409.
    def test_ac008_quitar_especialidad_con_turno_futuro_responde_409(self):
        datos = {
            'dni': dni_unico(), 'nombre': 'Quitar', 'apellido': 'Especialidad', 'telefono': None, 'email': None,
            'fechaNacimiento': '1980-01-01', 'matricula': f'QE-{uuid.uuid4().hex[:10]}',
            'especialidades': [self.clinica, self.cardiologia],
        }
        _, alta, _ = self.admin.pedir('POST', '/api/profesionales', datos)
        profesional = alta['profesional']['id']
        agenda = self.agenda(especialidad=self.cardiologia, profesional=profesional)
        self.turno_en(self.recepcion, agenda, '09:00', self.paciente_nuevo())
        datos['especialidades'] = [self.clinica]
        estado, cuerpo, _ = self.admin.pedir('PUT', f'/api/profesionales/{profesional}', datos)
        self.assertEqual((409, 'turnos_futuros'), (estado, cuerpo['error']['codigo']))
        self.assertEqual(['1'], consultar(f"SELECT COUNT(*) FROM profesional_especialidad WHERE id_profesional = {profesional} "
                                          f"AND id_especialidad = {self.cardiologia}"))


class ConsultorioTest(TurnosBase):

    # Desactivar el consultorio de un turno futuro responde 409 turnos_futuros y no cambia nada.
    def test_ac008_consultorio_con_turno_futuro_responde_turnos_futuros(self):
        agenda = self.agenda()
        self.turno_en(self.recepcion, agenda, '09:00', self.paciente_nuevo())
        estado, cuerpo, _ = self.admin.pedir('PUT', f"/api/consultorios/{agenda['consultorio']}/estado", {'activo': False})
        self.assertEqual((409, 'turnos_futuros'), (estado, cuerpo['error']['codigo']))
        self.assertEqual(['1'], consultar(f"SELECT activo FROM consultorio WHERE id_consultorio = {agenda['consultorio']}"))

    # Un consultorio con agendas activas, sin turnos, sigue respondiendo consultorio_con_agendas.
    def test_ac008_consultorio_con_agenda_sin_turnos_mantiene_su_codigo(self):
        agenda = self.agenda()
        estado, cuerpo, _ = self.admin.pedir('PUT', f"/api/consultorios/{agenda['consultorio']}/estado", {'activo': False})
        self.assertEqual((409, 'consultorio_con_agendas'), (estado, cuerpo['error']['codigo']))


class EdicionAgendaTest(TurnosBase):

    # Decisión del usuario: editar una agenda con turnos confirmados a futuro responde 409 turnos_futuros
    # y no cambia nada. Sin turnos, la edición sigue funcionando.
    def test_ac008_editar_agenda_con_turno_futuro_responde_turnos_futuros(self):
        agenda = self.agenda()
        self.turno_en(self.recepcion, agenda, '09:00', self.paciente_nuevo())
        cambio = datos_agenda(agenda['profesional'], agenda['consultorio'], self.clinica, agenda['anio'],
                              horaInicio='11:00', horaFin='12:00')
        estado, cuerpo, _ = self.admin.pedir('PUT', f"/api/agendas/{agenda['id']}", cambio)
        self.assertEqual((409, 'turnos_futuros'), (estado, cuerpo['error']['codigo']))
        self.assertEqual(['09:00:00'],
                         consultar(f"SELECT hora_inicio FROM agenda WHERE id_agenda = {agenda['id']}"))

    def test_ac008_editar_agenda_sin_turnos_sigue_permitido(self):
        agenda = self.agenda()
        cambio = datos_agenda(agenda['profesional'], agenda['consultorio'], self.clinica, agenda['anio'],
                              horaInicio='11:00', horaFin='12:00')
        estado, cuerpo, _ = self.admin.pedir('PUT', f"/api/agendas/{agenda['id']}", cambio)
        self.assertEqual(200, estado, cuerpo)
        self.assertEqual('11:00', cuerpo['agenda']['horaInicio'])


def turno_directo(agenda, paciente, fecha, hora, estado):
    # Inserta un turno sin pasar por la API: la reserva rechaza fechas pasadas, y la asistencia sólo existe en turnos pasados.
    minutos = int(hora[:2]) * 60 + int(hora[3:5]) + 15
    fin = f'{minutos // 60:02d}:{minutos % 60:02d}'
    consultar(f"INSERT INTO turno (id_paciente, id_agenda, fecha, hora_inicio, hora_fin, estado) "
              f"VALUES ({paciente}, {agenda}, '{fecha}', '{hora}:00', '{fin}:00', '{estado}')")
    return int(consultar('SELECT MAX(id_turno) FROM turno')[0])


def estado_de(turno):
    return consultar(f'SELECT estado FROM turno WHERE id_turno = {turno}')[0]


class AsistenciaTest(TurnosBase):
    """Registro de asistencia (atendido / ausente) sobre turnos que ya comenzaron."""

    PASADO = '2025-03-10'

    def pasado(self, estado='confirmado', profesional=None):
        agenda = self.agenda(profesional=profesional)
        return agenda, turno_directo(agenda['id'], self.paciente_nuevo(), self.PASADO, '09:00', estado)

    def put(self, cliente, turno, estado):
        return cliente.pedir('PUT', f'/api/turnos/{turno}/estado', {'estado': estado})

    def test_ac001_profesional_registra_y_corrige_en_sus_turnos(self):
        _, turno = self.pasado(profesional=self.p_cuenta)
        estado, cuerpo, _ = self.put(self.profesional, turno, 'ausente')
        self.assertEqual(200, estado, cuerpo)
        self.assertEqual('ausente', cuerpo['turno']['estado'])
        self.assertEqual('ausente', estado_de(turno))
        self.assertEqual(200, self.put(self.profesional, turno, 'atendido')[0])
        self.assertEqual('atendido', estado_de(turno))
        self.assertEqual(200, self.put(self.profesional, turno, 'atendido')[0])  # mismo estado: sin cambio

    def test_ac001_recepcion_y_administrador_registran_cualquiera(self):
        _, uno = self.pasado()
        _, otro = self.pasado()
        self.assertEqual(200, self.put(self.recepcion, uno, 'atendido')[0])
        self.assertEqual(200, self.put(self.admin, otro, 'ausente')[0])
        self.assertEqual(['atendido', 'ausente'], [estado_de(uno), estado_de(otro)])

    def test_ac001_roles_sin_permiso_y_sin_sesion(self):
        _, ajeno = self.pasado()  # agenda de otro profesional
        self.assertEqual(403, self.put(self.profesional, ajeno, 'atendido')[0])
        propio_agenda = self.agenda(profesional=self.p_cuenta)
        propio = turno_directo(propio_agenda['id'], self.paciente_cuenta, self.PASADO, '09:00', 'confirmado')
        self.assertEqual(403, self.put(self.paciente, propio, 'atendido')[0])
        self.assertEqual(403, self.put(self.profesional, propio, 'cancelado')[0])
        self.assertEqual(401, self.put(Cliente(), propio, 'atendido')[0])
        self.assertEqual(['confirmado', 'confirmado'], [estado_de(ajeno), estado_de(propio)])

    def test_ac001_turno_futuro_cancelado_y_cerrado(self):
        futuro = self.turno_en(self.recepcion, self.agenda(), '09:00', self.paciente_nuevo())
        estado, cuerpo, _ = self.put(self.admin, futuro['id'], 'atendido')
        self.assertEqual((409, 'turno_futuro'), (estado, cuerpo['error']['codigo']))
        self.assertEqual('confirmado', estado_de(futuro['id']))

        _, cancelado = self.pasado('cancelado')
        estado, cuerpo, _ = self.put(self.admin, cancelado, 'ausente')
        self.assertEqual((409, 'turno_cancelado'), (estado, cuerpo['error']['codigo']))
        self.assertEqual('cancelado', estado_de(cancelado))

        _, cerrado = self.pasado('atendido')
        otra = self.agenda()
        for accion in (lambda: self.put(self.admin, cerrado, 'cancelado'),
                       lambda: self.admin.pedir('PUT', f'/api/turnos/{cerrado}/reprogramacion',
                                                {'agenda': otra['id'], 'fecha': otra['fecha'], 'horaInicio': '09:00'})):
            estado, cuerpo, _ = accion()
            self.assertEqual((409, 'turno_cerrado'), (estado, cuerpo['error']['codigo']))
        self.assertEqual('atendido', estado_de(cerrado))

    # Un turno atendido o ausente sigue ocupando su horario; sólo el cancelado lo libera.
    def test_ac003_turno_cerrado_sigue_ocupando_la_franja(self):
        agenda = self.agenda()
        paciente = self.paciente_nuevo()
        otra = self.agenda()
        for estado in ('atendido', 'ausente'):
            turno_directo(agenda['id'], paciente, agenda['fecha'], '09:00' if estado == 'atendido' else '09:30', estado)
        for hora in ('09:00', '09:30'):
            estado, cuerpo, _ = self.reservar(self.recepcion, agenda, hora, self.paciente_nuevo())
            self.assertEqual((409, 'franja_ocupada'), (estado, cuerpo['error']['codigo']), hora)
        # El mismo paciente tampoco puede tomar en otra agenda el horario de un turno suyo ya cerrado.
        estado, cuerpo, _ = self.reservar(self.recepcion, otra, '09:00', paciente)
        self.assertEqual(201, estado, cuerpo)  # otra fecha de otra agenda: sin conflicto
        turno_directo(otra['id'], paciente, otra['fecha'], '09:15', 'ausente')
        estado, cuerpo, _ = self.reservar(self.recepcion, otra, '09:15', paciente)
        self.assertEqual((409, 'franja_ocupada'), (estado, cuerpo['error']['codigo']))

    def test_ac001_estados_invalidos_y_filtro_del_listado(self):
        _, turno = self.pasado()
        estado, cuerpo, _ = self.put(self.admin, turno, 'confirmado')
        self.assertEqual((409, 'transicion_invalida'), (estado, cuerpo['error']['codigo']))
        self.assertEqual(400, self.put(self.admin, turno, 'inventado')[0])
        self.assertEqual(404, self.put(self.admin, 999999999, 'atendido')[0])
        self.assertEqual(200, self.put(self.admin, turno, 'ausente')[0])
        estado, cuerpo = turnos_de(self.admin, estado='ausente', desde=self.PASADO, hasta=self.PASADO)
        self.assertEqual(200, estado)
        self.assertIn(turno, [t['id'] for t in cuerpo['turnos']])
        self.assertEqual(400, turnos_de(self.admin, estado='otro')[0])


if __name__ == '__main__':
    unittest.main()
