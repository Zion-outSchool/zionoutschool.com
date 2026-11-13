/* Homepage disclosure navigation. The shared mobile-menu handler stays in script.js. */
(() => {
    const header = document.querySelector('.homepage header');
    if (!header) return;
    const groups = [...header.querySelectorAll('.nav-group')];
    const mobileToggle = header.querySelector('.mobile-menu');
    const nav = header.querySelector('nav');
    function setGroup(group, open) {
        group.classList.toggle('is-open', open);
        group.querySelector('.nav-group-toggle').setAttribute('aria-expanded', String(open));
        group.querySelector('.nav-dropdown-menu').hidden = !open;
    }
    function closeGroups() { groups.forEach(group => setGroup(group, false)); }
    groups.forEach(group => {
        const toggle = group.querySelector('.nav-group-toggle');
        toggle.addEventListener('click', () => {
            const open = toggle.getAttribute('aria-expanded') !== 'true';
            closeGroups();
            setGroup(group, open);
        });
        group.addEventListener('focusout', event => {
            if (!group.contains(event.relatedTarget)) setGroup(group, false);
        });
    });
    document.addEventListener('click', event => {
        if (!header.contains(event.target)) closeGroups();
    });
    mobileToggle.addEventListener('click', () => {
        mobileToggle.setAttribute('aria-label', nav.classList.contains('open') ? 'Close navigation' : 'Open navigation');
        if (!nav.classList.contains('open')) closeGroups();
    });
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        const openGroup = groups.find(group => group.classList.contains('is-open'));
        if (openGroup) {
            closeGroups();
            openGroup.querySelector('.nav-group-toggle').focus();
        } else if (nav.classList.contains('open')) {
            nav.classList.remove('open', 'show');
            mobileToggle.setAttribute('aria-expanded', 'false');
            mobileToggle.setAttribute('aria-label', 'Open navigation');
            mobileToggle.focus();
        }
    });
    new MutationObserver(() => {
        const open = nav.classList.contains('open');
        mobileToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
        if (!open) closeGroups();
    }).observe(nav, { attributes: true, attributeFilter: ['class'] });
})();
