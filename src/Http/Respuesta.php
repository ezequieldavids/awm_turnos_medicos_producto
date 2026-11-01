<?php

declare(strict_types=1);

namespace Turnos\Http;

final class Respuesta
{
    public static function json(int $estado, array $cuerpo): void
    {
        http_response_code($estado);
        header('Content-Type: application/json; charset=utf-8');
        // Las respuestas de la API contienen datos de sesión: nunca se guardan en caché.
        header('Cache-Control: no-store');
        echo json_encode($cuerpo, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    public static function descarga(Descarga $descarga): void
    {
        http_response_code(200);
        header('Content-Type: ' . $descarga->tipo);
        header('Content-Disposition: attachment; filename="' . $descarga->nombre . '"');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        echo $descarga->contenido;
    }

    public static function error(int $estado, string $codigo, string $mensaje): void
    {
        self::json($estado, ['error' => ['codigo' => $codigo, 'mensaje' => $mensaje]]);
    }
}
