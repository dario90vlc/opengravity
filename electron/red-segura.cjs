'use strict';

/**
 * Comprobación de red para URLs que vienen del modelo.
 *
 * `isUrlAllowed` valida el texto del host, pero un dominio como
 * `foo.127.0.0.1.nip.io` puede resolver a loopback. Aquí se resuelve el host,
 * se rejected si alguna respuesta es privada y, al descargar, se fija la IP
 * elegida para que un DNS rebinding entre la comprobación y la petición no
 * alcance un servicio local.
 */

const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

function esDireccionPrivada(direccion) {
  const ip = String(direccion ?? '').trim().toLowerCase();
  if (net.isIP(ip) === 4) {
    return (
      /^127\./.test(ip) ||
      /^10\./.test(ip) ||
      /^192\.168\./.test(ip) ||
      /^169\.254\./.test(ip) ||
      /^0\./.test(ip) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
    );
  }
  if (net.isIP(ip) === 6) {
    return (
      ip === '::1' ||
      ip === '::' ||
      /^fc/i.test(ip) ||
      /^fd/i.test(ip) ||
      /^fe8/i.test(ip) ||
      /^fe9/i.test(ip) ||
      /^fea/i.test(ip) ||
      /^feb/i.test(ip) ||
      /^::ffff:(127\.|10\.|192\.168\.)/i.test(ip)
    );
  }
  return true;
}

/**
 * Resuelve el host y devuelve sus direcciones; falla si alguna es privada.
 * @returns {Promise<{ok:true, host:string, addresses:Array<{address:string,family:number}>}|{ok:false,error:string}>}
 */
async function validarUrlPublica(url, opciones = {}) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return { ok: false, error: 'URL no válida' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `protocolo no permitido: ${parsed.protocol}` };
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return { ok: false, error: `${host} es una dirección local` };
  }

  let addresses;
  if (net.isIP(host)) {
    addresses = [{ address: host, family: net.isIP(host) }];
  } else {
    try {
      addresses = await dns.lookup(host, { all: true, verbatim: true });
    } catch (error) {
      return { ok: false, error: `no se pudo resolver ${host}: ${error.code ?? error.message}` };
    }
  }

  if (addresses.length === 0) {
    return { ok: false, error: `${host} no resolvió ninguna dirección` };
  }
  if (!opciones.allowLocal && addresses.some((entry) => esDireccionPrivada(entry.address))) {
    return {
      ok: false,
      error: `${host} resuelve a una dirección local o privada (${addresses.map((a) => a.address).join(', ')})`,
    };
  }

  return { ok: true, host, addresses };
}

/**
 * Descarga texto fijando la IP resuelta y siguiendo redirecciones validadas.
 * No usa el fetch nativo: su resolución DNS volvería a exponer el rebinding.
 */
async function descargarTexto(url, opciones = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    maxBytes = 200_000,
    maxRedirects = 5,
    timeoutMs = 20_000,
  } = opciones;

  let actual = String(url);
  for (let intento = 0; intento <= maxRedirects; intento += 1) {
    const validacion = await validarUrlPublica(actual, opciones);
    if (!validacion.ok) return { ok: false, error: validacion.error };

    const objetivo = new URL(actual);
    const modulo = objetivo.protocol === 'https:' ? https : http;
    const direccion = validacion.addresses.find((a) => a.family === 4) ?? validacion.addresses[0];
    const respuesta = await new Promise((resolve, reject) => {
      const peticion = modulo.request(
        {
          protocol: objetivo.protocol,
          hostname: objetivo.hostname,
          port: objetivo.port || (objetivo.protocol === 'https:' ? 443 : 80),
          path: `${objetivo.pathname}${objetivo.search}`,
          method,
          headers,
          // Pin de la IP: el hostname sigue siendo el de la URL para Host/SNI.
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
        (res) => {
          const trozos = [];
          let bytes = 0;
          res.on('data', (trozo) => {
            if (bytes >= maxBytes) return;
            const recorte = trozo.subarray(0, Math.max(0, maxBytes - bytes));
            trozos.push(recorte);
            bytes += recorte.length;
          });
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              texto: Buffer.concat(trozos).toString('utf8'),
            });
          });
          res.on('error', reject);
        },
      );
      peticion.setTimeout(timeoutMs, () => peticion.destroy(new Error('timeout de red')));
      peticion.on('error', reject);
      if (body !== null && body !== undefined) peticion.write(body);
      peticion.end();
    });

    if (respuesta.status >= 300 && respuesta.status < 400 && respuesta.headers.location) {
      actual = new URL(respuesta.headers.location, actual).href;
      continue;
    }
    return { ok: true, ...respuesta, url: actual };
  }
  return { ok: false, error: 'demasiadas redirecciones' };
}

module.exports = { esDireccionPrivada, validarUrlPublica, descargarTexto };
