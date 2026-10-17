import { buildApp } from './app.js';
import { loadConfig, loadEnvFile } from './config.js';

loadEnvFile();
const config = loadConfig();
const app = await buildApp(config, { logger: true });

await app.listen({ host: config.HOST, port: config.PORT });
app.log.info(`${config.APP_NAME} is running at http://${config.HOST === '0.0.0.0' ? 'localhost' : config.HOST}:${config.PORT}`);
app.log.info(`Data file: ${config.dbPath}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
