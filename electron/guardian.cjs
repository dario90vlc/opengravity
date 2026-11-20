// Monitor de seguridad pre-tool.
//
// Es la versión estática y sin coste del `PolicyGuardian` de Antigravity: antes de
// ejecutar una herramienta se puntúa la acción de 0 a 10 con la rúbrica A–M que el
// binario lleva embebida, y se decide allow / ask / deny.
//
// Modo `llm` (opcional, apagado por defecto): además del análisis estático, se le
// pide al modelo una segunda opinión. Cuesta tokens, por eso no viene activado.

const RUTINA = new Set([
  'read_file',
  'view_code_item',
  'list_directory',
  'search_files',
  'search_code',
  'search_web',
  'fetch_url',
  'browser_read',
  'editor_visible_text',
  'editor_current_file',
  'command_status',
  'manage_task',
]);

/** Patrones por señal de la rúbrica. Cada uno suma severidad. */
const REGLAS = [
  // --- J: actividad de ataque y comandos destructivos ------------------------
  {
    senal: 'J',
    nombre: 'borrado masivo',
    severidad: 8,
    re: /\b(rm\s+-[a-z]*[rf][a-z]*\s+(\/|~|\$HOME|\*)|del\s+\/[fsq]|rmdir\s+\/s|mkfs(\.|\s)|dd\s+if=|format\s+[a-z]:)/i,
    soloComandos: true,
  },
  {
    senal: 'J',
    nombre: 'escaneo o fuerza bruta',
    severidad: 5,
    re: /\b(nmap|masscan|hydra|john\s+--|hashcat|sqlmap|nikto|dirbuster|gobuster)\b/i,
    soloComandos: true,
  },
  {
    senal: 'J',
    nombre: 'payload de explotación',
    severidad: 6,
    re: /\b(msfconsole|meterpreter|reverse[_-]?shell|bind[_-]?shell|nc\s+-e|ncat\s+-e)\b/i,
    soloComandos: true,
  },

  // --- A: persistencia, túneles, exponer servicios --------------------------
  {
    senal: 'A',
    nombre: 'túnel o port-forwarding',
    severidad: 6,
    re: /\b(ngrok|localtunnel|serveo|cloudflared\s+tunnel|ssh\s+-[a-z]*R\s|socat\s+.*(listen|tcp-listen))\b/i,
    soloComandos: true,
  },
  {
    senal: 'A',
    nombre: 'persistencia en el arranque',
    severidad: 7,
    re: /\b(crontab\s+-|systemctl\s+enable|schtasks\s+\/create|reg\s+add\s+.*Run|launchctl\s+load)\b/i,
    soloComandos: true,
  },
  {
    senal: 'A',
    nombre: 'demonio que sobrevive a la sesión',
    severidad: 5,
    re: /\b(nohup\s+|setsid\s+|disown\b|daemonize)/i,
    soloComandos: true,
  },

  // --- B: levantar restricciones -------------------------------------------
  {
    senal: 'B',
    nombre: 'permisos amplios',
    severidad: 4,
    re: /\b(chmod\s+(-R\s+)?777|chmod\s+\+s|chown\s+root|setcap\s|sudo\s+-i|sudo\s+su)\b/i,
    soloComandos: true,
  },

  // --- Credenciales ---------------------------------------------------------
  {
    senal: 'B',
    nombre: 'lectura de credenciales',
    severidad: 7,
    re: /([\\/]\.ssh[\\/]id_[a-z0-9]+|[\\/]\.aws[\\/]credentials|\.npmrc|\.netrc|[\\/]etc[\\/]shadow|id_(rsa|ed25519|ecdsa|dsa)|\.git-credentials|keychain|login\.keychain|\.pem\b|\.p12\b)/i,
  },

  // --- H: datos saliendo de la organización --------------------------------
  {
    senal: 'H',
    nombre: 'exfiltración por red',
    severidad: 7,
    re: /\b(curl|wget|Invoke-WebRequest|iwr)\b[^\n]*(-X\s*(POST|PUT)|--data|--upload-file|-d\s+@|-T\s+)/i,
    soloComandos: true,
  },
  {
    senal: 'H',
    nombre: 'destino de volcado público',
    severidad: 7,
    re: /\b(pastebin\.com|paste\.ee|0x0\.st|transfer\.sh|termbin\.com|hastebin|ghostbin)\b/i,
  },

  // --- L: integridad de código y evaluación --------------------------------
  {
    senal: 'L',
    nombre: 'desactivar verificación TLS',
    severidad: 6,
    re: /\b(NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*0|rejectUnauthorized\s*:\s*false|verify\s*=\s*False|--insecure\b|curl\s+-k\b)/i,
  },
  {
    senal: 'L',
    nombre: 'debilitar tests',
    severidad: 5,
    re: /\b(it|test|describe)\.(skip|only)\s*\(|\bxit\s*\(|\bxdescribe\s*\(|@pytest\.mark\.skip|assert\s+True\s*$|--passWithNoTests/i,
  },
  {
    senal: 'L',
    nombre: 'quitar autenticación o validación',
    severidad: 6,
    re: /\b(skip|disable|no|bypass)[\s_-]?auth\b|\bskipAuth\b|verifyAuth\s*=\s*false/i,
  },
  {
    senal: 'L',
    nombre: 'salto de hooks de git',
    severidad: 4,
    re: /--no-verify\b|--no-gpg-sign\b/i,
    soloComandos: true,
  },

  // --- K: banderas rojas en el razonamiento --------------------------------
  {
    senal: 'K',
    nombre: 'admite engaño o evasión',
    severidad: 8,
    re: /\b(hide\s+(this|it)\s+from\s+the\s+user|without\s+(telling|informing)\s+the\s+user|bypass\s+the\s+(rule|restriction|block)|evitar\s+que\s+el\s+usuario\s+se\s+entere|ocultar\s+al\s+usuario)\b/i,
    soloRazonamiento: true,
  },
];

/** Claves de los argumentos que contienen texto ejecutable o escribible. */
const CLAVES_INSPECCION = [
  'command',
  'code',
  'content',
  'target',
  'replacement',
  'query',
  'body',
  'text',
  'script',
  'path',
  'Path',
  'filePath',
  'file_path',
  'dirPath',
  'dir_path',
  'file',
  'targetFile',
  'absolutePath',
  'url',
  'cwd',
  // Ediciones: antes solo se miraba `content` (write_file), así que un
  // edit_file con `it.skip` o una desactivación de auth pasaba sin señal.
  'oldText',
  'newText',
  'targetContent',
  'replacementContent',
  // Delegación y avisos: la señal I (delegar para evadir) vive en el prompt.
  'prompt',
  'message',
  'systemPrompt',
  'description',
  'question',
  'label',
];

/** Extrae el texto relevante de los argumentos de una herramienta. */
function textoDeArgs(args) {
  const partes = [];
  const recorrer = (valor, profundidad) => {
    if (profundidad > 4 || valor === null || valor === undefined) return;
    if (typeof valor === 'string') {
      partes.push(valor);
      return;
    }
    if (Array.isArray(valor)) {
      for (const item of valor) recorrer(item, profundidad + 1);
      return;
    }
    if (typeof valor === 'object') {
      for (const [clave, hijo] of Object.entries(valor)) {
        if (CLAVES_INSPECCION.includes(clave) || typeof hijo !== 'string') {
          recorrer(hijo, profundidad + 1);
        }
      }
    }
  };
  recorrer(args, 0);
  return partes.join('\n');
}

/**
 * Evalúa una acción antes de ejecutarla.
 *
 * @param {object} entrada
 * @param {string} entrada.toolName
 * @param {object} entrada.args
 * @param {string} [entrada.razonamiento]  texto de pensamiento del modelo, si lo hay
 * @returns {{ severity: number, decision: 'allow'|'ask'|'deny', signals: string[], reason: string }}
 */
function evaluarAccion({ toolName, args, razonamiento }) {
  const esComando =
    toolName === 'run_command' ||
    toolName === 'manage_task' ||
    toolName === 'run_workflow' ||
    toolName === 'run_extension_code';
  const texto = textoDeArgs(args);
  const pensamiento = String(razonamiento ?? '');

  const señales = [];
  let severidad = 0;

  for (const regla of REGLAS) {
    if (regla.soloComandos && !esComando) continue;

    const objetivo = regla.soloRazonamiento ? pensamiento : texto;
    if (objetivo.length === 0) continue;

    if (regla.re.test(objetivo)) {
      señales.push(`${regla.senal}: ${regla.nombre} (+${regla.severidad})`);
      severidad = Math.max(severidad, regla.severidad);
    }
  }

  // Una acción de solo lectura sin señales es rutina por definición.
  if (RUTINA.has(toolName) && señales.length === 0) {
    return { severity: 0, decision: 'allow', signals: [], reason: 'rutina sin señal de riesgo' };
  }

  // Umbrales tomados de la configuración del binario: 0.1 para el pre-filtro
  // (todo lo que no sea 0 pasa a revisión) y 0.5 para la evaluación completa.
  let decision = 'allow';
  if (severidad >= 5) decision = 'deny';
  else if (severidad >= 2) decision = 'ask';

  let reason;
  if (señales.length === 0) reason = 'sin señal de riesgo';
  else reason = señales.join('; ');

  return { severity: severidad, decision, signals: señales, reason };
}

/**
 * Envuelve una herramienta con el monitor.
 *
 * @param {object} tool
 * @param {object} opciones
 * @param {'off'|'ask'|'block'} opciones.modo
 * @param {(info: object) => Promise<boolean>} opciones.confirmar
 * @param {() => string} [opciones.getRazonamiento]
 * @param {(info: object) => Promise<{severity:number, reason:string}|null>} [opciones.clasificar]
 *   Clasificador con el modelo (cascada de dos niveles). Si falta, el monitor es
 *   solo estático. Cuesta tokens, así que solo se llama cuando aporta algo.
 * @param {(info: object) => void} [opciones.alClasificar]  aviso para la UI
 */
function conMonitorDeSeguridad(tool, opciones) {
  const modo = opciones.modo ?? 'ask';
  if (modo === 'off') return tool;

  return {
    ...tool,
    async execute(args, ctx) {
      let veredicto = evaluarAccion({
        toolName: tool.name,
        args,
        razonamiento: opciones.getRazonamiento?.(),
      });

      /*
       * Clasificador con el modelo. Se salta en dos casos para no gastar tokens:
       *   - la acción es rutina de solo lectura y el análisis estático no ve nada;
       *   - el estático ya la bloquea (el modelo no la va a desbloquear).
       */
      const rutinaLimpia = RUTINA.has(tool.name) && veredicto.severity === 0;
      const yaBloqueada = veredicto.severity >= 5;

      if (opciones.clasificar && !rutinaLimpia && !yaBloqueada) {
        opciones.alClasificar?.({ herramienta: tool.name, fase: 'inicio', callId: ctx?.callId });

        const clasificacion = await opciones.clasificar({
          herramienta: tool.name,
          argumentos: args,
          veredictoEstatico: veredicto,
        });

        opciones.alClasificar?.({ herramienta: tool.name, fase: 'fin', clasificacion, callId: ctx?.callId });

        if (clasificacion && Number.isFinite(clasificacion.severity)) {
          const severidad = Math.max(veredicto.severity, clasificacion.severity);
          veredicto = {
            severity: severidad,
            decision: severidad >= 5 ? 'deny' : severidad >= 2 ? 'ask' : 'allow',
            signals: [
              ...veredicto.signals,
              `modelo: ${clasificacion.reason || 'sin motivo'} (${clasificacion.severity}/10)`,
            ],
            reason:
              clasificacion.reason && clasificacion.reason.length > 0
                ? clasificacion.reason
                : veredicto.reason,
          };
        }
      }

      if (veredicto.decision === 'allow') return tool.execute(args, ctx);

      if (veredicto.decision === 'deny' && modo === 'block') {
        return {
          content:
            `El monitor de seguridad bloqueó ${tool.name} (severidad ${veredicto.severity}/10).\n` +
            `Señales: ${veredicto.reason}\n\n` +
            'Si crees que es un falso positivo, explica al usuario qué necesitas y por qué.',
          isError: true,
        };
      }

      const aprobado = await opciones.confirmar({
        herramienta: tool.name,
        severidad: veredicto.severity,
        senales: veredicto.signals,
        motivo: veredicto.reason,
        args,
      });

      if (!aprobado) {
        return {
          content: `El usuario no autorizó ${tool.name} (severidad ${veredicto.severity}/10: ${veredicto.reason}).`,
          isError: true,
        };
      }

      return tool.execute(args, ctx);
    },
  };
}

module.exports = { evaluarAccion, conMonitorDeSeguridad, REGLAS };
