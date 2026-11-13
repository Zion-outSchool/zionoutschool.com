import { createInquiryPayload, validateInquiry, MAX_STUDENTS } from './inquiry-data.mjs';

// Existing production destination. Local browser checks replace fetch; never submit test records here.
const INQUIRY_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby4UgELLE6qIz3ggT14LKnHjxrgb-PCdqvV5U2Sjgl2nZLkiE18Bl4QAJ9ClG2uNQii/exec';
const form = document.getElementById('inquiry-form');
const container = document.getElementById('students-container');
const addButton = document.getElementById('add-student-btn');
const submitButton = document.getElementById('inquiry-submit-btn');
const submissionError = document.getElementById('inquiry-error');
let nextStudentId = 0;
let submitting = false;

function updateStudents() {
    const blocks = [...container.querySelectorAll('.student-block')];
    blocks.forEach((block, index) => {
        block.querySelector('.student-block-label').textContent = `Student ${index + 1}`;
        const remove = block.querySelector('.student-remove-btn');
        if (remove) remove.setAttribute('aria-label', `Remove student ${index + 1}`);
    });
    document.getElementById('student-section-plural').textContent = blocks.length > 1 ? 's' : '';
    document.getElementById('add-student-wrap').hidden = blocks.length >= MAX_STUDENTS;
}

function addStudent(focus = true) {
    if (container.children.length >= MAX_STUDENTS) return;
    const n = ++nextStudentId; // Monotonic IDs prevent collisions after removing and adding children.
    const block = document.createElement('div');
    block.className = 'student-block';
    block.id = `student-block-${n}`;
    block.innerHTML = `
        <div class="student-block-header">
            <h3 class="student-block-label"></h3>
            ${n > 1 ? '<button type="button" class="student-remove-btn">Remove</button>' : ''}
        </div>
        <div class="form-row">
            <div class="form-group">
                <label for="s${n}-age" class="form-label">Age &amp; Current Grade <span class="form-required" aria-hidden="true">*</span></label>
                <input type="text" id="s${n}-age" name="students[${n}][studentAge]" class="form-input student-age" placeholder="e.g. 4, not yet in school; or 9, grade 4" required aria-describedby="s${n}-age-hint s${n}-age-error">
                <p class="form-hint" id="s${n}-age-hint">Include age and current grade, or “not yet in school.”</p>
                <span class="form-error" id="s${n}-age-error">Please enter your student’s age and current grade, or age and “not yet in school.”</span>
            </div>
            <div class="form-group">
                <label for="s${n}-name" class="form-label">Student’s Name <span class="form-optional">(optional)</span></label>
                <input type="text" id="s${n}-name" name="students[${n}][studentName]" class="form-input student-name">
            </div>
        </div>
        <details class="inquiry-more">
            <summary aria-expanded="false">Share more about your child (optional)</summary>
            <div class="inquiry-more-content">
                <p class="form-hint">Share anything that would help us prepare for a conversation.</p>
                <div class="form-group">
                    <label for="s${n}-subjects" class="form-label">Interests or favorite subjects <span class="form-optional">(optional)</span></label>
                    <textarea id="s${n}-subjects" name="students[${n}][studentSubjects]" class="form-input form-textarea student-subjects" rows="3"></textarea>
                </div>
                <div class="form-group">
                    <label for="s${n}-learning" class="form-label">Learning considerations <span class="form-optional">(optional)</span></label>
                    <textarea id="s${n}-learning" name="students[${n}][studentLearning]" class="form-input form-textarea student-learning" rows="3"></textarea>
                </div>
            </div>
        </details>`;
    block.querySelector('.student-remove-btn')?.addEventListener('click', () => {
        block.remove();
        updateStudents();
        document.getElementById('student-update').textContent = `${container.children.length} students included.`;
        addButton.focus();
    });
    const details = block.querySelector('details');
    details.addEventListener('toggle', () => details.querySelector('summary').setAttribute('aria-expanded', String(details.open)));
    container.appendChild(block);
    updateStudents();
    if (focus) {
        document.getElementById('student-update').textContent = `Student ${container.children.length} added.`;
        block.querySelector('.student-age').focus();
    }
}
addButton.addEventListener('click', () => addStudent());
addStudent(false);

function collectPayload() {
    const fields = Object.fromEntries(new FormData(form));
    const students = [...container.querySelectorAll('.student-block')].map(block => ({
        studentName: block.querySelector('.student-name').value,
        studentAge: block.querySelector('.student-age').value,
        studentSubjects: block.querySelector('.student-subjects').value,
        studentLearning: block.querySelector('.student-learning').value
    }));
    return createInquiryPayload(fields, students);
}

function showValidation(errors) {
    form.querySelectorAll('.form-error').forEach(error => { error.style.display = 'none'; });
    form.querySelectorAll('[aria-invalid]').forEach(field => {
        field.removeAttribute('aria-invalid');
        field.classList.remove('form-input--error');
    });
    const blocks = [...container.querySelectorAll('.student-block')];
    let first;
    errors.forEach(key => {
        const field = key.startsWith('students.')
            ? blocks[Number(key.split('.')[1])]?.querySelector('.student-age')
            : document.getElementById(key);
        if (!field) return;
        field.setAttribute('aria-invalid', 'true');
        field.classList.add('form-input--error');
        const error = document.getElementById(`${field.id}-error`);
        if (error) error.style.display = 'block';
        first ??= field;
    });
    first?.focus();
}

form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;
    submissionError.hidden = true;
    const payload = collectPayload();
    const errors = validateInquiry(payload);
    showValidation(errors);
    if (errors.length) return;
    submitting = true;
    submitButton.disabled = true;
    form.setAttribute('aria-busy', 'true');
    submitButton.querySelector('.form-submit-text').style.display = 'none';
    submitButton.querySelector('.form-submit-loading').style.display = 'inline';
    try {
        // Preserve the existing simple POST transport and response contract.
        const response = await fetch(INQUIRY_SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
        if (!response.ok) throw new Error('Inquiry request failed');
        const result = await response.json();
        if (result.result !== 'success') throw new Error('Inquiry was not accepted');
        form.hidden = true;
        const success = document.getElementById('inquiry-success');
        success.hidden = false;
        success.focus();
    } catch {
        // Never reset fields: families can retry without losing their information.
        submissionError.hidden = false;
        submissionError.focus();
    } finally {
        submitting = false;
        submitButton.disabled = false;
        form.removeAttribute('aria-busy');
        submitButton.querySelector('.form-submit-text').style.display = 'inline';
        submitButton.querySelector('.form-submit-loading').style.display = 'none';
    }
});
