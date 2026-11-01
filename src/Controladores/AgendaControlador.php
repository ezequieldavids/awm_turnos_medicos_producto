<?php

declare(strict_types=1);

namespace Turnos\Controladores;

use DateTimeImmutable;
use Turnos\Agendas\AgendaRepositorio;
use Turnos\Auth\Autorizacion;
use Turnos\Auth\Roles;
use Turnos\Consultorios\ConsultorioRepositorio;
use Turnos\Http\HttpException;
use Turnos\Http\Solicitud;

// Agendas médicas (TUR-004, CU-05): el administrador configura cualquier agenda; el profesional, sólo la suya.
// La recepción las lee activas (insumo de TUR-007).
final class AgendaControlador
{
    private AgendaRepositorio $repositorio;
    private ConsultorioRepositorio $consultorios;

    public function __construct()
    {
        $this->repositorio = new AgendaRepositorio();
        $this->consultorios = new ConsultorioRepositorio();
    }

    public function listar(): array
    {
        $usuario = Autorizacion::exigirRol(Roles::ADMINISTRADOR, Roles::RECEPCIONISTA, Roles::PROFESIONAL);
        $propio = $this->propio($usuario);
        $profesional = $this->filtroEntero('profesional');
        if ($propio !== null && $profesional !== null && $profesional !== $propio) {
            throw new HttpException(403, 'no_autorizado', 'Solo podés ver tu propia agenda.');
        }

        $todas = ($_GET['estado'] ?? 'activas') === 'todas';
        if ($todas && $usuario['rol'] === Roles::RECEPCIONISTA) {
            throw new HttpException(403, 'no_autorizado', 'Tu rol no tiene acceso a este recurso.');
        }

        return ['agendas' => $this->repositorio->listar($propio ?? $profesional, $this->filtroEntero('consultorio'), !$todas)];
    }

    public function obtener(int $id): array
    {
        $usuario = Autorizacion::exigirRol(Roles::ADMINISTRADOR, Roles::RECEPCIONISTA, Roles::PROFESIONAL);
        $propio = $this->propio($usuario);
        $agenda = $this->existente($id);
        if ($propio !== null && $agenda['profesional']['id'] !== $propio) {
            throw new HttpException(403, 'no_autorizado', 'Solo podés ver tu propia agenda.');
        }
        if (!$agenda['activa'] && $usuario['rol'] === Roles::RECEPCIONISTA) {
            throw $this->noEncontrado();
        }

        return ['agenda' => $agenda];
    }

    // Opciones para configurar una agenda: profesionales activos con sus especialidades activas y consultorios activos.
    public function opciones(): array
    {
        $usuario = Autorizacion::exigirRol(Roles::ADMINISTRADOR, Roles::PROFESIONAL);

        return [
            'profesionales' => $this->repositorio->profesionalesParaAgendar($this->propio($usuario)),
            'consultorios' => $this->consultorios->listar(true, ''),
        ];
    }

    public function crear(): array
    {
        $usuario = Autorizacion::exigirRol(Roles::ADMINISTRADOR, Roles::PROFESIONAL);

        $id = $this->repositorio->guardar(null, $this->datos($this->propio($usuario)));
        http_response_code(201);

        return ['agenda' => $this->existente($id)];
    }

    public function modificar(int $id): array
    {
        $usuario = Autorizacion::exigirRol(Roles::ADMINISTRADOR, Roles::PROFESIONAL);
        $propio = $this->propio($usuario);
        $this->autorizarEdicion($id, $propio);

        $this->repositorio->guardar($id, $this->datos($propio));

        return ['agenda' => $this->existente($id)];
    }

    public function cambiarEstado(int $id): array
    {
        $usuario = Autorizacion::exigirRol(Roles::ADMINISTRADOR, Roles::PROFESIONAL);
        $this->autorizarEdicion($id, $this->propio($usuario));
        $cuerpo = Solicitud::cuerpoJson();
        if (!isset($cuerpo['activa']) || !is_bool($cuerpo['activa'])) {
            throw new HttpException(400, 'datos_invalidos', 'Indicá si la agenda queda activa (true) o inactiva (false).');
        }

        $this->repositorio->cambiarEstado($id, $cuerpo['activa']);

        return ['agenda' => $this->existente($id)];
    }

    // Id del perfil de profesional del usuario autenticado; null para el resto de los roles.
    private function propio(array $usuario): ?int
    {
        if ($usuario['rol'] !== Roles::PROFESIONAL) {
            return null;
        }

        return $this->repositorio->idProfesionalDeUsuario($usuario['id'])
            ?? throw new HttpException(403, 'no_autorizado', 'Tu cuenta no tiene un perfil de profesional.');
    }

    private function autorizarEdicion(int $id, ?int $propio): array
    {
        $agenda = $this->existente($id);
        if ($propio !== null && $agenda['profesional']['id'] !== $propio) {
            throw new HttpException(403, 'no_autorizado', 'Solo podés modificar tu propia agenda.');
        }

        return $agenda;
    }

    // Valida el cuerpo y lo devuelve en forma de dominio para el repositorio. Un profesional sólo puede usar su propio id.
    private function datos(?int $propio): array
    {
        $cuerpo = Solicitud::cuerpoJson();
        if ($propio !== null && isset($cuerpo['profesional']) && $cuerpo['profesional'] !== $propio) {
            throw new HttpException(403, 'no_autorizado', 'Solo podés configurar tu propia agenda.');
        }
        $inicio = $this->hora($cuerpo['horaInicio'] ?? null, 'hora_invalida', 'La hora de inicio no es válida (HH:MM).');
        $fin = $this->hora($cuerpo['horaFin'] ?? null, 'hora_invalida', 'La hora de fin no es válida (HH:MM).');
        if ($inicio >= $fin) {
            throw new HttpException(400, 'horario_invalido', 'La hora de inicio debe ser anterior a la de fin.');
        }
        $desde = $this->fecha($cuerpo['vigenteDesde'] ?? null, true, 'vigencia_desde_invalida', 'Indicá desde qué fecha rige la agenda (AAAA-MM-DD).');
        $hasta = $this->fecha($cuerpo['vigenteHasta'] ?? null, false, 'vigencia_hasta_invalida', 'La fecha de fin de vigencia no es válida (AAAA-MM-DD).');
        if ($hasta !== null && $hasta < $desde) {
            throw new HttpException(400, 'vigencia_hasta_invalida', 'La vigencia no puede terminar antes de empezar.');
        }

        return [
            'profesional' => $propio ?? $this->entero($cuerpo, 'profesional', 'profesional_invalido', 'Elegí el profesional.'),
            'consultorio' => $this->entero($cuerpo, 'consultorio', 'consultorio_invalido', 'Elegí el consultorio.'),
            'especialidad' => $this->entero($cuerpo, 'especialidad', 'especialidad_invalida', 'Elegí la especialidad.'),
            'dia' => $this->entero($cuerpo, 'diaSemana', 'dia_invalido', 'El día debe ser de 1 (lunes) a 7 (domingo).', 1, 7),
            'inicio' => $inicio,
            'fin' => $fin,
            'duracion' => $this->entero($cuerpo, 'duracionMinutos', 'duracion_invalida', 'La duración del turno debe estar entre 5 y 120 minutos.', 5, 120),
            'desde' => $desde,
            'hasta' => $hasta,
        ];
    }

    private function entero(array $cuerpo, string $clave, string $codigo, string $mensaje, int $minimo = 1, int $maximo = PHP_INT_MAX): int
    {
        $valor = $cuerpo[$clave] ?? null;
        if (!is_int($valor) || $valor < $minimo || $valor > $maximo) {
            throw new HttpException(400, $codigo, $mensaje);
        }

        return $valor;
    }

    private function hora(mixed $valor, string $codigo, string $mensaje): string
    {
        // `\z` y no `$`: éste último acepta un salto de línea final.
        if (!is_string($valor) || !preg_match('/^([01]\d|2[0-3]):[0-5]\d\z/', $valor)) {
            throw new HttpException(400, $codigo, $mensaje);
        }

        return $valor;
    }

    private function fecha(mixed $valor, bool $obligatoria, string $codigo, string $mensaje): ?string
    {
        if ($valor === null || $valor === '') {
            if ($obligatoria) {
                throw new HttpException(400, $codigo, $mensaje);
            }

            return null;
        }
        // Sólo AAAA-MM-DD con ceros: así el orden de texto coincide con el orden de fechas.
        $canonica = is_string($valor) && preg_match('/^\d{4}-\d{2}-\d{2}\z/', $valor) === 1;
        $fecha = $canonica ? DateTimeImmutable::createFromFormat('!Y-m-d', $valor) : false;
        $errores = DateTimeImmutable::getLastErrors();
        // Año mínimo 1900, como las fechas de nacimiento de TUR-003 (REV-TUR-004-012).
        if ($fecha === false || ($errores && ($errores['warning_count'] || $errores['error_count'])) || (int) $fecha->format('Y') < 1900) {
            throw new HttpException(400, $codigo, $mensaje);
        }

        return $valor;
    }

    private function filtroEntero(string $clave): ?int
    {
        if (!isset($_GET[$clave]) || $_GET[$clave] === '') {
            return null;
        }
        $valor = filter_var($_GET[$clave], FILTER_VALIDATE_INT);
        if ($valor === false || $valor < 1) {
            throw new HttpException(400, 'datos_invalidos', "El filtro «$clave» no es válido.");
        }

        return $valor;
    }

    private function existente(int $id): array
    {
        return $this->repositorio->buscar($id) ?? throw $this->noEncontrado();
    }

    private function noEncontrado(): HttpException
    {
        return new HttpException(404, 'no_encontrado', 'La agenda no existe.');
    }
}
