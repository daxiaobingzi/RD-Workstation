// global-agent bootstrap hook — preload
try {
  const path = '/root/.nvm/versions/node/v24.1.0/lib/node_modules/global-agent/dist/index.js';
  const ga = require(path);
  const agent = ga.bootstrap();
  console.error('[hook][global-agent] 已启动:', agent ? 'ok' : 'no-op');
} catch (e) {
  console.error('[hook][global-agent] 启动失败:', e && e.message);
}
