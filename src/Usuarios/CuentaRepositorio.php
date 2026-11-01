<?php

declare(strict_types=1);

namespace Turnos\Usuarios;

use PDOException;
use Throwable;
use Turnos\Auth\Roles;
use Turnos\Database;
use Turnos\Http\HttpException;
use Turnos\Personas\DatosPersona;
use Turnos\Personas\PersonaRepositorio;

// Cuentas de acceso (`usuario`) sobre `persona` (TUR-005). La baja es lógica (`estado`).
// Los cambios que pueden dejar sin administradores bloquean primero a todos los activos, en orden fijo,
// para que dos cambios simultáneos no desactiven a los dos administradores.
final class CuentaRepositorio
{
    private const SELECT = 'SELECT u.id_usuario, u.id_persona, p.dni, p.nombre, p.apellido, u.rol, u.estado
        FROM usuario u JOIN persona p ON p.id_persona = u.id_persona';

    private PersonaRepositorio $personas;

    public function __construct()
    {
        $this->personas = new PersonaRepositorio();
    }

    // $estado: todos, activos o inactivos. El texto busca por DNI, apellido o nombre.
    public function listar(string $estado, string $texto): array
    {
        $condiciones = [];
        $parametros = [];
        if ($estado !== 'todos') {
            $condiciones[] = 'u.estado = :estado';
            $parametros['estado'] = $estado === 'activos' ? 'activo' : 'inactivo';
        }
        if ($texto !== '') {
            $condiciones[] = '(p.dni LIKE :q1 OR p.apellido LIKE :q2 OR p.nombre LIKE :q3)';
            // Sin preparación emulada no se puede repetir un parámetro con nombre.
            $patron = '%' . addcslashes($texto, '%_\\') . '%';
            $parametros += ['q1' => $patron, 'q2' => $patron, 'q3' => $patron];
        }
        $sql = self::SELECT . ($condiciones ? ' WHERE ' . implode(' AND ', $condiciones) : '') . ' ORDER BY p.apellido, p.nombre';
        $consulta = Database::conexion()->prepare($sql);
        $consulta->execute($parametros);

        return array_map([$this, 'normalizar'], $consulta->fetchAll());
    }

    public function buscar(int $id): ?array
    {
        $consulta = Database::conexion()->prepare(self::SELECT . ' WHERE u.id_usuario = :id');
        $consulta->execute(['id' => $id]);
        $fila = $consulta->fetch();

        return $fila === false ? null : $this->normalizar($fila);
    }

    // Usa la persona existente si el DNI ya está registrado (sin cambiar sus datos); si no, la crea con nombre y apellido.
    public function crear(array $datos, string $rol, string $hash, bool $activo): int
    {
        $conexion = Database::conexion();
        $conexion->beginTransaction();
        try {
            $idPersona = $this->personas->idPorDni($datos['dni']);
            if ($idPersona === null) {
                $idPersona = $this->personas->crear([
                    'dni' => $datos['dni'],
                    'nombre' => DatosPersona::obligatorio($datos['nombre'] ?? null, 100, 'nombre_invalido', 'El nombre'),
                    'apellido' => DatosPersona::obligatorio($datos['apellido'] ?? null, 100, 'apellido_invalido', 'El apellido'),
                    'telefono' => null,
                    'email' => null,
                    'fecha_nacimiento' => null,
                ]);
            }
            if ($this->tieneCuenta($idPersona)) {
                throw new HttpException(409, 'cuenta_existente', 'Esa persona ya tiene una cuenta de acceso.');
            }
            $this->exigirRegistro($idPersona, $rol);

            $conexion->prepare('INSERT INTO usuario (id_persona, password_hash, rol, estado) VALUES (:persona, :hash, :rol, :estado)')
                ->execute([
                    'persona' => $idPersona,
                    'hash' => $hash,
                    'rol' => $rol,
                    'estado' => $activo ? 'activo' : 'inactivo',
                ]);
            $id = (int) $conexion->lastInsertId();
            $conexion->commit();
        } catch (PDOException $error) {
            $conexion->rollBack();
            // Dos altas simultáneas con el mismo DNI: la segunda choca con una clave única. Se responde 409 sin registrar el DNI.
            if (($error->errorInfo[1] ?? null) === 1062) {
                throw new HttpException(409, 'cuenta_existente', 'Esa persona ya tiene una cuenta de acceso o se está registrando. Revisá la lista.');
            }
            throw $error;
        } catch (Throwable $error) {
            $conexion->rollBack();
            throw $error;
        }

        return $id;
    }

    // Autoprotección (Q-6): nadie se quita su propio rol administrador.
    public function cambiarRol(int $id, string $rol, int $actor): void
    {
        $this->cambiar($id, function (array $cuenta, array $administradores) use ($id, $rol, $actor) {
            if ($id === $actor && $rol !== Roles::ADMINISTRADOR) {
                throw new HttpException(409, 'autoprotegida', 'No podés quitarte tu propio rol de administrador.');
            }
            if ($cuenta['rol'] === Roles::ADMINISTRADOR && $cuenta['estado'] === 'activo' && $rol !== Roles::ADMINISTRADOR) {
                $this->exigirOtroAdministrador($id, $administradores);
            }
            if ($rol !== $cuenta['rol']) {
                $this->exigirRegistro((int) $cuenta['id_persona'], $rol);
            }

            $this->conexion()->prepare('UPDATE usuario SET rol = :rol WHERE id_usuario = :id')
                ->execute(['rol' => $rol, 'id' => $id]);
        });
    }

    // Autoprotección (Q-6) y último administrador activo. Reactivar exige el mismo registro que el alta (Q-4).
    public function cambiarEstado(int $id, bool $activo, int $actor): void
    {
        $this->cambiar($id, function (array $cuenta, array $administradores) use ($id, $activo, $actor) {
            if ($id === $actor && !$activo) {
                throw new HttpException(409, 'autoprotegida', 'No podés desactivar tu propia cuenta.');
            }
            if (!$activo && $cuenta['estado'] === 'activo' && $cuenta['rol'] === Roles::ADMINISTRADOR) {
                $this->exigirOtroAdministrador($id, $administradores);
            }
            if ($activo && $cuenta['estado'] === 'inactivo') {
                $this->exigirRegistro((int) $cuenta['id_persona'], $cuenta['rol']);
            }

            $this->conexion()->prepare('UPDATE usuario SET estado = :estado WHERE id_usuario = :id')
                ->execute(['estado' => $activo ? 'activo' : 'inactivo', 'id' => $id]);
        });
    }

    // La baja de un registro de paciente o profesional (TUR-003) desactiva la cuenta de ese mismo rol (Q-8).
    // No reactiva nada: reactivar la cuenta sigue siendo una acción explícita con su propia comprobación de registro.
    public static function inactivarDelRegistro(int $idPersona, string $rol): void
    {
        $consulta = Database::conexion()->prepare("UPDATE usuario SET estado = 'inactivo' WHERE id_persona = :persona AND rol = :rol");
        $consulta->execute(['persona' => $idPersona, 'rol' => $rol]);
    }

    public function cambiarContrasena(int $id, string $hash): void
    {
        if ($this->buscar($id) === null) {
            throw new HttpException(404, 'no_encontrado', 'La cuenta no existe.');
        }
        $this->conexion()->prepare('UPDATE usuario SET password_hash = :hash WHERE id_usuario = :id')
            ->execute(['hash' => $hash, 'id' => $id]);
    }

    // Ejecuta una regla de cambio sobre la cuenta bloqueada. Los administradores activos se bloquean antes que la cuenta.
    private function cambiar(int $id, callable $regla): void
    {
        $conexion = $this->conexion();
        $conexion->beginTransaction();
        try {
            $administradores = $this->bloquearAdministradores();
            $cuenta = $this->bloquearCuenta($id);
            $regla($cuenta, $administradores);
            $conexion->commit();
        } catch (Throwable $error) {
            $conexion->rollBack();
            throw $error;
        }
    }

    private function bloquearAdministradores(): array
    {
        $consulta = $this->conexion()->query(
            "SELECT id_usuario FROM usuario WHERE rol = 'administrador' AND estado = 'activo' ORDER BY id_usuario FOR UPDATE"
        );

        return array_map('intval', $consulta->fetchAll(\PDO::FETCH_COLUMN));
    }

    private function bloquearCuenta(int $id): array
    {
        $consulta = $this->conexion()->prepare(
            'SELECT id_usuario, id_persona, rol, estado FROM usuario WHERE id_usuario = :id FOR UPDATE'
        );
        $consulta->execute(['id' => $id]);
        $cuenta = $consulta->fetch();

        return $cuenta === false ? throw new HttpException(404, 'no_encontrado', 'La cuenta no existe.') : $cuenta;
    }

    private function exigirOtroAdministrador(int $id, array $administradores): void
    {
        if (array_diff($administradores, [$id]) === []) {
            throw new HttpException(409, 'ultimo_administrador', 'Tiene que quedar al menos un administrador activo.');
        }
    }

    // Exige que la persona tenga registro activo del rol paciente o profesional (TUR-005, Q-4).
    private function exigirRegistro(int $idPersona, string $rol): void
    {
        $tabla = match ($rol) {
            Roles::PACIENTE => 'paciente',
            Roles::PROFESIONAL => 'profesional',
            default => null,
        };
        if ($tabla === null) {
            return;
        }
        $consulta = $this->conexion()->prepare("SELECT 1 FROM $tabla WHERE id_persona = :id AND activo = 1");
        $consulta->execute(['id' => $idPersona]);
        if ($consulta->fetchColumn() === false) {
            throw new HttpException(409, 'sin_registro_de_rol', "La persona no tiene un registro activo de $tabla. Creálo primero en su módulo.");
        }
    }

    private function tieneCuenta(int $idPersona): bool
    {
        $consulta = $this->conexion()->prepare('SELECT 1 FROM usuario WHERE id_persona = :id');
        $consulta->execute(['id' => $idPersona]);

        return $consulta->fetchColumn() !== false;
    }

    private function conexion(): \PDO
    {
        return Database::conexion();
    }

    private function normalizar(array $fila): array
    {
        return [
            'id' => (int) $fila['id_usuario'],
            'dni' => $fila['dni'],
            'nombre' => $fila['nombre'],
            'apellido' => $fila['apellido'],
            'rol' => $fila['rol'],
            'etiqueta' => Roles::etiqueta($fila['rol']),
            'activo' => $fila['estado'] === 'activo',
        ];
    }
}
