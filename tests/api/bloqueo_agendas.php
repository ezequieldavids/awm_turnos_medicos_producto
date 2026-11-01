<?php

declare(strict_types=1);

// Auxiliar de test_agendas.py: mantiene abierta un alta con el bloqueo del profesional
// y, tras esperar, confirma una agenda que se superpone con la que la prueba enviará por la API.
// Uso: php tests/api/bloqueo_agendas.php <profesional> <consultorio> <especialidad> <año> <segundos>
// Imprime «bloqueado» cuando retiene la fila y «confirmado» al cerrar la transacción.

require dirname(__DIR__, 2) . '/src/bootstrap.php';

use Turnos\Database;

[, $profesional, $consultorio, $especialidad, $anio, $segundos] = $argv + [null, null, null, null, null, null];

$conexion = Database::conexion();
$conexion->beginTransaction();
// Mismo bloqueo que el repositorio de agendas: la fila del profesional queda reservada hasta el commit.
$conexion->prepare('SELECT id_profesional FROM profesional WHERE id_profesional = :id FOR UPDATE')->execute(['id' => (int) $profesional]);
echo "bloqueado\n";
flush();
sleep((int) $segundos);
$conexion->prepare(
    'INSERT INTO agenda (id_profesional, id_consultorio, id_especialidad, dia_semana, hora_inicio, hora_fin, duracion_min, vigente_desde, vigente_hasta, activa)
     VALUES (:profesional, :consultorio, :especialidad, 3, \'09:00:00\', \'10:00:00\', 15, :desde, :hasta, 1)'
)->execute([
    'profesional' => (int) $profesional,
    'consultorio' => (int) $consultorio,
    'especialidad' => (int) $especialidad,
    'desde' => "$anio-01-01",
    'hasta' => "$anio-12-31",
]);
$conexion->commit();
echo "confirmado\n";
