// Deja la tabla Card legible por el rol anónimo (catálogo público, solo lectura).
// Sin esto, Supabase avisa de "RLS disabled in public schema".
// Ejecutar: npx tsx scripts/enable-cards-rls.ts
import 'dotenv/config';
import { Client } from 'pg';

const sql = [
  `ALTER TABLE "Card" ENABLE ROW LEVEL SECURITY;`,
  `DROP POLICY IF EXISTS "card_read" ON "Card";`,
  // Solo SELECT: el catálogo se lee, nunca se escribe desde el navegador.
  `CREATE POLICY "card_read" ON "Card" FOR SELECT USING (true);`,
  `GRANT SELECT ON "Card" TO anon, authenticated;`,
];

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
for (const stmt of sql) {
  await client.query(stmt);
  console.log('OK:', stmt.split('\n')[0].slice(0, 60));
}
const { rows } = await client.query(
  'SELECT pack, count(*)::int AS n FROM "Card" GROUP BY pack ORDER BY pack',
);
console.table(rows);
await client.end();
console.log('Card: lectura pública habilitada.');
