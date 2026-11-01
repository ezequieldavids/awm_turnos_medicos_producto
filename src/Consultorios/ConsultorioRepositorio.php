<?php

declare(strict_types=1);

namespace Turnos\Consultorios;

use PDOException;
use Throwable;
use Turnos\Database;
use Turnos\Http\HttpException;
use Turnos\Reservas\TurnoRepositorio;

// Consultorios (PRD H.2, RF-05). La baja es lógica (`activo`).
final class ConsultorioRepositorio
{
    private const SELECT = 'SELECT id_consultorio, numero, piso, ubicacion, activo FROM consultorio';

    public function listar(bool $soloActivos, string $texto): array
    {
        $condiciones = [];
        $parametros = [];
        if ($soloActivos) {
            $condiciones[] = 'activo = 1';
        }
        if ($texto !== '') {
            $condiciones[] = '(numero LIKE :q1 OR ubicacion LIKE :q2)';
            // Sin preparación emulada no se puede repetir un parámetro con nombre.
            $patron = '%' . addcslashes($texto, '%_\\') . '%';
            $parametros = ['q1' => $patron, 'q2' => $patron];
        }
        $sql = self::SELECT . ($condiciones ? ' WHERE ' . implode(' AND ', $condiciones) : '') . ' ORDER BY numero';
        $consulta = Database::conexion()->prepare($sql);
        $consulta->execute($parametros);

        return array_map([$this, 'normalizar'], $consulta->fetchAll());
    }

    public function buscar(int $id): ?array
    {
        $consulta = Database::conexion()->prepare(self::SELECT . ' WHERE id_consultorio = :id');
        $consulta->execute(['id' => $id]);
        $fila = $consulta->fetch();

        return $fila === false ? null : $this->normalizar($fila);
    }

    public function crear(array $datos): int
    {
        $conexion = Database::conexion();
        $this->guardarNumero(fn () => $conexion
            ->prepare('INSERT INTO consultorio (numero, piso, ubicacion) VALUES (:numero, :piso, :ubicacion)')
            ->execute($datos));

        return (int) $conexion->lastInsertId();
    }

    public function modificar(int $id, array $datos): void
    {
        $this->guardarNumero(fn () => Database::conexion()
            ->prepare('UPDATE consultorio SET numero = :numero, piso = :piso, ubicacion = :ubicacion WHERE id_consultorio = :id')
            ->execute($datos + ['id' => $id]));
    }

    // Un consultorio con agendas activas no se desactiva: primero hay que desactivar o reasignar esas agendas.
    // La comprobación y el cambio van en una transacción que bloquea la fila, como el alta de agendas (TUR-004, AC-003).
    public function cambiarEstado(int $id, bool $activo): void
    {
        $conexion = Database::conexion();
        $conexion->beginTransaction();
        try {
            $conexion->prepare('SELECT id_consultorio FROM consultorio WHERE id_consultorio = :id FOR UPDATE')->execute(['id' => $id]);
            if (!$activo) {
                // TUR-007 (Q-1): primero los turnos confirmados futuros, con su propio código de error.
                TurnoRepositorio::exigirSinTurnosFuturos('a.id_consultorio = :id', ['id' => $id]);
                $consulta = $conexion->prepare('SELECT COUNT(*) FROM agenda WHERE id_consultorio = :id AND activa = 1');
                $consulta->execute(['id' => $id]);
                if ((int) $consulta->fetchColumn() > 0) {
                    throw new HttpException(409, 'consultorio_con_agendas', 'No se puede desactivar el consultorio porque tiene agendas activas. Desactivalas o reasignalas antes.');
                }
            }
            $conexion->prepare('UPDATE consultorio SET activo = :activo WHERE id_consultorio = :id')
                ->execute(['activo' => $activo ? 1 : 0, 'id' => $id]);
            $conexion->commit();
        } catch (Throwable $error) {
            $conexion->rollBack();
            throw $error;
        }
    }

    private function guardarNumero(callable $operacion): void
    {
        try {
            $operacion();
        } catch (PDOException $error) {
            if (($error->errorInfo[1] ?? null) === 1062) {
                throw new HttpException(409, 'numero_duplicado', 'Ya existe un consultorio con ese número.');
            }
            throw $error;
        }
    }

    private function normalizar(array $fila): array
    {
        return [
            'id' => (int) $fila['id_consultorio'],
            'numero' => $fila['numero'],
            'piso' => $fila['piso'],
            'ubicacion' => $fila['ubicacion'],
            'activo' => (bool) $fila['activo'],
        ];
    }
}
