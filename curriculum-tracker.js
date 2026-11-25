(() => {
    const byId = id => document.getElementById('ct-' + id);
    const content = byId('content');
    const status = byId('status');
    const selectors = byId('selectors');
    const family = document.body.dataset.curriculumView === 'family';
    const labels = { ELA: 'English Language Arts', Math: 'Mathematics', books: 'Books', online: 'Online',
        both: 'Books and online', other: 'Other', candidate: 'Candidate link', partial: 'Partial link',
        search: 'Search lead', supplement: 'Documented supplement', checkpoint: 'Separate checkpoint',
        needed: 'Evidence needed', unreviewed: 'Unreviewed' };
    let office = false;
    let roster = [], catalogs = [], periods = [];
    let student, yearId, periodId, studyId, subject, tab = 'checklist', workspace = 'student';
    let reviewSubject, reviewGrade = '0', reviewStandard, reviewCatalog;
    let schoolYears = [], termNames = [];
    let reviewYear;
    const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    let version = 0;
    const openUnits = new Set();
    let fieldSequence = 0;
    const gradeLabel = value => Number(value) === 0 ? 'Kindergarten' : 'Grade ' + value;
    const label = value => labels[value] || value;
    const option = (value, text) => [value, text];
    const catalogTitle = c => c.title + ' · Level ' + c.level + ' · ' + c.edition;

    function node(tag, text, className) {
        const value = document.createElement(tag);
        if (text != null && text !== '') value.textContent = text;
        if (className) value.className = className;
        return value;
    }

    function panel(title, note) {
        const section = node('section', '', 'ms-panel');
        section.append(node('h2', title));
        if (note) section.append(node('p', note, 'ms-muted'));
        return section;
    }

    async function call(action, data = {}) {
        const { data: response, error } = await portalClient.rpc('curriculum_tracker', { p_action: action, p_data: data });
        if (error) throw error;
        return response;
    }

    function announce(message = '', error = false) {
        setPortalMessage(status, message, error ? 'error' : '');
    }

    function errorMessage(error) {
        return error?.code === '42501' ? 'This record is unavailable to your account.'
            : error?.message || 'The request could not be completed.';
    }

    async function run(control, task) {
        if (control.disabled) return;
        control.disabled = true;
        announce();
        try { await task(); }
        catch (error) { announce(errorMessage(error), true); }
        finally { control.disabled = false; }
    }

    function button(title, action) {
        const control = node('button', title);
        control.type = 'button';
        control.addEventListener('click', () => run(control, action));
        return control;
    }

    function link(title, url) {
        const anchor = node('a', title);
        anchor.href = url;
        if (/^https?:\/\//i.test(url)) {
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
        }
        return anchor;
    }

    function details(title, ...children) {
        const detail = node('details');
        detail.append(node('summary', title), ...children);
        return detail;
    }

    function select(name, choices, value, change) {
        const input = node('select');
        input.name = name;
        input.required = true;
        for (const [key, caption] of choices) {
            const item = node('option', caption);
            item.value = key;
            input.append(item);
        }
        if (value != null && choices.some(([key]) => String(key) === String(value))) input.value = value;
        if (change) input.addEventListener('change', () => change(input.value));
        return input;
    }

    function field(title, input) {
        const wrapper = node('label');
        const caption = node('span', title);
        caption.id = 'ct-field-' + ++fieldSequence;
        input.setAttribute('aria-labelledby', caption.id);
        wrapper.append(caption, input);
        return wrapper;
    }

    function input(name, value = '', options = {}) {
        const control = node(options.long ? 'textarea' : 'input');
        control.name = name;
        if (options.long) control.rows = 3;
        else control.type = options.type || 'text';
        control.value = value;
        if (options.max) control.maxLength = options.max;
        control.required = !!options.required;
        if (options.placeholder) control.placeholder = options.placeholder;
        return control;
    }

    function check(name, title, checked = false) {
        const wrapper = node('label', '', 'ms-check');
        const control = node('input');
        control.type = 'checkbox';
        control.name = name;
        control.checked = checked;
        wrapper.append(control, node('span', title));
        return wrapper;
    }

    function form(fields, caption, task) {
        const form = node('form', '', 'ms-form ct-form');
        const grid = node('div', '', 'ms-fields');
        grid.append(...fields);
        const submit = node('button', caption);
        submit.type = 'submit';
        form.append(grid, submit);
        form.addEventListener('submit', event => {
            event.preventDefault();
            run(submit, () => task(Object.fromEntries(new FormData(form)), form));
        });
        return form;
    }

    function list(entries) {
        const ul = node('ul', '', 'ct-list');
        for (const entry of entries) {
            const li = node('li');
            li.append(entry);
            ul.append(li);
        }
        return ul;
    }

    function context(extra = {}) {
        return { student_id: student, year_id: yearId, period_id: periodId, ...extra };
    }

    async function save(action, values, message) {
        await call(action, values);
        await render();
        announce(message);
    }

    function tabs(active, choices, change) {
        const nav = node('nav', '', 'ms-tabs');
        nav.setAttribute('aria-label', 'Curriculum views');
        nav.append(...choices.map(([key, title]) => {
            const target = button(title, () => change(key));
            target.setAttribute('aria-pressed', String(active === key));
            return target;
        }));
        return nav;
    }

    function gradingKey(entry) {
        const key = details('Grading key');
        if (entry.scale?.length) key.append(list(entry.scale.map(mark => mark.label + ' — ' + mark.description)));
        if (entry.scale?.length) key.append(node('p', 'Not yet assessed means there is no reported proficiency mark.'));
        if (entry.grading_key) key.append(node('p', entry.grading_key, 'ms-text'));
        return key;
    }

    function recordedMark(entry, standard) {
        return entry.scale?.find(mark => mark.key === standard.mark)?.label ||
            (entry.scale ? 'Not yet assessed' : standard.demonstrated ? 'Demonstrated' : 'Taught');
    }

    function activityDay(period) {
        const date = today();
        return date < period.starts_on ? '' : date > period.ends_on ? period.ends_on : date;
    }

    function activityInput(required = true) {
        const period = periods.find(item => item.id === periodId);
        const control = input('activity_on', required ? activityDay(period) : '', { type: 'date', required });
        control.min = period.starts_on;
        control.max = activityDay(period) || period.ends_on;
        return control;
    }

    function publicationView(entry) {
        const record = node('article', '', 'ct-record');
        record.append(node('h3', entry.period + ' · ' + entry.year), node('p', gradeLabel(entry.grade), 'ms-meta'));
        if (entry.as_of) record.append(node('p', entry.purpose + ' · As of ' + entry.as_of, 'ms-meta'));
        for (const course of entry.courses) {
            const courseNode = node('div', '', 'ct-record');
            courseNode.append(node('h4', course.title), node('p', [
                'Level ' + course.level, label(course.delivery), course.status,
                course.completed + ' curriculum item' + (course.completed === 1 ? '' : 's') + ' completed through this period'
            ].join(' · '), 'ms-meta'));
            if (course.results.length) courseNode.append(list(course.results.map(result =>
                result.title + ' — ' + result.result + (result.kind === 'proficiency' ? ' (proficiency)' : ''))));
            record.append(courseNode);
        }
        if (!entry.courses.length) record.append(node('p', 'Course progress has not been recorded for this period.'));
        if (entry.accomplishment) record.append(node('h4', 'Accomplishment'), node('p', entry.accomplishment, 'ms-text'));
        if (entry.next_step) record.append(node('h4', 'Next step'), node('p', entry.next_step, 'ms-text'));
        if (entry.standards.length) {
            record.append(details('Arkansas standards summary', list(entry.standards.map(standard =>
                [standard.description || standard.code, standard.description && standard.code, gradeLabel(standard.grade),
                    recordedMark(entry, standard)].filter(Boolean).join(' · ')))));
        }
        if (entry.scale || entry.grading_key) record.append(gradingKey(entry));
        return record;
    }

    function download(bytes, fileName) {
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const anchor = node('a');
        anchor.href = url;
        anchor.download = fileName;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    async function downloadReport(id, title) {
        const report = await call('report-download', { student_id: student, id });
        const bytes = Uint8Array.from(atob(report.pdf), character => character.charCodeAt(0));
        download(bytes, title.toLowerCase().replaceAll(' ', '-') + '-' + id.slice(0, 8) + '.pdf');
    }

    function reportList(reports) {
        const section = panel('Issued records', !reports.length ? 'No records have been shared here yet.' : '');
        for (const report of reports) {
            const row = node('div', '', 'ct-record ms-actions');
            const caption = report.title + ' · ' + new Date(report.issued_at).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
            row.append(node('span', caption + (office && !report.released ? ' · Office copy' : '')),
                button('Download PDF', () => downloadReport(report.id, report.title)));
            section.append(row);
        }
        return section;
    }

    function publicView(data) {
        const view = document.createDocumentFragment();
        const published = panel('Published progress', !data.publications.length
            ? 'There is no published curriculum progress for this student yet.' : '');
        published.append(...data.publications.map(publicationView));
        view.append(published, reportList(data.reports));
        return view;
    }

    function coursePanel(year, period, studies) {
        const section = panel('Course of study');
        const available = catalogs.filter(catalog => catalog.subject === subject);
        const ranked = [...available].sort((a, b) =>
            Number(b.suggested_grades.includes(year.enrolled_grade)) - Number(a.suggested_grades.includes(year.enrolled_grade)));
        const eligible = studies.filter(study => study.subject === subject && study.starts_on <= period.starts_on &&
            (!study.ends_on || study.ends_on >= period.ends_on));
        const chosen = eligible.find(study => study.id === studyId) || eligible.find(study => !study.ends_in) || eligible[0];
        studyId = chosen?.id;
        if (eligible.length > 1) {
            section.append(field('Course checklist', select('study', eligible.map(study => option(study.id,
                catalogTitle(catalogs.find(catalog => catalog.key === study.catalog_key)) + (study.ends_in ? ' · Earlier course' : ''))),
            studyId, value => { studyId = value; openUnits.clear(); render(); })));
        } else if (chosen) {
            section.append(node('p', catalogTitle(catalogs.find(catalog => catalog.key === chosen.catalog_key)) +
                ' · ' + label(chosen.delivery)));
        } else {
            section.append(node('p', 'Choose a curriculum level for this subject.'));
        }
        if (ranked.length) {
            section.append(details(chosen ? 'Change curriculum or delivery' : 'Select curriculum', form([
                field('Curriculum level and edition', select('catalog_key', ranked.map(catalog => option(catalog.key,
                    catalogTitle(catalog) + (catalog.suggested_grades.includes(year.enrolled_grade) ? ' · Suggested' : ''))), chosen?.catalog_key)),
                field('Delivery format', select('delivery', ['books','online','both','other'].map(value => option(value, label(value))),
                    chosen?.delivery || 'books'))
            ], 'Save course of study', async values => {
                studyId = await call('study-start', context(values));
                openUnits.clear();
                await render();
                announce('Course of study saved.');
            })));
        }
        return { section, chosen };
    }

    function checklistView(checklist, study, period, record) {
        const catalog = catalogs.find(item => item.key === study.catalog_key);
        const panelNode = panel('Lesson checklist', catalog.inventory_complete ? '' :
            'This is a partial checklist from the crosswalk. Use the edition on your materials and confirm the inventory with the office.');
        if (/^https?:\/\//i.test(catalog.source)) panelNode.append(link('Curriculum source', catalog.source));
        if (!checklist.items.length) {
            panelNode.append(node('p', 'The office can import the inventory for this edition.'));
            return panelNode;
        }
        const units = new Map();
        const work = new Map(record.work.filter(item => item.study_id === study.id && item.period_id === period.id)
            .map(item => [item.item_key, item]));
        const prior = new Set(record.work.filter(item => item.study_id === study.id && item.period_id !== period.id && item.completed)
            .map(item => item.item_key));
        const area = node('div', '', 'ct-units');
        for (const lesson of checklist.items) {
            if (!units.has(lesson.unit)) units.set(lesson.unit, []);
            units.get(lesson.unit).push(lesson);
        }
        for (const [unit, items] of units) {
            const count = items.filter(item => work.get(item.key)?.completed || prior.has(item.key)).length;
            const unitNode = details(unit + ' · ' + count + ' of ' + items.length + ' complete');
            unitNode.open = openUnits.has(unit) || (!openUnits.size && unit === units.keys().next().value);
            unitNode.addEventListener('toggle', () => unitNode.open ? openUnits.add(unit) : openUnits.delete(unit));
            for (const lesson of items) {
                const entry = work.get(lesson.key);
                const row = node('form', '', 'ct-row');
                const main = node('div');
                main.append(check('completed', lesson.title, !!entry?.completed));
                const references = [study.delivery !== 'online' && lesson.page_ref,
                    study.delivery !== 'books' && lesson.online_ref && 'Online: ' + lesson.online_ref,
                    prior.has(lesson.key) && 'Completed in an earlier period'].filter(Boolean);
                if (references.length) main.append(node('small', references.join(' · '), 'ct-item-source'));
                const mark = input('result', entry?.result || '', { max: 100 });
                const date = activityInput(false);
                const submit = node('button', 'Save');
                submit.type = 'submit';
                submit.setAttribute('aria-label', 'Save ' + lesson.title);
                row.append(main, field('Optional assignment score', mark), submit);
                row.append(details('Set activity date', field('Activity date', date)));
                let gradebook;
                if (entry?.gradebook_assignment_id) main.append(node('small', 'Gradebook result', 'ct-item-source'));
                if (checklist.gradebook_scores.length) {
                    const credit = details('Use a Gradebook score');
                    credit.className = 'ms-wide';
                    credit.addEventListener('toggle', () => {
                        if (!credit.open || gradebook) return;
                        gradebook = select('gradebook_assignment_id', [['','Choose an existing score'],
                            ...checklist.gradebook_scores.map(item => option(item.id, item.course + ' · ' + item.title + ' · ' + item.result))]);
                        gradebook.required = false;
                        gradebook.addEventListener('change', () => {
                            mark.disabled = !!gradebook.value;
                        });
                        credit.append(field('Existing Gradebook score', gradebook));
                    });
                    row.append(credit);
                }
                const checkpoints = checklist.checkpoints.filter(mapping => mapping.item_key === lesson.key);
                const checkpointInputs = new Map();
                if (checkpoints.length) {
                    const verify = details('Verify checkpoint evidence');
                    verify.className = 'ms-wide';
                    for (const mapping of checkpoints) {
                        const existing = record.evidence.find(item => item.work_id === entry?.id && item.mapping_id === mapping.id);
                        const caption = mapping.code + ' · ' + mapping.label;
                        const line = node('div', '', 'ct-record');
                        line.append(node('p', caption), node('p', mapping.rationale, 'ms-meta'));
                        if (existing) {
                            line.append(node('p', 'Verified ' + new Date(existing.verified_at).toLocaleDateString()),
                                button('Remove evidence', () => save('evidence-remove', context({ id: existing.id }), 'Checkpoint evidence removed.')));
                        } else {
                            const evidence = input('checkpoint-' + mapping.id, '', { max: 2000, long: true });
                            line.append(field('Evidence you verified for ' + caption, evidence));
                            const independent = check('independent-' + mapping.id, 'Independently demonstrated this component');
                            line.append(independent);
                            checkpointInputs.set(mapping.id, { evidence, independent: independent.querySelector('input') });
                        }
                        verify.append(line);
                    }
                    row.append(verify);
                }
                row.addEventListener('submit', event => {
                    event.preventDefault();
                    run(submit, () => save('work-save', context({
                        study_id: study.id, item_key: lesson.key, completed: row.elements.completed.checked,
                        result: mark.value, activity_on: date.value, gradebook_assignment_id: gradebook?.value, checkpoints: [...checkpointInputs]
                            .filter(([, item]) => item.evidence.value.trim())
                            .map(([mapping_id, item]) => ({ mapping_id, description: item.evidence.value, independent: item.independent.checked }))
                    }), 'Lesson saved.'));
                });
                unitNode.append(row);
            }
            area.append(unitNode);
        }
        panelNode.append(area);
        return panelNode;
    }

    function evidenceForm(standard, supplement) {
        const types = [['observation','Observation'],['work_sample','Work sample']];
        return form([
            field('Verified component', select('component_key', standard.components.map(component => option(component.key, component.label)))),
            ...(!supplement ? [field('Evidence type', select('kind', types))] : []),
            field('What did you observe?', input('description', '', { long: true, max: 2000, required: true })),
            field('Private work sample link', input('source_url', '', { type: 'url' })),
            field('Evidence date', activityInput()),
            check('independent', 'Independently demonstrated this component')
        ], 'Verify evidence', values => save('evidence-save', context({ ...values, independent: values.independent === 'on', standard_key: standard.key,
            ...(supplement && { supplement_id: supplement.id, kind: 'supplement' }) }), 'Evidence verified.'));
    }

    function supplementForm(standard, template) {
        return form([
            field('Activity title', input('title', template ? label(template.disposition) + ' for ' + standard.code : '',
                { required: true, max: 180 })),
            field('Staff instructions', input('instructions', template?.evidence_needed || '', { long: true, max: 2000 }))
        ], 'Assign supplemental activity', values => save('supplement-save', context({ ...values, standard_key: standard.key,
            ...(template && { source_review: template.key }) }), 'Supplement assigned.'));
    }

    function standardDetail(standard, record) {
        const element = details(standard.code + (standard.description ? ' · ' + standard.description : ''));
        const summary = [
            standard.mapped ? 'Approved curriculum match' : standard.has_mapped_parts ? 'Approved match for some components' : 'No approved curriculum match yet',
            standard.taught ? 'Taught' : 'Teaching evidence incomplete',
            recordedMark(record, standard)
        ];
        for (const item of summary) element.append(node('span', item, 'ct-metric'));
        if (/^https?:\/\//i.test(standard.source)) {
            const reference = node('p');
            reference.append(link('Arkansas standards · ' + standard.edition, standard.source));
            element.append(reference);
        }
        if (standard.components.length) element.append(list(standard.components.map(component =>
            component.label + ' · ' + (component.demonstrated ? 'Demonstrated' : 'Evidence still needed') +
            (component.taught ? ' · Taught' : ''))));
        const verified = record.evidence.filter(item => item.standard_key === standard.key);
        for (const entry of verified) {
            const component = standard.components.find(item => item.key === entry.component_key);
            const row = node('div', '', 'ct-record');
            row.append(node('p', (component?.label || entry.component_key) + ' — ' + entry.description, 'ms-text'));
            if (entry.source_url) row.append(link('Private evidence link', entry.source_url));
            if (entry.period_id === periodId) {
                row.append(button('Remove evidence', () => save('evidence-remove', context({ id: entry.id }), 'Evidence removed.')));
            }
            element.append(row);
        }
        const marks = [['','Not yet assessed'], ...record.scale.map(mark => option(mark.key, mark.label))];
        const mark = select('mark', marks, standard.mark);
        mark.required = false;
        const extension = field('Complex or unfamiliar application the student demonstrated',
            input('extension_note', '', { long: true, max: 2000 }));
        const toggleExtension = () => {
            extension.hidden = mark.value !== 'extends';
            extension.querySelector('textarea').required = !extension.hidden;
        };
        mark.addEventListener('change', toggleExtension);
        toggleExtension();
        element.append(details('Record direct evidence', evidenceForm(standard)),
            details('Record a standards mark', form([
                field('Proficiency mark', mark), field('Assessment date', activityInput()), extension
            ], 'Save standards mark', values => save('mark-save', context({ ...values, standard_key: standard.key }),
                'Standards mark saved.'))),
            details('Assign an additional activity', supplementForm(standard)));
        for (const source of record.supplement_templates.filter(template => template.standard_key === standard.key)) {
            element.append(details(label(source.disposition) + ' · ' + source.source, supplementForm(standard, source)));
        }
        return element;
    }

    async function standardBankChooser(wrapper) {
        const subjects = [...new Set(catalogs.map(catalog => catalog.subject))];
        const selection = select('evidence_subject', subjects.map(item => option(item, label(item))), subject);
        const gradeSelector = select('evidence_grade', Array.from({ length: 13 }, (_, index) => option(index, gradeLabel(index))), 4);
        const target = node('div');
        const filters = node('div', '', 'ms-fields');
        filters.append(field('Subject', selection), field('Standard grade', gradeSelector));
        wrapper.append(filters, target);
        let searchVersion = 0;
        const refresh = async () => {
            const request = ++searchVersion;
            const data = await call('review', { subject: selection.value, grade: gradeSelector.value });
            if (request !== searchVersion) return;
            target.replaceChildren();
            if (!data.standards.length) {
                target.append(node('p', 'No standards are configured for this subject and grade.'));
                return;
            }
            const standardChoice = select('evidence_standard', data.standards.map(item => option(item.key, item.code)));
            const formSlot = node('div');
            const show = () => formSlot.replaceChildren(evidenceForm(data.standards.find(item => item.key === standardChoice.value)));
            standardChoice.addEventListener('change', show);
            target.append(field('Arkansas standard', standardChoice), formSlot);
            show();
        };
        for (const control of [selection, gradeSelector]) {
            control.addEventListener('change', () => refresh().catch(error => announce(errorMessage(error), true)));
        }
        await refresh();
    }

    function standardsView(year, record) {
        const output = document.createDocumentFragment();
        const sameGrade = record.standards.filter(item => item.subject === subject && item.grade === year.enrolled_grade);
        const open = sameGrade.filter(item => !['meets','extends'].includes(item.mark));
        const priority = [...open].sort((a, b) =>
            Number(b.components.some(part => part.demonstrated || part.taught)) -
            Number(a.components.some(part => part.demonstrated || part.taught)));
        const section = panel('Needs attention · ' + gradeLabel(year.enrolled_grade), sameGrade.length ?
            (open.length + ' of ' + sameGrade.length + ' expectations are awaiting a Meets or Extends mark.') :
            'No standards are configured for this subject and enrolled grade.');
        section.append(gradingKey(record));
        section.append(...priority.slice(0, 5).map(item => standardDetail(item, record)));
        if (sameGrade.length > 5 || sameGrade.length > open.length) {
            section.append(details('All ' + gradeLabel(year.enrolled_grade) + ' expectations',
                ...sameGrade.map(item => standardDetail(item, record))));
        }
        const other = record.standards.filter(item => item.subject === subject && item.grade !== year.enrolled_grade);
        if (other.length) section.append(details('Progress at other grade levels', ...other.map(item => standardDetail(item, record))));
        const outside = details('Record evidence for a different grade');
        outside.addEventListener('toggle', () => {
            if (outside.open && outside.childElementCount === 1) {
                standardBankChooser(outside).catch(error => announce(errorMessage(error), true));
            }
        });
        section.append(outside);
        output.append(section);

        const supplements = record.supplements.filter(item => record.standards.some(standard =>
            standard.key === item.standard_key && standard.subject === subject));
        const activities = panel('Supplemental activities', !supplements.length ? 'No activities are assigned for this subject.' : '');
        for (const activity of supplements) {
            const standard = record.standards.find(item => item.key === activity.standard_key);
            const row = node('div', '', 'ct-record');
            row.append(node('h3', activity.title), node('p', [standard.code, activity.completed ? 'Complete' : 'Assigned',
                periods.find(period => period.id === activity.period_id)?.name].filter(Boolean).join(' · '), 'ms-meta'));
            if (activity.instructions) row.append(node('p', activity.instructions, 'ms-text'));
            if (activity.period_id === periodId) {
                row.append(button(activity.completed ? 'Undo completion' : 'Mark complete', () => save('supplement-complete',
                    context({ id: activity.id, completed: !activity.completed }), 'Supplement updated.')));
                if (activity.completed) row.append(details('Verify supplemental evidence', evidenceForm(standard, activity)));
            }
            activities.append(row);
        }
        output.append(activities);
        return output;
    }

    function officeView(record, period, published) {
        const output = document.createDocumentFragment();
        const candidates = record.work.filter(item => item.period_id === period.id && item.result != null);
        const resultBox = () => {
            const box = node('fieldset', '', 'ms-wide');
            box.append(node('legend', 'Assignment scores verified for sharing'), ...(candidates.length
                ? candidates.map(item => check('result:' + item.id, item.title + ' — ' + item.result))
                : [node('p', 'There are no scores recorded for this period.')]));
            return box;
        };
        const resultIds = values => Object.keys(values).filter(key => key.startsWith('result:')).map(key => key.slice(7));
        const notes = () => [
            field('Accomplishment to share', input('accomplishment', '', { long: true, max: 2000 })),
            field('Next step to share', input('next_step', '', { long: true, max: 2000 }))
        ];
        const closed = today() >= period.ends_on;
        const previewSection = panel('Preview and publish family progress', closed ?
            'Review the period-end results before sharing them.' :
            'This period closes on ' + period.ends_on + '. You can issue an interim report before then.');
        const preview = node('div');
        if (closed) previewSection.append(form([resultBox(), ...notes(),
            check('include_standards', 'Include standards marks', true)
        ], 'Preview family record', async values => {
            const data = context({ ...values, include_standards: values.include_standards === 'on', result_ids: resultIds(values) });
            const snapshot = await call('publish-preview', data);
            const area = node('div', '', 'ms-preview');
            area.append(publicationView(snapshot), button('Publish this record', () =>
                save('publish', { ...data, preview: snapshot }, 'Family progress published.')));
            preview.replaceChildren(area);
        }), preview);
        const reportSection = panel('Issue a printable record', 'Use the published period-end results or prepare an interim report as of a specific date.');
        const kind = select('kind', [['progress','Elementary progress record'],['transfer','Elementary transfer record'],
            ['interim_council','Interim · Parent Partnership Council'],['interim_transfer','Interim · Midyear transfer']],
            closed ? 'progress' : 'interim_council');
        const asOf = input('as_of', activityDay(period), { type: 'date' });
        asOf.min = period.starts_on;
        asOf.max = activityDay(period) || period.ends_on;
        const interim = node('div', '', 'ms-fields ms-wide');
        interim.append(field('As-of date', asOf), ...notes(), resultBox());
        const updateType = () => {
            const isInterim = kind.value.startsWith('interim');
            interim.hidden = !isInterim;
            asOf.required = isInterim;
        };
        kind.addEventListener('change', updateType);
        updateType();
        const reportArea = node('div');
        reportSection.append(form([
            field('Record type', kind), interim,
            field('Office signer', input('signer', '', { required: true, max: 180 })),
            check('include_standards', 'Include the standards appendix', true),
            check('release', 'Share the issued PDF with the family')
        ], 'Preview report', async values => {
            const data = context({ ...values, result_ids: resultIds(values), include_standards: values.include_standards === 'on', release: values.release === 'on' });
            const snapshot = await call('report-preview', data);
            const area = node('div', '', 'ms-preview');
            area.append(node('h3', snapshot.document_title), node('p', snapshot.legal_name + ' · Issued ' + snapshot.issued_on),
                ...snapshot.publications.map(publicationView),
                button('Download preview PDF', async () => {
                    const bytes = await createMiddleSchoolTranscriptPdf({ ...snapshot, preview: true });
                    download(bytes, 'elementary-record-preview.pdf');
                }),
                button('Issue this PDF', async () => {
                    const bytes = await createMiddleSchoolTranscriptPdf(snapshot);
                    let binary = '';
                    for (let index = 0; index < bytes.length; index += 8192) {
                        binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
                    }
                    await save('issue', { ...data, preview: snapshot, pdf: btoa(binary) }, 'PDF issued and archived.');
                }));
            reportArea.replaceChildren(area);
        }), reportArea);
        output.append(previewSection, reportSection, publicView(published));
        return output;
    }

    async function mappingFields(standard, review, catalogsForStandard) {
        const catalog = catalogs.find(c => c.key === review?.catalog_key) || catalogsForStandard[0];
        if (!catalog) return node('p', 'Import a course catalog to add a mapping.');
        const container = node('div');
        const catalogChoice = !review && select('mapping_catalog', catalogsForStandard.map(c => option(c.key, catalogTitle(c))), catalog.key);
        const slot = node('div');
        if (catalogChoice) container.append(field('Curriculum edition', catalogChoice));
        container.append(slot);
        let loadVersion = 0;
        const refresh = async () => {
            const request = ++loadVersion;
            const selected = catalogChoice?.value || catalog.key;
            const response = await call('review', { catalog_key: selected });
            if (request !== loadVersion) return;
            const selectable = response.items.filter(lesson => !review?.item_key || lesson.key === review.item_key);
            if (!selectable.length) {
                slot.replaceChildren(node('p', 'Import the matching lesson inventory to link a specific item.'));
                return;
            }
            slot.replaceChildren(form([
                field('Curriculum item', select('item_key', selectable.map(item => option(item.key, item.unit + ' · ' + item.title)), review?.item_key)),
                field('Standard component', select('component_key', standard.components.map(item => option(item.key, item.label)))),
                field('Approval', select('effect', [
                    ['taught','Approve for instruction tracking'],
                    ['checkpoint','Approve as an evidence checkpoint'],
                    ['disabled','Disable this mapping for future use']
                ])),
                field('Coverage or evidence the teacher must verify', input('rationale', '', { long: true, required: true, max: 2000 }))
            ], 'Save mapping decision', values => save('mapping-save', { ...values, standard_key: standard.key,
                catalog_key: selected, review_key: review?.key, school_year: reviewYear }, 'Mapping decision saved.')));
        };
        if (catalogChoice) catalogChoice.addEventListener('change', () => refresh().catch(error => announce(errorMessage(error), true)));
        await refresh();
        return container;
    }

    async function mappingView() {
        const output = document.createDocumentFragment();
        const section = panel('Mapping review', 'Approve a specific item and component after reviewing the official expectation.');
        const configuredYears = [...new Set(periods.map(period => period.school_year))];
        if (!configuredYears.length) {
            section.append(node('p', 'Set up a reporting period before reviewing mappings for that school year.'));
            return section;
        }
        reviewYear = configuredYears.includes(reviewYear) ? reviewYear : configuredYears[0];
        const uniqueSubjects = [...new Set(catalogs.map(c => c.subject))];
        reviewSubject = uniqueSubjects.includes(reviewSubject) ? reviewSubject : uniqueSubjects[0];
        if (!reviewSubject) {
            section.append(node('p', 'Load the curriculum reference from Catalog and periods to start mapping review.'));
            return section;
        }
        const data = await call('review', { subject: reviewSubject, grade: reviewGrade });
        reviewStandard = data.standards.some(standard => standard.key === reviewStandard) ? reviewStandard : data.standards[0]?.key;
        const filters = node('div', '', 'ct-selectors');
        filters.append(field('School year', select('review_year', configuredYears.map(year => option(year, year)), reviewYear,
            value => { reviewYear = value; render(); })),
        field('Subject', select('subject', uniqueSubjects.map(item => option(item, label(item))), reviewSubject,
            value => { reviewSubject = value; reviewCatalog = ''; render(); })),
        field('Arkansas grade', select('grade', Array.from({ length: 13 }, (_, index) => option(index, gradeLabel(index))), reviewGrade,
            value => { reviewGrade = value; render(); })));
        if (data.standards.length) filters.append(field('Standard', select('standard', data.standards.map(item =>
            option(item.key, item.code)), reviewStandard, value => { reviewStandard = value; render(); })));
        section.append(filters);
        output.append(section);
        const standard = data.standards.find(item => item.key === reviewStandard);
        if (!standard) {
            section.append(node('p', 'No standards have been imported for this grade and subject.'));
            return output;
        }
        const relevant = catalogs.filter(c => c.subject === reviewSubject);
        const standardPanel = panel(standard.code);
        if (/^https?:\/\//i.test(standard.source)) standardPanel.append(link('Open official expectation · ' + standard.edition, standard.source));
        standardPanel.append(list(standard.components.map(component => component.label)));
        standardPanel.append(details('Family description', form([
            field('Plain-language description', input('family_description', standard.family_description || '', { max: 300, long: true }))
        ], 'Save description', values => save('standard-description', { standard_key: standard.key, ...values }, 'Description saved.'))));
        standardPanel.append(details('Define separate components', form([
            field('One component per line', input('labels', '', { long: true, required: true }))
        ], 'Save components', values => save('components-save', { standard_key: standard.key,
            labels: values.labels.split('\n').map(value => value.trim()).filter(Boolean) }, 'Components saved.'))));
        const manual = details('Add a reviewed mapping');
        manual.addEventListener('toggle', () => {
            if (manual.open && manual.childElementCount === 1) mappingFields(standard, null, relevant)
                .then(fields => manual.append(fields)).catch(error => announce(errorMessage(error), true));
        });
        standardPanel.append(manual);
        output.append(standardPanel);

        const { reviews } = await call('review', { standard_key: standard.key, school_year: reviewYear });
        const rows = panel('Source reviews', !reviews.length ? 'No source reviews are on file for this standard.' : '');
        rows.append(field('Filter by curriculum edition', select('review_catalog',
            [['','All source editions'], ...relevant.map(c => option(c.key, catalogTitle(c)))], reviewCatalog,
            value => { reviewCatalog = value; render(); })));
        for (const review of reviews.filter(item => !reviewCatalog || reviewCatalog === item.catalog_key)) {
            const catalog = catalogs.find(item => item.key === review.catalog_key);
            const row = details(label(review.disposition) + (review.item_title ? ' · ' + review.item_title : ''),
                node('p', catalogTitle(catalog) + ' · ' + review.source, 'ms-meta'));
            if (review.covered) row.append(node('p', review.covered, 'ms-text'));
            if (review.evidence_needed && review.evidence_needed !== review.covered) row.append(node('p', review.evidence_needed, 'ms-text'));
            const decisions = { taught: 'Approved for instruction tracking', checkpoint: 'Approved as an evidence checkpoint',
                disabled: 'Disabled for future use' };
            if (!review.revisions.length) row.append(node('p', review.disposition === 'search'
                ? 'Search lead awaiting review. Add a reviewed mapping after checking the assignment.'
                : 'Draft for ' + reviewYear, 'ms-meta'));
            for (const revision of review.revisions) {
                const description = standard.components.find(item => item.key === revision.component_key)?.label;
                row.append(node('p', description + ' · ' + decisions[revision.effect] + ' · ' + revision.rationale));
            }
            row.addEventListener('toggle', () => {
                if (row.open && !row.dataset.loaded && review.disposition !== 'search') {
                    row.dataset.loaded = 'true';
                    mappingFields(standard, review, relevant).then(fields => row.append(fields))
                        .catch(error => { delete row.dataset.loaded; announce(errorMessage(error), true); });
                }
            });
            rows.append(row);
        }
        output.append(rows);
        return output;
    }

    async function loadCatalog() {
        const data = await call('catalog');
        catalogs = data.catalogs || [];
        periods = data.periods || [];
    }

    async function referenceData() {
        return call('import-reference');
    }

    function importSummary(result) {
        return result.catalogs + ' course editions, ' + result.items + ' curriculum items, ' + result.standards +
            ' standards, and ' + result.reviews + ' review links added or updated.';
    }

    function yearPolicy(defaultYear) {
        const section = panel('Proficiency and grading by school year');
        const policies = node('div');
        section.append(form([
            field('Policy school year (YYYY-YYYY)', input('school_year', defaultYear, { required: true, max: 9 }))
        ], 'Open school-year settings', async values => {
            const policy = await call('policy', values);
            const fields = policy.scale.flatMap(mark => [
                field(mark.label + ' label', input(mark.key + '_label', mark.label, { required: true, max: 60 })),
                field(mark.label + ' description', input(mark.key + '_description', mark.description, { required: true, long: true, max: 450 }))
            ]);
            const inherited = policy.grading_key && !policy.grading_key_override
                ? node('p', 'Using the existing middle-school grading key. Add a school-year override if needed.', 'ms-meta')
                : node('p', 'Leave the assignment grading key blank to use the existing middle-school key when available.', 'ms-meta');
            policies.replaceChildren(node('h3', values.school_year), inherited, form([
                ...fields,
                field('Assignment grading key override', input('grading_key', policy.grading_key_override || '', { long: true, max: 3000 }))
            ], 'Save school-year settings', async edits => {
                await call('policy-save', { school_year: values.school_year, grading_key: edits.grading_key,
                    scale: policy.scale.map(({ key }) => ({ key, label: edits[key + '_label'], description: edits[key + '_description'] })) });
                announce('School-year settings saved.');
            }));
        }), policies);
        return section;
    }

    function setupView() {
        const output = document.createDocumentFragment();
        const periodPanel = panel('Reporting periods',
            'Use the school’s reporting dates. Periods apply across the students enrolled in that school year.');
        const grades = periods.map(period => period.school_year + ' · ' + period.name + ' · ' + period.starts_on + ' to ' + period.ends_on);
        if (grades.length) periodPanel.append(list(grades));
        const year = schoolYears.find(item => item.id === yearId)?.school_year || schoolYears[0]?.school_year || '';
        if (termNames.length) periodPanel.append(node('p', 'Gradebook terms for the selected student: ' + termNames.join(', '), 'ms-meta'));
        periodPanel.append(form([
            field('School year (YYYY-YYYY)', input('school_year', year, { required: true, max: 9 })),
            field('Period name', input('name', '', { required: true, max: 100 })),
            field('Starts on', input('starts_on', '', { required: true, type: 'date' })),
            field('Ends on', input('ends_on', '', { required: true, type: 'date' }))
        ], 'Add reporting period', async values => {
            await call('period-save', values);
            await loadCatalog();
            await render();
            announce('Reporting period added.');
        }));
        output.append(yearPolicy(year || periods[0]?.school_year || ''), periodPanel);
        const catalogPanel = panel('Curriculum catalogs and crosswalk',
            'Import course editions and inventories. Crosswalk records enter mapping review before they can affect progress.');
        if (catalogs.length) catalogPanel.append(details('View configured editions', list(catalogs.map(catalog =>
            catalogTitle(catalog) + ' · ' + (catalog.inventory_complete ? 'Inventory confirmed' : 'Inventory unconfirmed')))));
        const files = input('csv', '', { type: 'file' });
        files.accept = '.csv,.json,text/csv,application/json';
        files.multiple = true;
        const importArea = node('div');
        const fileForm = node('div', '', 'ms-form ct-form');
        fileForm.append(field('Prepared Zion package or curriculum CSV files', files),
            button('Preview import', async () => {
                if (!files.files.length) throw new Error('Select the curriculum CSV files first.');
                const parsed = await Promise.all([...files.files].map(async file => ({ name: file.name, text: await file.text() })));
                const json = parsed.find(file => file.name.toLowerCase().endsWith('.json'));
                let batch, differences;
                if (json) {
                    if (parsed.length !== 1) throw new Error('Import the prepared package by itself.');
                    batch = JSON.parse(json.text);
                    if (!['catalogs','items','standards','reviews'].every(key => Array.isArray(batch[key]))) {
                        throw new Error('Choose a prepared curriculum tracker import.');
                    }
                    differences = batch.reviews.filter(row => /PDF disposition differs|PDF and CSV refer|no exact inventory match/.test(row.source))
                        .map(row => ({ key: row.standard_key, message: row.source }));
                } else {
                    const pdfReference = await referenceData();
                    if (!pdfReference.standards.length) throw new Error('Load the prepared Zion package to start the standards bank.');
                    const reference = { ...pdfReference, catalogs };
                    ({ batch, differences } = normalizeZionCurriculumFiles(parsed, reference) || buildCurriculumImport(parsed, reference));
                }
                const box = node('div', '', 'ms-preview');
                box.append(node('h3', 'Import preview'), node('p',
                    batch.catalogs.length + ' catalog rows · ' + batch.items.length + ' inventory rows · ' +
                    batch.reviews.length + ' source review rows'));
                if (differences.length) box.append(details('Source differences to review · ' + differences.length,
                    list(differences.map(difference => difference.key + ' · ' + difference.message))));
                box.append(button('Import this batch', async () => {
                    const result = await call('import', batch);
                    await loadCatalog();
                    await render();
                    announce(importSummary(result));
                }));
                importArea.replaceChildren(box);
            }), importArea);
        catalogPanel.append(fileForm);
        output.append(catalogPanel);
        return output;
    }

    async function staffView(ticket) {
        const output = document.createDocumentFragment();
        if (workspace === 'mapping') return mappingView();
        if (workspace === 'setup') return setupView();
        if (!student) return panel('Student records', 'No eligible students are on your roster.');
        const lookup = await call('years', { student_id: student });
        if (ticket !== version) return output;
        schoolYears = lookup.years;
        termNames = lookup.terms;
        const year = schoolYears.find(enrollment => enrollment.id === yearId) || schoolYears[0];
        if (!year) {
            const empty = panel('Enrollment', 'Add the student’s school year and enrolled grade to start a curriculum record.');
            empty.append(link('Open K–8 Learning Records', 'middle-school-staff.html'));
            return empty;
        }
        yearId = year.id;
        selectors.append(field('Enrolled grade and year', select('year', schoolYears.map(enrollment =>
            option(enrollment.id, gradeLabel(enrollment.enrolled_grade) + ' · ' + enrollment.school_year)), yearId,
        value => { yearId = value; periodId = null; studyId = null; openUnits.clear(); render(); })));
        const available = periods.filter(period => period.school_year === year.school_year);
        const asOf = today();
        const period = available.find(item => item.id === periodId) ||
            available.find(item => item.starts_on <= asOf && item.ends_on >= asOf) ||
            available.find(item => item.starts_on <= asOf) || available.at(-1);
        if (!period) {
            const empty = panel('Reporting period', 'An admin needs to set up the reporting periods for ' + year.school_year + '.');
            if (office) empty.append(button('Open Catalog and periods', () => { workspace = 'setup'; return render(); }));
            return empty;
        }
        periodId = period.id;
        selectors.append(field('Reporting period', select('period', available.map(item => option(item.id, item.name)),
            periodId, value => { periodId = value; studyId = null; openUnits.clear(); render(); })));
        const subjects = [...new Set(catalogs.map(catalog => catalog.subject))];
        subject = subjects.includes(subject) ? subject : subjects[0];
        if (!subject) {
            const empty = panel('Curriculum catalogs', 'The office needs to load the curriculum catalogs.');
            if (office) empty.append(button('Open Catalog and periods', () => { workspace = 'setup'; return render(); }));
            return empty;
        }
        selectors.append(field('Subject', select('subject', subjects.map(item => option(item, label(item))), subject,
            value => { subject = value; studyId = null; openUnits.clear(); render(); })));
        const result = await call('record', context());
        if (ticket !== version) return output;
        output.append(tabs(tab, [['checklist','Lesson checklist'],['standards','Standards and evidence'],
            ...(office ? [['publish','Family preview and reports']] : [])], value => { tab = value; return render(); }));
        if (tab === 'checklist') {
            const { section, chosen } = coursePanel(year, period, result.studies);
            output.append(section);
            if (chosen) {
                const checklist = await call('checklist', context({ study_id: chosen.id }));
                if (ticket === version) output.append(checklistView(checklist, chosen, period, result));
            }
        } else if (tab === 'standards') {
            output.append(standardsView(year, result));
        } else if (office) {
            const published = await call('family', { student_id: student });
            output.append(officeView(result, period, published));
        }
        return output;
    }

    async function render() {
        const ticket = ++version;
        selectors.replaceChildren();
        content.replaceChildren();
        announce();
        const workspaceNav = byId('workspace');
        if (office) {
            workspaceNav.replaceChildren(...tabs(workspace,
                [['student','Student records'],['mapping','Mapping review'],['setup','Catalog and periods']],
                value => { workspace = value; return render(); }).children);
            workspaceNav.hidden = false;
        }
        if ((family || workspace === 'student') && roster.length) {
            selectors.append(field('Student', select('student', roster.map(item => option(item.id, normalizeStudentName(item))),
                student, value => { student = value; yearId = null; periodId = null; studyId = null; openUnits.clear(); render(); })));
        }
        try {
            const result = family
                ? student ? publicView(await call('family', { student_id: student })) :
                    panel('Curriculum progress', 'There are no eligible students linked to this account yet.')
                : await staffView(ticket);
            if (ticket === version) content.replaceChildren(result);
        } catch (error) {
            if (ticket === version) announce(errorMessage(error), true);
        }
    }

    document.addEventListener('DOMContentLoaded', async () => {
        try {
            const profile = await getPortalProfile(await getPortalSession());
            if (!canOpenPortalPage(family ? 'family' : 'gradebook', profile)) return;
            office = !family && isAdminPortalProfile(profile);
            [roster] = await Promise.all([call('roster'), family ? null : loadCatalog()]);
            student = roster[0]?.id;
            await render();
        } catch (error) {
            announce(errorMessage(error), true);
        }
    });
})();
