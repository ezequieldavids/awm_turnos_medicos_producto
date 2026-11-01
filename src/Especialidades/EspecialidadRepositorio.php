<?php

declare(strict_types=1);

namespace Turnos\Especialidades;

use PDO;
use PDOException;
use Throwable;
use Turnos\Agendas\AgendaRepositorio;
use Turnos\Database;
use Turnos\Reservas\TurnoRepositorio;

// Acceso a datos de especialidades con sentencias preparadas. La baja es lógica (columna `activa`).
final class EspecialidadRepositorio
{
    private const CODIGO_DUPLICADO = 1062;

    public function listar(bool $soloActivas): array
    {
        $sql = 'SELECT id_especialidad, nombre, descripcion, activa FROM especialidad'
            . ($soloActivas ? ' WHERE activa = 1' : '') . ' ORDER BY nombre';

        return array_map([$this, 'normalizar'], Database::conexion()->query($sql)->fetchAll());
    }

    public function buscar(int $id): ?array
    {
        $consulta = Database::conexion()->prepare(
            'SELECT id_especialidad, nombre, descripcion, activa FROM especialidad WHERE id_especialidad = :id'
        );
        $consulta->execute(['id' => $id]);
        $fila = $consulta->fetch();

        return $fila === false ? null : $this->normalizar($fila);
    }

    // Devuelve el id creado; false si el nombre ya existe.
    public function crear(string $nombre, ?string $descripcion): int|false
    {
        $conexion = Database::conexion();
        try {
            $conexion->prepare('INSERT INTO especialidad (nombre, descripcion) VALUES (:nombre, :descripcion)')
                ->execute(['nombre' => $nombre, 'descripcion' => $descripcion]);
        } catch (PDOException $error) {
            if ($this->esDuplicado($error)) {
                return false;
            }
            throw $error;
        }

        return (int) $conexion->lastInsertId();
    }

    // false si el nombre ya pertenece a otra especialidad.
    public function modificar(int $id, string $nombre, ?string $descripcion): bool
    {
        try {
            Database::conexion()
                ->prepare('UPDATE especialidad SET nombre = :nombre, descripcion = :descripcion WHERE id_especialidad = :id')
                ->execute(['nombre' => $nombre, 'descripcion' => $descripcion, 'id' => $id]);
        } catch (PDOException $error) {
            if ($this->esDuplicado($error)) {
                return false;
            }
            throw $error;
        }

        return true;
    }

    // TUR-004 (A-05): al desactivar una especialidad se desactivan las agendas que la usan; reactivarla no las reactiva.
    // Devuelve cuántas agendas se desactivaron.
    public function cambiarEstado(int $id, bool $activa): int
    {
        $conexion = Database::conexion();
        $conexion->beginTransaction();
        try {
            $conexion->prepare('UPDATE especialidad SET activa = :activa WHERE id_especialidad = :id')
                ->execute(['activa' => $activa ? 1 : 0, 'id' => $id]);
            $desactivadas = 0;
            if (!$activa) {
                TurnoRepositorio::exigirSinTurnosFuturos('a.id_especialidad = :id', ['id' => $id]);
                $desactivadas = AgendaRepositorio::desactivarAgendas('id_especialidad = :id', ['id' => $id]);
            }
            $conexion->commit();
        } catch (Throwable $error) {
            $conexion->rollBack();
            throw $error;
        }

        return $desactivadas;
    }

    private function esDuplicado(PDOException $error): bool
    {
        return ($error->errorInfo[1] ?? null) === self::CODIGO_DUPLICADO;
    }

    private function normalizar(array $fila): array
    {
        return [
            'id' => (int) $fila['id_especialidad'],
            'nombre' => $fila['nombre'],
            'descripcion' => $fila['descripcion'],
            'activa' => (bool) $fila['activa'],
        ];
    }
}
