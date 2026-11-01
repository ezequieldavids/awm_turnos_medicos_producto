<?php

declare(strict_types=1);

namespace Turnos\Reportes;

use DateInterval;
use DatePeriod;
use DateTimeImmutable;
use Turnos\Database;
use Turnos\Reservas\Franjas;
use Turnos\Reservas\TurnoRepositorio;

// Reporte de turnos (TUR-006, RF-12). Los conteos se agrupan en SQL por especialidad y profesional (los de la agenda del
// turno); la capacidad de la tasa de ocupación se calcula con las agendas activas tal como están hoy, sin historial.
final class ReporteRepositorio
{
    public function existeEspecialidad(int $id): bool
    {
        return $this->existe('SELECT 1 FROM especialidad WHERE id_especialidad = :id', $id);
    }

    public function existeProfesional(int $id): bool
    {
        return $this->existe('SELECT 1 FROM profesional WHERE id_profesional = :id', $id);
    }

    // Reporte entre dos fechas inclusive, con los filtros opcionales ya validados.
    public function turnos(string $desde, string $hasta, ?int $especialidad, ?int $profesional): array
    {
        [$donde, $parametros] = $this->filtro($especialidad, $profesional);
        $conexion = Database::conexion();

        $consulta = $conexion->prepare(
            "SELECT a.id_especialidad, e.nombre AS especialidad, a.id_profesional, pp.nombre, pp.apellido,
                    COUNT(*) AS otorgados,
                    SUM(t.estado = 'atendido') AS atendidos,
                    SUM(t.estado = 'cancelado') AS cancelados,
                    SUM(t.estado = 'ausente') AS ausentes,
                    SUM(t.estado = 'confirmado' AND TIMESTAMP(t.fecha, t.hora_inicio) <= :ahora1) AS pendientes,
                    SUM(t.estado = 'confirmado' AND TIMESTAMP(t.fecha, t.hora_inicio) > :ahora2) AS programados
             FROM turno t
             JOIN agenda a ON a.id_agenda = t.id_agenda
             JOIN especialidad e ON e.id_especialidad = a.id_especialidad
             JOIN profesional pr ON pr.id_profesional = a.id_profesional
             JOIN persona pp ON pp.id_persona = pr.id_persona
             WHERE t.fecha BETWEEN :desde AND :hasta $donde
             GROUP BY a.id_especialidad, e.nombre, a.id_profesional, pp.nombre, pp.apellido
             ORDER BY e.nombre, pp.apellido, pp.nombre, a.id_profesional"
        );
        $ahora = TurnoRepositorio::ahora();
        $consulta->execute($parametros + ['desde' => $desde, 'hasta' => $hasta, 'ahora1' => $ahora, 'ahora2' => $ahora]);
        $filas = $consulta->fetchAll();

        // Turnos no cancelados en agendas activas, por especialidad y profesional (numerador de la ocupación).
        $consulta = $conexion->prepare(
            "SELECT a.id_especialidad, a.id_profesional, COUNT(*) AS ocupados
             FROM turno t JOIN agenda a ON a.id_agenda = t.id_agenda
             WHERE t.fecha BETWEEN :desde AND :hasta AND t.estado <> 'cancelado' AND a.activa = 1 $donde
             GROUP BY a.id_especialidad, a.id_profesional"
        );
        $consulta->execute($parametros + ['desde' => $desde, 'hasta' => $hasta]);
        $ocupados = [];
        foreach ($consulta->fetchAll() as $fila) {
            $ocupados[$fila['id_especialidad'] . '-' . $fila['id_profesional']] = (int) $fila['ocupados'];
        }
        [$capacidades, $capacidadTotal] = $this->capacidades($desde, $hasta, $especialidad, $profesional);
        $ocupadosTotal = array_sum($ocupados);

        $totales = ['otorgados' => 0, 'atendidos' => 0, 'cancelados' => 0, 'ausentes' => 0, 'pendientesAsistencia' => 0, 'programados' => 0];
        $desglose = [];
        foreach ($filas as $fila) {
            $clave = $fila['id_especialidad'] . '-' . $fila['id_profesional'];
            $conteos = [
                'otorgados' => (int) $fila['otorgados'],
                'atendidos' => (int) $fila['atendidos'],
                'cancelados' => (int) $fila['cancelados'],
                'ausentes' => (int) $fila['ausentes'],
                'pendientesAsistencia' => (int) $fila['pendientes'],
                'programados' => (int) $fila['programados'],
            ];
            foreach ($conteos as $campo => $valor) {
                $totales[$campo] += $valor;
            }
            $desglose[] = [
                'especialidad' => ['id' => (int) $fila['id_especialidad'], 'nombre' => $fila['especialidad']],
                'profesional' => ['id' => (int) $fila['id_profesional'], 'nombre' => $fila['nombre'], 'apellido' => $fila['apellido']],
            ] + $conteos + ['tasas' => $this->tasas($conteos, $ocupados[$clave] ?? 0, $capacidades[$clave] ?? 0)];
        }

        return [
            'periodo' => ['desde' => $desde, 'hasta' => $hasta],
            'filtros' => ['especialidad' => $especialidad, 'profesional' => $profesional],
            'totales' => $totales,
            'tasas' => $this->tasas($totales, $ocupadosTotal, $capacidadTotal),
            'desglose' => $desglose,
        ];
    }

    // Tasas en porcentaje con un decimal; null cuando no hay denominador (no se muestra 0 % engañoso).
    private function tasas(array $conteos, int $ocupados, int $capacidad): array
    {
        $cumplidos = $conteos['atendidos'] + $conteos['ausentes'];

        return [
            'ausentismo' => $this->porcentaje($conteos['ausentes'], $cumplidos),
            'cancelacion' => $this->porcentaje($conteos['cancelados'], $conteos['otorgados']),
            'ocupacion' => $this->porcentaje($ocupados, $capacidad),
        ];
    }

    private function porcentaje(int $parte, int $total): ?float
    {
        return $total === 0 ? null : round($parte * 100 / $total, 1);
    }

    // Franjas que ofrecieron las agendas activas del filtro entre dos fechas: por (especialidad, profesional) y en total.
    private function capacidades(string $desde, string $hasta, ?int $especialidad, ?int $profesional): array
    {
        [$donde, $parametros] = $this->filtro($especialidad, $profesional);
        $consulta = Database::conexion()->prepare(
            "SELECT a.id_especialidad, a.id_profesional, a.dia_semana, a.hora_inicio, a.hora_fin, a.duracion_min,
                    a.vigente_desde, a.vigente_hasta
             FROM agenda a
             WHERE a.activa = 1 AND a.vigente_desde <= :hasta AND (a.vigente_hasta IS NULL OR a.vigente_hasta >= :desde) $donde"
        );
        $consulta->execute($parametros + ['desde' => $desde, 'hasta' => $hasta]);

        $dias = [];
        $inicio = new DateTimeImmutable($desde);
        $fin = new DateTimeImmutable($hasta);
        foreach (new DatePeriod($inicio, new DateInterval('P1D'), $fin->modify('+1 day')) as $dia) {
            $dias[] = [$dia->format('Y-m-d'), (int) $dia->format('N')];
        }

        $porClave = [];
        $total = 0;
        foreach ($consulta->fetchAll() as $agenda) {
            $porDia = intdiv(Franjas::minutos($agenda['hora_fin']) - Franjas::minutos($agenda['hora_inicio']), (int) $agenda['duracion_min']);
            $cantidad = 0;
            foreach ($dias as [$fecha, $diaSemana]) {
                if ($diaSemana === (int) $agenda['dia_semana'] && $fecha >= $agenda['vigente_desde']
                    && ($agenda['vigente_hasta'] === null || $fecha <= $agenda['vigente_hasta'])) {
                    $cantidad += $porDia;
                }
            }
            $clave = $agenda['id_especialidad'] . '-' . $agenda['id_profesional'];
            $porClave[$clave] = ($porClave[$clave] ?? 0) + $cantidad;
            $total += $cantidad;
        }

        return [$porClave, $total];
    }

    private function filtro(?int $especialidad, ?int $profesional): array
    {
        $donde = '';
        $parametros = [];
        if ($especialidad !== null) {
            $donde .= ' AND a.id_especialidad = :especialidad';
            $parametros['especialidad'] = $especialidad;
        }
        if ($profesional !== null) {
            $donde .= ' AND a.id_profesional = :profesional';
            $parametros['profesional'] = $profesional;
        }

        return [$donde, $parametros];
    }

    private function existe(string $sql, int $id): bool
    {
        $consulta = Database::conexion()->prepare($sql);
        $consulta->execute(['id' => $id]);

        return $consulta->fetchColumn() !== false;
    }
}
