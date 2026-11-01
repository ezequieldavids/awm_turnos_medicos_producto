<?php

declare(strict_types=1);

namespace Turnos\Auth;

use Turnos\Http\HttpException;

final class Autorizacion
{
    // 401 si no hay sesión; devuelve los datos del usuario autenticado.
    // Relee la cuenta en cada petición (TUR-005, Q-5): una cuenta desactivada cierra su sesión y un cambio de rol rige ya.
    public static function exigirSesion(): array
    {
        $sesion = GestorSesion::usuario();
        // Inactividad (TUR-008, Q-1): más allá del límite sin peticiones, la sesión se cierra y responde sesion_expirada.
        if ($sesion !== null && GestorSesion::vencida()) {
            GestorSesion::cerrar();
            GestorSesion::avisarInactividad();
            throw new HttpException(401, 'sesion_expirada', 'Tu sesión se cerró por inactividad. Volvé a iniciar sesión.');
        }
        $cuenta = $sesion === null ? null : (new UsuarioRepositorio())->buscarPorId($sesion['id']);
        // Una contraseña restablecida cierra las sesiones abiertas con la anterior (TUR-005, Q-9).
        $vigente = $cuenta !== null && hash_equals((string) GestorSesion::huella(), GestorSesion::huellaDe($cuenta['password_hash']));
        if ($cuenta === null || $cuenta['estado'] !== 'activo' || !$vigente) {
            if ($sesion !== null) {
                GestorSesion::cerrar();
            }
            throw new HttpException(401, 'no_autenticado', 'Necesitás iniciar sesión para ver este recurso.');
        }

        GestorSesion::registrarActividad();

        return GestorSesion::actualizar($cuenta);
    }

    // 401 sin sesión; 403 si el rol autenticado no está entre los autorizados (RNF-07).
    public static function exigirRol(string ...$roles): array
    {
        $usuario = self::exigirSesion();
        if (!in_array($usuario['rol'], $roles, true)) {
            throw new HttpException(403, 'no_autorizado', 'Tu rol no tiene acceso a este recurso.');
        }

        return $usuario;
    }
}
