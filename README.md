# Sistema Web y Móvil de Gestión de Turnos Médicos

Trabajo Práctico Nº 3 — Aplicaciones Web y Móvil
Licenciatura en Gestión de Recursos Tecnológicos — Universidad Gastón Dachary

---

## Integrantes

| Nombre | Número de Estudiante |
| :--- | :--- |
| **José Fernando Chamorro Goncalvez** | 600076 |
| **Cris Evelyn Holzer** | 600075 |
| **Oscar Ezequiel Davids** | 600207 |

---

## Descripción del Proyecto

El **Sistema de Gestión de Turnos Médicos** es una solución web responsive diseñada para centralizar y optimizar la administración de turnos entre pacientes y profesionales de la salud.

### Características principales

- **Autenticación y control de acceso**: Registro seguro con control de acceso basado en roles (**Paciente**, **Profesional de la salud**, **Recepcionista / Administrativo**, **Administrador**).
- **Gestión de datos**: Administración de pacientes, profesionales, especialidades y consultorios físicos.
- **Agendas médicas**: Configuración de disponibilidad horaria con prevención de superposiciones de turnos.
- **Gestión de turnos**: Consulta, reserva, cancelación y reprogramación de turnos médicos.
- **Reportes e indicadores**: Historial de atención para pacientes y generación de reportes de gestión y ausentismo.
- **Datos del paciente**: el paciente consulta sus datos personales en solo lectura.
- **Sesión segura**: la sesión se cierra tras 15 minutos sin actividad (configurable), con aviso en la pantalla de inicio.

---

## Stack Tecnológico

- **Frontend**: HTML5 estático con JavaScript vanilla, estilos responsive con Bootstrap 5.
- **Backend**: PHP 7.4+ sin dependencias externas (PHP puro).
- **Base de datos**: MySQL 8.4 con soporte transaccional.
- **Containerización**: Docker y Docker Compose para entorno aislado.
- **Pruebas**: Playwright para pruebas de navegador automatizadas (Node.js) y `unittest` de Python para pruebas de API.

---

## Requisitos Previos

Para levantar y usar el sistema necesitás tener instalado:

- **[Docker](https://docs.docker.com/get-docker/)** y **Docker Compose** (v2 o superior, incluido en instalaciones recientes de Docker Desktop/Engine).
- **[Git](https://git-scm.com/downloads)** para clonar el repositorio.

Opcional, solo si querés ejecutar las pruebas automatizadas:

- **[Node.js](https://nodejs.org/)** v18+ y **npm** v9+ (pruebas de navegador).
- **Python 3.9+** (pruebas de API, usa únicamente la librería estándar).

---

## Puesta en Marcha Local — Paso a Paso

### 1. Clonar el repositorio

```bash
git clone <URL-de-este-repositorio>
cd awm_turnos_medicos_producto
```

### 2. Configurar variables de entorno

El proyecto necesita un archivo `.env` en la raíz con las credenciales de la base de datos. Se incluye un template `.env.example`:

```bash
cp .env.example .env
```

Luego abrí `.env` con un editor de texto y completá, como mínimo, las contraseñas:

```env
DB_PASSWORD=elegí_una_contraseña
DB_ROOT_PASSWORD=elegí_otra_contraseña
```

El resto de las variables (`APP_PUERTO`, `SESSION_SECURE`, `SESION_INACTIVIDAD_SEGUNDOS`) ya tienen valores por defecto razonables para un entorno local y pueden dejarse como están.

**Importante**: el archivo `.env` no se versiona (está en `.gitignore`); cada persona que clone el repositorio debe crear el suyo.

### 3. Iniciar la aplicación con Docker Compose

Desde la raíz del proyecto:

```bash
docker compose up -d
```

Este comando construye la imagen de PHP y levanta dos servicios:
- **`db`**: MySQL 8.4 en el puerto `3306`, con la base `turnos` creada automáticamente a partir de `db/schema.sql` (incluye el esquema, las relaciones y datos de prueba).
- **`app`**: Servidor PHP embebido en el puerto `8080` (configurable con `APP_PUERTO`).

La primera vez puede tardar unos minutos mientras se descargan las imágenes y se inicializa la base de datos.

### 4. Acceder al sistema

Una vez que los contenedores estén arriba, abrí en el navegador:

```
http://localhost:8080
```

Vas a ver la pantalla de inicio de sesión. Usá alguna de las [cuentas de prueba](#cuentas-de-prueba-preconfiguradas) para ingresar.

### 5. Verificar el estado de los contenedores

```bash
docker compose ps
docker compose logs app   # Ver logs del servidor PHP
docker compose logs db    # Ver logs de MySQL
```

### 6. Detener la aplicación

```bash
docker compose down
```

Para limpiar completamente el entorno (incluyendo los datos cargados en la base de datos) y volver al estado inicial:

```bash
docker compose down -v
```

---

## Cuentas de Prueba Preconfiguradas

El sistema viene con usuarios de ejemplo ya cargados en la base de datos (todos con la contraseña `Password123!`):

| Rol | DNI | Contraseña | Acceso |
| :--- | :--- | :--- | :--- |
| **Administrador** | `20000001` | `Password123!` | Gestión completa del sistema, agendas, reportes |
| **Recepcionista** | `20000002` | `Password123!` | Gestión de pacientes y asignación de turnos |
| **Profesional** | `20000003` | `Password123!` | Agenda personal y pacientes asignados |
| **Paciente** | `20000004` | `Password123!` | Consulta y reserva de turnos |

---

## Estructura del Proyecto

```
awm_turnos_medicos_producto/
├── public/                  # Punto de entrada web
│   ├── index.html          # Inicio de sesión
│   ├── router.php          # Router de páginas
│   ├── api/                # Endpoints API
│   └── assets/             # CSS, JS, imágenes
├── src/                    # Lógica backend
│   ├── Controladores/      # Controllers
│   ├── Pacientes/
│   ├── Profesionales/
│   ├── Usuarios/
│   ├── Agendas/
│   ├── Reservas/
│   ├── Reportes/
│   └── ...                 # Otros módulos
├── db/                      # Schema y datos de la BD
│   └── schema.sql
├── docker/                  # Configuración Docker
│   └── php/                # Dockerfile para PHP
├── tests/                   # Pruebas automatizadas
│   ├── api/                # Tests de API con unittest
│   └── navegador/          # Tests con Playwright
├── docker-compose.yml       # Configuración de servicios
├── package.json             # Dependencias Node.js (pruebas)
├── .env.example              # Template de variables de entorno
└── README.md                 # Este archivo
```

---

## Roles de Usuario

El sistema soporta cuatro roles principales:

| Rol | Acceso |
| :--- | :--- |
| **Paciente** | Consultar sus datos personales, consultar y reservar turnos, ver historial personal |
| **Profesional** | Ver su agenda diaria, pacientes asignados |
| **Recepcionista** | Gestionar pacientes, asignar turnos |
| **Administrador** | Acceso completo: agendas, especialidades, consultorios, reportes, usuarios |

---

## Pruebas (opcional)

### Pruebas de navegador

Verifican los flujos de usuario principales de punta a punta, con el sistema corriendo vía Docker Compose.

```bash
# Instalar dependencias (primera vez)
npm install

# Ejecutar la suite completa
npm run test:navegador

# O ejecutar pruebas específicas por módulo
npm run test:navegador:especialidades
npm run test:navegador:personas
npm run test:navegador:agendas
npm run test:navegador:turnos
npm run test:navegador:reportes
npm run test:navegador:usuarios
npm run test:navegador:diseno
npm run test:navegador:datos-personales
npm run test:navegador:inactividad   # requiere el contenedor app con SESION_INACTIVIDAD_SEGUNDOS=20
```

Las pruebas apuntan a `APP_URL` (por defecto `http://127.0.0.1:8080`); si usás otro puerto, exportá la variable antes de correrlas, por ejemplo `APP_URL=http://127.0.0.1:8090`.

### Pruebas de API

Usan `unittest` de Python (sin paquetes externos) contra la API en ejecución:

```bash
API_URL=http://127.0.0.1:8080 DB_CONTENEDOR=<nombre-del-contenedor-db> DB_PASSWORD='<DB_PASSWORD>' \
  python3 -B -X utf8 -m unittest discover -s tests/api -v
```

Las pruebas no borran datos: cada ejecución agrega sus propios registros. Para volver al estado inicial (la semilla de datos), usar `docker compose down -v` y levantar el entorno de nuevo.

---

## Solución de problemas

- **El puerto 8080 ya está en uso**: cambiá `APP_PUERTO` en el `.env` (por ejemplo `APP_PUERTO=8090`) y volvé a ejecutar `docker compose up -d`.
- **No conecta a la base de datos / la app no levanta**: revisá que las variables `DB_PASSWORD` y `DB_ROOT_PASSWORD` estén definidas en `.env`, y mirá los logs con `docker compose logs db` y `docker compose logs app`.
- **Cambié `db/schema.sql` y no se refleja**: el esquema solo se ejecuta la primera vez que se crea el volumen de MySQL. Para forzar su recreación, ejecutá `docker compose down -v` y luego `docker compose up -d` (esto borra los datos existentes).

---

## Contacto y Soporte

Para reportar issues o consultas sobre el proyecto, consultar con los integrantes listados en la sección de Integrantes.

---

*Última actualización: noviembre 2026*
