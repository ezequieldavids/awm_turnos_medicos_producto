# Runtime PHP de TUR-001 (DEC-004: PHP puro, sin dependencias de Composer).
FROM php:8.4-cli

# Configuración de producción: sin errores visibles al cliente y sin cabecera X-Powered-By.
# php.ini-production deja expose_php = On, por eso se fuerza a Off.
RUN docker-php-ext-install pdo_mysql \
 && cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \
 && sed -i 's/^expose_php = On/expose_php = Off/' "$PHP_INI_DIR/php.ini"
