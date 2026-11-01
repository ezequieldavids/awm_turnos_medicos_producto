<?php

declare(strict_types=1);

namespace Turnos\Controladores;

use Turnos\Auth\Autenticacion;
use Turnos\Auth\Autorizacion;
use Turnos\Auth\GestorSesion;
use Turnos\Auth\Roles;
use Turnos\Auth\UsuarioRepositorio;
use Turnos\Http\HttpException;
use Turnos\Http\Solicitud;

final class AutenticacionControlador
{
    public function login(): array
    {
        $datos = Solicitud::cuerpoJson();
        $dni = is_string($datos['dni'] ?? null) ? preg_replace('/[\s.]/', '', $datos['dni']) : '';
        $password = is_string($datos['password'] ?? null) ? $datos['password'] : '';

        if (!preg_match('/^\d{7,8}$/', $dni) || $password === '' || strlen($password) > 255) {
            throw new HttpException(400, 'datos_invalidos', 'Ingresá un DNI de 7 u 8 dígitos y tu contraseña.');
        }

        $cuenta = (new Autenticacion(new UsuarioRepositorio()))->verificar($dni, $password);
        if ($cuenta === null) {
            throw new HttpException(
                401,
                'credenciales_invalidas',
                'No pudimos iniciar sesión con esos datos. Revisá el DNI y la contraseña.'
            );
        }

        GestorSesion::abrir($cuenta);

        return [
            'usuario' => $this->usuarioPublico(GestorSesion::usuario()),
            'panel' => Roles::panel($cuenta['rol']),
        ];
    }

    public function logout(): array
    {
        Autorizacion::exigirSesion();
        GestorSesion::cerrar();

        return ['cerrada' => true];
    }

    public function sesion(): array
    {
        $usuario = Autorizacion::exigirSesion();

        return [
            'usuario' => $this->usuarioPublico($usuario),
            'panel' => Roles::panel($usuario['rol']),
            // Única fuente del límite para el navegador (TUR-008, AC-007).
            'inactividadSegundos' => GestorSesion::limiteInactividad(),
        ];
    }

    private function usuarioPublico(array $usuario): array
    {
        return [
            'nombre' => $usuario['nombre'],
            'apellido' => $usuario['apellido'],
            'rol' => $usuario['rol'],
            'etiqueta' => Roles::etiqueta($usuario['rol']),
        ];
    }
}
