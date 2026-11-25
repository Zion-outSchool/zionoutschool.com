(() => {
    const byId = id => document.getElementById('ms-' + id);
    const content = byId('content');
    const status = byId('status');
    const studentInput = byId('student');
    const courseStatuses = { planned: 'Planned', in_progress: 'In progress', completed: 'Completed', withdrawn: 'Withdrawn' };
    const resultKinds = { term: 'Term result', final: 'Final result', interim: 'Interim result' };
    const requestStatuses = { requested: 'Requested', in_review: 'In review', issued: 'Issued', declined: 'Declined' };
    const teachingModes = { standalone: 'Standalone', rotation: 'Rotation', integrated: 'Integrated into another course' };
    const creditStatuses = { pending: 'High-school credit pending', awarded: 'High-school credit awarded', no_credit: 'No high-school credit awarded' };
    let office = false;
    let family = false;
    let roster = [];
    let courseMap = [];
    let standardsCatalog;
    const enrollmentGrades = Object.fromEntries(Object.entries(K8_GRADE_LABELS).map(([grade, label]) =>
        [grade === 'K' ? '0' : grade, label]));
    let activeView;
    let renderVersion = 0;

    function node(tag, text, className) {
        const element = document.createElement(tag);
        if (text != null && text !== '') element.textContent = text;
        if (className) element.className = className;
        return element;
    }

    function panel(title) {
        const section = node('section', '', 'ms-panel');
        section.append(node('h2', title));
        return section;
    }

    async function call(action, data = {}) {
        const { data: result, error } = await portalClient.rpc('middle_school', { p_action: action, p_data: data });
        if (error) throw error;
        return result;
    }

    function fail(error, target) {
        const message = typeof error === 'object' && error?.code
            ? portalActionMessage(error, 'complete this action', 'Check the fields and your access, then try again.')
            : error?.message || 'The request couldn’t be completed.';
        setPortalMessage(target, message, 'error');
    }

    async function run(control, feedback, task) {
        if (control.disabled) return;
        control.disabled = true;
        setPortalMessage(feedback, '');
        try {
            await task();
        } catch (error) {
            fail(error, feedback);
        } finally {
            control.disabled = false;
        }
    }

    function button(label, task, feedback = status) {
        const control = node('button', label);
        control.type = 'button';
        control.onclick = () => void run(control, feedback, task);
        return control;
    }

    function field(name, label, value = '', options = {}) {
        const wrapper = node('label', '', options.type === 'checkbox' ? 'ms-check' : options.wide ? 'ms-wide' : '');
        const control = node(options.choices ? 'select' : options.type === 'textarea' ? 'textarea' : 'input');
        control.name = name;
        if (options.choices) {
            for (const [key, text] of Object.entries(options.choices)) {
                const option = node('option', text);
                option.value = key;
                control.append(option);
            }
        } else if (options.type === 'textarea') control.rows = 3;
        else control.type = options.type || 'text';
        if (options.type === 'checkbox') {
            control.checked = Boolean(value);
            wrapper.append(control, node('span', label));
        } else {
            control.value = value ?? '';
            wrapper.append(node('span', label), control);
        }
        control.required = Boolean(options.required);
        if (options.max) control.maxLength = options.max;
        if (options.type === 'number') {
            control.step = '0.01';
            control.min = '0.01';
            control.max = '99.99';
        }
        if (options.disabled) control.disabled = true;
        if (options.pattern) control.pattern = options.pattern;
        return wrapper;
    }

    function form(fields, submitText, task) {
        const result = node('form', '', 'ms-form');
        const grid = node('div', '', 'ms-fields');
        grid.append(...fields);
        const feedback = node('p', '', 'ms-feedback');
        feedback.setAttribute('role', 'status');
        const submit = node('button', submitText);
        submit.type = 'submit';
        result.append(grid, submit, feedback);
        result.onsubmit = event => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(result));
            for (const checkbox of result.querySelectorAll('input[type="checkbox"][name]')) {
                if (!checkbox.disabled) values[checkbox.name] = checkbox.checked;
            }
            void run(submit, feedback, () => task(values, result, feedback));
        };
        return result;
    }

    function editor(label, child) {
        const details = node('details', '', 'ms-editor');
        details.append(node('summary', label), child);
        return details;
    }

    function gradeLabel(grade) {
        return enrollmentGrades[String(grade)] || String(grade ?? '');
    }

    function standardsEditor(label, initial, grade) {
        const host = node('div');
        const details = editor(label, host);
        details.classList.add('ms-wide');
        let selection = initial || [];
        let picker;
        details.ontoggle = () => {
            if (!details.open || picker || !standardsCatalog) return;
            picker = createMathStandardsPicker(standardsCatalog, selection, Number(grade) === 0 ? 'K' : String(grade ?? 'K'));
            host.append(picker.element);
        };
        return {
            element: details,
            selected: () => picker ? picker.selected() : selection,
            setSelection: values => {
                selection = values || [];
                picker?.setSelection(selection);
            }
        };
    }

    function group(parent, title, text) {
        const container = panel(title);
        if (text) container.append(node('p', text, 'ms-muted'));
        parent.append(container);
        return container;
    }

    function selectableStudent() {
        return roster.find(student => student.id === studentInput.value);
    }

    function date(value) {
        return value ? formatPortalDate(value.length === 10 ? value + 'T12:00:00' : value) : '';
    }

    function courseWindow(course) {
        return [course.term, [course.starts_on, course.ends_on].filter(Boolean).map(date).join(' – ')].filter(Boolean).join(' · ');
    }

    function creditLabel(course) {
        return course.credit_decision === 'awarded'
            ? `${course.units} high-school unit${Number(course.units) === 1 ? '' : 's'} awarded`
            : creditStatuses[course.credit_decision] || 'Middle school coursework';
    }

    function excerpt(result) {
        return [resultKinds[result.result_kind], result.as_of && 'As of ' + date(result.as_of),
            result.period && result.period + (result.period_end && result.period_end !== result.as_of
                ? ' · ' + date(result.period_end) : '')].filter(Boolean).join(' · ');
    }

    function courseCard(course) {
        const card = node('article', '', 'ms-course');
        card.append(node('h3', course.title), node('p', [course.area, 'Instructional level ' + course.instructional_level, courseWindow(course)]
            .filter(Boolean).join(' · '), 'ms-meta'), node('p', courseStatuses[course.course_status]),
            node('p', creditLabel(course), 'ms-credit'));
        return card;
    }

    function familyCourse(course, results) {
        const card = courseCard(course);
        if (course.math_topics?.length) card.append(node('p', 'Planned math topics · ' + course.math_topics.join(', '), 'ms-meta'));
        if (!results.length) card.append(node('p', 'No verified result has been published yet.', 'ms-muted'));
        for (const result of results) {
            const entry = node('div', '', 'ms-family-result');
            entry.append(node('h4', result.mark), node('p', excerpt(result), 'ms-meta'));
            if (result.next_step) entry.append(node('strong', 'Next step'), node('p', result.next_step, 'ms-text'));
            if (result.math_standards?.length) {
                const topics = new Map();
                for (const item of result.math_standards) {
                    if (!topics.has(item.topic)) topics.set(item.topic, []);
                    topics.get(item.topic).push(item.code);
                }
                entry.append(node('p', 'Math topics addressed · ' + [...topics.keys()].join(', '), 'ms-meta'));
                const details = node('details', '', 'ms-math-topics');
                const codes = node('ul');
                for (const [topic, items] of topics) codes.append(node('li', topic + ' · ' + items.join(', ')));
                details.append(node('summary', 'View standards codes'), codes);
                entry.append(details);
            }
            card.append(entry);
        }
        return card;
    }

    function downloadFile(bytes, filename) {
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const link = node('a');
        link.href = url;
        link.download = filename;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    async function downloadTranscript(id) {
        const { file, issued_at } = await call('download', { id });
        downloadFile(Uint8Array.from(atob(file), character => character.charCodeAt(0)),
            `middle-school-transcript-${issued_at.slice(0, 10)}-${id.slice(0, 8)}.pdf`);
    }

    function transcriptList(parent, transcripts) {
        if (!transcripts.length) return;
        parent.append(node('h3', 'Issued transcripts'));
        const list = node('ul', '', 'ms-office-list');
        for (const transcript of transcripts) {
            const item = node('li');
            const actions = node('div', '', 'ms-actions');
            actions.append(button('Download certified PDF', () => downloadTranscript(transcript.id)));
            if (office && !transcript.released) actions.append(button('Release to family', async () => {
                if (window.confirm('Release this certified copy to the linked family?')) {
                    await save('release', { id: transcript.id }, 'Certified transcript released.');
                }
            }));
            item.append(node('span', [transcript.legal_name, date(transcript.issued_at),
                office && (transcript.released ? 'Released to family' : 'Office copy')].filter(Boolean).join(' · ')), actions);
            list.append(item);
        }
        parent.append(list);
    }

    function familyRecord(record, student) {
        const page = node('div');
        page.append(node('p', 'Unofficial learning record', 'ms-unofficial'));
        const thisYear = activeView === 'year';
        const years = thisYear ? record.years.filter(year => year.school_year === record.current_school_year) : record.years;
        const resultsByCourse = new Map();
        for (const result of record.results) {
            if (!resultsByCourse.has(result.course_id)) resultsByCourse.set(result.course_id, []);
            resultsByCourse.get(result.course_id).push(result);
        }
        let visibleYears = 0;
        for (const year of years) {
            const courses = record.courses.filter(course => course.year_id === year.id
                && (thisYear || resultsByCourse.has(course.id)));
            if (!thisYear && !courses.length) continue;
            visibleYears += 1;
            const section = group(page, `${year.school_year} · ${gradeLabel(year.enrolled_grade)}`,
                year.withdrawn_on ? 'Withdrawn ' + date(year.withdrawn_on) : '');
            if (!courses.length) section.append(node('p', 'Courses will appear here once the school adds them.'));
            const grid = node('div', '', 'ms-course-grid');
            for (const course of courses) {
                const results = resultsByCourse.get(course.id) || [];
                grid.append(familyCourse(course, thisYear ? results.slice(0, 1) : results));
            }
            section.append(grid);
        }
        if (!visibleYears) group(page, thisYear ? record.current_school_year : 'K–8 history',
            thisYear ? 'No courses have been added for this school year.' : 'No verified course results have been published yet.');
        const requests = group(page, 'Official transcript');
        if (record.years.length) {
            const open = record.requests.some(request => ['requested', 'in_review'].includes(request.status));
            if (!open) requests.append(button('Request official transcript', async () => {
                await call('request', { student_id: student.id });
                await render();
                setPortalMessage(status, 'Transcript requested.', 'success');
            }));
            if (record.requests.length) {
                const list = node('ul', '', 'ms-office-list');
                for (const request of record.requests) list.append(node('li', `${date(request.requested_at)} · ${requestStatuses[request.status]}`));
                requests.append(list);
            }
        } else requests.append(node('p', 'Transcript requests open once an enrollment is on file.'));
        transcriptList(requests, record.transcripts);
        return page;
    }

    async function save(action, data, feedbackText) {
        await call(action, data);
        await render();
        setPortalMessage(status, feedbackText, 'success');
    }

    function yearForm(student, record, year = {}) {
        return form([
            field('school_year', 'School year (YYYY-YYYY)', year.school_year || record.current_school_year,
                { required: true, pattern: '[0-9]{4}-[0-9]{4}' }),
            field('enrolled_grade', 'Enrolled grade', year.enrolled_grade ?? '', { required: true, choices: { '': 'Choose grade', ...enrollmentGrades } }),
            field('legal_name', 'Student legal name', year.legal_name || [student.first_name, student.last_name].join(' '), { max: 240 }),
            field('entered_on', 'Entry date', year.entered_on, { type: 'date' }),
            field('withdrawn_on', 'Withdrawal date', year.withdrawn_on, { type: 'date' }),
            field('progression', 'Year-end progression', year.progression, { max: 240 }),
        ], 'Save enrollment', values => save('year-save', { ...values, student_id: student.id, id: year.id }, 'Enrollment saved.'));
    }

    function courseForm(year, course = {}) {
        const choices = { '': 'Enter a course manually' };
        for (const map of courseMap.filter(map => map.active || map.id === course.map_id)) {
            choices[map.id] = [map.title, map.grade != null && gradeLabel(map.grade), map.term, teachingModes[map.mode]].filter(Boolean).join(' · ');
        }
        const alignment = standardsEditor('Planned math standards', course.math_codes, year.enrolled_grade);
        const result = form([
            field('map_id', 'Course map', course.map_id, { choices }),
            field('area', 'Subject area', course.area, { required: true, max: 100 }),
            field('title', 'Actual course title', course.title, { required: true, max: 180 }),
            field('instructional_level', 'Instructional level', course.instructional_level || gradeLabel(year.enrolled_grade), { required: true, max: 100 }),
            field('term', 'Term', course.term, { max: 100 }),
            field('starts_on', 'Start date', course.starts_on, { type: 'date' }),
            field('ends_on', 'End date', course.ends_on, { type: 'date' }),
            field('course_status', 'Course status', course.course_status || 'planned', { choices: courseStatuses }),
            ...(Number(year.enrolled_grade) >= 6 ? [field('high_school_level', 'High-school-level course', course.high_school_level,
                { type: 'checkbox', disabled: Boolean(course.credit_decided_at) })] : []),
            alignment.element,
        ], 'Save course', values => save('course-save', {
            ...values, math_codes: alignment.selected(), year_id: year.id, id: course.id
        }, 'Course saved.'));
        result.elements.map_id.onchange = () => {
            const map = courseMap.find(entry => entry.id === result.elements.map_id.value);
            if (!map) return;
            result.elements.area.value = map.area;
            result.elements.title.value = map.title;
            if (map.term) result.elements.term.value = map.term;
            if (map.grade != null) result.elements.instructional_level.value = gradeLabel(map.grade);
            alignment.setSelection(map.math_codes);
        };
        return result;
    }

    function resultForm(course, year, result = {}) {
        const alignment = standardsEditor('Math standards addressed in this result', result.math_codes, year.enrolled_grade);
        const entry = form([
            field('period', 'Reporting period', result.period, { required: true, max: 100 }),
            field('period_end', 'Reporting period end', result.period_end, { required: true, type: 'date' }),
            field('result_kind', 'Result type', result.result_kind || 'term', { choices: resultKinds, disabled: Boolean(result.gradebook_enrollment_id) }),
            field('as_of', 'Interim as-of date', result.as_of, { type: 'date' }),
            field('mark', 'Grade or mastery mark', result.mark, { required: true, max: 100, disabled: Boolean(result.gradebook_enrollment_id) }),
            field('next_step', 'Family-facing next step (office approval required)', result.next_step, { type: 'textarea', wide: true, max: 2000 }),
            field('evidence_url', 'Supporting evidence link (staff only)', result.evidence_url, { type: 'url', wide: true, max: 2048 }),
            alignment.element,
        ], 'Submit for verification', values => save('result-save', {
            ...values, math_codes: alignment.selected(), id: result.id, version: result.version, course_id: course.id,
        }, 'Result submitted for office verification.'));
        const updateInterim = () => {
            const field = entry.elements.as_of;
            const interim = entry.elements.result_kind.value === 'interim';
            field.closest('label').hidden = field.disabled = !interim;
            field.required = interim;
        };
        entry.elements.result_kind.onchange = updateInterim;
        updateInterim();
        return entry;
    }

    function creditForm(course, settings) {
        const requirements = Object.fromEntries([['', 'Choose requirement'], ...GRADUATION_REQUIREMENTS
            .filter(item => !item.category).map(item => [item.key, item.label])]);
        const editor = form([
            field('decision', 'Office credit decision', course.credit_decision || 'pending',
                { choices: { pending: 'Pending', awarded: 'Awarded', no_credit: 'No credit awarded' } }),
            field('units', 'Awarded units', course.units, { type: 'number' }),
            field('add_to_transcript', 'Add class to high school transcript', course.add_to_transcript, { type: 'checkbox' }),
            field('hs_requirement', 'High school requirement', course.hs_requirement, { choices: requirements }),
        ], 'Save credit decision', values => save('credit-save', { ...values, id: course.id }, 'Credit decision saved.'));
        const update = () => {
            const award = editor.elements.decision.value === 'awarded';
            editor.elements.units.disabled = !award;
            editor.elements.units.required = award;
            editor.elements.add_to_transcript.disabled = !award;
            if (!award) editor.elements.add_to_transcript.checked = false;
            editor.elements.hs_requirement.disabled = !award || !editor.elements.add_to_transcript.checked;
            editor.elements.hs_requirement.required = !editor.elements.hs_requirement.disabled;
        };
        editor.elements.decision.onchange = editor.elements.add_to_transcript.onchange = update;
        update();
        const result = node('div');
        if (!settings.credit_policy?.trim()) result.append(node('p', 'Record the adopted credit policy in Office settings before awarding units.', 'ms-muted'));
        result.append(editor);
        return result;
    }

    function resultCard(course, year, result) {
        const entry = node('div', '', 'ms-result');
        entry.id = 'ms-result-' + result.id;
        entry.append(node('h4', result.mark + ' · ' + result.period), node('p', excerpt(result), 'ms-meta'),
            node('p', result.verification === 'verified' ? 'Verified' : 'Awaiting verification'));
        if (result.verification === 'pending' && result.published) {
            entry.append(node('p', 'Currently visible to family: ' + result.published.mark, 'ms-muted'));
        }
        if (result.next_step) entry.append(node('p', 'Proposed next step: ' + result.next_step, 'ms-text'));
        if (/^https?:\/\//i.test(result.evidence_url || '')) {
            const link = node('a', 'Supporting evidence (staff only)');
            link.href = result.evidence_url;
            link.rel = 'noopener noreferrer';
            link.target = '_blank';
            entry.append(link);
        }
        if (result.gradebook_enrollment_id) entry.append(node('p', 'Source · Finalized Gradebook result', 'ms-meta'));
        if (result.math_codes?.length) entry.append(node('p', 'Standards addressed · ' + result.math_codes.join(', '), 'ms-meta'));
        entry.append(editor('Edit result', resultForm(course, year, result)));
        if (office && result.verification === 'pending') {
            entry.append(editor('Review and publish', form([
                field('share_next_step', 'Publish this next step to the family', false,
                    { type: 'checkbox', disabled: !result.next_step }),
            ], 'Verify result', values => save('verify', { ...values, id: result.id, version: result.version }, 'Result verified.'))));
        }
        return entry;
    }

    function requestList(parent, requests) {
        if (!requests.length) return;
        const list = node('ul', '', 'ms-office-list');
        for (const request of requests) {
            const item = node('li');
            const actions = node('div', '', 'ms-actions');
            if (['requested', 'in_review'].includes(request.status)) {
                if (request.status === 'requested') actions.append(button('Mark in review',
                    () => save('request-update', { id: request.id, status: 'in_review' }, 'Request is in review.')));
                actions.append(button('Decline', async () => {
                    if (window.confirm('Decline this transcript request?')) {
                        await save('request-update', { id: request.id, status: 'declined' }, 'Request declined.');
                    }
                }));
            }
            item.append(node('span', `${date(request.requested_at)} · ${requestStatuses[request.status]}`), actions);
            list.append(item);
        }
        parent.append(list);
    }

    function transcriptPreview(snapshot) {
        const preview = node('article', '', 'ms-preview');
        preview.append(node('p', 'Unofficial preview', 'ms-unofficial'), node('h3', snapshot.document_title || 'Middle School Transcript'),
            node('p', snapshot.issuer + ' · ' + snapshot.contact), node('strong', snapshot.legal_name),
            node('p', 'Issue date ' + date(snapshot.issued_on)));
        const awarded = new Set();
        for (const year of snapshot.years) {
            preview.append(node('h4', year.year + ' · ' + gradeLabel(year.grade)));
            const dates = [year.entered_on && 'Entered ' + date(year.entered_on),
                year.withdrawn_on && 'Withdrawn ' + date(year.withdrawn_on), year.progression].filter(Boolean);
            if (dates.length) preview.append(node('p', dates.join(' · '), 'ms-meta'));
            const list = node('ul');
            for (const item of snapshot.results.filter(res => res.year_id === year.id)) {
                const credit = awarded.has(item.course_id) ? '' : creditLabel(item);
                if (item.credit_decision === 'awarded') awarded.add(item.course_id);
                list.append(node('li', [item.title, 'Instructional level ' + item.instructional_level, courseWindow(item), excerpt(item), item.mark,
                    credit].filter(Boolean).join(' · ')));
            }
            if (list.children.length) preview.append(list);
        }
        preview.append(node('h4', 'Grading and credit key'), node('p', snapshot.grading_key, 'ms-text'),
            node('p', 'Ordinary middle school coursework carries no high-school units. Pending decisions carry no units.'),
            node('h4', 'Office certification'), node('p', snapshot.signer + ' · ' + snapshot.signer_title));
        return preview;
    }

    function transcriptTools(record, student, settings) {
        const box = panel('Official transcripts');
        requestList(box, record.requests);
        transcriptList(box, record.transcripts);
        const verified = record.results.filter(result => result.published);
        if (!verified.length) {
            box.append(node('p', 'Verify at least one result before preparing a transcript.'));
            return box;
        }
        if (!settings.school_contact?.trim() || !settings.grading_key?.trim()) {
            box.append(node('p', 'Save the school contact and adopted grading key in Office settings before issuing a transcript.'));
        }
        const choice = { '': 'No family request' };
        for (const request of record.requests.filter(request => ['requested', 'in_review'].includes(request.status))) {
            choice[request.id] = date(request.requested_at) + ' · ' + requestStatuses[request.status];
        }
        const selected = node('fieldset');
        selected.append(node('legend', 'Verified results to include'));
        for (const result of verified) {
            const course = record.courses.find(item => item.id === result.course_id);
            const row = field('result_' + result.id,
                [course.title, result.published.period, result.published.mark, result.published.result_kind].join(' · '),
                result.published.result_kind !== 'term', { type: 'checkbox' });
            selected.append(row);
        }
        const previewBox = node('div');
        const prepare = form([
            field('legal_name', 'Confirmed student legal name', record.years.find(year => year.legal_name)?.legal_name ||
                [student.first_name, student.last_name].join(' '), { required: true, max: 240 }),
            field('signer', 'Authorized signer', '', { required: true, max: 120 }),
            field('signer_title', 'Signer title', '', { required: true, max: 120 }),
            field('request_id', 'Family transcript request', '', { choices: choice }),
            selected,
        ], 'Preview transcript', async values => {
            const results = verified.filter(result => values['result_' + result.id]).map(result => result.id);
            const payload = { student_id: student.id, legal_name: values.legal_name, signer: values.signer,
                signer_title: values.signer_title, request_id: values.request_id, results };
            const { snapshot, revision } = await call('preview', payload);
            const approve = form([
                field('certify', 'I certify this transcript as the authorized school signer.', false, { type: 'checkbox', required: true }),
                field('release', 'Release the certified PDF to the linked family', Boolean(payload.request_id), { type: 'checkbox' }),
            ], 'Issue certified PDF', async values => {
                if (!window.confirm('Issue this dated PDF and retain it as a permanent transcript version?')) return;
                const bytes = await createMiddleSchoolTranscriptPdf(snapshot);
                const chunks = [];
                for (let start = 0; start < bytes.length; start += 8192) {
                    chunks.push(String.fromCharCode(...bytes.subarray(start, start + 8192)));
                }
                const issued = await call('issue', { ...payload, ...values, revision, pdf: btoa(chunks.join('')) });
                await render();
                setPortalMessage(status, 'Certified transcript issued.', 'success');
                await downloadTranscript(issued.id);
            });
            previewBox.replaceChildren(transcriptPreview(snapshot), approve);
        });
        prepare.oninput = () => previewBox.replaceChildren();
        box.append(editor('Prepare a transcript', prepare), previewBox);
        return box;
    }

    function staffRecord(record, student, settings) {
        const page = node('div');
        if (office) {
            const enrollment = group(page, 'Enrollment');
            for (const year of record.years) {
                enrollment.append(editor(`Edit ${year.school_year} · ${gradeLabel(year.enrolled_grade)}`, yearForm(student, record, year)));
            }
            enrollment.append(editor('Add enrollment year', yearForm(student, record)));
        }
        if (!record.years.length) group(page, 'Courses and results', 'No K–8 enrollment is on file for this student.');
        for (const year of record.years) {
            const section = group(page, `${year.school_year} · ${gradeLabel(year.enrolled_grade)}`,
                year.withdrawn_on ? 'Withdrawn ' + date(year.withdrawn_on) : '');
            section.append(editor('Add course', courseForm(year)));
            const courses = record.courses.filter(course => course.year_id === year.id);
            const grid = node('div', '', 'ms-course-grid');
            for (const course of courses) {
                const card = courseCard(course);
                if (course.math_codes?.length) card.append(node('p', 'Planned math standards · ' + course.math_codes.join(', '), 'ms-meta'));
                if (office || !course.credit_decided_at) card.append(editor('Edit course', courseForm(year, course)));
                for (const result of record.results.filter(result => result.course_id === course.id)) {
                    card.append(resultCard(course, year, result));
                }
                card.append(editor('Enter a result', resultForm(course, year)));
                const expectedGrade = Number(year.enrolled_grade) === 0 ? 'K' : String(year.enrolled_grade);
                const sourceGrades = record.gradebook_finals.filter(final => final.grade === expectedGrade
                    && !record.results.some(result => result.gradebook_enrollment_id === final.id && result.course_id !== course.id));
                if (sourceGrades.length) {
                    const choices = Object.fromEntries([['', 'Select a finalized result'], ...sourceGrades.map(final =>
                        [final.id, [final.title, final.term, final.mark, date(final.finalized_at)].filter(Boolean).join(' · ')])]);
                    card.append(editor('Use a finalized Gradebook result', form([
                        field('id', 'Confirmed Gradebook course and term', '', { required: true, choices }),
                    ], 'Import for verification', values => save('gradebook-import',
                        { ...values, course_id: course.id }, 'Gradebook result linked. Any new or changed result awaits verification.'))));
                }
                if (office && course.high_school_level) card.append(editor('High-school credit', creditForm(course, settings)));
                grid.append(card);
            }
            section.append(grid);
        }
        if (office) page.append(transcriptTools(record, student, settings));
        return page;
    }

    function mapForm(map = {}) {
        const alignment = standardsEditor('Reusable math standards', map.math_codes, map.grade);
        return form([
            field('area', 'Subject area', map.area, { required: true, max: 100 }),
            field('title', 'Course title', map.title, { required: true, max: 180 }),
            field('grade', 'Recommended grade', map.grade, { choices: { '': 'Any grade / shared', ...enrollmentGrades } }),
            field('term', 'Suggested term', map.term, { max: 100 }),
            field('mode', 'Instruction format', map.mode || 'standalone', { choices: teachingModes }),
            field('standards_url', 'Arkansas standards or Zion curriculum map URL', map.standards_url, { type: 'url', max: 2048 }),
            field('unit_mapping', 'Shared unit mapping and instructional notes', map.unit_mapping, { type: 'textarea', wide: true, max: 5000 }),
            field('active', 'Available for staff to reuse', map.active ?? true, { type: 'checkbox' }),
            alignment.element,
        ], 'Save course mapping', values => save('map-save', {
            ...values, math_codes: alignment.selected(), id: map.id
        }, 'Course map saved.'));
    }

    function mapView() {
        const section = panel('Course map');
        if (office) section.append(editor('Add course or shared unit', mapForm()));
        for (const map of courseMap) {
            const description = node('div');
            if (map.unit_mapping) description.append(node('p', map.unit_mapping, 'ms-text'));
            if (/^https?:\/\//i.test(map.standards_url || '')) {
                const link = node('a', 'Open standards or curriculum map');
                link.href = map.standards_url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                description.append(link);
            }
            if (!description.children.length && !office) description.append(node('p', 'No additional mapping notes.'));
            if (office) description.append(mapForm(map));
            section.append(editor([map.title, map.grade != null && gradeLabel(map.grade), map.term, teachingModes[map.mode],
                !map.active && 'Inactive'].filter(Boolean).join(' · '), description));
        }
        return section;
    }

    function settingsView(settings) {
        const section = panel('Office settings');
        section.append(form([
            field('school_name', 'School name', settings.school_name, { required: true, max: 180 }),
            field('school_contact', 'School contact for verification', settings.school_contact, { max: 500 }),
            field('current_school_year', 'Current school year override (YYYY-YYYY)', settings.current_school_year,
                { pattern: '[0-9]{4}-[0-9]{4}' }),
            field('grading_key', 'Adopted grading key', settings.grading_key, { type: 'textarea', wide: true, max: 3000 }),
            field('credit_policy', 'Adopted high-school credit policy or reference', settings.credit_policy, { type: 'textarea', wide: true, max: 3000 }),
        ], 'Save office settings', values => save('settings-save', values, 'Office settings saved.')));
        return section;
    }

    function queueView(data) {
        const page = node('div');
        const sections = [
            ['Results awaiting verification', data.pending_results, item => item.title + ' · ' + item.period],
            ['Open transcript requests', data.requests, item => requestStatuses[item.status] + ' · ' + date(item.requested_at)],
        ];
        for (const [title, items, describe] of sections) {
            const section = group(page, title);
            if (!items.length) section.append(node('p', 'Nothing is waiting.'));
            const list = node('ul', '', 'ms-office-list');
            for (const item of items) {
                const entry = node('li');
                entry.append(node('span', [item.first_name, item.last_name, '·', describe(item)].join(' ')),
                    button('Open student record', async () => {
                        studentInput.value = item.student_id;
                        activeView = 'record';
                        await render();
                        document.getElementById('ms-result-' + item.id)?.scrollIntoView({ block: 'center' });
                    }));
                list.append(entry);
            }
            section.append(list);
        }
        const archive = group(page, 'Certified transcript archive');
        if (!data.issued.length) archive.append(node('p', 'No transcripts have been issued.'));
        transcriptList(archive, data.issued);
        return page;
    }

    async function render() {
        const version = ++renderVersion;
        content.replaceChildren();
        const studentView = family || activeView === 'record';
        byId('selector').hidden = !studentView;
        for (const tab of byId('tabs').querySelectorAll('button')) {
            tab.setAttribute('aria-pressed', String(tab.dataset.view === activeView));
        }
        setPortalMessage(status, 'Loading…');
        try {
            const student = selectableStudent();
            let body;
            if (studentView && student) {
                const [record, maps, settings] = await Promise.all([
                    call('record', { student_id: student.id }),
                    family ? [] : call('map'),
                    office ? call('settings') : {},
                ]);
                if (version !== renderVersion) return;
                courseMap = maps;
                body = family ? familyRecord(record, student) : staffRecord(record, student, settings);
            } else if (studentView) {
                body = panel('Middle school records');
                body.append(node('p', family ? 'No eligible students are linked to this account yet.' : 'No eligible students are on your roster.'));
            } else if (activeView === 'map') {
                const result = await call('map');
                if (version !== renderVersion) return;
                courseMap = result;
                body = mapView();
            } else {
                const data = await call(activeView === 'queue' ? 'office' : 'settings');
                if (version !== renderVersion) return;
                body = activeView === 'queue' ? queueView(data) : settingsView(data);
            }
            if (version !== renderVersion) return;
            content.replaceChildren(body);
            setPortalMessage(status, '');
        } catch (error) {
            if (version === renderVersion) fail(error, status);
        }
    }

    document.addEventListener('DOMContentLoaded', async () => {
        const profile = await getPortalProfile(await getPortalSession());
        family = document.body.dataset.middleSchoolView === 'family';
        office = isAdminPortalProfile(profile) && !family;
        if (!canOpenPortalPage(family ? 'family' : 'gradebook', profile)) return;
        activeView = family ? 'year' : 'record';
        const views = family ? [['year', 'This Year'], ['history', 'K–8 Record']] :
            [['record', 'Student records'], ...(office ? [['queue', 'Review queue']] : []), ['map', 'Course map'],
                ...(office ? [['settings', 'Office settings']] : [])];
        byId('tabs').replaceChildren(...views.map(([key, label]) => {
            const tab = button(label, () => {
                activeView = key;
                return render();
            });
            tab.dataset.view = key;
            return tab;
        }));
        byId('tabs').hidden = false;
        try {
            [roster, standardsCatalog] = await Promise.all([
                call('roster'), family ? null : loadMathStandardsCatalog()
            ]);
            studentInput.replaceChildren(...roster.map(student => {
                const option = node('option', normalizeStudentName(student));
                option.value = student.id;
                return option;
            }));
            studentInput.disabled = !roster.length;
            studentInput.onchange = render;
            await render();
        } catch (error) {
            fail(error, status);
        }
    });
})();
