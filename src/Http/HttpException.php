<?php

declare(strict_types=1);

namespace Turnos\Http;

use RuntimeException;

// Error esperado de la API: el mensaje es seguro para mostrar al cliente.
final class HttpException extends RuntimeException
{
    public function __construct(
        private int $estado,
        private string $codigo,
        string $mensaje
    ) {
        parent::__construct($mensaje);
    }

    public function estado(): int
    {
        return $this->estado;
    }

    public function codigo(): string
    {
        return $this->codigo;
    }
}
