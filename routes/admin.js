const express = require('express');
const router = express.Router();
const multer = require('multer');
const ExcelJS = require('exceljs');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.includes('spreadsheet') || file.originalname.match(/\.(xlsx|xls|csv)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) and CSV are allowed.'));
    }
  }
});

const CLASS_ARMS = [
  'P.G A','P.G B','P.G C','P.G D',
  'K.G 1A','K.G 1B','K.G 1C','K.G 1D',
  'K.G 2A','K.G 2B','K.G 2C','K.G 2D',
  'Nursery 1A','Nursery 1B','Nursery 1C','Nursery 1D',
  'Nursery 2A','Nursery 2B','Nursery 2C','Nursery 2D',
  'Basic 1A','Basic 1B','Basic 1C','Basic 1D',
  'Basic 2A','Basic 2B','Basic 2C','Basic 2D',
  'Basic 3A','Basic 3B','Basic 3C','Basic 3D',
  'Basic 4A','Basic 4B','Basic 4C','Basic 4D',
  'Basic 5A','Basic 5B','Basic 5C','Basic 5D',
  'Basic 6A','Basic 6B','Basic 6C','Basic 6D',
];

const PRESCHOOL_SUBJECTS = [
  'Mathematics', 'English Language', 'Phonics', 'Handwriting',
  'Creative Arts', 'Social Habits'
];
const NURSERY_SUBJECTS = [
  'Mathematics', 'English Language', 'Phonics', 'Handwriting',
  'Basic Science', 'Social Studies', 'Cultural and Creative Arts', 'Social Habits'
];
const PRIMARY_SUBJECTS = [
  'Mathematics', 'English Language', 'Basic Science and Technology',
  'Social Studies', 'Cultural and Creative Arts', 'Physical and Health Education',
  'Civic Education', 'Yoruba Language', 'Christian Religious Studies',
  'Handwriting', 'Verbal Reasoning', 'Quantitative Reasoning'
];

function getSubjectsForClass(cls) {
  if (!cls) return PRIMARY_SUBJECTS;
  const c = String(cls).trim();
  if (c.startsWith('P.G') || c.startsWith('K.G')) return PRESCHOOL_SUBJECTS;
  if (c.startsWith('Nursery')) return NURSERY_SUBJECTS;
  return PRIMARY_SUBJECTS;
}

function calculateGrade(total) {
  if (total >= 75) return { grade: 'A1', remark: 'Excellent' };
  if (total >= 70) return { grade: 'B2', remark: 'Very Good' };
  if (total >= 65) return { grade: 'B3', remark: 'Good' };
  if (total >= 60) return { grade: 'C4', remark: 'Credit' };
  if (total >= 55) return { grade: 'C5', remark: 'Credit' };
  if (total >= 50) return { grade: 'C6', remark: 'Credit' };
  if (total >= 45) return { grade: 'D7', remark: 'Pass' };
  if (total >= 40) return { grade: 'E8', remark: 'Pass' };
  return { grade: 'F9', remark: 'Fail' };
}

function generatePin() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function getUniquePin(client) {
  const q = client || db;
  let pin;
  do {
    pin = generatePin();
    const { rows } = await q.query('SELECT id FROM pins WHERE pin = $1', [pin]);
    if (rows.length === 0) break;
  } while (true);
  return pin;
}

// ─── Current User ─────────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT id, username, full_name, role FROM admins WHERE id = $1', [req.session.adminId]);
    const admin = result.rows[0];
    if (!admin) return res.status(401).json({ success: false });
    let assignedSubjects = [], assignedClasses = [];
    if (admin.role === 'staff') {
      const [subRes, clsRes] = await Promise.all([
        db.query('SELECT subject FROM subject_assignments WHERE admin_id = $1', [req.session.adminId]),
        db.query('SELECT class FROM class_assignments WHERE admin_id = $1', [req.session.adminId]),
      ]);
      assignedSubjects = subRes.rows.map(r => r.subject);
      assignedClasses  = clsRes.rows.map(r => r.class);
    }
    res.json({ success: true, admin: { ...admin, assignedSubjects, assignedClasses } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const [s1, s2, s3, s4, s5, s6, s7] = await Promise.all([
      db.query('SELECT COUNT(*) AS c FROM students'),
      db.query('SELECT COUNT(*) AS c FROM results'),
      db.query('SELECT COUNT(*) AS c FROM pins'),
      db.query('SELECT COUNT(*) AS c FROM pins WHERE is_used = 1'),
      db.query('SELECT DISTINCT class FROM students ORDER BY class'),
      db.query('SELECT DISTINCT session FROM results ORDER BY session DESC'),
      db.query(`SELECT r.*, s.name, s.admission_number FROM results r
                JOIN students s ON r.student_id = s.id
                ORDER BY r.created_at DESC LIMIT 10`),
    ]);
    res.json({
      success: true,
      stats: {
        total_students:  parseInt(s1.rows[0].c),
        total_results:   parseInt(s2.rows[0].c),
        total_pins:      parseInt(s3.rows[0].c),
        used_pins:       parseInt(s4.rows[0].c),
        classes:         s5.rows.map(r => r.class),
        sessions:        s6.rows.map(r => r.session),
        recent_results:  s7.rows,
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── Students ─────────────────────────────────────────────────────────────────
router.get('/students', requireAuth, async (req, res) => {
  try {
    const { class: cls, search } = req.query;
    let query = 'SELECT * FROM students WHERE 1=1';
    const params = [];
    let idx = 1;
    if (cls)    { query += ` AND class = $${idx++}`;                                          params.push(cls); }
    if (search) { query += ` AND (name ILIKE $${idx++} OR admission_number ILIKE $${idx++})`; params.push(`%${search}%`, `%${search}%`); }
    query += ' ORDER BY class, name';
    const { rows } = await db.query(query, params);
    res.json({ success: true, students: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/students', requireAuth, async (req, res) => {
  const { name, admission_number, class: cls, date_of_birth, gender } = req.body;
  if (!name || !admission_number || !cls) {
    return res.status(400).json({ success: false, message: 'Name, Admission Number, and Class are required.' });
  }
  try {
    const result = await db.query(
      'INSERT INTO students (name, admission_number, class, date_of_birth, gender) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [name.trim(), admission_number.trim().toUpperCase(), cls.trim(), date_of_birth || null, gender || null]
    );
    res.json({ success: true, message: 'Student added successfully.', id: result.rows[0].id });
  } catch (e) {
    if (e.code === '23505') res.status(400).json({ success: false, message: 'Admission number already exists.' });
    else res.status(500).json({ success: false, message: 'Error adding student: ' + e.message });
  }
});

router.put('/students/:id', requireAuth, async (req, res) => {
  const { name, class: cls, date_of_birth, gender } = req.body;
  try {
    await db.query(
      'UPDATE students SET name=$1, class=$2, date_of_birth=$3, gender=$4 WHERE id=$5',
      [name, cls, date_of_birth || null, gender || null, req.params.id]
    );
    res.json({ success: true, message: 'Student updated.' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.delete('/students/:id', requireAuth, async (req, res) => {
  const id = req.params.id;
  try {
    await db.query('DELETE FROM results WHERE student_id = $1', [id]);
    await db.query('DELETE FROM pins WHERE student_id = $1', [id]);
    await db.query('DELETE FROM students WHERE id = $1', [id]);
    res.json({ success: true, message: 'Student and associated records deleted.' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── Individual Result Management ─────────────────────────────────────────────
router.get('/student-results/:studentId', requireAuth, async (req, res) => {
  try {
    const { session, term } = req.query;
    let query = 'SELECT * FROM results WHERE student_id = $1';
    const params = [req.params.studentId];
    let idx = 2;
    if (session) { query += ` AND session = $${idx++}`; params.push(session); }
    if (term)    { query += ` AND term = $${idx++}`;    params.push(term); }
    query += ' ORDER BY subject';
    const { rows } = await db.query(query, params);
    res.json({ success: true, results: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/results', requireAuth, async (req, res) => {
  const { student_id, subject, ca1, ca2, exam, session, term, class: cls } = req.body;
  if (!student_id || !subject || !session || !term) {
    return res.status(400).json({ success: false, message: 'Student, subject, session, and term are required.' });
  }
  try {
    if (req.session.adminRole === 'staff') {
      const [subRes, clsRes] = await Promise.all([
        db.query('SELECT subject FROM subject_assignments WHERE admin_id = $1', [req.session.adminId]),
        db.query('SELECT class FROM class_assignments WHERE admin_id = $1', [req.session.adminId]),
      ]);
      const staffSubjects = subRes.rows.map(r => r.subject);
      const staffClasses  = clsRes.rows.map(r => r.class);
      if (!staffSubjects.length && !staffClasses.length)
        return res.status(403).json({ success: false, message: 'You have no upload permissions assigned.' });
      if (staffSubjects.length && !staffSubjects.includes(subject))
        return res.status(403).json({ success: false, message: 'You are not assigned to upload results for this subject.' });
      if (staffClasses.length && !staffClasses.includes(cls))
        return res.status(403).json({ success: false, message: 'You are not assigned to upload results for this class.' });
    }

    const ca1v = parseFloat(ca1) || 0;
    const ca2v = parseFloat(ca2) || 0;
    const examv = parseFloat(exam) || 0;
    const total = Math.min(ca1v + ca2v + examv, 100);
    const { grade, remark } = calculateGrade(total);

    const stuRes = await db.query('SELECT class FROM students WHERE id = $1', [student_id]);
    const classVal = cls || (stuRes.rows[0] ? stuRes.rows[0].class : '');

    await db.query(`
      INSERT INTO results (student_id, subject, ca1, ca2, exam, total, grade, remark, session, term, class)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT(student_id, subject, session, term) DO UPDATE SET
        ca1=EXCLUDED.ca1, ca2=EXCLUDED.ca2, exam=EXCLUDED.exam,
        total=EXCLUDED.total, grade=EXCLUDED.grade, remark=EXCLUDED.remark, class=EXCLUDED.class
    `, [student_id, subject, ca1v, ca2v, examv, total, grade, remark, session, term, classVal]);

    res.json({ success: true, message: 'Result saved.' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Error saving result: ' + e.message });
  }
});

router.delete('/results/:id', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM results WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Result deleted.' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── Bulk Upload (Excel) ───────────────────────────────────────────────────────
router.post('/upload-results', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);
    const worksheet = workbook.getWorksheet(1);

    if (!worksheet || worksheet.rowCount < 2) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'The spreadsheet is empty.' });
    }

    const headerRow = worksheet.getRow(1);
    const headers = {};
    headerRow.eachCell((cell, col) => { headers[String(cell.value || '').trim()] = col; });

    const getCell = (row, ...names) => {
      for (const name of names) {
        const col = headers[name];
        if (col !== undefined) {
          const val = row.getCell(col).value;
          if (val !== null && val !== undefined) return String(val).trim();
        }
      }
      return '';
    };

    const data = [];
    worksheet.eachRow((row, rowNum) => { if (rowNum > 1) data.push({ row, rowNum }); });
    if (data.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'The spreadsheet is empty.' });
    }

    let staffSubjects = null, staffClasses = null;
    if (req.session.adminRole === 'staff') {
      const [subRes, clsRes] = await Promise.all([
        db.query('SELECT subject FROM subject_assignments WHERE admin_id = $1', [req.session.adminId]),
        db.query('SELECT class FROM class_assignments WHERE admin_id = $1', [req.session.adminId]),
      ]);
      staffSubjects = subRes.rows.map(r => r.subject);
      staffClasses  = clsRes.rows.map(r => r.class);
      if (!staffSubjects.length && !staffClasses.length) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(403).json({ success: false, message: 'You have no upload permissions assigned.' });
      }
    }

    let processed = 0, skipped = 0;
    const errors = [];

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      for (const { row, rowNum } of data) {
        const studentName = getCell(row, 'Student Name', 'Name', 'STUDENT NAME');
        const admissionNo = getCell(row, 'Admission No', 'Admission Number', 'ADMISSION NO').toUpperCase();
        const cls     = getCell(row, 'Class', 'CLASS');
        const session = getCell(row, 'Session', 'SESSION');
        const term    = getCell(row, 'Term', 'TERM');
        const subject = getCell(row, 'Subject', 'SUBJECT');
        const ca1  = Math.min(parseFloat(getCell(row, 'CA1', 'First CA', '1st CA') || 0) || 0, 20);
        const ca2  = Math.min(parseFloat(getCell(row, 'CA2', 'Second CA', '2nd CA') || 0) || 0, 20);
        const exam = Math.min(parseFloat(getCell(row, 'Exam', 'Exam Score', 'EXAM') || 0) || 0, 60);

        if (!admissionNo) { errors.push(`Row ${rowNum}: Missing admission number.`); skipped++; continue; }
        if (!subject)     { errors.push(`Row ${rowNum}: Missing subject.`); skipped++; continue; }
        if (!session)     { errors.push(`Row ${rowNum}: Missing session.`); skipped++; continue; }
        if (!term)        { errors.push(`Row ${rowNum}: Missing term.`); skipped++; continue; }

        if (staffSubjects !== null) {
          if (staffSubjects.length && !staffSubjects.includes(subject)) {
            errors.push(`Row ${rowNum}: Not authorized for subject: ${subject}`); skipped++; continue;
          }
          if (staffClasses && staffClasses.length && cls && !staffClasses.includes(cls)) {
            errors.push(`Row ${rowNum}: Not authorized for class: ${cls}`); skipped++; continue;
          }
        }

        let stuRes = await client.query('SELECT * FROM students WHERE admission_number = $1', [admissionNo]);
        let student = stuRes.rows[0];
        if (!student) {
          if (!studentName) { errors.push(`Row ${rowNum}: Student ${admissionNo} not found and no name provided.`); skipped++; continue; }
          await client.query(
            'INSERT INTO students (name, admission_number, class) VALUES ($1,$2,$3) ON CONFLICT (admission_number) DO NOTHING',
            [studentName, admissionNo, cls || 'Unknown']
          );
          stuRes = await client.query('SELECT * FROM students WHERE admission_number = $1', [admissionNo]);
          student = stuRes.rows[0];
        }

        if (cls && student.class !== cls) {
          await client.query('UPDATE students SET class = $1 WHERE id = $2', [cls, student.id]);
        }

        const total = Math.min(ca1 + ca2 + exam, 100);
        const { grade, remark } = calculateGrade(total);

        await client.query(`
          INSERT INTO results (student_id, subject, ca1, ca2, exam, total, grade, remark, session, term, class)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT(student_id, subject, session, term) DO UPDATE SET
            ca1=EXCLUDED.ca1, ca2=EXCLUDED.ca2, exam=EXCLUDED.exam,
            total=EXCLUDED.total, grade=EXCLUDED.grade, remark=EXCLUDED.remark, class=EXCLUDED.class
        `, [student.id, subject, ca1, ca2, exam, total, grade, remark, session, term, cls || student.class]);

        processed++;
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.json({
      success: true,
      message: `Upload complete. ${processed} record(s) processed, ${skipped} skipped.`,
      processed, skipped, errors: errors.slice(0, 30)
    });
  } catch (e) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, message: 'Error processing file: ' + e.message });
  }
});

// ─── PINs ─────────────────────────────────────────────────────────────────────
router.post('/generate-pins', requireAuth, async (req, res) => {
  const { session, term, class: cls } = req.body;
  if (!session || !term || !cls) {
    return res.status(400).json({ success: false, message: 'Session, term, and class are required.' });
  }
  try {
    const stuRes = await db.query('SELECT * FROM students WHERE class = $1 ORDER BY name', [cls]);
    const students = stuRes.rows;
    if (students.length === 0) {
      return res.status(404).json({ success: false, message: 'No students found in this class.' });
    }

    const client = await db.connect();
    const pins = [];
    try {
      await client.query('BEGIN');
      for (const student of students) {
        const exRes = await client.query(
          'SELECT * FROM pins WHERE student_id = $1 AND session = $2 AND term = $3',
          [student.id, session, term]
        );
        let existing = exRes.rows[0];
        if (!existing) {
          const pin = await getUniquePin(client);
          await client.query(
            'INSERT INTO pins (pin, student_id, session, term) VALUES ($1,$2,$3,$4)',
            [pin, student.id, session, term]
          );
          existing = { pin, is_used: 0 };
        }
        pins.push({
          student_id: student.id,
          name: student.name,
          admission_number: student.admission_number,
          class: student.class,
          pin: existing.pin,
          is_used: existing.is_used
        });
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({ success: true, pins, count: pins.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/pins', requireAuth, async (req, res) => {
  try {
    const { session, term, class: cls } = req.query;
    let query = `SELECT p.*, s.name, s.admission_number, s.class
                 FROM pins p JOIN students s ON p.student_id = s.id WHERE 1=1`;
    const params = [];
    let idx = 1;
    if (session) { query += ` AND p.session = $${idx++}`; params.push(session); }
    if (term)    { query += ` AND p.term = $${idx++}`;    params.push(term); }
    if (cls)     { query += ` AND s.class = $${idx++}`;   params.push(cls); }
    query += ' ORDER BY s.class, s.name';
    const { rows } = await db.query(query, params);
    res.json({ success: true, pins: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.delete('/pins/:id', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM pins WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'PIN deleted.' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── Class Results Viewer ─────────────────────────────────────────────────────
router.get('/class-results', requireAuth, async (req, res) => {
  const { class: cls, session, term } = req.query;
  if (!cls || !session || !term) {
    return res.status(400).json({ success: false, message: 'Class, session, and term are required.' });
  }
  try {
    const stuRes = await db.query('SELECT * FROM students WHERE class = $1 ORDER BY name', [cls]);
    const data = [];
    for (const student of stuRes.rows) {
      const rRes = await db.query(
        'SELECT * FROM results WHERE student_id = $1 AND session = $2 AND term = $3 ORDER BY subject',
        [student.id, session, term]
      );
      const results = rRes.rows;
      if (results.length === 0) continue;
      const grand_total = results.reduce((sum, r) => sum + (parseFloat(r.total) || 0), 0);
      const average = grand_total / results.length;
      data.push({ ...student, results, grand_total, average: parseFloat(average.toFixed(1)) });
    }
    data.sort((a, b) => b.grand_total - a.grand_total);
    data.forEach((s, i) => { s.position = i + 1; });
    res.json({ success: true, students: data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── School Settings ──────────────────────────────────────────────────────────
router.get('/settings', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT key, value FROM school_settings');
    const settings = {};
    rows.forEach(s => { settings[s.key] = s.value; });
    res.json({ success: true, settings });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.put('/settings', requireAuth, async (req, res) => {
  try {
    for (const [k, v] of Object.entries(req.body)) {
      await db.query(
        'INSERT INTO school_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [k, String(v)]
      );
    }
    res.json({ success: true, message: 'Settings saved.' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── Affective & Psychomotor Ratings ─────────────────────────────────────────
const AFFECTIVE_TRAITS  = ['Alertness','Honesty','Neatness','Politeness','Punctuality','Relationship with Others','Reliability'];
const PSYCHOMOTOR_SKILLS = ['Construction','Drawing & Arts','Flexibility','Games & Sports','Handwriting','Musical Skills','Paintings'];

router.get('/student-ratings/:studentId', requireAuth, async (req, res) => {
  const { session, term } = req.query;
  if (!session || !term) return res.status(400).json({ success: false, message: 'Session and term are required.' });
  try {
    const { rows } = await db.query(
      'SELECT type, trait, rating FROM student_ratings WHERE student_id = $1 AND session = $2 AND term = $3',
      [req.params.studentId, session, term]
    );
    const affective = {}, psychomotor = {};
    rows.forEach(r => {
      if (r.type === 'affective')   affective[r.trait]   = r.rating;
      if (r.type === 'psychomotor') psychomotor[r.trait] = r.rating;
    });
    res.json({ success: true, affective, psychomotor });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.put('/student-ratings/:studentId', requireAuth, async (req, res) => {
  const { session, term, affective = {}, psychomotor = {} } = req.body;
  if (!session || !term) return res.status(400).json({ success: false, message: 'Session and term are required.' });
  try {
    const stuRes = await db.query('SELECT id FROM students WHERE id = $1', [req.params.studentId]);
    if (!stuRes.rows[0]) return res.status(404).json({ success: false, message: 'Student not found.' });

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const upsertRating = async (type, trait, rating) => {
        await client.query(`
          INSERT INTO student_ratings (student_id, session, term, type, trait, rating)
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT(student_id, session, term, type, trait) DO UPDATE SET rating = EXCLUDED.rating
        `, [req.params.studentId, session, term, type, trait, parseInt(rating) || 0]);
      };
      for (const trait of AFFECTIVE_TRAITS)   await upsertRating('affective',   trait, affective[trait]);
      for (const trait of PSYCHOMOTOR_SKILLS) await upsertRating('psychomotor', trait, psychomotor[trait]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ success: true, message: 'Ratings saved.' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Error saving ratings: ' + e.message });
  }
});

// ─── Class Arms & Subjects ────────────────────────────────────────────────────
router.get('/classes', requireAuth, (req, res) => {
  res.json({ success: true, classes: CLASS_ARMS });
});

router.get('/subjects', requireAuth, (req, res) => {
  const subjects = getSubjectsForClass(req.query.class);
  const all = [...new Set([...PRESCHOOL_SUBJECTS, ...NURSERY_SUBJECTS, ...PRIMARY_SUBJECTS])];
  res.json({ success: true, subjects, preschool: PRESCHOOL_SUBJECTS, nursery: NURSERY_SUBJECTS, primary: PRIMARY_SUBJECTS, all });
});

// ─── Staff Subject Assignments ────────────────────────────────────────────────
router.get('/staff-assignments/:adminId', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT subject FROM subject_assignments WHERE admin_id = $1', [req.params.adminId]);
    res.json({ success: true, subjects: rows.map(r => r.subject) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.put('/staff-assignments/:adminId', requireAuth, async (req, res) => {
  if (req.session.adminRole !== 'superadmin' && req.session.adminRole !== 'admin') {
    return res.status(403).json({ success: false, message: 'Insufficient permissions.' });
  }
  const { subjects } = req.body;
  const adminId = parseInt(req.params.adminId);
  try {
    const admin = await db.query('SELECT id FROM admins WHERE id = $1', [adminId]);
    if (!admin.rows[0]) return res.status(404).json({ success: false, message: 'Staff member not found.' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM subject_assignments WHERE admin_id = $1', [adminId]);
      if (Array.isArray(subjects) && subjects.length) {
        for (const s of subjects) {
          await client.query(
            'INSERT INTO subject_assignments (admin_id, subject) VALUES ($1,$2) ON CONFLICT DO NOTHING',
            [adminId, s]
          );
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ success: true, message: 'Subject assignments updated.' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Error updating assignments: ' + e.message });
  }
});

// ─── Staff Class Assignments ──────────────────────────────────────────────────
router.get('/class-assignments/:adminId', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT class FROM class_assignments WHERE admin_id = $1', [req.params.adminId]);
    res.json({ success: true, classes: rows.map(r => r.class) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.put('/class-assignments/:adminId', requireAuth, async (req, res) => {
  if (req.session.adminRole !== 'superadmin' && req.session.adminRole !== 'admin') {
    return res.status(403).json({ success: false, message: 'Insufficient permissions.' });
  }
  const { classes } = req.body;
  const adminId = parseInt(req.params.adminId);
  try {
    const admin = await db.query('SELECT id FROM admins WHERE id = $1', [adminId]);
    if (!admin.rows[0]) return res.status(404).json({ success: false, message: 'Staff member not found.' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM class_assignments WHERE admin_id = $1', [adminId]);
      if (Array.isArray(classes) && classes.length) {
        for (const c of classes) {
          await client.query(
            'INSERT INTO class_assignments (admin_id, class) VALUES ($1,$2) ON CONFLICT DO NOTHING',
            [adminId, c]
          );
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ success: true, message: 'Class assignments updated.' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Error updating class assignments: ' + e.message });
  }
});

// ─── Admin Management ─────────────────────────────────────────────────────────
router.get('/admins', requireAuth, async (req, res) => {
  if (req.session.adminRole !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Insufficient permissions.' });
  }
  try {
    const { rows: admins } = await db.query('SELECT id, username, full_name, role, created_at FROM admins');
    for (const a of admins) {
      if (a.role === 'staff') {
        const [subRes, clsRes] = await Promise.all([
          db.query('SELECT subject FROM subject_assignments WHERE admin_id = $1', [a.id]),
          db.query('SELECT class FROM class_assignments WHERE admin_id = $1', [a.id]),
        ]);
        a.assignedSubjects = subRes.rows.map(r => r.subject);
        a.assignedClasses  = clsRes.rows.map(r => r.class);
      } else {
        a.assignedSubjects = [];
        a.assignedClasses  = [];
      }
    }
    res.json({ success: true, admins });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/admins', requireAuth, async (req, res) => {
  if (req.session.adminRole !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Insufficient permissions.' });
  }
  const { username, password, full_name, role } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required.' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    await db.query(
      'INSERT INTO admins (username, password_hash, full_name, role) VALUES ($1,$2,$3,$4)',
      [username.trim().toLowerCase(), hash, full_name || username, role || 'admin']
    );
    res.json({ success: true, message: 'Admin user created.' });
  } catch (e) {
    if (e.code === '23505') res.status(400).json({ success: false, message: 'Username already exists.' });
    else res.status(500).json({ success: false, message: e.message });
  }
});

router.delete('/admins/:id', requireAuth, async (req, res) => {
  if (req.session.adminRole !== 'superadmin') return res.status(403).json({ success: false, message: 'Insufficient permissions.' });
  if (parseInt(req.params.id) === req.session.adminId) return res.status(400).json({ success: false, message: 'Cannot delete your own account.' });
  try {
    await db.query('DELETE FROM admins WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Admin deleted.' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── Performance Analysis ─────────────────────────────────────────────────────
router.get('/analysis', requireAuth, async (req, res) => {
  const { class: cls, session, term } = req.query;
  if (!cls || !session || !term) {
    return res.status(400).json({ success: false, message: 'Class, session, and term are required.' });
  }
  try {
    const RANGES = [
      { label: '80 – 100', min: 80, max: 100 },
      { label: '60 – 80',  min: 60, max: 79  },
      { label: '40 – 60',  min: 40, max: 59  },
      { label: '0 – 40',   min: 0,  max: 39  },
    ];

    const stuRes = await db.query('SELECT * FROM students WHERE class = $1 ORDER BY name', [cls]);
    const students = stuRes.rows;
    if (students.length === 0) {
      return res.json({ success: true, studentCount: 0, subjects: [], subjectData: {}, overallTotals: {}, students: [] });
    }

    const allRes = await db.query(`
      SELECT r.*, s.name, s.admission_number FROM results r
      JOIN students s ON r.student_id = s.id
      WHERE s.class = $1 AND r.session = $2 AND r.term = $3
    `, [cls, session, term]);
    const allResults = allRes.rows;

    if (allResults.length === 0) {
      return res.json({ success: true, studentCount: 0, subjects: [], subjectData: {}, overallTotals: {}, students: [] });
    }

    const subjectMap = {};
    for (const r of allResults) {
      if (!subjectMap[r.subject]) subjectMap[r.subject] = { totals: [], studentScores: {} };
      subjectMap[r.subject].totals.push(parseFloat(r.total));
      subjectMap[r.subject].studentScores[r.admission_number] = parseFloat(r.total);
    }

    const subjects = Object.keys(subjectMap).sort();
    const subjectData = {};
    const overallTotals = { '80 – 100': 0, '60 – 80': 0, '40 – 60': 0, '0 – 40': 0 };

    for (const subj of subjects) {
      const totals = subjectMap[subj].totals;
      const counts = {};
      for (const range of RANGES) counts[range.label] = 0;
      for (const score of totals) {
        for (const range of RANGES) {
          if (score >= range.min && score <= range.max) { counts[range.label]++; overallTotals[range.label]++; break; }
        }
      }
      const avg = totals.length > 0 ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
      subjectData[subj] = { counts, avg: parseFloat(avg.toFixed(1)), total_students: totals.length };
    }

    const studentSummary = students.map(student => {
      const studentResults = allResults.filter(r => r.student_id === student.id);
      const scores = {};
      for (const r of studentResults) scores[r.subject] = parseFloat(r.total);
      const vals = Object.values(scores);
      const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      return { name: student.name, admission_number: student.admission_number, scores, average: parseFloat(avg.toFixed(1)), subject_count: vals.length };
    }).filter(s => s.subject_count > 0).sort((a, b) => b.average - a.average);

    res.json({ success: true, studentCount: studentSummary.length, subjects, subjectData, overallTotals, students: studentSummary });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
