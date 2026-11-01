<?php

declare(strict_types=1);

namespace Turnos;

use Turnos\Controladores\AdministracionControlador;
use Turnos\Controladores\AgendaControlador;
use Turnos\Controladores\AutenticacionControlador;
use Turnos\Controladores\ConsultorioControlador;
use Turnos\Controladores\DisponibilidadControlador;
use Turnos\Controladores\EspecialidadControlador;
use Turnos\Controladores\PacienteControlador;
use Turnos\Controladores\PanelControlador;
use Turnos\Controladores\ProfesionalControlador;
use Turnos\Controladores\ReporteControlador;
use Turnos\Controladores\TurnoControlador;
use Turnos\Controladores\UsuarioControlador;
use Turnos\Http\Router;

final class Rutas
{
    public static function registrar(Router $router): void
    {
        $autenticacion = new AutenticacionControlador();
        $panel = new PanelControlador();
        $administracion = new AdministracionControlador();
        $especialidades = new EspecialidadControlador();
        $pacientes = new PacienteControlador();
        $profesionales = new ProfesionalControlador();
        $consultorios = new ConsultorioControlador();
        $agendas = new AgendaControlador();
        $turnos = new TurnoControlador();
        $disponibilidad = new DisponibilidadControlador();
        $usuarios = new UsuarioControlador();
        $reportes = new ReporteControlador();

        $router->post('/api/login', fn () => $autenticacion->login());
        $router->post('/api/logout', fn () => $autenticacion->logout());
        $router->get('/api/sesion', fn () => $autenticacion->sesion());
        $router->get('/api/panel', fn () => $panel->panel());
        $router->get('/api/administracion/resumen', fn () => $administracion->resumen());
        $router->get('/api/especialidades', fn () => $especialidades->listar());
        $router->post('/api/especialidades', fn () => $especialidades->crear());
        $router->get('/api/especialidades/{id}', fn (int $id) => $especialidades->obtener($id));
        $router->put('/api/especialidades/{id}', fn (int $id) => $especialidades->modificar($id));
        $router->put('/api/especialidades/{id}/estado', fn (int $id) => $especialidades->cambiarEstado($id));
        $router->get('/api/usuarios', fn () => $usuarios->listar());
        $router->post('/api/usuarios', fn () => $usuarios->crear());
        $router->get('/api/usuarios/{id}', fn (int $id) => $usuarios->obtener($id));
        $router->put('/api/usuarios/{id}/rol', fn (int $id) => $usuarios->cambiarRol($id));
        $router->put('/api/usuarios/{id}/estado', fn (int $id) => $usuarios->cambiarEstado($id));
        $router->put('/api/usuarios/{id}/contrasena', fn (int $id) => $usuarios->restablecerContrasena($id));
        $router->get('/api/mis-datos', fn () => $pacientes->misDatos());
        $router->get('/api/pacientes', fn () => $pacientes->listar());
        $router->post('/api/pacientes', fn () => $pacientes->crear());
        $router->get('/api/pacientes/{id}', fn (int $id) => $pacientes->obtener($id));
        $router->put('/api/pacientes/{id}', fn (int $id) => $pacientes->modificar($id));
        $router->put('/api/pacientes/{id}/estado', fn (int $id) => $pacientes->cambiarEstado($id));
        $router->get('/api/profesionales', fn () => $profesionales->listar());
        $router->post('/api/profesionales', fn () => $profesionales->crear());
        $router->get('/api/profesionales/{id}', fn (int $id) => $profesionales->obtener($id));
        $router->put('/api/profesionales/{id}', fn (int $id) => $profesionales->modificar($id));
        $router->put('/api/profesionales/{id}/estado', fn (int $id) => $profesionales->cambiarEstado($id));
        $router->get('/api/consultorios', fn () => $consultorios->listar());
        $router->post('/api/consultorios', fn () => $consultorios->crear());
        $router->get('/api/consultorios/{id}', fn (int $id) => $consultorios->obtener($id));
        $router->put('/api/consultorios/{id}', fn (int $id) => $consultorios->modificar($id));
        $router->put('/api/consultorios/{id}/estado', fn (int $id) => $consultorios->cambiarEstado($id));
        $router->get('/api/agendas', fn () => $agendas->listar());
        $router->get('/api/agendas/opciones', fn () => $agendas->opciones());
        $router->post('/api/agendas', fn () => $agendas->crear());
        $router->get('/api/agendas/{id}', fn (int $id) => $agendas->obtener($id));
        $router->put('/api/agendas/{id}', fn (int $id) => $agendas->modificar($id));
        $router->put('/api/agendas/{id}/estado', fn (int $id) => $agendas->cambiarEstado($id));
        $router->get('/api/disponibilidad', fn () => $disponibilidad->listar());
        $router->get('/api/disponibilidad/opciones', fn () => $disponibilidad->opciones());
        $router->get('/api/turnos', fn () => $turnos->listar());
        $router->post('/api/turnos', fn () => $turnos->reservar());
        $router->get('/api/turnos/{id}', fn (int $id) => $turnos->obtener($id));
        $router->put('/api/turnos/{id}/estado', fn (int $id) => $turnos->cambiarEstado($id));
        $router->put('/api/turnos/{id}/reprogramacion', fn (int $id) => $turnos->reprogramar($id));
        $router->get('/api/reportes/turnos', fn () => $reportes->turnos());
        $router->get('/api/reportes/turnos.csv', fn () => $reportes->csv());
    }
}
