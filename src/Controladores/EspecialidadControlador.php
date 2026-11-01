<?php

declare(strict_types=1);

namespace Turnos\Controladores;

use Turnos\Auth\Autorizacion;
use Turnos\Auth\Roles;
use Turnos\Especialidades\EspecialidadRepositorio;
use Turnos\Http\HttpException;
use Turnos\Http\Solicitud;

// Gestión de especialidades: lectura de activas para cualquier usuario autenticado,
// escritura y vista completa sólo del administrador.
final class EspecialidadControlador
{
    private const LARGO_NOMBRE = 80;
    private const LARGO_DESCRIPCION = 255;

    private EspecialidadRepositorio $repositorio;

    public function __construct()
    {
        $this->repositorio = new EspecialidadRepositorio();
    }

    public function listar(): array
    {
        $usuario = Autorizacion::exigirSesion();
        $todas = ($_GET['estado'] ?? 'activas') === 'todas';
        if ($todas && $usuario['rol'] !== Roles::ADMINISTRADOR) {
            throw new HttpException(403, 'no_autorizado', 'Tu rol no tiene acceso a este recurso.');
        }

        return ['especialidades' => $this->repositorio->listar(!$todas)];
    }

    public function obtener(int $id): array
    {
        $usuario = Autorizacion::exigirSesion();
        $especialidad = $this->existente($id);
        if (!$especialidad['activa'] && $usuario['rol'] !== Roles::ADMINISTRADOR) {
            throw $this->noEncontrada();
        }

        return ['especialidad' => $especialidad];
    }

    public function crear(): array
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR);
        [$nombre, $descripcion] = $this->datos();

        $id = $this->repositorio->crear($nombre, $descripcion);
        if ($id === false) {
            throw $this->duplicada();
        }
        http_response_code(201);

        return ['especialidad' => $this->existente($id)];
    }

    public function modificar(int $id): array
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR);
        $this->existente($id);
        [$nombre, $descripcion] = $this->datos();

        if (!$this->repositorio->modificar($id, $nombre, $descripcion)) {
            throw $this->duplicada();
        }

        return ['especialidad' => $this->existente($id)];
    }

    public function cambiarEstado(int $id): array
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR);
        $this->existente($id);
        $cuerpo = Solicitud::cuerpoJson();
        if (!isset($cuerpo['activa']) || !is_bool($cuerpo['activa'])) {
            throw new HttpException(400, 'datos_invalidos', 'Indicá si la especialidad queda activa (true) o inactiva (false).');
        }

        // agendasDesactivadas: agendas desactivadas junto con la especialidad.
        $desactivadas = $this->repositorio->cambiarEstado($id, $cuerpo['activa']);

        return ['especialidad' => $this->existente($id), 'agendasDesactivadas' => $desactivadas];
    }

    /** @return array{0: string, 1: ?string} */
    private function datos(): array
    {
        $cuerpo = Solicitud::cuerpoJson();
        $nombre = $cuerpo['nombre'] ?? null;
        $descripcion = $cuerpo['descripcion'] ?? null;

        $nombre = is_string($nombre) ? $this->recortar($nombre) : '';
        if ($nombre === '') {
            throw new HttpException(400, 'nombre_invalido', 'El nombre es obligatorio.');
        }
        if (mb_strlen($nombre) > self::LARGO_NOMBRE) {
            throw new HttpException(400, 'nombre_invalido', 'El nombre no puede superar los ' . self::LARGO_NOMBRE . ' caracteres.');
        }

        if ($descripcion !== null && !is_string($descripcion)) {
            throw new HttpException(400, 'descripcion_invalida', 'La descripción debe ser un texto.');
        }
        $descripcion = $descripcion === null ? null : $this->recortar($descripcion);
        if ($descripcion === '') {
            $descripcion = null;
        }
        if ($descripcion !== null && mb_strlen($descripcion) > self::LARGO_DESCRIPCION) {
            throw new HttpException(400, 'descripcion_invalida', 'La descripción no puede superar los ' . self::LARGO_DESCRIPCION . ' caracteres.');
        }

        return [$nombre, $descripcion];
    }

    // Quita espacios laterales de cualquier tipo Unicode (incluido el espacio no separable), que trim() no recorta.
    private function recortar(string $texto): string
    {
        return preg_replace('/^[\s\p{Z}]+|[\s\p{Z}]+$/u', '', $texto) ?? '';
    }

    private function existente(int $id): array
    {
        return $this->repositorio->buscar($id) ?? throw $this->noEncontrada();
    }

    private function noEncontrada(): HttpException
    {
        return new HttpException(404, 'no_encontrado', 'La especialidad no existe.');
    }

    private function duplicada(): HttpException
    {
        return new HttpException(409, 'nombre_duplicado', 'Ya existe una especialidad con ese nombre.');
    }
}
