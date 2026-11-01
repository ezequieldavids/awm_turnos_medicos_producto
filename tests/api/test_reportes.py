"""Pruebas funcionales de reporte de turnos e indicadores y su exportación CSV.

Requiere el entorno levantado con el esquema de db/schema.sql. Mismas variables que
test_turnos.py. Cada prueba crea sus propios profesionales y agendas en un año lejano y aleatorio, y los turnos con estados
conocidos se insertan en la base (la API no reserva en el pasado ni registra asistencia en el futuro), de modo que los
conteos esperados se calculan a mano y se contrastan con una consulta SQL independiente.
"""

import csv
import datetime
import io
import unittest

from test_agendas import DIA_PRUEBA, anio_unico, consultar
from test_autenticacion import Cliente
from test_turnos import TurnosBase, turno_directo


def sumar(fecha, dias):
    return (datetime.date.fromisoformat(fecha) + datetime.timedelta(days=dias)).isoformat()


def fechas_del_anio(anio):
    dia = datetime.date(anio, 1, 1)
    while dia.year == anio:
        yield dia
        dia += datetime.timedelta(days=1)


def en_csv(tasa):
    # Una tasa sin denominador (null) queda vacía en el CSV; las demás usan coma decimal.
    return '' if tasa is None else str(tasa).replace('.', ',')


def consulta(**filtros):
    return '&'.join(f'{k}={v}' for k, v in filtros.items())


class ReporteBase(TurnosBase):

    def reporte(self, cliente=None, **filtros):
        return (cliente or self.admin).pedir('GET', f'/api/reportes/turnos?{consulta(**filtros)}')

    def ok(self, **filtros):
        estado, cuerpo, _ = self.reporte(**filtros)
        self.assertEqual(200, estado, cuerpo)
        return cuerpo

    def escenario(self):
        """Dos especialidades y dos profesionales con turnos de estado conocido en un año propio.

        P1 (clínica, agenda de 4 franjas por día de prueba): d1 atendido, atendido, ausente, cancelado; d2 confirmado (futuro).
        P2 (cardiología): d1 atendido, ausente; d3 cancelado.
        """
        anio = anio_unico()
        p1 = self.profesional_nuevo([self.clinica])
        p2 = self.profesional_nuevo([self.cardiologia])
        a1 = self.agenda(anio=anio, profesional=p1, especialidad=self.clinica)
        a2 = self.agenda(anio=anio, profesional=p2, especialidad=self.cardiologia)
        d1 = a1['fecha']
        paciente = self.paciente_nuevo()
        for hora, estado in (('09:00', 'atendido'), ('09:15', 'atendido'), ('09:30', 'ausente'), ('09:45', 'cancelado')):
            turno_directo(a1['id'], paciente, d1, hora, estado)
        turno_directo(a1['id'], paciente, sumar(d1, 7), '09:00', 'confirmado')
        turno_directo(a2['id'], paciente, d1, '09:00', 'atendido')
        turno_directo(a2['id'], paciente, d1, '09:15', 'ausente')
        turno_directo(a2['id'], paciente, sumar(d1, 14), '09:00', 'cancelado')
        dias_de_prueba = sum(1 for d in fechas_del_anio(anio) if d.isoweekday() == DIA_PRUEBA)
        return {'anio': anio, 'p1': p1, 'p2': p2, 'a1': a1, 'a2': a2, 'd1': d1, 'desde': f'{anio}-01-01',
                'hasta': f'{anio}-12-31', 'franjas': dias_de_prueba * 4}

    def capacidad_sql(self, desde, hasta):
        """Franjas de todas las agendas activas entre dos fechas, calculadas aparte desde las filas de `agenda`."""
        total = 0
        filas = consultar("SELECT dia_semana, TIME_TO_SEC(TIMEDIFF(hora_fin, hora_inicio)) DIV 60, duracion_min, vigente_desde, "
                          "COALESCE(vigente_hasta, '9999-12-31') FROM agenda WHERE activa = 1")
        for fila in filas:
            dia, minutos, duracion, vigente_desde, vigente_hasta = fila.split('\t')
            primera = max(desde, vigente_desde)
            ultima = min(hasta, vigente_hasta)
            fecha = datetime.date.fromisoformat(primera)
            while fecha.isoformat() <= ultima:
                if fecha.isoweekday() == int(dia):
                    total += int(minutos) // int(duracion)
                fecha += datetime.timedelta(days=1)
        return total

    def conteo_sql(self, desde, hasta, **donde):
        condiciones = ' AND '.join(f'a.{campo} = {valor}' for campo, valor in donde.items()) or '1 = 1'
        filas = consultar(
            f"SELECT t.estado, COUNT(*) FROM turno t JOIN agenda a ON a.id_agenda = t.id_agenda "
            f"WHERE t.fecha BETWEEN '{desde}' AND '{hasta}' AND {condiciones} GROUP BY t.estado")
        return {f.split('\t')[0]: int(f.split('\t')[1]) for f in filas}


class ConsultaTest(ReporteBase):

    # Totales, tasas y desglose con conteos conocidos en dos especialidades y dos profesionales.
    def test_ac002_totales_tasas_y_desglose(self):
        e = self.escenario()
        cuerpo = self.ok(fecha_desde=e['desde'], fecha_hasta=e['hasta'])
        self.assertEqual({'desde': e['desde'], 'hasta': e['hasta']}, cuerpo['periodo'])
        self.assertEqual(
            {'otorgados': 8, 'atendidos': 3, 'cancelados': 2, 'ausentes': 2, 'pendientesAsistencia': 0, 'programados': 1},
            cuerpo['totales'])
        # Ausentismo 2/5 = 40,0 %; cancelación 2/8 = 25,0 %; ocupación: 6 turnos no cancelados en agendas activas sobre las
        # franjas de todas las agendas activas del año (incluidas las de la semilla), calculadas aparte desde la base.
        capacidad = self.capacidad_sql(e['desde'], e['hasta'])
        self.assertGreaterEqual(capacidad, 2 * e['franjas'])
        self.assertEqual({'ausentismo': 40.0, 'cancelacion': 25.0, 'ocupacion': round(6 * 100 / capacidad, 1)}, cuerpo['tasas'])

        filas = {f['profesional']['id']: f for f in cuerpo['desglose']}
        self.assertEqual({e['p1'], e['p2']}, set(filas))
        f1, f2 = filas[e['p1']], filas[e['p2']]
        self.assertEqual((self.clinica, 5, 2, 1, 1, 0, 1), (f1['especialidad']['id'], f1['otorgados'], f1['atendidos'],
                                                            f1['cancelados'], f1['ausentes'], f1['pendientesAsistencia'],
                                                            f1['programados']))
        self.assertEqual((self.cardiologia, 3, 1, 1, 1, 0, 0), (f2['especialidad']['id'], f2['otorgados'], f2['atendidos'],
                                                                f2['cancelados'], f2['ausentes'], f2['pendientesAsistencia'],
                                                                f2['programados']))
        self.assertEqual({'ausentismo': 33.3, 'cancelacion': 20.0, 'ocupacion': round(4 * 100 / e['franjas'], 1)}, f1['tasas'])
        self.assertEqual({'ausentismo': 50.0, 'cancelacion': 33.3, 'ocupacion': round(2 * 100 / e['franjas'], 1)}, f2['tasas'])

        # Contraste con el conteo directo en la base.
        directo = self.conteo_sql(e['desde'], e['hasta'])
        self.assertEqual({'atendido': 3, 'cancelado': 2, 'ausente': 2, 'confirmado': 1}, directo)

    def test_ac002_filtros_por_especialidad_y_profesional(self):
        e = self.escenario()
        solo_p1 = self.ok(fecha_desde=e['desde'], fecha_hasta=e['hasta'], profesional=e['p1'])
        self.assertEqual(5, solo_p1['totales']['otorgados'])
        self.assertEqual([e['p1']], [f['profesional']['id'] for f in solo_p1['desglose']])
        self.assertEqual(self.conteo_sql(e['desde'], e['hasta'], id_profesional=e['p1']),
                         {'atendido': 2, 'cancelado': 1, 'ausente': 1, 'confirmado': 1})

        solo_cardiologia = self.ok(fecha_desde=e['desde'], fecha_hasta=e['hasta'], especialidad=self.cardiologia, profesional=e['p2'])
        self.assertEqual((3, 1, 1, 1), tuple(solo_cardiologia['totales'][k] for k in ('otorgados', 'atendidos', 'cancelados', 'ausentes')))
        # La combinación contradictoria (profesional de clínica con cardiología) no devuelve turnos.
        vacio = self.ok(fecha_desde=e['desde'], fecha_hasta=e['hasta'], especialidad=self.cardiologia, profesional=e['p1'])
        self.assertEqual(0, vacio['totales']['otorgados'])

    def test_ac002_los_limites_del_periodo_son_inclusivos(self):
        e = self.escenario()
        solo_d1 = self.ok(fecha_desde=e['d1'], fecha_hasta=e['d1'], profesional=e['p1'])
        self.assertEqual(4, solo_d1['totales']['otorgados'])
        antes = self.ok(fecha_desde=sumar(e['d1'], -7), fecha_hasta=sumar(e['d1'], -1), profesional=e['p1'])
        self.assertEqual(0, antes['totales']['otorgados'])
        hasta_d2 = self.ok(fecha_desde=e['d1'], fecha_hasta=sumar(e['d1'], 7), profesional=e['p1'])
        self.assertEqual(5, hasta_d2['totales']['otorgados'])
        hasta_antes_d2 = self.ok(fecha_desde=e['d1'], fecha_hasta=sumar(e['d1'], 6), profesional=e['p1'])
        self.assertEqual(4, hasta_antes_d2['totales']['otorgados'])

    def test_ac002_pendientes_de_asistencia_son_los_confirmados_ya_comenzados(self):
        agenda = self.agenda()
        paciente = self.paciente_nuevo()
        turno_directo(agenda['id'], paciente, '2021-03-10', '09:00', 'confirmado')
        cuerpo = self.ok(fecha_desde='2021-03-01', fecha_hasta='2021-03-31', profesional=agenda['profesional'])
        self.assertEqual((1, 1, 0), (cuerpo['totales']['otorgados'], cuerpo['totales']['pendientesAsistencia'],
                                     cuerpo['totales']['programados']))
        self.assertIsNone(cuerpo['tasas']['ausentismo'])  # sin atendidos ni ausentes

    def test_ac002_parametros_invalidos(self):
        casos = [
            {},
            {'fecha_desde': '2026-10-01'},
            {'fecha_desde': '2026-02-30', 'fecha_hasta': '2026-10-01'},
            {'fecha_desde': 'ayer', 'fecha_hasta': '2026-10-01'},
            {'fecha_desde': '2026-10-02', 'fecha_hasta': '2026-10-01'},
            {'fecha_desde': '2026-01-01', 'fecha_hasta': '2027-01-02'},  # 367 días
            {'fecha_desde': '2026-10-01', 'fecha_hasta': '2026-10-02', 'especialidad': 999999999},
            {'fecha_desde': '2026-10-01', 'fecha_hasta': '2026-10-02', 'profesional': 999999999},
            {'fecha_desde': '2026-10-01', 'fecha_hasta': '2026-10-02', 'profesional': 'abc'},
        ]
        for filtros in casos:
            estado, cuerpo, _ = self.reporte(**filtros)
            self.assertEqual((400, 'datos_invalidos'), (estado, cuerpo['error']['codigo']), filtros)
        # 366 días exactos (año bisiesto) se aceptan.
        self.assertEqual(200, self.reporte(fecha_desde='2028-01-01', fecha_hasta='2028-12-31')[0])


class TasasTest(ReporteBase):

    # Tasas sin denominador, y períodos con un solo tipo de turno.
    def test_ac003_periodo_sin_turnos(self):
        agenda = self.agenda()
        cuerpo = self.ok(fecha_desde='2021-01-01', fecha_hasta='2021-01-31', profesional=agenda['profesional'])
        self.assertEqual({'otorgados': 0, 'atendidos': 0, 'cancelados': 0, 'ausentes': 0, 'pendientesAsistencia': 0,
                          'programados': 0}, cuerpo['totales'])
        self.assertEqual({'ausentismo': None, 'cancelacion': None, 'ocupacion': None}, cuerpo['tasas'])
        self.assertEqual([], cuerpo['desglose'])

    def test_ac003_solo_cancelados_o_solo_confirmados(self):
        e = self.escenario()
        # Un tercer profesional sólo con cancelados y un cuarto sólo con confirmados.
        p3 = self.profesional_nuevo([self.clinica])
        a3 = self.agenda(anio=e['anio'], profesional=p3)
        p4 = self.profesional_nuevo([self.clinica])
        a4 = self.agenda(anio=e['anio'], profesional=p4)
        paciente = self.paciente_nuevo()
        turno_directo(a3['id'], paciente, e['d1'], '09:00', 'cancelado')
        turno_directo(a4['id'], paciente, e['d1'], '09:00', 'confirmado')

        cancelados = self.ok(fecha_desde=e['desde'], fecha_hasta=e['hasta'], profesional=p3)
        self.assertEqual({'ausentismo': None, 'cancelacion': 100.0, 'ocupacion': 0.0}, cancelados['tasas'])
        confirmados = self.ok(fecha_desde=e['desde'], fecha_hasta=e['hasta'], profesional=p4)
        self.assertEqual({'ausentismo': None, 'cancelacion': 0.0, 'ocupacion': round(100 / e['franjas'], 1)}, confirmados['tasas'])
        self.assertEqual(1, confirmados['totales']['programados'])

    def test_ac003_ocupacion_sin_agenda_activa_es_null(self):
        agenda = self.agenda()
        turno_directo(agenda['id'], self.paciente_nuevo(), '2021-03-10', '09:00', 'atendido')
        # La agenda de prueba rige en otro año: no ofreció franjas en 2021 y la tasa no se calcula.
        cuerpo = self.ok(fecha_desde='2021-03-01', fecha_hasta='2021-03-31', profesional=agenda['profesional'])
        self.assertIsNone(cuerpo['tasas']['ocupacion'])
        self.assertEqual(0.0, cuerpo['tasas']['ausentismo'])


class AccesoTest(ReporteBase):

    # Sólo el administrador consulta y exporta.
    def test_ac004_matriz_de_roles_en_consulta_y_csv(self):
        filtros = consulta(fecha_desde='2026-10-01', fecha_hasta='2026-10-28')
        for ruta in (f'/api/reportes/turnos?{filtros}', f'/api/reportes/turnos.csv?{filtros}'):
            self.assertEqual(401, Cliente().pedir('GET', ruta)[0], ruta)
            for rol, cliente in (('paciente', self.paciente), ('profesional', self.profesional), ('recepción', self.recepcion)):
                estado, cuerpo, _ = cliente.pedir('GET', ruta)
                self.assertEqual((403, 'no_autorizado'), (estado, cuerpo['error']['codigo']), f'{rol} {ruta}')
            self.assertEqual(200, self.admin.pedir('GET', ruta)[0], ruta)

    def test_ac004_el_panel_ofrece_reportes_solo_al_administrador(self):
        for cliente, esperado in ((self.admin, True), (self.recepcion, False), (self.profesional, False), (self.paciente, False)):
            _, cuerpo, _ = cliente.pedir('GET', '/api/panel')
            self.assertEqual(esperado, 'Reportes' in [o['nombre'] for o in cuerpo['opciones']])


class CsvTest(ReporteBase):

    def csv(self, **filtros):
        cliente = self.admin
        estado, _, encabezados = cliente.pedir('GET', f'/api/reportes/turnos.csv?{consulta(**filtros)}')
        self.assertEqual(200, estado, cliente.texto)
        return encabezados, cliente.texto

    def filas(self, texto):
        self.assertEqual(b'\xef\xbb\xbf', texto[:3])  # BOM de UTF-8
        return list(csv.reader(io.StringIO(texto[3:].decode('utf-8')), delimiter=';'))

    # El CSV coincide con el JSON y neutraliza fórmulas.
    def test_ac006_resumen_y_detalle_coinciden_con_el_json(self):
        e = self.escenario()
        filtros = {'fecha_desde': e['desde'], 'fecha_hasta': e['hasta']}
        encabezados, texto = self.csv(**filtros)
        self.assertTrue(encabezados['Content-Type'].startswith('text/csv'))
        self.assertIn(f"reporte-turnos-{e['desde']}-a-{e['hasta']}.csv", encabezados['Content-Disposition'])
        self.assertIn('attachment', encabezados['Content-Disposition'])

        filas = self.filas(texto)
        self.assertEqual('Fila', filas[0][0])
        self.assertEqual(12, len(filas[0]))
        cuerpo = self.ok(**filtros)
        resumen = filas[1]
        self.assertEqual(['Resumen', 'Todas', 'Todos'], resumen[:3])
        t = cuerpo['totales']
        self.assertEqual([str(t[k]) for k in ('otorgados', 'atendidos', 'cancelados', 'ausentes', 'pendientesAsistencia', 'programados')],
                         resumen[3:9])
        self.assertEqual([en_csv(cuerpo['tasas'][k]) for k in ('ausentismo', 'cancelacion', 'ocupacion')], resumen[9:])
        detalle = filas[2:]
        self.assertEqual(len(cuerpo['desglose']), len(detalle))
        for fila_csv, fila in zip(detalle, cuerpo['desglose']):
            self.assertEqual('Detalle', fila_csv[0])
            self.assertEqual(fila['especialidad']['nombre'], fila_csv[1])
            self.assertEqual(str(fila['otorgados']), fila_csv[3])
            self.assertEqual([en_csv(fila['tasas'][k]) for k in ('ausentismo', 'cancelacion', 'ocupacion')], fila_csv[9:])

    def test_ac006_filtros_aplicados_y_nombres_con_formula(self):
        e = self.escenario()
        consultar(f"UPDATE persona pe JOIN profesional pr ON pr.id_persona = pe.id_persona SET pe.apellido = '=1+1' "
                  f"WHERE pr.id_profesional = {e['p1']}")
        _, texto = self.csv(fecha_desde=e['desde'], fecha_hasta=e['hasta'], profesional=e['p1'])
        filas = self.filas(texto)
        self.assertEqual(3, len(filas))  # encabezado, resumen y un detalle
        self.assertTrue(filas[1][2].startswith("'="), filas[1][2])  # el profesional filtrado en el resumen
        self.assertTrue(filas[2][2].startswith("'=1+1"), filas[2][2])
        self.assertEqual('5', filas[2][3])

    def test_ac006_sin_datos_conserva_encabezado_y_resumen_en_cero(self):
        agenda = self.agenda()
        _, texto = self.csv(fecha_desde='2021-01-01', fecha_hasta='2021-01-31', profesional=agenda['profesional'])
        filas = self.filas(texto)
        self.assertEqual(2, len(filas))
        self.assertEqual(['0'] * 6, filas[1][3:9])
        self.assertEqual(['', '', ''], filas[1][9:])

    def test_ac006_mismos_errores_que_la_consulta(self):
        estado, cuerpo, _ = self.admin.pedir('GET', '/api/reportes/turnos.csv?fecha_desde=2026-10-02&fecha_hasta=2026-10-01')
        self.assertEqual((400, 'datos_invalidos'), (estado, cuerpo['error']['codigo']))


if __name__ == '__main__':
    unittest.main()
