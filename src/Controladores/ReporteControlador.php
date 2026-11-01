<?php

declare(strict_types=1);

namespace Turnos\Controladores;

use DateTimeImmutable;
use Turnos\Auth\Autorizacion;
use Turnos\Auth\Roles;
use Turnos\Http\Descarga;
use Turnos\Http\HttpException;
use Turnos\Reportes\ReporteRepositorio;
use Turnos\Reservas\Franjas;

// Reportes de gestión: sólo el administrador.
final class ReporteControlador
{
    private const DIAS_MAXIMOS = 366;
    private const COLUMNAS = [
        'Fila', 'Especialidad', 'Profesional', 'Turnos otorgados', 'Atendidos', 'Cancelados', 'Ausentes',
        'Pendientes de asistencia', 'Programados', 'Tasa de ausentismo (%)', 'Tasa de cancelación (%)', 'Tasa de ocupación (%)',
    ];

    private ReporteRepositorio $repositorio;

    public function __construct()
    {
        $this->repositorio = new ReporteRepositorio();
    }

    public function turnos(): array
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR);

        return $this->reporte()[0];
    }

    public function csv(): Descarga
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR);
        [$reporte, $especialidad, $profesional] = $this->reporte();

        $filas = [self::COLUMNAS];
        $filas[] = $this->fila('Resumen', $especialidad ?? 'Todas', $profesional ?? 'Todos', $reporte['totales'], $reporte['tasas']);
        foreach ($reporte['desglose'] as $fila) {
            $filas[] = $this->fila(
                'Detalle',
                $fila['especialidad']['nombre'],
                $fila['profesional']['apellido'] . ', ' . $fila['profesional']['nombre'],
                $fila,
                $fila['tasas']
            );
        }
        $contenido = "\xEF\xBB\xBF" . implode("\r\n", array_map(fn (array $f) => implode(';', array_map([$this, 'campo'], $f)), $filas)) . "\r\n";
        $periodo = $reporte['periodo'];

        return new Descarga("reporte-turnos-{$periodo['desde']}-a-{$periodo['hasta']}.csv", 'text/csv; charset=utf-8', $contenido);
    }

    // Reporte con los filtros de la consulta, más los nombres de los filtros elegidos (para el resumen del CSV).
    private function reporte(): array
    {
        $desde = $this->fecha('fecha_desde');
        $hasta = $this->fecha('fecha_hasta');
        if ($desde > $hasta) {
            throw new HttpException(400, 'datos_invalidos', 'La fecha «desde» no puede ser posterior a «hasta».');
        }
        $dias = (new DateTimeImmutable($desde))->diff(new DateTimeImmutable($hasta))->days + 1;
        if ($dias > self::DIAS_MAXIMOS) {
            throw new HttpException(400, 'datos_invalidos', 'El período no puede superar los ' . self::DIAS_MAXIMOS . ' días.');
        }

        $especialidad = $this->entero('especialidad');
        $profesional = $this->entero('profesional');
        if ($especialidad !== null && !$this->repositorio->existeEspecialidad($especialidad)) {
            throw new HttpException(400, 'datos_invalidos', 'La especialidad elegida no existe.');
        }
        if ($profesional !== null && !$this->repositorio->existeProfesional($profesional)) {
            throw new HttpException(400, 'datos_invalidos', 'El profesional elegido no existe.');
        }

        $reporte = $this->repositorio->turnos($desde, $hasta, $especialidad, $profesional);

        return [$reporte, $especialidad === null ? null : $this->nombreDeFiltro($reporte, $especialidad, 'especialidad'),
            $profesional === null ? null : $this->nombreDeFiltro($reporte, $profesional, 'profesional')];
    }

    // Nombre del filtro para el resumen: sale del desglose si tiene turnos; si no, se muestra el identificador.
    private function nombreDeFiltro(array $reporte, int $id, string $tipo): string
    {
        foreach ($reporte['desglose'] as $fila) {
            if ($fila[$tipo]['id'] === $id) {
                return $tipo === 'especialidad' ? $fila[$tipo]['nombre'] : $fila[$tipo]['apellido'] . ', ' . $fila[$tipo]['nombre'];
            }
        }

        return "#$id";
    }

    private function fila(string $tipo, string $especialidad, string $profesional, array $conteos, array $tasas): array
    {
        return [
            $tipo, $especialidad, $profesional, $conteos['otorgados'], $conteos['atendidos'], $conteos['cancelados'],
            $conteos['ausentes'], $conteos['pendientesAsistencia'], $conteos['programados'],
            $tasas['ausentismo'], $tasas['cancelacion'], $tasas['ocupacion'],
        ];
    }

    // Campo CSV: separador «;», decimales con coma y prefijo «'» a los textos que una planilla leería como fórmula.
    private function campo(mixed $valor): string
    {
        if ($valor === null) {
            return '';
        }
        if (is_float($valor)) {
            return str_replace('.', ',', (string) $valor);
        }
        $texto = (string) $valor;
        if (is_string($valor) && preg_match('/^[=+\-@\t\r]/', $texto) === 1) {
            $texto = "'" . $texto;
        }
        if (preg_match('/[";\r\n]/', $texto) === 1) {
            $texto = '"' . str_replace('"', '""', $texto) . '"';
        }

        return $texto;
    }

    private function fecha(string $clave): string
    {
        $valor = $_GET[$clave] ?? null;
        if (!is_string($valor) || !Franjas::fechaValida($valor)) {
            throw new HttpException(400, 'datos_invalidos', "Indicá «$clave» como fecha YYYY-MM-DD.");
        }

        return $valor;
    }

    private function entero(string $clave): ?int
    {
        if (!isset($_GET[$clave]) || $_GET[$clave] === '') {
            return null;
        }
        $valor = filter_var($_GET[$clave], FILTER_VALIDATE_INT);
        if ($valor === false || $valor < 1) {
            throw new HttpException(400, 'datos_invalidos', "El filtro «$clave» no es válido.");
        }

        return $valor;
    }
}
