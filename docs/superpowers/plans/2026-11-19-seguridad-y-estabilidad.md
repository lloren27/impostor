# Plan de seguridad y estabilidad por sprints

**Fecha:** 19 de noviembre de 2026.
**Estado:** Sprints 1–3: implementación verificada (23 de noviembre de 2026). Sprint 4 pendiente; publicación no realizada.
Validación de la corrección del 21 de noviembre de 2026: 11 pruebas de integración pasadas y 0 fallidas contra Upstash de pruebas. `testRepeatedTransitions` sigue `currentTurnIndex`, registra las esperas antes de emitir, persiste tres palabras y un voto, y compara fase y arrays completos tras el rechazo. La comprobación aislada cubre los tres turnos iniciales y detecta borrados de palabras/votos y cambios de autor/orden. Las 20 ejecuciones documentadas anteriormente correspondían a la versión previa de la prueba, no a esta corrección. La auditoría trasladada a S4.1 y la invalidación durante la publicación mantienen su alcance documentado.
**Objetivo:** impedir la suplantación y la exposición de información privada, proteger la integridad de las partidas y mejorar su recuperación ante desconexiones.
**Arquitectura:** conservar Vue, Pinia, Express, Socket.IO y Upstash Redis. Aplicar controles en el servidor, separar los datos públicos de los privados y hacer atómicas las modificaciones de cada sala.
**Origen:** revisión del proyecto realizada en esta conversación; el inventario siguiente conserva sus hallazgos y límites.

> Guía de ejecución: utilizar `superpowers:executing-plans` para implementar las tareas por orden. Las casillas representan trabajo pendiente, no correcciones ya realizadas. Este documento no autoriza commits, pushes ni despliegues.

## 1. Alcance y reglas

- Hacer el cambio mínimo suficiente y respetar las convenciones existentes.
- No incorporar dependencias ni refactorizaciones sin justificar su necesidad.
- Mantener los modos `classic` y `manual` y la reconexión mediante token.
- Coordinar los cambios de contrato entre backend y frontend; la compatibilidad no debe conservar una fuga de secretos.
- Probar con salas y credenciales de prueba, nunca atacando producción.
- Preparar pruebas de regresión junto a cada corrección; no posponerlas al último sprint.
- Antes de ejecutar, comprobar el estado del repositorio y preservar los cambios ajenos.
- Las decisiones de límites y comportamiento indicadas como propuestas deben documentarse al implementarlas.

## 2. Evidencia de partida

| ID | Hallazgo | Prioridad | Evidencia | Sprint |
| --- | --- | --- | --- | --- |
| SEC-01 | Eventos públicos exponen tokens y roles | Alta | Lectura de `roomJoined`, `playersUpdated` y objetos enviados | 1 |
| SEC-02 | Palabras y votos permiten suplantar al jugador | Alta | Reproducción local con Redis simulado | 1 |
| DATA-01 | Escrituras concurrentes pierden cambios | Alta | Dos incorporaciones simultáneas dejaron 2 jugadores en vez de 3 | 2 |
| SEC-03 | Avance de ronda sin comprobar identidad | Media | Reproducción local sin identidad del solicitante | 1 |
| SEC-04 | Faltan validación, cuotas y límites de aplicación | Media | Lectura de manejadores y creación/incorporación a salas | 2 |
| SEC-05 | Tokens en logs y mensajes internos enviados al cliente | Media | Lectura de `onAny` y `safeEmitError` | 1 |
| GAME-01 | Salir no elimina la membresía del socket | Media | Lectura de `exitToHome` y gestión de salas | 3 |
| GAME-02 | Restauración incompleta al reconectar | Media | El cliente ignora parte del snapshot y reinicia el estado del voto | 3 |
| GAME-03 | Desconexiones pueden bloquear turnos o votaciones | Media | Lectura de turnos, votaciones y desconexión | 3 |
| GAME-04 | Inicio de palabras sin validar fase de origen | Media | Lectura de `startWordsRound` | 1 |
| OPS-01 | Control de origen WebSocket por revisar | Refuerzo | CORS configurado; no equivale a autorización | 2 |
| QA-01 | Falta una suite de regresión y hay errores de lint | Mejora | ESLint: 20 errores; no hay script de test en los paquetes revisados | 1–4 |
| DEP-01 | Auditoría de dependencias pendiente | Por determinar | `npm audit` bloqueado por DNS en ambos paquetes | 4 |

Los chequeos de tipos del backend y frontend pasaron en la revisión inicial. Las reproducciones utilizaron un doble de Redis: no sustituyen pruebas de integración con Redis real. No se auditó la configuración del despliegue ni se confirmaron CVE de dependencias.

## 3. Calendario propuesto

Sprints de una semana como referencia de planificación, sin compromiso de fechas. Ajustar la capacidad tras preparar las primeras pruebas.

| Sprint | Resultado esperado | Dependencias |
| --- | --- | --- |
| 1 — Identidad y privacidad | Ningún jugador puede obtener secretos ajenos ni actuar como otro | Ninguna |
| 2 — Integridad y protección contra abuso | Las acciones concurrentes no pierden datos y las entradas tienen límites | Sprint 1 |
| 3 — Ciclo de vida y recuperación | Salir, desconectarse y reconectarse mantienen una partida coherente | Sprints 1 y 2 |
| 4 — Calidad y operación | Verificaciones repetibles, dependencias revisadas y preparación de entrega | Sprints 1–3 |

El cierre de cada sprint requiere sus pruebas y criterios de aceptación. La publicación es una acción separada que necesita autorización.

## 4. Sprint 1 — Identidad, privacidad y permisos

**Archivos principales:** `backend/src/index.ts`, `backend/src/game/roomsManagerRedis.ts`, `backend/src/game/types.ts`, `backend/src/constants/errors.ts`, `frontend/src/interfaces/game.interface.ts`, `frontend/src/composables/useGameSocket.ts` y `frontend/src/stores/gameStore.ts`.

### S1.1 — Filtrar todos los mensajes salientes · SEC-01

- [x] Preparar una prueba que inspeccione los eventos de entrada, reconexión, inicio, empate, resultado y desconexión, y detecte secretos de otros jugadores.
- [x] Definir un tipo público de jugador con `id`, `name`, `alive`, `isHost` y `connected`; centralizar su serialización.
- [x] Sustituir los objetos completos en `roomJoined`, `playersUpdated`, `tieVote` y `roundResult`, además de revisar los demás eventos.
- [x] Mantener el token propio exclusivamente en la respuesta privada correspondiente y el rol propio en `yourRole`.
- [x] Actualizar el frontend para consumir el contrato público sin depender del objeto interno de Redis.
- [x] Preparar una estrategia de invalidación de los tokens previamente expuestos, con impacto sobre partidas activas documentado antes de publicar.
  - **Estrategia documentada:** Los tokens actuales son opacos y se almacenan en Redis como parte del snapshot de la sala. No existe un registro central de tokens emitidos, por lo que la invalidación masiva requiere regenerar los tokens de todos los jugadores en una sala.
  - **Invalidación durante el despliegue (sin rotateTokens):** Para cerrar el Sprint 1 sin implementar `rotateTokens`, se propone una ventana de mantenimiento al publicar:
    1. **Detener la versión vulnerable:** cortar el tráfico WebSocket y HTTP a la versión en producción. Esperar a que todas las conexiones caigan por timeout de ping.
    2. **Invalidar las salas de Redis:** eliminar todas las claves `room:*` del Redis de producción. Esto invalida todos los tokens expuestos, ya que los tokens solo son válidos en el contexto de una sala existente.
    3. **Arrancar la versión corregida:** desplegar el backend con las correcciones del Sprint 1 y restaurar el tráfico. Los usuarios tendrán que crear nuevas partidas.
    4. **Nota:** este procedimiento requiere autorización antes de ejecutarse. No se realiza automáticamente.

**Aceptación:** ningún evento público contiene `token`, `socketId`, `isImpostor`, `character` ni `impostorId`. Los resultados pueden comunicar el dato de revelación previsto por las reglas, pero nunca un objeto privado completo. La reconexión legítima conserva el rol propio.

### S1.2 — Vincular acciones a una identidad autenticada · SEC-02, SEC-03

- [x] Convertir las reproducciones de suplantación en pruebas de regresión que fallen con el comportamiento actual.
- [x] Asociar `roomCode` y `playerId` a `socket.data` tras crear, entrar o reconectar correctamente.
- [x] En palabras y votos, comprobar que el jugador pertenece a la sala y su socket vigente coincide con el solicitante; eliminar la reasignación de `socketId` desde estas acciones.
  - Comparación estricta `player.socketId !== callerSocketId` en `submitWord` y `submitVote` (roomsManagerRedis.ts). Un jugador desconectado (`socketId === null`) también es rechazado.
- [x] Pasar la identidad del solicitante a `startNextRound` y exigir anfitrión, en coherencia con las otras transiciones administrativas.
- [ ] Comprobar fase, pertenencia y permisos en todas las acciones que modifican una sala.
  - **Trasladado a Sprint 4 (S4.1):** las acciones mutantes actuales (`startGame`, `restartGame`, `startWordsRound`, `submitWord`, `submitVote`, `startNextRound`, `endGame`) ya comprueban fase, pertenencia y permisos. Una auditoría exhaustiva que cubra TODAS las acciones, incluyendo las futuras, se realizará en S4.1 como parte de la consolidación de verificaciones.
- [x] Al sustituir una conexión mediante token válido, revocar el acceso de la conexión anterior a acciones y emisiones de la sala.
  - Se prueba tanto la vía `rejoinRoom` como `joinRoom` con `playerToken` (que usa `joinOrRejoinRoom`).

**Aceptación:** un socket ajeno no puede enviar palabras, votar ni avanzar rondas; conocer un `playerId` no concede permisos. Un token válido permite reconectar y el socket anterior queda sin acceso a esa sala.

### S1.3 — Restringir transiciones y exposición en errores · SEC-05, GAME-04

- [x] Exigir fase `reveal` y modo `classic` para `startWordsRound`; mantener `revealRound` como origen de `startNextRound`.
- [x] Probar que repetir una transición no borra palabras ni votos ni cambia la fase.
  - `testRepeatedTransitions` exige tres palabras y un voto persistidos, rechaza `startWordsRound` con `NOT_REVEAL_ROUND` y compara fase y arrays completos (incluidos autores y orden) antes/después.
- [x] Sustituir el registro íntegro de payloads por eventos y metadatos sin tokens ni roles.
- [x] Redactar los logs de error para que no registren objetos completos con tokens ni roles.
- [x] Devolver códigos conocidos y un mensaje genérico para errores inesperados; conservar el diagnóstico interno redactado.
  - `testErrorMessageRedaction` incluye dos casos: un error conocido (UNAUTHORIZED) con igualdad exacta `message === code`, y un error interno inesperado (TypeError provocado corrompiendo Redis) que verifica que la respuesta es `{code: "UNKNOWN", message: "UNKNOWN"}` sin exponer el marcador sensible.
- [x] Capturar errores del manejador asíncrono de desconexión para evitar rechazos sin gestión.

**Aceptación:** los logs no contienen credenciales; un error simulado de Redis no filtra su mensaje al cliente; una transición inválida no modifica datos.

**Entrega del sprint:** contratos públicos, autorización centralizada donde resulte útil y pruebas de privacidad/permisos ejecutables mediante un script documentado en `backend/package.json`. Preferir herramientas ya disponibles o el runner de Node antes de añadir dependencias.

## 5. Sprint 2 — Integridad de Redis y límites

**Estado:** implementación terminada el 22 de noviembre de 2026; pruebas de integración ejecutadas con el Upstash de `backend/.env.test`. Antes de publicar, desplegar sin escritores de la versión anterior: la comparación de versiones protege solo si todas las instancias usan el nuevo mecanismo. Si se operan varias instancias de Socket.IO, hará falta un adaptador compartido para propagar eventos entre ellas; los datos en Redis son coherentes, pero las emisiones actuales son locales al proceso.

**Archivos principales:** `backend/src/game/roomsManagerRedis.ts`, `backend/src/game/roomStore.ts`, `backend/src/game/lua.ts`, `backend/src/game/types.ts`, `backend/src/index.ts`, `backend/src/rateLimit.ts`, `backend/src/config/index.ts`, `backend/src/constants/validation.ts`, y configuración de URL del frontend.

### S2.1 — Hacer atómicas las mutaciones · DATA-01

- [x] Añadir pruebas concurrentes de incorporación, votación, reconexión/desconexión y duplicados.
- [x] Separar lecturas y mutaciones: `getRoom` ya no guarda snapshots ni renueva TTL.
- [x] Usar versión e identidad de sala con comparación y escritura atómicas en Lua; releer y reintentar hasta 16 veces con espera acotada. Los snapshots previos sin versión migran en la primera mutación.
- [x] Comprobar el script con la versión instalada de `@upstash/redis` en Redis de pruebas. Lua decodifica solo los metadatos y guarda el JSON producido por JavaScript para conservar `null` y `[]`.
- [x] Reservar códigos con `SET NX` y TTL en una operación atómica; reintentar una colisión.
- [x] Incluir desconexión, poda y borrado en la comparación atómica. Una sala vacía se borra; una escritura tardía no la recrea ni afecta una sala que reutilice su código.
- [x] Emitir eventos después de confirmar la mutación. Un voto lleva `voteEpoch`; un duplicado de la papeleta anterior no entra en un desempate.

**Aceptación comprobada:** incorporaciones simultáneas conservan todos los jugadores; votos concurrentes distintos se guardan; duplicados no cuentan dos veces; reconexión simultánea con desconexión antigua conserva la nueva conexión; una sala eliminada no reaparece.

### S2.2 — Validar y limitar entradas · SEC-04

- [x] Validar objetos, tipos y eventos en ejecución antes de acceder a Redis mediante `validateEvent`.
- [x] Validar código, token, identificadores, modo, nombre, palabra y época de voto; rechazar entradas inválidas con códigos estables.
- [x] Límites configurables: nombre 1–30, palabra 1–80 y máximo 12 jugadores por sala; las reconexiones válidas funcionan en una sala llena.
- [x] Cuotas diferenciadas de creación, incorporación, reconexión, consulta, handshake y acciones de juego. Valores iniciales: creación 6/socket y 120/IP por 10 minutos; incorporación y reconexión 30/socket y 240/IP por minuto; consultas 180/IP por minuto; acciones 120/socket, 1200/IP y 600/sala por minuto. La cuota de sala se aplica solo al socket asociado a ella. Probado flujo de 12 jugadores detrás de una IP; ajustar umbrales con métricas reales.
- [x] Cuotas compartidas entre instancias con Lua y tamaño máximo de paquete Socket.IO de 4096 bytes. Ráfaga local: 20 mensajes/segundo y 8 solicitudes pendientes por socket.
- [x] Conservar códigos actuales y mitigar enumeración con validación y cuota. Una longitud mayor sería un cambio de compatibilidad separado.

**Aceptación comprobada:** entradas vacías y mensajes demasiado grandes no se guardan ni retransmiten. Una cuota agotada devuelve `RATE_LIMITED` o HTTP 429 con `Retry-After`, y se recupera al vencer la ventana. Las solicitudes ajenas no consumen la cuota colectiva de la sala.

### S2.3 — Revisar handshake y configuración · OPS-01

- [x] Usar `allowRequest` para controlar ambos transportes; en producción, rechazar conexiones sin `Origin`. Los clientes sin navegador no quedan autenticados por el `Origin` y deben superar igualmente los permisos de juego.
- [x] Separar orígenes mediante `ALLOWED_ORIGINS`; en desarrollo se admite `http://localhost:5173` por defecto. `TRUSTED_PROXY_IPS` permite confiar explícitamente en proxies concretos para identificar la IP del cliente.
- [x] Probar polling y WebSocket directo con origen admitido, rechazado y ausente.
- [x] Validar URL/token de Redis y configuración al arrancar. Un build de producción del frontend exige `VITE_BACKEND_URL` con origen HTTPS puro; el cliente no usa localhost silenciosamente en producción.

**Verificación:** `backend/src/__tests__/atomicity.test.ts` y `backend/src/__tests__/sprint2.test.ts` cubren las pruebas contra Upstash independiente; `backend/src/__tests__/security.test.ts` protege el sprint 1. Los scripts `npm run test:atomicity` y `npm run test:sprint2` requieren `backend/.env.test`, ignorado por Git. La auditoría de producción y el despliegue siguen siendo acciones separadas.

## 6. Sprint 3 — Salida, desconexión y reconexión

**Estado:** implementación verificada el 23 de noviembre de 2026. Tipos de backend (`tsc --noEmit`) y frontend (`type-check`) sin errores.

**Archivos principales:** `backend/src/index.ts`, `backend/src/game/roomsManagerRedis.ts`, `frontend/src/services/socket.ts`, `frontend/src/composables/useGameSocket.ts`, `frontend/src/stores/gameStore.ts`, `frontend/src/views/HomeView.vue`, `frontend/src/views/LobbyView.vue` y `frontend/src/views/GameView.vue`.

### S3.1 — Implementar salida explícita · GAME-01

- [x] Crear `leaveRoom`, asociado a la identidad del socket y con confirmación del servidor.
- [x] Actualizar presencia y anfitrión, abandonar la sala de Socket.IO y limpiar la asociación del socket.
- [x] Al entrar en otra sala, resolver la membresía anterior antes de suscribir a la nueva.
  - `createRoom` y `joinRoom` en index.ts llaman `removePlayerFromPreviousRoom` para eliminar al jugador de la sala anterior en Redis, emiten `playersUpdated` a la sala anterior, resuelven la votación pendiente si aplica, limpian `socket.data.roomCode` y `socket.data.playerId`, y ejecutan `socket.leave(previousRoomCode)` antes de unirse a la nueva sala.
  - `joinRoom` no elimina al jugador de Redis si la sala anterior es la misma que la nueva, preservando la recuperación por `playerToken` en `joinOrRejoinRoom`.
  - Si quien cambia de sala era candidato en una votación, su salida resuelve la ronda y lo elimina; los votos contra un jugador ausente no quedan pendientes. Validado con votos completos e incompletos.
- [x] Integrar la salida en `exitToHome`; limpiar también la sesión persistida cuando termina la sala.
- [x] Probar salida repetida (idempotente: `leaveRoom` devuelve `playerRemoved: false` si el socket ya no está asociado).

**Aceptación:** quien abandona deja de recibir eventos y de bloquear la sala; cambiar de sala no mezcla estados ni conserva permisos anteriores. La sala se borra si queda vacía.

### S3.2 — Restaurar el estado completo · GAME-02

- [x] Definir un snapshot público y una parte privada propia con fase, ronda, palabras, turno, candidatos de empate, resultado disponible y estado del voto propio.
- [x] Aplicar el snapshot de forma coherente en Pinia (`applySnapshot`), evitando resets posteriores que borren datos restaurados.
- [x] Recuperar `hasVoted` y el voto propio sin revelar los votos ajenos (el backend incluye `myVote` y `hasVoted` en `roomState`).
- [x] Gestionar almacenamiento local corrupto, token inválido y sala expirada sin bucles de reconexión (validación JSON, limpieza de sesión en `ROOM_NOT_FOUND`/`PLAYER_NOT_FOUND`, límite de un intento por conexión).
- [x] Confirmar envíos de voto en el servidor antes de fijarlos como aceptados; permitir reintento cuando se rechacen.
  - El servidor emite `voteConfirmed` tras aceptar un voto (index.ts). El frontend (useGameSocket.ts) escucha ese evento para marcar `hasVoted` en el store. GameView.vue ya no marca el voto inmediatamente; si el servidor rechaza, `onError` resetea `isSubmittingVote` y permite reintento.
- [x] Registrar y retirar listeners por referencia, evitando que un componente elimine los de otros consumidores.

**Aceptación:** recargar en palabras, votación, empate o final restaura una vista coherente; no permite votar dos veces ni pierde el voto aceptado. El modo manual mantiene su comportamiento.

### S3.3 — Evitar partidas bloqueadas · GAME-03

- [x] Política de gracia de reconexión: `DISCONNECT_GRACE_MS` (2 minutos) ya definida en `pruneDisconnected`; los turnos saltan jugadores desconectados mediante `advanceToConnectedTurn`.
- [x] Mantener la información de gracia en Redis (`pruneDisconnected` usa `disconnectedAt` persistido).
- [x] Recalcular elegibilidad al desconectarse un votante y resolver la votación si todos los elegibles ya votaron.
  - `submitVote` en roomsManagerRedis.ts filtra primero los votos de jugadores ya no elegibles, luego verifica si los votos restantes cubren a todos los elegibles actuales. Si es así, resuelve la votación sin requerir un nuevo voto del jugador que envía la solicitud.
  - `markPlayerDisconnected` ejecuta la misma comprobación cuando un jugador se desconecta: filtra votos, calcula los elegibles conectados y resuelve la votación pendiente si los votos restantes ya cubren a todos los elegibles. El handler de `disconnect` en index.ts emite `roundResult`, `tieVote` o `gameFinished` según el resultado.
- [x] No reabrir una votación resuelta cuando vuelve un jugador; respetar la fase persistida (la validación `NOT_VOTING_PHASE` impide votos en fases incorrectas).
- [x] Antes de iniciar una partida, evitar asignar un turno inicial a ausentes (`advanceToConnectedTurn` en `startWordsRound` y `startNextRound`).
- [x] Probar desconexión del anfitrión, del jugador en turno, del último votante pendiente y de todos los participantes.
  - **Desconexión del anfitrión**: el host se desconecta y `ensureHost` reasigna el rol al jugador conectado más antiguo; `playersUpdated` confirma el nuevo host.
  - **Desconexión del jugador en turno (ronda de palabras)**: `markPlayerDisconnected` avanza `currentTurnIndex` al siguiente conectado mediante `advanceToConnectedTurn` y emite `turnChanged`; la prueba verifica que el servidor avanza el turno sin intervención externa y que los jugadores conectados completan la ronda.
  - **Desconexión de todos los participantes (partida activa)**: la sala conserva la fase `words` en Redis. Si uno vuelve antes de que expire el TTL, `rejoinRoom` reasigna el turno cuando apuntaba a un ausente; la prueba comprueba el snapshot y una palabra aceptada sin modificar Redis manualmente.

**Aceptación:** existe una salida definida para cada bloqueo; la reasignación del anfitrión es coherente y las reglas no conceden acciones a sockets antiguos. Los turnos saltan automáticamente a jugadores conectados.

## 7. Sprint 4 — Calidad, dependencias y entrega

**Archivos principales:** `backend/package.json`, `frontend/package.json`, los lockfiles si hay actualizaciones justificadas, archivos señalados por ESLint y configuración de CI/documentación que se incorpore.

### S4.1 — Consolidar verificaciones · QA-01

- [ ] Resolver los 20 errores iniciales de ESLint sin desactivar reglas globalmente para ocultarlos.
- [ ] Incorporar scripts de test y lint de comprobación, sin `--fix`, y documentar el entorno Node soportado.
- [ ] Ejecutar en CI tipos, lint, regresiones y build de ambos paquetes; incluir Redis de prueba en las comprobaciones de integración.
- [ ] Comprobar una partida completa de cada modo y una partida clásica con empate, reconexión y cambio de anfitrión.
- [ ] Mantener una matriz de pruebas que vincule los IDs del inventario con sus regresiones.

### S4.2 — Auditar dependencias · DEP-01

- [ ] Ejecutar `npm audit --json` en backend y frontend cuando haya acceso al registro.
- [ ] Clasificar cada aviso por versión instalada, uso en producción/desarrollo y alcance real.
- [ ] Actualizar de forma dirigida y revisar el diff del lockfile; no utilizar `npm audit fix --force` indiscriminadamente.
- [ ] Repetir las verificaciones afectadas por las actualizaciones y documentar avisos residuales con motivo y siguiente acción.

**Aceptación:** existe un informe reproducible de dependencias. Un fallo de red se registra como bloqueo, nunca como ausencia de vulnerabilidades.

### S4.3 — Preparar operación y publicación

- [ ] Documentar variables mediante ejemplos sin secretos; `frontend/.env` versionado contenía una variable de URL, lo cual por sí solo no demuestra filtración de credenciales.
- [ ] Revisar HTTPS/WSS, configuración de proxy y límites del proveedor en el entorno real cuando se disponga de acceso.
- [ ] Registrar métricas de errores, rechazos, conflictos Redis y reconexiones sin tokens, roles ni contenido sensible.
- [ ] Preparar compatibilidad de snapshots antiguos, invalidación de tokens expuestos, orden de publicación frontend/backend y reversión.
- [ ] Documentar que una reversión no debe reactivar la exposición de secretos ni las acciones sin autorización.

**Aceptación:** entrega revisable con resultados de pruebas, riesgos pendientes y procedimiento de recuperación. Solicitar autorización solo para publicar cuando exista una entrega concreta lista para revisar.

## 8. Verificación y cierre

Comandos disponibles en el momento de la revisión, ejecutados dentro del paquete indicado:

| Paquete | Comando | Resultado esperado |
| --- | --- | --- |
| Backend | `npx tsc --noEmit` | Sin errores de tipos |
| Backend | `npm run build` | Compilación correcta |
| Frontend | `npm run type-check` | Sin errores de tipos |
| Frontend | `npx eslint .` | Sin errores y sin modificar archivos |
| Frontend | `npm run build` | Build correcto |
| Ambos, por separado | `npm audit --json` | Informe disponible y avisos evaluados |

Los scripts de regresión se añadirán con las tareas que los necesitan. No ejecutar `npm test` hasta que exista un script real. Revisar y retirar únicamente artefactos generados por las propias comprobaciones si aparecen archivos ajenos a la entrega.

Focos de revisión transversales: socket antiguo tras reconexión (S1.2), mutación concurrente con borrado (S2.1), varios usuarios detrás de una IP (S2.2), sesión local corrupta (S3.2) y desconexión de todos los participantes (S3.3).

Para cerrar cada tarea:

- [ ] El fallo original tiene una regresión que detecta el comportamiento vulnerable o incorrecto.
- [ ] La corrección mínima hace pasar esa regresión y las verificaciones relacionadas.
- [ ] No se introducen fugas por otros eventos ni incompatibilidades sin documentar.
- [ ] Se registran resultado, archivos afectados y limitaciones de las pruebas.
- [ ] Se actualiza este documento marcando únicamente trabajo comprobado.

## 9. Seguimiento

| Sprint | Estado | Evidencia de cierre | Riesgos o bloqueos |
| --- | --- | --- | --- |
| 1 | Completado | `tsc --noEmit` y `type-check` sin errores; **11/11 pruebas de integración pasadas con la prueba corregida el 21 de noviembre de 2026** (`test:security`; una ejecución completa): revocación de socket por `rejoinRoom` y `joinRoom` con `playerToken` (rama `joinOrRejoinRoom`), privacidad en `roomJoined` (ruta `room.players` corregida, campos exigidos) y `playersUpdated`, permisos en `submitWord`/`submitVote`/`startNextRound`, rechazo de jugador desconectado (prueba directa del gestor vía manipulación de Redis: `socketId=null` con `submitWord` en fase words; aserciones dentro de `try/finally` para garantizar restauración), redacción de errores (caso conocido con igualdad exacta `message === code` + caso de error interno inesperado corrompiendo Redis que verifica `{code: "UNKNOWN"}` sin exponer marcador sensible), transiciones inválidas y transiciones repetidas (rechazo con `NOT_REVEAL_ROUND`; fase, palabras y votos en Redis intactos antes/después); `socketMap` en pruebas usa `playerId` individuales de cada `roomJoined`; aislamiento garantizado (`loadTestEnv` no hereda `process.env`, backend en puerto libre vía `findFreePort`); `.env.test` en `.gitignore` con plantilla `.env.test.example`; estrategia de invalidación durante el despliegue documentada | Invalidación de tokens expuestos: se ejecutará durante la ventana de mantenimiento al publicar. La casilla "Comprobar fase, pertenencia y permisos en todas las acciones" (S1.2) se traslada a S4.1. |
| 2 | Implementación verificada | Upstash de pruebas: 11 pruebas de atomicidad y 6 de seguridad/operación; regresión Sprint 1: 11/11; tipos y builds de backend/frontend correctos. | Desplegar sin instancias escritoras de la versión anterior. Ajustar cuotas con métricas reales. Publicación pendiente de autorización. |
| 3 | Implementación verificada | `tsc --noEmit` y `type-check` sin errores; `leaveRoom` con handler en index.ts, `exitToHome` emite al servidor, botón de salir en LobbyView; `applySnapshot` restaura estado completo con voto propio y resultado (lastEliminatedName, lastEliminatedWasImpostor); `advanceToConnectedTurn` salta desconectados en turnos; listeners por referencia; gestión de localStorage corrupto y sala expirada; membresía anterior resuelta en createRoom/joinRoom eliminando al jugador de Redis y emitiendo `playersUpdated` a la sala anterior (S3.1); `joinRoom` preserva la recuperación por token al volver a la misma sala; `voteConfirmed` confirma votos con reintento (S3.2); recálculo de elegibilidad en submitVote y resolución de votación al desconectarse un votante (S3.3); `removePlayerFromPreviousRoom` resuelve votación pendiente al cambiar de sala, incluso con votos contra el saliente; `emitVoteResolution` centraliza la emisión de resultados; `markPlayerDisconnected` avanza el turno en fase words/revealRound emitiendo `turnChanged`; pruebas de integración en `sprint3.test.ts`: **10/10 pasadas** (`npm run test:sprint3`), incluidas pruebas exhaustivas de desconexión (S3.3): reasignación de host al desconectarse el anfitrión, avance de turno verificado sin manipular Redis al desconectarse el jugador en turno, y sala abandonada con fase conservada al desconectarse todos los participantes durante una partida activa. | Publicación pendiente de autorización. |
| 4 | Pendiente | — | Auditoría npm requiere red; despliegue aún no inspeccionado |
