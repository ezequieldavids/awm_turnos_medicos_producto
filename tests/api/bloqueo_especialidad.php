<?php

declare(strict_types=1);

// Auxiliar de test_agendas.py (TUR-004, REV-TUR-004-016): mantiene abierta una desactivación de especialidad
// y, tras esperar, la confirma. Mientras tanto, un alta de agenda con esa especialidad debe esperar y responder 400.
// Uso: php tests/api/bloqueo_especialidad.php <especialidad> <segundos>
// Imprime «bloqueado» cuando retiene la fila y «confirmado» al cerrar la transacción.

require dirname(__DIR__, 2) . '/src/bootstrap.php';

use Turnos\Database;

[, $especialidad, $segundos] = $argv + [null, null, null];

$conexion = Database::conexion();
$conexion->beginTransaction();
$conexion->prepare('UPDATE especialidad SET activa = 0 WHERE id_especialidad = :id')->execute(['id' => (int) $especialidad]);
echo "bloqueado\n";
flush();
sleep((int) $segundos);
$conexion->commit();
echo "confirmado\n";
