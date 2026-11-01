-- Esquema de TUR-001 (personas y usuarios) y TUR-002 (especialidades): DEC-002, DEC-005, DEC-006.
-- Se ejecuta una vez sobre una base vacía (contenedor nuevo o `mysql turnos < db/schema.sql`).
-- Los usuarios semilla son sólo para el entorno local de prueba: sus contraseñas no son reales
-- y en la base se guardan únicamente hashes bcrypt.

-- Este archivo está en UTF-8: el cliente debe interpretarlo así, si no los acentos se guardan doblemente codificados.
SET NAMES utf8mb4;

CREATE TABLE persona (
  id_persona INT UNSIGNED NOT NULL AUTO_INCREMENT,
  dni VARCHAR(8) NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  apellido VARCHAR(100) NOT NULL,
  telefono VARCHAR(30) NULL,
  email VARCHAR(190) NULL,
  fecha_nacimiento DATE NULL,
  PRIMARY KEY (id_persona),
  UNIQUE KEY uk_persona_dni (dni),
  UNIQUE KEY uk_persona_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE usuario (
  id_usuario INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_persona INT UNSIGNED NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rol ENUM('paciente', 'profesional', 'recepcionista', 'administrador') NOT NULL,
  estado ENUM('activo', 'inactivo') NOT NULL DEFAULT 'activo',
  PRIMARY KEY (id_usuario),
  UNIQUE KEY uk_usuario_persona (id_persona),
  CONSTRAINT fk_usuario_persona FOREIGN KEY (id_persona) REFERENCES persona (id_persona)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Datos semilla: un usuario por rol y una cuenta inactiva para la comprobación de AC-002.
-- Contraseñas de prueba locales (ver README.md): Password123!.
INSERT INTO persona (dni, nombre, apellido) VALUES
  ('20000001', 'Admin', 'Prueba'),
  ('20000002', 'Recepción', 'Prueba'),
  ('20000003', 'Profesional', 'Prueba'),
  ('20000004', 'Paciente', 'Prueba'),
  ('20000005', 'Inactivo', 'Prueba');

INSERT INTO usuario (id_persona, password_hash, rol, estado) VALUES
  (1, '$2y$12$8rCSfkcuynSRoguzgnU7SOtwqjhDWMnuC2Sn7LJr8WdInwpnyxSza', 'administrador', 'activo'),
  (2, '$2y$12$8rCSfkcuynSRoguzgnU7SOtwqjhDWMnuC2Sn7LJr8WdInwpnyxSza', 'recepcionista', 'activo'),
  (3, '$2y$12$8rCSfkcuynSRoguzgnU7SOtwqjhDWMnuC2Sn7LJr8WdInwpnyxSza', 'profesional', 'activo'),
  (4, '$2y$12$8rCSfkcuynSRoguzgnU7SOtwqjhDWMnuC2Sn7LJr8WdInwpnyxSza', 'paciente', 'activo'),
  (5, '$2y$12$8rCSfkcuynSRoguzgnU7SOtwqjhDWMnuC2Sn7LJr8WdInwpnyxSza', 'paciente', 'inactivo');

-- TUR-002: catálogo de especialidades (PRD H.2). La baja es lógica (`activa`): no se borran filas referenciadas por el historial.
-- La unicidad del nombre usa la colación del esquema (sin distinguir mayúsculas ni acentos).
CREATE TABLE especialidad (
  id_especialidad INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(80) NOT NULL,
  descripcion VARCHAR(255) NULL,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id_especialidad),
  UNIQUE KEY uk_especialidad_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Semilla de prueba: especialidades con nombres y descripciones genéricos.
INSERT INTO especialidad (nombre, descripcion) VALUES
  ('Alergología', 'Diagnóstico y tratamiento de enfermedades alérgicas e inmunológicas'),
  ('Anestesiología', 'Evaluación preanestésica y manejo del dolor perioperatorio'),
  ('Cardiología', 'Diagnóstico y tratamiento de patologías cardiovasculares'),
  ('Cardiología Intervencionista', 'Procedimientos hemodinámicos y cateterismos'),
  ('Cirugía Cardiovascular', 'Intervenciones quirúrgicas cardíacas y de grandes vasos'),
  ('Cirugía de Cabeza y Cuello', 'Cirugía oncológica y reconstructiva cervicofacial'),
  ('Cirugía General', 'Cirugía abdominal y digestiva ambulatoria y de internación'),
  ('Cirugía Infantil', 'Cirugía pediátrica programada y de urgencia'),
  ('Cirugía Plástica y Reparadora', 'Cirugía estética y procedimientos reconstructivos'),
  ('Cirugía Torácica', 'Patologías quirúrgicas pulmonares y del mediastino'),
  ('Clínica Médica', 'Atención clínica integral, preventiva y diagnóstico de adultos'),
  ('Clínica Pediátrica', 'Control del desarrollo y atención médica infantil'),
  ('Dermatología', 'Tratamiento clínico y quirúrgico de patologías de la piel'),
  ('Diabetología', 'Control metabólico y tratamiento integral de la diabetes'),
  ('Ecografía y Doppler', 'Diagnóstico por imágenes ecográficas de adultos y partes blandas'),
  ('Ecografía Pediátrica', 'Estudios ecográficos pediátricos y del recién nacido'),
  ('Flebología y Cirugía Vascular', 'Tratamiento de várices y patologías venosas periféricas'),
  ('Fonoaudiología', 'Rehabilitación del lenguaje, deglución y audición'),
  ('Gastroenterología', 'Enfermedades del tracto gastrointestinal e hígado'),
  ('Gastroenterología Infantil', 'Patologías digestivas en pediatría'),
  ('Ginecología y Obstetricia', 'Salud integral femenina, control prenatal y ginecológico'),
  ('Hematología', 'Diagnóstico de enfermedades de la sangre y coagulación'),
  ('Hemoterapia', 'Medicina transfusional y banco de sangre'),
  ('Infectología', 'Tratamiento de patologías infecciosas complejas'),
  ('Kinesiología y Fisioterapia', 'Rehabilitación motora, respiratoria y postural'),
  ('Medicina Nuclear', 'Estudios diagnósticos y terapias con radioisótopos'),
  ('Nefrología', 'Prevención y tratamiento de patologías renales e hipertensión'),
  ('Neumonología Adultos', 'Enfermedades respiratorias del adulto y función pulmonar'),
  ('Neumonología Infantil', 'Patologías respiratorias y asma en niños'),
  ('Neurocirugía', 'Cirugía del sistema nervioso central y periférico'),
  ('Neurocirugía Infantil', 'Tratamiento neuroquirúrgico pediátrico'),
  ('Neurología', 'Diagnóstico y tratamiento de afecciones neurológicas'),
  ('Nutrición', 'Evaluación nutricional, planes alimentarios y dietoterapia'),
  ('Odontología', 'Atención odontológica general, operatoria y prótesis'),
  ('Oftalmología', 'Control de agudeza visual y patologías oculares'),
  ('Oncología Médica', 'Tratamiento sistémico y seguimiento oncológico'),
  ('Ortopedia y Traumatología', 'Patología articular, fracturas y deformidades óseas'),
  ('Otorrinolaringología', 'Patologías de oído, nariz y garganta'),
  ('Traumatología Infantil', 'Traumatología y ortopedia pediátrica'),
  ('Traumatología de Columna', 'Patologías degenerativas y quirúrgicas raquídeas'),
  ('Urología', 'Aparato urinario y salud reproductiva masculina');

-- TUR-003: pacientes y profesionales (PRD H.2). Cada rol referencia a `persona` (DNI y datos civiles) y la baja es lógica (`activo`).
CREATE TABLE paciente (
  id_paciente INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_persona INT UNSIGNED NOT NULL,
  obra_social VARCHAR(100) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id_paciente),
  UNIQUE KEY uk_paciente_persona (id_persona),
  CONSTRAINT fk_paciente_persona FOREIGN KEY (id_persona) REFERENCES persona (id_persona)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE profesional (
  id_profesional INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_persona INT UNSIGNED NOT NULL,
  matricula VARCHAR(30) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id_profesional),
  UNIQUE KEY uk_profesional_persona (id_persona),
  UNIQUE KEY uk_profesional_matricula (matricula),
  CONSTRAINT fk_profesional_persona FOREIGN KEY (id_persona) REFERENCES persona (id_persona)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE profesional_especialidad (
  id_profesional INT UNSIGNED NOT NULL,
  id_especialidad INT UNSIGNED NOT NULL,
  PRIMARY KEY (id_profesional, id_especialidad),
  CONSTRAINT fk_profesp_profesional FOREIGN KEY (id_profesional) REFERENCES profesional (id_profesional),
  CONSTRAINT fk_profesp_especialidad FOREIGN KEY (id_especialidad) REFERENCES especialidad (id_especialidad)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Semilla de prueba (datos ficticios). Las personas 3 y 4 (cuentas semilla) también actúan como profesional y paciente.
INSERT INTO persona (dni, nombre, apellido, telefono, email, fecha_nacimiento) VALUES
  ('30000001', 'Lucía', 'Fernández', '1155550001', 'lucia.fernandez@ejemplo.test', '1985-03-14'),
  ('30000002', 'Martín', 'Gómez', NULL, NULL, '1990-11-02'),
  ('30000003', 'Ana', 'Ruiz', '1155550003', 'ana.ruiz@ejemplo.test', '2001-07-21'),
  ('40000001', 'Carlos', 'Pereyra', '1155550101', 'carlos.pereyra@ejemplo.test', '1975-05-30'),
  ('40000002', 'Elena', 'Sosa', NULL, 'elena.sosa@ejemplo.test', '1982-09-08');

INSERT INTO paciente (id_persona, obra_social) SELECT id_persona, 'OSDE 210' FROM persona WHERE dni = '20000004';
INSERT INTO paciente (id_persona, obra_social) SELECT id_persona, 'Swiss Medical' FROM persona WHERE dni = '30000001';
INSERT INTO paciente (id_persona, obra_social) SELECT id_persona, NULL FROM persona WHERE dni = '30000002';
INSERT INTO paciente (id_persona, obra_social, activo) SELECT id_persona, 'PAMI', 0 FROM persona WHERE dni = '30000003';

INSERT INTO profesional (id_persona, matricula) SELECT id_persona, 'MP-10001' FROM persona WHERE dni = '20000003';
INSERT INTO profesional (id_persona, matricula) SELECT id_persona, 'MP-10002' FROM persona WHERE dni = '40000001';
INSERT INTO profesional (id_persona, matricula, activo) SELECT id_persona, 'MP-10003', 0 FROM persona WHERE dni = '40000002';

INSERT INTO profesional_especialidad (id_profesional, id_especialidad)
  SELECT p.id_profesional, e.id_especialidad FROM profesional p, especialidad e
  WHERE (p.matricula = 'MP-10001' AND e.nombre IN ('Clínica Médica'))
     OR (p.matricula = 'MP-10002' AND e.nombre IN ('Cardiología', 'Clínica Médica'))
     OR (p.matricula = 'MP-10003' AND e.nombre IN ('Dermatología'));

-- TUR-004: consultorios y agendas médicas (PRD H.2, CU-05). La baja es lógica (`activo` / `activa`).
-- La agenda es recurrente semanal (dia_semana: 1 = lunes … 7 = domingo) y tiene vigencia por fechas (vigente_hasta NULL = sin fin).
CREATE TABLE consultorio (
  id_consultorio INT UNSIGNED NOT NULL AUTO_INCREMENT,
  numero VARCHAR(20) NOT NULL,
  piso VARCHAR(20) NULL,
  ubicacion VARCHAR(100) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id_consultorio),
  UNIQUE KEY uk_consultorio_numero (numero)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE agenda (
  id_agenda INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_profesional INT UNSIGNED NOT NULL,
  id_consultorio INT UNSIGNED NOT NULL,
  id_especialidad INT UNSIGNED NOT NULL,
  dia_semana TINYINT UNSIGNED NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  duracion_min SMALLINT UNSIGNED NOT NULL,
  vigente_desde DATE NOT NULL,
  vigente_hasta DATE NULL,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id_agenda),
  KEY ix_agenda_profesional (id_profesional, dia_semana),
  KEY ix_agenda_consultorio (id_consultorio, dia_semana),
  CONSTRAINT fk_agenda_profesional FOREIGN KEY (id_profesional) REFERENCES profesional (id_profesional),
  CONSTRAINT fk_agenda_consultorio FOREIGN KEY (id_consultorio) REFERENCES consultorio (id_consultorio),
  CONSTRAINT fk_agenda_especialidad FOREIGN KEY (id_especialidad) REFERENCES especialidad (id_especialidad),
  CONSTRAINT ck_agenda_dia CHECK (dia_semana BETWEEN 1 AND 7),
  CONSTRAINT ck_agenda_horario CHECK (hora_inicio < hora_fin),
  CONSTRAINT ck_agenda_duracion CHECK (duracion_min BETWEEN 5 AND 120),
  CONSTRAINT ck_agenda_vigencia CHECK (vigente_hasta IS NULL OR vigente_desde <= vigente_hasta)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Semilla de prueba (datos ficticios). El consultorio 299 está inactivo para comprobar AC-004.
INSERT INTO consultorio (numero, piso, ubicacion, activo) VALUES
  ('101', 'Planta baja', 'Ala este', 1),
  ('102', 'Planta baja', NULL, 1),
  ('201', 'Primer piso', 'Ala norte', 1),
  ('299', 'Segundo piso', 'Fuera de uso', 0);

INSERT INTO agenda (id_profesional, id_consultorio, id_especialidad, dia_semana, hora_inicio, hora_fin, duracion_min, vigente_desde, vigente_hasta, activa)
  SELECT p.id_profesional, c.id_consultorio, e.id_especialidad, 1, '08:00:00', '12:00:00', 15, '2026-01-01', NULL, 1
  FROM profesional p, consultorio c, especialidad e
  WHERE p.matricula = 'MP-10001' AND c.numero = '101' AND e.nombre = 'Clínica Médica';

INSERT INTO agenda (id_profesional, id_consultorio, id_especialidad, dia_semana, hora_inicio, hora_fin, duracion_min, vigente_desde, vigente_hasta, activa)
  SELECT p.id_profesional, c.id_consultorio, e.id_especialidad, 2, '14:00:00', '18:00:00', 20, '2026-01-01', '2026-12-31', 1
  FROM profesional p, consultorio c, especialidad e
  WHERE p.matricula = 'MP-10002' AND c.numero = '102' AND e.nombre = 'Cardiología';

INSERT INTO agenda (id_profesional, id_consultorio, id_especialidad, dia_semana, hora_inicio, hora_fin, duracion_min, vigente_desde, vigente_hasta, activa)
  SELECT p.id_profesional, c.id_consultorio, e.id_especialidad, 5, '09:00:00', '10:00:00', 30, '2025-01-01', '2025-06-30', 0
  FROM profesional p, consultorio c, especialidad e
  WHERE p.matricula = 'MP-10002' AND c.numero = '201' AND e.nombre = 'Clínica Médica';

-- TUR-007: turnos médicos (PRD H.2 TURNO, RF-08 a RF-10). Un turno ocupa una franja de una agenda; cancelarlo cambia `estado`
-- y no borra la fila (baja lógica). La superposición se valida en la aplicación dentro de una transacción con filas bloqueadas.
CREATE TABLE turno (
  id_turno INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_paciente INT UNSIGNED NOT NULL,
  id_agenda INT UNSIGNED NOT NULL,
  fecha DATE NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  estado ENUM('confirmado', 'cancelado') NOT NULL DEFAULT 'confirmado',
  motivo VARCHAR(255) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id_turno),
  KEY ix_turno_agenda (id_agenda, fecha, estado),
  KEY ix_turno_paciente (id_paciente, fecha),
  CONSTRAINT fk_turno_paciente FOREIGN KEY (id_paciente) REFERENCES paciente (id_paciente),
  CONSTRAINT fk_turno_agenda FOREIGN KEY (id_agenda) REFERENCES agenda (id_agenda),
  CONSTRAINT ck_turno_horario CHECK (hora_inicio < hora_fin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Semilla de prueba (datos ficticios): un turno confirmado ya pasado y uno cancelado, sobre la agenda del lunes de MP-10001.
INSERT INTO turno (id_paciente, id_agenda, fecha, hora_inicio, hora_fin, estado, motivo)
  SELECT pa.id_paciente, a.id_agenda, '2026-10-05', '08:00:00', '08:15:00', 'confirmado', 'Control anual'
  FROM paciente pa JOIN persona pe ON pe.id_persona = pa.id_persona,
       agenda a JOIN profesional pr ON pr.id_profesional = a.id_profesional
  WHERE pe.dni = '30000001' AND pr.matricula = 'MP-10001' AND a.dia_semana = 1 AND a.hora_inicio = '08:00:00';

INSERT INTO turno (id_paciente, id_agenda, fecha, hora_inicio, hora_fin, estado, motivo)
  SELECT pa.id_paciente, a.id_agenda, '2026-10-12', '08:15:00', '08:30:00', 'cancelado', NULL
  FROM paciente pa JOIN persona pe ON pe.id_persona = pa.id_persona,
       agenda a JOIN profesional pr ON pr.id_profesional = a.id_profesional
  WHERE pe.dni = '30000002' AND pr.matricula = 'MP-10001' AND a.dia_semana = 1 AND a.hora_inicio = '08:00:00';

-- TUR-006: asistencia de los turnos (PRD A.5: el profesional registra atendido / ausente) para los reportes de ausentismo.
-- Sólo amplía el ENUM de `turno.estado`: las filas existentes conservan su estado. La semilla agrega turnos pasados ficticios.
ALTER TABLE turno MODIFY estado ENUM('confirmado', 'atendido', 'ausente', 'cancelado') NOT NULL DEFAULT 'confirmado';

INSERT INTO turno (id_paciente, id_agenda, fecha, hora_inicio, hora_fin, estado, motivo)
  SELECT pa.id_paciente, a.id_agenda, '2026-10-12', '08:00:00', '08:15:00', 'atendido', 'Consulta de control'
  FROM paciente pa JOIN persona pe ON pe.id_persona = pa.id_persona,
       agenda a JOIN profesional pr ON pr.id_profesional = a.id_profesional
  WHERE pe.dni = '30000001' AND pr.matricula = 'MP-10001' AND a.dia_semana = 1 AND a.hora_inicio = '08:00:00';

INSERT INTO turno (id_paciente, id_agenda, fecha, hora_inicio, hora_fin, estado, motivo)
  SELECT pa.id_paciente, a.id_agenda, '2026-10-19', '08:00:00', '08:15:00', 'ausente', NULL
  FROM paciente pa JOIN persona pe ON pe.id_persona = pa.id_persona,
       agenda a JOIN profesional pr ON pr.id_profesional = a.id_profesional
  WHERE pe.dni = '30000002' AND pr.matricula = 'MP-10001' AND a.dia_semana = 1 AND a.hora_inicio = '08:00:00';

INSERT INTO turno (id_paciente, id_agenda, fecha, hora_inicio, hora_fin, estado, motivo)
  SELECT pa.id_paciente, a.id_agenda, '2026-10-13', '14:00:00', '14:20:00', 'atendido', NULL
  FROM paciente pa JOIN persona pe ON pe.id_persona = pa.id_persona,
       agenda a JOIN profesional pr ON pr.id_profesional = a.id_profesional
  WHERE pe.dni = '30000001' AND pr.matricula = 'MP-10002' AND a.dia_semana = 2 AND a.hora_inicio = '14:00:00';

INSERT INTO turno (id_paciente, id_agenda, fecha, hora_inicio, hora_fin, estado, motivo)
  SELECT pa.id_paciente, a.id_agenda, '2026-10-20', '14:00:00', '14:20:00', 'ausente', NULL
  FROM paciente pa JOIN persona pe ON pe.id_persona = pa.id_persona,
       agenda a JOIN profesional pr ON pr.id_profesional = a.id_profesional
  WHERE pe.dni = '30000002' AND pr.matricula = 'MP-10002' AND a.dia_semana = 2 AND a.hora_inicio = '14:00:00';
