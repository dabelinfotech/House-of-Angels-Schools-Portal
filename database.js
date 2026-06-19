const { Database } = require('node-sqlite3-wasm');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// Use forward-slash path (node-sqlite3-wasm requires POSIX-style paths on Windows)
const dbPath = path.join(__dirname, 'school_results.db').replace(/\\/g, '/');
const lockPath = path.join(__dirname, 'school_results.db.lock');

// Remove stale lock directory left by previous crashes (Windows-specific)
try { fs.rmSync(lockPath, { recursive: true, force: true }); } catch (_) {}

const db = new Database(dbPath);
db.exec('PRAGMA foreign_keys = ON');

// Ensure lock is cleaned up on graceful exit
process.on('exit', () => {
  try { db.close(); } catch (_) {}
  try { fs.rmSync(lockPath, { recursive: true, force: true }); } catch (_) {}
});
process.on('SIGINT',  () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// ── Compatibility wrapper ──────────────────────────────────────────────────────
// node-sqlite3-wasm requires params as an array, but better-sqlite3 uses
// spread args. Wrap db.prepare() so both styles work transparently.
const _origPrepare = db.prepare.bind(db);
db.prepare = (sql) => {
  const stmt = _origPrepare(sql);
  const wrapMethod = (method) => (...args) => {
    let params;
    if (args.length === 0) {
      params = [];
    } else if (args.length === 1 && (Array.isArray(args[0]) || (typeof args[0] === 'object' && args[0] !== null))) {
      params = args[0]; // already array or named-params object
    } else {
      params = args; // spread args → array
    }
    return stmt[method](params);
  };
  return { run: wrapMethod('run'), get: wrapMethod('get'), all: wrapMethod('all') };
};
// ──────────────────────────────────────────────────────────────────────────────

// Polyfill db.transaction() to match better-sqlite3 API
db.transaction = function(fn) {
  return function(...args) {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
};

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    role TEXT DEFAULT 'admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    admission_number TEXT UNIQUE NOT NULL,
    class TEXT NOT NULL,
    date_of_birth TEXT,
    gender TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pin TEXT UNIQUE NOT NULL,
    student_id INTEGER NOT NULL,
    session TEXT NOT NULL,
    term TEXT NOT NULL,
    is_used INTEGER DEFAULT 0,
    used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id)
  );

  CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    ca1 REAL DEFAULT 0,
    ca2 REAL DEFAULT 0,
    exam REAL DEFAULT 0,
    total REAL DEFAULT 0,
    grade TEXT,
    remark TEXT,
    session TEXT NOT NULL,
    term TEXT NOT NULL,
    class TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id),
    UNIQUE(student_id, subject, session, term)
  );

  CREATE TABLE IF NOT EXISTS school_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS student_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    session TEXT NOT NULL,
    term TEXT NOT NULL,
    type TEXT NOT NULL,
    trait TEXT NOT NULL,
    rating INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id),
    UNIQUE(student_id, session, term, type, trait)
  );

  CREATE TABLE IF NOT EXISTS subject_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
    UNIQUE(admin_id, subject)
  );

  CREATE TABLE IF NOT EXISTS class_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL,
    class TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
    UNIQUE(admin_id, class)
  );
`);

// Seed default admin
const adminExists = db.prepare('SELECT id FROM admins WHERE username = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admins (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)')
    .run('admin', hash, 'System Administrator', 'superadmin');
  console.log('Default admin created: admin / admin123');
}

// Seed default school settings
const defaults = [
  ['school_name', 'HOUSE OF ANGEL SCHOOLS'],
  ['school_motto', 'Excellence for Beginners'],
  ['school_address', ''],
  ['school_phone', ''],
  ['school_email', ''],
  ['current_session', '2024/2025'],
  ['current_term', 'First Term'],
  ['principal_name', ''],
  ['vice_principal', ''],
  ['school_type', 'Nursery & Primary School'],
];

const insertSetting = db.prepare('INSERT OR IGNORE INTO school_settings (key, value) VALUES (?, ?)');
defaults.forEach(([k, v]) => insertSetting.run(k, v));

module.exports = db;
