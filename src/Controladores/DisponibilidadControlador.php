<?php

declare(strict_types=1);

namespace Turnos\Controladores;

use DateTimeImmutable;
use Turnos\Agendas\AgendaRepositorio;
use Turnos\Auth\Autorizacion;
use Turnos\Auth\Roles;
use Turnos\Especialidades\EspecialidadRepositorio;
use Turnos\Http\HttpException;
use Turnos\Reservas\Franjas;
use Turnos\Reservas\TurnoRepositorio;

// Franjas libres para reservar (TUR-007, RF-07) y opciones de búsqueda. Todos los roles autenticados pueden consultarlas.
final class DisponibilidadControlador
{
    private const MAXIMO_DIAS = 31;

    private TurnoRepositorio $turnos;

    public function __construct()
    {
        $this->turnos = new TurnoRepositorio();
    }

    public function listar(): array
    {
        Autorizacion::exigirRol(Roles::PACIENTE, Roles::PROFESIONAL, Roles::RECEPCIONISTA, Roles::ADMINISTRADOR);

        $especialidad = $this->filtroEntero('especialidad');
        if ($especialidad === null) {
            throw new HttpException(400, 'datos_invalidos', 'Indicá la especialidad («especialidad»).');
        }
        $desde = $this->filtroFecha('fecha_desde');
        $hasta = $this->filtroFecha('fecha_hasta');
        if ($desde === null || $hasta === null) {
            throw new HttpException(400, 'datos_invalidos', 'Indicá «fecha_desde» y «fecha_hasta» (YYYY-MM-DD).');
        }
        if ($desde > $hasta) {
            throw new HttpException(400, 'rango_invalido', 'La fecha de inicio no puede ser posterior a la de fin.');
        }
        $dias = (new DateTimeImmutable($desde))->diff(new DateTimeImmutable($hasta))->days + 1;
        if ($dias > self::MAXIMO_DIAS) {
            throw new HttpException(400, 'rango_invalido', 'La consulta no puede superar ' . self::MAXIMO_DIAS . ' días.');
        }

        return ['franjas' => $this->turnos->disponibilidad($especialidad, $desde, $hasta, $this->filtroEntero('profesional'))];
    }

    // Especialidades activas y profesionales activos con sus especialidades activas: para armar la búsqueda.
    public function opciones(): array
    {
        Autorizacion::exigirRol(Roles::PACIENTE, Roles::PROFESIONAL, Roles::RECEPCIONISTA, Roles::ADMINISTRADOR);

        return [
            'especialidades' => (new EspecialidadRepositorio())->listar(true),
            'profesionales' => (new AgendaRepositorio())->profesionalesParaAgendar(null),
        ];
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

    private function filtroFecha(string $clave): ?string
    {
        if (!isset($_GET[$clave]) || $_GET[$clave] === '') {
            return null;
        }
        if (!Franjas::fechaValida($_GET[$clave])) {
            throw new HttpException(400, 'datos_invalidos', "El filtro «$clave» debe ser una fecha YYYY-MM-DD.");
        }

        return $_GET[$clave];
    }
}
