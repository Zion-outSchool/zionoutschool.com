(() => {
    const byId = id => document.getElementById('workroom-' + id);
    const status = byId('status');
    const gate = byId('gate');
    const dashboard = byId('dashboard');
    const submitForm = byId('submit');
    const referenceForm = byId('reference');
    const searchForm = byId('search');
    const scheduleForm = byId('schedule');
    const detail = byId('detail');
    const lockButton = byId('lock');
    const views = [...dashboard.querySelectorAll('[data-view]')];
    const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const labels = { queued: 'Queued', running: 'In progress', failed: 'Needs attention', review: 'Ready for review', approved: 'Approved', canceled: 'Canceled' };
    let unlock;
    let activeUser;
    let generation = 0;
    let expiryTimer;
    let pollTimer;
    let selectedJob;
    let jobVersion = 0;
    let historyStart = 0;
    let referenceStart = 0;
    let referenceQuery = '';
    let assignmentId;
    let scheduleId;
    let workflows = {};
    let roles = {};

    function element(tag, text, className) {
        const node = document.createElement(tag);
        if (text) node.textContent = text;
        if (className) node.className = className;
        return node;
    }

    function button(text, action, className = 'workroom-secondary') {
        const node = element('button', text, className);
        node.type = 'button';
        node.onclick = () => void run(node, action);
        return node;
    }

    function disclosure(title, content) {
        const node = element('details');
        node.append(element('summary', title), content);
        return node;
    }

    function lock(message = '', tone = 'neutral') {
        ++generation;
        unlock = null;
        assignmentId = null;
        scheduleId = null;
        selectedJob = null;
        clearTimeout(expiryTimer);
        clearTimeout(pollTimer);
        gate.hidden = false;
        dashboard.hidden = true;
        lockButton.hidden = true;
        detail.hidden = true;
        for (const id of ['history', 'library', 'roles', 'detail', 'schedule-list']) byId(id).replaceChildren();
        for (const form of [submitForm, referenceForm, searchForm, scheduleForm, byId('unlock')]) form.reset();
        setPortalMessage(status, message, tone);
    }

    async function api(action, fields = {}) {
        const requestGeneration = generation;
        const session = await getPortalSession();
        if (requestGeneration !== generation) throw new Error('');
        if (!session) {
            lock('Sign in to the school portal again.', 'error');
            throw new Error('');
        }
        const response = await fetch(ZION_SUPABASE_URL + '/functions/v1/ai-workroom', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + session.access_token, apikey: ZION_SUPABASE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...fields, action, unlock }),
            cache: 'no-store',
        });
        const data = await response.json();
        if (requestGeneration !== generation) throw new Error('');
        if (response.status === 401 || response.status === 423 || (response.status === 403 && action !== 'unlock')) {
            lock(data.message, 'error');
            throw new Error('');
        }
        if (!response.ok) throw new Error(data.message || 'The Workroom service could not complete this request.');
        return data;
    }

    async function run(control, action) {
        if (control.dataset.busy) return;
        control.setAttribute('aria-busy', 'true');
        control.dataset.busy = 'true';
        setPortalMessage(status, '');
        try {
            await action();
        } catch (error) {
            if (error.message) setPortalMessage(status, error.message, 'error');
        } finally {
            delete control.dataset.busy;
            control.removeAttribute('aria-busy');
        }
    }

    function setView(view) {
        for (const tab of views) {
            const active = tab.dataset.view === view;
            tab.setAttribute('aria-pressed', String(active));
            byId(tab.dataset.view).hidden = !active;
        }
    }

    function updateFamilyRecordsChoice() {
        const familyWorkflow = submitForm.elements.workflow.value === 'family';
        byId('family-records').hidden = !familyWorkflow;
        submitForm.elements.includeRecords.disabled = !familyWorkflow;
    }

    function renderSetup(data) {
        workflows = data.workflows;
        roles = data.roles;
        const choices = Object.entries(workflows).map(([key, workflow]) => {
            const option = element('option', workflow.label);
            option.value = key;
            return option;
        });
        submitForm.elements.workflow.replaceChildren(...choices);
        updateFamilyRecordsChoice();
        scheduleForm.elements.workflow.replaceChildren(...choices.map(option => option.cloneNode(true)));
        byId('roles').replaceChildren(...Object.values(roles).map(([name, instructions]) => {
            const item = element('li');
            item.append(element('h3', name), element('p', instructions));
            return item;
        }));
    }

    async function refreshHistory(start = historyStart) {
        const data = await api('list', { start });
        historyStart = start;
        if (!Object.keys(workflows).length) renderSetup(data);
        const entries = data.jobs.map(job => {
            const item = element('li');
            const open = button(job.title, () => openJob(job.id, true), 'workroom-secondary workroom-history-link');
            const meta = [workflows[job.workflow]?.label, labels[job.status], dateTime.format(new Date(job.created_at))];
            item.append(open, element('small', meta.filter(Boolean).join(' · ')));
            return item;
        });
        byId('history').replaceChildren(...(entries.length ? entries : [element('li', 'No assignments on this page.')]));
        byId('history-pages').hidden = start === 0 && !data.more;
        byId('older').disabled = !data.more;
        byId('newer').disabled = start === 0;
    }

    function download(filename, blob) {
        const url = URL.createObjectURL(blob);
        const link = element('a');
        link.href = url;
        link.download = filename;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    function appendSources(job) {
        if (!job.sources?.length) return;
        detail.append(element('h3', 'Sources supplied to the assistants'));
        for (const source of job.sources) {
            const content = element('div');
            if (source.effective_on) content.append(element('small', 'Effective ' + source.effective_on));
            if (source.url?.startsWith('https://')) {
                const link = element('a', 'Open public source');
                link.href = source.url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                content.append(link);
            }
            content.append(element('p', source.excerpt, 'workroom-copy'));
            detail.append(disclosure(`[${source.id}] ${source.title}`, content));
        }
    }

    function websiteSource(draft) {
        return /^~~~zion-file[ \t]*\r?\n([\s\S]+?)^~~~[ \t]*$/m.exec(draft)?.[1];
    }

    function htmlPreview(markup) {
        const content = element('template');
        content.innerHTML = markup;
        const allowedTags = new Set('address article aside b blockquote br button caption code dd div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr i input label legend li main mark nav ol option p pre section select small span strong style table tbody td textarea th thead tr ul'.split(' '));
        const allowedAttributes = new Set('aria-label class colspan disabled for id name placeholder role rowspan style title type value'.split(' '));
        for (const node of content.content.querySelectorAll('*')) {
            if (!allowedTags.has(node.localName) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
                node.remove();
                continue;
            }
            for (const attribute of [...node.attributes]) {
                if (!allowedAttributes.has(attribute.name)) node.removeAttribute(attribute.name);
            }
        }
        const frame = element('iframe', '', 'workroom-preview');
        frame.title = 'Website draft preview';
        frame.setAttribute('sandbox', '');
        frame.srcdoc = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
            `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'">` +
            content.innerHTML;
        return frame;
    }

    function websiteActions(job, version, editor) {
        const filename = job.attachment_name;
        if (!filename || !/^[a-z0-9][a-z0-9_-]*\.(html|css|js)$/i.test(filename) ||
                !job.contributions.some(step => step.role === 'website')) return null;
        const section = element('div', '', 'workroom-website');
        section.append(element('h3', 'Website file · ' + filename));
        const actions = element('div', '', 'workroom-actions');
        const preview = element('div');
        if (/\.html$/i.test(filename)) {
            actions.append(button('Preview markup', () => {
                const code = websiteSource(editor.value);
                if (!code) throw new Error('Add the complete HTML in a ~~~zion-file block to preview it.');
                preview.replaceChildren(htmlPreview(code));
            }));
        }
        const savedCode = websiteSource(version.draft);
        if (savedCode && version.approved_at) {
            actions.append(button('Export approved file for Git', async () => {
                const file = await api('attachment', { id: job.id });
                const original = Uint8Array.from(atob(file.base64), character => character.charCodeAt(0));
                const hash = await crypto.subtle.digest('SHA-256', original);
                const base = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
                const proposal = { job: job.id, version: version.version, path: filename, base, content: savedCode };
                download(`zion-website-${job.id.slice(0, 8)}-v${version.version}.json`,
                    new Blob([JSON.stringify(proposal, null, 2)], { type: 'application/json' }));
            }));
        }
        section.append(actions, preview);
        if (!savedCode) section.append(element('p', 'To save a changed file, include its complete contents between ~~~zion-file and ~~~ on separate lines.'));
        return section;
    }

    function appendVersions(job, versions, admins) {
        if (!versions.length) return;
        const current = versions[0];
        const author = id => id ? admins[id] || id : 'AI assistants';
        const versionInfo = version => version.approved_at
            ? `Approved by ${author(version.approved_by)} · ${dateTime.format(new Date(version.approved_at))}`
            : `Saved by ${author(version.created_by)} · ${dateTime.format(new Date(version.created_at))}`;
        const editor = element('textarea');
        editor.defaultValue = current.draft;
        editor.rows = 14;
        editor.maxLength = 50000;
        const label = element('label', `Draft version ${current.version}`, 'workroom-draft');
        label.append(editor);
        const actions = element('div', '', 'workroom-actions');
        const save = button('Save new version', async () => {
            if (!editor.value.trim() || editor.value === current.draft) throw new Error('Edit the draft before saving a new version.');
            await api('save', { id: job.id, version: current.version, draft: editor.value });
            await openJob(job.id, true, true);
            await refreshHistory();
            setPortalMessage(status, 'New draft version saved.', 'success');
        });
        actions.append(save);
        if (job.status === 'review') {
            const approve = button(`Approve version ${current.version}`, async () => {
                if (editor.value !== current.draft) throw new Error('Save your edits before you approve a version.');
                await api('approve', { id: job.id, version: current.version });
                await openJob(job.id, true, true);
                await refreshHistory();
                setPortalMessage(status, `Version ${current.version} approved.`, 'success');
            }, '');
            actions.append(approve);
        }
        actions.append(button('Download saved draft', () => {
            const filename = job.title.replace(/[^a-z0-9 _-]/gi, '').trim().slice(0, 80) || 'assignment';
            download(`${filename}-v${current.version}.md`, new Blob([current.draft], { type: 'text/markdown' }));
        }));
        detail.append(label, element('p', versionInfo(current), 'workroom-meta'), actions);
        const website = websiteActions(job, current, editor);
        if (website) detail.append(website);
        if (versions.length > 1) detail.append(element('h3', 'Earlier versions'));
        for (const version of versions.slice(1)) {
            const content = element('div');
            content.append(element('p', versionInfo(version), 'workroom-meta'), element('p', version.draft, 'workroom-copy'));
            detail.append(disclosure('Version ' + version.version, content));
        }
    }

    async function openJob(id, focus = false, discardChanges = false) {
        const editor = detail.querySelector('textarea');
        if (!discardChanges && editor && editor.value !== editor.defaultValue &&
                !window.confirm('Leave these unsaved draft edits?')) return;
        const request = ++jobVersion;
        const { job, versions, admins } = await api('job', { id });
        if (request !== jobVersion) return;
        selectedJob = id;
        clearTimeout(pollTimer);
        detail.replaceChildren(element('h2', job.title), element('p',
            [labels[job.status], admins[job.created_by] || job.created_by, dateTime.format(new Date(job.created_at))].join(' · '),
            'workroom-meta'));
        if (job.failure) detail.append(element('p', job.failure));
        if (job.status === 'queued' && Date.parse(job.available_at) > Date.now()) {
            detail.append(element('p', 'Next retry after ' + dateTime.format(new Date(job.available_at)), 'workroom-meta'));
        }
        const actions = element('div', '', 'workroom-actions');
        if (job.status === 'failed') {
            actions.append(button('Retry assignment', async () => {
                await api('retry', { id });
                await openJob(id, true);
                await refreshHistory();
            }));
        }
        if (['queued', 'running'].includes(job.status)) {
            actions.append(button('Cancel assignment', async () => {
                await api('cancel-job', { id });
                if (selectedJob === id) await openJob(id, true, true);
                await refreshHistory();
                setPortalMessage(status, 'Assignment canceled.', 'success');
            }));
        }
        actions.append(button('Delete assignment', async () => {
            if (!window.confirm(`Permanently delete “${job.title}”, including its attachment, drafts, and approvals?`)) return;
            await api('delete-job', { id, confirm: true });
            if (selectedJob === id) {
                ++jobVersion;
                selectedJob = null;
                clearTimeout(pollTimer);
                detail.replaceChildren();
                detail.hidden = true;
            }
            await refreshHistory();
            if (historyStart > 0 && byId('history').querySelectorAll('button').length === 0) {
                await refreshHistory(historyStart - 20);
            }
            if (!selectedJob) byId('refresh').focus();
            setPortalMessage(status, 'Assignment permanently deleted.', 'success');
        }, 'workroom-secondary workroom-danger'));
        detail.append(actions);
        appendVersions(job, versions, admins);
        const original = element('div');
        original.append(element('p', job.assignment, 'workroom-copy'));
        if (job.search_query) original.append(element('p', 'Public search · ' + job.search_query, 'workroom-meta'));
        if (job.attachment_name) {
            original.append(button('Download ' + job.attachment_name, async () => {
                const file = await api('attachment', { id });
                const bytes = Uint8Array.from(atob(file.base64), character => character.charCodeAt(0));
                download(file.name, new Blob([bytes], { type: 'application/octet-stream' }));
            }));
        }
        detail.append(disclosure('Original assignment', original));
        appendSources(job);
        if (job.contributions.length) detail.append(element('h3', 'Assistant contributions'));
        for (const step of job.contributions) {
            detail.append(disclosure(roles[step.role]?.[0] || step.role, element('p', step.text, 'workroom-copy')));
        }
        detail.hidden = false;
        if (focus) detail.focus();
        if (['queued', 'running'].includes(job.status)) {
            pollTimer = setTimeout(() => {
                if (unlock && selectedJob === id) {
                    void openJob(id).then(() => refreshHistory()).catch(error => {
                        if (error.message) setPortalMessage(status, error.message, 'error');
                    });
                }
            }, 6000);
        }
    }

    async function refreshReferences(start = referenceStart) {
        const data = await api('references', { start, query: referenceQuery });
        referenceStart = start;
        const entries = data.references.map(reference => {
            const item = element('li');
            const content = element('div');
            content.append(element('p', reference.content, 'workroom-copy'));
            const actions = element('div', '', 'workroom-actions');
            async function transition(next) {
                await api('reference-status', { id: reference.id, status: next });
                await refreshReferences();
            }
            if (reference.status === 'draft') actions.append(button('Approve reference', () => transition('approved')));
            if (reference.status !== 'retired') actions.append(button('Retire reference', () => transition('retired')));
            content.append(actions);
            const title = disclosure(reference.title, content);
            const policy = reference.use_for_ai ? 'AI use allowed upon approval' : 'Internal reference only';
            item.append(title, element('small',
                [reference.category, reference.status, reference.owner, 'Effective ' + reference.effective_on, policy].join(' · ')));
            return item;
        });
        byId('library').replaceChildren(...(entries.length ? entries : [element('li', 'No matching references.')]));
        byId('reference-pages').hidden = start === 0 && !data.more;
        byId('reference-next').disabled = !data.more;
        byId('reference-previous').disabled = start === 0;
    }

    async function refreshSchedules() {
        const { schedules } = await api('schedules');
        const entries = schedules.map(schedule => {
            const item = element('li');
            const cancel = button('Cancel schedule', async () => {
                if (!window.confirm('Cancel future runs of this assignment?')) return;
                await api('cancel-schedule', { id: schedule.id });
                await refreshSchedules();
            });
            item.append(element('strong', schedule.title), element('small', [
                schedule.interval_days === 1 ? 'Daily' : 'Weekly',
                'Next run ' + dateTime.format(new Date(schedule.next_at)),
            ].join(' · ')), cancel);
            return item;
        });
        byId('schedule-list').replaceChildren(...(entries.length ? entries : [element('li', 'No active schedules.')]));
    }

    async function readFile(file) {
        if (!file.size) return null;
        if (file.size > 3 * 1024 * 1024) throw new Error('Choose an attachment under 3 MB.');
        const result = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('This attachment could not be read.'));
            reader.readAsDataURL(file);
        });
        return { name: file.name, base64: result.slice(result.indexOf(',') + 1) };
    }

    byId('unlock').onsubmit = event => {
        event.preventDefault();
        const password = event.currentTarget.elements.password;
        const value = password.value;
        password.value = '';
        void run(event.submitter, async () => {
            const session = await getPortalSession();
            activeUser = session?.user?.id;
            const data = await api('unlock', { password: value });
            unlock = data.sessionToken;
            try {
                workflows = {};
                await refreshHistory(0);
            } catch (error) {
                lock();
                throw error;
            }
            gate.hidden = true;
            dashboard.hidden = false;
            lockButton.hidden = false;
            referenceStart = 0;
            referenceQuery = '';
            setView('assignments');
            views[0].focus();
            expiryTimer = setTimeout(() => lock('Your Workroom session expired. Enter the secondary password again.'),
                Math.max(0, Date.parse(data.expiresAt) - Date.now()));
        });
    };

    lockButton.onclick = () => void run(lockButton, async () => {
        try {
            await api('lock');
        } finally {
            lock();
            byId('unlock').elements.password.focus();
        }
    });
    submitForm.elements.workflow.onchange = updateFamilyRecordsChoice;
    submitForm.oninput = () => { assignmentId = null; };
    submitForm.onsubmit = event => {
        event.preventDefault();
        void run(event.submitter, async () => {
            const requestGeneration = generation;
            const fields = Object.fromEntries(new FormData(submitForm));
            fields.file = await readFile(fields.file);
            if (requestGeneration !== generation) return;
            assignmentId ||= crypto.randomUUID();
            const { id } = await api('submit', { ...fields, id: assignmentId, consent: fields.consent === 'on',
                includeRecords: fields.includeRecords === 'on' });
            assignmentId = null;
            submitForm.reset();
            updateFamilyRecordsChoice();
            await refreshHistory(0);
            await openJob(id, true, true);
        });
    };
    referenceForm.onsubmit = event => {
        event.preventDefault();
        void run(event.submitter, async () => {
            const fields = Object.fromEntries(new FormData(referenceForm));
            await api('reference', { ...fields, useForAi: fields.useForAi === 'on' });
            referenceForm.reset();
            searchForm.reset();
            referenceQuery = '';
            await refreshReferences(0);
            setPortalMessage(status, 'Reference draft saved.', 'success');
        });
    };
    scheduleForm.oninput = () => { scheduleId = null; };
    scheduleForm.onsubmit = event => {
        event.preventDefault();
        void run(event.submitter, async () => {
            const fields = Object.fromEntries(new FormData(scheduleForm));
            scheduleId ||= crypto.randomUUID();
            await api('schedule', { ...fields, id: scheduleId, consent: fields.consent === 'on',
                intervalDays: Number(fields.intervalDays), firstRun: new Date(fields.firstRun).toISOString() });
            scheduleId = null;
            scheduleForm.reset();
            await refreshSchedules();
            setPortalMessage(status, 'Recurring assignment scheduled.', 'success');
        });
    };
    searchForm.onsubmit = event => {
        event.preventDefault();
        referenceQuery = searchForm.elements.query.value;
        void run(event.submitter, () => refreshReferences(0));
    };
    byId('refresh').onclick = () => void run(byId('refresh'), () => refreshHistory());
    byId('older').onclick = () => void run(byId('older'), () => refreshHistory(historyStart + 20));
    byId('newer').onclick = () => void run(byId('newer'), () => refreshHistory(Math.max(0, historyStart - 20)));
    byId('reference-next').onclick = () => void run(byId('reference-next'), () => refreshReferences(referenceStart + 20));
    byId('reference-previous').onclick = () => void run(byId('reference-previous'), () => refreshReferences(Math.max(0, referenceStart - 20)));
    for (const tab of views) {
        tab.onclick = () => {
            const view = tab.dataset.view;
            setView(view);
            if (view === 'references') void run(tab, () => refreshReferences());
            if (view === 'schedules') void run(tab, refreshSchedules);
        };
    }
    portalClient?.auth.onAuthStateChange((event, session) => {
        if (activeUser && (event === 'SIGNED_OUT' || session?.user?.id !== activeUser)) lock();
    });
    window.addEventListener('pagehide', () => lock());
})();
