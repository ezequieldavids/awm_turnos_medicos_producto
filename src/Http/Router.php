<?php

declare(strict_types=1);

namespace Turnos\Http;

use Closure;

// Router mínimo: ruta → método HTTP → acción que devuelve un arreglo JSON.
// Una ruta puede llevar parámetros numéricos con la forma {nombre}; la acción los recibe como argumentos.
final class Router
{
    /** @var array<string, array<string, Closure>> */
    private array $rutas = [];

    public function get(string $ruta, Closure $accion): void
    {
        $this->rutas[$ruta]['GET'] = $accion;
    }

    public function post(string $ruta, Closure $accion): void
    {
        $this->rutas[$ruta]['POST'] = $accion;
    }

    public function put(string $ruta, Closure $accion): void
    {
        $this->rutas[$ruta]['PUT'] = $accion;
    }

    public function despachar(string $metodo, string $ruta): array|Descarga
    {
        $parametros = [];
        $metodos = $this->rutas[$ruta] ?? null;

        if ($metodos === null) {
            foreach ($this->rutas as $patron => $candidatos) {
                $expresion = '#^' . preg_replace('#\{[a-z_]+\}#', '(\d+)', $patron) . '$#';
                if ($expresion !== '#^' . $patron . '$#' && preg_match($expresion, $ruta, $coincidencias) === 1) {
                    $metodos = $candidatos;
                    $parametros = array_map('intval', array_slice($coincidencias, 1));
                    break;
                }
            }
        }

        if ($metodos === null) {
            throw new HttpException(404, 'no_encontrado', 'El recurso solicitado no existe.');
        }

        if (!isset($metodos[$metodo])) {
            throw new HttpException(405, 'metodo_no_permitido', 'El método no está permitido para este recurso.');
        }

        return ($metodos[$metodo])(...$parametros);
    }
}
