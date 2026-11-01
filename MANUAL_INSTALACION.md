# Manual de Instalación y Configuración
## Sistema Web de Gestión de Turnos Médicos

Trabajo Práctico Nº 3 — Aplicaciones Web y Móvil
Licenciatura en Gestión de Recursos Tecnológicos — Universidad Gastón Dachary

---

## 1. Introducción

Este manual describe cómo instalar, configurar, ejecutar y verificar el **Sistema de Gestión de Turnos Médicos**, una aplicación web responsive que centraliza la administración de turnos entre pacientes y profesionales de la salud.

El sistema soporta cuatro roles de usuario, cada uno con accesos distintos:

| Rol | Acceso |
| :--- | :--- |
| **Paciente** | Consultar sus datos personales (solo lectura), consultar y reservar turnos, ver historial personal |
| **Profesional** | Ver su agenda diaria, pacientes asignados |
| **Recepcionista / Administrativo** | Gestionar pacientes, asignar turnos |
| **Administrador** | Acceso completo: agendas, especialidades, consultorios, reportes, usuarios |

Funcionalidades principales:

- Autenticación y control de acceso basado en roles.
- Gestión de pacientes, profesionales, especialidades y consultorios físicos.
- Agendas médicas con disponibilidad horaria y prevención de superposición de turnos.
- Reserva, cancelación y reprogramación de turnos.
- Reportes de gestión y ausentismo.
- Cierre de sesión automático por inactividad (configurable, 15 minutos por defecto).

---

## 2. Stack tecnológico

| Componente | Tecnología |
| :--- | :--- |
| Frontend | HTML5 estático + JavaScript vanilla, Bootstrap 5 (responsive) |
| Backend | PHP 8.4 puro (sin frameworks ni dependencias de Composer) |
| Base de datos | MySQL 8.4, motor InnoDB, charset `utf8mb4` |
| Contenedores | Docker y Docker Compose (v2) |
| Pruebas de navegador | Playwright (Node.js) |
| Pruebas de API | `unittest` de Python (solo librería estándar) |

El backend se ejecuta con el servidor embebido de PHP (`php -S`), sin Apache/Nginx, dentro del contenedor `app`. No requiere Composer: todas las clases se cargan mediante un *autoloader* propio (`src/bootstrap.php`).

---

## 3. Requisitos previos

### Obligatorios (para levantar el sistema)

- **[Docker](https://docs.docker.com/get-docker/)** — motor de contenedores.
- **Docker Compose v2** (incluido en instalaciones recientes de Docker Desktop/Engine; se invoca como `docker compose`, no `docker-compose`).
- **[Git](https://git-scm.com/downloads)** — para clonar el repositorio.

No es necesario instalar PHP, MySQL ni Composer en la máquina host: todo corre dentro de los contenedores definidos en `docker-compose.yml`.

### Opcionales (solo para ejecutar las pruebas automatizadas)

- **[Node.js](https://nodejs.org/)** v18 o superior y **npm** v9 o superior — pruebas de navegador (Playwright).
- **Python 3.9 o superior** — pruebas de API (no requiere instalar paquetes externos).

---

## 4. Estructura del proyecto

```
awm_turnos_medicos_producto/
├── public/                     # Punto de entrada web
│   ├── index.html              # Pantalla de inicio de sesión
│   ├── router.php               # Router de páginas / API
│   ├── api/                     # Endpoints de la API (index.php)
│   └── assets/                  # CSS, JS, imágenes, fuentes
├── src/                         # Lógica backend (PHP puro)
│   ├── Auth/                    # Autenticación, autorización, sesión, roles
│   ├── Controladores/           # Controladores HTTP por módulo
│   ├── Pacientes/ Profesionales/ Usuarios/
│   ├── Agendas/ Reservas/ Consultorios/ Especialidades/
│   ├── Reportes/ Personas/ Http/
│   ├── bootstrap.php            # Autoloader y arranque de la app
│   ├── Config.php               # Lectura de variables de entorno
│   ├── Database.php             # Conexión PDO a MySQL
│   └── Rutas.php                # Definición de rutas
├── db/
│   └── schema.sql                # Esquema completo + datos semilla
├── docker/
│   └── php/Dockerfile            # Imagen PHP 8.4-cli + extensión pdo_mysql
├── tests/
│   ├── api/                      # Pruebas de API (Python unittest)
│   └── navegador/                 # Pruebas end-to-end (Playwright)
├── docker-compose.yml             # Orquestación de servicios (db + app)
├── package.json                   # Dependencias Node.js (solo pruebas)
├── .env.example                    # Plantilla de variables de entorno
└── README.md
```

---

## 5. Instalación paso a paso

### Paso 1 — Clonar el repositorio

```bash
git clone <URL-de-este-repositorio>
cd awm_turnos_medicos_producto
```

### Paso 2 — Configurar variables de entorno

La aplicación requiere un archivo `.env` en la raíz del proyecto. Se provee una plantilla (`.env.example`) que debe copiarse:

```bash
cp .env.example .env
```

El archivo `.env` **no se versiona** (está excluido en `.gitignore`); cada entorno/clon del repositorio debe crear el suyo propio.

Variables definidas en `.env.example`:

| Variable | Descripción | Valor por defecto |
| :--- | :--- | :--- |
| `DB_PASSWORD` | Contraseña del usuario `turnos` de MySQL. **Obligatoria**, Compose no arranca sin definirla. | *(sin valor, debe completarse)* |
| `DB_ROOT_PASSWORD` | Contraseña del usuario `root` de MySQL. **Obligatoria**. | *(sin valor, debe completarse)* |
| `APP_PUERTO` | Puerto donde se expone la aplicación en el host. | `8080` |
| `SESSION_SECURE` | `1` exige HTTPS para la cookie de sesión, `0` permite HTTP (uso local). | `0` |
| `SESION_INACTIVIDAD_SEGUNDOS` | Segundos de inactividad antes de cerrar la sesión automáticamente. | `900` (15 minutos) |

Como mínimo, completar las contraseñas:

```env
DB_PASSWORD=elegí_una_contraseña
DB_ROOT_PASSWORD=elegí_otra_contraseña
```

El resto de las variables puede dejarse con sus valores por defecto para un entorno local.

> **Nota de seguridad**: en la base de datos solo se almacenan hashes `bcrypt` de las contraseñas de usuario (ver `db/schema.sql`), nunca contraseñas en texto plano.

### Paso 3 — Construir e iniciar los contenedores

Desde la raíz del proyecto:

```bash
docker compose up -d
```

Este comando:

1. Construye la imagen `app` a partir de `docker/php/Dockerfile` (PHP 8.4 CLI + extensión `pdo_mysql`, con `expose_php` deshabilitado por seguridad).
2. Levanta el servicio `db` (MySQL 8.4, charset `utf8mb4`), creando automáticamente la base `turnos` y ejecutando `db/schema.sql` **solo la primera vez** que se crea el volumen de datos (`datos-mysql`). Este script crea el esquema completo (personas, usuarios, especialidades, consultorios, agendas, turnos, etc.) y carga datos semilla de prueba.
3. Levanta el servicio `app` (servidor PHP embebido en `0.0.0.0:8080` dentro del contenedor), que espera a que `db` esté saludable (`healthcheck` vía `mysqladmin ping`) antes de iniciar.
4. Publica el puerto configurado en `APP_PUERTO` (por defecto `8080`) hacia el host.

La primera ejecución puede demorar unos minutos mientras se descargan las imágenes base y se inicializa la base de datos.

### Paso 4 — Verificar que los contenedores están corriendo

```bash
docker compose ps
```

Deberían figurar dos servicios en estado `running`/`healthy`: `db` y `app`. Para revisar logs ante cualquier problema:

```bash
docker compose logs app   # Logs del servidor PHP
docker compose logs db    # Logs de MySQL
```

### Paso 5 — Acceder al sistema

Abrir en el navegador:

```
http://localhost:8080
```

(o el puerto configurado en `APP_PUERTO`, si se modificó). Se debe ver la pantalla de inicio de sesión (`public/index.html`).

### Paso 6 — Detener el entorno

```bash
docker compose down
```

Para eliminar completamente el entorno, incluyendo los datos cargados en la base (vuelve al estado inicial en la próxima vez que se levante):

```bash
docker compose down -v
```

---

## 6. Configuración de la base de datos

- El esquema se define íntegramente en [`db/schema.sql`](db/schema.sql) (275 líneas), con tablas para personas, usuarios, especialidades, consultorios, agendas, turnos y reportes, todas con motor `InnoDB` y colación `utf8mb4_0900_ai_ci`.
- El archivo se monta como script de inicialización de MySQL (`/docker-entrypoint-initdb.d/01-schema.sql`), por lo que **se ejecuta automáticamente una sola vez**, al crear el volumen `datos-mysql` por primera vez.
- Si se modifica `db/schema.sql` después de la primera ejecución, los cambios **no se reflejan** automáticamente, porque el volumen ya existe. Para forzar su recreación (esto borra todos los datos existentes):

  ```bash
  docker compose down -v
  docker compose up -d
  ```

- Para inicializar la base manualmente fuera de Docker (por ejemplo, contra una instancia MySQL propia), puede ejecutarse directamente:

  ```bash
  mysql -u <usuario> -p turnos < db/schema.sql
  ```

### Credenciales de prueba precargadas

El script de esquema incluye usuarios semilla (todos con la contraseña `Password123!`, almacenada como hash bcrypt):

| Rol | DNI | Contraseña | Estado |
| :--- | :--- | :--- | :--- |
| Administrador | `20000001` | `Password123!` | Activo |
| Recepcionista | `20000002` | `Password123!` | Activo |
| Profesional | `20000003` | `Password123!` | Activo |
| Paciente | `20000004` | `Password123!` | Activo |
| Paciente (bloqueado) | `20000005` | `Password123!` | **Inactivo** (sirve para probar el rechazo de cuentas inactivas) |

Estas credenciales son únicamente para el entorno local de desarrollo/pruebas y **no deben usarse en producción**.

---

## 7. Ejecución y verificación de la instalación

1. **Login**: ingresar a `http://localhost:8080` y autenticarse con alguna de las cuentas de prueba de la sección anterior.
2. **Verificación por rol**: según el rol de la cuenta usada, el sistema debería redirigir a la pantalla correspondiente (`administrador.html`, `recepcionista.html`, `profesional.html` o `paciente.html`).
3. **Verificación de la API**: los endpoints expuestos por `public/api/index.php` deberían responder correctamente a las acciones del frontend (login, consulta de agendas, turnos, etc.) sin errores 500 en `docker compose logs app`.
4. **Verificación de inactividad de sesión**: dejar la sesión abierta sin interactuar durante el tiempo definido en `SESION_INACTIVIDAD_SEGUNDOS` (900 s por defecto) y comprobar que se cierra automáticamente con aviso en pantalla.

### Pruebas automatizadas (opcional, recomendado tras cada instalación)

#### Pruebas de navegador (Playwright)

Requieren Node.js y el sistema corriendo vía Docker Compose.

```bash
npm install                       # Instalar dependencias (primera vez)
npm run test:navegador            # Suite completa (recorrido general)
```

Scripts disponibles por módulo (`package.json`):

```bash
npm run test:navegador:especialidades
npm run test:navegador:personas
npm run test:navegador:agendas
npm run test:navegador:turnos
npm run test:navegador:reportes
npm run test:navegador:usuarios
npm run test:navegador:diseno
npm run test:navegador:datos-personales
npm run test:navegador:inactividad   # requiere SESION_INACTIVIDAD_SEGUNDOS=20 en el contenedor app
```

Las pruebas apuntan por defecto a `APP_URL=http://127.0.0.1:8080`. Si se usó otro puerto, exportar la variable antes de ejecutar, por ejemplo:

```bash
APP_URL=http://127.0.0.1:8090 npm run test:navegador
```

#### Pruebas de API (Python)

No requieren instalar paquetes externos (solo `unittest` de la librería estándar):

```bash
API_URL=http://127.0.0.1:8080 \
DB_CONTENEDOR=<nombre-del-contenedor-db> \
DB_PASSWORD='<DB_PASSWORD-del-.env>' \
python3 -B -X utf8 -m unittest discover -s tests/api -v
```

> Estas pruebas **no eliminan datos**: cada ejecución agrega sus propios registros. Para volver al estado inicial (semilla de datos original), ejecutar `docker compose down -v` y levantar el entorno nuevamente.

---

## 8. Solución de problemas comunes

| Problema | Causa probable | Solución |
| :--- | :--- | :--- |
| El puerto 8080 ya está en uso | Otro proceso/servicio ocupa el puerto | Cambiar `APP_PUERTO` en `.env` (ej. `APP_PUERTO=8090`) y ejecutar `docker compose up -d` nuevamente |
| `docker compose up` falla indicando que `DB_PASSWORD`/`DB_ROOT_PASSWORD` no está definida | No se creó el `.env` o quedó vacío | Verificar que exista `.env` en la raíz (copiado de `.env.example`) y que ambas variables tengan valor |
| La app no levanta o no conecta a la base | Variables de entorno incorrectas o base no saludable aún | Revisar `docker compose logs db` y `docker compose logs app`; esperar a que el healthcheck de `db` pase a `healthy` |
| Se modificó `db/schema.sql` y los cambios no aparecen | El volumen de MySQL ya existía de una ejecución anterior; el script de init solo corre una vez | Ejecutar `docker compose down -v` (borra los datos) y luego `docker compose up -d` |
| Las pruebas de navegador no encuentran la app | `APP_URL` no coincide con el puerto real publicado | Exportar `APP_URL=http://127.0.0.1:<puerto>` antes de correr los tests |
| Acentos o caracteres especiales se ven mal en la base | Cliente MySQL no interpreta UTF-8 | Asegurarse de conectar con `SET NAMES utf8mb4` o usar un cliente con charset `utf8mb4` por defecto |

---

## 9. Detener y limpiar el entorno

```bash
docker compose down        # Detiene los contenedores, conserva los datos
docker compose down -v     # Detiene los contenedores y elimina el volumen de datos (reinicio total)
```

---

## 10. Referencias internas

- [`README.md`](README.md) — descripción general del proyecto e integrantes.
- [`docker-compose.yml`](docker-compose.yml) — definición de servicios `db` y `app`.
- [`docker/php/Dockerfile`](docker/php/Dockerfile) — imagen del backend PHP.
- [`db/schema.sql`](db/schema.sql) — esquema de base de datos y datos semilla.
- [`.env.example`](.env.example) — plantilla de variables de entorno.
- [`src/Config.php`](src/Config.php) — lectura de configuración desde variables de entorno.
- [`package.json`](package.json) — scripts de pruebas de navegador (Playwright).
- [`tests/api/`](tests/api/) — pruebas de API con `unittest` de Python.
- [`tests/navegador/`](tests/navegador/) — pruebas end-to-end con Playwright.

---

*Manual generado a partir del código fuente del repositorio `awm_turnos_medicos_producto`. Última actualización: noviembre 2026.*
