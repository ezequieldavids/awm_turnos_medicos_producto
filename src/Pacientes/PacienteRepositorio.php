<?php

declare(strict_types=1);

namespace Turnos\Pacientes;

use Throwable;
use Turnos\Auth\Roles;
use Turnos\Database;
use Turnos\Http\HttpException;
use Turnos\Personas\PersonaRepositorio;
use Turnos\Reservas\TurnoRepositorio;
use Turnos\Usuarios\CuentaRepositorio;

// Pacientes (rol sobre `persona`). La baja es lógica (columna `activo`).
final class PacienteRepositorio
{
    private const SELECT = 'SELECT pa.id_paciente, pe.dni, pe.nombre, pe.apellido, pe.telefono, pe.email, pe.fecha_nacimiento,
        pa.obra_social, pa.activo FROM paciente pa JOIN persona pe ON pe.id_persona = pa.id_persona';

    private PersonaRepositorio $personas;

    public function __construct()
    {
        $this->personas = new PersonaRepositorio();
    }

    public function listar(bool $soloActivos, string $texto): array
    {
        $condiciones = [];
        $parametros = [];
        if ($soloActivos) {
            $condiciones[] = 'pa.activo = 1';
        }
        if ($texto !== '') {
            $condiciones[] = '(pe.dni LIKE :q1 OR pe.apellido LIKE :q2 OR pe.nombre LIKE :q3)';
            // Sin preparación emulada no se puede repetir un parámetro con nombre.
            $parametros = ['q1' => $patron = '%' . addcslashes($texto, '%_\\') . '%', 'q2' => $patron, 'q3' => $patron];
        }
        $sql = self::SELECT . ($condiciones ? ' WHERE ' . implode(' AND ', $condiciones) : '') . ' ORDER BY pe.apellido, pe.nombre';
        $consulta = Database::conexion()->prepare($sql);
        $consulta->execute($parametros);

        return array_map([$this, 'normalizar'], $consulta->fetchAll());
    }

    public function buscar(int $id): ?array
    {
        $consulta = Database::conexion()->prepare(self::SELECT . ' WHERE pa.id_paciente = :id');
        $consulta->execute(['id' => $id]);
        $fila = $consulta->fetch();

        return $fila === false ? null : $this->normalizar($fila);
    }

    // Registro activo de paciente de la cuenta de la sesión (TUR-010): usuario.id_persona → paciente.id_persona.
    public function buscarDeUsuario(int $idUsuario): ?array
    {
        $consulta = Database::conexion()->prepare(self::SELECT . ' JOIN usuario u ON u.id_persona = pa.id_persona WHERE u.id_usuario = :id AND pa.activo = 1');
        $consulta->execute(['id' => $idUsuario]);
        $fila = $consulta->fetch();

        return $fila === false ? null : $this->normalizar($fila);
    }

    // Crea la persona o, si el DNI ya existe sin rol de paciente, la vincula y actualiza sus datos civiles (CU-02).
    public function crear(array $persona, ?string $obraSocial): int
    {
        $conexion = Database::conexion();
        $conexion->beginTransaction();
        try {
            $idPersona = $this->personas->idPorDni($persona['dni']);
            if ($idPersona === null) {
                $idPersona = $this->personas->crear($persona);
            } else {
                $existe = $conexion->prepare('SELECT 1 FROM paciente WHERE id_persona = :id');
                $existe->execute(['id' => $idPersona]);
                if ($existe->fetchColumn() !== false) {
                    throw new HttpException(409, 'dni_duplicado', 'Ya existe un paciente con ese DNI.');
                }
                $this->personas->actualizar($idPersona, $persona, true);
            }
            $conexion->prepare('INSERT INTO paciente (id_persona, obra_social) VALUES (:persona, :obra)')
                ->execute(['persona' => $idPersona, 'obra' => $obraSocial]);
            $id = (int) $conexion->lastInsertId();
            $conexion->commit();
        } catch (Throwable $error) {
            $conexion->rollBack();
            throw $error;
        }

        return $id;
    }

    public function modificar(int $id, array $persona, ?string $obraSocial): void
    {
        $conexion = Database::conexion();
        $conexion->beginTransaction();
        try {
            $consulta = $conexion->prepare('SELECT id_persona FROM paciente WHERE id_paciente = :id');
            $consulta->execute(['id' => $id]);
            $this->personas->actualizar((int) $consulta->fetchColumn(), $persona);
            $conexion->prepare('UPDATE paciente SET obra_social = :obra WHERE id_paciente = :id')
                ->execute(['obra' => $obraSocial, 'id' => $id]);
            $conexion->commit();
        } catch (Throwable $error) {
            $conexion->rollBack();
            throw $error;
        }
    }

    // REV-TUR-007-008 (decisión del usuario): desactivar un paciente con turnos confirmados a futuro responde 409
    // turnos_futuros y no cambia nada. Bloquea la fila del paciente primero, como las reservas de turnos.
    public function cambiarEstado(int $id, bool $activo): void
    {
        $conexion = Database::conexion();
        $conexion->beginTransaction();
        try {
            $consulta = $conexion->prepare('SELECT id_persona FROM paciente WHERE id_paciente = :id FOR UPDATE');
            $consulta->execute(['id' => $id]);
            $idPersona = (int) $consulta->fetchColumn();
            if (!$activo) {
                TurnoRepositorio::exigirSinTurnosFuturos('t.id_paciente = :id', ['id' => $id]);
            }
            $conexion->prepare('UPDATE paciente SET activo = :activo WHERE id_paciente = :id')
                ->execute(['activo' => $activo ? 1 : 0, 'id' => $id]);
            if (!$activo) {
                CuentaRepositorio::inactivarDelRegistro($idPersona, Roles::PACIENTE);
            }
            $conexion->commit();
        } catch (Throwable $error) {
            $conexion->rollBack();
            throw $error;
        }
    }

    private function normalizar(array $fila): array
    {
        return [
            'id' => (int) $fila['id_paciente'],
            'dni' => $fila['dni'],
            'nombre' => $fila['nombre'],
            'apellido' => $fila['apellido'],
            'telefono' => $fila['telefono'],
            'email' => $fila['email'],
            'fechaNacimiento' => $fila['fecha_nacimiento'],
            'obraSocial' => $fila['obra_social'],
            'activo' => (bool) $fila['activo'],
        ];
    }
}
