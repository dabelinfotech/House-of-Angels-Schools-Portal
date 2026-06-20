const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool: db } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { sendPasswordResetEmail } = require('../mailer');

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }
  try {
    const result = await db.query('SELECT * FROM admins WHERE username = $1', [username.trim().toLowerCase()]);
    const admin = result.rows[0];
    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }
    req.session.adminId       = admin.id;
    req.session.adminUsername = admin.username;
    req.session.adminRole     = admin.role;
    req.session.adminName     = admin.full_name;
    req.session.save((saveErr) => {
      if (saveErr) {
        return res.status(500).json({ success: false, message: 'Session error.' });
      }
      res.json({
        success: true,
        message: 'Login successful.',
        admin: { username: admin.username, full_name: admin.full_name, role: admin.role }
      });
    });
  } catch (e) {
    console.error('Login DB error:', e.message, e.code);
    res.status(500).json({ success: false, message: 'Login error: ' + e.message });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true, message: 'Logged out.' }));
});

router.get('/check', async (req, res) => {
  if (!req.session || !req.session.adminId) {
    return res.status(401).json({ authenticated: false });
  }
  try {
    const result = await db.query('SELECT email FROM admins WHERE id = $1', [req.session.adminId]);
    const email  = result.rows[0] ? result.rows[0].email : null;
    res.json({
      authenticated: true,
      admin: { username: req.session.adminUsername, full_name: req.session.adminName, role: req.session.adminRole, email }
    });
  } catch (e) {
    res.json({
      authenticated: true,
      admin: { username: req.session.adminUsername, full_name: req.session.adminName, role: req.session.adminRole }
    });
  }
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email address is required.' });
  try {
    const result = await db.query('SELECT * FROM admins WHERE LOWER(email) = LOWER($1)', [email.trim()]);
    const admin = result.rows[0];
    // Always return the same message to prevent email enumeration
    if (!admin) {
      return res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
    }
    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await db.query(
      'UPDATE admins SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
      [token, expires, admin.id]
    );
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host     = req.headers['x-forwarded-host'] || req.headers.host;
    const resetUrl = `${protocol}://${host}/admin/reset-password?token=${token}`;
    await sendPasswordResetEmail(admin.email, admin.full_name || admin.username, resetUrl);
    res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
  } catch (e) {
    console.error('Forgot-password error:', e.message);
    res.status(500).json({ success: false, message: 'Error processing request.' });
  }
});

router.get('/verify-reset-token/:token', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, full_name, username FROM admins WHERE reset_token = $1 AND reset_token_expires > NOW()',
      [req.params.token]
    );
    if (!result.rows[0]) return res.status(400).json({ valid: false, message: 'Invalid or expired reset link.' });
    const a = result.rows[0];
    res.json({ valid: true, name: a.full_name || a.username });
  } catch (e) {
    res.status(500).json({ valid: false, message: 'Error verifying token.' });
  }
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ success: false, message: 'Token and password are required.' });
  if (password.length < 6) return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
  try {
    const result = await db.query(
      'SELECT id FROM admins WHERE reset_token = $1 AND reset_token_expires > NOW()',
      [token]
    );
    if (!result.rows[0]) return res.status(400).json({ success: false, message: 'Invalid or expired reset link.' });
    const hash = bcrypt.hashSync(password, 10);
    await db.query(
      'UPDATE admins SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [hash, result.rows[0].id]
    );
    res.json({ success: true, message: 'Password updated successfully. You can now log in.' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Error resetting password.' });
  }
});

router.put('/update-email', requireAuth, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email address is required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
  try {
    const existing = await db.query(
      'SELECT id FROM admins WHERE LOWER(email) = LOWER($1) AND id != $2',
      [email.trim(), req.session.adminId]
    );
    if (existing.rows.length > 0) return res.status(400).json({ success: false, message: 'That email is already in use.' });
    await db.query('UPDATE admins SET email = $1 WHERE id = $2', [email.trim().toLowerCase(), req.session.adminId]);
    res.json({ success: true, message: 'Email updated successfully.' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Error updating email.' });
  }
});

router.put('/change-password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ success: false, message: 'Both fields are required.' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
  }
  try {
    const result = await db.query('SELECT * FROM admins WHERE id = $1', [req.session.adminId]);
    const admin = result.rows[0];
    if (!bcrypt.compareSync(current_password, admin.password_hash)) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }
    const hash = bcrypt.hashSync(new_password, 10);
    await db.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [hash, req.session.adminId]);
    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Error updating password.' });
  }
});

module.exports = router;
