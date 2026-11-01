<?php

declare(strict_types=1);

namespace Turnos\Agendas;

use PDO;
use PDOException;
use Throwable;
use Turnos\Database;
use Turnos\Http\HttpException;
use Turnos\Reservas\TurnoRepositorio;

// Agendas semanales de cada profesional. La baja es lógica (`activa`).
// Las altas y los cambios que pueden superponerse se validan dentro de una transacción con filas bloqueadas.
final class AgendaRepositorio
{
    private const SELECT = 'SELECT a.id_agenda, a.id_profesional, pe.nombre AS profesional_nombre, pe.apellido AS profesional_apellido,
        a.id_consultorio, c.numero AS consultorio_numero, a.id_especialidad, e.nombre AS especialidad_nombre, a.dia_semana,
        TIME_FORMAT(a.hora_inicio, \'%H:%i\') AS hora_inicio, TIME_FORMAT(a.hora_fin, \'%H:%i\') AS hora_fin, a.duracion_min,
        a.vigente_desde, a.vigente_hasta, a.activa
        FROM agenda a
        JOIN profesional pr ON pr.id_profesional = a.id_profesional
        JOIN persona pe ON pe.id_persona = pr.id_persona
        JOIN consultorio c ON c.id_consultorio = a.id_consultorio
        JOIN especialidad e ON e.id_especialidad = a.id_especialidad';

    public function listar(?int $profesional, ?int $consultorio, bool $soloActivas): array
    {
        $condiciones = [];
        $parametros = [];
        if ($soloActivas) {
            $condiciones[] = 'a.activa = 1';
        }
        if ($profesional !== null) {
            $condiciones[] = 'a.id_profesional = :profesional';
            $parametros['profesional'] = $profesional;
        }
        if ($consultorio !== null) {
            $condiciones[] = 'a.id_consultorio = :consultorio';
            $parametros['consultorio'] = $consultorio;
        }
        $sql = self::SELECT . ($condiciones ? ' WHERE ' . implode(' AND ', $condiciones) : '')
            . ' ORDER BY pe.apellido, pe.nombre, a.dia_semana, a.hora_inicio';
        $consulta = Database::conexion()->prepare($sql);
        $consulta->execute($parametros);

        return array_map([$this, 'normalizar'], $consulta->fetchAll());
    }

    public function buscar(int $id): ?array
    {
        $consulta = Database::conexion()->prepare(self::SELECT . ' WHERE a.id_agenda = :id');
        $consulta->execute(['id' => $id]);
        $fila = $consulta->fetch();

        return $fila === false ? null : $this->normalizar($fila);
    }

    // Id del perfil de profesional asociado a una cuenta, o null si la cuenta no tiene ese rol.
    public function idProfesionalDeUsuario(int $idUsuario): ?int
    {
        $consulta = Database::conexion()->prepare(
            'SELECT pr.id_profesional FROM profesional pr JOIN usuario u ON u.id_persona = pr.id_persona WHERE u.id_usuario = :id'
        );
        $consulta->execute(['id' => $idUsuario]);
        $id = $consulta->fetchColumn();

        return $id === false ? null : (int) $id;
    }

    // Profesionales activos con sus especialidades activas: opciones para configurar una agenda.
    public function profesionalesParaAgendar(?int $profesional): array
    {
        $sql = 'SELECT pr.id_profesional, pe.nombre, pe.apellido FROM profesional pr
            JOIN persona pe ON pe.id_persona = pr.id_persona WHERE pr.activo = 1';
        $parametros = [];
        if ($profesional !== null) {
            $sql .= ' AND pr.id_profesional = :id';
            $parametros['id'] = $profesional;
        }
        $consulta = Database::conexion()->prepare($sql . ' ORDER BY pe.apellido, pe.nombre');
        $consulta->execute($parametros);

        $especialidades = Database::conexion()->prepare(
            'SELECT e.id_especialidad, e.nombre FROM profesional_especialidad x
             JOIN especialidad e ON e.id_especialidad = x.id_especialidad
             WHERE x.id_profesional = :id AND e.activa = 1 ORDER BY e.nombre'
        );

        $resultado = [];
        foreach ($consulta->fetchAll() as $fila) {
            $especialidades->execute(['id' => $fila['id_profesional']]);
            $resultado[] = [
                'id' => (int) $fila['id_profesional'],
                'nombre' => $fila['nombre'],
                'apellido' => $fila['apellido'],
                'especialidades' => array_map(
                    fn (array $e) => ['id' => (int) $e['id_especialidad'], 'nombre' => $e['nombre']],
                    $especialidades->fetchAll()
                ),
            ];
        }

        return $resultado;
    }

    // Alta (`$id` nulo) o modificación de una agenda. `$datos` llega ya validado en forma de dominio:
    // profesional, consultorio, especialidad, dia, inicio, fin, duracion, desde y hasta (nulo = sin fin).
    // `$activar` (opcional) fija el estado al modificar: sólo lo usa la reactivación.
    public function guardar(?int $id, array $datos, ?bool $activar = null): int
    {
        $conexion = Database::conexion();
        $conexion->beginTransaction();
        try {
            // Orden fijo de bloqueo (profesional y luego consultorio): dos altas simultáneas no se cruzan.
            $profesional = $this->bloquear('profesional', 'id_profesional', $datos['profesional']);
            $consultorio = $this->bloquear('consultorio', 'id_consultorio', $datos['consultorio']);
            if ($profesional === null) {
                throw new HttpException(400, 'profesional_invalido', 'El profesional no existe.');
            }
            if (!$profesional) {
                throw new HttpException(409, 'profesional_inactivo', 'El profesional está inactivo: no se le pueden configurar agendas.');
            }
            if ($consultorio === null) {
                throw new HttpException(400, 'consultorio_invalido', 'El consultorio no existe.');
            }
            if (!$consultorio) {
                throw new HttpException(409, 'consultorio_inactivo', 'El consultorio está inactivo: no se le pueden asignar agendas.');
            }
            if (!$this->especialidadActivaDelProfesional($datos['profesional'], $datos['especialidad'])) {
                throw new HttpException(400, 'especialidad_invalida', 'La especialidad no está asignada al profesional o está inactiva: elegí una de sus especialidades activas.');
            }
            $this->validarSuperposicion($id ?? 0, $datos);
            // Editar una agenda con turnos confirmados a futuro se rechaza (409 turnos_futuros);
            // esos turnos se cancelan o reprograman antes. Así no quedan turnos fuera de la grilla ni superpuestos.
            if ($id !== null) {
                TurnoRepositorio::exigirSinTurnosFuturos('a.id_agenda = :id', ['id' => $id]);
            }

            $parametros = [
                'profesional' => $datos['profesional'], 'consultorio' => $datos['consultorio'], 'especialidad' => $datos['especialidad'],
                'dia' => $datos['dia'], 'inicio' => $datos['inicio'], 'fin' => $datos['fin'], 'duracion' => $datos['duracion'],
                'desde' => $datos['desde'], 'hasta' => $datos['hasta'],
            ];
            if ($id === null) {
                $conexion->prepare(
                    'INSERT INTO agenda (id_profesional, id_consultorio, id_especialidad, dia_semana, hora_inicio, hora_fin, duracion_min, vigente_desde, vigente_hasta, activa)
                     VALUES (:profesional, :consultorio, :especialidad, :dia, :inicio, :fin, :duracion, :desde, :hasta, 1)'
                )->execute($parametros);
                $id = (int) $conexion->lastInsertId();
            } else {
                $sql = 'UPDATE agenda SET id_profesional = :profesional, id_consultorio = :consultorio, id_especialidad = :especialidad,
                    dia_semana = :dia, hora_inicio = :inicio, hora_fin = :fin, duracion_min = :duracion,
                    vigente_desde = :desde, vigente_hasta = :hasta' . ($activar === null ? '' : ', activa = :activa') . ' WHERE id_agenda = :id';
                $conexion->prepare($sql)->execute($parametros + ['id' => $id] + ($activar === null ? [] : ['activa' => $activar ? 1 : 0]));
            }
            $conexion->commit();
        } catch (Throwable $error) {
            $conexion->rollBack();
            throw $error;
        }

        return $id;
    }

    // Desactiva en bloque las agendas activas que cumplen $donde (condición con parámetros
    // nombrados). Bloquea las filas en orden de clave primaria antes de cambiarlas, para que dos operaciones que tocan
    // las mismas agendas (desactivar especialidad, desactivar o editar profesional) no se interbloqueen.
    // Devuelve cuántas se desactivaron. Debe llamarse dentro de una transacción.
    public static function desactivarAgendas(string $donde, array $parametros): int
    {
        $conexion = Database::conexion();
        try {
            $consulta = $conexion->prepare("SELECT id_agenda FROM agenda WHERE activa = 1 AND ($donde) ORDER BY id_agenda");
            $consulta->execute($parametros);
            $ids = array_map('intval', $consulta->fetchAll(PDO::FETCH_COLUMN));
            if ($ids === []) {
                return 0;
            }
            $marcadores = implode(',', array_fill(0, count($ids), '?'));
            $conexion->prepare("SELECT id_agenda FROM agenda WHERE id_agenda IN ($marcadores) ORDER BY id_agenda FOR UPDATE")
                ->execute($ids);
            $desactivar = $conexion->prepare("UPDATE agenda SET activa = 0 WHERE activa = 1 AND id_agenda IN ($marcadores)");
            $desactivar->execute($ids);

            return $desactivar->rowCount();
        } catch (PDOException $error) {
            if (($error->errorInfo[1] ?? null) === 1213) {
                throw new HttpException(409, 'conflicto_concurrente', 'Otra operación cambió las agendas al mismo tiempo: reintentá.');
            }
            throw $error;
        }
    }

    // Desactivar no tiene más reglas. Reactivar vuelve a validar todo lo de un alta, sin contar la propia agenda.
    public function cambiarEstado(int $id, bool $activa): void
    {
        if (!$activa) {
            $this->desactivar($id);

            return;
        }

        $agenda = $this->buscar($id);
        $this->guardar($id, [
            'profesional' => $agenda['profesional']['id'],
            'consultorio' => $agenda['consultorio']['id'],
            'especialidad' => $agenda['especialidad']['id'],
            'dia' => $agenda['diaSemana'],
            'inicio' => $agenda['horaInicio'],
            'fin' => $agenda['horaFin'],
            'duracion' => $agenda['duracionMinutos'],
            'desde' => $agenda['vigenteDesde'],
            'hasta' => $agenda['vigenteHasta'],
        ], true);
    }

    // Desactivar una agenda con turnos confirmados futuros se rechaza. Bloquea profesional y consultorio en el
    // mismo orden que las reservas de turnos, para que una reserva en curso no quede sin verificar.
    private function desactivar(int $id): void
    {
        $conexion = Database::conexion();
        $conexion->beginTransaction();
        try {
            $consulta = $conexion->prepare('SELECT id_profesional, id_consultorio FROM agenda WHERE id_agenda = :id');
            $consulta->execute(['id' => $id]);
            $agenda = $consulta->fetch();
            if ($agenda !== false) {
                $this->bloquear('profesional', 'id_profesional', (int) $agenda['id_profesional']);
                $this->bloquear('consultorio', 'id_consultorio', (int) $agenda['id_consultorio']);
            }
            TurnoRepositorio::exigirSinTurnosFuturos('a.id_agenda = :id', ['id' => $id]);
            $conexion->prepare('UPDATE agenda SET activa = 0 WHERE id_agenda = :id')->execute(['id' => $id]);
            $conexion->commit();
        } catch (Throwable $error) {
            $conexion->rollBack();
            throw $error;
        }
    }

    // Dos agendas activas se superponen si coinciden en día, horario y vigencia, y comparten profesional o consultorio.
    // Un fin de vigencia nulo se compara como 9999-12-31 (sin fin). Los límites que sólo se tocan no se superponen.
    private function validarSuperposicion(int $idExcluido, array $datos): void
    {
        $base = 'SELECT COUNT(*) FROM agenda a
            WHERE a.activa = 1 AND a.id_agenda <> :excluir AND a.dia_semana = :dia
              AND a.hora_inicio < :fin AND :inicio < a.hora_fin
              AND a.vigente_desde <= :hasta AND :desde <= COALESCE(a.vigente_hasta, \'9999-12-31\')';
        $parametros = [
            'excluir' => $idExcluido, 'dia' => $datos['dia'], 'fin' => $datos['fin'], 'inicio' => $datos['inicio'],
            'hasta' => $datos['hasta'] ?? '9999-12-31', 'desde' => $datos['desde'],
        ];
        $motivos = [
            ['a.id_profesional', $datos['profesional'], 'El profesional ya tiene otra agenda que se superpone en ese día y horario.'],
            ['a.id_consultorio', $datos['consultorio'], 'El consultorio ya tiene otra agenda que se superpone en ese día y horario.'],
        ];
        foreach ($motivos as [$columna, $valor, $mensaje]) {
            $consulta = Database::conexion()->prepare("$base AND $columna = :valor");
            $consulta->execute($parametros + ['valor' => $valor]);
            if ((int) $consulta->fetchColumn() > 0) {
                throw new HttpException(409, 'agenda_superpuesta', $mensaje);
            }
        }
    }

    // Devuelve si la fila está activa, o null si no existe. Bloquea la fila hasta cerrar la transacción.
    private function bloquear(string $tabla, string $clave, int $id): ?bool
    {
        $consulta = Database::conexion()->prepare("SELECT activo FROM $tabla WHERE $clave = :id FOR UPDATE");
        $consulta->execute(['id' => $id]);
        $activo = $consulta->fetchColumn();

        return $activo === false ? null : (bool) $activo;
    }

    // FOR SHARE: si otra operación está desactivando la especialidad, esta alta espera a que confirme y ve `activa = 0`.
    // Así no queda una agenda activa con especialidad inactiva.
    private function especialidadActivaDelProfesional(int $profesional, int $especialidad): bool
    {
        $consulta = Database::conexion()->prepare(
            'SELECT 1 FROM profesional_especialidad x JOIN especialidad e ON e.id_especialidad = x.id_especialidad
             WHERE x.id_profesional = :profesional AND x.id_especialidad = :especialidad AND e.activa = 1 FOR SHARE'
        );
        $consulta->execute(['profesional' => $profesional, 'especialidad' => $especialidad]);

        return $consulta->fetchColumn() !== false;
    }

    private function normalizar(array $fila): array
    {
        return [
            'id' => (int) $fila['id_agenda'],
            'profesional' => [
                'id' => (int) $fila['id_profesional'],
                'nombre' => $fila['profesional_nombre'],
                'apellido' => $fila['profesional_apellido'],
            ],
            'consultorio' => ['id' => (int) $fila['id_consultorio'], 'numero' => $fila['consultorio_numero']],
            'especialidad' => ['id' => (int) $fila['id_especialidad'], 'nombre' => $fila['especialidad_nombre']],
            'diaSemana' => (int) $fila['dia_semana'],
            'horaInicio' => $fila['hora_inicio'],
            'horaFin' => $fila['hora_fin'],
            'duracionMinutos' => (int) $fila['duracion_min'],
            'vigenteDesde' => $fila['vigente_desde'],
            'vigenteHasta' => $fila['vigente_hasta'],
            'activa' => (bool) $fila['activa'],
        ];
    }
}
