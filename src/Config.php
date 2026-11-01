<?php

declare(strict_types=1);

namespace Turnos;

final class Config
{
    // Valores tomados del entorno; si no están definidos o están vacíos, se usa el valor por defecto.
    public static function get(string $clave, string $porDefecto = ''): string
    {
        $valor = getenv($clave);

        return $valor === false || $valor === '' ? $porDefecto : $valor;
    }
}
