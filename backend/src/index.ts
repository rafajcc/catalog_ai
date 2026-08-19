// Main entry point for the Catalog AI backend application.

import path from 'path';
import createApp from './app';
import { ErrorHandler } from './utils/error-handler';
import { logger } from './utils/logger';
import type { Server } from 'http';

const PORT = process.env.PORT || 3000;
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..');
let server: Server | undefined;

const startServer = async (): Promise<void> => {
  try {
    const app = await createApp({ dataDir });

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
