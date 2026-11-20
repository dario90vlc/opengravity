'use strict';

/**
 * Proxy HTTP(S) local para el navegador del agente.
 *
 * Chromium resuelve DNS por su cuenta; un dominio puede resolver a loopback
 * después de la comprobación inicial. Este proxy recibe cada conexión del
 * navegador, resuelve el destino, rechaza direcciones privadas y se conecta a
 * la IP comprobada. Para HTTPS usa CONNECT y deja el TLS extremo a extremo
 * (Chromium sigue validando el certificado del host).
 */

const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { validarUrlPublica } = require('./red-segura.cjs');

let servidor = null;
let urlProxy = null;
let iniciando = null;

function respuestaError(socket, codigo, mensaje) {
  try {
    socket.end(
      `HTTP/1.1 ${codigo} ${mensaje}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  } catch {
    // socket ya cerrado
  }
}

async function iniciarProxyNavegador() {
  if (urlProxy) return urlProxy;
  if (iniciando) return iniciando;

  iniciando = new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      let objetivo;
      try {
        objetivo = new URL(String(req.url ?? ''));
      } catch {
        res.writeHead(400);
        res.end('URL de proxy inválida');
        return;
      }
      if (objetivo.protocol !== 'http:' && objetivo.protocol !== 'https:') {
        res.writeHead(403);
        res.end('solo http/https');
        return;
      }

      const validacion = await validarUrlPublica(objetivo.href);
      if (!validacion.ok) {
        res.writeHead(403);
        res.end(`Acceso denegado: ${validacion.error}`);
        return;
      }
      const direccion = validacion.addresses.find((a) => a.family === 4) ?? validacion.addresses[0];
      const modulo = objetivo.protocol === 'https:' ? https : http;
      const peticion = modulo.request(
        {
          protocol: objetivo.protocol,
          hostname: objetivo.hostname,
          port: objetivo.port || (objetivo.protocol === 'https:' ? 443 : 80),
          path: `${objetivo.pathname}${objetivo.search}`,
          method: req.method,
          headers: req.headers,
          lookup: (_hostname, opcionesLookup, callback) => {
            if (opcionesLookup?.all) {
              callback(null, [{ address: direccion.address, family: direccion.family }]);
            } else {
              callback(null, direccion.address, direccion.family);
            }
          },
          ...(objetivo.protocol === 'https:' && !net.isIP(objetivo.hostname)
            ? { servername: objetivo.hostname }
            : {}),
        },
        (destino) => {
          res.writeHead(destino.statusCode ?? 502, destino.headers);
          destino.pipe(res);
        },
      );
      peticion.on('error', (error) => {
        if (!res.headersSent) {
          res.writeHead(502);
          res.end(`Error de proxy: ${error.message}`);
        } else {
          res.destroy(error);
        }
      });
      req.pipe(peticion);
    });

    server.on('connect', async (req, socket, cabecera) => {
      let objetivo;
      try {
        objetivo = new URL(`https://${String(req.url ?? '')}`);
      } catch {
        respuestaError(socket, 400, 'CONNECT inválido');
        return;
      }
      const validacion = await validarUrlPublica(objetivo.href);
      if (!validacion.ok) {
        respuestaError(socket, 403, validacion.error);
        return;
      }
      const direccion = validacion.addresses.find((a) => a.family === 4) ?? validacion.addresses[0];
      const destino = net.connect(
        {
          host: direccion.address,
          port: Number(objetivo.port || 443),
          family: direccion.family,
        },
        () => {
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (cabecera?.length > 0) destino.write(cabecera);
          socket.pipe(destino);
          destino.pipe(socket);
        },
      );
      destino.on('error', () => respuestaError(socket, 502, 'Error de conexión'));
      socket.on('error', () => destino.destroy());
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      servidor = server;
      const { port } = server.address();
      urlProxy = `127.0.0.1:${port}`;
      resolve(urlProxy);
    });
  }).finally(() => {
    iniciando = null;
  });

  return iniciando;
}

async function configurarProxyNavegador(sesion) {
  const proxy = await iniciarProxyNavegador();
  await sesion.setProxy({
    proxyRules: `http=${proxy};https=${proxy}`,
    // Sin esto Chromium puede saltarse el proxy para loopback y el rebinding
    // volvería a funcionar.
    proxyBypassRules: '<-loopback>',
  });
  return proxy;
}

function detenerProxyNavegador() {
  if (servidor) servidor.close();
  servidor = null;
  urlProxy = null;
}

module.exports = { iniciarProxyNavegador, configurarProxyNavegador, detenerProxyNavegador };
