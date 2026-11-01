<?php

declare(strict_types=1);

// Router del servidor PHP integrado (`php -S ... public/router.php`), usado en desarrollo local y en Docker.
// Las rutas /api/ van al controlador de la API; el resto son archivos estáticos del front.

$ruta = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// Una ruta mal formada (por ejemplo //a:b/) no debe provocar un error de PHP con detalles internos.
if (!is_string($ruta)) {
    http_response_code(400);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Solicitud no válida.';

    return true;
}

if (str_starts_with($ruta, '/api/')) {
    require __DIR__ . '/api/index.php';

    return true;
}

if ($ruta === '/') {
    return false;
}

// Archivo existente dentro de public/: lo sirve el servidor. Cualquier otra ruta es 404, no el login.
$archivo = realpath(__DIR__ . $ruta);
if ($archivo !== false && is_file($archivo) && str_starts_with($archivo, __DIR__ . DIRECTORY_SEPARATOR)) {
    return false;
}

http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
echo 'No encontrado.';

return true;
