<?php

declare(strict_types=1);

// Auxiliar de test_usuarios.py: hace como otro administrador que desactiva una cuenta.
// Toma el mismo bloqueo que CuentaRepositorio (todos los administradores activos, en orden), desactiva la cuenta indicada,
// espera y confirma. Mientras tanto, la petición de la API que desactiva a otro administrador debe esperar y responder 409.
// Uso: php tests/api/bloqueo_usuarios.php <id_usuario> <segundos>
// Imprime «bloqueado» cuando retiene el bloqueo y «confirmado» al cerrar la transacción.

require dirname(__DIR__, 2) . '/src/bootstrap.php';

use Turnos\Database;

[, $idUsuario, $segundos] = $argv + [null, null, null];

$conexion = Database::conexion();
$conexion->beginTransaction();
$conexion->query(
    "SELECT id_usuario FROM usuario WHERE rol = 'administrador' AND estado = 'activo' ORDER BY id_usuario FOR UPDATE"
)->fetchAll();
$conexion->prepare("UPDATE usuario SET estado = 'inactivo' WHERE id_usuario = :id")->execute(['id' => (int) $idUsuario]);
echo "bloqueado\n";
flush();
sleep((int) $segundos);
$conexion->commit();
echo "confirmado\n";
