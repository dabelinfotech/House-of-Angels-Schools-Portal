/* ═══════════════════════════════════════════════════════════════════
   Admin Dashboard JavaScript
   ═══════════════════════════════════════════════════════════════════ */

// ─── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  await loadMe();
  await loadClassArms();
  await loadStats();
  await loadSettings();
  setupScorePreview();
  setupUploadZone();
  setupSessionSelects();
});

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/check');
    if (!res.ok) { window.location.href = '/admin'; return; }
    const data = await res.json();
    if (!data.authenticated) { window.location.href = '/admin'; return; }

    const name = data.admin.full_name || data.admin.username;
    document.getElementById('admin-name').textContent = name;
    document.getElementById('admin-role').textContent = data.admin.role === 'superadmin' ? 'Super Admin' : 'Admin';
    document.getElementById('overview-admin-name').textContent = name;
    document.getElementById('user-initial').textContent = name.charAt(0).toUpperCase();
    updateSlipBadge();
  } catch (e) {
    window.location.href = '/admin';
  }
}

// ─── Navigation ────────────────────────────────────────────────────────────────

const sectionTitles = {
  overview:    'Overview',
  students:    'Student Management',
  results:     'Individual Results',
  upload:      'Bulk Upload',
  pins:        'PIN Manager',
  tabulation:  'Tabulation Sheet',
  analysis:    'Performance Analysis',
  classview:   'Class Result Viewer',
  slips:       'Payment Slips',
  settings:    'Settings'
};

function showSection(name) {
  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const section = document.getElementById('section-' + name);
  if (section) section.classList.add('active');

  const navItem = document.querySelector(`[data-section="${name}"]`);
  if (navItem) navItem.classList.add('active');

  document.getElementById('page-title').textContent = sectionTitles[name] || name;

  // Lazy load section data
  if (name === 'students') loadStudents();
  if (name === 'pins')     { loadPins(); populatePinClassDropdown(); }
  if (name === 'tabulation') populateTabulationDropdowns();
  if (name === 'analysis') populateAnalysisDropdowns();
  if (name === 'classview') populateClassViewDropdowns();
  if (name === 'slips')    loadPaymentSlips();
  if (name === 'settings') loadSettingsForm();

  // Close sidebar on mobile
  if (window.innerWidth < 768) document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ─── Stats ─────────────────────────────────────────────────────────────────────

async function loadStats() {
  try {
    const res  = await fetch('/api/admin/stats');
    const data = await res.json();
    if (!data.success) return;

    const s = data.stats;
    cachedStats = s;
    document.getElementById('stat-students').textContent  = s.total_students;
    document.getElementById('stat-results').textContent   = s.total_results;
    document.getElementById('stat-pins').textContent      = s.total_pins;
    document.getElementById('stat-used-pins').textContent = s.used_pins;

    // Class badges
    const badgesEl = document.getElementById('class-badges');
    if (s.classes.length > 0) {
      badgesEl.innerHTML = s.classes.map(c => `<span class="class-badge">${c}</span>`).join('');
    } else {
      badgesEl.innerHTML = '<p style="padding:0.5rem;color:#94a3b8;font-size:0.82rem">No classes yet</p>';
    }

    // Recent results
    const tbody = document.getElementById('recent-results-body');
    if (s.recent_results.length > 0) {
      tbody.innerHTML = s.recent_results.map(r => `
        <tr>
          <td>${esc(r.name)}</td>
          <td>${esc(r.subject)}</td>
          <td><strong>${r.total}</strong></td>
          <td><span class="pin-${r.grade === 'F9' ? 'un' : ''}used">${r.grade}</span></td>
          <td style="font-size:0.78rem;color:#64748b">${esc(r.session)} · ${esc(r.term)}</td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-row">No results yet</td></tr>';
    }

    // Populate session dropdowns
    if (s.sessions.length > 0) {
      const sessionEls = document.querySelectorAll('#result-session-filter, #view-pin-session, #cv-session, #an-session');
      sessionEls.forEach(el => {
        el.innerHTML = '<option value="">-- All Sessions --</option>';
        s.sessions.forEach(ss => {
          const opt = document.createElement('option');
          opt.value = opt.textContent = ss;
          el.appendChild(opt);
        });
      });
    }

    // Class dropdowns are pre-populated from the CLASS_ARMS list by loadClassArms()

  } catch (e) { console.error('Stats error:', e); }
}

// ─── Settings ──────────────────────────────────────────────────────────────────

let cachedStats    = null;
let cachedSettings = {};
let cachedClasses  = [];
let cachedMe       = null;
let allSubjects    = [];
let editingAdminId = null;

async function loadMe() {
  try {
    const res  = await fetch('/api/admin/me');
    const data = await res.json();
    if (!data.success) return;
    cachedMe = data.admin;
    const nameEl = document.getElementById('admin-name');
    const roleEl = document.getElementById('admin-role');
    const initEl = document.getElementById('user-initial');
    if (nameEl) nameEl.textContent = cachedMe.full_name || cachedMe.username;
    if (roleEl) roleEl.textContent = cachedMe.role === 'staff' ? 'Staff' : cachedMe.role === 'superadmin' ? 'Super Admin' : 'Admin';
    if (initEl) initEl.textContent = (cachedMe.full_name || cachedMe.username).charAt(0).toUpperCase();
    applyRoleUI();
  } catch (_) {}
}

function applyRoleUI() {
  if (!cachedMe || cachedMe.role !== 'staff') return;
  ['upload','pins','tabulation','analysis','classview','settings'].forEach(sec => {
    const el = document.querySelector(`.nav-item[data-section="${sec}"]`);
    if (el) el.style.display = 'none';
  });
  document.querySelectorAll('.qa-btn').forEach(btn => {
    const onclick = btn.getAttribute('onclick') || '';
    if (onclick.includes('upload') || onclick.includes('pins')) btn.style.display = 'none';
  });
}

// ─── Class Arms ────────────────────────────────────────────────────────────────

async function loadClassArms() {
  try {
    const [classRes, subjRes] = await Promise.all([
      fetch('/api/admin/classes'),
      fetch('/api/admin/subjects')
    ]);
    const classData = await classRes.json();
    const subjData  = await subjRes.json();
    if (classData.success) { cachedClasses = classData.classes; populateAllClassDropdowns(); }
    if (subjData.all)      allSubjects = subjData.all;
    else if (subjData.subjects) allSubjects = subjData.subjects;
  } catch (_) {}
}

function populateAllClassDropdowns() {
  const selectors = [
    '#add-student-class',
    '#edit-student-class',
    '#student-class-filter',
    '#view-pin-class',
    '#cv-class',
    '#gen-class',
    '#tab-class',
    '#an-class',
  ];

  selectors.forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    const isFilter = sel.includes('filter') || sel === '#view-pin-class' || sel === '#cv-class' || sel === '#an-class';
    const defaultLabel = isFilter ? '-- All Classes --' : '-- Select Class --';
    el.innerHTML = `<option value="">${defaultLabel}</option>`;

    // Group by level
    const levels = [
      { label: 'Playgroup',    prefix: 'P.G' },
      { label: 'Kindergarten', prefix: 'K.G' },
      { label: 'Nursery',      prefix: 'Nursery' },
      { label: 'Primary',      prefix: 'Basic' },
    ];
    levels.forEach(({ label, prefix }) => {
      const cls = cachedClasses.filter(c => c.startsWith(prefix));
      if (!cls.length) return;
      const grp = document.createElement('optgroup');
      grp.label = label;
      cls.forEach(c => { const o = document.createElement('option'); o.value = o.textContent = c; grp.appendChild(o); });
      el.appendChild(grp);
    });
  });
}

async function loadSettings() {
  try {
    const res  = await fetch('/api/admin/settings');
    const data = await res.json();
    if (data.success) {
      cachedSettings = data.settings;
      // Update topbar badge
      const session = data.settings.current_session || '';
      const term    = data.settings.current_term    || '';
      document.getElementById('topbar-session').textContent = `${session} · ${term}`;
    }
  } catch (_) {}
}

async function loadSettingsForm() {
  try {
    const res  = await fetch('/api/admin/settings');
    const data = await res.json();
    if (!data.success) return;

    const form = document.getElementById('settings-form');
    Object.entries(data.settings).forEach(([key, val]) => {
      const el = form.querySelector(`[name="${key}"]`);
      if (el) {
        if (el.tagName === 'SELECT') {
          el.value = val;
        } else {
          el.value = val;
        }
      }
    });

    // Load admins
    loadAdminsList();
    // Load current admin's email
    loadMyEmail();
  } catch (_) {}
}

async function saveSettings() {
  const form = document.getElementById('settings-form');
  const data = {};
  new FormData(form).forEach((v, k) => { data[k] = v; });

  const msgEl = document.getElementById('settings-msg');

  try {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();

    msgEl.className = result.success ? 'msg-success' : 'msg-error';
    msgEl.textContent = result.message;
    msgEl.style.display = 'block';
    if (result.success) showToast('Settings saved successfully!', 'success');

    setTimeout(() => { msgEl.style.display = 'none'; }, 3000);
    await loadSettings();
  } catch (_) {
    msgEl.className = 'msg-error';
    msgEl.textContent = 'Error saving settings.';
    msgEl.style.display = 'block';
  }
}

// ─── Students ──────────────────────────────────────────────────────────────────

async function loadStudents() {
  const search = document.getElementById('student-search').value;
  const cls    = document.getElementById('student-class-filter').value;
  const tbody  = document.getElementById('students-body');

  tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Loading...</td></tr>';

  try {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (cls)    params.set('class', cls);

    const res  = await fetch('/api/admin/students?' + params);
    const data = await res.json();

    if (!data.students.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No students found</td></tr>';
      return;
    }

    tbody.innerHTML = data.students.map((s, i) => `
      <tr>
        <td style="color:#94a3b8">${i + 1}</td>
        <td><strong>${esc(s.name)}</strong></td>
        <td style="font-family:monospace;font-size:0.82rem">${esc(s.admission_number)}</td>
        <td><span class="pin-unused">${esc(s.class)}</span></td>
        <td>${esc(s.gender || '—')}</td>
        <td style="font-size:0.82rem">${s.date_of_birth ? fmtDate(s.date_of_birth) : '—'}</td>
        <td>
          <button class="btn-edit" onclick="editStudent(${s.id},'${esc(s.name)}','${esc(s.class)}','${esc(s.gender||'')}','${esc(s.date_of_birth||'')}')">Edit</button>
          <button class="btn-danger" onclick="deleteStudent(${s.id}, '${esc(s.name)}')">Delete</button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Error loading students</td></tr>';
  }
}

function openAddStudentModal() {
  document.getElementById('add-student-form').reset();
  document.getElementById('add-student-msg').style.display = 'none';
  document.getElementById('modal-add-student').classList.add('open');
}

async function submitAddStudent() {
  const form    = document.getElementById('add-student-form');
  const msgEl   = document.getElementById('add-student-msg');
  const formData = new FormData(form);
  const data    = {};
  formData.forEach((v, k) => { data[k] = v; });

  try {
    const res    = await fetch('/api/admin/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();

    msgEl.className = result.success ? 'msg-success' : 'msg-error';
    msgEl.textContent = result.message;
    msgEl.style.display = 'block';

    if (result.success) {
      showToast('Student added!', 'success');
      setTimeout(() => { closeModal('modal-add-student'); loadStudents(); loadStats(); }, 800);
    }
  } catch (_) {
    msgEl.className = 'msg-error';
    msgEl.textContent = 'Error adding student.';
    msgEl.style.display = 'block';
  }
}

function editStudent(id, name, cls, gender, dob) {
  document.getElementById('edit-student-id').value      = id;
  document.getElementById('edit-student-name').value    = name;
  document.getElementById('edit-student-gender').value  = gender || '';
  document.getElementById('edit-student-dob').value     = dob || '';
  document.getElementById('edit-student-msg').style.display = 'none';

  // Populate class select from cached arms then set current value
  populateAllClassDropdowns();
  document.getElementById('edit-student-class').value = cls;

  document.getElementById('modal-edit-student').classList.add('open');
}

async function submitEditStudent() {
  const id     = document.getElementById('edit-student-id').value;
  const name   = document.getElementById('edit-student-name').value.trim();
  const cls    = document.getElementById('edit-student-class').value;
  const gender = document.getElementById('edit-student-gender').value;
  const dob    = document.getElementById('edit-student-dob').value;
  const msgEl  = document.getElementById('edit-student-msg');

  if (!name) { msgEl.className='msg-error'; msgEl.textContent='Name is required.'; msgEl.style.display='block'; return; }
  if (!cls)  { msgEl.className='msg-error'; msgEl.textContent='Please select a class.'; msgEl.style.display='block'; return; }

  try {
    const res  = await fetch(`/api/admin/students/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, class: cls, gender, date_of_birth: dob || null })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Student updated!', 'success');
      closeModal('modal-edit-student');
      loadStudents();
    } else {
      msgEl.className = 'msg-error'; msgEl.textContent = data.message; msgEl.style.display = 'block';
    }
  } catch (_) {
    msgEl.className = 'msg-error'; msgEl.textContent = 'Error updating student.'; msgEl.style.display = 'block';
  }
}

async function deleteStudent(id, name) {
  if (!confirm(`Delete student "${name}" and all their results and PINs? This cannot be undone.`)) return;

  const res  = await fetch(`/api/admin/students/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.success) { showToast('Student deleted.', 'success'); loadStudents(); loadStats(); }
  else showToast(data.message, 'error');
}

// ─── Results ───────────────────────────────────────────────────────────────────

let resultStudentId    = null;
let resultStudentClass = null;

async function searchStudentResults() {
  const search  = document.getElementById('result-student-search').value.trim();
  const session = document.getElementById('result-session-filter').value;
  const term    = document.getElementById('result-term-filter').value;
  const panel   = document.getElementById('results-panel');

  if (!search && !session) {
    panel.innerHTML = '<div class="empty-placeholder"><p>Enter a student name or admission number to search</p></div>';
    return;
  }

  // Find student
  const params = new URLSearchParams();
  if (search) params.set('search', search);

  try {
    const res  = await fetch('/api/admin/students?' + params);
    const data = await res.json();

    if (!data.students.length) {
      panel.innerHTML = '<div class="empty-placeholder"><p>No student found matching that search</p></div>';
      return;
    }

    if (data.students.length > 1) {
      // Show selection list
      panel.innerHTML = `
        <div class="card-header" style="padding:1rem 1.25rem"><h3>Select Student</h3></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Name</th><th>Admission No</th><th>Class</th><th></th></tr></thead>
            <tbody>
              ${data.students.map(s => `
                <tr>
                  <td><strong>${esc(s.name)}</strong></td>
                  <td>${esc(s.admission_number)}</td>
                  <td>${esc(s.class)}</td>
                  <td><button class="btn-primary btn-sm" onclick="loadStudentResults(${s.id},'${esc(s.name)}','${session}','${term}','${esc(s.class)}')">View Results</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`;
      return;
    }

    const student = data.students[0];
    loadStudentResults(student.id, student.name, session, term, student.class);
  } catch (e) {
    panel.innerHTML = '<div class="empty-placeholder"><p>Error searching students</p></div>';
  }
}

const AFFECTIVE_TRAITS_ADMIN   = ['Alertness','Honesty','Neatness','Politeness','Punctuality','Relationship with Others','Reliability'];
const PSYCHOMOTOR_SKILLS_ADMIN = ['Construction','Drawing & Arts','Flexibility','Games & Sports','Handwriting','Musical Skills','Paintings'];

async function loadStudentResults(studentId, studentName, session, term, studentClass) {
  resultStudentId    = studentId;
  resultStudentClass = studentClass || null;
  const panel  = document.getElementById('results-panel');
  panel.innerHTML = '<div class="empty-placeholder"><p>Loading...</p></div>';

  try {
    const params = new URLSearchParams();
    if (session) params.set('session', session);
    if (term)    params.set('term', term);

    const [resData, ratingsData] = await Promise.all([
      fetch(`/api/admin/student-results/${studentId}?${params}`).then(r => r.json()),
      (session && term)
        ? fetch(`/api/admin/student-ratings/${studentId}?session=${encodeURIComponent(session)}&term=${encodeURIComponent(term)}`).then(r => r.json())
        : Promise.resolve({ affective: {}, psychomotor: {} })
    ]);

    const aff  = ratingsData.affective   || {};
    const psyc = ratingsData.psychomotor || {};

    function ratingSelect(type, trait, currentVal) {
      const id = `rating-${type}-${trait.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'')}`;
      return `<select id="${id}" class="rating-select" data-type="${type}" data-trait="${esc(trait)}">
        <option value="0"${!currentVal?'selected':''}>—</option>
        <option value="5"${currentVal==5?'selected':''}>5 – Excellent</option>
        <option value="4"${currentVal==4?'selected':''}>4 – Very Good</option>
        <option value="3"${currentVal==3?'selected':''}>3 – Good</option>
        <option value="2"${currentVal==2?'selected':''}>2 – Fair</option>
        <option value="1"${currentVal==1?'selected':''}>1 – Poor</option>
      </select>`;
    }

    panel.innerHTML = `
      <div class="card-header">
        <h3>Results for ${esc(studentName)}</h3>
        <button class="btn-primary btn-sm" onclick="openAddResultModalForStudent(${studentId},'${esc(studentName)}','${esc(resultStudentClass||'')}')">+ Add Result</button>
      </div>
      ${resData.results.length === 0
        ? `<div class="empty-placeholder"><p>No results found for this filter</p></div>`
        : `<div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Subject</th><th>Session</th><th>Term</th><th>CA1</th><th>CA2</th><th>Exam</th><th>Total</th><th>Grade</th><th>Actions</th></tr></thead>
              <tbody>
                ${resData.results.map(r => `
                  <tr>
                    <td><strong>${esc(r.subject)}</strong></td>
                    <td style="font-size:0.8rem">${esc(r.session)}</td>
                    <td style="font-size:0.8rem">${esc(r.term)}</td>
                    <td>${r.ca1}</td><td>${r.ca2}</td><td>${r.exam}</td>
                    <td><strong>${r.total}</strong></td>
                    <td><span class="pin-${r.grade==='F9'?'un':''}used">${r.grade}</span></td>
                    <td><button class="btn-danger" onclick="deleteResult(${r.id},${studentId},'${esc(studentName)}','${session}','${term}')">Del</button></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`
      }
      ${session && term ? `
      <!-- Ratings -->
      <div class="ratings-admin-wrap">
        <div class="ratings-admin-header">
          <span>Affective Traits &amp; Psychomotor Ratings</span>
          <button class="btn-primary btn-sm" onclick="saveRatings(${studentId},'${esc(session)}','${esc(term)}')">Save Ratings</button>
        </div>
        <div class="ratings-admin-grid">
          <div class="ratings-col">
            <div class="ratings-col-title">AFFECTIVE TRAITS</div>
            ${AFFECTIVE_TRAITS_ADMIN.map(trait => `
              <div class="rating-row">
                <span class="rating-label">${esc(trait)}</span>
                ${ratingSelect('affective', trait, aff[trait] || 0)}
              </div>`).join('')}
          </div>
          <div class="ratings-col">
            <div class="ratings-col-title">PSYCHOMOTOR</div>
            ${PSYCHOMOTOR_SKILLS_ADMIN.map(skill => `
              <div class="rating-row">
                <span class="rating-label">${esc(skill)}</span>
                ${ratingSelect('psychomotor', skill, psyc[skill] || 0)}
              </div>`).join('')}
          </div>
        </div>
        <div id="ratings-msg" style="display:none;padding:0.5rem 0.75rem;border-radius:6px;font-size:0.82rem;margin-top:0.5rem"></div>
      </div>` : ''}`;
  } catch (e) {
    panel.innerHTML = '<div class="empty-placeholder"><p>Error loading results</p></div>';
  }
}

async function saveRatings(studentId, session, term) {
  const affective   = {};
  const psychomotor = {};
  document.querySelectorAll('.rating-select').forEach(sel => {
    const type  = sel.dataset.type;
    const trait = sel.dataset.trait;
    if (type === 'affective')   affective[trait]   = parseInt(sel.value) || 0;
    if (type === 'psychomotor') psychomotor[trait] = parseInt(sel.value) || 0;
  });

  const msgEl = document.getElementById('ratings-msg');
  try {
    const res  = await fetch(`/api/admin/student-ratings/${studentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, term, affective, psychomotor })
    });
    const data = await res.json();
    msgEl.className     = data.success ? 'msg-success' : 'msg-error';
    msgEl.textContent   = data.message;
    msgEl.style.display = 'block';
    if (data.success) showToast('Ratings saved!', 'success');
  } catch (_) {
    msgEl.className = 'msg-error'; msgEl.textContent = 'Error saving ratings.'; msgEl.style.display = 'block';
  }
}

function openAddResultModal() {
  document.getElementById('result-student-id').value = '';
  document.getElementById('result-student-input').value = '';
  document.getElementById('add-result-msg').style.display = 'none';
  document.getElementById('score-preview').style.display = 'none';
  document.getElementById('result-subject').innerHTML = '<option value="">-- Select a student first --</option>';
  const hint = document.getElementById('result-subject-hint');
  if (hint) hint.textContent = '';

  // Pre-fill session/term from settings
  document.getElementById('result-session').value = cachedSettings.current_session || '';
  document.getElementById('result-term').value    = cachedSettings.current_term    || 'First Term';

  document.getElementById('modal-add-result').classList.add('open');
}

async function openAddResultModalForStudent(id, name, cls) {
  openAddResultModal();
  document.getElementById('result-student-id').value    = id;
  document.getElementById('result-student-input').value = name;
  await loadSubjectsForClass(cls || resultStudentClass || '');
}

let studentSearchTimeout;

function searchStudentForResult(query) {
  clearTimeout(studentSearchTimeout);
  const dropdown = document.getElementById('student-search-dropdown');

  if (!query || query.length < 2) { dropdown.style.display = 'none'; return; }

  studentSearchTimeout = setTimeout(async () => {
    try {
      const res  = await fetch('/api/admin/students?search=' + encodeURIComponent(query));
      const data = await res.json();

      if (data.students.length === 0) { dropdown.style.display = 'none'; return; }

      dropdown.style.display = 'block';
      dropdown.innerHTML = data.students.slice(0, 8).map(s => `
        <div class="search-dropdown-item" onclick="selectStudentForResult(${s.id}, '${esc(s.name)} — ${esc(s.admission_number)} (${esc(s.class)})', '${esc(s.class)}')">
          <strong>${esc(s.name)}</strong>
          <span style="color:#94a3b8;font-size:0.78rem;margin-left:0.5rem">${esc(s.admission_number)} · ${esc(s.class)}</span>
        </div>
      `).join('');
    } catch (_) {}
  }, 300);
}

async function selectStudentForResult(id, label, studentClass) {
  document.getElementById('result-student-id').value    = id;
  document.getElementById('result-student-input').value = label;
  document.getElementById('student-search-dropdown').style.display = 'none';
  await loadSubjectsForClass(studentClass);
}

async function loadSubjectsForClass(cls) {
  const select = document.getElementById('result-subject');
  const hint   = document.getElementById('result-subject-hint');

  try {
    const res  = await fetch('/api/admin/subjects?class=' + encodeURIComponent(cls || ''));
    const data = await res.json();
    if (data.all && !allSubjects.length) allSubjects = data.all;
    let subjects = data.subjects || [];

    if (cachedMe && cachedMe.role === 'staff' && cachedMe.assignedSubjects && cachedMe.assignedSubjects.length) {
      subjects = subjects.filter(s => cachedMe.assignedSubjects.includes(s));
    }

    select.innerHTML = '<option value="">-- Select Subject --</option>';
    subjects.forEach(s => {
      const o = document.createElement('option');
      o.value = o.textContent = s;
      select.appendChild(o);
    });

    if (hint) hint.textContent = cls ? (cls.startsWith('NRS') ? '(Nursery)' : '(Primary)') : '';
  } catch (_) {
    select.innerHTML = '<option value="">-- Could not load subjects --</option>';
  }
}

function setupScorePreview() {
  const inputs = ['result-ca1', 'result-ca2', 'result-exam'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateScorePreview);
  });
}

function updateScorePreview() {
  const ca1  = Math.min(parseFloat(document.getElementById('result-ca1').value)  || 0, 20);
  const ca2  = Math.min(parseFloat(document.getElementById('result-ca2').value)  || 0, 20);
  const exam = Math.min(parseFloat(document.getElementById('result-exam').value) || 0, 60);
  const total = ca1 + ca2 + exam;
  const { grade, remark } = calcGrade(total);

  const preview = document.getElementById('score-preview');
  preview.style.display = 'block';
  preview.innerHTML = `
    <strong>Total: ${total}/100</strong> &nbsp;|&nbsp;
    Grade: <strong style="color:${grade==='F9'?'#dc2626':'#006400'}">${grade}</strong> &nbsp;|&nbsp;
    ${remark}
  `;
}

function calcGrade(total) {
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

async function submitAddResult() {
  const studentId = document.getElementById('result-student-id').value;
  const session   = document.getElementById('result-session').value.trim();
  const term      = document.getElementById('result-term').value;
  const subject   = document.getElementById('result-subject').value;
  const ca1       = document.getElementById('result-ca1').value;
  const ca2       = document.getElementById('result-ca2').value;
  const exam      = document.getElementById('result-exam').value;
  const msgEl     = document.getElementById('add-result-msg');

  if (!studentId) { msgEl.className='msg-error'; msgEl.textContent='Please select a student.'; msgEl.style.display='block'; return; }
  if (!subject)   { msgEl.className='msg-error'; msgEl.textContent='Please select a subject.'; msgEl.style.display='block'; return; }
  if (!session)   { msgEl.className='msg-error'; msgEl.textContent='Please enter a session.'; msgEl.style.display='block'; return; }

  try {
    const res = await fetch('/api/admin/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: studentId, subject, ca1, ca2, exam, session, term })
    });
    const data = await res.json();
    msgEl.className = data.success ? 'msg-success' : 'msg-error';
    msgEl.textContent = data.message;
    msgEl.style.display = 'block';

    if (data.success) {
      showToast('Result saved!', 'success');
      setTimeout(() => { closeModal('modal-add-result'); loadStats(); }, 800);
    }
  } catch (_) {
    msgEl.className = 'msg-error'; msgEl.textContent = 'Error saving result.'; msgEl.style.display = 'block';
  }
}

async function deleteResult(id, studentId, studentName, session, term) {
  if (!confirm('Delete this result record?')) return;
  const res  = await fetch('/api/admin/results/' + id, { method: 'DELETE' });
  const data = await res.json();
  if (data.success) { showToast('Result deleted.', 'success'); loadStudentResults(studentId, studentName, session, term); loadStats(); }
  else showToast(data.message, 'error');
}

// ─── Bulk Upload ───────────────────────────────────────────────────────────────

function setupUploadZone() {
  const zone  = document.getElementById('upload-zone');
  const input = document.getElementById('upload-file-input');
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) { input.files = e.dataTransfer.files; handleFileSelected(file); }
  });

  input.addEventListener('change', () => {
    if (input.files[0]) handleFileSelected(input.files[0]);
  });
}

function handleFileSelected(file) {
  document.getElementById('selected-file-name').textContent = `📄 ${file.name} (${(file.size/1024).toFixed(1)} KB)`;
  document.getElementById('upload-btn').disabled = false;
}

async function doUpload() {
  const input  = document.getElementById('upload-file-input');
  const result = document.getElementById('upload-result');
  const btn    = document.getElementById('upload-btn');

  if (!input.files[0]) return;

  const formData = new FormData();
  formData.append('file', input.files[0]);

  btn.disabled = true;
  btn.textContent = 'Uploading...';
  document.getElementById('upload-progress').style.display = 'block';

  // Simulate progress
  let progress = 0;
  const interval = setInterval(() => {
    progress = Math.min(progress + 10, 90);
    document.getElementById('progress-fill').style.width = progress + '%';
  }, 200);

  try {
    const res  = await fetch('/api/admin/upload-results', { method: 'POST', body: formData });
    const data = await res.json();

    clearInterval(interval);
    document.getElementById('progress-fill').style.width = '100%';

    result.style.display = 'block';

    if (data.success) {
      result.innerHTML = `
        <div class="msg-success" style="padding:0.85rem;border-radius:8px">
          <strong>✓ ${data.message}</strong>
          ${data.errors.length > 0 ? `<br><br><strong>Skipped rows:</strong><ul style="margin-top:0.5rem;padding-left:1.5rem;font-size:0.82rem">${data.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
        </div>`;
      showToast('Upload successful!', 'success');
      await loadStats();
    } else {
      result.innerHTML = `<div class="msg-error" style="padding:0.85rem;border-radius:8px"><strong>✗ ${esc(data.message)}</strong></div>`;
    }
  } catch (e) {
    clearInterval(interval);
    result.style.display = 'block';
    result.innerHTML = `<div class="msg-error" style="padding:0.85rem;border-radius:8px"><strong>✗ Upload failed. Please try again.</strong></div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><polyline points="16 16 12 12 8 16" stroke="currentColor" stroke-width="2"/><line x1="12" y1="12" x2="12" y2="21" stroke="currentColor" stroke-width="2"/></svg> Upload & Process`;
    setTimeout(() => { document.getElementById('upload-progress').style.display = 'none'; }, 1500);
  }
}

function downloadTemplate() {
  // Generate a sample XLSX-compatible CSV
  const headers = ['Student Name', 'Admission No', 'Class', 'Session', 'Term', 'Subject', 'CA1', 'CA2', 'Exam'];
  const rows = [
    ['John Adeyemi', 'SS/2024/001', 'SS2A', '2024/2025', 'First Term', 'Mathematics', 18, 17, 55],
    ['John Adeyemi', 'SS/2024/001', 'SS2A', '2024/2025', 'First Term', 'English Language', 16, 18, 50],
    ['Mary Okafor',  'SS/2024/002', 'SS2A', '2024/2025', 'First Term', 'Mathematics', 19, 20, 58],
  ];

  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'result_upload_template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ─── PINs ──────────────────────────────────────────────────────────────────────

function populatePinClassDropdown() {
  // Already populated by loadStats — just prefill session
  const genSession = document.getElementById('gen-session');
  if (genSession && !genSession.value) genSession.value = cachedSettings.current_session || '';
  const genTerm = document.getElementById('gen-term');
  if (genTerm && !genTerm.value) genTerm.value = cachedSettings.current_term || 'First Term';
}

async function generatePins() {
  const session = document.getElementById('gen-session').value.trim();
  const term    = document.getElementById('gen-term').value;
  const cls     = document.getElementById('gen-class').value;

  if (!session || !term || !cls) { showToast('Please fill in session, term, and class.', 'error'); return; }

  try {
    const res  = await fetch('/api/admin/generate-pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, term, class: cls })
    });
    const data = await res.json();

    if (data.success) {
      showToast(`Generated ${data.count} PINs for ${cls}!`, 'success');
      loadPins();
      loadStats();
    } else {
      showToast(data.message, 'error');
    }
  } catch (e) {
    showToast('Error generating PINs.', 'error');
  }
}

async function loadPins() {
  const session = document.getElementById('view-pin-session').value;
  const term    = document.getElementById('view-pin-term').value;
  const cls     = document.getElementById('view-pin-class').value;
  const tbody   = document.getElementById('pins-body');

  tbody.innerHTML = '<tr><td colspan="9" class="empty-row">Loading...</td></tr>';

  try {
    const params = new URLSearchParams();
    if (session) params.set('session', session);
    if (term)    params.set('term', term);
    if (cls)     params.set('class', cls);

    const res  = await fetch('/api/admin/pins?' + params);
    const data = await res.json();

    if (!data.pins.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-row">No PINs found for the selected filters</td></tr>';
      return;
    }

    tbody.innerHTML = data.pins.map((p, i) => `
      <tr>
        <td style="color:#94a3b8">${i + 1}</td>
        <td><strong>${esc(p.name)}</strong></td>
        <td style="font-size:0.82rem">${esc(p.admission_number)}</td>
        <td>${esc(p.class)}</td>
        <td><span class="pin-code">${esc(p.pin)}</span></td>
        <td style="font-size:0.8rem">${esc(p.session)}</td>
        <td style="font-size:0.8rem">${esc(p.term)}</td>
        <td>${p.is_used ? '<span class="pin-used">Used</span>' : '<span class="pin-unused">Unused</span>'}</td>
        <td><button class="btn-danger" onclick="deletePin(${p.id})">Del</button></td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-row">Error loading PINs</td></tr>';
  }
}

async function deletePin(id) {
  if (!confirm('Delete this PIN?')) return;
  const res  = await fetch('/api/admin/pins/' + id, { method: 'DELETE' });
  const data = await res.json();
  if (data.success) { showToast('PIN deleted.', 'success'); loadPins(); loadStats(); }
  else showToast(data.message, 'error');
}

function printPins() { window.print(); }

function exportPinsCsv() {
  const rows = document.querySelectorAll('#pins-table tbody tr');
  if (!rows.length) return;
  const headers = ['#','Name','Admission No','Class','PIN','Session','Term','Status'];
  const data = Array.from(rows).map(row => {
    const cells = row.querySelectorAll('td');
    return Array.from(cells).slice(0, 8).map(c => `"${c.textContent.trim()}"`);
  });
  const csv  = [headers.map(h => `"${h}"`).join(','), ...data.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'pins_export.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Class Results Viewer ──────────────────────────────────────────────────────

function populateClassViewDropdowns() {
  const cvSession = document.getElementById('cv-session');
  if (cvSession && !cvSession.value && cachedSettings.current_session) {
    // Try to select current session
    Array.from(cvSession.options).forEach(opt => {
      if (opt.value === cachedSettings.current_session) opt.selected = true;
    });
  }
}

async function loadClassResults() {
  const cls     = document.getElementById('cv-class').value;
  const session = document.getElementById('cv-session').value;
  const term    = document.getElementById('cv-term').value;
  const panel   = document.getElementById('class-results-panel');

  if (!cls || !session || !term) {
    panel.innerHTML = '<div class="empty-placeholder"><p>Please select class, session, and term.</p></div>';
    return;
  }

  panel.innerHTML = '<div class="empty-placeholder"><p>Loading class results...</p></div>';

  try {
    const params = new URLSearchParams({ class: cls, session, term });
    const res  = await fetch('/api/admin/class-results?' + params);
    const data = await res.json();

    if (!data.students || !data.students.length) {
      panel.innerHTML = '<div class="empty-placeholder"><p>No results found for this class</p></div>';
      document.getElementById('print-class-btn').style.display = 'none';
      return;
    }

    document.getElementById('print-class-btn').style.display = 'inline-flex';

    // Get all unique subjects
    const subjects = [...new Set(data.students.flatMap(s => s.results.map(r => r.subject)))].sort();

    panel.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>${esc(cls)} — ${esc(term)}, ${esc(session)}</h3>
          <span style="color:#64748b;font-size:0.82rem">${data.students.length} student(s)</span>
        </div>
        <div class="table-wrap" id="class-result-table-wrap">
          <table class="class-result-table">
            <thead>
              <tr>
                <th>Pos</th>
                <th style="min-width:160px">Name</th>
                <th>Adm. No</th>
                ${subjects.map(s => `<th title="${esc(s)}">${esc(s.split(' ').map(w=>w[0]).join(''))}.</th>`).join('')}
                <th>Total</th>
                <th>Avg</th>
              </tr>
            </thead>
            <tbody>
              ${data.students.map((st, i) => {
                const resultMap = {};
                st.results.forEach(r => { resultMap[r.subject] = r; });
                const rowClass = i === 0 ? 'position-1' : i === 1 ? 'position-2' : i === 2 ? 'position-3' : '';
                return `
                  <tr class="${rowClass}">
                    <td>${st.position}</td>
                    <td><strong>${esc(st.name)}</strong></td>
                    <td style="font-size:0.75rem">${esc(st.admission_number)}</td>
                    ${subjects.map(subj => {
                      const r = resultMap[subj];
                      if (!r) return '<td style="color:#94a3b8">—</td>';
                      return `<td class="${r.grade==='F9'?'grade-fail':r.grade==='A1'?'grade-excellent':''}" title="${r.total} — ${r.grade}">${r.total}</td>`;
                    }).join('')}
                    <td><strong>${st.grand_total.toFixed(0)}</strong></td>
                    <td>${st.average}%</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div style="padding:0.75rem 1.25rem;font-size:0.75rem;color:#64748b;border-top:1px solid #e2e8f0">
          Subject headers show initials. Hover over them to see full names. 🥇=1st, 🥈=2nd, 🥉=3rd positions highlighted.
        </div>
      </div>`;
  } catch (e) {
    panel.innerHTML = '<div class="empty-placeholder"><p>Error loading class results</p></div>';
  }
}

function printClassResults() {
  const area = document.getElementById('class-result-table-wrap');
  if (!area) return;
  const w = window.open('', '_blank');
  w.document.write(`
    <html><head><title>Class Results</title>
    <style>
      body{font-family:Arial,sans-serif;font-size:11px}
      table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #aaa;padding:4px 6px;text-align:center}
      th{background:#006400;color:white}
      tr:nth-child(even){background:#f5fff5}
      .position-1{background:#fef9c3}
    </style></head><body>
    ${area.innerHTML}
    </body></html>`);
  w.document.close();
  w.print();
}

// ─── Admin Users ───────────────────────────────────────────────────────────────

async function loadAdminsList() {
  const el = document.getElementById('admins-list');
  if (!el) return;
  try {
    const res  = await fetch('/api/admin/admins');
    const data = await res.json();
    if (!data.success) { el.innerHTML = '<p style="font-size:0.83rem;color:#64748b">Only super admins can view this.</p>'; return; }
    el.innerHTML = data.admins.map(a => `
      <div style="padding:0.55rem 0;border-bottom:1px solid #f0f0f0">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <strong style="font-size:0.85rem">${esc(a.full_name || a.username)}</strong>
            <span style="color:#94a3b8;font-size:0.75rem;margin-left:0.5rem">@${esc(a.username)}</span>
            <span class="staff-role-badge staff-role-${a.role}">${esc(a.role)}</span>
          </div>
          <div style="display:flex;gap:0.4rem">
            ${a.role === 'staff' ? `<button class="btn-secondary btn-sm" onclick="openEditAssignmentsModal(${a.id},'${esc(a.full_name || a.username)}')">Assignments</button>` : ''}
            <button class="btn-danger btn-sm" onclick="deleteAdmin(${a.id})">Del</button>
          </div>
        </div>
        ${a.role === 'staff' ? `<div style="margin-top:0.3rem;font-size:0.72rem;color:#64748b">
          ${(a.assignedSubjects||[]).map(s => `<span class="staff-subj-tag">${esc(s)}</span>`).join('')}
          ${(a.assignedClasses||[]).map(c => `<span class="staff-cls-tag">${esc(c)}</span>`).join('')}
          ${!(a.assignedSubjects||[]).length && !(a.assignedClasses||[]).length ? '<span style="color:#ef4444">No assignments yet</span>' : ''}
        </div>` : ''}
      </div>
    `).join('');
  } catch (_) { el.innerHTML = '<p style="font-size:0.83rem;color:#64748b">Could not load admins.</p>'; }
}

function openAddAdminModal() {
  document.getElementById('new-admin-name').value     = '';
  document.getElementById('new-admin-email').value    = '';
  document.getElementById('new-admin-username').value = '';
  document.getElementById('new-admin-password').value = '';
  document.getElementById('new-admin-role').value     = 'admin';
  document.getElementById('add-admin-msg').style.display = 'none';
  toggleStaffSubjects('admin');
  document.getElementById('modal-add-admin').classList.add('open');
}

function toggleStaffSubjects(role) {
  const wrap = document.getElementById('staff-subject-assign');
  if (!wrap) return;
  if (role === 'staff') {
    wrap.style.display = 'block';
    populateSubjectCheckboxes('staff-subject-checkboxes', []);
    populateClassCheckboxes('staff-class-checkboxes', []);
  } else {
    wrap.style.display = 'none';
  }
}

function populateClassCheckboxes(containerId, selectedClasses) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const levels = [
    { label: 'Playgroup',    prefix: 'P.G' },
    { label: 'Kindergarten', prefix: 'K.G' },
    { label: 'Nursery',      prefix: 'Nursery' },
    { label: 'Primary',      prefix: 'Basic' },
  ];
  container.innerHTML = levels.map(({ label, prefix }) => {
    const cls = cachedClasses.filter(c => c.startsWith(prefix));
    if (!cls.length) return '';
    return `<div class="staff-class-group">
      <span class="staff-class-group-label">${esc(label)}</span>
      <div class="staff-class-group-items">${cls.map(c => `<label class="staff-subject-check"><input type="checkbox" value="${esc(c)}" ${selectedClasses.includes(c) ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}</div>
    </div>`;
  }).join('');
}

function getCheckedClasses(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  return [...container.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
}

function populateSubjectCheckboxes(containerId, selectedSubjects) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const list = allSubjects.length ? allSubjects : [];
  container.innerHTML = list.map(s => `
    <label class="staff-subject-check">
      <input type="checkbox" value="${esc(s)}" ${selectedSubjects.includes(s) ? 'checked' : ''}>
      <span>${esc(s)}</span>
    </label>
  `).join('');
}

function getCheckedSubjects(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  return [...container.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
}

async function openEditAssignmentsModal(adminId, adminName) {
  editingAdminId = adminId;
  document.getElementById('edit-assign-name').textContent = `Staff: ${adminName}`;
  document.getElementById('edit-assign-msg').style.display = 'none';
  try {
    const [subjRes, clsRes] = await Promise.all([
      fetch(`/api/admin/staff-assignments/${adminId}`),
      fetch(`/api/admin/class-assignments/${adminId}`)
    ]);
    const subjData = await subjRes.json();
    const clsData  = await clsRes.json();
    populateSubjectCheckboxes('edit-subject-checkboxes', subjData.subjects || []);
    populateClassCheckboxes('edit-class-checkboxes', clsData.classes || []);
  } catch (_) {
    populateSubjectCheckboxes('edit-subject-checkboxes', []);
    populateClassCheckboxes('edit-class-checkboxes', []);
  }
  document.getElementById('modal-edit-assignments').classList.add('open');
}

async function saveStaffAssignments() {
  if (!editingAdminId) return;
  const subjects = getCheckedSubjects('edit-subject-checkboxes');
  const classes  = getCheckedClasses('edit-class-checkboxes');
  const msgEl    = document.getElementById('edit-assign-msg');
  try {
    const [subjRes, clsRes] = await Promise.all([
      fetch(`/api/admin/staff-assignments/${editingAdminId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjects })
      }),
      fetch(`/api/admin/class-assignments/${editingAdminId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classes })
      })
    ]);
    const subjData = await subjRes.json();
    const clsData  = await clsRes.json();
    const ok = subjData.success && clsData.success;
    msgEl.className   = ok ? 'msg-success' : 'msg-error';
    msgEl.textContent = ok ? 'Assignments saved.' : (subjData.message || clsData.message);
    msgEl.style.display = 'block';
    if (ok) {
      showToast('Assignments saved!', 'success');
      setTimeout(() => { closeModal('modal-edit-assignments'); loadAdminsList(); editingAdminId = null; }, 700);
    }
  } catch (_) {
    msgEl.className = 'msg-error'; msgEl.textContent = 'Error saving assignments.'; msgEl.style.display = 'block';
  }
}

async function submitAddAdmin() {
  const name     = document.getElementById('new-admin-name').value.trim();
  const email    = document.getElementById('new-admin-email').value.trim();
  const username = document.getElementById('new-admin-username').value.trim();
  const password = document.getElementById('new-admin-password').value;
  const role     = document.getElementById('new-admin-role').value;
  const msgEl    = document.getElementById('add-admin-msg');

  if (!username || !password) { msgEl.className='msg-error'; msgEl.textContent='Username and password required.'; msgEl.style.display='block'; return; }
  if (password.length < 6)    { msgEl.className='msg-error'; msgEl.textContent='Password must be at least 6 characters.'; msgEl.style.display='block'; return; }

  try {
    const res  = await fetch('/api/admin/admins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, full_name: name, role, email: email || undefined })
    });
    const data = await res.json();
    if (data.success && role === 'staff') {
      const subjects = getCheckedSubjects('staff-subject-checkboxes');
      const classes  = getCheckedClasses('staff-class-checkboxes');
      const staffRes = await fetch('/api/admin/admins');
      const staffData = await staffRes.json();
      if (staffData.success) {
        const newStaff = staffData.admins.find(a => a.username === username.toLowerCase());
        if (newStaff) {
          await Promise.all([
            fetch(`/api/admin/staff-assignments/${newStaff.id}`, {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ subjects })
            }),
            fetch(`/api/admin/class-assignments/${newStaff.id}`, {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ classes })
            })
          ]);
        }
      }
      showToast('Staff account created with assignments!', 'success');
      setTimeout(() => { closeModal('modal-add-admin'); loadAdminsList(); }, 800);
    } else {
      msgEl.className  = data.success ? 'msg-success' : 'msg-error';
      msgEl.textContent = data.message;
      msgEl.style.display = 'block';
      if (data.success) {
        showToast('Admin user created!', 'success');
        setTimeout(() => { closeModal('modal-add-admin'); loadAdminsList(); }, 800);
      }
    }
  } catch (_) {
    msgEl.className = 'msg-error'; msgEl.textContent = 'Error creating account.'; msgEl.style.display = 'block';
  }
}

async function deleteAdmin(id) {
  if (!confirm('Delete this admin/staff user?')) return;
  const res  = await fetch('/api/admin/admins/' + id, { method: 'DELETE' });
  const data = await res.json();
  if (data.success) { showToast('User deleted.', 'success'); loadAdminsList(); }
  else showToast(data.message, 'error');
}

// ─── Password Change ───────────────────────────────────────────────────────────

async function changePassword() {
  const curr    = document.getElementById('curr-pwd').value;
  const newPwd  = document.getElementById('new-pwd').value;
  const confirm = document.getElementById('confirm-pwd').value;
  const msgEl   = document.getElementById('pwd-msg');

  if (!curr || !newPwd || !confirm) { msgEl.className='msg-error'; msgEl.textContent='All fields are required.'; msgEl.style.display='block'; return; }
  if (newPwd !== confirm)           { msgEl.className='msg-error'; msgEl.textContent='New passwords do not match.'; msgEl.style.display='block'; return; }
  if (newPwd.length < 6)            { msgEl.className='msg-error'; msgEl.textContent='Password must be at least 6 characters.'; msgEl.style.display='block'; return; }

  try {
    const res  = await fetch('/api/auth/change-password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: curr, new_password: newPwd })
    });
    const data = await res.json();
    msgEl.className  = data.success ? 'msg-success' : 'msg-error';
    msgEl.textContent = data.message;
    msgEl.style.display = 'block';
    if (data.success) {
      document.getElementById('pwd-form').reset();
      showToast('Password updated!', 'success');
    }
  } catch (_) {
    msgEl.className = 'msg-error'; msgEl.textContent = 'Error updating password.'; msgEl.style.display = 'block';
  }
}

// ─── Recovery Email ────────────────────────────────────────────────────────────

async function loadMyEmail() {
  try {
    const res  = await fetch('/api/auth/check');
    const data = await res.json();
    if (data.authenticated && data.admin && data.admin.email) {
      document.getElementById('my-email').value = data.admin.email;
    }
  } catch (_) {}
}

async function updateEmail() {
  const email = document.getElementById('my-email').value.trim();
  const msgEl = document.getElementById('email-msg');
  if (!email) { msgEl.className='msg-error'; msgEl.textContent='Email address is required.'; msgEl.style.display='block'; return; }
  try {
    const res  = await fetch('/api/auth/update-email', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    msgEl.className  = data.success ? 'msg-success' : 'msg-error';
    msgEl.textContent = data.message;
    msgEl.style.display = 'block';
    if (data.success) showToast('Recovery email saved!', 'success');
  } catch (_) {
    msgEl.className = 'msg-error'; msgEl.textContent = 'Error saving email.'; msgEl.style.display = 'block';
  }
}

// ─── Payment Slips ─────────────────────────────────────────────────────────────

let currentSlipId = null;

async function loadPaymentSlips() {
  const status  = document.getElementById('slip-filter-status')?.value  || 'all';
  const session = document.getElementById('slip-filter-session')?.value || '';
  const term    = document.getElementById('slip-filter-term')?.value    || '';
  const cls     = document.getElementById('slip-filter-class')?.value   || '';

  const params = new URLSearchParams();
  if (status  && status !== 'all') params.set('status',  status);
  if (session) params.set('session', session);
  if (term)    params.set('term',    term);
  if (cls)     params.set('class',   cls);

  const tbody = document.getElementById('slips-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:2rem">Loading…</td></tr>';

  try {
    const res  = await fetch('/api/slips?' + params.toString());
    const data = await res.json();

    if (!data.success) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#ef4444;padding:2rem">Failed to load slips.</td></tr>'; return; }

    renderSlipsStats(data.slips);

    if (!data.slips.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:2.5rem">No payment slips found.</td></tr>';
      return;
    }

    tbody.innerHTML = data.slips.map((s, i) => `
      <tr>
        <td>${i + 1}</td>
        <td style="font-weight:600">${escHtml(s.student_name)}</td>
        <td><code style="font-size:0.8rem">${escHtml(s.admission_number)}</code></td>
        <td>${escHtml(s.class)}</td>
        <td style="font-size:0.82rem">${escHtml(s.session)}<br><span style="color:#6b7280">${escHtml(s.term)}</span></td>
        <td style="font-size:0.8rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(s.original_name)}">${escHtml(s.original_name)}</td>
        <td>${slipStatusBadge(s.status)}</td>
        <td style="font-size:0.78rem;color:#6b7280">${new Date(s.uploaded_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</td>
        <td>
          <div style="display:flex;gap:0.4rem">
            <button class="btn-sm btn-primary" onclick="openSlipModal(${s.id},'${escHtml(s.student_name)}','${s.status}','${escHtml(s.notes||'')}')">View</button>
            <button class="btn-sm btn-danger" onclick="deleteSlip(${s.id})">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (_) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#ef4444;padding:2rem">Error loading slips.</td></tr>';
  }
}

function renderSlipsStats(slips) {
  const stats = document.getElementById('slips-stats');
  if (!stats) return;
  const total    = slips.length;
  const pending  = slips.filter(s => s.status === 'pending').length;
  const verified = slips.filter(s => s.status === 'verified').length;
  stats.innerHTML = `
    <div class="stat-card"><div class="stat-number">${total}</div><div class="stat-label">Total Slips</div></div>
    <div class="stat-card" style="border-left:3px solid #f59e0b"><div class="stat-number" style="color:#f59e0b">${pending}</div><div class="stat-label">Pending Review</div></div>
    <div class="stat-card" style="border-left:3px solid #22c55e"><div class="stat-number" style="color:#22c55e">${verified}</div><div class="stat-label">Verified</div></div>
  `;
}

function slipStatusBadge(status) {
  const map = {
    pending:  { bg:'#fef3c7', color:'#92400e', label:'Pending'  },
    reviewed: { bg:'#dbeafe', color:'#1e40af', label:'Reviewed' },
    verified: { bg:'#dcfce7', color:'#166534', label:'Verified' },
  };
  const s = map[status] || map.pending;
  return `<span style="background:${s.bg};color:${s.color};padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600">${s.label}</span>`;
}

function openSlipModal(id, name, status, notes) {
  currentSlipId = id;
  document.getElementById('slip-modal-title').textContent    = 'Payment Slip — ' + name;
  document.getElementById('slip-status-select').value       = status;
  document.getElementById('slip-notes-input').value         = notes;
  document.getElementById('slip-iframe').src                = `/api/slips/${id}/view`;
  document.getElementById('slip-modal-msg').style.display   = 'none';
  document.getElementById('modal-slip-view').classList.add('open');
}

async function saveSlipStatus() {
  if (!currentSlipId) return;
  const status = document.getElementById('slip-status-select').value;
  const notes  = document.getElementById('slip-notes-input').value;
  const msg    = document.getElementById('slip-modal-msg');
  try {
    const res  = await fetch(`/api/slips/${currentSlipId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, notes })
    });
    const data = await res.json();
    msg.style.cssText = `display:block;background:${data.success?'#dcfce7':'#fee2e2'};color:${data.success?'#166534':'#991b1b'};border-radius:6px;padding:0.5rem 0.75rem;font-size:0.83rem`;
    msg.textContent = data.message;
    if (data.success) { showToast('Status updated!', 'success'); loadPaymentSlips(); updateSlipBadge(); }
  } catch (_) {
    msg.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.83rem';
    msg.textContent = 'Error saving status.';
  }
}

async function deleteSlip(id) {
  if (!confirm('Delete this payment slip? This cannot be undone.')) return;
  try {
    const res  = await fetch(`/api/slips/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) { showToast('Slip deleted.', 'success'); loadPaymentSlips(); updateSlipBadge(); }
    else showToast(data.message, 'error');
  } catch (_) { showToast('Error deleting slip.', 'error'); }
}

async function updateSlipBadge() {
  try {
    const res  = await fetch('/api/slips/count/pending');
    const data = await res.json();
    const badge = document.getElementById('slip-badge');
    if (!badge) return;
    if (data.count > 0) { badge.textContent = data.count; badge.style.display = 'inline'; }
    else badge.style.display = 'none';
  } catch (_) {}
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Tabulation Sheet ──────────────────────────────────────────────────────────

let cachedTabulationData = null;

function populateTabulationDropdowns() {
  const tabSession = document.getElementById('tab-session');
  if (tabSession && tabSession.options.length <= 1 && cachedStats) {
    (cachedStats.sessions || []).forEach(s => {
      const o = document.createElement('option'); o.value = s; o.textContent = s;
      tabSession.appendChild(o);
    });
  }
  if (tabSession && cachedSettings.current_session) tabSession.value = cachedSettings.current_session;
  const tabTerm = document.getElementById('tab-term');
  if (tabTerm && cachedSettings.current_term) tabTerm.value = cachedSettings.current_term;
}

async function loadTabulation() {
  const cls     = document.getElementById('tab-class').value;
  const session = document.getElementById('tab-session').value;
  const term    = document.getElementById('tab-term').value;
  const panel   = document.getElementById('tabulation-panel');

  if (!cls || !session || !term) { showToast('Select class, session, and term first.', 'error'); return; }

  panel.innerHTML = '<div class="empty-placeholder"><p>Loading tabulation...</p></div>';
  document.getElementById('tab-export-btn').style.display = 'none';
  document.getElementById('tab-print-btn').style.display  = 'none';
  document.getElementById('tab-action-btns').style.display = 'none';

  try {
    const params = new URLSearchParams({ class: cls, session, term });
    const res  = await fetch('/api/admin/class-results?' + params);
    const data = await res.json();

    if (!data.success || !data.students || data.students.length === 0) {
      panel.innerHTML = '<div class="empty-placeholder"><p>No results found for this selection.</p></div>';
      return;
    }

    cachedTabulationData = { students: data.students, cls, session, term };
    renderTabulation(data.students, cls, session, term);

    document.getElementById('tab-export-btn').style.display = '';
    document.getElementById('tab-print-btn').style.display  = '';
    document.getElementById('tab-action-btns').style.display = 'flex';
  } catch (e) {
    panel.innerHTML = `<div class="empty-placeholder"><p>Error: ${esc(e.message)}</p></div>`;
  }
}

function renderTabulation(students, cls, session, term) {
  const panel = document.getElementById('tabulation-panel');

  // Collect all unique subjects in a stable order
  const subjectSet = new Set();
  students.forEach(s => s.results.forEach(r => subjectSet.add(r.subject)));
  const subjects = Array.from(subjectSet).sort();

  // Build a score lookup: studentId → { subject → total }
  const scoreMap = {};
  students.forEach(s => {
    scoreMap[s.id] = {};
    s.results.forEach(r => { scoreMap[s.id][r.subject] = r.total; });
  });

  // Column averages
  const colSums   = {};
  const colCounts = {};
  subjects.forEach(subj => { colSums[subj] = 0; colCounts[subj] = 0; });
  students.forEach(s => {
    subjects.forEach(subj => {
      const score = scoreMap[s.id][subj];
      if (score !== undefined) { colSums[subj] += score; colCounts[subj]++; }
    });
  });

  const settings = cachedSettings;
  const schoolName = settings.school_name || 'SCHOOL';

  panel.innerHTML = `
    <div class="tab-sheet" id="tab-sheet">
      <!-- Sheet header (visible on screen & print) -->
      <div class="tab-header">
        <div class="tab-school">${esc(schoolName)}</div>
        <div class="tab-title">TABULATION SHEET</div>
        <div class="tab-meta">
          <span>Class: <strong>${esc(cls)}</strong></span>
          <span>Session: <strong>${esc(session)}</strong></span>
          <span>Term: <strong>${esc(term)}</strong></span>
          <span>No. of Students: <strong>${students.length}</strong></span>
          <span>No. of Subjects: <strong>${subjects.length}</strong></span>
        </div>
      </div>

      <div class="tab-table-wrap">
        <table class="tab-table" id="tab-table">
          <thead>
            <tr>
              <th class="tab-sn">S/N</th>
              <th class="tab-name">Student Name</th>
              <th class="tab-admno">Adm. No.</th>
              ${subjects.map(s => `<th class="tab-subj" title="${esc(s)}">${esc(subjectAbbr(s))}</th>`).join('')}
              <th class="tab-total">Total</th>
              <th class="tab-avg">Avg</th>
              <th class="tab-pos">Pos</th>
            </tr>
            <tr class="tab-subject-full-row">
              <th colspan="3" style="text-align:right;font-size:0.68rem;color:#94a3b8">Full subject names →</th>
              ${subjects.map(s => `<th class="tab-subj-full">${esc(s)}</th>`).join('')}
              <th colspan="3"></th>
            </tr>
          </thead>
          <tbody>
            ${students.map((st, i) => {
              const posClass = st.position === 1 ? 'tab-pos-1' : st.position === 2 ? 'tab-pos-2' : st.position === 3 ? 'tab-pos-3' : '';
              return `<tr class="${posClass}">
                <td class="tab-sn">${i + 1}</td>
                <td class="tab-name-cell">${esc(st.name)}</td>
                <td class="tab-admno-cell">${esc(st.admission_number)}</td>
                ${subjects.map(subj => {
                  const score = scoreMap[st.id][subj];
                  if (score === undefined) return `<td class="tab-score tab-na">—</td>`;
                  const band = score >= 80 ? 'tab-band-a' : score >= 60 ? 'tab-band-b' : score >= 40 ? 'tab-band-c' : 'tab-band-f';
                  return `<td class="tab-score ${band}">${score}</td>`;
                }).join('')}
                <td class="tab-total-cell"><strong>${st.grand_total}</strong></td>
                <td class="tab-avg-cell">${st.average}</td>
                <td class="tab-pos-cell">
                  <span class="tab-pos-badge tab-pos-badge-${st.position <= 3 ? st.position : 'n'}">${getOrdinalTab(st.position)}</span>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr class="tab-col-avg-row">
              <td colspan="3" class="tab-col-avg-label">CLASS AVERAGE</td>
              ${subjects.map(subj => {
                const avg = colCounts[subj] > 0 ? (colSums[subj] / colCounts[subj]).toFixed(1) : '—';
                return `<td class="tab-score tab-col-avg">${avg}</td>`;
              }).join('')}
              <td class="tab-total-cell tab-col-avg">
                ${(students.reduce((s, st) => s + st.grand_total, 0) / students.length).toFixed(1)}
              </td>
              <td class="tab-avg-cell tab-col-avg">
                ${(students.reduce((s, st) => s + st.average, 0) / students.length).toFixed(1)}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="tab-footer">
        <div class="tab-sign">
          <div class="tab-sign-line"></div>
          <p>Class Teacher's Signature &amp; Date</p>
        </div>
        <div class="tab-sign">
          <div class="tab-sign-line"></div>
          <p>Vice Principal's Signature &amp; Date</p>
        </div>
        <div class="tab-sign">
          <div class="tab-sign-line"></div>
          <p>Principal's Signature &amp; Date</p>
        </div>
      </div>
    </div>
  `;
}

function getOrdinalTab(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function printTabulation() {
  const sheet = document.getElementById('tab-sheet');
  if (!sheet) return;
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head>
    <title>Tabulation Sheet</title>
    <style>
      @page { size: A3 landscape; margin: 10mm; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body { font-family: 'Calibri', Arial, sans-serif; font-size: 9pt; margin: 0; }
      .tab-header { text-align: center; margin-bottom: 6pt; border-bottom: 2pt solid #006400; padding-bottom: 5pt; }
      .tab-school { font-size: 13pt; font-weight: bold; color: #006400; text-transform: uppercase; letter-spacing: 1pt; }
      .tab-title  { font-size: 11pt; font-weight: bold; letter-spacing: 2pt; margin: 2pt 0; }
      .tab-meta   { font-size: 8pt; display: flex; justify-content: center; gap: 16pt; flex-wrap: wrap; margin-top: 3pt; }
      .tab-table-wrap { overflow: visible; }
      .tab-table  { width: 100%; border-collapse: collapse; font-size: 8pt; }
      .tab-table th { background: #006400; color: white; padding: 3pt 4pt; border: 0.5pt solid #004d00; font-size: 7.5pt; text-align: center; }
      .tab-table td { padding: 2.5pt 3pt; border: 0.5pt solid #bbb; text-align: center; }
      .tab-name-cell, .tab-admno-cell { text-align: left; white-space: nowrap; }
      .tab-name-cell { font-weight: 600; }
      .tab-pos-1 { background: #fef9c3 !important; }
      .tab-pos-2 { background: #f1f5f9 !important; }
      .tab-pos-3 { background: #fef3c7 !important; }
      .tab-col-avg-row td { background: #006400; color: white; font-weight: bold; }
      .tab-col-avg-label { text-align: right; font-weight: bold; }
      .tab-subject-full-row th { background: #004d00; font-size: 6pt; font-style: italic; white-space: nowrap; }
      .tab-footer { display: flex; justify-content: space-between; margin-top: 12pt; padding-top: 6pt; border-top: 1pt solid #006400; }
      .tab-sign { width: 30%; text-align: center; font-size: 8pt; }
      .tab-sign-line { border-bottom: 0.8pt solid #333; margin-bottom: 3pt; height: 18pt; }
      .tab-na { color: #bbb; }
      .tab-band-a { color: #166534; font-weight: 700; }
      .tab-band-b { color: #1d4ed8; font-weight: 600; }
      .tab-band-c { color: #c2410c; }
      .tab-band-f { color: #dc2626; }
      .tab-pos-badge { font-weight: 700; }
      .tab-total-cell, .tab-avg-cell { font-weight: 700; }
    </style>
  </head><body>${sheet.innerHTML}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 400);
}

function exportTabulationCsv() {
  if (!cachedTabulationData) return;
  const { students, cls, session, term } = cachedTabulationData;

  const subjectSet = new Set();
  students.forEach(s => s.results.forEach(r => subjectSet.add(r.subject)));
  const subjects = Array.from(subjectSet).sort();

  const headers = ['S/N', 'Student Name', 'Admission No', ...subjects, 'Total', 'Average', 'Position'];
  const rows = students.map((st, i) => {
    const scoreMap = {};
    st.results.forEach(r => { scoreMap[r.subject] = r.total; });
    return [
      i + 1, st.name, st.admission_number,
      ...subjects.map(subj => scoreMap[subj] !== undefined ? scoreMap[subj] : ''),
      st.grand_total, st.average, getOrdinalTab(st.position)
    ];
  });

  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `tabulation_${cls}_${session}_${term}.csv`.replace(/[\s/]/g, '_');
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Performance Analysis ──────────────────────────────────────────────────────

const ANALYSIS_RANGE_LABELS = ['80 – 100', '60 – 80', '40 – 60', '0 – 40'];
const ANALYSIS_RANGE_COLORS = {
  '80 – 100': { bg: 'rgba(22,163,74,0.82)',   border: '#16a34a' },
  '60 – 80':  { bg: 'rgba(37,99,235,0.82)',   border: '#2563eb' },
  '40 – 60':  { bg: 'rgba(234,88,12,0.82)',   border: '#ea580c' },
  '0 – 40':   { bg: 'rgba(220,38,38,0.82)',   border: '#dc2626' },
};

let analysisBarChart  = null;
let analysisPieChart  = null;
let cachedAnalysisData = null;

function populateAnalysisDropdowns() {
  // Classes already pre-populated by loadClassArms(); just set session/term defaults
  const anSession = document.getElementById('an-session');
  if (anSession && anSession.options.length <= 1 && cachedStats) {
    (cachedStats.sessions || []).forEach(s => {
      const o = document.createElement('option'); o.value = s; o.textContent = s;
      anSession.appendChild(o);
    });
  }
  if (anSession && cachedSettings.current_session) anSession.value = cachedSettings.current_session;
  const anTerm = document.getElementById('an-term');
  if (anTerm && cachedSettings.current_term) anTerm.value = cachedSettings.current_term;
}

async function loadAnalysis() {
  const cls     = document.getElementById('an-class').value;
  const session = document.getElementById('an-session').value;
  const term    = document.getElementById('an-term').value;

  if (!cls || !session || !term) { showToast('Select class, session, and term first.', 'error'); return; }

  const panel = document.getElementById('analysis-panel');
  panel.innerHTML = '<div class="empty-placeholder"><p>Loading analysis…</p></div>';

  try {
    const params = new URLSearchParams({ class: cls, session, term });
    const res  = await fetch('/api/admin/analysis?' + params);
    const data = await res.json();

    if (!data.success) { showToast(data.message || 'Error loading analysis.', 'error'); return; }
    if (data.studentCount === 0) {
      panel.innerHTML = '<div class="empty-placeholder"><p>No results found for this selection.</p></div>';
      document.getElementById('analysis-export-btn').style.display = 'none';
      return;
    }

    cachedAnalysisData = { ...data, cls, session, term };
    document.getElementById('analysis-export-btn').style.display = '';
    renderAnalysis(data, cls, session, term);

  } catch (e) {
    panel.innerHTML = `<div class="empty-placeholder"><p>Error: ${esc(e.message)}</p></div>`;
  }
}

function renderAnalysis(data, cls, session, term) {
  const panel = document.getElementById('analysis-panel');
  const totals = data.overallTotals;
  const total  = ANALYSIS_RANGE_LABELS.reduce((s, l) => s + (totals[l] || 0), 0);

  panel.innerHTML = `
    <!-- Summary cards -->
    <div class="an-summary-cards">
      ${ANALYSIS_RANGE_LABELS.map(label => {
        const count = totals[label] || 0;
        const pct   = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
        const cls2  = label === '80 – 100' ? 'green' : label === '60 – 80' ? 'blue' : label === '40 – 60' ? 'orange' : 'red';
        return `<div class="an-card an-card-${cls2}">
          <div class="an-card-label">${label}</div>
          <div class="an-card-num">${count}</div>
          <div class="an-card-pct">${pct}% of scores</div>
        </div>`;
      }).join('')}
    </div>

    <!-- Charts row -->
    <div class="an-charts-row">
      <div class="card an-bar-card">
        <div class="card-header">
          <h3>Subject Performance Distribution</h3>
          <span class="an-subtitle">${esc(cls)} · ${esc(session)} · ${esc(term)}</span>
        </div>
        <div class="an-bar-wrap">
          <canvas id="analysisBarChart"></canvas>
        </div>
      </div>
      <div class="card an-pie-card">
        <div class="card-header"><h3>Overall Score Distribution</h3></div>
        <div class="an-pie-wrap">
          <canvas id="analysisPieChart"></canvas>
        </div>
        <div class="an-legend">
          ${ANALYSIS_RANGE_LABELS.map(label => `
            <div class="an-legend-item">
              <span class="an-legend-dot" style="background:${ANALYSIS_RANGE_COLORS[label].border}"></span>
              <span>${label}</span>
              <strong>${totals[label] || 0}</strong>
            </div>`).join('')}
        </div>
      </div>
    </div>

    <!-- Subject averages table -->
    <div class="card" style="margin-top:1.5rem">
      <div class="card-header"><h3>Subject Averages &amp; Score Breakdown</h3></div>
      <div class="table-wrap">
        <table class="data-table an-subject-table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Students</th>
              <th style="color:#16a34a">80–100</th>
              <th style="color:#2563eb">60–80</th>
              <th style="color:#ea580c">40–60</th>
              <th style="color:#dc2626">0–40</th>
              <th>Avg Score</th>
              <th>Performance</th>
            </tr>
          </thead>
          <tbody>
            ${data.subjects.map(subj => {
              const d = data.subjectData[subj];
              const bar = buildMiniBar(d.counts, d.total_students);
              return `<tr>
                <td style="font-weight:600;text-align:left">${esc(subj)}</td>
                <td>${d.total_students}</td>
                <td><span class="an-range-badge an-green">${d.counts['80 – 100'] || 0}</span></td>
                <td><span class="an-range-badge an-blue">${d.counts['60 – 80'] || 0}</span></td>
                <td><span class="an-range-badge an-orange">${d.counts['40 – 60'] || 0}</span></td>
                <td><span class="an-range-badge an-red">${d.counts['0 – 40'] || 0}</span></td>
                <td><strong>${d.avg}</strong></td>
                <td style="min-width:120px">${bar}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Individual student scores -->
    <div class="card" style="margin-top:1.5rem">
      <div class="card-header"><h3>Individual Student Scores</h3>
        <span class="an-subtitle">${data.studentCount} student${data.studentCount !== 1 ? 's' : ''}</span>
      </div>
      <div class="table-wrap">
        <table class="data-table an-student-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Adm. No</th>
              ${data.subjects.map(s => `<th title="${esc(s)}">${esc(subjectAbbr(s))}</th>`).join('')}
              <th>Average</th>
              <th>Band</th>
            </tr>
          </thead>
          <tbody>
            ${data.students.map((st, i) => `
              <tr>
                <td>${i + 1}</td>
                <td style="text-align:left;font-weight:600;white-space:nowrap">${esc(st.name)}</td>
                <td style="font-size:0.78rem;color:#64748b">${esc(st.admission_number)}</td>
                ${data.subjects.map(subj => {
                  const score = st.scores[subj];
                  if (score === undefined) return '<td style="color:#cbd5e1">—</td>';
                  const cls3 = score >= 80 ? 'an-cell-green' : score >= 60 ? 'an-cell-blue' : score >= 40 ? 'an-cell-orange' : 'an-cell-red';
                  return `<td class="${cls3}">${score}</td>`;
                }).join('')}
                <td><strong>${st.average}</strong></td>
                <td>${bandLabel(st.average)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Render bar chart
  if (analysisBarChart) analysisBarChart.destroy();
  const barCtx = document.getElementById('analysisBarChart').getContext('2d');
  analysisBarChart = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels: data.subjects.map(s => subjectAbbr(s)),
      datasets: ANALYSIS_RANGE_LABELS.map(label => ({
        label,
        data: data.subjects.map(s => data.subjectData[s].counts[label] || 0),
        backgroundColor: ANALYSIS_RANGE_COLORS[label].bg,
        borderColor:     ANALYSIS_RANGE_COLORS[label].border,
        borderWidth: 1.5,
        borderRadius: 4,
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { font: { size: 12 }, boxWidth: 14, padding: 16 } },
        tooltip: {
          callbacks: {
            title: (items) => data.subjects[items[0].dataIndex] || items[0].label
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, font: { size: 11 } },
          title: { display: true, text: 'Number of Students', font: { size: 11 } }
        }
      }
    }
  });

  // Render pie chart
  if (analysisPieChart) analysisPieChart.destroy();
  const pieCtx = document.getElementById('analysisPieChart').getContext('2d');
  analysisPieChart = new Chart(pieCtx, {
    type: 'pie',
    data: {
      labels: ANALYSIS_RANGE_LABELS,
      datasets: [{
        data: ANALYSIS_RANGE_LABELS.map(l => totals[l] || 0),
        backgroundColor: ANALYSIS_RANGE_LABELS.map(l => ANALYSIS_RANGE_COLORS[l].bg),
        borderColor:     ANALYSIS_RANGE_LABELS.map(l => ANALYSIS_RANGE_COLORS[l].border),
        borderWidth: 2,
        hoverOffset: 10,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => {
              const val = item.raw;
              const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';
              return ` ${val} scores (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

function buildMiniBar(counts, totalStudents) {
  if (!totalStudents) return '';
  return `<div class="an-mini-bar">
    ${ANALYSIS_RANGE_LABELS.map(label => {
      const w = totalStudents > 0 ? ((counts[label] || 0) / totalStudents * 100).toFixed(1) : 0;
      if (w <= 0) return '';
      const clr = ANALYSIS_RANGE_COLORS[label].border;
      return `<div style="width:${w}%;background:${clr};height:100%;border-radius:2px" title="${label}: ${counts[label] || 0}"></div>`;
    }).join('')}
  </div>`;
}

function bandLabel(avg) {
  if (avg >= 80) return '<span class="an-range-badge an-green">Distinction</span>';
  if (avg >= 60) return '<span class="an-range-badge an-blue">Merit</span>';
  if (avg >= 40) return '<span class="an-range-badge an-orange">Pass</span>';
  return '<span class="an-range-badge an-red">Fail</span>';
}

function subjectAbbr(name) {
  const map = {
    // Common
    'Mathematics':                      'Math',
    'English Language':                 'Eng',
    'Yoruba Language':                  'Yoruba',
    'Handwriting':                      'H/Wrtg',
    'Creative Arts':                    'C.Arts',
    'Cultural and Creative Arts':       'CCA',
    // Pre-school
    'Phonics':                          'Phonics',
    'Social Habits':                    'S.Hab',
    // Nursery
    'Basic Science':                    'B.Sci',
    'Social Studies':                   'S.Std',
    // Primary
    'Basic Science and Technology':     'BST',
    'Physical and Health Education':    'PHE',
    'Civic Education':                  'Civic',
    'Christian Religious Studies':      'CRS',
    'Verbal Reasoning':                 'V.Reas',
    'Quantitative Reasoning':           'Q.Reas',
  };
  return map[name] || name.split(' ')[0];
}

function exportAnalysisCsv() {
  if (!cachedAnalysisData) return;
  const { subjects, students, cls, session, term } = cachedAnalysisData;
  const headers = ['#', 'Name', 'Admission No', ...subjects, 'Average'];
  const rows = students.map((st, i) => [
    i + 1, st.name, st.admission_number,
    ...subjects.map(s => st.scores[s] !== undefined ? st.scores[s] : ''),
    st.average
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `analysis_${cls}_${session}_${term}.csv`.replace(/[\s/]/g, '_');
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Logout ────────────────────────────────────────────────────────────────────

async function logout() {
  if (!confirm('Are you sure you want to log out?')) return;
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (_) {}
  window.location.href = '/admin';
}

// ─── Session Dropdowns ─────────────────────────────────────────────────────────

function setupSessionSelects() {
  // These are populated dynamically by loadStats
  // Just ensure defaults are set from settings
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    ${type === 'success'
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><polyline points="20 6 9 17 4 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
    }
    ${esc(message)}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(d) {
  try { return new Date(d).toLocaleDateString('en-GB'); } catch (_) { return d; }
}

// Close modals on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
  // Close student search dropdown
  if (!e.target.closest('#result-student-input') && !e.target.closest('#student-search-dropdown')) {
    const dd = document.getElementById('student-search-dropdown');
    if (dd) dd.style.display = 'none';
  }
});
