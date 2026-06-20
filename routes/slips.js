const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const db       = require('../database');
const { requireAuth } = require('../middleware/auth');

// Store uploads in memory so we can base64-encode into the DB (Vercel-safe)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only images and PDFs are allowed.'));
    }
  },
});

// ─── Student: Upload Payment Slip ─────────────────────────────────────────────
router.post('/upload', upload.single('slip'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });

  const { student_id, admission_number, student_name, class: cls, session, term } = req.body;
  if (!admission_number || !student_name || !cls || !session || !term) {
    return res.status(400).json({ success: false, message: 'Missing required student details.' });
  }

  try {
    // Verify admission number exists
    const check = await db.query('SELECT id FROM students WHERE admission_number = $1', [admission_number.trim().toUpperCase()]);
    if (!check.rows[0]) return res.status(400).json({ success: false, message: 'Student record not found.' });

    const fileData = req.file.buffer.toString('base64');
    await db.query(
      `INSERT INTO payment_slips
         (student_id, admission_number, student_name, class, session, term,
          original_name, file_data, mime_type, file_size, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')`,
      [
        check.rows[0].id,
        admission_number.trim().toUpperCase(),
        student_name.trim(),
        cls.trim(),
        session.trim(),
        term.trim(),
        req.file.originalname,
        fileData,
        req.file.mimetype,
        req.file.size,
      ]
    );
    res.json({ success: true, message: 'Payment slip uploaded successfully.' });
  } catch (e) {
    console.error('Slip upload error:', e.message);
    res.status(500).json({ success: false, message: 'Upload failed. Please try again.' });
  }
});

// ─── Admin: List All Slips (filtered by class for staff) ─────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, session, term, class: cls } = req.query;
    let where = [];
    let params = [];
    let idx = 1;

    if (status && status !== 'all') { where.push(`ps.status = $${idx++}`); params.push(status); }
    if (session) { where.push(`ps.session = $${idx++}`); params.push(session); }
    if (term)    { where.push(`ps.term = $${idx++}`);    params.push(term); }
    if (cls)     { where.push(`ps.class = $${idx++}`);   params.push(cls); }

    // Staff only see their assigned classes
    if (req.session.adminRole === 'staff') {
      const asgn = await db.query(
        'SELECT class FROM class_assignments WHERE admin_id = $1',
        [req.session.adminId]
      );
      const classes = asgn.rows.map(r => r.class);
      if (classes.length === 0) {
        return res.json({ success: true, slips: [], total: 0 });
      }
      where.push(`ps.class = ANY($${idx++})`);
      params.push(classes);
    }

    const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const result = await db.query(
      `SELECT ps.id, ps.admission_number, ps.student_name, ps.class, ps.session,
              ps.term, ps.original_name, ps.mime_type, ps.file_size, ps.status,
              ps.notes, ps.uploaded_at
       FROM payment_slips ps
       ${whereSQL}
       ORDER BY ps.uploaded_at DESC`,
      params
    );

    res.json({ success: true, slips: result.rows, total: result.rows.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── Admin: View / Download a Slip ───────────────────────────────────────────
router.get('/:id/view', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT file_data, mime_type, original_name FROM payment_slips WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Slip not found.' });

    const { file_data, mime_type, original_name } = result.rows[0];
    const buffer = Buffer.from(file_data, 'base64');
    res.set('Content-Type', mime_type);
    res.set('Content-Disposition', `inline; filename="${original_name}"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ─── Admin: Update Status / Notes ─────────────────────────────────────────────
router.put('/:id/status', requireAuth, async (req, res) => {
  const { status, notes } = req.body;
  const allowed = ['pending', 'reviewed', 'verified'];
  if (!allowed.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status.' });
  try {
    await db.query(
      'UPDATE payment_slips SET status = $1, notes = $2 WHERE id = $3',
      [status, notes || null, req.params.id]
    );
    res.json({ success: true, message: 'Status updated.' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── Admin: Delete a Slip ────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM payment_slips WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Slip deleted.' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── Admin: Count pending slips (for badge) ───────────────────────────────────
router.get('/count/pending', requireAuth, async (req, res) => {
  try {
    let params = [];
    let extra  = '';
    if (req.session.adminRole === 'staff') {
      const asgn = await db.query('SELECT class FROM class_assignments WHERE admin_id = $1', [req.session.adminId]);
      const classes = asgn.rows.map(r => r.class);
      if (classes.length === 0) return res.json({ count: 0 });
      extra = "AND class = ANY($1)";
      params = [classes];
    }
    const r = await db.query(
      `SELECT COUNT(*) AS c FROM payment_slips WHERE status = 'pending' ${extra}`,
      params
    );
    res.json({ count: parseInt(r.rows[0].c) || 0 });
  } catch (e) {
    res.json({ count: 0 });
  }
});

module.exports = router;
