<?php

declare(strict_types=1);

// Auxiliar de test_usuarios.py: otra transacción da de alta una persona con un DNI
// y todavía no la confirma. Mientras tanto, un alta por la API con ese mismo DNI debe esperar y responder 409 dni_duplicado.
// Uso: php tests/api/bloqueo_persona.php <dni> <segundos>
// Imprime «bloqueado» cuando retiene la fila y «confirmado» al cerrar la transacción.

require dirname(__DIR__, 2) . '/src/bootstrap.php';

use Turnos\Database;

[, $dni, $segundos] = $argv + [null, null, null];

$conexion = Database::conexion();
$conexion->beginTransaction();
$conexion->prepare('INSERT INTO persona (dni, nombre, apellido) VALUES (:dni, :nombre, :apellido)')
    ->execute(['dni' => $dni, 'nombre' => 'Carrera', 'apellido' => 'Auxiliar']);
echo "bloqueado\n";
flush();
sleep((int) $segundos);
$conexion->commit();
echo "confirmado\n";
