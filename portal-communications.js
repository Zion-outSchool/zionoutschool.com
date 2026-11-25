/* Family Portal conversations and school updates. */
'use strict';

const COMMUNICATION_PAGE_SIZE = 25;
const COMMUNICATION_BUCKET = 'portal-documents';
const COMMUNICATION_POST_LABELS = { news: 'News', announcement: 'Announcement', document: 'Document', newsletter: 'Newsletter' };
const COMMUNICATION_DELIVERY_LABELS = {
    pending: 'Email queued', sending: 'Email sending', accepted: 'Email accepted by provider',
    failed: 'Email failed', uncertain: 'Email delivery unconfirmed', cancelled: 'Email cancelled'
};

function communicationElement(parent, tag, text) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    parent.append(element);
    return element;
}

function communicationOption(select, title, value) {
    communicationElement(select, 'option', title).value = value;
}

function communicationTime(value) {
    return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

async function communicationResult(request) {
    const { data, error } = await request;
    if (error) throw error;
    return data;
}

async function initPortalCommunications() {
    const get = id => document.getElementById('communication-' + id);
    const status = get('status');
    const content = get('content');
    const session = await getPortalSession();
    const profile = await getPortalProfile(session);
    if (!profile?.active) {
        setPortalMessage(status, 'Sign in with an active portal account to open Communications.', 'error');
        communicationElement(status, 'a', ' Return to Family Portal').href = 'family-portal.html';
        return;
    }

    const staff = ['admin', 'teacher'].includes(profile.role);
    const admin = profile.role === 'admin';
    const studentSelect = get('student');
    const messages = get('history');
    const threads = get('threads');
    const postList = get('posts');
    const compose = get('message-form');
    const reply = get('reply');
    const publish = get('post-form');
    const alert = (message, tone) => setPortalMessage(status, message, tone);
    const selectedStudent = new URLSearchParams(location.search).get('student') || '';
    let students = [];
    let activeThread = null;
    let studentVersion = 0;
    let threadVersion = 0;
    let threadCount = 0;
    let messageCount = 0;
    let postCount = 0;
    let active = true;
    let postDraft = null;
    let audienceVersion = 0;
    const forms = [compose, reply, publish];

    portalClient.auth.onAuthStateChange((_event, next) => {
        if (next?.user?.id === session.user.id) return;
        active = false;
        content.hidden = true;
        messages.replaceChildren();
        threads.replaceChildren();
        postList.replaceChildren();
        forms.forEach(form => form.reset());
        location.replace('family-portal.html');
    });
    document.querySelector('[data-portal-sign-out]').hidden = false;
    document.getElementById('student-messages').hidden = !staff && profile.role !== 'family';
    get('compose').hidden = !staff;
    get('publish').hidden = !staff;

    function showError(error) {
        if (!active) return;
        alert(staff ? portalActionMessage(error, 'complete the communications action',
            'Check the selected student or classroom. If an assignment or family link changed, reload before trying again.')
            : 'We couldn’t complete that action. Reopen the conversation or update and try again.', 'error');
    }

    function handle(element, event, run) {
        element.addEventListener(event, async e => {
            if (event === 'submit') e.preventDefault();
            const button = event === 'submit' ? element.querySelector('button[type="submit"]')
                : element.tagName === 'BUTTON' ? element : null;
            if (button?.disabled) return;
            if (button) button.disabled = true;
            try { await run(e); } catch (error) { showError(error); }
            finally { if (button) button.disabled = false; }
        });
    }

    function updateDeliveryChoices() {
        const student = students.find(item => item.id === studentSelect.value);
        const channel = compose.elements.channel;
        for (const choice of channel.options) {
            choice.disabled = choice.value !== 'portal' && !student?.email_available;
        }
        if (channel.selectedOptions[0]?.disabled) channel.value = 'portal';
        compose.querySelector('button').disabled = !student;
    }

    async function loadMessages(thread, older = false) {
        const version = ++threadVersion;
        const start = older ? messageCount : 0;
        const [rows, deliveries] = await Promise.all([
            communicationResult(portalClient.from('communication_messages')
                .select('id,author_name,source,body,created_at').eq('thread_id', thread.id)
                .order('created_at', { ascending: false }).order('id', { ascending: false })
                .range(start, start + COMMUNICATION_PAGE_SIZE - 1)),
            staff ? communicationResult(portalClient.rpc('communication_delivery_status', { target_thread: thread.id })) : []
        ]);
        if (!active || version !== threadVersion) return;
        if (!older) messages.replaceChildren();
        const fragment = document.createDocumentFragment();
        for (const row of [...rows].reverse()) {
            const item = communicationElement(fragment, 'li');
            communicationElement(item, 'strong', row.author_name);
            communicationElement(item, 'small', communicationTime(row.created_at) + (row.source === 'email' ? ' · Email reply' : ''));
            communicationElement(item, 'p', row.body);
            const delivery = deliveries.find(entry => entry.message_id === row.id);
            if (delivery) communicationElement(item, 'small', COMMUNICATION_DELIVERY_LABELS[delivery.state]);
        }
        messages.prepend(fragment);
        messageCount = start + rows.length;
        get('older').hidden = rows.length < COMMUNICATION_PAGE_SIZE;
    }

    async function openThread(thread) {
        activeThread = thread;
        ++threadVersion;
        reply.reset();
        delete reply.dataset.requestId;
        messages.replaceChildren();
        get('thread-title').textContent = thread.subject;
        get('thread').hidden = false;
        get('older').hidden = true;
        for (const button of threads.querySelectorAll('button')) {
            button.setAttribute('aria-pressed', String(button.dataset.threadId === thread.id));
        }
        await loadMessages(thread);
    }

    async function loadThreads(more = false) {
        const version = ++studentVersion;
        const id = studentSelect.value;
        const start = more ? threadCount : 0;
        if (!more) threads.replaceChildren();
        get('more-threads').hidden = true;
        if (!id) return;
        const rows = await communicationResult(portalClient.from('communication_threads')
            .select('id,subject,channel,updated_at').eq('student_id', id)
            .order('updated_at', { ascending: false }).order('id', { ascending: false })
            .range(start, start + COMMUNICATION_PAGE_SIZE - 1));
        if (!active || version !== studentVersion) return;
        for (const thread of rows) {
            const button = communicationElement(communicationElement(threads, 'li'), 'button', thread.subject);
            button.type = 'button';
            button.dataset.threadId = thread.id;
            button.setAttribute('aria-pressed', String(activeThread?.id === thread.id));
            communicationElement(button, 'small', ' · ' + communicationTime(thread.updated_at));
            if (staff && thread.channel === 'email') communicationElement(button, 'small', ' · Email only');
            handle(button, 'click', () => openThread(thread));
        }
        if (!start && !rows.length) communicationElement(threads, 'li', 'No conversations yet.');
        threadCount = start + rows.length;
        get('more-threads').hidden = rows.length < COMMUNICATION_PAGE_SIZE;
    }

    function messageRequest(form) {
        const input = new FormData(form);
        form.dataset.requestId ||= crypto.randomUUID();
        return { input, id: form.dataset.requestId };
    }

    handle(studentSelect, 'change', async () => {
        activeThread = null;
        ++threadVersion;
        get('thread').hidden = true;
        messages.replaceChildren();
        compose.reset();
        delete compose.dataset.requestId;
        updateDeliveryChoices();
        await loadThreads();
    });

    handle(compose, 'input', () => delete compose.dataset.requestId);
    handle(reply, 'input', () => delete reply.dataset.requestId);

    handle(compose, 'submit', async () => {
        const student = studentSelect.value;
        if (!student) return;
        const { input, id } = messageRequest(compose);
        const channel = input.get('channel');
        const thread = await communicationResult(portalClient.rpc('communication_send', {
            request_id: id, target_student: student, target_thread: null,
            message_subject: input.get('subject'), message_body: input.get('body'), delivery_channel: channel
        }));
        if (!active || studentSelect.value !== student) return;
        compose.reset();
        delete compose.dataset.requestId;
        updateDeliveryChoices();
        get('compose').open = false;
        await openThread({ id: thread, subject: input.get('subject'), channel });
        await loadThreads();
        alert(channel === 'portal' ? 'Message saved in the portal.' : 'Message saved and email queued.', 'success');
    });

    handle(reply, 'submit', async () => {
        const thread = activeThread;
        if (!thread) return;
        const { input, id } = messageRequest(reply);
        await communicationResult(portalClient.rpc('communication_send', {
            request_id: id, target_student: null, target_thread: thread.id,
            message_subject: null, message_body: input.get('body'), delivery_channel: null
        }));
        if (!active || activeThread?.id !== thread.id) return;
        reply.reset();
        delete reply.dataset.requestId;
        await loadMessages(thread);
        await loadThreads();
        alert(staff && thread.channel !== 'portal' ? 'Reply saved and email queued.' : 'Reply saved.', 'success');
    });

    handle(get('more-threads'), 'click', () => loadThreads(true));
    handle(get('older'), 'click', () => activeThread && loadMessages(activeThread, true));

    async function loadPosts(more = false) {
        const start = more ? postCount : 0;
        get('more-posts').hidden = true;
        const rows = await communicationResult(portalClient.from('communication_posts')
            .select('id,kind,title,body,document_name,created_at,course_id,author_id')
            .order('created_at', { ascending: false }).order('id', { ascending: false })
            .range(start, start + COMMUNICATION_PAGE_SIZE - 1));
        if (!active) return;
        if (!more) postList.replaceChildren();
        for (const post of rows) {
            const article = communicationElement(postList, 'article');
            article.className = 'communication-post';
            article.id = 'update-' + post.id;
            communicationElement(article, 'small', (post.course_id ? 'Classroom · ' : '') +
                COMMUNICATION_POST_LABELS[post.kind] + ' · ' + communicationTime(post.created_at));
            communicationElement(article, 'h3', post.title);
            communicationElement(article, 'p', post.body);
            if (post.kind === 'newsletter') {
                communicationElement(article, 'a', 'Read this issue').href = 'portal-communications.html?newsletter=' + encodeURIComponent(post.id) + '#newsletters';
            }
            if (post.document_name) {
                const download = communicationElement(article, 'button', 'Download PDF');
                download.type = 'button';
                handle(download, 'click', async () => {
                    const file = await communicationResult(portalClient.storage.from(COMMUNICATION_BUCKET)
                        .createSignedUrl(post.id + '/document.pdf', 60, { download: post.document_name }));
                    if (active) location.assign(file.signedUrl);
                });
            }
            if (admin || (staff && post.course_id && post.author_id === session.user.id)) {
                const archive = communicationElement(article, 'button', 'Archive');
                archive.type = 'button';
                handle(archive, 'click', async () => {
                    if (!window.confirm('Archive this update?')) return;
                    await communicationResult(portalClient.rpc('communication_archive', { target_post: post.id }));
                    await loadPosts();
                    if (active) alert('Update archived.', 'success');
                });
            }
        }
        if (!start && !rows.length) communicationElement(postList, 'p', 'No school updates yet.');
        postCount = start + rows.length;
        get('more-posts').hidden = rows.length < COMMUNICATION_PAGE_SIZE;
    }

    const fileInput = publish.elements.document;
    const courseField = publish.elements.course;
    const kindField = publish.elements.kind;
    const documentOption = kindField.querySelector('[value="document"]');
    const audienceStatus = get('audience');

    function updateDocumentField() {
        documentOption.disabled = !admin || courseField.value !== 'school';
        documentOption.hidden = documentOption.disabled;
        if (documentOption.disabled && kindField.value === 'document') kindField.value = 'news';
        const hasDocument = kindField.value === 'document';
        get('document-label').hidden = !hasDocument;
        fileInput.required = hasDocument;
    }

    async function loadAudience() {
        updateDocumentField();
        const version = ++audienceVersion;
        const course = courseField.value;
        const button = publish.querySelector('button[type="submit"]');
        button.disabled = !course;
        audienceStatus.textContent = '';
        if (course === 'school') {
            audienceStatus.textContent = 'Visible to all active portal accounts.';
        } else if (course) {
            const audience = await communicationResult(portalClient.rpc('communication_class_audience', { target_course: course }).single());
            if (!active || version !== audienceVersion) return;
            audienceStatus.textContent = `${audience.family_count} linked family accounts can see this update. ${audience.email_count} can receive email.`;
        }
    }

    handle(publish, 'input', () => delete publish.dataset.requestId);
    handle(courseField, 'change', loadAudience);
    handle(kindField, 'change', updateDocumentField);
    handle(get('more-posts'), 'click', () => loadPosts(true));
    handle(publish, 'submit', async () => {
        const { input, id } = messageRequest(publish);
        const course = input.get('course');
        const kind = input.get('kind');
        const email = input.has('email');
        const file = fileInput.files[0];
        const audience = course === 'school' ? 'all active families with confirmed addresses' : 'families in the selected classroom with confirmed addresses';
        if (email && !window.confirm('Publish this update and queue an email to ' + audience + '?')) return;
        if (kind === 'document') {
            if (!file || !file.name.toLowerCase().endsWith('.pdf') || file.size > 10485760) {
                alert('Choose a PDF no larger than 10 MB.', 'error');
                return;
            }
            const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer());
            if (String.fromCharCode(...signature) !== '%PDF-') {
                alert('Choose a valid PDF file.', 'error');
                return;
            }
            if (postDraft?.file !== file) postDraft = { file, pathId: id, uploaded: false };
            if (!postDraft.uploaded) {
                await communicationResult(portalClient.storage.from(COMMUNICATION_BUCKET)
                    .upload(postDraft.pathId + '/document.pdf', file, { contentType: 'application/pdf' }));
                postDraft.uploaded = true;
            }
        }
        const fields = {
            post_id: kind === 'document' ? postDraft.pathId : id,
            post_kind: kind, post_title: input.get('title'), post_body: input.get('body'),
            email_families: email
        };
        const queued = await communicationResult(course === 'school'
            ? portalClient.rpc('communication_publish', { ...fields, file_name: kind === 'document' ? file.name.slice(0, 200) : null })
            : portalClient.rpc('communication_publish_class', { ...fields, target_course: course }));
        if (!active) return;
        publish.reset();
        delete publish.dataset.requestId;
        postDraft = null;
        courseField.value = course;
        await loadAudience();
        get('publish').open = false;
        await loadPosts();
        alert(email ? 'Published. Emails queued: ' + queued + '.' : 'Update published.', 'success');
    });

    try {
        if (staff) {
            const courses = await communicationResult(portalClient.from('gradebook_courses')
                .select('id,name,term').order('name').order('term'));
            if (!active) return;
            communicationOption(courseField, admin ? 'School-wide' : courses.length ? 'Choose a classroom' : 'No classrooms are assigned', admin ? 'school' : '');
            for (const course of courses) communicationOption(courseField, `${course.name} · ${course.term}`, course.id);
            await loadAudience();
        }
        if (staff || profile.role === 'family') {
            students = await communicationResult(portalClient.rpc('communication_students'));
            if (!active) return;
            communicationOption(studentSelect, students.length ? 'Choose a student' : 'No students are available', '');
            for (const student of students) communicationOption(studentSelect, student.display_name, student.id);
            if (students.some(student => student.id === selectedStudent)) studentSelect.value = selectedStudent;
            else if (students.length === 1) studentSelect.value = students[0].id;
            updateDeliveryChoices();
        }
        content.hidden = false;
        const news = initPortalNews(profile, session, students, selectedStudent, () => active);
        await Promise.all([loadThreads(), loadPosts(), news]);
        if (active) {
            alert('');
            const target = location.hash.slice(1);
            if (['school-updates', 'student-messages', 'student-news', 'newsletters', 'news-submissions'].includes(target) || /^update-[a-f0-9-]{36}$/i.test(target)) {
                document.getElementById(target)?.scrollIntoView();
            }
        }
    } catch (error) { showError(error); }
}

document.addEventListener('DOMContentLoaded', initPortalCommunications);
