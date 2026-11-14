<?php

declare(strict_types=1);

namespace Turnos\Auth;

// Roles del sistema con su panel y las opciones autorizadas.
// Las opciones de módulos aún no implementados se muestran como pendientes, no como funciones terminadas;
// las implementadas llevan `ruta` y se muestran como enlace.
final class Roles
{
    public const PACIENTE = 'paciente';
    public const PROFESIONAL = 'profesional';
    public const RECEPCIONISTA = 'recepcionista';
    public const ADMINISTRADOR = 'administrador';

    private const PANELES = [
        self::PACIENTE => [
            'etiqueta' => 'Paciente',
            'panel' => '/paciente.html',
            'opciones' => [
                ['nombre' => 'Mis datos personales', 'ruta' => '/datos-personales.html'],
                ['nombre' => 'Mis turnos', 'ruta' => '/turnos.html'],
            ],
        ],
        self::PROFESIONAL => [
            'etiqueta' => 'Profesional de la salud',
            'panel' => '/profesional.html',
            'opciones' => [
                ['nombre' => 'Mi agenda', 'ruta' => '/agendas.html'],
                ['nombre' => 'Mis turnos', 'ruta' => '/turnos.html'],
            ],
        ],
        self::RECEPCIONISTA => [
            'etiqueta' => 'Recepcionista',
            'panel' => '/recepcionista.html',
            'opciones' => [
                ['nombre' => 'Pacientes', 'ruta' => '/pacientes.html'],
                ['nombre' => 'Turnos', 'ruta' => '/turnos.html'],
            ],
        ],
        self::ADMINISTRADOR => [
            'etiqueta' => 'Administrador',
            'panel' => '/administrador.html',
            'opciones' => [
                ['nombre' => 'Usuarios', 'ruta' => '/usuarios.html'],
                ['nombre' => 'Especialidades', 'ruta' => '/especialidades.html'],
                ['nombre' => 'Profesionales', 'ruta' => '/profesionales.html'],
                ['nombre' => 'Pacientes', 'ruta' => '/pacientes.html'],
                ['nombre' => 'Consultorios', 'ruta' => '/consultorios.html'],
                ['nombre' => 'Agendas', 'ruta' => '/agendas.html'],
                ['nombre' => 'Turnos', 'ruta' => '/turnos.html'],
                ['nombre' => 'Reportes', 'ruta' => '/reportes.html'],
            ],
        ],
    ];

    public static function existe(string $rol): bool
    {
        return isset(self::PANELES[$rol]);
    }

    public static function panel(string $rol): string
    {
        return self::PANELES[$rol]['panel'];
    }

    public static function etiqueta(string $rol): string
    {
        return self::PANELES[$rol]['etiqueta'];
    }

    public static function opciones(string $rol): array
    {
        return self::PANELES[$rol]['opciones'];
    }
}
