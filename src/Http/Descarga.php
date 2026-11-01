<?php

declare(strict_types=1);

namespace Turnos\Http;

// Respuesta que no es JSON: un archivo que el navegador descarga (exportación CSV).
final class Descarga
{
    public function __construct(
        public readonly string $nombre,
        public readonly string $tipo,
        public readonly string $contenido,
    ) {
    }
}
