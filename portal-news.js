'use strict';

const NEWS_PHOTO_BUCKET = 'portal-news-photos';
const NEWS_PDF_BUCKET = 'portal-news-pdfs';
const NEWS_BATCH = 15;
const NEWS_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const NEWS_ISSUE_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const NEWS_DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeZone: 'UTC' });
const NEWS_DEADLINE = new Intl.DateTimeFormat(undefined, {
    timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
});

function newsIssueDate(date) {
    return NEWS_DATE.format(new Date(date + 'T00:00:00Z'));
}

function newsSafeLink(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch {
        return '';
    }
}

function newsIssueLink(id) {
    return 'portal-communications.html?newsletter=' + encodeURIComponent(id) + '#newsletters';
}

function newsRenderEntry(parent, entry, media, timestamp) {
    const article = communicationElement(parent, 'article');
    article.className = 'communication-post news-update';
    communicationElement(article, 'h3', entry.title);
    communicationElement(article, 'small', entry.author_name + (timestamp ? ' · ' + communicationTime(timestamp) : ''));
    communicationElement(article, 'p', entry.body);
    if (entry.links.length) {
        const list = communicationElement(article, 'ul');
        list.className = 'news-link-list';
        for (const link of entry.links) {
            const href = newsSafeLink(link.url);
            if (!href) continue;
            const anchor = communicationElement(communicationElement(list, 'li'), 'a', link.label);
            anchor.href = href;
            anchor.rel = 'noreferrer';
        }
    }
    if (entry.photos.length) {
        const gallery = communicationElement(article, 'div');
        gallery.className = 'news-photo-list';
        for (const photo of entry.photos) {
            const url = media.photos.get(photo.path);
            if (!url) {
                communicationElement(gallery, 'p', 'Photo unavailable: ' + photo.alt);
                continue;
            }
            const image = communicationElement(gallery, 'img');
            image.alt = photo.alt;
            image.loading = 'lazy';
            image.src = url;
        }
    }
    if (entry.documents?.length) {
        const list = communicationElement(article, 'ul');
        list.className = 'news-link-list';
        for (const document of entry.documents) {
            const item = communicationElement(list, 'li');
            const url = media.documents.get(document.path);
            if (url) {
                const link = communicationElement(item, 'a', document.label + ' (PDF)');
                link.href = url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
            } else {
                communicationElement(item, 'span', document.label + ' (PDF unavailable)');
            }
        }
    }
}

async function newsSignAssets(entries, field, bucket) {
    const paths = [...new Set(entries.flatMap(entry => (entry[field] || []).map(asset => asset.path)))];
    const signed = new Map();
    for (let start = 0; start < paths.length; start += 50) {
        const { data } = await portalClient.storage.from(bucket)
            .createSignedUrls(paths.slice(start, start + 50), 3600);
        for (const item of data || []) {
            if (item.signedUrl) signed.set(item.path, item.signedUrl);
        }
    }
    return signed;
}

async function newsSignMedia(entries) {
    const [photos, documents] = await Promise.all([
        newsSignAssets(entries, 'photos', NEWS_PHOTO_BUCKET),
        newsSignAssets(entries, 'documents', NEWS_PDF_BUCKET)
    ]);
    return { photos, documents };
}

async function initPortalNews(profile, session, students, selectedStudent, active) {
    const get = id => document.getElementById('news-' + id);
    const studentSection = document.getElementById('student-news');
    const staffSection = get('submissions');
    const archive = get('archive');
    const archiveStatus = get('archive-status');
    const staff = ['teacher', 'admin'].includes(profile.role);
    let issueCount = 0;
    let studentCount = 0;
    let studentVersion = 0;

    function bind(element, event, operation, onError) {
        element.addEventListener(event, async e => {
            if (event === 'submit') e.preventDefault();
            const button = event === 'submit' ? element.querySelector('[type="submit"]')
                : element.tagName === 'BUTTON' ? element : null;
            if (button?.disabled) return;
            if (button) button.disabled = true;
            try { await operation(e); }
            catch (error) { if (active()) onError(error); }
            finally { if (button) button.disabled = false; }
        });
    }

    async function loadArchive(more = false) {
        const start = more ? issueCount : 0;
        const issues = await communicationResult(portalClient.from('newsletter_issues').select('id,issue_on')
            .order('issue_on', { ascending: false }).range(start, start + NEWS_BATCH - 1));
        if (!active()) return;
        if (!more) archive.replaceChildren();
        for (const issue of issues) {
            communicationElement(communicationElement(archive, 'li'), 'a', newsIssueDate(issue.issue_on)).href = newsIssueLink(issue.id);
        }
        issueCount = start + issues.length;
        get('more-issues').hidden = issues.length < NEWS_BATCH;
        setPortalMessage(archiveStatus, issueCount ? '' : 'No newsletters have been published yet.');
    }

    async function openIssue() {
        const id = new URLSearchParams(location.search).get('newsletter');
        if (!NEWS_ISSUE_ID.test(id || '')) return;
        const issue = await communicationResult(portalClient.from('newsletter_issues')
            .select('issue_on,entries').eq('id', id).maybeSingle());
        if (!active()) return;
        const panel = get('issue');
        panel.hidden = false;
        if (!issue) {
            communicationElement(panel, 'p', 'This newsletter is unavailable.');
            return;
        }
        communicationElement(panel, 'h3', newsIssueDate(issue.issue_on));
        const signed = await newsSignMedia(issue.entries);
        if (!active()) return;
        for (const entry of issue.entries) newsRenderEntry(panel, entry, signed);
        communicationElement(panel, 'h3', 'Newsletter archive');
    }

    async function loadStudentNews(more = false) {
        const version = ++studentVersion;
        const select = get('student');
        const feed = get('feed');
        const start = more ? studentCount : 0;
        if (!more) feed.replaceChildren();
        get('more-student').hidden = true;
        if (!select.value) {
            communicationElement(feed, 'p', students.length ? 'Select a student to view updates.' : 'No students are available.');
            return;
        }
        const rows = await communicationResult(portalClient.rpc('student_news_for', {
            target_student: select.value, start_at: start
        }));
        if (!active() || version !== studentVersion) return;
        const signed = await newsSignMedia(rows);
        if (!active() || version !== studentVersion) return;
        for (const row of rows) newsRenderEntry(feed, row, signed, row.updated_at);
        if (!start && !rows.length) communicationElement(feed, 'p', 'No updates for this student yet.');
        studentCount = start + rows.length;
        get('more-student').hidden = rows.length < NEWS_BATCH;
    }

    const showArchiveError = () => setPortalMessage(archiveStatus, 'The newsletter archive couldn’t load. Refresh to try again.', 'error');
    const showStudentError = () => {
        get('feed').replaceChildren();
        communicationElement(get('feed'), 'p', 'Student News couldn’t load. Refresh to try again.');
    };
    bind(get('more-issues'), 'click', () => loadArchive(true), showArchiveError);
    const jobs = [loadArchive().catch(() => active() && showArchiveError()),
        openIssue().catch(() => active() && showArchiveError())];
    if (staff || profile.role === 'family') {
        studentSection.hidden = false;
        const select = get('student');
        communicationOption(select, 'Choose a student', '');
        for (const student of students) communicationOption(select, student.display_name, student.id);
        if (students.some(student => student.id === selectedStudent)) select.value = selectedStudent;
        else if (students.length === 1) select.value = students[0].id;
        bind(select, 'change', () => loadStudentNews(), showStudentError);
        bind(get('more-student'), 'click', () => loadStudentNews(true), showStudentError);
        jobs.push(loadStudentNews().catch(() => active() && showStudentError()));
    }
    if (staff) {
        staffSection.hidden = false;
        jobs.push(initNewsEditor(get, bind, session, students, active, () => loadStudentNews().catch(showStudentError)));
    }
    await Promise.all(jobs);
}

async function initNewsEditor(get, bind, session, students, active, refreshFeed) {
    const form = get('form');
    const editor = get('editor');
    const submit = form.querySelector('[type="submit"]');
    const newsletter = form.elements.newsletter;
    const status = get('submission-status');
    const list = get('submission-list');
    const search = get('student-search');
    const recipients = get('recipients');
    const linkFields = get('link-fields');
    const photoFields = get('photo-fields');
    const documentFields = get('document-fields');
    const uploads = new WeakMap();
    let draft = null;
    let newId = null;
    let windowInfo;
    let checkedAt;
    let count = 0;
    let supportsDocuments = false;

    const report = (message, tone) => setPortalMessage(status, message, tone);
    const onError = error => report(portalActionMessage(error, 'save or load the submission',
        'Your current entries are still in the form.'), 'error');
    const staffNow = () => new Date(windowInfo.checked_at).valueOf() + (performance.now() - checkedAt);
    const closed = row => Boolean(row.cutoff && staffNow() >= Date.parse(row.cutoff));

    function renderRecipientCount() {
        const selected = recipients.querySelectorAll('input:checked').length;
        get('recipient-count').textContent = selected + (selected === 1 ? ' student selected' : ' students selected');
    }

    for (const student of students) {
        const label = communicationElement(recipients, 'label');
        label.className = 'communication-checkbox';
        const input = communicationElement(label, 'input');
        input.type = 'checkbox';
        input.name = 'student';
        input.value = student.id;
        label.append(document.createTextNode(student.display_name));
    }
    if (!students.length) communicationElement(recipients, 'p', 'No students are assigned to you.');
    recipients.addEventListener('change', renderRecipientCount);
    search.addEventListener('input', () => {
        const term = search.value.trim().toLocaleLowerCase();
        for (const label of recipients.querySelectorAll('label')) {
            label.hidden = !label.textContent.toLocaleLowerCase().includes(term);
        }
    });

    function field(row, labelText, type, name, options) {
        const label = communicationElement(row, 'label', labelText);
        const input = communicationElement(label, 'input');
        Object.assign(input, { type, name, ...options });
        return input;
    }

    function addField(kind, item = {}) {
        const names = { link: 'link', photo: 'photo', document: 'PDF' };
        const parent = get(kind + '-fields');
        const add = get('add-' + kind);
        const limit = kind === 'link' ? 4 : 3;
        if (parent.children.length >= limit) return;
        const row = communicationElement(parent, 'div');
        row.className = 'news-field';
        if (kind === 'link') {
            field(row, 'Link label', 'text', 'link_label', { value: item.label || '', maxLength: 80, required: true });
            field(row, 'HTTPS address', 'url', 'link_url', { value: item.url || '', maxLength: 1000, required: true });
        } else {
            const photo = kind === 'photo';
            const name = photo ? 'Photo' : 'PDF';
            const label = field(row, photo ? 'Photo description' : 'PDF title', 'text', 'asset_label', {
                value: (photo ? item.alt : item.label) || '', maxLength: photo ? 150 : 120, required: true
            });
            const upload = field(row, item.path ? 'Replace saved ' + names[kind] : name + ' file', 'file', 'upload', {
                accept: photo ? NEWS_PHOTO_TYPES.join(',') : 'application/pdf,.pdf', required: !item.path
            });
            if (item.path) row.dataset.path = item.path;
            if (!photo) {
                upload.addEventListener('change', () => {
                    if (!label.value.trim() && upload.files[0]) {
                        label.value = upload.files[0].name.replace(/\.pdf$/i, '').trim().slice(0, label.maxLength);
                    }
                });
            }
        }
        const remove = communicationElement(row, 'button', 'Remove ' + names[kind]);
        remove.type = 'button';
        remove.addEventListener('click', () => {
            row.remove();
            add.disabled = false;
            add.focus();
        });
        add.disabled = parent.children.length >= limit;
        return row;
    }

    get('add-link').addEventListener('click', () => addField('link')?.querySelector('input').focus());
    get('add-photo').addEventListener('click', () => addField('photo')?.querySelector('input').focus());
    get('add-document').addEventListener('click', () => addField('document')?.querySelector('[type="file"]').focus());

    function showDraft(row = null) {
        form.reset();
        search.dispatchEvent(new Event('input'));
        draft = row;
        newId = null;
        const targets = row?.news_student_targets.map(target => target.student_id) || [];
        for (const box of recipients.querySelectorAll('input')) box.checked = targets.includes(box.value);
        renderRecipientCount();
        newsletter.disabled = !(row?.issue_on || windowInfo.issue_on);
        newsletter.checked = Boolean(row?.issue_on);
        linkFields.replaceChildren();
        photoFields.replaceChildren();
        documentFields.replaceChildren();
        get('add-link').disabled = false;
        get('add-photo').disabled = false;
        get('add-document').disabled = false;
        for (const link of row?.links || []) addField('link', link);
        for (const photo of row?.photos || []) addField('photo', photo);
        for (const document of row?.documents || []) addField('document', document);
        const action = row ? (closed(row) ? 'View submission' : 'Edit submission') : 'New submission';
        get('editor-title').textContent = action + (row?.issue_on ? ' · Newsletter for ' + newsIssueDate(row.issue_on) : '');
        get('cancel').hidden = !row;
        get('withdraw').hidden = !row || Boolean(closed(row) && !targets.length);
        get('withdraw').textContent = closed(row || {}) ? 'Remove from Student News' : 'Withdraw submission';
        for (const input of form.querySelectorAll('input,textarea,#news-add-link,#news-add-photo,#news-add-document,.news-field button')) {
            if (closed(row || {})) input.disabled = true;
            else if (!['newsletter', 'news-add-link', 'news-add-photo', 'news-add-document'].includes(input.name || input.id)) input.disabled = false;
        }
        submit.hidden = Boolean(closed(row || {}));
        if (row) {
            form.elements.headline.value = row.title;
            form.elements.body.value = row.body;
            editor.open = true;
            get('editor-title').focus();
        }
    }

    async function loadDrafts(more = false) {
        const start = more ? count : 0;
        const fields = 'id,title,body,links,photos,issue_on,cutoff:newsletter_cutoff,updated_at,author_name,news_student_targets(student_id)';
        const query = select => portalClient.from('news_submissions').select(select)
            .order('updated_at', { ascending: false }).order('id', { ascending: false })
            .range(start, start + NEWS_BATCH - 1);
        let result = await query(fields + ',documents');
        const available = !result.error;
        if (['42703', 'PGRST204'].includes(result.error?.code)) result = await query(fields);
        const rows = await communicationResult(result);
        if (!active()) return;
        supportsDocuments = available;
        get('document-section').hidden = !supportsDocuments;
        if (!more) list.replaceChildren();
        for (const row of rows) {
            const line = communicationElement(list, 'li');
            communicationElement(line, 'strong', row.title);
            const targets = row.news_student_targets.length;
            const audiences = [];
            if (targets) audiences.push('Student News · ' + targets);
            if (row.issue_on) audiences.push('Newsletter · ' + newsIssueDate(row.issue_on));
            communicationElement(line, 'span', audiences.join(' / '));
            const edit = communicationElement(line, 'button', closed(row) ? 'View' : 'Edit');
            edit.type = 'button';
            edit.addEventListener('click', () => {
                report('');
                showDraft(row);
            });
        }
        if (!start && !rows.length) communicationElement(list, 'li', 'No submissions yet.');
        count = start + rows.length;
        get('more-submissions').hidden = rows.length < NEWS_BATCH;
    }

    async function uploadMedia(fields, bucket, labelKey, validate) {
        const result = [];
        for (const row of fields.children) {
            const file = row.querySelector('[name="upload"]').files[0];
            let path = row.dataset.path;
            if (file) {
                const contentType = await validate(file);
                path = uploads.get(file);
                if (!path) {
                    path = session.user.id + '/' + crypto.randomUUID();
                    await communicationResult(portalClient.storage.from(bucket)
                        .upload(path, file, { contentType, cacheControl: '3600' }));
                    uploads.set(file, path);
                }
            }
            result.push({ path, [labelKey]: row.querySelector('[name="asset_label"]').value.trim() });
        }
        return result;
    }

    function validatePhoto(file) {
        if (!NEWS_PHOTO_TYPES.includes(file.type) || file.size > 5242880 || !file.size) {
            throw { code: '22023', message: 'Choose a JPG, PNG, or WebP photo up to 5 MB.' };
        }
        return file.type;
    }

    async function validatePdf(file) {
        if (file.size > 10485760 || await file.slice(0, 5).text() !== '%PDF-') {
            throw { code: '22023', message: 'Choose a valid PDF up to 10 MB.' };
        }
        return 'application/pdf';
    }

    async function save() {
        const fields = new FormData(form);
        const studentIds = fields.getAll('student');
        const issue = newsletter.checked ? (draft?.issue_on || windowInfo.issue_on) : null;
        if (!studentIds.length && !issue) {
            report('Select students or choose the school-wide newsletter.', 'error');
            return;
        }
        const links = [...linkFields.children].map(row => ({
            label: row.querySelector('[name="link_label"]').value.trim(),
            url: newsSafeLink(row.querySelector('[name="link_url"]').value.trim())
        }));
        if (links.some(link => !link.label || !link.url)) {
            report('Enter a label and an HTTPS address for each link.', 'error');
            return;
        }
        if (issue && !window.confirm('Include this update and its links, photos, and PDFs in the newsletter for all families?')) return;
        newId ||= crypto.randomUUID();
        form.inert = true;
        try {
            const photos = await uploadMedia(photoFields, NEWS_PHOTO_BUCKET, 'alt', validatePhoto);
            const documents = supportsDocuments
                ? await uploadMedia(documentFields, NEWS_PDF_BUCKET, 'label', validatePdf) : [];
            if (!active()) return;
            const payload = {
                submission_id: draft?.id || newId, expected_update: draft?.updated_at || null, expected_issue: issue,
                student_ids: studentIds, headline: fields.get('headline'), details: fields.get('body'),
                submitted_links: links, submitted_photos: photos
            };
            if (supportsDocuments) payload.submitted_documents = documents;
            await communicationResult(portalClient.rpc(
                supportsDocuments ? 'news_save_submission_with_documents' : 'news_save_submission', payload
            ));
            if (!active()) return;
            const destinations = [];
            if (studentIds.length) destinations.push('Published to Student News');
            if (issue) destinations.push('saved for the ' + newsIssueDate(issue) + ' newsletter');
            const message = destinations.join(' and ') + '.';
            report(message[0].toUpperCase() + message.slice(1), 'success');
            showDraft();
            editor.open = false;
            await Promise.all([loadDrafts(), refreshFeed()]);
        } finally {
            form.inert = false;
            if (active() && !editor.open) get('editor-title').focus();
        }
    }

    bind(form, 'submit', save, onError);
    get('cancel').addEventListener('click', () => {
        showDraft();
        editor.open = false;
        get('editor-title').focus();
        report('');
    });
    bind(get('withdraw'), 'click', async () => {
        const row = draft;
        const locked = closed(row);
        const question = locked ? 'Remove this update from Student News?' : 'Withdraw this submission from its selected destinations?';
        if (!window.confirm(question)) return;
        await communicationResult(portalClient.rpc('news_withdraw_submission', {
            target_submission: row.id, expected_update: row.updated_at, student_news_only: locked
        }));
        if (!active()) return;
        showDraft();
        editor.open = false;
        report(locked ? 'Removed from Student News.' : 'Submission withdrawn.', 'success');
        get('editor-title').focus();
        await Promise.all([loadDrafts(), refreshFeed()]);
    }, onError);
    bind(get('more-submissions'), 'click', () => loadDrafts(true), onError);

    try {
        windowInfo = await communicationResult(portalClient.rpc('newsletter_submission_window').single());
        if (!active()) return;
        checkedAt = performance.now();
        get('deadline').textContent = windowInfo.issue_on
            ? 'Next newsletter deadline: ' + NEWS_DEADLINE.format(new Date(windowInfo.deadline)) +
                '. Scheduled delivery: ' + NEWS_DEADLINE.format(new Date(windowInfo.send_at)) + '.'
            : 'The newsletter schedule is paused. You can still post to Student News.';
        showDraft();
        await loadDrafts();
    } catch (error) {
        if (!active()) return;
        editor.hidden = true;
        onError(error);
    }
}
