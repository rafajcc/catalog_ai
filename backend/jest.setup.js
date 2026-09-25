// Jest runs every test file in its own worker process, and DB_TYPE is now a
// mandatory selector. Each worker defaults to the embedded SQLite backend so
// the whole suite (app boot, auth, providers...) runs without an external DB.
// Tests that need MySQL/MariaDB override these variables before the first
// getPersistenceConfig() call inside their own worker.
if (!process.env.DB_TYPE) {
  process.env.DB_TYPE = 'sqlite';
}