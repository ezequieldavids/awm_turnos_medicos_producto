<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/src/bootstrap.php';

use Turnos\Auth\GestorSesion;
use Turnos\Http\Descarga;
use Turnos\Http\HttpException;
use Turnos\Http\Respuesta;
use Turnos\Http\Router;
use Turnos\Rutas;

GestorSesion::iniciar();

$router = new Router();
Rutas::registrar($router);

try {
    $ruta = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    // La ruta llega completa (/api/...); el router trabaja con esa misma forma.
    $cuerpo = $router->despachar($_SERVER['REQUEST_METHOD'], $ruta);
    // Las acciones pueden fijar un código de éxito distinto de 200 (por ejemplo 201 al crear).
    if ($cuerpo instanceof Descarga) {
        Respuesta::descarga($cuerpo);
    } else {
        Respuesta::json(http_response_code() ?: 200, $cuerpo);
    }
} catch (HttpException $error) {
    Respuesta::error($error->estado(), $error->codigo(), $error->getMessage());
} catch (Throwable $error) {
    // El detalle interno sólo va al log del servidor (AC-006 y límites del contrato).
    error_log('[turnos] ' . $error::class . ': ' . $error->getMessage());
    Respuesta::error(500, 'error_interno', 'No se pudo completar la operación. Intentá nuevamente más tarde.');
}
