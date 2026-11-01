<?php

declare(strict_types=1);

namespace Turnos\Reservas;

use DateTimeImmutable;
use PDO;
use PDOException;
use Throwable;
use Turnos\Database;
use Turnos\Http\HttpException;

// Turnos médicos. Un turno ocupa una franja de una agenda; cancelarlo cambia `estado`.
// Reservar, reprogramar y cancelar se hacen en una transacción. Las altas y los cambios bloquean en este orden:
// paciente, profesional y consultorio; en reservas y reprogramaciones, después la especialidad (bloquearEspecialidad) y
// luego la agenda; al cancelar, el turno. Así dos operaciones sobre la misma franja no se cruzan. Las desactivaciones de
// especialidades, profesionales y consultorios bloquean profesional o consultorio, o la especialidad antes que las agendas.
final class TurnoRepositorio
{
    private const SELECT = 'SELECT t.id_turno, t.fecha, TIME_FORMAT(t.hora_inicio, \'%H:%i\') AS hora_inicio,
        TIME_FORMAT(t.hora_fin, \'%H:%i\') AS hora_fin, t.estado, t.motivo,
        pa.id_paciente, pe.dni, pe.nombre AS paciente_nombre, pe.apellido AS paciente_apellido, pe.telefono,
        pe.email, pe.fecha_nacimiento, pa.obra_social,
        a.id_agenda, a.id_profesional, pp.nombre AS profesional_nombre, pp.apellido AS profesional_apellido,
        a.id_consultorio, c.numero AS consultorio_numero, a.id_especialidad, e.nombre AS especialidad_nombre
        FROM turno t
        JOIN paciente pa ON pa.id_paciente = t.id_paciente
        JOIN persona pe ON pe.id_persona = pa.id_persona
        JOIN agenda a ON a.id_agenda = t.id_agenda
        JOIN profesional pr ON pr.id_profesional = a.id_profesional
        JOIN persona pp ON pp.id_persona = pr.id_persona
        JOIN consultorio c ON c.id_consultorio = a.id_consultorio
        JOIN especialidad e ON e.id_especialidad = a.id_especialidad';

    // Reloj único del módulo: las comparaciones de «pasado» y «futuro» usan siempre la hora del servidor.
    public static function ahora(): string
    {
        return (new DateTimeImmutable('now'))->format('Y-m-d H:i:s');
    }

    // Id del perfil de paciente asociado a una cuenta, o null si la cuenta no tiene ese rol.
    public function pacienteDeUsuario(int $idUsuario): ?int
    {
        $consulta = Database::conexion()->prepare(
            'SELECT pa.id_paciente FROM paciente pa JOIN usuario u ON u.id_persona = pa.id_persona WHERE u.id_usuario = :id'
        );
        $consulta->execute(['id' => $idUsuario]);
        $id = $consulta->fetchColumn();

        return $id === false ? null : (int) $id;
    }

    public function listar(?int $paciente, ?int $profesional, ?string $desde, ?string $hasta, ?string $estado): array
    {
        $condiciones = [];
        $parametros = [];
        if ($paciente !== null) {
            $condiciones[] = 't.id_paciente = :paciente';
            $parametros['paciente'] = $paciente;
        }
        if ($profesional !== null) {
            $condiciones[] = 'a.id_profesional = :profesional';
            $parametros['profesional'] = $profesional;
        }
        if ($desde !== null) {
            $condiciones[] = 't.fecha >= :desde';
            $parametros['desde'] = $desde;
        }
        if ($hasta !== null) {
            $condiciones[] = 't.fecha <= :hasta';
            $parametros['hasta'] = $hasta;
        }
        if ($estado !== null) {
            $condiciones[] = 't.estado = :estado';
            $parametros['estado'] = $estado;
        }
        $sql = self::SELECT . ($condiciones ? ' WHERE ' . implode(' AND ', $condiciones) : '')
            . ' ORDER BY t.fecha, t.hora_inicio, t.id_turno';
        $consulta = Database::conexion()->prepare($sql);
        $consulta->execute($parametros);

        return array_map([$this, 'normalizar'], $consulta->fetchAll());
    }

    public function buscar(int $id): ?array
    {
        $consulta = Database::conexion()->prepare(self::SELECT . ' WHERE t.id_turno = :id');
        $consulta->execute(['id' => $id]);
        $fila = $consulta->fetch();

        return $fila === false ? null : $this->normalizar($fila);
    }

    // Franjas libres de agendas activas (profesional, consultorio, especialidad y vigencia activos) entre dos fechas
    // inclusive. Se excluyen las franjas ya pasadas y las que se superponen con un turno confirmado del profesional o del consultorio.
    public function disponibilidad(int $especialidad, string $desde, string $hasta, ?int $profesional): array
    {
        $sql = 'SELECT a.id_agenda, a.id_profesional, pe.nombre AS profesional_nombre, pe.apellido AS profesional_apellido,
            a.id_consultorio, c.numero AS consultorio_numero, a.id_especialidad, e.nombre AS especialidad_nombre,
            a.dia_semana, TIME_FORMAT(a.hora_inicio, \'%H:%i\') AS hora_inicio, TIME_FORMAT(a.hora_fin, \'%H:%i\') AS hora_fin,
            a.duracion_min, a.vigente_desde, a.vigente_hasta
            FROM agenda a
            JOIN profesional pr ON pr.id_profesional = a.id_profesional
            JOIN persona pe ON pe.id_persona = pr.id_persona
            JOIN consultorio c ON c.id_consultorio = a.id_consultorio
            JOIN especialidad e ON e.id_especialidad = a.id_especialidad
            WHERE a.activa = 1 AND pr.activo = 1 AND c.activo = 1 AND e.activa = 1 AND a.id_especialidad = :especialidad
              AND a.vigente_desde <= :hasta AND COALESCE(a.vigente_hasta, \'9999-12-31\') >= :desde';
        $parametros = ['especialidad' => $especialidad, 'desde' => $desde, 'hasta' => $hasta];
        if ($profesional !== null) {
            $sql .= ' AND a.id_profesional = :profesional';
            $parametros['profesional'] = $profesional;
        }
        $consulta = Database::conexion()->prepare($sql);
        $consulta->execute($parametros);
        $agendas = $consulta->fetchAll();

        $ocupaciones = $this->ocupaciones($desde, $hasta);
        $ahora = self::ahora();
        $franjas = [];
        $fin = new DateTimeImmutable($hasta);
        for ($dia = new DateTimeImmutable($desde); $dia <= $fin; $dia = $dia->modify('+1 day')) {
            $fecha = $dia->format('Y-m-d');
            $numeroDia = (int) $dia->format('N');
            foreach ($agendas as $agenda) {
                if ((int) $agenda['dia_semana'] !== $numeroDia || $fecha < $agenda['vigente_desde']
                    || ($agenda['vigente_hasta'] !== null && $fecha > $agenda['vigente_hasta'])) {
                    continue;
                }
                $duracion = (int) $agenda['duracion_min'];
                $limite = Franjas::minutos($agenda['hora_fin']);
                for ($inicio = Franjas::minutos($agenda['hora_inicio']); $inicio + $duracion <= $limite; $inicio += $duracion) {
                    $final = $inicio + $duracion;
                    if ($fecha . ' ' . Franjas::hora($inicio) . ':00' <= $ahora) {
                        continue;
                    }
                    if (Franjas::ocupada($ocupaciones[$fecha] ?? [], (int) $agenda['id_profesional'], (int) $agenda['id_consultorio'], $inicio, $final)) {
                        continue;
                    }
                    $franjas[] = [
                        'idAgenda' => (int) $agenda['id_agenda'],
                        'fecha' => $fecha,
                        'horaInicio' => Franjas::hora($inicio),
                        'horaFin' => Franjas::hora($final),
                        'profesional' => [
                            'id' => (int) $agenda['id_profesional'],
                            'nombre' => $agenda['profesional_nombre'],
                            'apellido' => $agenda['profesional_apellido'],
                        ],
                        'consultorio' => ['id' => (int) $agenda['id_consultorio'], 'numero' => $agenda['consultorio_numero']],
                        'especialidad' => ['id' => (int) $agenda['id_especialidad'], 'nombre' => $agenda['especialidad_nombre']],
                    ];
                }
            }
        }

        usort($franjas, fn (array $a, array $b) => [$a['fecha'], $a['horaInicio'], $a['profesional']['apellido']]
            <=> [$b['fecha'], $b['horaInicio'], $b['profesional']['apellido']]);

        return $franjas;
    }

    public function reservar(int $paciente, int $agenda, string $fecha, string $inicio, ?string $motivo): int
    {
        return $this->transaccion(function (PDO $conexion) use ($paciente, $agenda, $fecha, $inicio, $motivo): int {
            $cabecera = $this->agendaCruda($agenda)
                ?? throw new HttpException(400, 'agenda_invalida', 'La agenda no existe.');
            $this->bloquearPaciente($paciente);
            $this->bloquearFila('profesional', 'id_profesional', (int) $cabecera['id_profesional']);
            $this->bloquearFila('consultorio', 'id_consultorio', (int) $cabecera['id_consultorio']);
            $this->bloquearEspecialidad((int) $cabecera['id_especialidad']);

            $estado = $this->agendaParaTurno($agenda);
            $fin = $this->validarFranja($estado, $fecha, $inicio);
            $this->exigirLibre($estado, $paciente, $fecha, $inicio, $fin, 0);

            $conexion->prepare(
                'INSERT INTO turno (id_paciente, id_agenda, fecha, hora_inicio, hora_fin, estado, motivo)
                 VALUES (:paciente, :agenda, :fecha, :inicio, :fin, \'confirmado\', :motivo)'
            )->execute([
                'paciente' => $paciente, 'agenda' => $agenda, 'fecha' => $fecha,
                'inicio' => $inicio . ':00', 'fin' => $fin . ':00', 'motivo' => $motivo,
            ]);

            return (int) $conexion->lastInsertId();
        });
    }

    // Cambia la franja del mismo turno (conserva id, paciente y motivo). La franja anterior queda libre en la misma transacción.
    public function reprogramar(int $id, int $agenda, string $fecha, string $inicio): void
    {
        $this->transaccion(function (PDO $conexion) use ($id, $agenda, $fecha, $inicio): void {
            $actual = $this->turnoCrudo($id) ?? throw new HttpException(404, 'turno_no_encontrado', 'El turno no existe.');
            $this->bloquearPaciente((int) $actual['id_paciente']);
            $cabecera = $this->agendaCruda($agenda)
                ?? throw new HttpException(400, 'agenda_invalida', 'La agenda no existe.');
            $this->bloquearFila('profesional', 'id_profesional', (int) $cabecera['id_profesional']);
            $this->bloquearFila('consultorio', 'id_consultorio', (int) $cabecera['id_consultorio']);
            $this->bloquearEspecialidad((int) $cabecera['id_especialidad']);
            $actual = $this->turnoBloqueado($id) ?? throw new HttpException(404, 'turno_no_encontrado', 'El turno no existe.');
            $this->exigirVigente($actual);

            $estado = $this->agendaParaTurno($agenda);
            if ((int) $estado['id_especialidad'] !== (int) $actual['id_especialidad']) {
                throw new HttpException(400, 'especialidad_distinta', 'La reprogramación debe ser con una agenda de la misma especialidad.');
            }
            $fin = $this->validarFranja($estado, $fecha, $inicio);
            $this->exigirLibre($estado, (int) $actual['id_paciente'], $fecha, $inicio, $fin, $id);

            $conexion->prepare(
                'UPDATE turno SET id_agenda = :agenda, fecha = :fecha, hora_inicio = :inicio, hora_fin = :fin WHERE id_turno = :id'
            )->execute(['agenda' => $agenda, 'fecha' => $fecha, 'inicio' => $inicio . ':00', 'fin' => $fin . ':00', 'id' => $id]);
        });
    }

    // Mismo orden de bloqueo que las reservas (paciente, profesional, consultorio y luego el turno).
    // Sin este orden, una cancelación y una reserva del mismo profesional se esperan mutuamente y una de ellas falla con 1213.
    public function cancelar(int $id): void
    {
        $this->transaccion(function (PDO $conexion) use ($id): void {
            $previo = $this->turnoCrudo($id) ?? throw new HttpException(404, 'turno_no_encontrado', 'El turno no existe.');
            $this->bloquearFila('paciente', 'id_paciente', (int) $previo['id_paciente']);
            $this->bloquearFila('profesional', 'id_profesional', (int) $previo['id_profesional']);
            $this->bloquearFila('consultorio', 'id_consultorio', (int) $previo['id_consultorio']);
            $actual = $this->turnoBloqueado($id) ?? throw new HttpException(404, 'turno_no_encontrado', 'El turno no existe.');
            $this->exigirVigente($actual);

            $conexion->prepare('UPDATE turno SET estado = \'cancelado\' WHERE id_turno = :id')->execute(['id' => $id]);
        });
    }

    // Asistencia: un turno confirmado cuyo horario ya comenzó pasa a atendido o ausente, y se puede corregir entre
    // ambos. Sólo toca el turno (una fila bloqueada): no cambia franjas libres, porque el turno ya pasó.
    public function registrarAsistencia(int $id, string $estado): void
    {
        $this->transaccion(function (PDO $conexion) use ($id, $estado): void {
            $actual = $this->turnoBloqueado($id) ?? throw new HttpException(404, 'turno_no_encontrado', 'El turno no existe.');
            if ($actual['estado'] === 'cancelado') {
                throw new HttpException(409, 'turno_cancelado', 'El turno está cancelado: no admite registrar asistencia.');
            }
            if ($actual['fecha'] . ' ' . $actual['hora_inicio'] > self::ahora()) {
                throw new HttpException(409, 'turno_futuro', 'El turno todavía no comenzó: no se puede registrar la asistencia.');
            }

            $conexion->prepare('UPDATE turno SET estado = :estado WHERE id_turno = :id')->execute(['estado' => $estado, 'id' => $id]);
        });
    }

    // Lo usan las desactivaciones de especialidades, profesionales y consultorios dentro de su transacción, después de
    // bloquear sus filas: si hay turnos confirmados a partir de ahora en las agendas que `$donde` alcanza, la operación
    // se rechaza y no cambia nada.
    // Usa lectura con bloqueo (FOR SHARE) para ver turnos confirmados por otra transacción ya terminada.
    public static function exigirSinTurnosFuturos(string $donde, array $parametros): void
    {
        $consulta = Database::conexion()->prepare(
            "SELECT t.id_turno FROM turno t JOIN agenda a ON a.id_agenda = t.id_agenda
             WHERE t.estado = 'confirmado' AND TIMESTAMP(t.fecha, t.hora_inicio) > :ahora AND ($donde) FOR SHARE"
        );
        $consulta->execute($parametros + ['ahora' => self::ahora()]);
        $cantidad = count($consulta->fetchAll());
        if ($cantidad > 0) {
            throw new HttpException(409, 'turnos_futuros', "Hay $cantidad turno(s) confirmado(s) a partir de ahora en las agendas afectadas: cancelalos o reprogramalos antes.");
        }
    }

    // Ejecuta la operación en una transacción. Un interbloqueo (1213) se informa como conflicto reintentable.
    private function transaccion(callable $operacion): mixed
    {
        $conexion = Database::conexion();
        $conexion->beginTransaction();
        try {
            $resultado = $operacion($conexion);
            $conexion->commit();

            return $resultado;
        } catch (Throwable $error) {
            if ($conexion->inTransaction()) {
                $conexion->rollBack();
            }
            if ($error instanceof PDOException && ($error->errorInfo[1] ?? null) === 1213) {
                throw new HttpException(409, 'conflicto_concurrente', 'Otra operación cambió la misma franja al mismo tiempo: reintentá.');
            }
            throw $error;
        }
    }

    // Agenda sin bloqueo: sólo para saber qué profesional y consultorio bloquear, en orden, antes de validar.
    private function agendaCruda(int $id): ?array
    {
        $consulta = Database::conexion()->prepare('SELECT id_profesional, id_consultorio, id_especialidad FROM agenda WHERE id_agenda = :id');
        $consulta->execute(['id' => $id]);
        $fila = $consulta->fetch();

        return $fila === false ? null : $fila;
    }

    // Agenda con su estado vigente, leído con bloqueo compartido (después de bloquear profesional y consultorio).
    private function agendaParaTurno(int $id): array
    {
        $consulta = Database::conexion()->prepare(
            'SELECT a.id_agenda, a.id_profesional, a.id_consultorio, a.id_especialidad, a.dia_semana, a.hora_inicio, a.hora_fin,
                    a.duracion_min, a.vigente_desde, a.vigente_hasta, a.activa,
                    pr.activo AS profesional_activo, c.activo AS consultorio_activo, e.activa AS especialidad_activa
             FROM agenda a
             JOIN profesional pr ON pr.id_profesional = a.id_profesional
             JOIN consultorio c ON c.id_consultorio = a.id_consultorio
             JOIN especialidad e ON e.id_especialidad = a.id_especialidad
             WHERE a.id_agenda = :id FOR SHARE'
        );
        $consulta->execute(['id' => $id]);

        return $consulta->fetch() ?: throw new HttpException(400, 'agenda_invalida', 'La agenda no existe.');
    }

    // Reglas comunes de reserva y reprogramación: la agenda y sus recursos activos, la franja de la grilla y que sea futura.
    // Devuelve la hora de fin de la franja.
    private function validarFranja(array $agenda, string $fecha, string $inicio): string
    {
        if (!(bool) $agenda['activa']) {
            throw new HttpException(409, 'agenda_inactiva', 'La agenda está inactiva: no admite turnos.');
        }
        if (!(bool) $agenda['profesional_activo']) {
            throw new HttpException(409, 'profesional_inactivo', 'El profesional está inactivo: no admite turnos.');
        }
        if (!(bool) $agenda['consultorio_activo']) {
            throw new HttpException(409, 'consultorio_inactivo', 'El consultorio está inactivo: no admite turnos.');
        }
        if (!(bool) $agenda['especialidad_activa']) {
            throw new HttpException(409, 'especialidad_inactiva', 'La especialidad está inactiva: no admite turnos.');
        }
        $fin = Franjas::finDeFranja($agenda, $fecha, $inicio);
        if ($fin === null) {
            throw new HttpException(400, 'franja_invalida', 'La franja no corresponde a la agenda: revisá el día, la vigencia y la grilla de horarios.');
        }
        if ($fecha . ' ' . $inicio . ':00' <= self::ahora()) {
            throw new HttpException(400, 'fecha_pasada', 'La franja ya pasó: elegí una fecha y horario futuros.');
        }

        return $fin;
    }

    // Comprueba que nadie más tenga el profesional, el consultorio o al paciente en una franja que se superpone. Un turno atendido o
    // ausente sigue ocupando su horario: sólo el cancelado lo libera.
    // `$excluir` es el id del turno que se reprograma (0 en una reserva).
    private function exigirLibre(array $agenda, int $paciente, string $fecha, string $inicio, string $fin, int $excluir): void
    {
        $filtro = "AND t.fecha = :fecha AND t.estado <> 'cancelado' AND t.id_turno <> :excluir
            AND t.hora_inicio < :fin AND :inicio < t.hora_fin";
        $parametros = ['fecha' => $fecha, 'excluir' => $excluir, 'inicio' => $inicio . ':00', 'fin' => $fin . ':00'];
        $consultas = [
            [
                "SELECT t.id_turno FROM turno t JOIN agenda a ON a.id_agenda = t.id_agenda WHERE a.id_profesional = :recurso $filtro FOR SHARE",
                ['recurso' => (int) $agenda['id_profesional']],
                'franja_ocupada', 'El profesional ya tiene un turno en esa franja.',
            ],
            [
                "SELECT t.id_turno FROM turno t JOIN agenda a ON a.id_agenda = t.id_agenda WHERE a.id_consultorio = :recurso $filtro FOR SHARE",
                ['recurso' => (int) $agenda['id_consultorio']],
                'franja_ocupada', 'El consultorio ya tiene un turno en esa franja.',
            ],
            [
                "SELECT t.id_turno FROM turno t WHERE t.id_paciente = :recurso $filtro FOR SHARE",
                ['recurso' => $paciente],
                'paciente_superpuesto', 'El paciente ya tiene otro turno confirmado en esa franja.',
            ],
        ];
        foreach ($consultas as [$sql, $extra, $codigo, $mensaje]) {
            $consulta = Database::conexion()->prepare($sql);
            $consulta->execute($parametros + $extra);
            if ($consulta->fetchAll() !== []) {
                throw new HttpException(409, $codigo, $mensaje);
            }
        }
    }

    private function exigirVigente(array $turno): void
    {
        if ($turno['estado'] === 'cancelado') {
            throw new HttpException(409, 'turno_cancelado', 'El turno ya está cancelado.');
        }
        if ($turno['estado'] !== 'confirmado') {
            throw new HttpException(409, 'turno_cerrado', 'El turno ya tiene la asistencia registrada: no se puede cancelar ni reprogramar.');
        }
        // `hora_inicio` viene como TIME de la base (HH:MM:SS): no se le agregan segundos.
        if ($turno['fecha'] . ' ' . $turno['hora_inicio'] <= self::ahora()) {
            throw new HttpException(409, 'turno_pasado', 'El turno ya pasó: no se puede cancelar ni reprogramar.');
        }
    }

    // Bloquea el paciente y exige que esté activo para reservar.
    private function bloquearPaciente(int $id): void
    {
        $activo = $this->bloquearFila('paciente', 'id_paciente', $id)
            ?? throw new HttpException(400, 'paciente_invalido', 'El paciente no existe.');
        if (!$activo) {
            throw new HttpException(409, 'paciente_inactivo', 'El paciente está inactivo: no admite turnos.');
        }
    }

    // La especialidad se bloquea en su propia sentencia, después de profesional y consultorio y
    // antes de leer la agenda. Así una desactivación de especialidad (que bloquea la especialidad y después las agendas) no
    // puede esperar a una reserva que ya tiene la agenda y espera la especialidad.
    private function bloquearEspecialidad(int $id): void
    {
        Database::conexion()->prepare('SELECT id_especialidad FROM especialidad WHERE id_especialidad = :id FOR SHARE')
            ->execute(['id' => $id]);
    }

    // Bloquea una fila hasta cerrar la transacción. Devuelve si está activa, o null si no existe.
    private function bloquearFila(string $tabla, string $clave, int $id): ?bool
    {
        $consulta = Database::conexion()->prepare("SELECT activo FROM $tabla WHERE $clave = :id FOR UPDATE");
        $consulta->execute(['id' => $id]);
        $activo = $consulta->fetchColumn();

        return $activo === false ? null : (bool) $activo;
    }

    private function turnoCrudo(int $id): ?array
    {
        $consulta = Database::conexion()->prepare(
            'SELECT t.id_paciente, t.id_agenda, t.fecha, t.hora_inicio, t.estado, a.id_especialidad,
                    a.id_profesional, a.id_consultorio
             FROM turno t JOIN agenda a ON a.id_agenda = t.id_agenda WHERE t.id_turno = :id'
        );
        $consulta->execute(['id' => $id]);
        $fila = $consulta->fetch();

        return $fila === false ? null : $fila;
    }

    // Turno con bloqueo de escritura: cancelar o reprogramar no pueden cruzarse con otro cambio del mismo turno.
    private function turnoBloqueado(int $id): ?array
    {
        $consulta = Database::conexion()->prepare(
            'SELECT t.id_paciente, t.fecha, t.hora_inicio, t.estado, a.id_especialidad
             FROM turno t JOIN agenda a ON a.id_agenda = t.id_agenda WHERE t.id_turno = :id FOR UPDATE'
        );
        $consulta->execute(['id' => $id]);
        $fila = $consulta->fetch();

        return $fila === false ? null : $fila;
    }

    private function ocupaciones(string $desde, string $hasta): array
    {
        $consulta = Database::conexion()->prepare(
            'SELECT t.fecha, TIME_FORMAT(t.hora_inicio, \'%H:%i\') AS inicio, TIME_FORMAT(t.hora_fin, \'%H:%i\') AS fin,
                    a.id_profesional, a.id_consultorio
             FROM turno t JOIN agenda a ON a.id_agenda = t.id_agenda
             WHERE t.estado <> \'cancelado\' AND t.fecha BETWEEN :desde AND :hasta'
        );
        $consulta->execute(['desde' => $desde, 'hasta' => $hasta]);

        $porFecha = [];
        foreach ($consulta->fetchAll() as $fila) {
            $porFecha[$fila['fecha']][] = [
                'inicio' => Franjas::minutos($fila['inicio']),
                'fin' => Franjas::minutos($fila['fin']),
                'profesional' => (int) $fila['id_profesional'],
                'consultorio' => (int) $fila['id_consultorio'],
            ];
        }

        return $porFecha;
    }

    private function normalizar(array $fila): array
    {
        $fecha = $fila['fecha'];

        return [
            'id' => (int) $fila['id_turno'],
            'fecha' => $fecha,
            'horaInicio' => $fila['hora_inicio'],
            'horaFin' => $fila['hora_fin'],
            'estado' => $fila['estado'],
            'motivo' => $fila['motivo'],
            // Un turno confirmado con fecha y hora ya pasadas no se puede modificar.
            'pasado' => $fecha . ' ' . $fila['hora_inicio'] . ':00' <= self::ahora(),
            'paciente' => [
                'id' => (int) $fila['id_paciente'],
                'dni' => $fila['dni'],
                'nombre' => $fila['paciente_nombre'],
                'apellido' => $fila['paciente_apellido'],
                'telefono' => $fila['telefono'],
                'email' => $fila['email'],
                'fechaNacimiento' => $fila['fecha_nacimiento'],
                'obraSocial' => $fila['obra_social'],
            ],
            'profesional' => [
                'id' => (int) $fila['id_profesional'],
                'nombre' => $fila['profesional_nombre'],
                'apellido' => $fila['profesional_apellido'],
            ],
            'consultorio' => ['id' => (int) $fila['id_consultorio'], 'numero' => $fila['consultorio_numero']],
            'especialidad' => ['id' => (int) $fila['id_especialidad'], 'nombre' => $fila['especialidad_nombre']],
            'agenda' => ['id' => (int) $fila['id_agenda']],
        ];
    }
}
