import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from 'dotenv';
import { Client } from 'pg';

const rootDirectory = path.resolve(__dirname, '..', '..', '..');

config({ path: path.join(rootDirectory, '.env') });

function testDatabaseUrl(): string {
  const connectionString = process.env.TEST_DATABASE_URL;

  if (!connectionString) {
    throw new Error('TEST_DATABASE_URL must be set in .env');
  }

  return connectionString;
}

export async function connectToTestDatabase(): Promise<Client> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  return client;
}

export async function resetTestDatabase(): Promise<void> {
  const client = await connectToTestDatabase();
  const migrationsDirectory = path.join(rootDirectory, 'migrations');

  try {
    await client.query('drop schema public cascade');
    await client.query('create schema public');

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const migrationFile of migrationFiles) {
      const sql = await readFile(path.join(migrationsDirectory, migrationFile), 'utf8');
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}
