-- MySQL dump 10.13  Distrib 8.4.13, for Linux (x86_64)
--
-- Host: localhost    Database: turnos
-- ------------------------------------------------------
-- Server version	8.4.13

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Current Database: `turnos`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `turnos` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `turnos`;

--
-- Table structure for table `agenda`
--

DROP TABLE IF EXISTS `agenda`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `agenda` (
  `id_agenda` int unsigned NOT NULL AUTO_INCREMENT,
  `id_profesional` int unsigned NOT NULL,
  `id_consultorio` int unsigned NOT NULL,
  `id_especialidad` int unsigned NOT NULL,
  `dia_semana` tinyint unsigned NOT NULL,
  `hora_inicio` time NOT NULL,
  `hora_fin` time NOT NULL,
  `duracion_min` smallint unsigned NOT NULL,
  `vigente_desde` date NOT NULL,
  `vigente_hasta` date DEFAULT NULL,
  `activa` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id_agenda`),
  KEY `ix_agenda_profesional` (`id_profesional`,`dia_semana`),
  KEY `ix_agenda_consultorio` (`id_consultorio`,`dia_semana`),
  KEY `fk_agenda_especialidad` (`id_especialidad`),
  CONSTRAINT `fk_agenda_consultorio` FOREIGN KEY (`id_consultorio`) REFERENCES `consultorio` (`id_consultorio`),
  CONSTRAINT `fk_agenda_especialidad` FOREIGN KEY (`id_especialidad`) REFERENCES `especialidad` (`id_especialidad`),
  CONSTRAINT `fk_agenda_profesional` FOREIGN KEY (`id_profesional`) REFERENCES `profesional` (`id_profesional`),
  CONSTRAINT `ck_agenda_dia` CHECK ((`dia_semana` between 1 and 7)),
  CONSTRAINT `ck_agenda_duracion` CHECK ((`duracion_min` between 5 and 120)),
  CONSTRAINT `ck_agenda_horario` CHECK ((`hora_inicio` < `hora_fin`)),
  CONSTRAINT `ck_agenda_vigencia` CHECK (((`vigente_hasta` is null) or (`vigente_desde` <= `vigente_hasta`)))
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `agenda`
--

LOCK TABLES `agenda` WRITE;
/*!40000 ALTER TABLE `agenda` DISABLE KEYS */;
INSERT INTO `agenda` VALUES (1,1,1,11,1,'08:00:00','12:00:00',15,'2026-01-01',NULL,1),(2,2,2,3,2,'14:00:00','18:00:00',20,'2026-01-01','2026-12-31',1),(3,2,3,11,5,'09:00:00','10:00:00',30,'2025-01-01','2025-06-30',0);
/*!40000 ALTER TABLE `agenda` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `consultorio`
--

DROP TABLE IF EXISTS `consultorio`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `consultorio` (
  `id_consultorio` int unsigned NOT NULL AUTO_INCREMENT,
  `numero` varchar(20) NOT NULL,
  `piso` varchar(20) DEFAULT NULL,
  `ubicacion` varchar(100) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id_consultorio`),
  UNIQUE KEY `uk_consultorio_numero` (`numero`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `consultorio`
--

LOCK TABLES `consultorio` WRITE;
/*!40000 ALTER TABLE `consultorio` DISABLE KEYS */;
INSERT INTO `consultorio` VALUES (1,'101','Planta baja','Ala este',1),(2,'102','Planta baja',NULL,1),(3,'201','Primer piso','Ala norte',1),(4,'299','Segundo piso','Fuera de uso',0);
/*!40000 ALTER TABLE `consultorio` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `especialidad`
--

DROP TABLE IF EXISTS `especialidad`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `especialidad` (
  `id_especialidad` int unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(80) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `activa` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id_especialidad`),
  UNIQUE KEY `uk_especialidad_nombre` (`nombre`)
) ENGINE=InnoDB AUTO_INCREMENT=42 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `especialidad`
--

LOCK TABLES `especialidad` WRITE;
/*!40000 ALTER TABLE `especialidad` DISABLE KEYS */;
INSERT INTO `especialidad` VALUES (1,'Alergología','Diagnóstico y tratamiento de enfermedades alérgicas e inmunológicas',1),(2,'Anestesiología','Evaluación preanestésica y manejo del dolor perioperatorio',1),(3,'Cardiología','Diagnóstico y tratamiento de patologías cardiovasculares',1),(4,'Cardiología Intervencionista','Procedimientos hemodinámicos y cateterismos',1),(5,'Cirugía Cardiovascular','Intervenciones quirúrgicas cardíacas y de grandes vasos',1),(6,'Cirugía de Cabeza y Cuello','Cirugía oncológica y reconstructiva cervicofacial',1),(7,'Cirugía General','Cirugía abdominal y digestiva ambulatoria y de internación',1),(8,'Cirugía Infantil','Cirugía pediátrica programada y de urgencia',1),(9,'Cirugía Plástica y Reparadora','Cirugía estética y procedimientos reconstructivos',1),(10,'Cirugía Torácica','Patologías quirúrgicas pulmonares y del mediastino',1),(11,'Clínica Médica','Atención clínica integral, preventiva y diagnóstico de adultos',1),(12,'Clínica Pediátrica','Control del desarrollo y atención médica infantil',1),(13,'Dermatología','Tratamiento clínico y quirúrgico de patologías de la piel',1),(14,'Diabetología','Control metabólico y tratamiento integral de la diabetes',1),(15,'Ecografía y Doppler','Diagnóstico por imágenes ecográficas de adultos y partes blandas',1),(16,'Ecografía Pediátrica','Estudios ecográficos pediátricos y del recién nacido',1),(17,'Flebología y Cirugía Vascular','Tratamiento de várices y patologías venosas periféricas',1),(18,'Fonoaudiología','Rehabilitación del lenguaje, deglución y audición',1),(19,'Gastroenterología','Enfermedades del tracto gastrointestinal e hígado',1),(20,'Gastroenterología Infantil','Patologías digestivas en pediatría',1),(21,'Ginecología y Obstetricia','Salud integral femenina, control prenatal y ginecológico',1),(22,'Hematología','Diagnóstico de enfermedades de la sangre y coagulación',1),(23,'Hemoterapia','Medicina transfusional y banco de sangre',1),(24,'Infectología','Tratamiento de patologías infecciosas complejas',1),(25,'Kinesiología y Fisioterapia','Rehabilitación motora, respiratoria y postural',1),(26,'Medicina Nuclear','Estudios diagnósticos y terapias con radioisótopos',1),(27,'Nefrología','Prevención y tratamiento de patologías renales e hipertensión',1),(28,'Neumonología Adultos','Enfermedades respiratorias del adulto y función pulmonar',1),(29,'Neumonología Infantil','Patologías respiratorias y asma en niños',1),(30,'Neurocirugía','Cirugía del sistema nervioso central y periférico',1),(31,'Neurocirugía Infantil','Tratamiento neuroquirúrgico pediátrico',1),(32,'Neurología','Diagnóstico y tratamiento de afecciones neurológicas',1),(33,'Nutrición','Evaluación nutricional, planes alimentarios y dietoterapia',1),(34,'Odontología','Atención odontológica general, operatoria y prótesis',1),(35,'Oftalmología','Control de agudeza visual y patologías oculares',1),(36,'Oncología Médica','Tratamiento sistémico y seguimiento oncológico',1),(37,'Ortopedia y Traumatología','Patología articular, fracturas y deformidades óseas',1),(38,'Otorrinolaringología','Patologías de oído, nariz y garganta',1),(39,'Traumatología Infantil','Traumatología y ortopedia pediátrica',1),(40,'Traumatología de Columna','Patologías degenerativas y quirúrgicas raquídeas',1),(41,'Urología','Aparato urinario y salud reproductiva masculina',1);
/*!40000 ALTER TABLE `especialidad` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `paciente`
--

DROP TABLE IF EXISTS `paciente`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `paciente` (
  `id_paciente` int unsigned NOT NULL AUTO_INCREMENT,
  `id_persona` int unsigned NOT NULL,
  `obra_social` varchar(100) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id_paciente`),
  UNIQUE KEY `uk_paciente_persona` (`id_persona`),
  CONSTRAINT `fk_paciente_persona` FOREIGN KEY (`id_persona`) REFERENCES `persona` (`id_persona`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `paciente`
--

LOCK TABLES `paciente` WRITE;
/*!40000 ALTER TABLE `paciente` DISABLE KEYS */;
INSERT INTO `paciente` VALUES (1,4,'OSDE 210',1),(2,6,'Swiss Medical',1),(3,7,NULL,1),(4,8,'PAMI',0);
/*!40000 ALTER TABLE `paciente` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `persona`
--

DROP TABLE IF EXISTS `persona`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `persona` (
  `id_persona` int unsigned NOT NULL AUTO_INCREMENT,
  `dni` varchar(8) NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `apellido` varchar(100) NOT NULL,
  `telefono` varchar(30) DEFAULT NULL,
  `email` varchar(190) DEFAULT NULL,
  `fecha_nacimiento` date DEFAULT NULL,
  PRIMARY KEY (`id_persona`),
  UNIQUE KEY `uk_persona_dni` (`dni`),
  UNIQUE KEY `uk_persona_email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `persona`
--

LOCK TABLES `persona` WRITE;
/*!40000 ALTER TABLE `persona` DISABLE KEYS */;
INSERT INTO `persona` VALUES (1,'20000001','Admin','Prueba',NULL,NULL,NULL),(2,'20000002','Recepción','Prueba',NULL,NULL,NULL),(3,'20000003','Profesional','Prueba',NULL,NULL,NULL),(4,'20000004','Paciente','Prueba',NULL,NULL,NULL),(5,'20000005','Inactivo','Prueba',NULL,NULL,NULL),(6,'30000001','Lucía','Fernández','1155550001','lucia.fernandez@ejemplo.test','1985-03-14'),(7,'30000002','Martín','Gómez',NULL,NULL,'1990-11-02'),(8,'30000003','Ana','Ruiz','1155550003','ana.ruiz@ejemplo.test','2001-07-21'),(9,'40000001','Carlos','Pereyra','1155550101','carlos.pereyra@ejemplo.test','1975-05-30'),(10,'40000002','Elena','Sosa',NULL,'elena.sosa@ejemplo.test','1982-09-08');
/*!40000 ALTER TABLE `persona` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `profesional`
--

DROP TABLE IF EXISTS `profesional`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `profesional` (
  `id_profesional` int unsigned NOT NULL AUTO_INCREMENT,
  `id_persona` int unsigned NOT NULL,
  `matricula` varchar(30) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id_profesional`),
  UNIQUE KEY `uk_profesional_persona` (`id_persona`),
  UNIQUE KEY `uk_profesional_matricula` (`matricula`),
  CONSTRAINT `fk_profesional_persona` FOREIGN KEY (`id_persona`) REFERENCES `persona` (`id_persona`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `profesional`
--

LOCK TABLES `profesional` WRITE;
/*!40000 ALTER TABLE `profesional` DISABLE KEYS */;
INSERT INTO `profesional` VALUES (1,3,'MP-10001',1),(2,9,'MP-10002',1),(3,10,'MP-10003',0);
/*!40000 ALTER TABLE `profesional` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `profesional_especialidad`
--

DROP TABLE IF EXISTS `profesional_especialidad`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `profesional_especialidad` (
  `id_profesional` int unsigned NOT NULL,
  `id_especialidad` int unsigned NOT NULL,
  PRIMARY KEY (`id_profesional`,`id_especialidad`),
  KEY `fk_profesp_especialidad` (`id_especialidad`),
  CONSTRAINT `fk_profesp_especialidad` FOREIGN KEY (`id_especialidad`) REFERENCES `especialidad` (`id_especialidad`),
  CONSTRAINT `fk_profesp_profesional` FOREIGN KEY (`id_profesional`) REFERENCES `profesional` (`id_profesional`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `profesional_especialidad`
--

LOCK TABLES `profesional_especialidad` WRITE;
/*!40000 ALTER TABLE `profesional_especialidad` DISABLE KEYS */;
INSERT INTO `profesional_especialidad` VALUES (2,3),(1,11),(2,11),(3,13);
/*!40000 ALTER TABLE `profesional_especialidad` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `turno`
--

DROP TABLE IF EXISTS `turno`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `turno` (
  `id_turno` int unsigned NOT NULL AUTO_INCREMENT,
  `id_paciente` int unsigned NOT NULL,
  `id_agenda` int unsigned NOT NULL,
  `fecha` date NOT NULL,
  `hora_inicio` time NOT NULL,
  `hora_fin` time NOT NULL,
  `estado` enum('confirmado','atendido','ausente','cancelado') NOT NULL DEFAULT 'confirmado',
  `motivo` varchar(255) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_turno`),
  KEY `ix_turno_agenda` (`id_agenda`,`fecha`,`estado`),
  KEY `ix_turno_paciente` (`id_paciente`,`fecha`),
  CONSTRAINT `fk_turno_agenda` FOREIGN KEY (`id_agenda`) REFERENCES `agenda` (`id_agenda`),
  CONSTRAINT `fk_turno_paciente` FOREIGN KEY (`id_paciente`) REFERENCES `paciente` (`id_paciente`),
  CONSTRAINT `ck_turno_horario` CHECK ((`hora_inicio` < `hora_fin`))
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `turno`
--

LOCK TABLES `turno` WRITE;
/*!40000 ALTER TABLE `turno` DISABLE KEYS */;
INSERT INTO `turno` VALUES (1,2,1,'2026-10-05','08:00:00','08:15:00','confirmado','Control anual','2026-11-02 00:10:20','2026-11-02 00:10:20'),(2,3,1,'2026-10-12','08:15:00','08:30:00','cancelado',NULL,'2026-11-02 00:10:20','2026-11-02 00:10:20'),(3,2,1,'2026-10-12','08:00:00','08:15:00','atendido','Consulta de control','2026-11-02 00:10:20','2026-11-02 00:10:20'),(4,3,1,'2026-10-19','08:00:00','08:15:00','ausente',NULL,'2026-11-02 00:10:20','2026-11-02 00:10:20'),(5,2,2,'2026-10-13','14:00:00','14:20:00','atendido',NULL,'2026-11-02 00:10:20','2026-11-02 00:10:20'),(6,3,2,'2026-10-20','14:00:00','14:20:00','ausente',NULL,'2026-11-02 00:10:20','2026-11-02 00:10:20');
/*!40000 ALTER TABLE `turno` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `usuario`
--

DROP TABLE IF EXISTS `usuario`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuario` (
  `id_usuario` int unsigned NOT NULL AUTO_INCREMENT,
  `id_persona` int unsigned NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `rol` enum('paciente','profesional','recepcionista','administrador') NOT NULL,
  `estado` enum('activo','inactivo') NOT NULL DEFAULT 'activo',
  PRIMARY KEY (`id_usuario`),
  UNIQUE KEY `uk_usuario_persona` (`id_persona`),
  CONSTRAINT `fk_usuario_persona` FOREIGN KEY (`id_persona`) REFERENCES `persona` (`id_persona`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `usuario`
--

LOCK TABLES `usuario` WRITE;
/*!40000 ALTER TABLE `usuario` DISABLE KEYS */;
INSERT INTO `usuario` VALUES (1,1,'$2y$12$8rCSfkcuynSRoguzgnU7SOtwqjhDWMnuC2Sn7LJr8WdInwpnyxSza','administrador','activo'),(2,2,'$2y$12$8rCSfkcuynSRoguzgnU7SOtwqjhDWMnuC2Sn7LJr8WdInwpnyxSza','recepcionista','activo'),(3,3,'$2y$12$8rCSfkcuynSRoguzgnU7SOtwqjhDWMnuC2Sn7LJr8WdInwpnyxSza','profesional','activo'),(4,4,'$2y$12$8rCSfkcuynSRoguzgnU7SOtwqjhDWMnuC2Sn7LJr8WdInwpnyxSza','paciente','activo'),(5,5,'$2y$12$8rCSfkcuynSRoguzgnU7SOtwqjhDWMnuC2Sn7LJr8WdInwpnyxSza','paciente','inactivo');
/*!40000 ALTER TABLE `usuario` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping routines for database 'turnos'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-11-02  0:26:08
