const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      role TEXT DEFAULT 'admin',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      admission_number TEXT UNIQUE NOT NULL,
      class TEXT NOT NULL,
      date_of_birth TEXT,
      gender TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pins (
      id SERIAL PRIMARY KEY,
      pin TEXT UNIQUE NOT NULL,
      student_id INTEGER NOT NULL REFERENCES students(id),
      session TEXT NOT NULL,
      term TEXT NOT NULL,
      is_used INTEGER DEFAULT 0,
      used_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS results (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id),
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, subject, session, term)
    );

    CREATE TABLE IF NOT EXISTS school_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS student_ratings (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id),
      session TEXT NOT NULL,
      term TEXT NOT NULL,
      type TEXT NOT NULL,
      trait TEXT NOT NULL,
      rating INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, session, term, type, trait)
    );

    CREATE TABLE IF NOT EXISTS subject_assignments (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(admin_id, subject)
    );

    CREATE TABLE IF NOT EXISTS class_assignments (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      class TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(admin_id, class)
    );
  `);

  // Add email + reset-token columns if they don't exist yet (safe on re-run)
  await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS email TEXT`);
  await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS reset_token TEXT`);
  await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP`);

  // Seed default admin
  const adminExists = await pool.query('SELECT id FROM admins WHERE username = $1', ['admin']);
  if (adminExists.rows.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await pool.query(
      'INSERT INTO admins (username, password_hash, full_name, role) VALUES ($1, $2, $3, $4)',
      ['admin', hash, 'System Administrator', 'superadmin']
    );
    console.log('Default admin created: admin / admin123');
  }

  // Seed default school settings
  const defaults = [
    ['school_name',    'HOUSE OF ANGEL SCHOOLS'],
    ['school_motto',   'Excellence for Beginners'],
    ['school_address', ''],
    ['school_phone',   ''],
    ['school_email',   ''],
    ['current_session','2024/2025'],
    ['current_term',   'First Term'],
    ['principal_name', ''],
    ['vice_principal', ''],
    ['school_type',    'Nursery & Primary School'],
  ];
  for (const [k, v] of defaults) {
    await pool.query(
      'INSERT INTO school_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [k, v]
    );
  }

  console.log('Database ready.');
}

initDB().catch(err => {
  console.error('Database init failed:', err.message);
  process.exit(1);
});

module.exports = pool;
