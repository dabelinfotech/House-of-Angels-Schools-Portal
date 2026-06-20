require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const cors = require('cors');
const path = require('path');
const pool = require('./database');

const app = express();
const PORT = process.env.PORT || 3002;

app.set('trust proxy', 1); // Required for secure cookies behind Vercel's proxy
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new pgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'hoa-portal-fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000 // 8 hours
  }
}));

// API routes
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/results', require('./routes/results'));
app.use('/api/admin',   require('./routes/admin'));
app.use('/api/slips',   require('./routes/slips'));

// Admin page routes
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html'));
});
app.get('/admin/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html'));
});
app.get('/admin/forgot-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'forgot-password.html'));
});
app.get('/admin/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'reset-password.html'));
});

// Catch-all
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server locally (Vercel ignores this and uses module.exports instead)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  House of Angel Schools Result Portal`);
    console.log(`========================================`);
    console.log(`  URL:   http://localhost:${PORT}`);
    console.log(`  Admin: http://localhost:${PORT}/admin`);
    console.log(`  Login: admin / admin123`);
    console.log(`========================================\n`);
  });
}

module.exports = app;
