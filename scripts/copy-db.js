// Copia única de la base de Render a Supabase. Uso: SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... node scripts/copy-db.js
import { createPool, migrate } from '../src/db.js';

const source = createPool(process.env.SOURCE_DATABASE_URL);
const target = createPool(process.env.TARGET_DATABASE_URL);

const tablesSql = `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`;
const fksSql = `SELECT cl.relname AS child, pr.relname AS parent FROM pg_constraint co
  JOIN pg_class cl ON cl.oid = co.conrelid JOIN pg_class pr ON pr.oid = co.confrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace WHERE co.contype = 'f' AND n.nspname = 'public'`;

try {
  await migrate(target);
  const { rows: [{ n }] } = await target.query('SELECT count(*)::int AS n FROM users');
  if (n > 0) throw new Error('El destino ya tiene datos; no se copia de nuevo.');

  const tables = (await source.query(tablesSql)).rows.map((r) => r.name);
  const fks = (await source.query(fksSql)).rows;
  const ordered = [];
  const pending = new Set(tables);
  while (pending.size) {
    const ready = [...pending].filter((t) => !fks.some((f) => f.child === t && f.parent !== t && pending.has(f.parent)));
    if (!ready.length) throw new Error(`Dependencias circulares: ${[...pending].join(', ')}`);
    for (const t of ready) { ordered.push(t); pending.delete(t); }
  }

  const client = await target.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    for (const t of ordered) {
      let copied = 0;
      for (let offset = 0; ; offset += 200) {
        const { rows } = await source.query(`SELECT json_agg(copia_fila) AS rows FROM (SELECT * FROM "${t}" ORDER BY ctid LIMIT 200 OFFSET ${offset}) copia_fila`);
        if (!rows[0].rows) break;
        await client.query(`INSERT INTO "${t}" SELECT (jsonb_populate_record(NULL::"${t}", e)).* FROM jsonb_array_elements($1::jsonb) e`, [JSON.stringify(rows[0].rows)]);
        copied += rows[0].rows.length;
      }
      const seqs = await client.query(`SELECT column_name AS c, pg_get_serial_sequence(quote_ident(table_name), column_name) AS s
        FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_default LIKE 'nextval%'`, [t]);
      for (const { c, s } of seqs.rows) await client.query(`SELECT setval($1, GREATEST((SELECT COALESCE(max("${c}"), 0) FROM "${t}"), 1))`, [s]);
      const src = (await source.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n;
      if (src !== copied) throw new Error(`${t}: origen ${src}, copiadas ${copied}`);
      console.log(`copia ${t}: ${copied}`);
    }
    await client.query('COMMIT');
    console.log('copia lista');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
} catch (err) {
  console.error('copia FALLÓ:', err.message);
  process.exitCode = 1;
} finally {
  await source.end();
  await target.end();
}
