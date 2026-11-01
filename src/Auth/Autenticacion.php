<?php

declare(strict_types=1);

namespace Turnos\Auth;

final class Autenticacion
{
    // Hash bcrypt de un valor descartable: se verifica cuando el DNI no existe,
    // para que la respuesta no revele la existencia de la cuenta por su tiempo.
    private const HASH_DESCARTABLE = '$2y$12$WlA/ycWFV38GoSrd.GJ04eKcYcVzPKHAboy2pR/GYvusE1h7afpt2';

    public function __construct(private UsuarioRepositorio $usuarios)
    {
    }

    // Devuelve la cuenta autenticada o null. No distingue entre DNI inexistente, contraseña
    // incorrecta y cuenta inactiva (AC-002).
    public function verificar(string $dni, string $password): ?array
    {
        $cuenta = $this->usuarios->buscarPorDni($dni);
        $hash = $cuenta['password_hash'] ?? self::HASH_DESCARTABLE;
        $contrasenaValida = password_verify($password, $hash);

        if ($cuenta === null || !$contrasenaValida || $cuenta['estado'] !== 'activo') {
            return null;
        }

        return $cuenta;
    }
}
