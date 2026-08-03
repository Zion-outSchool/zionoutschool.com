/* ============================================================
   ZION outSchool - script.js
   ============================================================ */

/* Mobile navigation */
function toggleMenu() {
    const menu = document.getElementById('nav-menu');
    const mobileMenuBtn = document.querySelector('.mobile-menu');
    if (!menu) return;

    const isOpen = menu.classList.toggle('open');
    menu.classList.toggle('show', isOpen);
    if (mobileMenuBtn) {
        mobileMenuBtn.setAttribute('aria-expanded', String(isOpen));
    }
}

const mobileMenuBtn = document.querySelector('.mobile-menu');
const navMenu = document.getElementById('nav-menu');

if (mobileMenuBtn && navMenu) {
    mobileMenuBtn.setAttribute('aria-expanded', 'false');

    mobileMenuBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleMenu();
    });

    navMenu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            navMenu.classList.remove('open', 'show');
            mobileMenuBtn.setAttribute('aria-expanded', 'false');
        });
    });

    document.addEventListener('click', (event) => {
        if (!navMenu.contains(event.target) && !mobileMenuBtn.contains(event.target)) {
            navMenu.classList.remove('open', 'show');
            mobileMenuBtn.setAttribute('aria-expanded', 'false');
        }
    });
}

/* Smooth scrolling for in-page links */
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (event) {
        const target = document.querySelector(this.getAttribute('href'));
        if (!target) return;

        event.preventDefault();
        target.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    });
});

/* Active nav link */
const currentPage = window.location.pathname.split('/').pop() || 'index.html';
document.querySelectorAll('nav a').forEach(link => {
    const linkPage = link.getAttribute('href');
    if (linkPage === currentPage) {
        link.classList.add('active');
    }
});

/* Scroll fade-in animation */
const fadeEls = document.querySelectorAll('.fade-in, .card, .method-card, .value-card, .belief-item, .pricing-card');

if (fadeEls.length > 0 && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -40px 0px'
    });

    fadeEls.forEach(el => {
        el.classList.add('fade-in');
        observer.observe(el);
    });
} else {
    fadeEls.forEach(el => el.classList.add('visible'));
}

/* Expandable cards */
function toggleCard(el) {
    const card = el.closest('.expandable-card');
    if (!card) return;

    const preview = card.querySelector('.card-preview');
    const full = card.querySelector('.card-full');
    if (!preview || !full) return;

    const isExpanded = card.classList.toggle('is-expanded');
    full.style.display = isExpanded ? 'block' : 'none';
    preview.style.display = isExpanded ? 'none' : 'block';
}

document.querySelectorAll('.expandable-card').forEach(card => {
    const preview = card.querySelector('.card-preview');
    const closeBtns = card.querySelectorAll('.expand-btn--close');

    if (preview && !preview.hasAttribute('onclick')) {
        preview.addEventListener('click', () => toggleCard(preview));
    }

    closeBtns.forEach(btn => {
        if (!btn.hasAttribute('onclick')) {
            btn.addEventListener('click', () => toggleCard(btn));
        }
    });
});

/* FAQ accordions */
function toggleCluster(header) {
    const body = header.nextElementSibling;
    const chevron = header.querySelector('.cluster-chevron');
    if (!body) return;

    const isOpen = body.classList.contains('open') || header.getAttribute('aria-expanded') === 'true';
    body.classList.toggle('open', !isOpen);
    body.style.display = isOpen ? 'none' : 'block';
    header.setAttribute('aria-expanded', String(!isOpen));
    if (chevron) chevron.classList.toggle('open', !isOpen);
}

document.querySelectorAll('.cluster-header').forEach(btn => {
    btn.addEventListener('click', () => toggleCluster(btn));
});

document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
        const answer = btn.nextElementSibling;
        if (!answer) return;

        const isOpen = answer.classList.contains('open') || btn.getAttribute('aria-expanded') === 'true';
        answer.classList.toggle('open', !isOpen);
        answer.style.display = isOpen ? 'none' : 'block';
        btn.setAttribute('aria-expanded', String(!isOpen));
    });
});

/* Testimonial expand/collapse */
function toggleTestimonial(btn) {
    const full = btn.previousElementSibling;
    if (!full) return;

    const isOpen = full.style.display === 'block';
    full.style.display = isOpen ? 'none' : 'block';
    btn.textContent = isOpen ? 'Read More ▼' : 'Read Less ▲';
}

/* Student quote rotator */
let currentQuote = 0;
const quotes = document.querySelectorAll('.student-quote');
const dots = document.querySelectorAll('.quote-dot');

function showQuote(index) {
    if (!quotes.length || !dots.length) return;

    quotes.forEach(q => q.style.display = 'none');
    dots.forEach(d => d.style.background = '#ccc');
    quotes[index].style.display = 'block';
    dots[index].style.background = '#e0b555';
    currentQuote = index;
}

function changeQuote(direction) {
    if (!quotes.length || !dots.length) return;

    let next = currentQuote + direction;
    if (next < 0) next = quotes.length - 1;
    if (next >= quotes.length) next = 0;
    showQuote(next);
}

function goToQuote(index) {
    showQuote(index);
}

if (quotes.length && dots.length) {
    showQuote(0);
    setInterval(() => changeQuote(1), 5000);
}

/* Home RSVP modal */
const rsvpModal = document.getElementById('rsvp-modal');
const rsvpForm = document.getElementById('rsvp-form');
const rsvpOpenButtons = document.querySelectorAll('[data-rsvp-open]');
const rsvpCloseButtons = document.querySelectorAll('[data-rsvp-close]');
let rsvpLastFocus = null;

function openRsvpModal(event) {
    if (!rsvpModal) return;
    if (event) event.preventDefault();

    rsvpLastFocus = document.activeElement;
    rsvpModal.hidden = false;
    document.body.style.overflow = 'hidden';

    const firstField = rsvpModal.querySelector('input, textarea, button, a');
    if (firstField) firstField.focus();
}

function closeRsvpModal() {
    if (!rsvpModal) return;

    rsvpModal.hidden = true;
    document.body.style.overflow = '';

    if (rsvpLastFocus && typeof rsvpLastFocus.focus === 'function') {
        rsvpLastFocus.focus();
    }
}

rsvpOpenButtons.forEach(button => {
    button.addEventListener('click', openRsvpModal);
});

rsvpCloseButtons.forEach(button => {
    button.addEventListener('click', closeRsvpModal);
});

if (rsvpModal) {
    rsvpModal.addEventListener('click', event => {
        if (event.target === rsvpModal) {
            closeRsvpModal();
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !rsvpModal.hidden) {
            closeRsvpModal();
        }
    });
}

if (rsvpForm) {
    rsvpForm.addEventListener('submit', event => {
        event.preventDefault();

        if (!rsvpForm.checkValidity()) {
            rsvpForm.reportValidity();
            return;
        }

        const formData = new FormData(rsvpForm);
        const details = {
            parentName: formData.get('parentName') || '',
            parentEmail: formData.get('parentEmail') || '',
            parentPhone: formData.get('parentPhone') || '',
            attendingCount: formData.get('attendingCount') || '',
            studentName: formData.get('studentName') || '',
            studentGrade: formData.get('studentGrade') || '',
            lookingFor: formData.get('lookingFor') || ''
        };

        const subject = 'Open House RSVP';
        const body = [
            'Open House RSVP',
            '',
            `Parent / Guardian: ${details.parentName}`,
            `Email: ${details.parentEmail}`,
            `Phone: ${details.parentPhone || 'Not provided'}`,
            `Number attending: ${details.attendingCount}`,
            '',
            `Student name: ${details.studentName || 'Not provided'}`,
            `Student age / grade: ${details.studentGrade || 'Not provided'}`,
            '',
            'What we are hoping to learn or ask about:',
            details.lookingFor || 'Not provided',
            '',
            'Source: Home page open house banner'
        ].join('\n');

        window.location.href = `mailto:RSVP@zionoutschool.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
}
