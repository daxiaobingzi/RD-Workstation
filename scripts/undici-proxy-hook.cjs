// 强制所有 undici fetch 走 HTTP CONNECT 代理（处理 egress 代理的 HTTPS 隧道）
try {
  const { ProxyAgent, setGlobalDispatcher } = require('undici');
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (proxy) {
    console.error('[hook] 设置 undici 全局代理:', proxy);
    setGlobalDispatcher(new ProxyAgent({ uri: proxy }));
  }
} catch (e) { /* undici 不可用时忽略 */ }
