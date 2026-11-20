# ¿Está lista para entregar?

**No al 100 %: es todo lo que se puede demostrar en esta máquina.**
Todo lo que estaba abierto tiene prueba: acceso a ficheros confinado, paridad
visual medida contra el original, historial de git limpio, un encargo completo
ejecutado (tres ficheros, terminal, subagente y revert) y **601 pruebas en verde**
(2026-11-20).
La firma no se paga: se publica la huella SHA-256 de cada ejecutable.

Lo único que **no** se ha probado es macOS y Linux: el desarrollo y toda la
verificación son en Windows.

Este documento dice qué está comprobado, cómo, y qué queda como decisión o
mejora, para que no dependa de que yo me acuerde.

Para no fiarme de mi propia memoria, la parte que sí se puede comprobar con
máquina está en un verificador:

```bash
npm run verify:release
```

Comprueba que los ejecutables lleven dentro el código de hoy (comparando
**bytes**, no fechas), que las fuentes vayan con su licencia y que el motor esté
compilado. Hoy responde:

```
OK   el asar lleva los 232 ficheros del código, idénticos byte a byte (más 38 .d.ts ignorados: son tipos)
OK   release/Opengravity-Setup-0.3.0.exe (96615 KB) es posterior al asar
AVISO release/Opengravity-Setup-0.3.0.exe: SIN firma Authenticode (Windows dirá «editor desconocido»)
OK   release/Opengravity-0.3.0.exe (88412 KB) es posterior al asar
AVISO release/Opengravity-0.3.0.exe: SIN firma Authenticode (Windows dirá «editor desconocido»)
OK   7 fuentes con assets/fonts/OFL.txt al lado
OK   compilado: dist/index.js
OK   compilado: dist/agent/loop.js
```

Con eso el veredicto es **«entregable, con lo avisado a la vista»**: los 232
ficheros del código del paquete coinciden byte a byte con el disco. Lo que queda
en rojo es la firma, que no es código.

Los binarios **0.3.0** están generados y verificados con
`npm run verify:release`; las huellas SHA-256 están en
`release/SHA256SUMS.txt`.

---

## Lo que sí está comprobado

| Cosa | Cómo se comprobó |
|---|---|
| Compila | `npm run build`, sin errores |
| Pruebas | 601 casos, 0 fallos (2026-11-20) |
| El paquete lleva el código actual | 232 ficheros comparados byte a byte contra el disco (`npm run verify:release`) |
| Actualizador | `electron-updater` con comprobación de versión, progreso y verificación SHA-256 |
| El cierre mata sus procesos | Un hijo real de 10 minutos murió y se confirmó antes de devolver el control, en 86 ms |
| El nivel de pensamiento llega al proveedor | Petición `fetch` interceptada: `reasoning_effort` aparece en el cuerpo real |
| El contexto sigue al modelo | llama3.2:8k 384 000 → 24 000 caracteres; gemini-2.5-pro → 3 000 000 |
| Las fuentes tienen licencia | Leída la tabla de nombres dentro de cada `.woff2`: SIL OFL 1.1; KaTeX viaja con su `LICENSE` (MIT) |
| La arena de procesos es real | Job Object de Windows, arranque con `CREATE_SUSPENDED` |
| No se sirven ficheros fuera de la app | `protocol-path.cjs` + 6 pruebas |
| Un encargo completo funciona | 3 ficheros, terminal con salida real, subagente y revert (2026-11-19) |
| El binario empaquetado arranca y funciona | `release/win-unpacked/Opengravity.exe`: árbol de ficheros, Monaco, xterm, KaTeX y ajustes, sin errores (2026-11-19) |

---

## Incidente del 2026-11-16: «[object Object]» en el historial

Al reabrir conversaciones, cada mensaje se pintaba como `[object Object]`.

- **Causa.** `redactarSecretos` pasó a devolver `{ texto, encontrados }` y
  `mensajesParaDisco` guardaba ese **objeto** como `content`. Al releer, el
  renderizador hacía `String(objeto)`. El mismo cambio rompía `redactarDatos`,
  que hacía `JSON.parse` del objeto.
- **Alcance.** 319 mensajes en 16 ficheros de sesión (198 de ellos del día).
- **Arreglo.** Se usa `.texto` en los dos sitios; `titleFrom` y la persistencia
  toleran contenido que no sea texto; los adaptadores normalizan deltas que
  llegan como lista de partes (`textoDeDelta`, 6 pruebas) para que un gateway
  no pueda reintroducir el mismo síntoma.
- **Reparación.** `JsonlSessionStore.repararContenidoObjeto()` recupera el texto
  de cada mensaje dañado, reescribe solo los ficheros afectados y corre al
  arrancar (idempotente, 3 pruebas). Aplicada aquí: **319 de 319 recuperados**;
  una conversación reparada abre con su texto y sin `[object Object]`.
- **Copia previa.** `%USERPROFILE%/sesiones-antes-de-reparar.tgz` (362 KB).

## Estado de lo que estaba abierto

### 1. El acceso a ficheros está confinado (resuelto el 2026-11-15)

`fs:read`, `fs:write`, `fs:list` e `image:as-data-url` resuelven la ruta con
`electron/rutas.cjs` y fallan si queda fuera de las raíces autorizadas. Las
raíces son el workspace abierto **más la carpeta de cualquier fichero que el
usuario elija en un diálogo**: abrir `~/notas.md` autoriza `~/`, no todo el
disco. `test/rutas.test.mjs` fija los cinco casos (dentro, `..`, ruta absoluta
ajena, prefijo de otro directorio y carpeta autorizada a mano).

Las menciones `@` del chat pasan por la misma comprobación. Las herramientas
del agente siguen con su propio interruptor (`restrictToWorkspace`), que ahora
es una segunda capa sobre la misma idea.

### 2. Los ejecutables no están firmados: decisión tomada, no deuda

Windows mostrará «editor desconocido» al instalar. Firmar cuesta dinero y se
renueva cada año, así que **un proyecto libre no firma**: se publica la huella
del fichero y se deja que cada cual compruebe lo que descarga.

Eso es lo que hace ahora `npm run verify:release`: además de comparar el asar
byte a byte, escribe `release/SHA256SUMS.txt` con el SHA-256 de los dos `.exe`.
El README explica cómo compararla (`Get-FileHash`), cómo quitar la marca de
«descargado de internet» (`Unblock-File`) y que, si la huella no coincide, no se
instala. Es lo mismo que hacen los proyectos libres que no pagan certificado.

Queda un camino gratis real si algún día molesta el aviso: **SignPath.io** firma
gratis proyectos open source (hay que solicitarlo y que lo aprueben). No se ha
hecho porque no cambia nada del código y exige una cuenta y una revisión.

Lo que la huella **no** resuelve: que Windows avise igualmente antes de
ejecutar. Solo un certificado de confianza evita ese aviso.

### 3. El historial de git ya no contiene los ficheros retirados (resuelto)

Los siete documentos copiados de Antigravity seguían en el commit inicial aunque
ya no estuvieran en el árbol. Se reescribió el historial completo (41 commits, los
mismos mensajes y fechas) quitando esas rutas de todos los commits:

- Antes de tocar nada, copia completa: `git bundle create
  ../opengravity-antes-de-purgar.bundle --all` (3,6 MB, comprobada con
  `git bundle verify`). Sigue en la carpeta padre.
- La reescritura se hizo en un clon limpio (`git filter-branch --index-filter`)
  y después se cambió el `.git`, porque el árbol de trabajo tiene 47 ficheros
  modificados y `filter-branch` se niega a reescribir con cambios sin commitear.
- Verificado: `git log --all -- docs/antigravity/estilos.css` devuelve **0**;
  `git fsck --full` no encuentra nada; siguen los mismos 153 ficheros rastreados
  y `git diff` muestra solo los 48 de trabajo. El repo pasó de 13 MB a 3,5 MB.

Lo que cambia para ti: **todos los hashes son nuevos**. Si tenías un clon, hay
que volver a clonar; para eso está el bundle.

### 4. El encargo completo también se ha ejecutado (2026-11-19)

Primero un turno suelto (que destapó el `ReferenceError` de `PROVIDER_CATALOG`).
Después el encargo largo, en un workspace desechable y con proveedor real:

1. «Crea tres ficheros (`saludos.js`, `pruebas.js`, `README.md`) y ejecuta
   `node pruebas.js`» → los tres ficheros se escribieron con el contenido
   correcto (comprobado en disco y ejecutado a mano: `Prueba superada:
   saludar() === 'hola'`), la terminal devolvió la salida y el código 0, y la
   tarjeta de cambios marcó `3 archivos cambiados +24 −0`.
2. «Lanza un subagente de solo lectura que los revise» → el subagente propuso
   mejoras sin tocar nada, y los ficheros quedaron intactos.
3. «Deshacer hasta aquí» sobre el primer paso → el modal listó los tres ficheros
   como `BORRAR`, y al confirmar el workspace quedó **vacío**.

Sesión de prueba borrada y preferencias restauradas al terminar. Lo que sigue sin
probarse es macOS y Linux: el desarrollo y toda la verificación son en Windows.

### 5. La paridad visual: medida el 2026-11-15, ya no es una incógnita

Se midió la interfaz de Antigravity y la nuestra con el mismo método en la misma
máquina (ventana emulada a 1440×900, `getBoundingClientRect` y
`getComputedStyle` sobre el DOM real, no capturas). Coinciden ahora: hoja del
panel `1175×817` en `(257,75)` con radio 12, composer del estado vacío
`768×118` en `(461,750)`, composer con hilo `768×82` en `(293,794)`, tarjeta
Overview `320×166` a 12 px del borde de la hoja, ajustes `1024×720` en
`(208,90)`, y los iconos de ventana los dibuja el sistema (`titleBarOverlay`),
como en el original.

Lo que **sigue** distinto:

- **Voice mode** existe en la pantalla de ajustes del original y aquí no: usa
  Gemini Live (audio bidireccional), que es otra integración, no un ajuste.
- La etiqueta del proyecto en el composer: el original muestra `No Project`
  como selector de proyecto; nosotros mostramos el workspace abierto.
- Las fórmulas se pintan con KaTeX desde esta pasada; las tablas de math anchas
  ya llevan desplazamiento horizontal, pero no se comparó cada caso.

**Interface Layout** ya está (2026-11-15), y con una corrección que costó una
medición: el perfil **no** restringe herramientas.

En el original el ajuste escribe `customPersona.skin` (`PRODUCT_SKIN_DEVELOPER` /
`PRODUCT_SKIN_NON_TECHNICAL`). Probado en vivo con *Knowledge Work* activo, la
petición «Ejecuta en la terminal: echo ANTIGRAVITY-KW-TEST» se ejecutó y devolvió
la salida. Es decir: su skin cambia persona y sugerencias, no permisos. La primera
versión de este ajuste aquí bloqueaba `write_file` y `run_command` en el perfil de
conocimiento; se retiró al comprobar que el original no lo hace.

Lo que queda, verificado: el perfil cambia el bloque de instrucciones que recibe el
modelo (`electron/personas.cjs`, inyectado desde `buildPromptExtras`), tanto en el
turno como en el sub-turno del planificador. Las tarjetas miden 305×114 frente a
306×112. Sus `suggestions[]` con plugins oficiales no se copian.

### 6. Orquestación: qué había, qué se ha cerrado (2026-11-19)

La lista anterior era **falsa en su primera línea**: los subagentes ya iban en
paralelo (`Promise.all`, máximo 5 por llamada, presupuesto compartido, worktree
aislado y un nivel de delegación anidada de solo lectura). Lo que faltaba era
otra cosa, y se ha hecho:

| Diferencia | Estado |
|---|---|
| **Latencia de fusión** (`merge_subagents_latency_ms`) | **Resuelto y medido.** `electron/subagent-merge.cjs` lanza las ramas a la vez con un presupuesto por subagente; lo que no llega a tiempo se aborta y se fusiona el resto, con el aviso «N cancelado(s) por tiempo». Ajustable en Ajustes › Ejecución › *Subagent wait* (1/2/3/5 min o sin límite; por defecto 3 min), visible en la app: «Espera de subagentes · 3 minutos». 5 pruebas, incluida la que comprueba que tres ramas de 120 ms tardan menos de 330 ms en total. |
| **Memoria por patrón de fichero** (`CORTEX_MEMORY_TRIGGER_GLOB`) | **Resuelto y probado en vivo.** Una memoria declara `globs`; al escribir en un fichero que encaja entra en el paso siguiente (máx. 3 por turno). Con la memoria «usa pnpm» y glob `*.md`, un turno que creó `notas.md` dejó en la sesión guardada: `[memoria activada por notas.md]`. Emparejador propio (`*`, `**`, `?`, Windows) con 4 pruebas. |
| **Compartir trayectoria** (`ShareTrajectoryByUser`) | **Cerrado como fichero, no como enlace.** Esa cadena no existe en el binario 2.31 actual, así que no hay UI que copiar; exportar una conversación ahora deja también `<nombre>.trajectory.json` con los pasos y sus snapshots, que es lo que necesita quien la recibe. Sin servidores. |

Lo que sigue siendo distinto de verdad:

- **Subagentes anidados.** Ellos pueden anidar sin decir cuánto; nosotros un
  nivel y solo de lectura, para que el coste esté acotado.
- **Dispersión de la fusión.** No sé si su `merge_subagents_latency_ms` mide
  espera por rama o por lote: el nombre lo dice, el código no lo he visto.

Y una incógnita sobre el original, no sobre nosotros: **no sé** si sus niveles
de pensamiento cambian de verdad la petición al modelo. Leí sus nombres dentro
del binario, no lo ejecuté. Sería un error afirmar que lo copiamos bien por eso.

---

## Resumen en una línea

App que funciona y está verificada de punta a punta en Windows: el paquete lleva
el código de hoy byte a byte, la interfaz está medida contra el original, el
acceso a ficheros está confinado, el historial no contiene material ajeno y un
encargo completo se ejecutó de verdad. Lo que queda es decisión de producto
(perfiles de sugerencias, orquestación) o plataforma (macOS y Linux).
