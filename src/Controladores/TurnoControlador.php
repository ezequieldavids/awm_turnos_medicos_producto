<?php

declare(strict_types=1);

namespace Turnos\Controladores;

use Turnos\Agendas\AgendaRepositorio;
use Turnos\Auth\Autorizacion;
use Turnos\Auth\Roles;
use Turnos\Http\HttpException;
use Turnos\Http\Solicitud;
use Turnos\Reservas\Franjas;
use Turnos\Reservas\TurnoRepositorio;

// Turnos médicos (TUR-007, CU-03 y CU-04). El paciente reserva, cancela y reprograma sólo los suyos; la recepción y el
// administrador, cualquiera; el profesional sólo lee los turnos de sus agendas.
final class TurnoControlador
{
    private const TODOS = [Roles::PACIENTE, Roles::PROFESIONAL, Roles::RECEPCIONISTA, Roles::ADMINISTRADOR];
    private const GESTIONAN = [Roles::PACIENTE, Roles::RECEPCIONISTA, Roles::ADMINISTRADOR];
    // Registran la asistencia (TUR-006): el profesional en sus turnos; recepción y administrador en cualquiera.
    private const REGISTRAN_ASISTENCIA = [Roles::PROFESIONAL, Roles::RECEPCIONISTA, Roles::ADMINISTRADOR];

    private TurnoRepositorio $repositorio;
    private AgendaRepositorio $agendas;

    public function __construct()
    {
        $this->repositorio = new TurnoRepositorio();
        $this->agendas = new AgendaRepositorio();
    }

    public function listar(): array
    {
        $usuario = Autorizacion::exigirRol(...self::TODOS);
        $alcance = $this->alcance($usuario);
        $paciente = $this->combinar($alcance['paciente'], $this->filtroEntero('paciente'));
        $profesional = $this->combinar($alcance['profesional'], $this->filtroEntero('profesional'));

        $estado = $_GET['estado'] ?? null;
        if ($estado !== null && !in_array($estado, ['confirmado', 'atendido', 'ausente', 'cancelado'], true)) {
            throw new HttpException(400, 'datos_invalidos', 'El filtro «estado» debe ser confirmado, atendido, ausente o cancelado.');
        }

        return ['turnos' => $this->repositorio->listar(
            $paciente,
            $profesional,
            $this->filtroFecha('desde'),
            $this->filtroFecha('hasta'),
            $estado
        )];
    }

    public function obtener(int $id): array
    {
        $usuario = Autorizacion::exigirRol(...self::TODOS);
        $turno = $this->existente($id);
        $this->autorizarTurno($this->alcance($usuario), $turno);

        return ['turno' => $turno];
    }

    public function reservar(): array
    {
        $usuario = Autorizacion::exigirRol(...self::GESTIONAN);
        $cuerpo = Solicitud::cuerpoJson();

        $paciente = $this->alcance($usuario)['paciente'];
        if ($paciente === null) {
            // Recepción y administrador eligen el paciente; el paciente reserva sólo para sí mismo.
            $paciente = $this->entero($cuerpo, 'paciente');
        } elseif (array_key_exists('paciente', $cuerpo) && filter_var($cuerpo['paciente'], FILTER_VALIDATE_INT) !== $paciente) {
            throw new HttpException(403, 'no_autorizado', 'Sólo podés reservar turnos para vos.');
        }

        $id = $this->repositorio->reservar(
            $paciente,
            $this->entero($cuerpo, 'agenda'),
            $this->fecha($cuerpo, 'fecha'),
            $this->hora($cuerpo, 'horaInicio'),
            $this->motivo($cuerpo)
        );
        http_response_code(201);

        return ['turno' => $this->existente($id)];
    }

    public function reprogramar(int $id): array
    {
        $usuario = Autorizacion::exigirRol(...self::GESTIONAN);
        $this->autorizarTurno($this->alcance($usuario), $this->existente($id));
        $cuerpo = Solicitud::cuerpoJson();

        $this->repositorio->reprogramar(
            $id,
            $this->entero($cuerpo, 'agenda'),
            $this->fecha($cuerpo, 'fecha'),
            $this->hora($cuerpo, 'horaInicio')
        );

        return ['turno' => $this->existente($id)];
    }

    // Cambios de estado: cancelar (paciente, recepción, administrador) y registrar la asistencia, atendido o ausente
    // (profesional, recepción, administrador). Reprogramar tiene su propia ruta.
    public function cambiarEstado(int $id): array
    {
        $usuario = Autorizacion::exigirRol(...self::TODOS);
        $turno = $this->existente($id);
        $cuerpo = Solicitud::cuerpoJson();
        $estado = $cuerpo['estado'] ?? null;

        if ($estado === 'cancelado') {
            Autorizacion::exigirRol(...self::GESTIONAN);
            $this->autorizarTurno($this->alcance($usuario), $turno);
            $this->repositorio->cancelar($id);
        } elseif ($estado === 'atendido' || $estado === 'ausente') {
            Autorizacion::exigirRol(...self::REGISTRAN_ASISTENCIA);
            $this->autorizarTurno($this->alcance($usuario), $turno);
            $this->repositorio->registrarAsistencia($id, $estado);
        } elseif ($estado === 'confirmado') {
            Autorizacion::exigirRol(...self::GESTIONAN);
            $this->autorizarTurno($this->alcance($usuario), $turno);
            throw new HttpException(409, 'transicion_invalida', 'Un turno no vuelve a «confirmado».');
        } else {
            throw new HttpException(400, 'datos_invalidos', 'Indicá estado «cancelado», «atendido» o «ausente».');
        }

        return ['turno' => $this->existente($id)];
    }

    // Alcance del rol autenticado: id del paciente o del profesional propio, o null si el rol ve todo.
    private function alcance(array $usuario): array
    {
        if ($usuario['rol'] === Roles::PACIENTE) {
            return [
                'paciente' => $this->repositorio->pacienteDeUsuario($usuario['id'])
                    ?? throw new HttpException(403, 'no_autorizado', 'Tu cuenta no tiene un perfil de paciente.'),
                'profesional' => null,
            ];
        }
        if ($usuario['rol'] === Roles::PROFESIONAL) {
            return [
                'paciente' => null,
                'profesional' => $this->agendas->idProfesionalDeUsuario($usuario['id'])
                    ?? throw new HttpException(403, 'no_autorizado', 'Tu cuenta no tiene un perfil de profesional.'),
            ];
        }

        return ['paciente' => null, 'profesional' => null];
    }

    private function autorizarTurno(array $alcance, array $turno): void
    {
        $ajeno = ($alcance['paciente'] !== null && $turno['paciente']['id'] !== $alcance['paciente'])
            || ($alcance['profesional'] !== null && $turno['profesional']['id'] !== $alcance['profesional']);
        if ($ajeno) {
            throw new HttpException(403, 'no_autorizado', 'Este turno no es tuyo ni de tus agendas.');
        }
    }

    // Un filtro pedido que contradice el alcance propio se rechaza; sin alcance propio, el filtro pedido se usa tal cual.
    private function combinar(?int $propio, ?int $pedido): ?int
    {
        if ($propio !== null && $pedido !== null && $pedido !== $propio) {
            throw new HttpException(403, 'no_autorizado', 'Tu rol no tiene acceso a esos turnos.');
        }

        return $propio ?? $pedido;
    }

    private function existente(int $id): array
    {
        return $this->repositorio->buscar($id)
            ?? throw new HttpException(404, 'turno_no_encontrado', 'El turno no existe.');
    }

    private function filtroEntero(string $clave): ?int
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

    private function filtroFecha(string $clave): ?string
    {
        if (!isset($_GET[$clave]) || $_GET[$clave] === '') {
            return null;
        }
        if (!Franjas::fechaValida($_GET[$clave])) {
            throw new HttpException(400, 'datos_invalidos', "El filtro «$clave» debe ser una fecha YYYY-MM-DD.");
        }

        return $_GET[$clave];
    }

    private function entero(array $cuerpo, string $campo): int
    {
        $valor = filter_var($cuerpo[$campo] ?? null, FILTER_VALIDATE_INT);
        if ($valor === false || $valor < 1) {
            throw new HttpException(400, 'datos_invalidos', "El campo «$campo» es obligatorio y debe ser un número válido.");
        }

        return $valor;
    }

    private function fecha(array $cuerpo, string $campo): string
    {
        $valor = $cuerpo[$campo] ?? null;
        if (!is_string($valor) || !Franjas::fechaValida($valor)) {
            throw new HttpException(400, 'datos_invalidos', 'Indicá una fecha válida (YYYY-MM-DD).');
        }

        return $valor;
    }

    private function hora(array $cuerpo, string $campo): string
    {
        $valor = $cuerpo[$campo] ?? null;
        if (!is_string($valor) || !Franjas::horaValida($valor)) {
            throw new HttpException(400, 'datos_invalidos', 'Indicá un horario de inicio válido (HH:MM).');
        }

        return $valor;
    }

    private function motivo(array $cuerpo): ?string
    {
        $valor = $cuerpo['motivo'] ?? null;
        if ($valor === null || trim((string) $valor) === '') {
            return null;
        }
        $texto = trim((string) $valor);
        if (mb_strlen($texto) > 255) {
            throw new HttpException(400, 'datos_invalidos', 'El motivo no puede superar los 255 caracteres.');
        }

        return $texto;
    }
}
