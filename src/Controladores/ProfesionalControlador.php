<?php

declare(strict_types=1);

namespace Turnos\Controladores;

use Turnos\Auth\Autorizacion;
use Turnos\Auth\Roles;
use Turnos\Http\HttpException;
use Turnos\Http\Solicitud;
use Turnos\Personas\DatosPersona;
use Turnos\Profesionales\ProfesionalRepositorio;

// Gestión de profesionales: escritura y vista completa sólo del administrador;
// la recepción lee los activos (insumo para las agendas).
final class ProfesionalControlador
{
    private ProfesionalRepositorio $repositorio;

    public function __construct()
    {
        $this->repositorio = new ProfesionalRepositorio();
    }

    public function listar(): array
    {
        $usuario = Autorizacion::exigirRol(Roles::ADMINISTRADOR, Roles::RECEPCIONISTA);
        $todos = ($_GET['estado'] ?? 'activos') === 'todos';
        if ($todos && $usuario['rol'] !== Roles::ADMINISTRADOR) {
            throw new HttpException(403, 'no_autorizado', 'Tu rol no tiene acceso a este recurso.');
        }
        $especialidad = null;
        if (isset($_GET['especialidad']) && $_GET['especialidad'] !== '') {
            $especialidad = filter_var($_GET['especialidad'], FILTER_VALIDATE_INT);
            if ($especialidad === false) {
                throw new HttpException(400, 'datos_invalidos', 'La especialidad del filtro no es válida.');
            }
        }

        return ['profesionales' => $this->repositorio->listar(!$todos, DatosPersona::texto($_GET['q'] ?? ''), $especialidad)];
    }

    public function obtener(int $id): array
    {
        $usuario = Autorizacion::exigirRol(Roles::ADMINISTRADOR, Roles::RECEPCIONISTA);
        $profesional = $this->existente($id);
        if (!$profesional['activo'] && $usuario['rol'] !== Roles::ADMINISTRADOR) {
            throw $this->noEncontrado();
        }

        return ['profesional' => $profesional];
    }

    public function crear(): array
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR);
        [$persona, $matricula, $especialidades] = $this->datos(true, null);

        $id = $this->repositorio->crear($persona, $matricula, $especialidades);
        http_response_code(201);

        return ['profesional' => $this->existente($id)];
    }

    public function modificar(int $id): array
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR);
        $this->existente($id);
        [$persona, $matricula, $especialidades] = $this->datos(false, $id);

        // agendasDesactivadas: agendas que dejaron de estar activas por quitar especialidades.
        $desactivadas = $this->repositorio->modificar($id, $persona, $matricula, $especialidades);

        return ['profesional' => $this->existente($id), 'agendasDesactivadas' => $desactivadas];
    }

    public function cambiarEstado(int $id): array
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR);
        $this->existente($id);
        $cuerpo = Solicitud::cuerpoJson();
        if (!isset($cuerpo['activo']) || !is_bool($cuerpo['activo'])) {
            throw new HttpException(400, 'datos_invalidos', 'Indicá si el profesional queda activo (true) o inactivo (false).');
        }

        // agendasDesactivadas: agendas desactivadas junto con el profesional.
        $desactivadas = $this->repositorio->cambiarEstado($id, $cuerpo['activo']);

        return ['profesional' => $this->existente($id), 'agendasDesactivadas' => $desactivadas];
    }

    /** @return array{0: array, 1: string, 2: int[]} */
    private function datos(bool $conDni, ?int $idProfesional): array
    {
        $cuerpo = Solicitud::cuerpoJson();
        $persona = DatosPersona::desde($cuerpo, $conDni, false);
        $matricula = DatosPersona::obligatorio($cuerpo['matricula'] ?? null, 30, 'matricula_invalida', 'La matrícula');

        $ids = $cuerpo['especialidades'] ?? null;
        if (!is_array($ids) || !array_is_list($ids) || $ids === []) {
            throw new HttpException(400, 'especialidades_invalidas', 'Elegí al menos una especialidad.');
        }
        foreach ($ids as $id) {
            if (!is_int($id) || $id < 1) {
                throw new HttpException(400, 'especialidades_invalidas', 'Las especialidades deben indicarse por su id.');
            }
        }
        $ids = array_values(array_unique($ids));
        $rechazadas = $this->repositorio->especialidadesNoAsignables($ids, $idProfesional);
        if ($rechazadas !== []) {
            throw new HttpException(400, 'especialidades_invalidas', 'No se pueden asignar las especialidades con id ' . implode(', ', $rechazadas) . ': no existen o están inactivas.');
        }

        return [$persona, $matricula, $ids];
    }

    private function existente(int $id): array
    {
        return $this->repositorio->buscar($id) ?? throw $this->noEncontrado();
    }

    private function noEncontrado(): HttpException
    {
        return new HttpException(404, 'no_encontrado', 'El profesional no existe.');
    }
}
