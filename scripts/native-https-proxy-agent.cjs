// 给 Node 原生 http/https 的 globalAgent 注入 HTTPS CONNECT 隧道代理
// 适用于任何 webpack/bundle 包装过的 CLI（内部使用 Node 原生 http/https 模块）
const http = require('http');
const https = require('https');
const tls = require('tls');
const net = require('net');
const { URL } = require('url');

const proxyEnv = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.PROXY_URL;
if (!proxyEnv) {
  console.error('[native-agent-hook] 未检测到 HTTPS_PROXY/HTTP_PROXY，跳过');
  return;
}

const proxy = new URL(proxyEnv);
if (proxy.protocol !== 'http:') {
  console.error('[native-agent-hook] 目前只支持 HTTP 代理（CONNECT over HTTP），当前协议:', proxy.protocol);
  return;
}

console.error('[native-agent-hook] 启用隧道代理:', proxyEnv);

const proxyHost = proxy.hostname;
const proxyPort = Number(proxy.port) || (proxy.protocol === 'https:' ? 443 : 80);
const proxyAuth = proxy.username ? `${proxy.username}:${decodeURIComponent(proxy.password || '')}` : null;
const noProxyRaw = process.env.NO_PROXY || process.env.no_proxy || '';
const noProxyList = noProxyRaw.split(',').map(s => s.trim()).filter(Boolean);

function shouldBypass(hostname) {
  if (!hostname) return false;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  return noProxyList.some(pat => {
    if (pat.startsWith('.')) return hostname.endsWith(pat) || hostname === pat.slice(1);
    return hostname === pat || hostname.endsWith('.' + pat);
  });
}

/** 基于 HTTP CONNECT 建 TLS 隧道的 socket */
function connectViaProxy(targetHost, targetPort, opts, cb) {
  const target = `${targetHost}:${targetPort}`;
  const req = http.request({
    method: 'CONNECT',
    host: proxyHost,
    port: proxyPort,
    path: target,
    headers: Object.assign(
      { Host: target, 'Proxy-Connection': 'Keep-Alive' },
      proxyAuth ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(proxyAuth).toString('base64') } : {}
    ),
    agent: false,
  });
  let done = false;
  req.once('connect', (res, socket, head) => {
    if (done) return;
    done = true;
    if (res.statusCode !== 200) {
      socket.destroy();
      return cb(new Error(`代理 CONNECT 失败: ${res.statusCode} ${res.statusMessage}`));
    }
    // 升级到 TLS
    const tlsSocket = tls.connect(Object.assign({
      socket, servername: targetHost, host: targetHost, port: targetPort,
      ALPNProtocols: ['http/1.1'],
      rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
    }, opts || {}, () => cb(null, tlsSocket)));
    tlsSocket.once('error', err => cb(err));
  });
  req.once('error', err => { if (done) return; done = true; cb(err); });
  req.end();
}

// 新建一个 https.Agent 子类：createConnection 走 CONNECT 隧道
class TunnelingHttpsAgent extends https.Agent {
  constructor(options) { super(options); }
  createConnection(options, callback) {
    if (shouldBypass(options.host || options.hostname)) {
      // 直接走默认 createConnection
      return super.createConnection(options, callback);
    }
    connectViaProxy(options.host || options.hostname, options.port || 443, options, (err, socket) => {
      if (err) return callback(err);
      callback(null, socket);
    });
    return null;
  }
}

// 普通 http 的请求也走代理（简单的 HTTP 转发代理）
class ForwardingHttpAgent extends http.Agent {
  createConnection(options, callback) {
    if (shouldBypass(options.host || options.hostname)) {
      return super.createConnection(options, callback);
    }
    // 直接把 HTTP 请求发到代理，然后代理转发（不 CONNECT，用 path=完整 URL）
    // 但在 Node HTTP client 层面 path 在 request() 中设置，createConnection 只负责建连接
    // 所以这里就是连到代理服务器本身，然后由 request 层构造完整 URL path
    const connOptions = {
      host: proxyHost, port: proxyPort,
      localAddress: options.localAddress, family: options.family, hints: options.hints, lookup: options.lookup,
    };
    return super.createConnection(connOptions, callback);
  }
}

// 设置 globalAgent
const tunnelAgent = new TunnelingHttpsAgent({ keepAlive: true, maxSockets: 64 });
const forwardAgent = new ForwardingHttpAgent({ keepAlive: true, maxSockets: 64 });
Object.defineProperty(https, 'globalAgent', { configurable: true, get() { return tunnelAgent; } });
Object.defineProperty(http,  'globalAgent', { configurable: true, get() { return forwardAgent; } });

// 同时也把默认 request 里的 agent 改掉——这能覆盖大多数请求（除非显式传了 agent）
const origHttpsRequest = https.request;
const origHttpsGet = https.get;
const origHttpRequest = http.request;
const origHttpGet = http.get;

https.request = function (opts, cb) {
  if (opts && typeof opts === 'object' && opts.agent === undefined) {
    const host = opts.hostname || opts.host;
    if (!shouldBypass(host)) opts.agent = tunnelAgent;
  }
  return origHttpsRequest.call(this, opts, cb);
};
https.get = function (opts, cb) { const req = https.request(opts, cb); req.end(); return req; };

http.request = function (opts, cb) {
  if (opts && typeof opts === 'object') {
    const host = opts.hostname || opts.host;
    if (!shouldBypass(host)) {
      if (opts.agent === undefined) opts.agent = forwardAgent;
      // 还要把 path 调整成完整的 absolute URL（因为是 HTTP over proxy）
      // 但 axios 默认会设置 host / path，这里不改——除非请求是 Node 原生用户直接发的
    }
  }
  return origHttpRequest.call(this, opts, cb);
};
http.get = function (opts, cb) { const req = http.request(opts, cb); req.end(); return req; };

console.error('[native-agent-hook] HTTP/HTTPS globalAgent 已打补丁完成');
