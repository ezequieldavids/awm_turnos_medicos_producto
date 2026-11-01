<?php

declare(strict_types=1);

namespace Turnos\Personas;

use Turnos\Http\HttpException;

// Validación de los datos civiles compartidos por pacientes y profesionales (PRD H.2, PERSONA).
final class DatosPersona
{
    /** @return array{dni: ?string, nombre: string, apellido: string, telefono: ?string, email: ?string, fecha_nacimiento: ?string} */
    public static function desde(array $cuerpo, bool $conDni, bool $fechaObligatoria): array
    {
        $dni = null;
        if ($conDni) {
            $dni = self::texto($cuerpo['dni'] ?? null);
            if (!preg_match('/^\d{7,8}$/', $dni)) {
                throw new HttpException(400, 'dni_invalido', 'El DNI debe tener 7 u 8 dígitos.');
            }
        }

        $email = self::opcional($cuerpo['email'] ?? null, 190, 'email_invalido', 'El email');
        if ($email !== null && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw new HttpException(400, 'email_invalido', 'El email no tiene un formato válido.');
        }

        return [
            'dni' => $dni,
            'nombre' => self::obligatorio($cuerpo['nombre'] ?? null, 100, 'nombre_invalido', 'El nombre'),
            'apellido' => self::obligatorio($cuerpo['apellido'] ?? null, 100, 'apellido_invalido', 'El apellido'),
            'telefono' => self::opcional($cuerpo['telefono'] ?? null, 30, 'telefono_invalido', 'El teléfono'),
            'email' => $email,
            'fecha_nacimiento' => self::fecha($cuerpo['fechaNacimiento'] ?? null, $fechaObligatoria),
        ];
    }

    public static function obligatorio(mixed $valor, int $largo, string $codigo, string $etiqueta): string
    {
        $texto = self::texto($valor);
        if ($texto === '') {
            throw new HttpException(400, $codigo, 'Completá ' . self::minuscula($etiqueta) . '.');
        }
        if (mb_strlen($texto) > $largo) {
            throw new HttpException(400, $codigo, "$etiqueta no puede superar los $largo caracteres.");
        }

        return $texto;
    }

    public static function opcional(mixed $valor, int $largo, string $codigo, string $etiqueta): ?string
    {
        if ($valor !== null && !is_string($valor)) {
            throw new HttpException(400, $codigo, "$etiqueta debe ser un texto.");
        }
        $texto = self::texto($valor);
        if ($texto === '') {
            return null;
        }
        if (mb_strlen($texto) > $largo) {
            throw new HttpException(400, $codigo, "$etiqueta no puede superar los $largo caracteres.");
        }

        return $texto;
    }

    private static function fecha(mixed $valor, bool $obligatoria): ?string
    {
        $texto = self::texto($valor);
        if ($texto === '') {
            if ($obligatoria) {
                throw new HttpException(400, 'fecha_nacimiento_invalida', 'Completá la fecha de nacimiento.');
            }

            return null;
        }
        $fecha = \DateTimeImmutable::createFromFormat('!Y-m-d', $texto);
        $errores = \DateTimeImmutable::getLastErrors();
        if ($fecha === false || ($errores && ($errores['warning_count'] || $errores['error_count']))) {
            throw new HttpException(400, 'fecha_nacimiento_invalida', 'La fecha de nacimiento no es válida (AAAA-MM-DD).');
        }
        if ($fecha > new \DateTimeImmutable('today', new \DateTimeZone('America/Argentina/Buenos_Aires')) || (int) $fecha->format('Y') < 1900) {
            throw new HttpException(400, 'fecha_nacimiento_invalida', 'La fecha de nacimiento no puede ser futura ni anterior a 1900.');
        }

        return $texto;
    }

    private static function minuscula(string $texto): string
    {
        return mb_strtolower(mb_substr($texto, 0, 1)) . mb_substr($texto, 1);
    }

    // Quita espacios laterales de cualquier tipo Unicode (incluido el no separable), que trim() no recorta.
    public static function texto(mixed $valor): string
    {
        return is_string($valor) ? (preg_replace('/^[\s\p{Z}]+|[\s\p{Z}]+$/u', '', $valor) ?? '') : '';
    }
}
