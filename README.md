<p align="center">
  <img src="assets/readme-header.png" alt="Opengravity — open-source AI IDE with agents, built for any model" width="100%">
</p>

<h1 align="center">Opengravity</h1>

<p align="center">
  <a href="#english">English</a> ·
  <a href="#spanish">Español</a>
</p>

## Screenshots · Capturas

<p align="center"><strong>A real look at the app / Un vistazo real a la app</strong><br>
Demo workspace: <code>opengravity-demo</code>. No personal data.</p>

<table>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/01-chat.jpg" width="100%" alt="Opengravity agent workspace / espacio de trabajo del agente">
      <br><sub>Agent workspace · Espacio de trabajo del agente</sub>
    </td>
    <td width="50%">
      <img src="docs/screenshots/02-editor.jpg" width="100%" alt="Opengravity editor and agent / editor y agente">
      <br><sub>Editor + agent · Editor + agente</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/03-settings.jpg" width="100%" alt="Opengravity interface settings / ajustes de interfaz">
      <br><sub>Interface Layout · Disposición de la interfaz</sub>
    </td>
    <td width="50%">
      <img src="docs/screenshots/04-project-selector.jpg" width="100%" alt="Opengravity project selector / selector de proyecto">
      <br><sub>Project selector · Selector de proyecto</sub>
    </td>
  </tr>
</table>

<a id="english"></a>

## English

A **multi-provider** desktop IDE with agents: the same coding-assistant
experience, working with local or cloud models, without vendor lock-in.

A standalone Electron app — not an extension — with **Monaco** as the editor,
**LSP** for code intelligence, **MCP** for tools, and integrated **git** and
**terminal**.

> Independent project. It contains no code, assets or branding from any
> proprietary product. See `docs/analysis/` and `docs/design-tokens.md` for the
> reference analysis that informed the design decisions.

### Getting started

Requires **Node 22+**.

```bash
npm install
node node_modules/electron/install.js   # if npm blocks the postinstall
npm run app
```

`npm run app` compiles the TypeScript engine, bundles Monaco and opens the
window.

### Google account and Flow

Image generation uses **Google Flow** with the integrated browser session.
There is no API key and no extra cost:

1. Open **Settings › Google** and click **Connect**.
2. Sign in with your account in the window that opens. Flow opens when you
   finish.
3. Return to the app and ask for an image with `generate_image`.

The session is stored in the integrated browser's persistent partition, so you
only need to sign in once. If no account is connected, the tool returns
instructions instead of opening a hidden login.

### Build the executables (Windows)

```bash
npm run dist
```

This leaves two files in `release/`:

- **`Opengravity-Setup-0.2.0.exe`**: installer (choose a folder, create Start
  Menu and desktop shortcuts).
- **`Opengravity-0.2.0.exe`**: portable, runs without installing.

`npm run dist:dir` builds only the unpacked app (`release/win-unpacked`), useful
for inspecting the contents without installing. Executables are not versioned:
`release/` is in `.gitignore`.

Before distributing the result, `npm run verify:release` checks that the
executables contain the current code (by comparing bytes, not dates), that the
fonts ship with their license, and writes **SHA-256 hashes** to
`release/SHA256SUMS.txt`. **What is still missing and why: see
[`docs/estado.md`](docs/estado.md).**

#### Download without surprises (and without paying for a certificate)

The executables are **not signed**: an Authenticode certificate costs money
every year and this project is free. Windows will show “unknown publisher” during
installation; that is expected, not an error. You can verify that the file you
downloaded is the one that was published:

```powershell
# 1) Hash of the downloaded file
Get-FileHash "Opengravity-Setup-0.2.0.exe" -Algorithm SHA256

# 2) Compare it with the published release hash
Get-Content SHA256SUMS.txt

# 3) If they match, remove the “downloaded from the internet” mark
Unblock-File "Opengravity-Setup-0.2.0.exe"
```

If the hash does not match, do not install it: it is not the published file.
And if you prefer not to install anything, you can always build from source
(`npm run dist`) and compare.

#### Updates

The installed Windows app checks **GitHub Releases** at startup and every six
hours.
0.1.0 did not include the updater: the first update to 0.2.0 must be installed
manually. You can also check manually from **Settings › Application › Updates**.
It downloads only after asking, verifies the published checksum and asks for a
restart. The portable build does not self-update; it links to the new release.
There is no telemetry.

### What's included

#### Agent

- **22 model providers** with automatic model detection and API keys pasted
  from Settings (see `docs/proveedores.md`); parallel detection with timeout,
  manual refresh and keys shared between OpenCode Zen and Go
- **Workspace rules**: `AGENTS.md` and `.agents/rules/*.md` enter the system
  prompt with their own budget (20,000 tokens by default)
- **Work profiles** (`Interface Layout`): *Knowledge Work* responds like a
  document (report, summary, plan) and *Software Engineering* reads, edits and
  verifies code. It changes the prompt's instruction block
  (`electron/personas.cjs`), the same with a local or cloud model. It does not
  restrict tools: measured against the original, neither does it
- **Extended thinking** with a chat button that only appears when the current
  model supports it (Claude 3.7+/4/5 and Gemini 2.5+); it does not switch models
  or enable thinking on other models
- **Parallel subagents with a maximum wait**: several branches at once, each in
  its own worktree when writing, and whatever misses the budget is cancelled
  while the rest is merged (Settings › Execution › *Subagent wait*)
- **File-pattern memory**: a memory can declare `globs` and activates by itself
  when the agent writes a matching file, instead of repeating it every turn
- Open tool catalog: code and notebook reading/writing, search, background
  terminal, MCP, memory, skills, subagents (parallel and read-only nested with a
  budget), plans, `run_extension_code` for temporary extensions, image
  generation and **14 browser actions** (`open`, `read`, `snapshot`, `click`,
  `fill`, `type`, `press`, `select`, `scroll`, `hover`, `wait`, `batch`,
  `navigate`, `eval`) on the integrated Chromium
- Permissions: global preset, per-tool permissions and network rules
- **Optional workspace sandbox**: file paths inside the project, command cwd
  fixed, credentials removed from the environment and process limits (Job Object
  on Windows; process group + `ulimit` on POSIX), with process-tree termination.
  AppContainer is out of scope: a normal command needs the system toolchain, so
  it would require a container with its own Node
- **Diffs with approval** before writing
- **Checkpoints**: undo restores files on disk
- Injectable skills, local profile and MCP servers as plugins, with a **local
  catalog** installable from Settings (no accounts, plans or payments)

#### Editor

- **Monaco** with its own dark theme and per-language highlighting, including
  basic R syntax and the **Nord** theme preset
- **Audio and PDF viewer** in the editor pane (up to 50 MB)
- **Find in page** in the built-in browser with `Ctrl/Cmd+F`
- **Composer attachments**: paste or drop images and files; they appear as
  removable chips and travel with the message.
- **Remote SSH**: direct project mount through WinFsp + SSHFS-Win (Settings ›
  Application › SSH Remote). Files, terminal, commands and tests go to the host;
  LSP and the index still run locally against the mounted drive. The mirror
  project is a fallback for systems without SSHFS-Win.
- GitHub pull requests are read-only in Overview → Review; a token for private
  repositories is stored encrypted from Settings. Workflows from
  `.opengravity/workflows/` are listed and can be run from the same panel.
- **LSP**: completion, diagnostics, go-to-definition, rename, format
  (TypeScript/JavaScript bundled with the project; python/go/rust configurable)
- **Project selector**: recent projects, This Computer with search, New Project
  and No Project; each conversation stores its project separately from the
  workspace
- Tabs, save state, `Ctrl+S`

##### LSP servers

The app does not bundle external language servers. Python, Go and Rust need to
be installed and visible:

- **Go**: `go` and `gopls`. The app adds the standard locations to `PATH`,
  including `GOROOT`, `GOPATH/bin`, `GOBIN` and SDKs under
  `%USERPROFILE%\sdk`. For an arbitrary installation, define `GOROOT`, add its
  `bin` folder to `PATH`, or set the path in **Settings › Developer › Go**.
- **Python**: `pylsp` or `pyright-langserver`. The app prefers the former; if
  neither exists, it shows an error when opening a `.py` file.
- **Rust**: `rust-analyzer` on `PATH`.

The app does not scan disks for these binaries: a path outside the environment
or the locations above is not detected. `lspServers` can pin each server's
command and arguments.

#### Rest of the IDE

- **Terminal** integrated with persistent `cd` (`Ctrl+\``)
- **Git**: branch, modified files, stage, commit and per-file diff
- Faster startup: window first, engine and session repair in the background,
  lazy Monaco and non-blocking provider discovery
- Summary panel with Files, Plugins, Review and Terminal
- Turn navigator, per-response action bar, reactions
- `/` commands and `@` mentions in the composer, including `/btw` for a side
  question that does not touch the thread
- **Bilingual interface**: English and Spanish, with system-language detection
  and a selector in Settings › Application
- Conversation search and persistent sessions in JSONL

### Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` | Send message |
| `Ctrl+N` | New conversation |
| `Ctrl+M` | Model selector |
| `Ctrl+\`` | Terminal |
| `Ctrl+F` | Find in page (browser) |
| `/` | Command palette |
| `@` | Mention a file |
| `Ctrl+S` | Save (editor) |
| `Ctrl+Space` | Autocomplete |
| `F12` | Go to definition |
| `F2` | Rename symbol |
| `Shift+Alt+F` | Format |

### Structure

```
app
├── electron/
│   ├── main.cjs          window, IPC, agent, git, terminal, LSP, app:// protocol
│   ├── preload.cjs       contextBridge bridge
│   ├── tools-extra.cjs   main-process tools
│   ├── diff.cjs          line diff
│   └── lsp.cjs           LSP client (Content-Length)
├── renderer/
│   ├── index.html        interface structure
│   ├── styles.css        tokens and layout
│   ├── app.js            UI logic
│   ├── settings.js       settings panel
│   ├── markdown.js       markdown → HTML
│   ├── highlight.js      chat highlighting
│   ├── icons.js          SVG icon set
│   ├── monaco-entry.js   Monaco entry point (bundled)
│   └── monaco/           bundle generated by build:monaco
├── scripts/build-monaco.mjs
├── src/                  engine: providers, agent, MCP, persistence
└── docs/
    ├── analysis/         reference architecture
    ├── design-tokens.md  UI palette, metrics and structure
    └── proveedores.md    endpoint catalog
```

The renderer has no Node access: everything goes through IPC named
`domain:action`. The engine lives in the main process.

### CLI

To automate or debug the engine without the UI:

```bash
npm run dev -- "summarize this project"
npm run dev -- --provider openai --model gpt-4o-mini "list the files"
npm run dev -- --list-providers
npm run dev -- --provider groq --list
npm run dev -- --mcp-command npx --mcp-arg -y \
  --mcp-arg @modelcontextprotocol/server-filesystem --mcp-arg . --tools
npm run dev -- --list-sessions
```

#### Headless (`agy -p` style)

```bash
# Clean response on stdout; diagnostics on stderr.
npm run dev -- -p "what does src/agent/loop.ts do?" --output-format text

# A JSON envelope with conversation, state and tokens.
npm run dev -- -p "summarize the project" --output-format json

# NDJSON: init → step_update → result.
npm run dev -- -p "find the TODOs" --output-format stream-json

# Persistent conversation over stdin: one result per prompt.
printf '%s\n' \
  '{"event":"user","message":{"content":"what does src/agent/loop.ts do?"}}' \
  '{"event":"user","message":{"content":"summarize the above"}}' \
  | npm run dev -- --input-format stream-json --output-format stream-json

# Continue the latest conversation.
npm run dev -- -p "now fix the first one" -c

# Change effort/mode and allow writes in headless mode.
npm run dev -- -p "fix the test" --effort high --mode accept-edits
npm run dev -- -p "run the tests" --sandbox --mode auto
```

#### TUI

With no prompt and an interactive terminal, `npm run dev` opens the full-screen
chat TUI:

```bash
npm run dev
```

The full TUI accepts `/model`, `/mode`, `/tools`, `/clear`, `/help` and `/exit`.
To return to the line TUI with every session command:

```bash
OPENGRAVITY_LINE_TUI=1 npm run dev
```

In the **line TUI**:

- `/model <id>` changes the model; `/tools` lists the catalog.
- `/mode default|accept-edits|auto|plan` changes permissions on the fly.
- `/permissions`, `/mcp`, `/skills`, `/agents`, `/context` and `/config` show
  the current state.
- `/panel` opens a full-screen panel TUI (Status, Sessions, Tools, Skills,
  Agents, Permissions and MCP); `←/→` switches tabs, `↑/↓` scrolls and `q` exits.
- `/diff`, `/resume`, `/rename`, `/fork`, `/rewind` and `/open` work on the
  workspace; `/rewind` restores files touched by editing tools and, in git
  repositories, changes made by `run_command` (not binaries, ignored files or
  files outside git).
- `/btw` asks a side question without touching the thread; `/swarm` and
  `/teamwork` launch three subagents; `/plan` and `/goal` guide the turn.
- `/help` and `/exit`.
- Sensitive actions ask for `[y/N]` confirmation; `plan` is read-only.
- The app's encrypted keys (`apiKeysEnc`) are decrypted with `safeStorage` when
  the CLI starts; you do not need to enter them again.

#### Permissions and settings

The CLI reads the same `settings.json` as the app (`%APPDATA%/Opengravity` on
Windows, `~/.config/Opengravity` on Linux, `~/Library/Application Support/Opengravity`
on macOS). Explicit flags win. `--sandbox` confines tools to the workspace and
`--add-dir` adds extra roots.

There is no prompt in headless mode: an action that needs approval is rejected.
Use `--dangerously-skip-permissions`, a broader mode (`accept-edits`, `auto`
with `--sandbox`) or rules in `settings.json`:

```json
{
  "permissions": {
    "allow": ["command(git)", "command(regex:^npm run (build|lint|test))"],
    "deny": ["write_file(.env)"]
  }
}
```

The catalog includes editing, search, background commands, tests, workflows,
memory, skills, `invoke_subagent` and `present_plan`; browser and Flow need
Electron and are not registered in the CLI. `--json-schema` validates JSON with
Ajv; it does not just parse it.

### Tests

```bash
npm test
```

`pretest` compiles first, so the suite never tests an old `dist`. No new
dependencies: it uses `node:test`, included with Node 22.

It covers the agent engine, not the interface:

| File | What it tests |
|---|---|
| `cron.test.mjs` | Five-field expressions, validation and next run |
| `guardian.test.mjs` | A–M rubric severity and monitor modes |
| `hooks.test.mjs` | Path rewriting, secret redaction, truncation and text hooks |
| `skills.test.mjs` | Frontmatter, discovery and keeping the body out of the prompt |
| `code-items.test.mjs` | Symbols in TypeScript, Python and Go |
| `trajectory.test.mjs` | Snapshots, revert and persistence after restart |
| `subagents.test.mjs` | Definitions, discovery and selective `kill` |
| `plan-mode.test.mjs` | The four cycle phases and their gates |
| `loop.test.mjs` | Gate, injection, pace monitor, parallelism and timeouts |

### License

MIT. See `LICENSE`.

### Notice

This project is for building your own software. If you use it as a reference
for interoperability with another product, respect its licenses and do not copy
its code, assets or trademarks.

---

<a id="spanish"></a>

## Español

IDE de escritorio con agentes **multi-proveedor**: la misma experiencia de
asistente de código, funcionando con modelos locales o en la nube, sin atarte a
un vendor.

Aplicación Electron propia — no una extensión — con **Monaco** como editor,
**LSP** para inteligencia de código, **MCP** para herramientas, **git** y
**terminal** integrados.

> Proyecto independiente. No contiene código, assets ni branding de ningún
> producto propietario. Ver `docs/analysis/` y `docs/design-tokens.md` para el
> análisis de referencia que motivó las decisiones de diseño.

### Arrancar

Requiere **Node 22+**.

```bash
npm install
node node_modules/electron/install.js   # si npm bloquea el postinstall
npm run app
```

`npm run app` compila el motor TypeScript, empaqueta Monaco y abre la ventana.

### Cuenta de Google y Flow

La generación de imágenes usa **Google Flow** con la sesión del navegador
integrado. No hay clave de API ni coste adicional:

1. Abre **Ajustes › Google** y pulsa **Conectar**.
2. Inicia sesión con tu cuenta en la ventana que se abre. Flow se abre al
   terminar.
3. Vuelve a la app y pide una imagen con `generate_image`.

La sesión se guarda en la partición persistente del navegador integrado, así
que solo hay que iniciar sesión una vez. Si no hay cuenta conectada, la
herramienta devuelve las instrucciones en vez de abrir un login oculto.

### Crear los ejecutables (Windows)

```bash
npm run dist
```

Deja dos ficheros en `release/`:

- **`Opengravity-Setup-0.2.0.exe`**: instalador (elige carpeta, acceso directo
  en el menú Inicio y en el escritorio).
- **`Opengravity-0.2.0.exe`**: portable, se ejecuta sin instalar.

`npm run dist:dir` genera solo la aplicación desempaquetada (`release/win-unpacked`),
útil para comprobar el contenido sin instalar. Los ejecutables no se versionan:
`release/` está en `.gitignore`.

Antes de repartir el resultado, `npm run verify:release` comprueba que los
ejecutables lleven dentro el código de hoy (comparando bytes, no fechas), que
las fuentes vayan con su licencia y deja las **huellas SHA-256** en
`release/SHA256SUMS.txt`. **Qué falta todavía y por qué: ver
[`docs/estado.md`](docs/estado.md).**

#### Descargar sin sustos (y sin pagar un certificado)

Los ejecutables **no van firmados**: un certificado Authenticode cuesta dinero
cada año y este proyecto es libre. Windows mostrará «editor desconocido» al
instalar; es lo esperado, no un error. Lo que sí puedes hacer es comprobar que
el fichero que bajaste es el que se publicó:

```powershell
# 1) Huella del fichero descargado
Get-FileHash "Opengravity-Setup-0.2.0.exe" -Algorithm SHA256

# 2) Compárala con la que se publicó junto a la release
Get-Content SHA256SUMS.txt

# 3) Si coincide, quita la marca de «descargado de internet»
Unblock-File "Opengravity-Setup-0.2.0.exe"
```

Si la huella no coincide, no lo instales: no es el fichero publicado. Y si
prefieres no instalar nada, siempre puedes compilar desde el código
(`npm run dist`) y comparar.

#### Actualizaciones

La app instalada en Windows consulta **GitHub Releases** al arrancar y cada seis
0.1.0 no incluía el actualizador: la primera actualización a 0.2.0 se instala manualmente.
horas. También puedes comprobarlo desde **Ajustes › Application › Updates**.
Descarga solo cuando se lo pides, verifica la huella publicada y pide reiniciar.
El portable no se autoactualiza: enlaza a la nueva release. Sin telemetría.

### Qué incluye

#### Agente

- **22 proveedores** de modelo con autodetección de modelos y claves pegables
  desde Ajustes (ver `docs/proveedores.md`); detección en paralelo con timeout,
  refresco manual y claves compartidas entre OpenCode Zen y Go
- **Reglas del workspace**: `AGENTS.md` y `.agents/rules/*.md` entran al prompt
  de sistema con presupuesto propio (20 000 tokens por defecto)
- **Perfiles de trabajo** (`Interface Layout`): *Knowledge Work* responde como
  documento (informe, resumen, plan) y *Software Engineering* lee, edita y
  verifica código. Cambia el bloque de instrucciones del prompt
  (`electron/personas.cjs`), igual con un modelo local que con uno de la nube.
  No restringe herramientas: medido en el original, tampoco lo hace
- **Pensamiento extendido** con un botón en el chat que solo aparece si el
  modelo actual lo admite (Claude 3.7+/4/5 y Gemini 2.5+); no cambia de modelo
  ni lo activa en otros
- **Subagentes en paralelo con espera máxima**: varias ramas a la vez, cada una en su
  worktree si escribe, y lo que no llega al presupuesto se cancela y se fusiona el
  resto (Ajustes › Ejecución › *Subagent wait*)
- **Memoria por patrón de fichero**: una memoria puede declarar `globs` y entra sola
  cuando el agente escribe en un fichero que encaja, en vez de repetirla cada turno
- Catálogo de herramientas abierto: lectura/escritura de código y cuadernos,
  búsqueda, terminal en segundo plano, MCP, memoria, skills, subagentes (en
  paralelo y anidados de solo lectura con presupuesto), planes,
  `run_extension_code` para extensiones temporales, generación de imágenes y
  **14 acciones de navegador** (`open`, `read`,
  `snapshot`, `click`, `fill`, `type`, `press`, `select`, `scroll`, `hover`,
  `wait`, `batch`, `navigate`, `eval`) sobre el Chromium integrado
- Permisos: preset global, permisos por herramienta y reglas de red
- **Sandbox de workspace opcional**: rutas de fichero dentro del proyecto, cwd de
  comandos fijado, credenciales fuera del entorno y límites de proceso (Job
  Object en Windows; grupo + `ulimit` en POSIX), con terminación del árbol.
  AppContainer queda fuera: un comando normal necesita el toolchain del sistema,
  así que haría falta un contenedor con su propio Node
- **Diffs con aprobación** antes de escribir
- **Checkpoints**: deshacer restaura los ficheros en disco
- Skills inyectables, perfil local y servidores MCP como plugins, con
  **catálogo local** instalable desde Ajustes (sin cuentas, planes ni pagos)

#### Editor

- **Monaco** con tema oscuro propio y resaltado por lenguaje, con sintaxis
  básica de R y el preset **Nord**
- **Visor de audio y PDF** en el panel del editor (hasta 50 MB)
- **Buscar en página** del navegador integrado con `Ctrl/Cmd+F`
- **LSP**: completado, diagnósticos, ir a definición, renombrar, formatear
  (TypeScript/JavaScript incluido en el proyecto; python/go/rust configurables)
- **Adjuntos en el composer**: pega o arrastra imágenes y ficheros; aparecen como
  chips removibles y viajan con el mensaje.
- **SSH remoto**: montaje directo con WinFsp + SSHFS-Win desde Ajustes ›
  Application › SSH Remote. Ficheros, terminal, comandos y tests van al host;
  LSP e índice siguen siendo locales sobre la unidad montada. El proyecto espejo
  queda como fallback para sistemas sin SSHFS-Win.
- Los pull requests de GitHub se consultan en Overview → Review; el token para
  repos privados se guarda cifrado desde Ajustes. Los workflows de
  `.opengravity/workflows/` se listan y ejecutan desde ese panel.
- **Selector de proyecto**: recientes, This Computer con búsqueda, New Project
  y No Project; la conversación guarda su proyecto aparte del workspace.
- Pestañas, estado de guardado, `Ctrl+S`

##### Servidores LSP

La app no empaqueta servidores externos. Para Python, Go y Rust hay que tenerlos
instalados y visibles:

- **Go**: `go` y `gopls`. La app añade al `PATH` las rutas estándar, `GOROOT`,
  `GOPATH/bin`, `GOBIN` y los SDK de `%USERPROFILE%\sdk`. Para una instalación
  arbitraria, define `GOROOT`, añade su carpeta `bin` al `PATH` o fija la ruta
  en **Ajustes › Developer › Go**.
- **Python**: `pylsp` o `pyright-langserver`. La app prefiere el primero; si no
  hay ninguno, muestra un error al abrir un `.py`.
- **Rust**: `rust-analyzer` en el `PATH`.

No se escanean discos en busca de estos binarios: una ruta que no esté en el
entorno o en las rutas anteriores no se detecta. `lspServers` permite fijar el
comando y los argumentos de cada servidor.

#### Resto del IDE

- **Terminal** integrada con `cd` persistente (`Ctrl+\``)
- **Git**: rama, ficheros modificados, stage, commit y diff por fichero
- Arranque más rápido: ventana primero, motor y reparación de sesiones en
  segundo plano, Monaco bajo demanda y proveedores sin bloquear
- Panel de resumen con Files, Plugins, Review y Terminal
- Navegador de turnos, barra de acciones por respuesta, reacciones
- Comandos `/` y menciones `@` en el composer, incluido `/btw` para una
  pregunta lateral que no toca el hilo
- **Interfaz bilingüe**: inglés y español, con detección del idioma del sistema y selector en Ajustes › Application
- Búsqueda de conversaciones, sesiones persistentes en JSONL

### Atajos

| Atajo | Acción |
|---|---|
| `Ctrl+Enter` | Enviar mensaje |
| `Ctrl+N` | Nueva conversación |
| `Ctrl+M` | Selector de modelo |
| `Ctrl+\`` | Terminal |
| `Ctrl+F` | Buscar en página (navegador) |
| `/` | Paleta de comandos |
| `@` | Mencionar fichero |
| `Ctrl+S` | Guardar (editor) |
| `Ctrl+Space` | Autocompletado |
| `F12` | Ir a definición |
| `F2` | Renombrar símbolo |
| `Shift+Alt+F` | Formatear |

### Estructura

```
app
├── electron/
│   ├── main.cjs          ventana, IPC, agente, git, terminal, LSP, protocolo app://
│   ├── preload.cjs       puente contextBridge
│   ├── tools-extra.cjs   herramientas del proceso principal
│   ├── diff.cjs          diff por líneas
│   └── lsp.cjs           cliente LSP (Content-Length)
├── renderer/
│   ├── index.html        estructura de la interfaz
│   ├── styles.css        tokens y layout
│   ├── app.js            lógica de la UI
│   ├── settings.js       panel de ajustes
│   ├── markdown.js       markdown → HTML
│   ├── highlight.js      resaltado para el chat
│   ├── icons.js          set de iconos SVG
│   ├── monaco-entry.js   entrada de Monaco (se empaqueta)
│   └── monaco/           bundle generado por build:monaco
├── scripts/build-monaco.mjs
├── src/                  motor: proveedores, agente, MCP, persistencia
└── docs/
    ├── analysis/         arquitectura de referencia
    ├── design-tokens.md  paleta, métricas y estructura de la UI
    └── proveedores.md    catálogo de endpoints
```

El renderer no tiene acceso a Node: todo pasa por IPC con nombres
`dominio:accion`. El motor vive en el proceso principal.

### CLI

Para automatizar o depurar el motor sin interfaz:

```bash
npm run dev -- "resume este proyecto"
npm run dev -- --provider openai --model gpt-4o-mini "lista los ficheros"
npm run dev -- --list-providers
npm run dev -- --provider groq --list
npm run dev -- --mcp-command npx --mcp-arg -y \
  --mcp-arg @modelcontextprotocol/server-filesystem --mcp-arg . --tools
npm run dev -- --list-sessions
```

#### Headless (estilo `agy -p`)

```bash
# Respuesta limpia por stdout; diagnósticos por stderr.
npm run dev -- -p "¿qué hace src/agent/loop.ts?" --output-format text

# Un sobre JSON con conversación, estado y tokens.
npm run dev -- -p "resume el proyecto" --output-format json

# NDJSON: init → step_update → result.
npm run dev -- -p "busca los TODO" --output-format stream-json

# Conversación persistente por stdin: un result por prompt.
printf '%s\n' \
  '{"event":"user","message":{"content":"¿qué hace src/agent/loop.ts?"}}' \
  '{"event":"user","message":{"content":"resume lo anterior"}}' \
  | npm run dev -- --input-format stream-json --output-format stream-json

# Continuar la última conversación.
npm run dev -- -p "ahora arregla el primero" -c

# Cambiar esfuerzo/modo y permitir escrituras en headless.
npm run dev -- -p "arregla el test" --effort high --mode accept-edits
npm run dev -- -p "ejecuta los tests" --sandbox --mode auto
```

#### TUI

Sin encargo y con una terminal interactiva, `npm run dev` abre la TUI de chat
a pantalla completa:

```bash
npm run dev
```

La TUI completa acepta `/model`, `/mode`, `/tools`, `/clear`, `/help` y `/exit`.
Para volver a la TUI de línea con todos los comandos de sesión:

```bash
OPENGRAVITY_LINE_TUI=1 npm run dev
```

En la **TUI de línea**:

- `/model <id>` cambia de modelo; `/tools` lista el catálogo.
- `/mode default|accept-edits|auto|plan` cambia permisos en caliente.
- `/permissions`, `/mcp`, `/skills`, `/agents`, `/context` y `/config` muestran el estado.
- `/panel` abre una TUI de paneles a pantalla completa (Estado, Sesiones, Herramientas, Skills, Agentes, Permisos y MCP); `←/→` cambia de pestaña, `↑/↓` desplaza y `q` sale.
- `/diff`, `/resume`, `/rename`, `/fork`, `/rewind` y `/open` trabajan sobre el workspace;
  `/rewind` restaura los ficheros tocados por las herramientas de edición y, en
  repos git, los cambios de `run_command` (no binarios, ignorados ni fuera de git).
- `/btw` hace una pregunta lateral sin tocar el hilo; `/swarm` y `/teamwork` lanzan
  tres subagentes; `/plan` y `/goal` orientan el turno.
- `/help` y `/exit`.
- Las acciones sensibles piden confirmación `[y/N]`; `plan` es solo lectura.
- Las claves cifradas de la app (`apiKeysEnc`) se descifran con `safeStorage` al
  arrancar el CLI; no hace falta volver a escribirlas.

#### Permisos y ajustes

El CLI lee el mismo `settings.json` que la app (`%APPDATA%/Opengravity` en
Windows, `~/.config/Opengravity` en Linux, `~/Library/Application Support/Opengravity`
en macOS). Los flags explícitos mandan. `--sandbox` confina las herramientas al
workspace y `--add-dir` añade raíces adicionales.

En headless no hay prompt: una acción que requiere aprobación se rechaza. Usa
`--dangerously-skip-permissions`, un modo más amplio (`accept-edits`, `auto`
con `--sandbox`) o reglas en `settings.json`:

```json
{
  "permissions": {
    "allow": ["command(git)", "command(regex:^npm run (build|lint|test))"],
    "deny": ["write_file(.env)"]
  }
}
```

El catálogo incluye edición, búsqueda, comandos en segundo plano, tests,
workflows, memoria, skills, `invoke_subagent` y `present_plan`; navegador y Flow
necesitan Electron y no se registran en el CLI. `--json-schema` valida el JSON
con Ajv, no solo lo parsea.

### Licencia

MIT. Ver `LICENSE`.

### Aviso

Este proyecto es para construir software propio. Si lo usas como referencia para
interoperar con otro producto, respeta sus licencias y no copies su código,
assets ni marcas.

### Tests

```bash
npm test
```

`pretest` compila antes de correr, así que la suite nunca prueba un `dist` viejo.
Sin dependencias nuevas: usa `node:test`, que viene con Node 22.

Cubre el motor del agente, no la interfaz:

| Fichero | Qué prueba |
|---|---|
| `cron.test.mjs` | Expresiones de 5 campos, validación y próxima ejecución |
| `guardian.test.mjs` | Severidad de la rúbrica A–M y modos del monitor |
| `hooks.test.mjs` | Reescritura de rutas, redacción de secretos, truncado, hooks de texto |
| `skills.test.mjs` | Frontmatter, descubrimiento y que el cuerpo no entre en el prompt |
| `code-items.test.mjs` | Símbolos en TypeScript, Python y Go |
| `trajectory.test.mjs` | Snapshots, reversión y persistencia tras reiniciar |
| `subagents.test.mjs` | Definiciones, búsqueda y `kill` selectivo |
| `plan-mode.test.mjs` | Las cuatro fases del ciclo y sus compuertas |
| `loop.test.mjs` | Compuerta, inyección, monitor de ritmo, paralelismo y timeouts |
