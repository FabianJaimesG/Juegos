// Borra TODAS las salas de la base de datos. Uso: npx tsx scripts/wipe-rooms.ts
import 'dotenv/config';
import { Client } from 'pg';

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const before = await client.query('SELECT count(*)::int AS n FROM "Room";');
const del = await client.query('DELETE FROM "Room";');
console.log(`Salas antes: ${before.rows[0].n} · eliminadas: ${del.rowCount}`);
await client.end();
