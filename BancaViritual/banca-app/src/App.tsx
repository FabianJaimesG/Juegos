import { hasSupabase, supabase } from './lib/supabase';
import './App.css';

function App() {
  return (
    <main className="banca-shell">
      <h1>🏦 Banca</h1>
      <p className="tag">Banquero virtual para Monopoly.</p>

      <section className="card">
        <h2>Estado del proyecto</h2>
        <ul>
          <li>
            Supabase:{' '}
            {hasSupabase ? (
              <strong className="ok">conectado ✅</strong>
            ) : (
              <strong className="warn">sin credenciales (modo local) ⚠️</strong>
            )}
          </li>
          <li>URL: <code>{import.meta.env.VITE_SUPABASE_URL ?? '—'}</code></li>
        </ul>
        <p className="note">
          Próximo paso: portar el banquero (jugadores, pagar/cobrar/transferir, dados, historial) a
          componentes React, y modelar propiedades/rentas con Prisma + Supabase.
        </p>
      </section>

      <button
        type="button"
        onClick={async () => {
          if (!supabase) return alert('Supabase no configurado.');
          // Prueba de conectividad ligera contra la API REST.
          const { error } = await supabase.from('Game').select('id').limit(1);
          alert(
            error
              ? `Respuesta de Supabase: ${error.message}\n(Es normal si aún no corres las migraciones de Prisma.)`
              : 'Conexión con Supabase OK ✅',
          );
        }}
      >
        Probar conexión Supabase
      </button>
    </main>
  );
}

export default App;
