// 对 https.request / http.request / https.get / http.get 注入 HTTPS 代理隧道
// 只对发往外网（非 no_proxy）的目标生效
const http = require('http');
const https = require('https');
const { URL } = require('url');

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (!proxyUrl) return;

const proxy = new URL(proxyUrl);
const noProxyRaw = process.env.NO_PROXY || process.env.no_proxy || '';
const noProxyList = noProxyRaw.split(',').map(s => s.trim()).filter(Boolean);

function isNoProxy(hostname) {
  if (!hostname) return false;
  return noProxyList.some(pat => {
    if (pat.startsWith('.')) return hostname.endsWith(pat) || hostname === pat.slice(1);
    return hostname === pat || hostname.endsWith('.' + pat);
  });
}

function wrapModule(mod, defaultPort, scheme) {
  const origRequest = mod.request;
  mod.request = function wrappedRequest(options, cb) {
    if (typeof options === 'string') options = new URL(options);
    const hostname = options.hostname || options.host || 'localhost';
    const port = options.port || defaultPort;

    // no_proxy 或 localhost 跳过
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || isNoProxy(hostname)) {
      return origRequest.call(mod, options, cb);
    }

    // 对所有外网目标（http 或 https）走 HTTP 代理；https 目标强制 CONNECT
    const targetHttps = (options.protocol === 'https:') || (scheme === 'https' && defaultPort === 443) || (port === 443);

    // 统一用代理的 options（走 http 代理端口）
    const proxyReqOpts = {
      method: options.method || 'GET',
      hostname: proxy.hostname,
      port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
      protocol: proxy.protocol,
      path: targetHttps
        ? null // 稍后用 CONNECT 建隧道
        : (options.path || (options.pathname + (options.search || '')) || '/'),
      headers: Object.assign({}, options.headers || {}),
      auth: options.auth,
      agent: false,
      timeout: options.timeout,
    };

    // 非 https 目标：直接走普通 HTTP 代理转发
    if (!targetHttps) {
      // 代理需要的 Host 头是目标完整 host:port
      const targetHost = port && port !== defaultPort ? `${hostname}:${port}` : hostname;
      if (options.headers && options.headers.host) {
        proxyReqOpts.headers.Host = options.headers.host;
      } else {
        proxyReqOpts.headers.Host = targetHost;
      }
      const fullUrl = new URL(`${scheme}://${targetHost}${options.path || (options.pathname + (options.search || '')) || '/'}`);
      proxyReqOpts.path = fullUrl.href;
      return origRequest.call(http, proxyReqOpts, cb);
    }

    // HTTPS 目标：先发 HTTP CONNECT 建隧道
    return new Promise((resolve, reject) => {
      const target = `${hostname}:${port}`;
      const connectOpts = {
        method: 'CONNECT',
        hostname: proxy.hostname,
        port: proxy.port || 80,
        path: target,
        headers: { Host: target },
        agent: false,
        timeout: options.timeout,
      };
      const connectReq = origRequest.call(http, connectOpts);
      connectReq.once('connect', (res, socket, head) => {
        if (res.statusCode !== 200) {
          const err = new Error(`Proxy CONNECT ${res.statusCode}`);
          socket.destroy();
          return reject(err);
        }
        // 在 socket 上启动 TLS
        const tls = require('tls');
        const tlsSocket = tls.connect({
          socket, host: hostname, port, servername: hostname,
          rejectUnauthorized: (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0'),
        });
        const newAgent = new https.Agent();
        newAgent.createConnection = () => tlsSocket;
        const realOpts = Object.assign({}, options, {
          agent: newAgent,
          createConnection: undefined,
        });
        const req = origRequest.call(https, realOpts, cb);
        resolve(req);
      });
      connectReq.once('error', reject);
      connectReq.end();
    }).then(req => req, err => { const r = new http.ClientRequest({}); setImmediate(() => r.emit('error', err)); return r; });
  };

  mod.get = function wrappedGet(options, cb) {
    const req = mod.request(options, cb);
    req.end();
    return req;
  };
}

wrapModule(http, 80, 'http');
wrapModule(https, 443, 'https');

// undici fetch
try {
  const { ProxyAgent, setGlobalDispatcher, Agent } = require('undici');
  setGlobalDispatcher(new ProxyAgent({ uri: proxyUrl }));
} catch (e) {}
