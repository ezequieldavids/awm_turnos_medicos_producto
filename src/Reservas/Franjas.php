<?php

declare(strict_types=1);

namespace Turnos\Reservas;

use DateTimeImmutable;

// Reglas de franjas horarias de los turnos: una franja es un tramo de la grilla de una agenda, en su día de la semana
// y dentro de su vigencia. Funciones puras, sin acceso a la base.
final class Franjas
{
    // Convierte «HH:MM» o «HH:MM:SS» a minutos desde la medianoche.
    public static function minutos(string $hora): int
    {
        [$horas, $minutos] = array_map('intval', explode(':', substr($hora, 0, 5)));

        return $horas * 60 + $minutos;
    }

    public static function hora(int $minutos): string
    {
        return sprintf('%02d:%02d', intdiv($minutos, 60), $minutos % 60);
    }

    public static function fechaValida(string $fecha): bool
    {
        $dia = DateTimeImmutable::createFromFormat('!Y-m-d', $fecha);

        return $dia !== false && $dia->format('Y-m-d') === $fecha;
    }

    public static function horaValida(string $hora): bool
    {
        return preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $hora) === 1;
    }

    // Hora de fin de la franja que empieza en `$inicio` (HH:MM) para la agenda `$agenda` (fila de la base), o null si la
    // franja no pertenece a esa agenda: otro día, fuera de vigencia, fuera de la grilla o que termina después de la agenda.
    public static function finDeFranja(array $agenda, string $fecha, string $inicio): ?string
    {
        if ((int) (new DateTimeImmutable($fecha))->format('N') !== (int) $agenda['dia_semana']) {
            return null;
        }
        if ($fecha < $agenda['vigente_desde'] || ($agenda['vigente_hasta'] !== null && $fecha > $agenda['vigente_hasta'])) {
            return null;
        }

        $duracion = (int) $agenda['duracion_min'];
        $desde = self::minutos($agenda['hora_inicio']);
        $hasta = self::minutos($agenda['hora_fin']);
        $comienzo = self::minutos($inicio);
        if ($comienzo < $desde || ($comienzo - $desde) % $duracion !== 0 || $comienzo + $duracion > $hasta) {
            return null;
        }

        return self::hora($comienzo + $duracion);
    }

    // Una franja `[inicio, fin)` choca con una ocupación del mismo profesional o del mismo consultorio si se superpone en el tiempo.
    // Los límites que sólo se tocan no chocan.
    public static function ocupada(array $ocupaciones, int $profesional, int $consultorio, int $inicio, int $fin): bool
    {
        foreach ($ocupaciones as $ocupacion) {
            $mismoRecurso = $ocupacion['profesional'] === $profesional || $ocupacion['consultorio'] === $consultorio;
            if ($mismoRecurso && $inicio < $ocupacion['fin'] && $ocupacion['inicio'] < $fin) {
                return true;
            }
        }

        return false;
    }
}
