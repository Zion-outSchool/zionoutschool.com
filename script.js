        // Mobile menu toggle
        function toggleMenu() {
            const menu = document.getElementById('nav-menu');
            menu.classList.toggle('show');
            menu.classList.toggle('open');
        }

        // Close mobile menu when clicking on a link
        document.querySelectorAll('nav a').forEach(link => {
            link.addEventListener('click', () => {
                document.getElementById('nav-menu').classList.remove('show', 'open');
            });
        });

        // Smooth scrolling for navigation links
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const target = document.querySelector(this.getAttribute('href'));
                if (target) {
                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            });
        });

        // Fade in animation on scroll
        const observerOptions = {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                }
            });
        }, observerOptions);

        // Observe all cards and sections
        document.querySelectorAll('.card, .method-card, .value-card, .belief-item, .pricing-card').forEach(el => {
            el.classList.add('fade-in');
            observer.observe(el);
        });

        // FAQ accordion functionality
        document.querySelectorAll('.faq-question').forEach(question => {
            question.addEventListener('click', () => {
                const answer = question.nextElementSibling;
                const isOpen = answer.style.display === 'block';
                
                // Close all other FAQ items
                document.querySelectorAll('.faq-answer').forEach(ans => {
                    ans.style.display = 'none';
                });
                
                // Toggle current item
                answer.style.display = isOpen ? 'none' : 'block';
            });
        });
        // Expandable cards
function toggleCard(el) {
    const card = el.closest('.expandable-card');
    const preview = card.querySelector('.card-preview');
    const full = card.querySelector('.card-full');
    const isExpanded = card.classList.toggle('is-expanded');
    full.style.display = isExpanded ? 'block' : 'none';
    preview.style.display = isExpanded ? 'none' : 'block';
}

document.querySelectorAll('.expandable-card .card-preview:not([onclick]), .expandable-card .expand-btn--close:not([onclick])').forEach(trigger => {
    trigger.addEventListener('click', () => toggleCard(trigger));
});
        function toggleCluster(header) {
    const body = header.nextElementSibling;
    const chevron = header.querySelector('.cluster-chevron');
    const isOpen = body.style.display === 'block';
    body.style.display = isOpen ? 'none' : 'block';
    chevron.classList.toggle('open', !isOpen);
}
       // Testimonial expand/collapse
function toggleTestimonial(btn) {
    const full = btn.previousElementSibling;
    const isOpen = full.style.display === 'block';
    full.style.display = isOpen ? 'none' : 'block';
    btn.textContent = isOpen ? 'Read More ▼' : 'Read Less ▲';
}

// Student quote rotator
let currentQuote = 0;
const quotes = document.querySelectorAll('.student-quote');
const dots = document.querySelectorAll('.quote-dot');

function showQuote(index) {
    quotes.forEach(q => q.style.display = 'none');
    dots.forEach(d => d.style.background = '#ccc');
    quotes[index].style.display = 'block';
    dots[index].style.background = '#e0b555';
    currentQuote = index;
}

function changeQuote(direction) {
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
    const mobileMenu = document.querySelector('.mobile-menu');
    const navMenu = document.getElementById('nav-menu');
    if (mobileMenu) {
        mobileMenu.addEventListener('click', () => navMenu.classList.toggle('open'));
    }
