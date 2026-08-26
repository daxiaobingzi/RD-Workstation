// IGA Pages 代理补丁：给 axios 注入 HTTPS_PROXY 的 CONNECT 隧道
// 修复：axios `proxy:` 配置对 HTTPS 目标会明文发送（400 plain HTTP → HTTPS port）
const Module = require('module');
const origResolve = Module._resolveFilename;
let firstLoad = true;

Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  const resolved = origResolve.apply(this, arguments);
  // 第一次加载 axios 后修改原型
  if (firstLoad && resolved && (resolved.includes('/axios/') || /axios[\\/]dist[\\/]lib[\\/]axios\.js$/.test(resolved) || /[\\/]axios[\\/]lib[\\/]axios\.js/.test(resolved))) {
    process.nextTick(() => patchAxios());
    firstLoad = false;
  }
  return resolved;
};

function patchAxios() {
  try {
    const axios = require('axios');
    // 若 node_modules 位置不同，用 Module._load 再加载
    const { HttpsProxyAgent } = requireRequireOptional('https-proxy-agent') || {};
    const { HttpProxyAgent } = requireRequireOptional('hpagent') || requireRequireOptional('http-proxy-agent') || {};

    if (!HttpsProxyAgent && !HttpProxyAgent) {
      // 优先装一个本地安装（如果 /workspace 没装，尝试全局找，不行就失败）
      try {
        // 把代理信息告诉用户，避免静默失败
        console.error('[iga-proxy-hook] 未找到 https-proxy-agent 或 hpagent，尝试自动安装至 /workspace/node_modules...');
        return;
      } catch (e) {
        console.error('[iga-proxy-hook] 无法注入代理，后续可能失败');
        return;
      }
    }

    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.HTTP_PROXY;
    if (!proxy) return;

    // 创建两个 agent（HTTPS 请求使用 HttpsProxyAgent 走 CONNECT 隧道）
    const httpsAgent = HttpsProxyAgent
      ? new HttpsProxyAgent(proxy)
      : (HttpProxyAgent ? new HttpProxyAgent({ proxy }) : undefined);

    // HTTP 的请求也走代理（可选，这里让其正常即可）
    // 对 axios.defaults 进行拦截
    function applyToAxiosInstance(instance) {
      if (!instance || !instance.interceptors) return;
      instance.interceptors.request.use(config => {
        // 请求是否走 https
        const url = config.url || '';
        const base = config.baseURL || '';
        const full = (base + url);
        const isHttps = full.startsWith('https:') || config.url?.startsWith?.('https:') || config.httpsAgent !== undefined;
        if (isHttps && httpsAgent) {
          // 关键：强制用走 CONNECT 的 agent，且关闭 `proxy` 选项
          config.httpsAgent = httpsAgent;
          config.httpAgent = undefined;
          config.proxy = false; // 禁用 axios 的原生 proxy，避免明文 HTTPS
        }
        return config;
      });
    }

    applyToAxiosInstance(axios.defaults && axios.defaults.axios ? axios.defaults.axios : axios);
    applyToAxiosInstance(axios);

    // 对 axios.create 也进行补丁
    const origCreate = axios.create;
    if (origCreate) {
      axios.create = function (config) {
        const inst = origCreate.call(axios, config);
        applyToAxiosInstance(inst);
        return inst;
      };
    }

    console.error('[iga-proxy-hook] axios 代理已注入:', proxy);
  } catch (e) {
    console.error('[iga-proxy-hook] axios 补丁失败:', e.message);
  }
}

function requireRequireOptional(name) {
  try {
    // 先找 iga 自己的依赖路径
    const resolved = require.resolve(name, { paths: [
      '/workspace/node_modules',
      '/root/.nvm/versions/node/v24.1.0/lib/node_modules/@iga-pages/cli/node_modules',
      '/root/.nvm/versions/node/v24.1.0/lib/node_modules',
    ]});
    return require(resolved);
  } catch (e) { return null; }
}
