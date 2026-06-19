/* ═══════════════════════════════════════════════════════════════════
   Student Result Checker + Result Slip Renderer
   ═══════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  loadSchoolBranding();
  setupForm();
  setupPinToggle();
});

// Load school name for header
async function loadSchoolBranding() {
  try {
    const res = await fetch('/api/admin/settings');
    const data = await res.json();
    if (data.success) {
      const n = data.settings.school_name;
      const m = data.settings.school_motto;
      if (n) {
        document.getElementById('brand-school-name').textContent = n;
        document.title = n + ' — Result Portal';
      }
      if (m) document.getElementById('brand-school-motto').textContent = m;
    }
  } catch (_) { /* use defaults */ }
}

function setupPinToggle() {
  const toggle = document.getElementById('pin-visibility');
  const input  = document.getElementById('pin');
  if (!toggle || !input) return;

  toggle.addEventListener('click', () => {
    if (input.type === 'password') {
      input.type = 'text';
      toggle.innerHTML = `<svg id="eye-icon" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2"/></svg>`;
    } else {
      input.type = 'password';
      toggle.innerHTML = `<svg id="eye-icon" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>`;
    }
  });
}

function setupForm() {
  const form = document.getElementById('checker-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const pin = document.getElementById('pin').value.trim().toUpperCase();
    const admission_number = document.getElementById('admission_number').value.trim().toUpperCase();
    const errorDiv = document.getElementById('error-message');
    const errText  = document.getElementById('error-text');
    const btn      = document.getElementById('check-btn');
    const btnText  = btn.querySelector('.btn-text');
    const btnLoader= btn.querySelector('.btn-loader');

    if (!pin || !admission_number) {
      errText.textContent = 'Please enter both your Admission Number and PIN.';
      errorDiv.style.display = 'flex';
      return;
    }

    // Loading state
    btn.disabled = true;
    btnText.style.display = 'none';
    btnLoader.style.display = 'flex';
    errorDiv.style.display = 'none';

    try {
      const res = await fetch('/api/results/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, admission_number })
      });
      const data = await res.json();

      if (data.success) {
        renderResult(data);
      } else {
        errText.textContent = data.message || 'Could not retrieve result. Please check your details and try again.';
        errorDiv.style.display = 'flex';
      }
    } catch (err) {
      errText.textContent = 'Connection error. Please check your internet and try again.';
      errorDiv.style.display = 'flex';
    } finally {
      btn.disabled = false;
      btnText.style.display = 'flex';
      btnLoader.style.display = 'none';
    }
  });
}

// ─── Result Rendering ─────────────────────────────────────────────────────────

function getOrdinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function getGradeClass(grade) {
  if (grade === 'A1')                  return 'grade-excellent';
  if (grade === 'B2' || grade === 'B3') return 'grade-very-good';
  if (['C4','C5','C6'].includes(grade)) return 'grade-credit';
  if (grade === 'D7' || grade === 'E8') return 'grade-pass';
  return 'grade-fail';
}

function getAverageRemark(avg) {
  if (avg >= 75) return 'Outstanding';
  if (avg >= 65) return 'Excellent';
  if (avg >= 55) return 'Very Good';
  if (avg >= 45) return 'Good';
  if (avg >= 40) return 'Satisfactory';
  return 'Needs Improvement';
}

function renderResult(data) {
  const { student, results, summary, settings, ratings = {} } = data;

  document.getElementById('checker-section').style.display = 'none';
  document.getElementById('result-section').style.display  = 'block';

  const container = document.getElementById('result-slip-container');

  const slip = document.createElement('div');
  slip.className = 'result-slip';
  slip.id = 'result-slip';

  slip.innerHTML = buildSlipHTML(student, results, summary, settings, ratings);
  container.innerHTML = '';
  container.appendChild(slip);

  // Update page title
  document.title = `Result Slip — ${student.name} — ${student.session}`;
}

const AFFECTIVE_TRAITS   = ['Alertness','Honesty','Neatness','Politeness','Punctuality','Relationship with Others','Reliability'];
const PSYCHOMOTOR_SKILLS = ['Construction','Drawing & Arts','Flexibility','Games & Sports','Handwriting','Musical Skills','Paintings'];
const RATING_LABELS      = { 5:'Excellent', 4:'Very Good', 3:'Good', 2:'Fair', 1:'Poor', 0:'' };

function ratingDots(value) {
  const n = parseInt(value) || 0;
  return `<span class="rating-dots">${[5,4,3,2,1].map(v =>
    `<span class="rating-dot${n === v ? ' active r-'+v : ''}"></span>`
  ).join('')}</span>`;
}

function buildSlipHTML(student, results, summary, settings, ratings = {}) {
  const sn = settings.school_name    || 'HOUSE OF ANGEL SCHOOLS';
  const sa = settings.school_address || '';
  const sp = settings.school_phone   || '';
  const se = settings.school_email   || '';
  const pp = settings.principal_name || 'The Principal';
  const sm = settings.school_motto   || '';

  const tableRows = results.map((r, i) => `
    <tr>
      <td class="td-center">${i + 1}</td>
      <td class="td-subject">${escHtml(r.subject)}</td>
      <td class="td-center">${fmt(r.ca1)}</td>
      <td class="td-center">${fmt(r.ca2)}</td>
      <td class="td-center">${fmt(r.exam)}</td>
      <td class="td-center td-total">${fmt(r.total)}</td>
      <td class="td-center td-grade ${getGradeClass(r.grade)}">${r.grade}</td>
      <td class="td-remark">${r.remark}</td>
    </tr>
  `).join('');

  const averageRemark = getAverageRemark(summary.average);
  const now = new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });

  return `
    <!-- School Header -->
    <div class="slip-header">
      <div class="school-crest-large">
        <img src="/assets/images/school-logo.png" alt="School Logo" style="width:70px;height:70px;object-fit:contain;">
      </div>
      <div class="school-info">
        <div class="school-name">${escHtml(sn)}</div>
        ${sm ? `<div style="font-size:0.72rem;color:rgba(255,215,0,0.8);font-style:italic;margin-top:2px">"${escHtml(sm)}"</div>` : ''}
        <div class="school-address">${escHtml(sa)}</div>
        <div class="school-contact">
          ${sp ? 'Tel: ' + escHtml(sp) : ''}
          ${sp && se ? ' | ' : ''}
          ${se ? 'Email: ' + escHtml(se) : ''}
        </div>
        <div class="slip-title">
          <h2>STUDENT RESULT SLIP</h2>
          <span>${escHtml(student.term)} &mdash; ${escHtml(student.session)} Academic Session</span>
        </div>
      </div>
      <div class="school-crest-right">
        <div class="student-photo-placeholder">PASSPORT<br>PHOTO</div>
      </div>
    </div>

    <!-- Student Info -->
    <div class="student-info-band">
      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">Student's Name</span>
          <span class="info-value">${escHtml(student.name.toUpperCase())}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Admission No.</span>
          <span class="info-value">${escHtml(student.admission_number)}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Class</span>
          <span class="info-value">${escHtml(student.class)}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Session</span>
          <span class="info-value">${escHtml(student.session)}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Term</span>
          <span class="info-value">${escHtml(student.term)}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Gender</span>
          <span class="info-value">${escHtml(student.gender || 'N/A')}</span>
        </div>
      </div>
    </div>

    <!-- Results Table -->
    <div class="results-table-wrapper">
      <table class="results-table">
        <thead>
          <tr>
            <th class="th-sn">S/N</th>
            <th class="th-subject">Subject</th>
            <th class="th-score">1st CA<br><small>(20)</small></th>
            <th class="th-score">2nd CA<br><small>(20)</small></th>
            <th class="th-score">Exam<br><small>(60)</small></th>
            <th class="th-total">Total<br><small>(100)</small></th>
            <th class="th-grade">Grade</th>
            <th class="th-remark">Remark</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
        <tfoot>
          <tr class="tfoot-total">
            <td colspan="5" class="td-total-label">TOTAL SCORE</td>
            <td class="td-center td-total">${summary.grand_total}</td>
            <td colspan="2"></td>
          </tr>
          <tr class="tfoot-average">
            <td colspan="5" class="td-total-label">AVERAGE SCORE</td>
            <td class="td-center td-total">${summary.average}%</td>
            <td colspan="2" class="td-remark" style="font-style:italic">${averageRemark}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- Summary -->
    <div class="summary-band">
      <div class="summary-grid">
        <div class="summary-item">
          <span class="summary-label">Aggregate Score</span>
          <span class="summary-value">${summary.grand_total}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Average Score</span>
          <span class="summary-value">${summary.average}%</span>
        </div>
        <div class="summary-item highlight">
          <span class="summary-label">Position in Class</span>
          <span class="summary-value">${getOrdinal(summary.position)} / ${summary.total_in_class}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Subjects Offered</span>
          <span class="summary-value">${summary.subjects_offered}</span>
        </div>
      </div>
    </div>

    <!-- Grade Key -->
    <div class="grade-key">
      <strong>GRADE KEY:</strong>
      <span class="gk-item grade-excellent">A1: 75–100 Excellent</span>
      <span class="gk-item grade-very-good">B2: 70–74 Very Good</span>
      <span class="gk-item grade-very-good">B3: 65–69 Good</span>
      <span class="gk-item grade-credit">C4: 60–64 Credit</span>
      <span class="gk-item grade-credit">C5: 55–59 Credit</span>
      <span class="gk-item grade-credit">C6: 50–54 Credit</span>
      <span class="gk-item grade-pass">D7: 45–49 Pass</span>
      <span class="gk-item grade-pass">E8: 40–44 Pass</span>
      <span class="gk-item grade-fail">F9: 0–39 Fail</span>
    </div>

    <!-- Affective Traits & Psychomotor -->
    <div class="traits-section">
      <!-- Affective Traits -->
      <div class="traits-box">
        <div class="traits-title">AFFECTIVE TRAITS</div>
        <table class="traits-table">
          <thead>
            <tr><th>Trait</th><th>Rating</th><th>Remark</th></tr>
          </thead>
          <tbody>
            ${AFFECTIVE_TRAITS.map(trait => {
              const val = parseInt((ratings.affective || {})[trait]) || 0;
              return `<tr>
                <td class="trait-name">${escHtml(trait)}</td>
                <td class="trait-rating">${val > 0 ? val : '—'}</td>
                <td class="trait-remark">${RATING_LABELS[val] || ''}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <!-- Psychomotor -->
      <div class="traits-box">
        <div class="traits-title">PSYCHOMOTOR</div>
        <table class="traits-table">
          <thead>
            <tr><th>Skill</th><th>Rating</th><th>Remark</th></tr>
          </thead>
          <tbody>
            ${PSYCHOMOTOR_SKILLS.map(skill => {
              const val = parseInt((ratings.psychomotor || {})[skill]) || 0;
              return `<tr>
                <td class="trait-name">${escHtml(skill)}</td>
                <td class="trait-rating">${val > 0 ? val : '—'}</td>
                <td class="trait-remark">${RATING_LABELS[val] || ''}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <!-- Rating Key -->
      <div class="traits-key">
        <div class="traits-title">KEY</div>
        <table class="traits-table">
          <tbody>
            <tr><td class="trait-rating">5</td><td class="trait-remark">Excellent</td></tr>
            <tr><td class="trait-rating">4</td><td class="trait-remark">Very Good</td></tr>
            <tr><td class="trait-rating">3</td><td class="trait-remark">Good</td></tr>
            <tr><td class="trait-rating">2</td><td class="trait-remark">Fair</td></tr>
            <tr><td class="trait-rating">1</td><td class="trait-remark">Poor</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Remarks & Signatures -->
    <div class="remarks-section">
      <div class="remark-col">
        <p><strong>Class Teacher's Remark:</strong></p>
        <div class="remark-line"></div>
        <p style="font-size:0.78rem;color:#666;font-style:italic">${averageRemark}</p>
        <div class="sign-area" style="margin-top:1.25rem">
          <div class="sign-line"></div>
          <p>Class Teacher's Signature &amp; Date</p>
        </div>
      </div>
      <div class="remark-col">
        <p><strong>Principal's Remark:</strong></p>
        <div class="remark-line"></div>
        <p style="font-size:0.78rem;color:#666;font-style:italic">&nbsp;</p>
        <div class="sign-area" style="margin-top:1.25rem">
          <div class="sign-line"></div>
          <p>${escHtml(pp)} &mdash; Principal</p>
        </div>
      </div>
      <div class="stamp-area">
        <div class="stamp-circle">SCHOOL<br>STAMP</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="slip-footer">
      <p>This is a computer-generated result slip. It is valid without a physical signature when printed from the official portal.</p>
      <p style="margin-top:3px">Generated: ${now}</p>
    </div>

    <!-- Watermark -->
    <div class="watermark">${escHtml(sn)}</div>
  `;
}

function fmt(v) {
  const n = parseFloat(v);
  return isNaN(n) ? '0' : (Number.isInteger(n) ? n : n.toFixed(1));
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
