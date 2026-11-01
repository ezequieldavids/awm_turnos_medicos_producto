<?php

declare(strict_types=1);

// Hora local del negocio (Argentina, -03): las comparaciones de «pasado» y «futuro» de los turnos usan esta zona.
date_default_timezone_set('America/Argentina/Buenos_Aires');

// Autocarga PSR-4 mínima para el namespace Turnos\ (PHP puro, sin Composer).
spl_autoload_register(function (string $clase): void {
    $prefijo = 'Turnos\\';
    if (strncmp($clase, $prefijo, strlen($prefijo)) !== 0) {
        return;
    }
    $archivo = __DIR__ . '/' . str_replace('\\', '/', substr($clase, strlen($prefijo))) . '.php';
    if (is_file($archivo)) {
        require $archivo;
    }
});
