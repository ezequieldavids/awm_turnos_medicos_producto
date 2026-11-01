<?php

declare(strict_types=1);

namespace Turnos\Controladores;

use Turnos\Auth\Autorizacion;
use Turnos\Auth\Roles;
use Turnos\Consultorios\ConsultorioRepositorio;
use Turnos\Http\HttpException;
use Turnos\Http\Solicitud;
use Turnos\Personas\DatosPersona;

// Gestión de consultorios (TUR-004): escritura sólo del administrador; lectura para la recepción y los profesionales
// (estos últimos lo necesitan para elegir consultorio al configurar su agenda).
final class ConsultorioControlador
{
    private ConsultorioRepositorio $repositorio;

    public function __construct()
    {
        $this->repositorio = new ConsultorioRepositorio();
    }

    public function listar(): array
    {
        $usuario = Autorizacion::exigirRol(Roles::ADMINISTRADOR, Roles::RECEPCIONISTA, Roles::PROFESIONAL);
        $todos = ($_GET['estado'] ?? 'activos') === 'todos';
        if ($todos && $usuario['rol'] !== Roles::ADMINISTRADOR) {
            throw new HttpException(403, 'no_autorizado', 'Tu rol no tiene acceso a este recurso.');
        }

        return ['consultorios' => $this->repositorio->listar(!$todos, DatosPersona::texto($_GET['q'] ?? ''))];
    }

    public function obtener(int $id): array
    {
        $usuario = Autorizacion::exigirRol(Roles::ADMINISTRADOR, Roles::RECEPCIONISTA, Roles::PROFESIONAL);
        $consultorio = $this->existente($id);
        if (!$consultorio['activo'] && $usuario['rol'] !== Roles::ADMINISTRADOR) {
            throw $this->noEncontrado();
        }

        return ['consultorio' => $consultorio];
    }

    public function crear(): array
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR);

        $id = $this->repositorio->crear($this->datos());
        http_response_code(201);

        return ['consultorio' => $this->existente($id)];
    }

    public function modificar(int $id): array
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR);
        $this->existente($id);

        $this->repositorio->modificar($id, $this->datos());

        return ['consultorio' => $this->existente($id)];
    }

    public function cambiarEstado(int $id): array
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR);
        $this->existente($id);
        $cuerpo = Solicitud::cuerpoJson();
        if (!isset($cuerpo['activo']) || !is_bool($cuerpo['activo'])) {
            throw new HttpException(400, 'datos_invalidos', 'Indicá si el consultorio queda activo (true) o inactivo (false).');
        }

        $this->repositorio->cambiarEstado($id, $cuerpo['activo']);

        return ['consultorio' => $this->existente($id)];
    }

    private function datos(): array
    {
        $cuerpo = Solicitud::cuerpoJson();

        return [
            'numero' => DatosPersona::obligatorio($cuerpo['numero'] ?? null, 20, 'numero_invalido', 'El número'),
            'piso' => DatosPersona::opcional($cuerpo['piso'] ?? null, 20, 'piso_invalido', 'El piso'),
            'ubicacion' => DatosPersona::opcional($cuerpo['ubicacion'] ?? null, 100, 'ubicacion_invalida', 'La ubicación'),
        ];
    }

    private function existente(int $id): array
    {
        return $this->repositorio->buscar($id) ?? throw $this->noEncontrado();
    }

    private function noEncontrado(): HttpException
    {
        return new HttpException(404, 'no_encontrado', 'El consultorio no existe.');
    }
}
