<?php

declare(strict_types=1);

namespace Turnos\Http;

use JsonException;

final class Solicitud
{
    // Devuelve el cuerpo JSON como arreglo; un cuerpo vacío equivale a un arreglo vacío.
    public static function cuerpoJson(): array
    {
        $crudo = file_get_contents('php://input');
        if ($crudo === false || trim($crudo) === '') {
            return [];
        }

        try {
            $datos = json_decode($crudo, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new HttpException(400, 'json_invalido', 'El cuerpo de la solicitud no es un JSON válido.');
        }

        if (!is_array($datos)) {
            throw new HttpException(400, 'json_invalido', 'El cuerpo de la solicitud debe ser un objeto JSON.');
        }

        return $datos;
    }
}
