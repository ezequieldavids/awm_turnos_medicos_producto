"""Pruebas funcionales de TUR-005: administración de usuarios contra la API real (T-002, T-003, T-006; AC-001 a AC-007).

Requiere el entorno levantado con el esquema y la semilla de db/schema.sql. Mismas variables que test_autenticacion.py.
Cada ejecución crea personas y cuentas con DNI único; la API no borra cuentas, sólo las desactiva.
La prueba de último administrador (AC-006) desactiva temporalmente a los demás administradores y los reactiva al terminar.

Ejecutar desde la raíz del proyecto:
  python3 -m unittest discover -s tests/api -p 'test_usuarios.py' -v
"""

import json
import os
import pathlib
import random
import subprocess
import time
import unittest

from test_autenticacion import ADMIN, PACIENTE, PROFESIONAL, RECEPCION, Cliente
import test_autenticacion

RAIZ = pathlib.Path(__file__).resolve().parents[2]
ADMIN_DNI = ADMIN[0]
CONTRASENA = 'clave-prueba-2026'


def dni_unico():
    # 8 dígitos fuera de los rangos de la semilla (20…, 30…, 40…) y de las pruebas de TUR-003.
    return str(random.randint(60000000, 69999999))


def sesion(credenciales):
    cliente = Cliente()
    estado, _, _ = cliente.login(*credenciales)
    assert estado == 200
    return cliente


def consultar(sql):
    return test_autenticacion.ContrasenasTest.consultar(None, sql)


def contar(tabla):
    return int(consultar(f'SELECT COUNT(*) FROM {tabla}')[0])


def id_de_cuenta(dni):
    return int(consultar(
        f"SELECT u.id_usuario FROM usuario u JOIN persona p ON p.id_persona = u.id_persona WHERE p.dni = '{dni}'"
    )[0])


def estado_de_cuenta(id_usuario):
    return consultar(f'SELECT estado FROM usuario WHERE id_usuario = {id_usuario}')[0]


def comando_auxiliar(script, *argumentos):
    # Con Docker Compose el auxiliar corre dentro del contenedor de la aplicación (mismo código, misma base).
    contenedor = os.environ.get('DB_CONTENEDOR')
    cadena = [str(a) for a in argumentos]
    if contenedor:
        app = os.environ.get('APP_CONTENEDOR', contenedor.replace('-db-1', '-app-1'))
        return ['docker', 'exec', app, 'php', f'/app/tests/api/{script}', *cadena]
    return ['php', str(RAIZ / 'tests/api' / script), *cadena]


class UsuariosTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.admin = sesion(ADMIN)
        cls.recepcion = sesion(RECEPCION)

    def crear_cuenta(self, cuerpo, cliente=None):
        estado, respuesta, _ = (cliente or self.admin).pedir('POST', '/api/usuarios', cuerpo)
        self.assertEqual(201, estado, respuesta)
        return respuesta['usuario']

    def nueva_cuenta(self, rol='recepcionista', **cambios):
        datos = {'dni': dni_unico(), 'nombre': 'Nueva', 'apellido': 'Cuenta', 'rol': rol, 'contrasena': CONTRASENA}
        datos.update(cambios)
        return self.crear_cuenta(datos)

    def paciente_sin_cuenta(self):
        # Un paciente creado por recepción no tiene cuenta: es la persona existente que el alta de usuario reutiliza.
        dni = dni_unico()
        estado, cuerpo, _ = self.recepcion.pedir('POST', '/api/pacientes', {
            'dni': dni, 'nombre': 'Pac', 'apellido': 'Sin Cuenta', 'fechaNacimiento': '1990-01-01',
        })
        self.assertEqual(201, estado, cuerpo)
        return dni, cuerpo['paciente']['id']

    def pedir_con_error(self, esperado, metodo, ruta, cuerpo=None, cliente=None):
        estado, respuesta, _ = (cliente or self.admin).pedir(metodo, ruta, cuerpo)
        self.assertEqual(esperado, estado, respuesta)
        return respuesta

    # AC-001: alta para una persona existente; la contraseña no vuelve en la respuesta y la cuenta entra con su rol.
    def test_ac001_alta_con_persona_existente_y_login_con_su_rol(self):
        dni, _ = self.paciente_sin_cuenta()
        cuenta = self.crear_cuenta({'dni': dni, 'rol': 'paciente', 'contrasena': CONTRASENA})

        self.assertEqual(dni, cuenta['dni'])
        self.assertEqual('paciente', cuenta['rol'])
        self.assertTrue(cuenta['activo'])
        self.assertNotIn('contrasena', cuenta)
        self.assertNotIn('password_hash', cuenta)

        lista = self.pedir_con_error(200, 'GET', f'/api/usuarios?q={dni}')['usuarios']
        self.assertEqual([cuenta['id']], [u['id'] for u in lista])

        estado, cuerpo, _ = Cliente().login(dni, CONTRASENA)
        self.assertEqual(200, estado, cuerpo)
        self.assertEqual('/paciente.html', cuerpo['panel'])

    # AC-002: persona nueva (nombre y apellido obligatorios) o existente (no los necesita); DNI con cuenta → 409.
    def test_ac002_persona_nueva_o_existente_y_dni_con_cuenta(self):
        dni = dni_unico()
        personas, cuentas = contar('persona'), contar('usuario')
        cuenta = self.crear_cuenta({'dni': dni, 'nombre': 'Nueva', 'apellido': 'Persona', 'rol': 'recepcionista', 'contrasena': CONTRASENA})
        self.assertEqual('Nueva', cuenta['nombre'])
        self.assertEqual((personas + 1, cuentas + 1), (contar('persona'), contar('usuario')))

        for datos, codigo in [
            ({'nombre': 'Sin apellido'}, 'apellido_invalido'),
            ({'apellido': 'Sin nombre'}, 'nombre_invalido'),
        ]:
            with self.subTest(faltante=codigo):
                personas, cuentas = contar('persona'), contar('usuario')
                cuerpo = self.pedir_con_error(400, 'POST', '/api/usuarios', {
                    'dni': dni_unico(), 'rol': 'recepcionista', 'contrasena': CONTRASENA, **datos,
                })
                self.assertEqual(codigo, cuerpo['error']['codigo'])
                self.assertEqual((personas, cuentas), (contar('persona'), contar('usuario')))

        dni_existente, _ = self.paciente_sin_cuenta()
        existente = self.crear_cuenta({'dni': dni_existente, 'rol': 'recepcionista', 'contrasena': CONTRASENA})
        self.assertEqual('Pac', existente['nombre'])  # la persona conserva sus datos

        cuerpo = self.pedir_con_error(409, 'POST', '/api/usuarios', {
            'dni': ADMIN_DNI, 'rol': 'recepcionista', 'contrasena': CONTRASENA,
        })
        self.assertEqual('cuenta_existente', cuerpo['error']['codigo'])

    # REV-008, REV-012 y REV-021: una carrera por el mismo DNI responde 409 dni_duplicado (no 500) y la respuesta no muestra el
    # DNI. Vale para el alta de cuentas (TUR-005) y de pacientes y profesionales (TUR-003), que comparten PersonaRepositorio.
    def test_carrera_de_dni_responde_409_en_cuentas_pacientes_y_profesionales(self):
        especialidad = self.admin.pedir('GET', '/api/especialidades')[1]['especialidades'][0]['id']
        casos = [
            ('/api/usuarios', self.admin, lambda dni: {
                'nombre': 'Carrera', 'apellido': 'Cuenta', 'rol': 'recepcionista', 'contrasena': CONTRASENA}),
            ('/api/pacientes', self.recepcion, lambda dni: {
                'nombre': 'Carrera', 'apellido': 'Paciente', 'fechaNacimiento': '1990-01-01'}),
            ('/api/profesionales', self.admin, lambda dni: {
                'nombre': 'Carrera', 'apellido': 'Profesional', 'fechaNacimiento': '1980-01-01',
                'matricula': f'CAR-{dni}', 'especialidades': [especialidad]}),
        ]
        for ruta, cliente, datos in casos:
            with self.subTest(ruta=ruta):
                dni = dni_unico()
                auxiliar = subprocess.Popen(comando_auxiliar('bloqueo_persona.php', dni, 3),
                                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                try:
                    self.assertEqual('bloqueado', auxiliar.stdout.readline().strip(), 'el auxiliar no retuvo la fila')
                    estado, respuesta, _ = cliente.pedir('POST', ruta, {'dni': dni, **datos(dni)})
                finally:
                    salida, error = auxiliar.communicate(timeout=60)
                self.assertEqual('confirmado', salida.strip(), error)
                self.assertEqual(409, estado, respuesta)
                self.assertEqual('dni_duplicado', respuesta['error']['codigo'])
                self.assertNotIn(dni, json.dumps(respuesta))
                self.assertEqual(['1'], consultar(f"SELECT COUNT(*) FROM persona WHERE dni = '{dni}'"))

    # AC-003: entradas inválidas o sin registro responden sin guardar nada.
    def test_ac003_validaciones_no_guardan_nada(self):
        base = {'dni': dni_unico(), 'nombre': 'Valida', 'apellido': 'Cuenta', 'rol': 'recepcionista', 'contrasena': CONTRASENA}
        casos = {
            'DNI mal formado': ({**base, 'dni': '2000A'}, 400, 'dni_invalido'),
            'rol fuera de la lista': ({**base, 'rol': 'superusuario'}, 400, 'rol_invalido'),
            'sin rol': ({k: v for k, v in base.items() if k != 'rol'}, 400, 'rol_invalido'),
            'contraseña corta': ({**base, 'contrasena': '1234567'}, 400, 'contrasena_invalida'),
            'contraseña de más de 72 bytes': ({**base, 'contrasena': 'a' * 73}, 400, 'contrasena_invalida'),
            'activo no booleano': ({**base, 'activo': 'si'}, 400, 'activo_invalido'),
            'paciente sin registro de paciente': ({**base, 'dni': dni_unico(), 'rol': 'paciente'}, 409, 'sin_registro_de_rol'),
            'profesional sin registro de profesional': ({**base, 'dni': dni_unico(), 'rol': 'profesional'}, 409, 'sin_registro_de_rol'),
        }
        personas, cuentas = contar('persona'), contar('usuario')
        for descripcion, (cuerpo, estado_esperado, codigo) in casos.items():
            with self.subTest(caso=descripcion):
                respuesta = self.pedir_con_error(estado_esperado, 'POST', '/api/usuarios', cuerpo)
                self.assertEqual(codigo, respuesta['error']['codigo'])
        self.assertEqual((personas, cuentas), (contar('persona'), contar('usuario')))

    # AC-003 (PUT): entradas inválidas en cambiar rol o estado no cambian la cuenta.
    def test_ac003_put_con_entradas_invalidas_no_cambia_la_cuenta(self):
        cuenta = self.nueva_cuenta('recepcionista')
        antes = consultar(f"SELECT rol, estado FROM usuario WHERE id_usuario = {cuenta['id']}")
        self.assertEqual('rol_invalido', self.pedir_con_error(400, 'PUT', f"/api/usuarios/{cuenta['id']}/rol", {'rol': 'superusuario'})['error']['codigo'])
        self.assertEqual('activo_invalido', self.pedir_con_error(400, 'PUT', f"/api/usuarios/{cuenta['id']}/estado", {'activo': 'si'})['error']['codigo'])
        self.assertEqual(antes, consultar(f"SELECT rol, estado FROM usuario WHERE id_usuario = {cuenta['id']}"))

    # AC-003: reactivar una cuenta de paciente cuyo registro se dio de baja responde 409 y la cuenta sigue inactiva.
    def test_ac003_reactivar_cuenta_sin_registro_activo_responde_409(self):
        dni, id_paciente = self.paciente_sin_cuenta()
        cuenta = self.crear_cuenta({'dni': dni, 'rol': 'paciente', 'contrasena': CONTRASENA})
        self.pedir_con_error(200, 'PUT', f"/api/usuarios/{cuenta['id']}/estado", {'activo': False})
        self.pedir_con_error(200, 'PUT', f'/api/pacientes/{id_paciente}/estado', {'activo': False}, cliente=self.recepcion)

        cuerpo = self.pedir_con_error(409, 'PUT', f"/api/usuarios/{cuenta['id']}/estado", {'activo': True})
        self.assertEqual('sin_registro_de_rol', cuerpo['error']['codigo'])
        self.assertEqual('inactivo', estado_de_cuenta(cuenta['id']))

    # AC-004: el cambio de rol rige en la sesión abierta y se ve en el listado; desactivar la cierra y reactivar la restaura.
    def test_ac004_cambio_de_rol_y_desactivacion_con_efecto_en_sesiones_abiertas(self):
        cuenta = self.nueva_cuenta('recepcionista')
        cliente = sesion((cuenta['dni'], CONTRASENA))
        self.assertEqual('recepcionista', cliente.pedir('GET', '/api/sesion')[1]['usuario']['rol'])

        self.pedir_con_error(200, 'PUT', f"/api/usuarios/{cuenta['id']}/rol", {'rol': 'administrador'})
        self.assertEqual('administrador', cliente.pedir('GET', '/api/sesion')[1]['usuario']['rol'])
        self.assertEqual(200, cliente.pedir('GET', '/api/usuarios')[0])
        listado = self.pedir_con_error(200, 'GET', f"/api/usuarios?q={cuenta['dni']}")['usuarios']
        self.assertEqual(['administrador'], [u['rol'] for u in listado])

        self.pedir_con_error(200, 'PUT', f"/api/usuarios/{cuenta['id']}/estado", {'activo': False})
        self.assertEqual(401, cliente.pedir('GET', '/api/sesion')[0])
        estado, cuerpo, _ = Cliente().login(cuenta['dni'], CONTRASENA)
        self.assertEqual(401, estado)
        self.assertEqual('credenciales_invalidas', cuerpo['error']['codigo'])
        inactivos = self.pedir_con_error(200, 'GET', f"/api/usuarios?estado=inactivos&q={cuenta['dni']}")['usuarios']
        self.assertEqual([False], [u['activo'] for u in inactivos])

        self.pedir_con_error(200, 'PUT', f"/api/usuarios/{cuenta['id']}/estado", {'activo': True})
        self.assertEqual(200, Cliente().login(cuenta['dni'], CONTRASENA)[0])
        self.pedir_con_error(200, 'PUT', f"/api/usuarios/{cuenta['id']}/rol", {'rol': 'recepcionista'})

    # AC-005: restablecer la contraseña reemplaza el hash; nunca se devuelve ni se registra el valor.
    def test_ac005_restablecer_contrasena_guarda_hash_y_no_la_expone(self):
        cuenta = self.nueva_cuenta('recepcionista')
        nueva = 'otra-clave-2026'

        respuesta = self.pedir_con_error(200, 'PUT', f"/api/usuarios/{cuenta['id']}/contrasena", {'contrasena': nueva})
        self.assertNotIn(nueva, json.dumps(respuesta))
        self.assertEqual(401, Cliente().login(cuenta['dni'], CONTRASENA)[0])
        self.assertEqual(200, Cliente().login(cuenta['dni'], nueva)[0])

        hash_guardado = consultar(f"SELECT password_hash FROM usuario WHERE id_usuario = {cuenta['id']}")[0]
        self.assertTrue(hash_guardado.startswith('$2y$12$'))
        self.assertNotIn(nueva, hash_guardado)

        self.pedir_con_error(400, 'PUT', f"/api/usuarios/{cuenta['id']}/contrasena", {'contrasena': 'corta'})
        self.pedir_con_error(404, 'PUT', '/api/usuarios/999999999/contrasena', {'contrasena': nueva})

    # AC-005 (Q-9): restablecer la contraseña cierra las sesiones abiertas con la anterior; una sesión nueva sí entra.
    def test_ac005_restablecer_contrasena_cierra_las_sesiones_abiertas(self):
        cuenta = self.nueva_cuenta('recepcionista')
        abierta = sesion((cuenta['dni'], CONTRASENA))
        self.assertEqual(200, abierta.pedir('GET', '/api/sesion')[0])

        self.pedir_con_error(200, 'PUT', f"/api/usuarios/{cuenta['id']}/contrasena", {'contrasena': 'otra-clave-2026'})
        self.assertEqual(401, abierta.pedir('GET', '/api/sesion')[0])
        self.assertEqual(200, sesion((cuenta['dni'], 'otra-clave-2026')).pedir('GET', '/api/sesion')[0])

    # Q-8 (REV-005): la baja de un registro desactiva la cuenta de ese mismo rol; no toca otros roles ni reactiva nada.
    def test_q8_baja_de_registro_desactiva_solo_la_cuenta_de_su_rol(self):
        dni, id_paciente = self.paciente_sin_cuenta()
        cuenta = self.crear_cuenta({'dni': dni, 'rol': 'paciente', 'contrasena': CONTRASENA})
        self.assertEqual(200, Cliente().login(dni, CONTRASENA)[0])

        self.pedir_con_error(200, 'PUT', f'/api/pacientes/{id_paciente}/estado', {'activo': False}, cliente=self.recepcion)
        self.assertEqual('inactivo', estado_de_cuenta(cuenta['id']))
        self.assertEqual(401, Cliente().login(dni, CONTRASENA)[0])

        self.pedir_con_error(200, 'PUT', f'/api/pacientes/{id_paciente}/estado', {'activo': True}, cliente=self.recepcion)
        self.assertEqual('inactivo', estado_de_cuenta(cuenta['id']), 'reactivar el registro no reactiva la cuenta')

        self.pedir_con_error(200, 'PUT', f"/api/usuarios/{cuenta['id']}/estado", {'activo': True})
        self.assertEqual(200, Cliente().login(dni, CONTRASENA)[0])

    def test_q8_baja_de_registro_no_toca_una_cuenta_de_otro_rol(self):
        dni, id_paciente = self.paciente_sin_cuenta()
        cuenta = self.crear_cuenta({'dni': dni, 'rol': 'administrador', 'contrasena': CONTRASENA})
        self.pedir_con_error(200, 'PUT', f'/api/pacientes/{id_paciente}/estado', {'activo': False}, cliente=self.recepcion)
        self.assertEqual('activo', estado_de_cuenta(cuenta['id']))
        self.assertEqual(200, Cliente().login(dni, CONTRASENA)[0])
        # La cuenta de administrador de prueba no debe quedar activa con la clave de prueba (REV-022).
        self.pedir_con_error(200, 'PUT', f"/api/usuarios/{cuenta['id']}/estado", {'activo': False})

    def test_q8_baja_de_profesional_desactiva_su_cuenta(self):
        especialidades = self.admin.pedir('GET', '/api/especialidades')[1]['especialidades']
        dni = dni_unico()
        estado, cuerpo, _ = self.admin.pedir('POST', '/api/profesionales', {
            'dni': dni, 'nombre': 'Profe', 'apellido': f'Baja{dni}', 'fechaNacimiento': '1980-01-01',
            'matricula': f'Q8-{dni}', 'especialidades': [especialidades[0]['id']],
        })
        self.assertEqual(201, estado, cuerpo)
        id_profesional = cuerpo['profesional']['id']
        cuenta = self.crear_cuenta({'dni': dni, 'rol': 'profesional', 'contrasena': CONTRASENA})

        self.pedir_con_error(200, 'PUT', f'/api/profesionales/{id_profesional}/estado', {'activo': False})
        self.assertEqual('inactivo', estado_de_cuenta(cuenta['id']))
        self.assertEqual(401, Cliente().login(dni, CONTRASENA)[0])

    # AC-006 (autoprotección): el administrador no se desactiva ni se quita el rol; la cuenta queda como estaba.
    def test_ac006_autoproteccion_no_cambia_la_cuenta(self):
        id_admin = id_de_cuenta(ADMIN_DNI)
        antes = consultar(f'SELECT rol, estado FROM usuario WHERE id_usuario = {id_admin}')
        respuesta = self.pedir_con_error(409, 'PUT', f'/api/usuarios/{id_admin}/estado', {'activo': False})
        self.assertEqual('autoprotegida', respuesta['error']['codigo'])
        respuesta = self.pedir_con_error(409, 'PUT', f'/api/usuarios/{id_admin}/rol', {'rol': 'recepcionista'})
        self.assertEqual('autoprotegida', respuesta['error']['codigo'])
        self.assertEqual(antes, consultar(f'SELECT rol, estado FROM usuario WHERE id_usuario = {id_admin}'))
        self.assertEqual(200, self.admin.pedir('GET', '/api/sesion')[0])

    # AC-006 (último administrador): dos administradores se desactivan entre sí a la vez. Un auxiliar retiene el bloqueo
    # de administradores mientras la API procesa la desactivación cruzada; la API espera y responde 409 ultimo_administrador.
    def test_ac006_ultimo_administrador_con_bloqueo_concurrente(self):
        a = self.nueva_cuenta('administrador')
        b = self.nueva_cuenta('administrador')
        sa = sesion((a['dni'], CONTRASENA))
        sb = sesion((b['dni'], CONTRASENA))
        # Deja a A y B como únicos administradores activos: desactiva a los demás, la semilla incluida.
        otros = consultar("SELECT id_usuario FROM usuario WHERE rol = 'administrador' AND estado = 'activo' "
                          f"AND id_usuario NOT IN ({a['id']}, {b['id']})")
        try:
            for id_otro in otros:
                self.pedir_con_error(200, 'PUT', f'/api/usuarios/{id_otro}/estado', {'activo': False}, cliente=sa)

            auxiliar = subprocess.Popen(comando_auxiliar('bloqueo_usuarios.php', a['id'], 3),
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                self.assertEqual('bloqueado', auxiliar.stdout.readline().strip(), 'el auxiliar no retuvo el bloqueo')
                inicio = time.monotonic()
                estado, cuerpo, _ = sa.pedir('PUT', f"/api/usuarios/{b['id']}/estado", {'activo': False})
                espera = time.monotonic() - inicio
            finally:
                salida, error = auxiliar.communicate(timeout=60)
            self.assertEqual('confirmado', salida.strip(), error)
            self.assertEqual(409, estado, cuerpo)
            self.assertEqual('ultimo_administrador', cuerpo['error']['codigo'])
            self.assertGreater(espera, 1.0, 'la API debía esperar a que se liberara el bloqueo')
            self.assertEqual(['activo'], consultar(f"SELECT estado FROM usuario WHERE id_usuario = {b['id']}"))
            self.assertEqual(['inactivo'], consultar(f"SELECT estado FROM usuario WHERE id_usuario = {a['id']}"))
        finally:
            # Restablece el estado de los administradores directamente en la base: si la prueba falló a mitad, ninguna
            # sesión puede ya reactivar a la semilla. Las cuentas de prueba A y B quedan inactivas.
            if otros:
                consultar(f"UPDATE usuario SET estado = 'activo' WHERE id_usuario IN ({', '.join(otros)})")
            consultar(f"UPDATE usuario SET estado = 'inactivo' WHERE id_usuario IN ({a['id']}, {b['id']})")

    # AC-007: sin sesión, 401; con cualquier otro rol, 403 en todas las rutas de usuarios.
    def test_ac007_control_de_acceso_por_rol(self):
        cuenta = self.nueva_cuenta('recepcionista')
        rutas = [
            ('GET', '/api/usuarios', None),
            ('POST', '/api/usuarios', {}),
            ('GET', f"/api/usuarios/{cuenta['id']}", None),
            ('PUT', f"/api/usuarios/{cuenta['id']}/rol", {'rol': 'paciente'}),
            ('PUT', f"/api/usuarios/{cuenta['id']}/estado", {'activo': False}),
            ('PUT', f"/api/usuarios/{cuenta['id']}/contrasena", {'contrasena': CONTRASENA}),
        ]
        for metodo, ruta, cuerpo in rutas:
            with self.subTest(sin_sesion=ruta, metodo=metodo):
                self.assertEqual(401, Cliente().pedir(metodo, ruta, cuerpo)[0])
        for descripcion, credenciales in [('recepcionista', RECEPCION), ('profesional', PROFESIONAL), ('paciente', PACIENTE)]:
            cliente = sesion(credenciales)
            for metodo, ruta, cuerpo in rutas:
                with self.subTest(rol=descripcion, metodo=metodo, ruta=ruta):
                    self.assertEqual(403, cliente.pedir(metodo, ruta, cuerpo)[0])
        self.assertEqual(200, self.admin.pedir('GET', '/api/usuarios')[0])

    # Filtros y lista: búsqueda por DNI o apellido, filtro de activas, sin contraseñas y estado inválido → 400.
    def test_listado_filtra_por_estado_y_busqueda_sin_contrasenas(self):
        cuenta = self.nueva_cuenta('recepcionista', apellido=f'Filtro{dni_unico()}')
        respuesta = self.pedir_con_error(200, 'GET', f"/api/usuarios?q={cuenta['dni']}")
        self.assertEqual([cuenta['id']], [u['id'] for u in respuesta['usuarios']])
        por_apellido = self.pedir_con_error(200, 'GET', f"/api/usuarios?q={cuenta['apellido']}")
        self.assertEqual([cuenta['id']], [u['id'] for u in por_apellido['usuarios']])
        self.assertNotIn('password', json.dumps(respuesta))
        self.assertNotIn('$2y$', json.dumps(respuesta))

        self.pedir_con_error(200, 'PUT', f"/api/usuarios/{cuenta['id']}/estado", {'activo': False})
        activas = self.pedir_con_error(200, 'GET', f"/api/usuarios?estado=activos&q={cuenta['apellido']}")
        self.assertEqual([], activas['usuarios'])
        self.pedir_con_error(400, 'GET', '/api/usuarios?estado=cualquiera')


if __name__ == '__main__':
    unittest.main()
