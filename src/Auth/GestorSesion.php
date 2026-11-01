<?php

declare(strict_types=1);

namespace Turnos\Auth;

use Turnos\Config;

// Sesión de PHP con cookie Secure, HttpOnly y SameSite.
final class GestorSesion
{
    public static function iniciar(): void
    {
        session_name(Config::get('SESSION_NOMBRE', 'turnos_sesion'));
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'secure' => Config::get('SESSION_SECURE', '1') === '1',
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
        session_start();
    }

    public static function usuario(): ?array
    {
        return $_SESSION['usuario'] ?? null;
    }

    // Regenera el identificador al iniciar sesión para evitar fijación de sesión.
    public static function abrir(array $usuario): void
    {
        session_regenerate_id(true);
        self::actualizar($usuario);
        $_SESSION['huella'] = self::huellaDe($usuario['password_hash']);
        self::registrarActividad();
        self::quitarAvisoDeInactividad();
    }

    // Límite de inactividad en segundos: 900 por defecto, configurable con SESION_INACTIVIDAD_SEGUNDOS.
    // Un valor no positivo o no numérico usa el por defecto, para no cerrar todas las sesiones de inmediato.
    public static function limiteInactividad(): int
    {
        $segundos = (int) Config::get('SESION_INACTIVIDAD_SEGUNDOS', '900');

        return $segundos > 0 ? $segundos : 900;
    }

    // Marca de última actividad: cada petición autenticada la renueva.
    public static function registrarActividad(): void
    {
        $_SESSION['ultimaActividad'] = time();
    }

    // Marca de corta duración (60 s) que acompaña al cierre por inactividad: sin ella, volver con «atrás» daría
    // no_autenticado y la pantalla de inicio no mostraría el aviso. No contiene datos de la sesión.
    public static function avisarInactividad(): void
    {
        self::marcaDeAviso(time() + 60);
    }

    // Quita la marca al iniciar sesión, sólo si el navegador la tenía: un 401 posterior no debe mostrar un aviso viejo.
    // En el caso normal no se envía ninguna cookie extra en el login.
    public static function quitarAvisoDeInactividad(): void
    {
        if (isset($_COOKIE['turnos_inactividad'])) {
            self::marcaDeAviso(time() - 42000);
        }
    }

    private static function marcaDeAviso(int $expira): void
    {
        setcookie('turnos_inactividad', '1', [
            'expires' => $expira,
            'path' => '/',
            'secure' => Config::get('SESSION_SECURE', '1') === '1',
            'httponly' => false,
            'samesite' => 'Strict',
        ]);
    }

    // Verdadero si llegó al límite sin peticiones: igual que el temporizador del navegador, para que ambos venzan a la vez.
    // Una sesión sin marca (abierta antes de que existiera este control) se considera vigente.
    public static function vencida(): bool
    {
        $ultima = $_SESSION['ultimaActividad'] ?? null;

        return $ultima !== null && time() - (int) $ultima >= self::limiteInactividad();
    }

    // Huella del hash de contraseña con que se abrió la sesión: cambiar la contraseña la invalida.
    public static function huella(): ?string
    {
        return $_SESSION['huella'] ?? null;
    }

    public static function huellaDe(string $passwordHash): string
    {
        return hash('sha256', $passwordHash);
    }

    // Copia a la sesión los datos vigentes de la cuenta.
    public static function actualizar(array $usuario): array
    {
        $_SESSION['usuario'] = [
            'id' => (int) $usuario['id_usuario'],
            'nombre' => $usuario['nombre'],
            'apellido' => $usuario['apellido'],
            'rol' => $usuario['rol'],
        ];

        return $_SESSION['usuario'];
    }

    // Vacía y destruye la sesión en el servidor y expira la cookie: el identificador anterior deja de valer.
    public static function cerrar(): void
    {
        $_SESSION = [];
        $parametros = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires' => time() - 42000,
            'path' => $parametros['path'],
            'domain' => $parametros['domain'],
            'secure' => $parametros['secure'],
            'httponly' => $parametros['httponly'],
            'samesite' => $parametros['samesite'],
        ]);
        session_destroy();
    }
}
