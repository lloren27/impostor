# Sprint 4: calidad y preparación de entrega

**Fecha de revisión:** 25 de noviembre de 2026.  
**Estado:** cierre local completo; cierre operativo pendiente. No se ha publicado ni se ha accedido al entorno de producción.

Este informe complementa el [plan de seguridad y estabilidad](superpowers/plans/2026-11-19-seguridad-y-estabilidad.md). Distingue las comprobaciones ejecutadas localmente de las pruebas que requieren un Redis independiente y de las revisiones que exigen acceso al proveedor.

## Verificaciones ejecutadas

| Paquete | Comando | Resultado |
| --- | --- | --- |
| Backend | `npm run type-check` | Correcto |
| Backend | `npm run lint` | Correcto; no aplica `--fix` |
| Backend | `npm run build` | Correcto |
| Frontend | `npm run type-check` | Correcto con `strict: true` |
| Frontend | `npm run lint` | Correcto; no aplica `--fix` |
| Frontend | `VITE_BACKEND_URL=https://ci.invalid npm run build-only` | Correcto, sin advertencias |
| Backend y frontend | `npm audit --json` | Cero vulnerabilidades en ambos informes |

El frontend usa `vue-i18n@11.4.23` para resolver el aviso de auditoría. Su declaración importa `GenericComponentInstance`, que no exporta Vue `3.5.46`; `skipLibCheck: true` permite ignorar errores de declaraciones de dependencias, mientras el código de la aplicación sigue bajo comprobación estricta. Retirar esta excepción cuando la declaración upstream y la versión de Vue sean compatibles.

El motor declarado por ambos paquetes es `^20.19.0 || ^22.13.0 || >=24.0.0`. Node 23 queda excluido porque varias dependencias de lint no lo soportan. Las verificaciones locales de esta sesión se ejecutaron con Node `23.6.1`, fuera del rango declarado; CI está configurado con Node 22, pero el workflow remoto no se ejecutó: `gh` no está instalado y los cambios de `feature/sprint-4` siguen locales, sin commit ni push. Ejecutar el workflow sobre una revisión remota anterior no validaría estos cambios.

## Auditoría de dependencias

Los dos comandos `npm audit --json`, ejecutados el 25 de noviembre de 2026, terminaron con código 0:

| Paquete | Producción | Desarrollo | Total | Info/baja/moderada/alta/crítica |
| --- | ---: | ---: | ---: | --- |
| Backend | 94 | 190 | 283 | 0 / 0 / 0 / 0 / 0 |
| Frontend | 67 | 363 | 429 | 0 / 0 / 0 / 0 / 0 |

Los totales incluyen dependencias opcionales. No se usó `npm audit fix --force`; se actualizó Vue I18n de forma dirigida y se conservaron los lockfiles generados por npm. Los resultados describen el árbol instalado en la fecha de revisión, no una garantía futura.

## Matriz de regresión

| ID del inventario | Cobertura automatizada | Ubicación | Estado en esta sesión |
| --- | --- | --- | --- |
| SEC-01 | Filtrado de campos privados en `roomJoined` y `playersUpdated` | `backend/src/__tests__/security.test.ts` | 11/11 pruebas de seguridad pasadas |
| SEC-02, SEC-03 | Identidad del socket en acciones, revocación y permisos de anfitrión | `backend/src/__tests__/security.test.ts` | 11/11 pruebas de seguridad pasadas |
| SEC-05 | Mensajes de error sin detalles internos | `backend/src/__tests__/security.test.ts` | 11/11 pruebas de seguridad pasadas |
| DATA-01 | Escrituras concurrentes, conflictos y migración de snapshots legacy | `backend/src/__tests__/atomicity.test.ts` | 11/11 pruebas de atomicidad pasadas |
| SEC-04, OPS-01 | Validación, cuotas, orígenes permitidos y handshake | `backend/src/__tests__/sprint2.test.ts` | 6 casos pasados |
| GAME-01, GAME-02, GAME-03 | Salida, restauración, empate, reconexión, turnos y reasignación de anfitrión | `backend/src/__tests__/sprint3.test.ts` | 10/10 pruebas de Sprint 3 pasadas |
| GAME-04 | Transiciones inválidas y repetidas sin mutar el estado | `backend/src/__tests__/security.test.ts` | 11/11 pruebas de seguridad pasadas |
| QA-01 | Partida completa `classic`, incluida victoria tras empate, reconexión y cambio de anfitrión | `backend/src/__tests__/sprint4.test.ts` | Pasada en la suite integrada de Sprint 4 |
| QA-01 | Modo `manual`: reparto privado de roles, rechazo de rondas automáticas y cierre | `backend/src/__tests__/sprint4.test.ts` | Pasada en la suite integrada de Sprint 4 |
| QA-01 | Tipos, lint y builds de backend/frontend | `.github/workflows/ci.yml` | Checks locales correctos; CI remoto pendiente: requiere llevar estos cambios a una revisión de GitHub y disponer de los secretos Redis de pruebas |

El modo `manual` significa **solo reparto de roles**, no una partida automatizada. La matriz ya incluye casos automatizados para sus acciones permitidas y rechazadas. El 25 de noviembre, `npm run test:regressions` pasó con **41 pruebas y 0 fallos** contra el Redis configurado en `.env.test`. Las pruebas de interacción visual en navegador siguen siendo una comprobación manual pendiente y forman parte del cierre operativo.

Ejecutar las regresiones únicamente contra una base Upstash desechable y separada de producción. En local, copiar `backend/.env.test.example` a `backend/.env.test` y completar credenciales exclusivas de pruebas. En GitHub Actions, configurar los secretos `UPSTASH_TEST_REDIS_REST_URL` y `UPSTASH_TEST_REDIS_REST_TOKEN`; el workflow falla antes de las pruebas si falta cualquiera. Esta sesión usó la configuración local de pruebas y no inspeccionó ni mostró credenciales.

## Variables y operación

### Backend

| Variable | Uso y restricción |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | Obligatoria; URL REST HTTP(S), HTTPS obligatorio con `NODE_ENV=production` |
| `UPSTASH_REDIS_REST_TOKEN` | Obligatoria; secreto del almacén de producción, nunca usarlo en `.env.test` |
| `PORT` | Puerto asignado por la plataforma; predeterminado `4000` |
| `NODE_ENV` | Usar `production` en el despliegue para exigir HTTPS y `Origin` válido |
| `ALLOWED_ORIGINS` | Orígenes frontend exactos separados por comas; sin rutas ni `/` final; HTTPS en producción |
| `TRUSTED_PROXY_IPS` | Opcional; IPs exactas de proxies de confianza, separadas por comas; no confiar en rangos amplios o `X-Forwarded-For` arbitrario |
| `MAX_NAME_LENGTH`, `MAX_WORD_LENGTH`, `MAX_PLAYERS_PER_ROOM` | Opcionales; valores predeterminados `30`, `80` y `12`, respectivamente |

### Frontend

`VITE_BACKEND_URL` es obligatorio al compilar para producción: debe ser el origen HTTPS del backend, sin ruta, usuario ni contraseña. El valor de `frontend/.env` (`http://localhost:4000`) es solo para desarrollo local y no es una credencial. La URL HTTPS del cliente debe terminar usando WSS en producción.

El TLS debe terminar en la plataforma o proxy que atiende la aplicación. Si hay proxy, comprobar el reenvío de `Upgrade`/`Connection` para WebSocket y mantener una lista explícita de IPs proxy en `TRUSTED_PROXY_IPS`. No hay URL del entorno real ni manifiestos de proveedor en el repositorio y no se dispone de acceso al hosting; por tanto, HTTPS/WSS, proxy y cuotas actuales de Upstash siguen sin verificar. Las pruebas con diferentes límites del proveedor deben preceder al despliegue.

### Métricas

El backend agrega `errors`, `rejections`, `redis_conflicts` y `reconnections` y, cada 60 segundos si hay valores, escribe una línea JSON `operational_metrics`. No registra etiquetas por jugador, tokens, roles, palabras ni votos; el temporizador no mantiene vivo el proceso. Revisar estas series de logs durante el lanzamiento y ajustar las cuotas solo con datos del entorno.

## Secuencia de publicación y reversión

La publicación **no se ha realizado** y no queda autorizada por este informe.

1. Preparar los artefactos de backend y frontend con las variables de producción y verificar ambos builds, auditorías y suites de regresión en CI con Redis de pruebas independiente.
2. Programar mantenimiento; detener y drenar todas las instancias escritoras antiguas. No mezclar escritores antiguos con el guardado versionado de Redis.
3. Como los tokens previamente expuestos viven dentro de las salas y no existe `rotateTokens`, coordinar —solo con autorización explícita y tras confirmar la base de producción— la invalidación de claves `room:*` según el procedimiento ya documentado en S1.1. Esta operación borra partidas activas; no se ejecutó aquí.
4. Mantener el tráfico público en mantenimiento hasta que backend y frontend corregidos estén listos. El backend cambia el contrato público para no exponer secretos; no dejar clientes antiguos conectados a mitad de la actualización.
5. Desplegar el backend seguro, validar orígenes, conexión Redis y logs sin secretos; después habilitar la versión de frontend compilada contra su origen HTTPS. No reabrir el tráfico hasta completar comprobaciones de humo con una sala controlada.
6. Observar `operational_metrics`, errores de handshake, latencia y cuotas de Upstash. No ampliar límites ni confiar en proxies adicionales sin evidencia del proveedor.

Los snapshots sin `instanceId`/`version` se leen como legacy (`legacy:<token del primer jugador>` y versión `0`); la prueba de migración está en `atomicity.test.ts`. Antes de publicar, ejecutar esa suite con Redis de pruebas y no permitir que instancias antiguas vuelvan a escribir snapshots.

Si falla la publicación, mantener el modo de mantenimiento y corregir o desplegar hacia delante una versión compatible con el contrato saneado y las verificaciones de autorización. **No revertir al backend vulnerable ni restaurar tokens/salas invalidados**. Una reversión de frontend solo es admisible si ese cliente funciona con el backend seguro; si no, mantener el mantenimiento hasta preparar un frontend compatible. Cualquier restauración de datos requiere validar previamente su compatibilidad y no debe reactivar secretos expuestos.