<?php

declare(strict_types=1);

namespace Turnos\Profesionales;

use PDOException;
use Throwable;
use Turnos\Agendas\AgendaRepositorio;
use Turnos\Auth\Roles;
use Turnos\Database;
use Turnos\Http\HttpException;
use Turnos\Personas\PersonaRepositorio;
use Turnos\Reservas\TurnoRepositorio;
use Turnos\Usuarios\CuentaRepositorio;

// Profesionales (rol sobre `persona`) y su relación N:M con especialidades. La baja es lógica (`activo`).
final class ProfesionalRepositorio
{
    private const SELECT = 'SELECT pr.id_profesional, pe.dni, pe.nombre, pe.apellido, pe.telefono, pe.email, pe.fecha_nacimiento,
        pr.matricula, pr.activo FROM profesional pr JOIN persona pe ON pe.id_persona = pr.id_persona';

    private PersonaRepositorio $personas;

    public function __construct()
    {
        $this->personas = new PersonaRepositorio();
    }

    public function listar(bool $soloActivos, string $texto, ?int $especialidad): array
    {
        $condiciones = [];
        $parametros = [];
        if ($soloActivos) {
            $condiciones[] = 'pr.activo = 1';
        }
        if ($texto !== '') {
            $condiciones[] = '(pe.dni LIKE :q1 OR pe.apellido LIKE :q2 OR pe.nombre LIKE :q3 OR pr.matricula LIKE :q4)';
            // Sin preparación emulada no se puede repetir un parámetro con nombre.
            $patron = '%' . addcslashes($texto, '%_\\') . '%';
            $parametros += ['q1' => $patron, 'q2' => $patron, 'q3' => $patron, 'q4' => $patron];
        }
        if ($especialidad !== null) {
            $condiciones[] = 'EXISTS (SELECT 1 FROM profesional_especialidad x WHERE x.id_profesional = pr.id_profesional AND x.id_especialidad = :esp)';
            $parametros['esp'] = $especialidad;
        }
        $sql = self::SELECT . ($condiciones ? ' WHERE ' . implode(' AND ', $condiciones) : '') . ' ORDER BY pe.apellido, pe.nombre';
        $consulta = Database::conexion()->prepare($sql);
        $consulta->execute($parametros);

        return array_map([$this, 'normalizar'], $consulta->fetchAll());
    }

    public function buscar(int $id): ?array
    {
        $consulta = Database::conexion()->prepare(self::SELECT . ' WHERE pr.id_profesional = :id');
        $consulta->execute(['id' => $id]);
        $fila = $consulta->fetch();

        return $fila === false ? null : $this->normalizar($fila);
    }

    // Devuelve los ids que no se pueden asignar: inexistentes o inactivas, salvo las que el profesional ya tiene
    // (una especialidad desactivada después no impide editar al profesional).
    public function especialidadesNoAsignables(array $ids, ?int $idProfesional): array
    {
        $marcas = implode(',', array_fill(0, count($ids), '?'));
        $consulta = Database::conexion()->prepare(
            "SELECT e.id_especialidad FROM especialidad e WHERE e.id_especialidad IN ($marcas) AND (e.activa = 1 OR EXISTS
             (SELECT 1 FROM profesional_especialidad x WHERE x.id_profesional = ? AND x.id_especialidad = e.id_especialidad))"
        );
        $consulta->execute([...$ids, $idProfesional ?? 0]);
        $validas = array_map('intval', $consulta->fetchAll(\PDO::FETCH_COLUMN));

        return array_values(array_diff($ids, $validas));
    }

    public function crear(array $persona, string $matricula, array $especialidades): int
    {
        $conexion = Database::conexion();
        $conexion->beginTransaction();
        try {
            $idPersona = $this->personas->idPorDni($persona['dni']);
            if ($idPersona === null) {
                $idPersona = $this->personas->crear($persona);
            } else {
                $existe = $conexion->prepare('SELECT 1 FROM profesional WHERE id_persona = :id');
                $existe->execute(['id' => $idPersona]);
                if ($existe->fetchColumn() !== false) {
                    throw new HttpException(409, 'dni_duplicado', 'Ya existe un profesional con ese DNI.');
                }
                $this->personas->actualizar($idPersona, $persona, true);
            }
            $this->guardarMatricula(fn () => $conexion
                ->prepare('INSERT INTO profesional (id_persona, matricula) VALUES (:persona, :matricula)')
                ->execute(['persona' => $idPersona, 'matricula' => $matricula]));
            $id = (int) $conexion->lastInsertId();
            $this->reemplazarEspecialidades($id, $especialidades);
            $conexion->commit();
        } catch (Throwable $error) {
            $conexion->rollBack();
            throw $error;
        }

        return $id;
    }

    // Devuelve cuántas agendas se desactivaron por quitar especialidades.
    public function modificar(int $id, array $persona, string $matricula, array $especialidades): int
    {
        $conexion = Database::conexion();
        $conexion->beginTransaction();
        try {
            // Bloquear el profesional antes de leer. Una lectura sin bloqueo fijaría el snapshot antes de
            // esperar a un alta concurrente, y la desactivación de agendas no vería la agenda que esa alta confirma.
            $consulta = $conexion->prepare('SELECT id_persona FROM profesional WHERE id_profesional = :id FOR UPDATE');
            $consulta->execute(['id' => $id]);
            $this->personas->actualizar((int) $consulta->fetchColumn(), $persona);
            $this->guardarMatricula(fn () => $conexion
                ->prepare('UPDATE profesional SET matricula = :matricula WHERE id_profesional = :id')
                ->execute(['matricula' => $matricula, 'id' => $id]));
            $desactivadas = $this->reemplazarEspecialidades($id, $especialidades);
            $conexion->commit();
        } catch (Throwable $error) {
            $conexion->rollBack();
            throw $error;
        }

        return $desactivadas;
    }

    // Al desactivar al profesional se desactivan también sus agendas. Reactivarlo no las reactiva:
    // cada agenda se vuelve a activar por separado, con sus validaciones.
    // Devuelve cuántas agendas se desactivaron con el profesional.
    public function cambiarEstado(int $id, bool $activo): int
    {
        $conexion = Database::conexion();
        $conexion->beginTransaction();
        try {
            $consulta = $conexion->prepare('SELECT id_persona FROM profesional WHERE id_profesional = :id');
            $consulta->execute(['id' => $id]);
            $idPersona = (int) $consulta->fetchColumn();
            $conexion->prepare('UPDATE profesional SET activo = :activo WHERE id_profesional = :id')
                ->execute(['activo' => $activo ? 1 : 0, 'id' => $id]);
            $desactivadas = 0;
            if (!$activo) {
                TurnoRepositorio::exigirSinTurnosFuturos('a.id_profesional = :id', ['id' => $id]);
                $desactivadas = AgendaRepositorio::desactivarAgendas('id_profesional = :id', ['id' => $id]);
                CuentaRepositorio::inactivarDelRegistro($idPersona, Roles::PROFESIONAL);
            }
            $conexion->commit();
        } catch (Throwable $error) {
            $conexion->rollBack();
            throw $error;
        }

        return $desactivadas;
    }

    private function guardarMatricula(callable $operacion): void
    {
        try {
            $operacion();
        } catch (PDOException $error) {
            if (($error->errorInfo[1] ?? null) === 1062) {
                throw new HttpException(409, 'matricula_duplicada', 'Esa matrícula ya está registrada.');
            }
            throw $error;
        }
    }

    // Una agenda cuya especialidad deja de estar asignada al profesional se desactiva.
    private function reemplazarEspecialidades(int $id, array $especialidades): int
    {
        $conexion = Database::conexion();
        $conexion->prepare('DELETE FROM profesional_especialidad WHERE id_profesional = :id')->execute(['id' => $id]);
        $insertar = $conexion->prepare('INSERT INTO profesional_especialidad (id_profesional, id_especialidad) VALUES (:p, :e)');
        foreach ($especialidades as $especialidad) {
            $insertar->execute(['p' => $id, 'e' => $especialidad]);
        }
        TurnoRepositorio::exigirSinTurnosFuturos(
            'a.id_profesional = :id AND a.id_especialidad NOT IN (SELECT x.id_especialidad FROM profesional_especialidad x WHERE x.id_profesional = :actual)',
            ['id' => $id, 'actual' => $id]
        );
        return AgendaRepositorio::desactivarAgendas(
            'id_profesional = :id AND id_especialidad NOT IN (SELECT x.id_especialidad FROM profesional_especialidad x WHERE x.id_profesional = :actual)',
            ['id' => $id, 'actual' => $id]
        );
    }

    private function especialidadesDe(int $id): array
    {
        $consulta = Database::conexion()->prepare(
            'SELECT e.id_especialidad, e.nombre, e.activa FROM profesional_especialidad x
             JOIN especialidad e ON e.id_especialidad = x.id_especialidad WHERE x.id_profesional = :id ORDER BY e.nombre'
        );
        $consulta->execute(['id' => $id]);

        return array_map(
            fn (array $e) => ['id' => (int) $e['id_especialidad'], 'nombre' => $e['nombre'], 'activa' => (bool) $e['activa']],
            $consulta->fetchAll()
        );
    }

    private function normalizar(array $fila): array
    {
        $id = (int) $fila['id_profesional'];

        return [
            'id' => $id,
            'dni' => $fila['dni'],
            'nombre' => $fila['nombre'],
            'apellido' => $fila['apellido'],
            'telefono' => $fila['telefono'],
            'email' => $fila['email'],
            'fechaNacimiento' => $fila['fecha_nacimiento'],
            'matricula' => $fila['matricula'],
            'activo' => (bool) $fila['activo'],
            'especialidades' => $this->especialidadesDe($id),
        ];
    }
}
