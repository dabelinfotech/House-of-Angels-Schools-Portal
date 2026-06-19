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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
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

function getUniquePin() {
  let pin;
  do {
    pin = generatePin();
  } while (db.prepare('SELECT id FROM pins WHERE pin = ?').get(pin));
  return pin;
}

// ─── Current User ─────────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const admin = db.prepare('SELECT id, username, full_name, role FROM admins WHERE id = ?').get(req.session.adminId);
  if (!admin) return res.status(401).json({ success: false });
  let assignedSubjects = [];
  let assignedClasses = [];
  if (admin.role === 'staff') {
    assignedSubjects = db.prepare('SELECT subject FROM subject_assignments WHERE admin_id = ?')
      .all(req.session.adminId).map(r => r.subject);
    assignedClasses = db.prepare('SELECT class FROM class_assignments WHERE admin_id = ?')
      .all(req.session.adminId).map(r => r.class);
  }
  res.json({ success: true, admin: { ...admin, assignedSubjects, assignedClasses } });
});

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
router.get('/stats', requireAuth, (req, res) => {
  const stats = {
    total_students: db.prepare('SELECT COUNT(*) as c FROM students').get().c,
    total_results: db.prepare('SELECT COUNT(*) as c FROM results').get().c,
    total_pins: db.prepare('SELECT COUNT(*) as c FROM pins').get().c,
    used_pins: db.prepare('SELECT COUNT(*) as c FROM pins WHERE is_used = 1').get().c,
    classes: db.prepare("SELECT DISTINCT class FROM students ORDER BY class").all().map(r => r.class),
    sessions: db.prepare("SELECT DISTINCT session FROM results ORDER BY session DESC").all().map(r => r.session),
    recent_results: db.prepare(`
      SELECT r.*, s.name, s.admission_number FROM results r
      JOIN students s ON r.student_id = s.id
      ORDER BY r.created_at DESC LIMIT 10
    `).all()
  };
  res.json({ success: true, stats });
});

// ─── Students ─────────────────────────────────────────────────────────────────
router.get('/students', requireAuth, (req, res) => {
  const { class: cls, search } = req.query;
  let query = 'SELECT * FROM students WHERE 1=1';
  const params = [];

  if (cls) { query += ' AND class = ?'; params.push(cls); }
  if (search) {
    query += ' AND (name LIKE ? OR admission_number LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY class, name';
  const students = db.prepare(query).all(...params);
  res.json({ success: true, students });
});

router.post('/students', requireAuth, (req, res) => {
  const { name, admission_number, class: cls, date_of_birth, gender } = req.body;

  if (!name || !admission_number || !cls) {
    return res.status(400).json({ success: false, message: 'Name, Admission Number, and Class are required.' });
  }

  try {
    const result = db.prepare(
      'INSERT INTO students (name, admission_number, class, date_of_birth, gender) VALUES (?, ?, ?, ?, ?)'
    ).run(name.trim(), admission_number.trim().toUpperCase(), cls.trim(), date_of_birth || null, gender || null);

    res.json({ success: true, message: 'Student added successfully.', id: result.lastInsertRowid });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      res.status(400).json({ success: false, message: 'Admission number already exists.' });
    } else {
      res.status(500).json({ success: false, message: 'Error adding student: ' + e.message });
    }
  }
});

router.put('/students/:id', requireAuth, (req, res) => {
  const { name, class: cls, date_of_birth, gender } = req.body;

  db.prepare(
    'UPDATE students SET name = ?, class = ?, date_of_birth = ?, gender = ? WHERE id = ?'
  ).run(name, cls, date_of_birth || null, gender || null, req.params.id);

  res.json({ success: true, message: 'Student updated.' });
});

router.delete('/students/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  db.prepare('DELETE FROM results WHERE student_id = ?').run(id);
  db.prepare('DELETE FROM pins WHERE student_id = ?').run(id);
  db.prepare('DELETE FROM students WHERE id = ?').run(id);
  res.json({ success: true, message: 'Student and associated records deleted.' });
});

// ─── Individual Result Management ─────────────────────────────────────────────
router.get('/student-results/:studentId', requireAuth, (req, res) => {
  const { session, term } = req.query;
  let query = 'SELECT * FROM results WHERE student_id = ?';
  const params = [req.params.studentId];

  if (session) { query += ' AND session = ?'; params.push(session); }
  if (term) { query += ' AND term = ?'; params.push(term); }

  query += ' ORDER BY subject';
  const results = db.prepare(query).all(...params);
  res.json({ success: true, results });
});

router.post('/results', requireAuth, (req, res) => {
  const { student_id, subject, ca1, ca2, exam, session, term, class: cls } = req.body;

  if (!student_id || !subject || !session || !term) {
    return res.status(400).json({ success: false, message: 'Student, subject, session, and term are required.' });
  }

  // Staff permission: check subject and class restrictions
  if (req.session.adminRole === 'staff') {
    const staffSubjects = db.prepare('SELECT subject FROM subject_assignments WHERE admin_id = ?')
      .all(req.session.adminId).map(r => r.subject);
    const staffClasses = db.prepare('SELECT class FROM class_assignments WHERE admin_id = ?')
      .all(req.session.adminId).map(r => r.class);
    if (!staffSubjects.length && !staffClasses.length) {
      return res.status(403).json({ success: false, message: 'You have no upload permissions assigned.' });
    }
    if (staffSubjects.length && !staffSubjects.includes(subject)) {
      return res.status(403).json({ success: false, message: 'You are not assigned to upload results for this subject.' });
    }
    if (staffClasses.length && !staffClasses.includes(cls)) {
      return res.status(403).json({ success: false, message: 'You are not assigned to upload results for this class.' });
    }
  }

  const ca1v = parseFloat(ca1) || 0;
  const ca2v = parseFloat(ca2) || 0;
  const examv = parseFloat(exam) || 0;
  const total = Math.min(ca1v + ca2v + examv, 100);
  const { grade, remark } = calculateGrade(total);

  const student = db.prepare('SELECT class FROM students WHERE id = ?').get(student_id);
  const classVal = cls || (student ? student.class : '');

  try {
    db.prepare(`
      INSERT INTO results (student_id, subject, ca1, ca2, exam, total, grade, remark, session, term, class)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(student_id, subject, session, term) DO UPDATE SET
        ca1=excluded.ca1, ca2=excluded.ca2, exam=excluded.exam,
        total=excluded.total, grade=excluded.grade, remark=excluded.remark, class=excluded.class
    `).run(student_id, subject, ca1v, ca2v, examv, total, grade, remark, session, term, classVal);

    res.json({ success: true, message: 'Result saved.' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Error saving result: ' + e.message });
  }
});

router.delete('/results/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM results WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Result deleted.' });
});

// ─── Bulk Upload (Excel) ───────────────────────────────────────────────────────
router.post('/upload-results', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);
    const worksheet = workbook.getWorksheet(1);

    if (!worksheet || worksheet.rowCount < 2) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'The spreadsheet is empty.' });
    }

    // Build header map from first row
    const headerRow = worksheet.getRow(1);
    const headers = {};
    headerRow.eachCell((cell, colNum) => {
      headers[String(cell.value || '').trim()] = colNum;
    });

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
    worksheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return; // skip header
      data.push({ row, rowNum });
    });

    if (data.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'The spreadsheet is empty.' });
    }

    let processed = 0, skipped = 0;
    const errors = [];
    let staffSubjects = null, staffClasses = null;

    const upsertResult = db.prepare(`
      INSERT INTO results (student_id, subject, ca1, ca2, exam, total, grade, remark, session, term, class)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(student_id, subject, session, term) DO UPDATE SET
        ca1=excluded.ca1, ca2=excluded.ca2, exam=excluded.exam,
        total=excluded.total, grade=excluded.grade, remark=excluded.remark, class=excluded.class
    `);

    const processRows = db.transaction((rows) => {
      for (const { row, rowNum } of rows) {
        const studentName = getCell(row, 'Student Name', 'Name', 'STUDENT NAME');
        const admissionNo = getCell(row, 'Admission No', 'Admission Number', 'ADMISSION NO').toUpperCase();
        const cls = getCell(row, 'Class', 'CLASS');
        const session = getCell(row, 'Session', 'SESSION');
        const term = getCell(row, 'Term', 'TERM');
        const subject = getCell(row, 'Subject', 'SUBJECT');
        const ca1 = Math.min(parseFloat(getCell(row, 'CA1', 'First CA', '1st CA') || 0) || 0, 20);
        const ca2 = Math.min(parseFloat(getCell(row, 'CA2', 'Second CA', '2nd CA') || 0) || 0, 20);
        const exam = Math.min(parseFloat(getCell(row, 'Exam', 'Exam Score', 'EXAM') || 0) || 0, 60);

        if (!admissionNo) { errors.push(`Row ${rowNum}: Missing admission number.`); skipped++; continue; }
        if (!subject) { errors.push(`Row ${rowNum}: Missing subject.`); skipped++; continue; }
        if (!session) { errors.push(`Row ${rowNum}: Missing session.`); skipped++; continue; }
        if (!term) { errors.push(`Row ${rowNum}: Missing term.`); skipped++; continue; }

        // Staff permission check per row
        if (staffSubjects !== null) {
          if (staffSubjects.length && !staffSubjects.includes(subject)) {
            errors.push(`Row ${rowNum}: Not authorized for subject: ${subject}`); skipped++; continue;
          }
          if (staffClasses && staffClasses.length && cls && !staffClasses.includes(cls)) {
            errors.push(`Row ${rowNum}: Not authorized for class: ${cls}`); skipped++; continue;
          }
        }

        // Find or create student
        let student = db.prepare('SELECT * FROM students WHERE admission_number = ?').get(admissionNo);
        if (!student) {
          if (!studentName) { errors.push(`Row ${rowNum}: Student ${admissionNo} not found and no name provided.`); skipped++; continue; }
          db.prepare('INSERT OR IGNORE INTO students (name, admission_number, class) VALUES (?, ?, ?)').run(studentName, admissionNo, cls || 'Unknown');
          student = db.prepare('SELECT * FROM students WHERE admission_number = ?').get(admissionNo);
        }

        if (cls && student.class !== cls) {
          db.prepare('UPDATE students SET class = ? WHERE id = ?').run(cls, student.id);
        }

        const total = Math.min(ca1 + ca2 + exam, 100);
        const { grade, remark } = calculateGrade(total);

        upsertResult.run(student.id, subject, ca1, ca2, exam, total, grade, remark, session, term, cls || student.class);
        processed++;
      }
    });

    if (req.session.adminRole === 'staff') {
      staffSubjects = db.prepare('SELECT subject FROM subject_assignments WHERE admin_id = ?')
        .all(req.session.adminId).map(r => r.subject);
      staffClasses = db.prepare('SELECT class FROM class_assignments WHERE admin_id = ?')
        .all(req.session.adminId).map(r => r.class);
      if (!staffSubjects.length && !staffClasses.length) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(403).json({ success: false, message: 'You have no upload permissions assigned.' });
      }
    }

    processRows(data);

    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      message: `Upload complete. ${processed} record(s) processed, ${skipped} skipped.`,
      processed,
      skipped,
      errors: errors.slice(0, 30)
    });

  } catch (e) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, message: 'Error processing file: ' + e.message });
  }
});

// ─── PINs ─────────────────────────────────────────────────────────────────────
router.post('/generate-pins', requireAuth, (req, res) => {
  const { session, term, class: cls } = req.body;

  if (!session || !term || !cls) {
    return res.status(400).json({ success: false, message: 'Session, term, and class are required.' });
  }

  const students = db.prepare('SELECT * FROM students WHERE class = ? ORDER BY name').all(cls);

  if (students.length === 0) {
    return res.status(404).json({ success: false, message: 'No students found in this class.' });
  }

  const generateAllPins = db.transaction(() => {
    const pins = [];
    for (const student of students) {
      let existing = db.prepare('SELECT * FROM pins WHERE student_id = ? AND session = ? AND term = ?').get(student.id, session, term);
      if (!existing) {
        const pin = getUniquePin();
        db.prepare('INSERT INTO pins (pin, student_id, session, term) VALUES (?, ?, ?, ?)').run(pin, student.id, session, term);
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
    return pins;
  });

  const pins = generateAllPins();
  res.json({ success: true, pins, count: pins.length });
});

router.get('/pins', requireAuth, (req, res) => {
  const { session, term, class: cls } = req.query;
  let query = `
    SELECT p.*, s.name, s.admission_number, s.class
    FROM pins p JOIN students s ON p.student_id = s.id
    WHERE 1=1
  `;
  const params = [];

  if (session) { query += ' AND p.session = ?'; params.push(session); }
  if (term) { query += ' AND p.term = ?'; params.push(term); }
  if (cls) { query += ' AND s.class = ?'; params.push(cls); }

  query += ' ORDER BY s.class, s.name';
  const pins = db.prepare(query).all(...params);
  res.json({ success: true, pins });
});

router.delete('/pins/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM pins WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'PIN deleted.' });
});

// ─── Class Results Viewer ─────────────────────────────────────────────────────
router.get('/class-results', requireAuth, (req, res) => {
  const { class: cls, session, term } = req.query;

  if (!cls || !session || !term) {
    return res.status(400).json({ success: false, message: 'Class, session, and term are required.' });
  }

  const students = db.prepare('SELECT * FROM students WHERE class = ? ORDER BY name').all(cls);

  const data = students.map(student => {
    const results = db.prepare(
      'SELECT * FROM results WHERE student_id = ? AND session = ? AND term = ? ORDER BY subject'
    ).all(student.id, session, term);

    const grand_total = results.reduce((sum, r) => sum + (r.total || 0), 0);
    const average = results.length > 0 ? grand_total / results.length : 0;

    return { ...student, results, grand_total, average: parseFloat(average.toFixed(1)) };
  }).filter(s => s.results.length > 0);

  // Assign positions
  data.sort((a, b) => b.grand_total - a.grand_total);
  data.forEach((s, i) => { s.position = i + 1; });

  res.json({ success: true, students: data });
});

// ─── School Settings ──────────────────────────────────────────────────────────
router.get('/settings', requireAuth, (req, res) => {
  const settings = {};
  db.prepare('SELECT key, value FROM school_settings').all().forEach(s => { settings[s.key] = s.value; });
  res.json({ success: true, settings });
});

router.put('/settings', requireAuth, (req, res) => {
  const update = db.prepare('INSERT OR REPLACE INTO school_settings (key, value) VALUES (?, ?)');
  const save = db.transaction((obj) => {
    Object.entries(obj).forEach(([k, v]) => update.run(k, String(v)));
  });
  save(req.body);
  res.json({ success: true, message: 'Settings saved.' });
});

// ─── Affective & Psychomotor Ratings ─────────────────────────────────────────
const AFFECTIVE_TRAITS = [
  'Alertness', 'Honesty', 'Neatness', 'Politeness',
  'Punctuality', 'Relationship with Others', 'Reliability'
];

const PSYCHOMOTOR_SKILLS = [
  'Construction', 'Drawing & Arts', 'Flexibility',
  'Games & Sports', 'Handwriting', 'Musical Skills', 'Paintings'
];

router.get('/student-ratings/:studentId', requireAuth, (req, res) => {
  const { session, term } = req.query;
  if (!session || !term) {
    return res.status(400).json({ success: false, message: 'Session and term are required.' });
  }

  const rows = db.prepare(
    'SELECT type, trait, rating FROM student_ratings WHERE student_id = ? AND session = ? AND term = ?'
  ).all(req.params.studentId, session, term);

  const affective    = {};
  const psychomotor  = {};
  rows.forEach(r => {
    if (r.type === 'affective')   affective[r.trait]   = r.rating;
    if (r.type === 'psychomotor') psychomotor[r.trait] = r.rating;
  });

  res.json({ success: true, affective, psychomotor });
});

router.put('/student-ratings/:studentId', requireAuth, (req, res) => {
  const { session, term, affective = {}, psychomotor = {} } = req.body;
  if (!session || !term) {
    return res.status(400).json({ success: false, message: 'Session and term are required.' });
  }

  const student = db.prepare('SELECT id FROM students WHERE id = ?').get(req.params.studentId);
  if (!student) {
    return res.status(404).json({ success: false, message: 'Student not found.' });
  }

  const upsert = db.prepare(`
    INSERT INTO student_ratings (student_id, session, term, type, trait, rating)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(student_id, session, term, type, trait)
    DO UPDATE SET rating = excluded.rating
  `);

  try {
    const saveAll = db.transaction(() => {
      AFFECTIVE_TRAITS.forEach(trait => {
        const rating = parseInt(affective[trait]) || 0;
        upsert.run(req.params.studentId, session, term, 'affective', trait, rating);
      });
      PSYCHOMOTOR_SKILLS.forEach(trait => {
        const rating = parseInt(psychomotor[trait]) || 0;
        upsert.run(req.params.studentId, session, term, 'psychomotor', trait, rating);
      });
    });
    saveAll();
    res.json({ success: true, message: 'Ratings saved.' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Error saving ratings: ' + e.message });
  }
});

// ─── Class Arms ───────────────────────────────────────────────────────────────
router.get('/classes', requireAuth, (req, res) => {
  res.json({ success: true, classes: CLASS_ARMS });
});

// ─── Subjects List ────────────────────────────────────────────────────────────
router.get('/subjects', requireAuth, (req, res) => {
  const subjects = getSubjectsForClass(req.query.class);
  const all = [...new Set([...PRESCHOOL_SUBJECTS, ...NURSERY_SUBJECTS, ...PRIMARY_SUBJECTS])];
  res.json({ success: true, subjects, preschool: PRESCHOOL_SUBJECTS, nursery: NURSERY_SUBJECTS, primary: PRIMARY_SUBJECTS, all });
});

// ─── Staff Subject Assignments ────────────────────────────────────────────────
router.get('/staff-assignments/:adminId', requireAuth, (req, res) => {
  const subjects = db.prepare('SELECT subject FROM subject_assignments WHERE admin_id = ?')
    .all(req.params.adminId).map(r => r.subject);
  res.json({ success: true, subjects });
});

router.put('/staff-assignments/:adminId', requireAuth, (req, res) => {
  if (req.session.adminRole !== 'superadmin' && req.session.adminRole !== 'admin') {
    return res.status(403).json({ success: false, message: 'Insufficient permissions.' });
  }
  const { subjects } = req.body;
  const adminId = parseInt(req.params.adminId);
  const admin = db.prepare('SELECT id FROM admins WHERE id = ?').get(adminId);
  if (!admin) return res.status(404).json({ success: false, message: 'Staff member not found.' });
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM subject_assignments WHERE admin_id = ?').run(adminId);
      if (Array.isArray(subjects) && subjects.length) {
        const ins = db.prepare('INSERT OR IGNORE INTO subject_assignments (admin_id, subject) VALUES (?, ?)');
        subjects.forEach(s => ins.run(adminId, s));
      }
    })();
    res.json({ success: true, message: 'Subject assignments updated.' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Error updating assignments: ' + e.message });
  }
});

// ─── Staff Class Assignments ──────────────────────────────────────────────────
router.get('/class-assignments/:adminId', requireAuth, (req, res) => {
  const classes = db.prepare('SELECT class FROM class_assignments WHERE admin_id = ?')
    .all(req.params.adminId).map(r => r.class);
  res.json({ success: true, classes });
});

router.put('/class-assignments/:adminId', requireAuth, (req, res) => {
  if (req.session.adminRole !== 'superadmin' && req.session.adminRole !== 'admin') {
    return res.status(403).json({ success: false, message: 'Insufficient permissions.' });
  }
  const { classes } = req.body;
  const adminId = parseInt(req.params.adminId);
  const admin = db.prepare('SELECT id FROM admins WHERE id = ?').get(adminId);
  if (!admin) return res.status(404).json({ success: false, message: 'Staff member not found.' });
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM class_assignments WHERE admin_id = ?').run(adminId);
      if (Array.isArray(classes) && classes.length) {
        const ins = db.prepare('INSERT OR IGNORE INTO class_assignments (admin_id, class) VALUES (?, ?)');
        classes.forEach(c => ins.run(adminId, c));
      }
    })();
    res.json({ success: true, message: 'Class assignments updated.' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Error updating class assignments: ' + e.message });
  }
});

// ─── Admin Management ─────────────────────────────────────────────────────────
router.get('/admins', requireAuth, (req, res) => {
  if (req.session.adminRole !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Insufficient permissions.' });
  }
  const admins = db.prepare('SELECT id, username, full_name, role, created_at FROM admins').all();
  admins.forEach(a => {
    if (a.role === 'staff') {
      a.assignedSubjects = db.prepare('SELECT subject FROM subject_assignments WHERE admin_id = ?').all(a.id).map(r => r.subject);
      a.assignedClasses  = db.prepare('SELECT class FROM class_assignments WHERE admin_id = ?').all(a.id).map(r => r.class);
    } else {
      a.assignedSubjects = [];
      a.assignedClasses  = [];
    }
  });
  res.json({ success: true, admins });
});

router.post('/admins', requireAuth, (req, res) => {
  if (req.session.adminRole !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Insufficient permissions.' });
  }
  const { username, password, full_name, role } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required.' });

  try {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO admins (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)').run(username.trim().toLowerCase(), hash, full_name || username, role || 'admin');
    res.json({ success: true, message: 'Admin user created.' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) res.status(400).json({ success: false, message: 'Username already exists.' });
    else res.status(500).json({ success: false, message: e.message });
  }
});

router.delete('/admins/:id', requireAuth, (req, res) => {
  if (req.session.adminRole !== 'superadmin') return res.status(403).json({ success: false, message: 'Insufficient permissions.' });
  if (parseInt(req.params.id) === req.session.adminId) return res.status(400).json({ success: false, message: 'Cannot delete your own account.' });
  db.prepare('DELETE FROM admins WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Admin deleted.' });
});

// ─── Performance Analysis ─────────────────────────────────────────────────────
router.get('/analysis', requireAuth, (req, res) => {
  const { class: cls, session, term } = req.query;

  if (!cls || !session || !term) {
    return res.status(400).json({ success: false, message: 'Class, session, and term are required.' });
  }

  const RANGES = [
    { label: '80 – 100', min: 80, max: 100 },
    { label: '60 – 80',  min: 60, max: 79  },
    { label: '40 – 60',  min: 40, max: 59  },
    { label: '0 – 40',   min: 0,  max: 39  },
  ];

  const students = db.prepare('SELECT * FROM students WHERE class = ? ORDER BY name').all(cls);

  if (students.length === 0) {
    return res.json({ success: true, studentCount: 0, subjects: [], subjectData: {}, overallTotals: {}, students: [] });
  }

  // Collect all results for this class/session/term
  const allResults = db.prepare(`
    SELECT r.*, s.name, s.admission_number
    FROM results r
    JOIN students s ON r.student_id = s.id
    WHERE s.class = ? AND r.session = ? AND r.term = ?
  `).all(cls, session, term);

  if (allResults.length === 0) {
    return res.json({ success: true, studentCount: 0, subjects: [], subjectData: {}, overallTotals: {}, students: [] });
  }

  // Build subject data
  const subjectMap = {};
  for (const r of allResults) {
    if (!subjectMap[r.subject]) {
      subjectMap[r.subject] = { totals: [], studentScores: {} };
    }
    subjectMap[r.subject].totals.push(r.total);
    subjectMap[r.subject].studentScores[r.admission_number] = r.total;
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
        if (score >= range.min && score <= range.max) {
          counts[range.label]++;
          overallTotals[range.label]++;
          break;
        }
      }
    }

    const avg = totals.length > 0 ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
    subjectData[subj] = {
      counts,
      avg: parseFloat(avg.toFixed(1)),
      total_students: totals.length
    };
  }

  // Per-student summary
  const studentSummary = students.map(student => {
    const studentResults = allResults.filter(r => r.student_id === student.id);
    const scores = {};
    for (const r of studentResults) scores[r.subject] = r.total;
    const vals = Object.values(scores);
    const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return {
      name: student.name,
      admission_number: student.admission_number,
      scores,
      average: parseFloat(avg.toFixed(1)),
      subject_count: vals.length
    };
  }).filter(s => s.subject_count > 0).sort((a, b) => b.average - a.average);

  res.json({
    success: true,
    studentCount: studentSummary.length,
    subjects,
    subjectData,
    overallTotals,
    students: studentSummary
  });
});

module.exports = router;
