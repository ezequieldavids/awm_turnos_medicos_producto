<?php

declare(strict_types=1);

namespace Turnos\Auth;

use Turnos\Database;

final class UsuarioRepositorio
{
    // Devuelve la cuenta asociada al DNI de la persona, o null si no existe.
    public function buscarPorDni(string $dni): ?array
    {
        $consulta = Database::conexion()->prepare(
            'SELECT u.id_usuario, u.password_hash, u.rol, u.estado, p.nombre, p.apellido
               FROM usuario u
               INNER JOIN persona p ON p.id_persona = u.id_persona
              WHERE p.dni = :dni
              LIMIT 1'
        );
        $consulta->execute(['dni' => $dni]);
        $fila = $consulta->fetch();

        return $fila === false ? null : $fila;
    }

    // Lee la cuenta actual para cada petición autenticada (TUR-005, Q-5): estado y rol vigentes, no los de la sesión.
    public function buscarPorId(int $id): ?array
    {
        $consulta = Database::conexion()->prepare(
            'SELECT u.id_usuario, u.password_hash, u.rol, u.estado, p.nombre, p.apellido
               FROM usuario u
               INNER JOIN persona p ON p.id_persona = u.id_persona
              WHERE u.id_usuario = :id
              LIMIT 1'
        );
        $consulta->execute(['id' => $id]);
        $fila = $consulta->fetch();

        return $fila === false ? null : $fila;
    }
}
