<?php

declare(strict_types=1);

namespace Turnos\Personas;

use PDOException;
use Turnos\Database;
use Turnos\Http\HttpException;

// Datos civiles en `persona`. Se usa dentro de la transacción del repositorio de cada rol.
final class PersonaRepositorio
{
    public function idPorDni(string $dni): ?int
    {
        $consulta = Database::conexion()->prepare('SELECT id_persona FROM persona WHERE dni = :dni');
        $consulta->execute(['dni' => $dni]);
        $id = $consulta->fetchColumn();

        return $id === false ? null : (int) $id;
    }

    public function crear(array $datos): int
    {
        $conexion = Database::conexion();
        $this->ejecutar(
            'INSERT INTO persona (dni, nombre, apellido, telefono, email, fecha_nacimiento)
             VALUES (:dni, :nombre, :apellido, :telefono, :email, :fecha_nacimiento)',
            $datos
        );

        return (int) $conexion->lastInsertId();
    }

    // El DNI identifica a la persona y no se modifica. En una edición los datos opcionales vacíos se borran;
    // al vincular un rol a una persona existente (`$conservarOpcionales`) lo no enviado conserva su valor (REV-TUR-003-002).
    public function actualizar(int $id, array $datos, bool $conservarOpcionales = false): void
    {
        unset($datos['dni']);
        $opcional = fn (string $columna) => $conservarOpcionales ? "COALESCE(:$columna, $columna)" : ":$columna";
        $this->ejecutar(
            'UPDATE persona SET nombre = :nombre, apellido = :apellido, telefono = ' . $opcional('telefono')
            . ', email = ' . $opcional('email') . ', fecha_nacimiento = ' . $opcional('fecha_nacimiento')
            . ' WHERE id_persona = :id',
            $datos + ['id' => $id]
        );
    }

    private function ejecutar(string $sql, array $parametros): void
    {
        try {
            Database::conexion()->prepare($sql)->execute($parametros);
        } catch (PDOException $error) {
            // Duplicados por clave única → 409 sin datos del registro (ni el DNI ni el email llegan al log).
            // Un DNI repetido en una carrera se detecta aquí, para pacientes (TUR-003) y cuentas (TUR-005).
            if (($error->errorInfo[1] ?? null) === 1062) {
                if (str_contains($error->getMessage(), 'uk_persona_email')) {
                    throw new HttpException(409, 'email_duplicado', 'Ese email ya está registrado para otra persona.');
                }
                if (str_contains($error->getMessage(), 'uk_persona_dni')) {
                    throw new HttpException(409, 'dni_duplicado', 'Ya existe una persona con ese DNI. Revisá la lista y volvé a intentar.');
                }
            }
            throw $error;
        }
    }
}
