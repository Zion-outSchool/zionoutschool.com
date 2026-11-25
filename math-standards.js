/* global portalClient, appendTextElement */

const K8_GRADE_LABELS = { K: 'Kindergarten', 1: 'Grade 1', 2: 'Grade 2', 3: 'Grade 3', 4: 'Grade 4',
    5: 'Grade 5', 6: 'Grade 6', 7: 'Grade 7', 8: 'Grade 8' };
let mathStandardsCatalog;

function loadMathStandardsCatalog() {
    mathStandardsCatalog ??= (async () => {
        const { data, error } = await portalClient.rpc('k8_math_catalog');
        if (error) throw error;
        return data;
    })().catch(error => {
        mathStandardsCatalog = null;
        throw error;
    });
    return mathStandardsCatalog;
}

function createMathStandardsPicker(catalog, initial = [], preferredGrade = 'K') {
    const element = document.createElement('div');
    element.className = 'math-standards-picker';
    const controls = appendTextElement(element, 'div', '', 'math-standards-filters');
    const gradeLabel = appendTextElement(controls, 'label', 'Standards grade');
    const grade = document.createElement('select');
    gradeLabel.append(grade);
    for (const level of catalog.levels) {
        const option = appendTextElement(grade, 'option', K8_GRADE_LABELS[level.grade]);
        option.value = level.grade;
    }
    grade.value = catalog.levels.some(level => level.grade === String(preferredGrade)) ? String(preferredGrade) : 'K';

    const domainLabel = appendTextElement(controls, 'label', 'Math domain');
    const domain = document.createElement('select');
    domainLabel.append(domain);

    const queryLabel = appendTextElement(controls, 'label', 'Find a code or topic');
    const query = document.createElement('input');
    query.type = 'search';
    query.placeholder = 'Fractions, 3.NPV.6';
    queryLabel.append(query);

    const sources = appendTextElement(element, 'div', '', 'math-standards-sources');
    const selectedText = appendTextElement(element, 'p', '', 'math-standards-selected');
    selectedText.setAttribute('role', 'status');
    const list = appendTextElement(element, 'div', '', 'math-standards-list');
    list.tabIndex = 0;
    list.setAttribute('role', 'region');
    list.setAttribute('aria-label', 'Matching math standards');
    const codes = new Set(initial);
    const collator = new Intl.Collator(undefined, { numeric: true });

    function renderDomains() {
        domain.replaceChildren();
        appendTextElement(domain, 'option', 'All domains').value = '';
        for (const name of new Set(catalog.standards.filter(item => item.grade === grade.value).map(item => item.domain))) {
            appendTextElement(domain, 'option', name).value = name;
        }
        const level = catalog.levels.find(item => item.grade === grade.value);
        sources.replaceChildren();
        for (const [label, href] of [
            ['DESE 2023 · pp. ' + level.first_page + '–' + level.last_page, catalog.source_url + '#page=' + level.first_page],
            ['IXL practice alignment', level.practice_url],
        ]) {
            const link = appendTextElement(sources, 'a', label);
            link.href = href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        }
    }

    function renderSelection() {
        const values = [...codes].sort(collator.compare);
        selectedText.textContent = values.length ? `${values.length} selected · ${values.join(', ')}` : 'No standards selected.';
    }

    function renderList() {
        const term = query.value.trim().toLowerCase();
        const filtered = catalog.standards.filter(item => item.grade === grade.value
            && (!domain.value || item.domain === domain.value)
            && `${item.code} ${item.topic} ${item.domain}`.toLowerCase().includes(term))
            .sort((a, b) => a.source_page - b.source_page || collator.compare(a.code, b.code));
        list.replaceChildren();
        if (!filtered.length) appendTextElement(list, 'p', 'No standards match this filter.');
        for (const item of filtered) {
            const label = appendTextElement(list, 'label', '', 'math-standards-option');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = codes.has(item.code);
            input.onchange = () => {
                if (input.checked) codes.add(item.code);
                else codes.delete(item.code);
                renderSelection();
            };
            label.append(input, document.createTextNode(item.code + ' · ' + item.topic));
        }
        renderSelection();
    }

    grade.onchange = () => {
        renderDomains();
        renderList();
    };
    domain.onchange = query.oninput = renderList;
    renderDomains();
    renderList();
    return {
        element,
        selected: () => [...codes],
        setSelection: values => {
            codes.clear();
            for (const value of values || []) codes.add(value);
            renderList();
        },
    };
}
