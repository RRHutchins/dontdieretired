// A stand-in for Cloudflare D1 on Node's own SQLite, with the Worker's real migrations applied in order.
// Used by tools/test_accounts.js and tools/test_plus.js.
const fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');

function d1() {
  const db = new DatabaseSync(':memory:');
  const dir = path.join(__dirname, '../worker/migrations');
  fs.readdirSync(dir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort().forEach(f => db.exec(fs.readFileSync(path.join(dir, f), 'utf8')));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) || null,
    run: async () => (db.prepare(sql).run(...args), { success: true }),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    _exec: () => db.prepare(sql).run(...args),
  });
  return { raw: db, prepare: sql => stmt(sql), batch: async list => { db.exec('BEGIN'); try { list.forEach(s => s._exec()); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return []; } };
}
module.exports = d1;
