<?php

declare(strict_types=1);

namespace Turnos\Controladores;

use Turnos\Auth\Autorizacion;
use Turnos\Auth\Roles;
use Turnos\Http\HttpException;
use Turnos\Http\Solicitud;
use Turnos\Personas\DatosPersona;
use Turnos\Usuarios\CuentaRepositorio;

// Administración de cuentas de acceso y roles (TUR-005): sólo el administrador.
final class UsuarioControlador
{
    private CuentaRepositorio $repositorio;

    public function __construct()
    {
        $this->repositorio = new CuentaRepositorio();
    }

    public function listar(): array
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR);
        $estado = $_GET['estado'] ?? 'todos';
        if (!in_array($estado, ['todos', 'activos', 'inactivos'], true)) {
            throw new HttpException(400, 'estado_invalido', 'El filtro de estado no es válido.');
        }

        return ['usuarios' => $this->repositorio->listar($estado, DatosPersona::texto($_GET['q'] ?? ''))];
    }

    public function obtener(int $id): array
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR);

        return ['usuario' => $this->existente($id)];
    }

    public function crear(): array
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR);
        $cuerpo = Solicitud::cuerpoJson();
        $dni = DatosPersona::texto($cuerpo['dni'] ?? null);
        if (!preg_match('/^\d{7,8}$/', $dni)) {
            throw new HttpException(400, 'dni_invalido', 'El DNI debe tener 7 u 8 dígitos.');
        }

        $id = $this->repositorio->crear(
            ['dni' => $dni, 'nombre' => $cuerpo['nombre'] ?? null, 'apellido' => $cuerpo['apellido'] ?? null],
            $this->rol($cuerpo),
            $this->hashContrasena($cuerpo),
            array_key_exists('activo', $cuerpo) ? $this->activo($cuerpo) : true,
        );
        http_response_code(201);

        return ['usuario' => $this->existente($id)];
    }

    public function cambiarRol(int $id): array
    {
        $actor = Autorizacion::exigirRol(Roles::ADMINISTRADOR);
        $this->repositorio->cambiarRol($id, $this->rol(Solicitud::cuerpoJson()), $actor['id']);

        return ['usuario' => $this->existente($id)];
    }

    public function cambiarEstado(int $id): array
    {
        $actor = Autorizacion::exigirRol(Roles::ADMINISTRADOR);
        $this->repositorio->cambiarEstado($id, $this->activo(Solicitud::cuerpoJson()), $actor['id']);

        return ['usuario' => $this->existente($id)];
    }

    public function restablecerContrasena(int $id): array
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR);
        $this->repositorio->cambiarContrasena($id, $this->hashContrasena(Solicitud::cuerpoJson()));

        return ['usuario' => $this->existente($id)];
    }

    private function rol(array $cuerpo): string
    {
        $rol = $cuerpo['rol'] ?? null;
        if (!is_string($rol) || !Roles::existe($rol)) {
            throw new HttpException(400, 'rol_invalido', 'Elegí un rol válido: paciente, profesional, recepcionista o administrador.');
        }

        return $rol;
    }

    private function activo(array $cuerpo): bool
    {
        if (!is_bool($cuerpo['activo'] ?? null)) {
            throw new HttpException(400, 'activo_invalido', 'Indicá si la cuenta queda activa (true) o inactiva (false).');
        }

        return $cuerpo['activo'];
    }

    // Contraseña de 8 a 72 bytes (límite de bcrypt). Se guarda sólo el hash, nunca el valor (DEC-005, RNF-01).
    private function hashContrasena(array $cuerpo): string
    {
        $contrasena = $cuerpo['contrasena'] ?? null;
        if (!is_string($contrasena) || mb_strlen($contrasena) < 8 || strlen($contrasena) > 72) {
            throw new HttpException(400, 'contrasena_invalida', 'La contraseña debe tener al menos 8 caracteres y como máximo 72 bytes.');
        }

        return password_hash($contrasena, PASSWORD_BCRYPT, ['cost' => 12]);
    }

    private function existente(int $id): array
    {
        return $this->repositorio->buscar($id) ?? throw new HttpException(404, 'no_encontrado', 'La cuenta no existe.');
    }
}
