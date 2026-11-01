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
                ['nombre' => 'Mis datos personales', 'feature' => 'TUR-010', 'ruta' => '/datos-personales.html'],
                ['nombre' => 'Mis turnos', 'feature' => 'TUR-007', 'ruta' => '/turnos.html'],
            ],
        ],
        self::PROFESIONAL => [
            'etiqueta' => 'Profesional de la salud',
            'panel' => '/profesional.html',
            'opciones' => [
                ['nombre' => 'Mi agenda', 'feature' => 'TUR-004', 'ruta' => '/agendas.html'],
                ['nombre' => 'Mis turnos', 'feature' => 'TUR-007', 'ruta' => '/turnos.html'],
            ],
        ],
        self::RECEPCIONISTA => [
            'etiqueta' => 'Recepcionista',
            'panel' => '/recepcionista.html',
            'opciones' => [
                ['nombre' => 'Pacientes', 'feature' => 'TUR-003', 'ruta' => '/pacientes.html'],
                ['nombre' => 'Turnos', 'feature' => 'TUR-007', 'ruta' => '/turnos.html'],
            ],
        ],
        self::ADMINISTRADOR => [
            'etiqueta' => 'Administrador',
            'panel' => '/administrador.html',
            'opciones' => [
                ['nombre' => 'Usuarios', 'feature' => 'TUR-005', 'ruta' => '/usuarios.html'],
                ['nombre' => 'Especialidades', 'feature' => 'TUR-002', 'ruta' => '/especialidades.html'],
                ['nombre' => 'Profesionales', 'feature' => 'TUR-003', 'ruta' => '/profesionales.html'],
                ['nombre' => 'Pacientes', 'feature' => 'TUR-003', 'ruta' => '/pacientes.html'],
                ['nombre' => 'Consultorios', 'feature' => 'TUR-004', 'ruta' => '/consultorios.html'],
                ['nombre' => 'Agendas', 'feature' => 'TUR-004', 'ruta' => '/agendas.html'],
                ['nombre' => 'Turnos', 'feature' => 'TUR-007', 'ruta' => '/turnos.html'],
                ['nombre' => 'Reportes', 'feature' => 'TUR-006', 'ruta' => '/reportes.html'],
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
