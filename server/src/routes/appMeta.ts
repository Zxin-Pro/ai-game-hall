import type { FastifyInstance } from 'fastify';
import { cfg, cfgNum } from '../env.js';

/**
 * App 自更新用的公开接口。
 *
 * App 启动时打一次，拿到服务端记录的「最新版本」，
 * 和自己的 versionCode 比一下就知道要不要提示更新。
 * 不需要登录 —— 更新提示得在登录前就能弹。
 *
 * 这几个值存在 app_settings 里，管理后台可改；
 * CI 每次发新版也会自动回写，所以永远是实时的。
 */
export default async function appMetaRoutes(app: FastifyInstance) {
  app.get('/latest', async () => {
    const versionCode = cfgNum('APP_VERSION_CODE', 1);
    const versionName = cfg('APP_VERSION_NAME') || String(versionCode);
    const apkUrl = cfg('APP_APK_URL');
    const note = cfg('APP_UPDATE_NOTE');
    const minVersionCode = cfgNum('APP_MIN_VERSION_CODE', 0);

    return {
      versionCode,
      versionName,
      apkUrl,
      note,
      minVersionCode,
      // 低于 minVersionCode 就必须更新，否则只是可选提示
      hasUpdate: versionCode > 0,
    };
  });
}
