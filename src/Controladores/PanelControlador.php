<?php

declare(strict_types=1);

namespace Turnos\Controladores;

use Turnos\Auth\Autorizacion;
use Turnos\Auth\Roles;

final class PanelControlador
{
    // Datos del panel del rol autenticado: sólo sus opciones autorizadas.
    public function panel(): array
    {
        $usuario = Autorizacion::exigirSesion();

        return [
            'usuario' => [
                'nombre' => $usuario['nombre'],
                'apellido' => $usuario['apellido'],
                'rol' => $usuario['rol'],
                'etiqueta' => Roles::etiqueta($usuario['rol']),
            ],
            'panel' => Roles::panel($usuario['rol']),
            'opciones' => Roles::opciones($usuario['rol']),
        ];
    }
}
