// Habilita Realtime sobre la tabla Room y permisos para el rol anónimo (juego casual).
// Ejecutar: npx tsx scripts/enable-realtime.ts
import 'dotenv/config';
import { Client } from 'pg';

const sql = [
  // Realtime necesita la fila completa en los cambios y la tabla en la publicación.
  `ALTER TABLE "Room" REPLICA IDENTITY FULL;`,
  `DO $$ BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'Room'
     ) THEN
       ALTER PUBLICATION supabase_realtime ADD TABLE "Room";
     END IF;
   END $$;`,
  // RLS permisiva (cualquiera con el código de sala puede leer/escribir). Casual.
  `ALTER TABLE "Room" ENABLE ROW LEVEL SECURITY;`,
  `DROP POLICY IF EXISTS "room_read" ON "Room";`,
  `CREATE POLICY "room_read" ON "Room" FOR SELECT USING (true);`,
  `DROP POLICY IF EXISTS "room_insert" ON "Room";`,
  `CREATE POLICY "room_insert" ON "Room" FOR INSERT WITH CHECK (true);`,
  `DROP POLICY IF EXISTS "room_update" ON "Room";`,
  `CREATE POLICY "room_update" ON "Room" FOR UPDATE USING (true) WITH CHECK (true);`,
  `GRANT SELECT, INSERT, UPDATE ON "Room" TO anon, authenticated;`,
];

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
for (const stmt of sql) {
  await client.query(stmt);
  console.log('OK:', stmt.split('\n')[0].slice(0, 60));
}
await client.end();
console.log('Realtime habilitado en Room.');
