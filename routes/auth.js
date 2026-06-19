const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');

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
    res.status(500).json({ success: false, message: 'Login error.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true, message: 'Logged out.' }));
});

router.get('/check', (req, res) => {
  if (req.session && req.session.adminId) {
    res.json({
      authenticated: true,
      admin: { username: req.session.adminUsername, full_name: req.session.adminName, role: req.session.adminRole }
    });
  } else {
    res.status(401).json({ authenticated: false });
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
