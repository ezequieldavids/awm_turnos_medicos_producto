"""Pruebas funcionales de autenticación contra la API real.

Requiere el entorno levantado con el esquema de db/schema.sql. Variables opcionales:
  API_URL      (por defecto http://127.0.0.1:8080)
  DB_HOST, DB_PORT, DB_NAME, DB_USUARIO, DB_PASSWORD   (consultas SQL de las pruebas, usan el cliente mysql)
  DB_CONTENEDOR (opcional: nombre del contenedor `db` de Docker Compose; consulta con `docker exec` en vez de `mysql`)

Ejecutar desde la raíz del proyecto:
  python3 -m unittest discover -s tests/api -v
"""

import http.client
import json
import os
import subprocess
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.cookies import SimpleCookie

API_URL = os.environ.get('API_URL', 'http://127.0.0.1:8080').rstrip('/')
MENSAJE_CREDENCIALES = 'No pudimos iniciar sesión con esos datos. Revisá el DNI y la contraseña.'

# Usuarios semilla de db/schema.sql (sólo entorno local de prueba).
ADMIN = ('20000001', 'Password123!')
RECEPCION = ('20000002', 'Password123!')
PROFESIONAL = ('20000003', 'Password123!')
PACIENTE = ('20000004', 'Password123!')
INACTIVO = ('20000005', 'Password123!')


class Cliente:
    """Cliente HTTP mínimo que conserva la cookie de sesión, como un navegador."""

    def __init__(self):
        self.cookie = None

    def pedir(self, metodo, ruta, cuerpo=None, cookie=None):
        cabeceras = {'Accept': 'application/json'}
        datos = None
        if cuerpo is not None:
            datos = json.dumps(cuerpo).encode('utf-8')
            cabeceras['Content-Type'] = 'application/json'
        cookie_enviada = cookie if cookie is not None else self.cookie
        if cookie_enviada:
            cabeceras['Cookie'] = cookie_enviada

        solicitud = urllib.request.Request(API_URL + ruta, data=datos, headers=cabeceras, method=metodo)
        try:
            with urllib.request.urlopen(solicitud) as respuesta:
                estado, texto, encabezados = respuesta.status, respuesta.read(), respuesta.headers
        except urllib.error.HTTPError as error:
            estado, texto, encabezados = error.code, error.read(), error.headers

        for valor in encabezados.get_all('Set-Cookie') or []:
            galleta = SimpleCookie()
            galleta.load(valor)
            for nombre, morsel in galleta.items():
                if morsel.value:
                    self.cookie = f'{nombre}={morsel.value}'
                else:
                    self.cookie = None

        self.texto = texto  # cuerpo sin interpretar, para respuestas que no son JSON (CSV del reporte de turnos)
        try:
            json_respuesta = json.loads(texto) if texto else None
        except json.JSONDecodeError:
            json_respuesta = None

        return estado, json_respuesta, encabezados

    def login(self, dni, password):
        return self.pedir('POST', '/api/login', {'dni': dni, 'password': password})


class AutenticacionTest(unittest.TestCase):

    def setUp(self):
        self.cliente = Cliente()

    # Login correcto y redirección al panel del rol.
    def test_ac001_login_administrador_establece_sesion_y_panel(self):
        estado, cuerpo, _ = self.cliente.login(*ADMIN)

        self.assertEqual(200, estado)
        self.assertEqual('administrador', cuerpo['usuario']['rol'])
        self.assertEqual('/administrador.html', cuerpo['panel'])
        self.assertIsNotNone(self.cliente.cookie, 'debe establecerse la cookie de sesión')

        estado, cuerpo, _ = self.cliente.pedir('GET', '/api/sesion')
        self.assertEqual(200, estado)
        self.assertEqual('Admin', cuerpo['usuario']['nombre'])

    def test_nombre_con_acentos_se_devuelve_intacto(self):
        # Regresión: el esquema se cargó con latin1 y el nombre llegó como «RecepciÃ³n».
        estado, cuerpo, _ = self.cliente.login(*RECEPCION)
        self.assertEqual(200, estado)
        self.assertEqual('Recepción', cuerpo['usuario']['nombre'])

    def test_ac001_cada_rol_recibe_su_panel(self):
        esperados = {
            PACIENTE: ('paciente', '/paciente.html'),
            PROFESIONAL: ('profesional', '/profesional.html'),
            RECEPCION: ('recepcionista', '/recepcionista.html'),
            ADMIN: ('administrador', '/administrador.html'),
        }
        for credenciales, (rol, panel) in esperados.items():
            with self.subTest(rol=rol):
                cliente = Cliente()
                estado, cuerpo, _ = cliente.login(*credenciales)
                self.assertEqual(200, estado)
                self.assertEqual(rol, cuerpo['usuario']['rol'])
                self.assertEqual(panel, cuerpo['panel'])

    # Credenciales incorrectas o cuenta inactiva; mensaje genérico y sin sesión.
    def test_ac002_fallos_de_login_son_genericos_y_no_abren_sesion(self):
        casos = {
            'contraseña errónea': (ADMIN[0], 'otra-contrasena'),
            'DNI inexistente': ('39999999', 'Password123!'),
            'usuario inactivo': INACTIVO,
        }
        for descripcion, credenciales in casos.items():
            with self.subTest(caso=descripcion):
                cliente = Cliente()
                estado, cuerpo, _ = cliente.login(*credenciales)
                self.assertEqual(401, estado)
                self.assertEqual('credenciales_invalidas', cuerpo['error']['codigo'])
                self.assertEqual(MENSAJE_CREDENCIALES, cuerpo['error']['mensaje'])
                # PHP puede emitir una cookie anónima; lo que no debe existir es una sesión autenticada.
                estado, _, _ = cliente.pedir('GET', '/api/sesion')
                self.assertEqual(401, estado)

    # Errores de entrada: 400 con JSON de error.
    def test_entradas_vacias_o_mal_formadas_devuelven_400(self):
        casos = {
            'sin contraseña': {'dni': ADMIN[0]},
            'DNI con letras': {'dni': '2000000A', 'password': 'x'},
            'DNI demasiado corto': {'dni': '123', 'password': 'x'},
            'contraseña vacía': {'dni': ADMIN[0], 'password': ''},
        }
        for descripcion, cuerpo_enviado in casos.items():
            with self.subTest(caso=descripcion):
                estado, cuerpo, _ = self.cliente.pedir('POST', '/api/login', cuerpo_enviado)
                self.assertEqual(400, estado)
                self.assertEqual('datos_invalidos', cuerpo['error']['codigo'])

    def test_json_mal_formado_devuelve_400(self):
        solicitud = urllib.request.Request(
            API_URL + '/api/login',
            data=b'{"dni": ',
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        with self.assertRaises(urllib.error.HTTPError) as contexto:
            urllib.request.urlopen(solicitud)
        self.assertEqual(400, contexto.exception.code)
        cuerpo = json.loads(contexto.exception.read())
        self.assertEqual('json_invalido', cuerpo['error']['codigo'])

    # Sin sesión, los recursos protegidos responden 401.
    def test_ac003_sin_sesion_recursos_protegidos_devuelven_401(self):
        for ruta in ['/api/sesion', '/api/panel', '/api/administracion/resumen']:
            with self.subTest(ruta=ruta):
                estado, cuerpo, _ = self.cliente.pedir('GET', ruta)
                self.assertEqual(401, estado)
                self.assertEqual('no_autenticado', cuerpo['error']['codigo'])

    # Rol sin permiso recibe 403 y el panel sólo muestra sus opciones.
    def test_ac004_rol_sin_permiso_recibe_403(self):
        cliente_paciente = Cliente()
        cliente_paciente.login(*PACIENTE)
        estado, cuerpo, _ = cliente_paciente.pedir('GET', '/api/administracion/resumen')
        self.assertEqual(403, estado)
        self.assertEqual('no_autorizado', cuerpo['error']['codigo'])

        cliente_admin = Cliente()
        cliente_admin.login(*ADMIN)
        estado, _, _ = cliente_admin.pedir('GET', '/api/administracion/resumen')
        self.assertEqual(200, estado)

    def test_ac004_opciones_del_panel_dependen_del_rol(self):
        cliente_paciente = Cliente()
        cliente_paciente.login(*PACIENTE)
        _, panel_paciente, _ = cliente_paciente.pedir('GET', '/api/panel')

        cliente_admin = Cliente()
        cliente_admin.login(*ADMIN)
        _, panel_admin, _ = cliente_admin.pedir('GET', '/api/panel')

        nombres_paciente = {opcion['nombre'] for opcion in panel_paciente['opciones']}
        nombres_admin = {opcion['nombre'] for opcion in panel_admin['opciones']}
        self.assertNotIn('Usuarios', nombres_paciente)
        self.assertIn('Usuarios', nombres_admin)
        self.assertNotEqual(nombres_paciente, nombres_admin)

    # Al cerrar sesión la sesión queda invalidada en el servidor.
    def test_ac005_logout_invalida_la_sesion_anterior(self):
        self.cliente.login(*ADMIN)
        cookie_anterior = self.cliente.cookie
        self.assertIsNotNone(cookie_anterior)

        estado, _, _ = self.cliente.pedir('GET', '/api/panel')
        self.assertEqual(200, estado)

        estado, cuerpo, _ = self.cliente.pedir('POST', '/api/logout')
        self.assertEqual(200, estado)
        self.assertTrue(cuerpo['cerrada'])

        estado, cuerpo, _ = self.cliente.pedir('GET', '/api/panel')
        self.assertEqual(401, estado)

        # La cookie previa no debe reutilizarse: el servidor ya destruyó esa sesión.
        estado, _, _ = self.cliente.pedir('GET', '/api/panel', cookie=cookie_anterior)
        self.assertEqual(401, estado)

    def test_respuestas_de_la_api_no_se_guardan_en_cache(self):
        self.cliente.login(*ADMIN)
        _, _, encabezados = self.cliente.pedir('GET', '/api/panel')
        self.assertEqual('no-store', encabezados.get('Cache-Control'))

    def test_ruta_inexistente_devuelve_404(self):
        estado, cuerpo, _ = self.cliente.pedir('GET', '/api/no-existe')
        self.assertEqual(404, estado)
        self.assertEqual('no_encontrado', cuerpo['error']['codigo'])

    def test_archivo_inexistente_fuera_de_api_no_muestra_el_login(self):
        # Regresión H-06: antes respondía 200 con el HTML del login.
        estado, _, _ = self.cliente.pedir('GET', '/nope.txt')
        self.assertEqual(404, estado)

    def test_ruta_mal_formada_no_expone_errores_de_php(self):
        # Regresión H-01: //a:b/ provocaba un TypeError con stack trace y HTTP 200.
        destino = urllib.parse.urlsplit(API_URL)
        conexion = http.client.HTTPConnection(destino.hostname, destino.port, timeout=5)
        conexion.putrequest('GET', '//a:b/', skip_accept_encoding=True)
        conexion.endheaders()
        respuesta = conexion.getresponse()
        cuerpo = respuesta.read().decode('utf-8', 'replace')
        conexion.close()
        self.assertEqual(400, respuesta.status)
        for marca in ('Fatal', 'Stack trace', 'router.php', '/app/'):
            self.assertNotIn(marca, cuerpo)

    def test_cookie_de_sesion_tiene_secure_httponly_y_samesite(self):
        # H-04: la decisión de arquitectura exige estos atributos; la prueba antes no los inspeccionaba.
        _, _, encabezados = self.cliente.login(*ADMIN)
        cookies = [valor.lower() for valor in encabezados.get_all('Set-Cookie') or [] if 'turnos_sesion=' in valor]
        self.assertEqual(1, len(cookies))
        # Secure depende de SESSION_SECURE del entorno: 0 es la excepción documentada para HTTP local.
        if os.environ.get('SESSION_SECURE_ESPERADA', '1') == '1':
            self.assertIn('secure', cookies[0])
        else:
            self.assertNotIn('secure', cookies[0])
        self.assertIn('httponly', cookies[0])
        self.assertIn('samesite=strict', cookies[0])

    # H-03: cada rol debe ver exactamente sus opciones, no sólo distintas entre dos roles.
    def test_ac004_opciones_exactas_por_rol(self):
        esperadas = {
            PACIENTE: ['Mis datos personales', 'Mis turnos'],
            PROFESIONAL: ['Mi agenda', 'Mis turnos'],
            RECEPCION: ['Pacientes', 'Turnos'],
            ADMIN: ['Usuarios', 'Especialidades', 'Profesionales', 'Pacientes', 'Consultorios', 'Agendas', 'Turnos', 'Reportes'],
        }
        for credenciales, nombres in esperadas.items():
            with self.subTest(dni=credenciales[0]):
                cliente = Cliente()
                cliente.login(*credenciales)
                _, panel, _ = cliente.pedir('GET', '/api/panel')
                self.assertEqual(nombres, [opcion['nombre'] for opcion in panel['opciones']])

    def test_metodo_no_permitido_devuelve_405(self):
        estado, cuerpo, _ = self.cliente.pedir('GET', '/api/login')
        self.assertEqual(405, estado)
        self.assertEqual('metodo_no_permitido', cuerpo['error']['codigo'])


class ContrasenasTest(unittest.TestCase):
    """Las contraseñas se guardan como hash bcrypt; sin texto plano en la base."""

    def consultar(self, sql):
        entorno = dict(os.environ)
        entorno['MYSQL_PWD'] = os.environ.get('DB_PASSWORD', 'turnos_local')
        contenedor = os.environ.get('DB_CONTENEDOR')
        if contenedor:
            # Docker Compose no publica el puerto de MySQL: la consulta corre dentro del contenedor `db`.
            comando = ['docker', 'exec', '-e', 'MYSQL_PWD', contenedor, 'mysql', '-u', os.environ.get('DB_USUARIO', 'turnos'),
                       '-N', '-B', os.environ.get('DB_NAME', 'turnos'), '-e', sql]
        else:
            comando = ['mysql', '-h', os.environ.get('DB_HOST', '127.0.0.1'), '-P', os.environ.get('DB_PORT', '3306'),
                       '-u', os.environ.get('DB_USUARIO', 'turnos'), '-N', '-B', os.environ.get('DB_NAME', 'turnos'), '-e', sql]
        resultado = subprocess.run(
            comando,
            capture_output=True,
            text=True,
            env=entorno,
            check=True,
        )
        return resultado.stdout.strip().splitlines()

    def test_ac006_hashes_bcrypt_y_ninguna_contrasena_en_claro(self):
        hashes = self.consultar('SELECT password_hash FROM usuario')
        self.assertGreaterEqual(len(hashes), 1)
        for hash_guardado in hashes:
            self.assertTrue(hash_guardado.startswith('$2y$'), 'el hash debe ser bcrypt')
        self.assertNotIn('Password123!', hashes)
        self.assertEqual([], [h for h in hashes if h.startswith('prueba-')])


if __name__ == '__main__':
    unittest.main()
