/* global portalClient, getPortalSession, getPortalProfile, isAdminPortalProfile, setPortalMessage, portalActionMessage, appendTextElement, formatPortalDate */

const registrationFieldLabels = Object.fromEntries(registrationFieldGroups.flatMap(([group, fields]) =>
    fields.map(([key, label]) => [key, group + ' · ' + label])
));

function registrationInputError(input, value, limit) {
    if (input.validity.badInput) return 'Enter a complete date.';
    if (limit > 0 && Array.from(value).length > limit) return `Use ${limit} characters or fewer.`;
    if (input.name === 'reason' && !value) return 'Enter a reason for saving this registration.';
    if (['firstName', 'lastName'].includes(input.name) && !value) return 'Enter a name.';
    if (input.name === 'gradeLevel' && !/^(K|[1-9]|1[0-2])$/.test(value)) return 'Choose a grade from kindergarten through 12.';
    if (input.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email address.';
    return '';
}

function registrationServerFieldError(error) {
    if (error?.code !== '22023' || typeof error.details !== 'string') return null;
    try {
        const detail = JSON.parse(error.details);
        if (typeof detail?.field === 'string' && typeof detail.message === 'string') return detail;
    } catch {
        // Unstructured database errors use the standard status message.
    }
    return null;
}

async function initRegistrationReview() {
    const get = id => document.getElementById(id);
    const status = get('registration-review-status');
    const historyStatus = get('registration-history-status');
    const list = get('registration-review-list');
    const more = get('registration-review-more');
    const form = get('registration-edit-form');
    const session = await getPortalSession();
    const profile = await getPortalProfile(session);
    const admin = isAdminPortalProfile(profile);
    if (!profile?.active || (!admin && profile.role !== 'teacher')) return;

    const params = new URLSearchParams(location.search);
    const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
    const getId = name => uuid.test(params.get(name) || '') ? params.get(name) : null;
    const student = getId('student');
    const record = getId('record');
    const focused = getId('request');
    const studentLink = studentId => 'student-records.html?student=' + encodeURIComponent(studentId);
    const states = { pending: 'Pending review', approved: 'Approved', rejected: 'Rejected', returned: 'Returned for changes' };
    const pageSize = 25;
    let active = true;
    let page = 0;

    portalClient.auth.onAuthStateChange((_event, current) => {
        if (current?.user?.id !== session.user.id) {
            active = false;
            list.replaceChildren();
            get('registration-edit').hidden = true;
        }
    });

    async function withButton(button, work, output, action, next) {
        if (button.disabled) return;
        button.disabled = true;
        try { await work(); }
        catch (error) {
            if (active) setPortalMessage(output, portalActionMessage(error, action, next), 'error');
        } finally { button.disabled = false; }
    }

    function showValues(registration, container) {
        const keys = Object.keys(registration.changes);
        if (!keys.length) {
            appendTextElement(container, 'p', 'This request flags a missing registration.');
            return;
        }
        const table = appendTextElement(container, 'table', '', 'registration-values');
        const head = table.createTHead().insertRow();
        const body = table.createTBody();
        appendTextElement(head, 'th', 'Field').scope = 'col';
        appendTextElement(head, 'th', 'Values').scope = 'col';
        for (const key of keys) {
            const row = body.insertRow();
            appendTextElement(row, 'th', registrationFieldLabels[key] || key).scope = 'row';
            const values = row.insertCell();
            appendTextElement(values, 'span', 'Before request: ' + (registration.before_values[key] || 'Blank'));
            if (registration.applied_against && registration.applied_against[key] !== registration.before_values[key]) {
                appendTextElement(values, 'span', 'Before approval: ' + (registration.applied_against[key] || 'Blank'));
            }
            if (registration.state === 'pending' && registration.current_values) {
                appendTextElement(values, 'span', 'Current approved value: ' + (registration.current_values[key] || 'Blank'));
            }
            appendTextElement(values, 'span', 'Proposed: ' + (registration.changes[key] || 'Blank'));
        }
    }

    function decisionForm(request, article) {
        const stale = request.current_revision !== request.base_revision;
        if (!request.record_available) {
            appendTextElement(article, 'p', 'The registration was moved or now exists in Student Records. Review the student record and return or reject this request.');
        } else if (stale) {
            appendTextElement(article, 'p', 'The approved record changed after this request. Compare the values above before applying it.');
        }
        const reviewForm = appendTextElement(article, 'form', '', 'registration-decision');
        const noteLabel = appendTextElement(reviewForm, 'label', 'Review note');
        const note = appendTextElement(noteLabel, 'textarea', '');
        note.maxLength = 1000;
        note.rows = 2;
        const buttons = appendTextElement(reviewForm, 'div', '', 'gradebook-toolbar');
        const feedback = appendTextElement(reviewForm, 'p', '');
        feedback.setAttribute('role', 'status');
        feedback.setAttribute('aria-live', 'polite');
        for (const [outcome, label] of [
            ['approved', stale ? 'Approve against current record' : 'Approve'],
            ['returned', 'Return for changes'], ['rejected', 'Reject']
        ]) {
            const button = appendTextElement(buttons, 'button', label);
            button.type = 'button';
            button.disabled = outcome === 'approved' && !request.record_available;
            button.onclick = () => withButton(button, async () => {
                if (outcome !== 'approved' && !note.value.trim()) {
                    setPortalMessage(feedback, 'Add a note explaining what the teacher should correct or why the request was rejected.', 'error');
                    note.focus();
                    return;
                }
                if (outcome === 'approved' && stale &&
                    !window.confirm('Apply these proposed changes to the current approved record shown above?')) return;
                const { error } = await portalClient.rpc('registration_decide_change', {
                    target_request: request.id, decision: outcome, note: note.value.trim(),
                    reviewed_revision: request.current_revision, acknowledge_newer: stale
                });
                if (error) throw error;
                await loadRequests();
                if (active) setPortalMessage(historyStatus, outcome === 'approved' ? 'Changes approved and saved.'
                    : outcome === 'returned' ? 'Request returned with your note.' : 'Request rejected.', 'success');
            }, feedback, 'review this request', 'Refresh the request to check its current status and values before continuing.');
        }
    }

    async function loadRequests(append = false) {
        const start = append ? page : 0;
        const { data, error } = await portalClient.rpc('registration_review_list', {
            target_request: focused, target_student: student
        }).range(start, start + pageSize - 1);
        if (error) throw error;
        if (!active) return;
        if (!append) list.replaceChildren();
        if (focused) get('registration-review-all').hidden = false;
        if (!data.length && !append) {
            appendTextElement(list, 'p', focused ? 'This request isn’t available to your account.' : 'There are no registration requests to show.');
        }
        for (const request of data) {
            const article = appendTextElement(list, 'article', '', 'gradebook-panel');
            appendTextElement(article, 'h3', request.student_name);
            appendTextElement(article, 'p', [states[request.state], request.requested_by, formatPortalDate(request.requested_at)].join(' · '));
            appendTextElement(article, 'p', 'Request reason: ' + request.request_note);
            showValues(request, article);
            if (request.decided_by) appendTextElement(article, 'p', 'Reviewed by ' + request.decided_by + ' · ' + formatPortalDate(request.decided_at));
            if (request.review_note) appendTextElement(article, 'p', 'Review note: ' + request.review_note);
            appendTextElement(article, 'a', 'Open student record').href = studentLink(request.student_id);
            if (admin && request.state === 'pending') decisionForm(request, article);
            if (!admin && request.state === 'returned' && request.record_available) {
                const target = new URLSearchParams({student: request.student_id});
                if (request.record_id) target.set('record', request.record_id);
                const link = appendTextElement(article, 'a', 'Start a revised request');
                link.href = 'registration-review.html?' + target;
            }
        }
        page = start + data.length;
        more.hidden = data.length < pageSize || Boolean(focused);
    }

    async function editRegistration() {
        if (!student) return;
        const { data: context, error } = await portalClient.rpc('registration_edit_context', {target_student:student,target_record:record});
        if (error) throw error;
        if (!active) return;
        const name = [context.values.preferredName || context.values.firstName,context.values.lastName].filter(Boolean).join(' ');
        const title = admin ? (record ? 'Edit registration' : 'Add a registration')
            : (record ? 'Suggest a correction' : 'Flag a missing registration');
        get('registration-teacher-note').hidden = admin;
        get('registration-edit-title').textContent = name ? title + ' for ' + name : title;
        get('registration-review-back').href = studentLink(student);
        const fields = get('registration-fields');
        const editors = new Map();
        const legacyDatabase = admin && !Object.hasOwn(context.values, 'dateOfBirth');
        get('registration-database-note').hidden = !legacyDatabase;

        function registerInput(input, label, limit) {
            const caption = document.createElement('span');
            caption.id = 'registration-label-' + input.name;
            caption.textContent = label.firstChild.textContent.trim();
            label.firstChild.replaceWith(caption);
            const feedback = appendTextElement(label, 'span', '', 'registration-field-error');
            feedback.id = 'registration-error-' + input.name;
            feedback.hidden = true;
            input.setAttribute('aria-labelledby', caption.id);
            input.setAttribute('aria-describedby', feedback.id);
            editors.set(input.name, { input, displayed: input.value.trim(), limit, feedback });
        }

        function markInput(key, text) {
            const { input, feedback } = editors.get(key);
            feedback.textContent = text;
            feedback.hidden = !text;
            if (text) input.setAttribute('aria-invalid', 'true');
            else input.removeAttribute('aria-invalid');
        }

        function showInputErrors(errors) {
            for (const [key, text] of errors) markInput(key, text);
            const [firstKey, firstMessage] = errors.entries().next().value;
            const label = registrationFieldLabels[firstKey] || 'Reason';
            setPortalMessage(status, errors.size === 1 ? label + '. ' + firstMessage
                : `Check the ${errors.size} highlighted fields. First, ${label}.`, 'error');
            editors.get(firstKey).input.focus();
        }
        if (record || admin) {
            for (const [group, definitions] of registrationFieldGroups) {
                const visible = definitions.filter(([, , , , teacherEditable]) => admin || teacherEditable);
                if (!visible.length) continue;
                const section = appendTextElement(fields, 'fieldset', '', 'registration-field-group');
                appendTextElement(section, 'legend', group);
                const grid = appendTextElement(section, 'div', '', 'gradebook-form-grid');
                for (const [key, caption, type, settings] of visible) {
                    const label = appendTextElement(grid, 'label', caption);
                    const input = type === 'select' || type === 'textarea' ? document.createElement(type)
                        : document.createElement('input');
                    input.name = key;
                    const current = context.values[key] || '';
                    if (type === 'select') {
                        appendTextElement(input, 'option', 'Choose an option').value = '';
                        for (const item of settings) {
                            const [value, name] = Array.isArray(item) ? item : [item, item];
                            appendTextElement(input, 'option', name).value = value;
                        }
                        if (current && !Array.from(input.options).some(option => option.value === current)) {
                            appendTextElement(input, 'option', current + ' (on file)').value = current;
                        }
                    } else if (type === 'textarea') {
                        input.rows = 3;
                        label.className = 'registration-long-field';
                    } else {
                        input.type = type;
                    }
                    input.value = current;
                    label.append(input);
                    registerInput(input, label, typeof settings === 'number' ? settings : 250);
                }
            }
        }

        let requestId = crypto.randomUUID();
        const submit = form.querySelector('button[type="submit"]');
        const reason = form.elements.reason;
        registerInput(reason, reason.closest('label'), 1000);
        submit.textContent = admin ? 'Save approved record' : 'Submit for review';
        form.addEventListener('input', event => {
            requestId = crypto.randomUUID();
            if (editors.has(event.target.name) && event.target.hasAttribute('aria-invalid')) {
                markInput(event.target.name, '');
                if (!form.querySelector('[aria-invalid="true"]')) setPortalMessage(status, '');
            }
        });
        form.onsubmit = event => {
            event.preventDefault();
            void withButton(submit, async () => {
                const changes = {};
                const errors = new Map();
                for (const [key, { input, displayed, limit }] of editors) {
                    markInput(key, '');
                    const value = input.value.trim();
                    if (key !== 'reason' && value === displayed && !input.validity.badInput) continue;
                    const message = legacyDatabase && key !== 'reason' && !Object.hasOwn(context.values, key)
                        ? 'This field needs the Supabase registration update before it can be saved.'
                        : registrationInputError(input, value, limit);
                    if (message) errors.set(key, message);
                    else if (key !== 'reason') changes[key] = value;
                }
                if (errors.size) return showInputErrors(errors);
                const { error } = await portalClient.rpc('registration_submit_change', {
                    request_id: requestId, target_student: student, target_record: record,
                    expected_revision: context.revision, changes, note: reason.value.trim()
                });
                if (!active) return;
                if (error) {
                    const detail = registrationServerFieldError(error);
                    if (detail && editors.has(detail.field)) return showInputErrors(new Map([[detail.field, detail.message]]));
                    throw error;
                }
                get('registration-edit').hidden = true;
                setPortalMessage(status, admin ? 'Registration saved and recorded in the history.' : 'Request submitted. An administrator will review it.', 'success');
                await loadRequests();
            }, status, admin ? 'save the registration' : 'submit the correction', 'Your entries are still in the form.');
        };
        get('registration-edit').hidden = false;
    }

    more.onclick = () => withButton(more, () => loadRequests(true), historyStatus,
        'load more registration history', 'Reload the review queue and try again.');
    if (student) void editRegistration().catch(error => {
        if (active) setPortalMessage(status, portalActionMessage(error, 'open the registration editor',
            'Go back to Student Records and choose the current linked record.'), 'error');
    });
    try { await loadRequests(); }
    catch (error) {
        if (active) setPortalMessage(historyStatus, portalActionMessage(error, 'load registration requests',
            'Reload this page or open the relevant student through Student Records.'), 'error');
    }
}

document.addEventListener('DOMContentLoaded', initRegistrationReview);
