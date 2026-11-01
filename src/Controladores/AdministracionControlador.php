<?php

declare(strict_types=1);

namespace Turnos\Controladores;

use Turnos\Auth\Autorizacion;
use Turnos\Auth\Roles;

// Recurso de ejemplo reservado al administrador (AC-004). Sirve para comprobar el control por rol;
// no es un módulo de administración de usuarios (TUR-005).
final class AdministracionControlador
{
    public function resumen(): array
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR);

        return [
            'recurso' => 'administracion',
            'mensaje' => 'Recurso reservado al rol administrador.',
        ];
    }
}
