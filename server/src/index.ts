import { buildApp } from './app.js';
import { loadConfig, loadEnvFile } from './config.js';

loadEnvFile();
const config = loadConfig();
const app = await buildApp(config, { logger: true });

// A stray error inside a file parser (pdf.js runs its own async work) must not stop the app;
// it is logged so the launcher window shows what went wrong.
process.on('unhandledRejection', (err) => app.log.error({ err }, 'Unhandled rejection'));
process.on('uncaughtException', (err) => app.log.error({ err }, 'Uncaught exception'));

await app.listen({ host: config.HOST, port: config.PORT });
app.log.info(`${config.APP_NAME} is running at http://${config.HOST === '0.0.0.0' ? 'localhost' : config.HOST}:${config.PORT}`);
app.log.info(`Data file: ${config.dbPath}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
