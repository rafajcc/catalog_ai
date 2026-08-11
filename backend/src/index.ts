// Main entry point for the Catalog AI backend application.

import path from 'path';
import createApp from './app';
import { ErrorHandler } from './utils/error-handler';
import { logger } from './utils/logger';
import type { Server } from 'http';

const PORT = process.env.PORT || 3000;
// The configuration file is persisted with encrypted secrets; override the
// default location with the CONFIG_FILE environment variable and the
// encryption secret with CONFIG_SECRET.
// The default is anchored to the backend package (../config.json from src or
// dist) so it does not depend on the directory the server is started from.
const configFile = process.env.CONFIG_FILE || path.join(__dirname, '..', 'config.json');
const app = createApp({ configFile });
let server: Server | undefined;

const startServer = async (): Promise<void> => {
  try {
    server = app.listen(PORT, () => {
      logger.info(`Server started on port ${PORT}`, { port: PORT });
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
};

const gracefulShutdown = async (): Promise<void> => {
  logger.info('Received shutdown signal, shutting down gracefully');

  try {
    if (server) {
      await new Promise<void>((resolve) => {
        server?.close(() => {
          logger.info('Server closed');
          resolve();
        });
      });
    }
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error });
    process.exit(1);
  }
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

ErrorHandler.setup(process.env.NODE_ENV === 'development');

startServer().catch((error: unknown) => {
  logger.error('Failed to start server', { error });
  process.exit(1);
});
