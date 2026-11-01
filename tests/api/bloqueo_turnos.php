<?php

declare(strict_types=1);

// Auxiliar de test_turnos.py (TUR-007, AC-003): retiene el bloqueo del profesional de una agenda, confirma un turno en la
// franja pedida y, tras esperar, cierra la transacción. Una reserva enviada por la API durante la espera debe esperar y luego
// responder 409 (franja ocupada), no 201.
// Uso: php tests/api/bloqueo_turnos.php <agenda> <paciente> <fecha AAAA-MM-DD> <hora HH:MM> <segundos>
// Imprime «bloqueado» cuando retiene la fila y «confirmado» al cerrar la transacción.

require dirname(__DIR__, 2) . '/src/bootstrap.php';

use Turnos\Database;

[, $agenda, $paciente, $fecha, $hora, $segundos] = $argv + [null, null, null, null, null, null];

$conexion = Database::conexion();
$conexion->beginTransaction();
// Mismo orden que el repositorio de turnos: primero el profesional de la agenda.
$profesional = $conexion->prepare('SELECT id_profesional FROM agenda WHERE id_agenda = :id');
$profesional->execute(['id' => (int) $agenda]);
$conexion->prepare('SELECT id_profesional FROM profesional WHERE id_profesional = :id FOR UPDATE')
    ->execute(['id' => (int) $profesional->fetchColumn()]);
echo "bloqueado\n";
flush();
$conexion->prepare(
    'INSERT INTO turno (id_paciente, id_agenda, fecha, hora_inicio, hora_fin, estado)
     SELECT :paciente, a.id_agenda, :fecha, :inicio, ADDTIME(:inicio2, SEC_TO_TIME(a.duracion_min * 60)), \'confirmado\'
     FROM agenda a WHERE a.id_agenda = :agenda'
)->execute([
    'paciente' => (int) $paciente, 'agenda' => (int) $agenda, 'fecha' => $fecha,
    'inicio' => "$hora:00", 'inicio2' => "$hora:00",
]);
sleep((int) $segundos);
$conexion->commit();
echo "confirmado\n";
