const express = require('express');
const router = express.Router();
const db = require('../database');

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

router.post('/check', async (req, res) => {
  const { pin, admission_number } = req.body;
  if (!pin || !admission_number) {
    return res.status(400).json({ success: false, message: 'PIN and Admission Number are required.' });
  }
  try {
    const pinRes = await db.query(`
      SELECT p.*, s.name, s.class, s.admission_number, s.gender, s.date_of_birth
      FROM pins p JOIN students s ON p.student_id = s.id
      WHERE p.pin = $1 AND s.admission_number = $2
    `, [pin.trim().toUpperCase(), admission_number.trim().toUpperCase()]);
    const pinRecord = pinRes.rows[0];

    if (!pinRecord) {
      return res.status(404).json({ success: false, message: 'Invalid PIN or Admission Number. Please check and try again.' });
    }

    const resultsRes = await db.query(`
      SELECT * FROM results WHERE student_id = $1 AND session = $2 AND term = $3 ORDER BY subject
    `, [pinRecord.student_id, pinRecord.session, pinRecord.term]);
    const results = resultsRes.rows;

    if (results.length === 0) {
      return res.status(404).json({ success: false, message: 'No results found for this student. Please contact your school.' });
    }

    const posRes = await db.query(`
      SELECT student_id, SUM(total) AS grand_total FROM results
      WHERE session = $1 AND term = $2 AND class = $3
      GROUP BY student_id ORDER BY grand_total DESC
    `, [pinRecord.session, pinRecord.term, pinRecord.class]);
    const classPositions = posRes.rows;

    const position     = classPositions.findIndex(r => r.student_id === pinRecord.student_id) + 1;
    const totalInClass = classPositions.length;
    const grandTotal   = results.reduce((sum, r) => sum + (parseFloat(r.total) || 0), 0);
    const average      = grandTotal / results.length;

    const processedResults = results.map(r => {
      const { grade, remark } = calculateGrade(parseFloat(r.total));
      return { ...r, grade, remark };
    });

    const settingsRes = await db.query('SELECT key, value FROM school_settings');
    const settings = {};
    settingsRes.rows.forEach(s => { settings[s.key] = s.value; });

    const ratingsRes = await db.query(
      'SELECT type, trait, rating FROM student_ratings WHERE student_id = $1 AND session = $2 AND term = $3',
      [pinRecord.student_id, pinRecord.session, pinRecord.term]
    );
    const affective = {}, psychomotor = {};
    ratingsRes.rows.forEach(r => {
      if (r.type === 'affective')   affective[r.trait]   = r.rating;
      if (r.type === 'psychomotor') psychomotor[r.trait] = r.rating;
    });

    if (!pinRecord.is_used) {
      await db.query('UPDATE pins SET is_used = 1, used_at = CURRENT_TIMESTAMP WHERE id = $1', [pinRecord.id]);
    }

    res.json({
      success: true,
      ratings: { affective, psychomotor },
      student: {
        name: pinRecord.name,
        admission_number: pinRecord.admission_number,
        class: pinRecord.class,
        gender: pinRecord.gender,
        date_of_birth: pinRecord.date_of_birth,
        session: pinRecord.session,
        term: pinRecord.term
      },
      results: processedResults,
      summary: {
        grand_total:      parseFloat(grandTotal.toFixed(1)),
        average:          parseFloat(average.toFixed(1)),
        position,
        total_in_class:   totalInClass,
        subjects_offered: results.length
      },
      settings
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Error checking result: ' + e.message });
  }
});

module.exports = router;
