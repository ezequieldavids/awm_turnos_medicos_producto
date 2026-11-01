<?php

declare(strict_types=1);

namespace Turnos\Controladores;

use Turnos\Auth\Autorizacion;
use Turnos\Auth\Roles;
use Turnos\Http\HttpException;
use Turnos\Http\Solicitud;
use Turnos\Pacientes\PacienteRepositorio;
use Turnos\Personas\DatosPersona;

// Gestión de pacientes (TUR-003): administrador y recepcionista.
final class PacienteControlador
{
    private PacienteRepositorio $repositorio;

    public function __construct()
    {
        $this->repositorio = new PacienteRepositorio();
    }

    public function listar(): array
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR, Roles::RECEPCIONISTA);
        $todos = ($_GET['estado'] ?? 'activos') === 'todos';
        $texto = DatosPersona::texto($_GET['q'] ?? '');

        return ['pacientes' => $this->repositorio->listar(!$todos, $texto)];
    }

    public function obtener(int $id): array
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR, Roles::RECEPCIONISTA);

        return ['paciente' => $this->existente($id)];
    }

    // Autoconsulta del paciente (TUR-010, Q-1 y Q-3): sólo lectura; el registro sale de la sesión, sin identificador en la petición.
    public function misDatos(): array
    {
        $usuario = Autorizacion::exigirRol(Roles::PACIENTE);
        $paciente = $this->repositorio->buscarDeUsuario($usuario['id'])
            ?? throw new HttpException(404, 'no_encontrado', 'No encontramos tus datos de paciente.');

        return ['datos' => [
            'dni' => $paciente['dni'],
            'nombre' => $paciente['nombre'],
            'apellido' => $paciente['apellido'],
            'telefono' => $paciente['telefono'],
            'email' => $paciente['email'],
            'fechaNacimiento' => $paciente['fechaNacimiento'],
            'obraSocial' => $paciente['obraSocial'],
        ]];
    }

    public function crear(): array
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR, Roles::RECEPCIONISTA);
        [$persona, $obraSocial] = $this->datos(true);

        $id = $this->repositorio->crear($persona, $obraSocial);
        http_response_code(201);

        return ['paciente' => $this->existente($id)];
    }

    public function modificar(int $id): array
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR, Roles::RECEPCIONISTA);
        $this->existente($id);
        [$persona, $obraSocial] = $this->datos(false);

        $this->repositorio->modificar($id, $persona, $obraSocial);

        return ['paciente' => $this->existente($id)];
    }

    public function cambiarEstado(int $id): array
    {
        Autorizacion::exigirRol(Roles::ADMINISTRADOR, Roles::RECEPCIONISTA);
        $this->existente($id);
        $cuerpo = Solicitud::cuerpoJson();
        if (!isset($cuerpo['activo']) || !is_bool($cuerpo['activo'])) {
            throw new HttpException(400, 'datos_invalidos', 'Indicá si el paciente queda activo (true) o inactivo (false).');
        }

        $this->repositorio->cambiarEstado($id, $cuerpo['activo']);

        return ['paciente' => $this->existente($id)];
    }

    /** @return array{0: array, 1: ?string} */
    private function datos(bool $conDni): array
    {
        $cuerpo = Solicitud::cuerpoJson();

        return [
            DatosPersona::desde($cuerpo, $conDni, true),
            DatosPersona::opcional($cuerpo['obraSocial'] ?? null, 100, 'obra_social_invalida', 'La obra social'),
        ];
    }

    private function existente(int $id): array
    {
        return $this->repositorio->buscar($id) ?? throw new HttpException(404, 'no_encontrado', 'El paciente no existe.');
    }
}
