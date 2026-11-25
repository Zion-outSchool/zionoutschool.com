/* The catalog and crosswalk use stable, publisher-edition-scoped identifiers. */
function readCurriculumCsv(text) {
    const rows = [];
    let row = [], cell = '', quoted = false, closed = false;
    const input = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    for (let index = 0; index <= input.length; index++) {
        const char = index === input.length ? '\n' : input[index];
        if (quoted) {
            if (char === '"' && input[index + 1] === '"') {
                cell += '"';
                index++;
            } else if (char === '"') {
                quoted = false;
                closed = true;
            } else cell += char;
        } else if (char === ',' || char === '\n') {
            row.push(cell.trim());
            cell = '';
            closed = false;
            if (char === '\n') {
                if (row.some(Boolean)) rows.push(row);
                row = [];
            }
        } else if (char === '"' && !cell && !closed) {
            quoted = true;
        } else {
            if (closed || char === '"') throw new Error('Check the quotes in this CSV file.');
            cell += char;
        }
    }
    if (quoted) throw new Error('A quoted CSV field is missing its closing quote.');
    const headers = rows.shift() || [];
    if (!headers.length || headers.some(header => !header) || new Set(headers).size !== headers.length) {
        throw new Error('The CSV must start with a unique header for every column.');
    }
    return rows.map((values, index) => {
        if (values.length !== headers.length) throw new Error('Check the number of fields on CSV row ' + (index + 2) + '.');
        return Object.fromEntries(headers.map((header, column) => [header, values[column]]));
    });
}

function buildCurriculumImport(files, reference) {
    const batch = { catalogs: [], items: [], standards: [], reviews: [] };
    const catalogKeys = new Map(reference.catalogs.map(catalog => [catalog.key, catalog]));
    const standardKeys = new Map(reference.standards.map(standard => [standard.key, standard]));
    const inventoryKeys = new Set();
    const reviewKeys = new Set();
    const editionsWithInventory = new Set();
    const statuses = {
        'candidate link': 'candidate', 'partial link': 'partial', 'search lead': 'search',
        'documented supplement': 'supplement', 'separate checkpoint': 'checkpoint',
        'evidence needed': 'needed', 'unreviewed': 'unreviewed'
    };
    const comparison = new Map(reference.reviews.map(row => [
        [row.standard_key, row.catalog_key, row.item_key || ''].join('|'), row.disposition
    ]));
    const differences = [];
    const matched = new Set();
    let hasReviewFiles = false;
    function requireFields(row, fields) {
        const missing = fields.filter(field => !row[field]);
        if (missing.length) throw new Error('A CSV row needs ' + missing.join(', ') + '.');
    }
    for (const file of files) {
        for (const row of readCurriculumCsv(file.text)) {
            if (!Object.hasOwn(row, 'publisher')) continue;
            requireFields(row, ['key', 'subject', 'title', 'publisher', 'level', 'edition', 'source']);
            const catalog = {
                key: row.key, subject: row.subject, title: row.title, publisher: row.publisher, level: row.level,
                edition: row.edition, source: row.source, inventory_complete: false,
                suggested_grades: (row.suggested_grades || '').split(/\s*[|;]\s*/).filter(Boolean)
                    .map(grade => /^k$/i.test(grade) ? 0 : Number(grade))
            };
            if (catalog.suggested_grades.some(grade => !Number.isInteger(grade) || grade < 0 || grade > 12)) {
                throw new Error('Use K or a grade from 1 through 12 for suggested grades.');
            }
            const existing = catalogKeys.get(catalog.key);
            if (existing && ['subject', 'publisher', 'level', 'edition'].some(field => existing[field] !== catalog[field])) {
                throw new Error('Use a new catalog key when the publisher, level, subject, or edition changes.');
            }
            catalogKeys.set(catalog.key, catalog);
            if (row.inventory_complete === 'true') editionsWithInventory.add(catalog.key);
            batch.catalogs.push(catalog);
        }
    }
    for (const file of files) {
        const rows = readCurriculumCsv(file.text);
        if (!rows.length) continue;
        const first = rows[0];
        for (const row of rows) {
            if (Object.hasOwn(first, 'publisher')) continue;
            if (Object.hasOwn(first, 'sort_order')) {
                requireFields(row, ['catalog_key', 'key', 'unit', 'sort_order', 'title', 'kind', 'source']);
                if (!catalogKeys.has(row.catalog_key)) throw new Error('Unknown catalog key ' + row.catalog_key + '.');
                const key = [row.catalog_key, row.key].join('|');
                if (inventoryKeys.has(key)) throw new Error('Duplicate lesson key ' + key + '.');
                inventoryKeys.add(key);
                const position = Number(row.sort_order);
                if (!Number.isSafeInteger(position) || position < 0 || position > 2147483647) {
                    throw new Error('Sort order must be a nonnegative whole number.');
                }
                batch.items.push({ catalog_key: row.catalog_key, key: row.key, unit: row.unit, title: row.title,
                    sort_order: position, kind: row.kind.toLowerCase(), page_ref: row.page_ref || null,
                    online_ref: row.online_ref || null, source: row.source, provisional: false });
            } else if (Object.hasOwn(first, 'disposition')) {
                hasReviewFiles = true;
                requireFields(row, ['key', 'standard_key', 'catalog_key', 'disposition', 'source']);
                if (!catalogKeys.has(row.catalog_key) || !standardKeys.has(row.standard_key)) {
                    throw new Error('Unknown catalog or standard on review ' + row.key + '.');
                }
                if (reviewKeys.has(row.key)) throw new Error('Duplicate review key ' + row.key + '.');
                reviewKeys.add(row.key);
                const label = row.disposition.toLowerCase();
                const disposition = statuses[label] || (Object.values(statuses).includes(label) && label);
                if (!disposition) throw new Error('Unknown review status ' + row.disposition + '. Imported links always require review.');
                const itemKey = row.item_key || null;
                const comparable = [row.standard_key, row.catalog_key, itemKey || ''].join('|');
                const pdfDisposition = comparison.get(comparable);
                const difference = pdfDisposition === disposition ? '' : pdfDisposition
                    ? 'PDF review status is ' + pdfDisposition + '.'
                    : 'No PDF review uses the same catalog and item identifiers.';
                if (pdfDisposition) matched.add(comparable);
                if (difference) differences.push({ key: row.key, standard: row.standard_key, message: difference });
                batch.reviews.push({ key: row.key, standard_key: row.standard_key, catalog_key: row.catalog_key,
                    item_key: itemKey, disposition, covered: row.covered || null, evidence_needed: row.evidence_needed || null,
                    source: [row.source, difference].filter(Boolean).join(' · ') });
            } else {
                throw new Error('Add a recognized curriculum CSV header to ' + file.name + '.');
            }
        }
    }
    for (const catalog of batch.catalogs) {
        if (editionsWithInventory.has(catalog.key)) {
            if (!batch.items.some(item => item.catalog_key === catalog.key)) {
                throw new Error('Include the lesson inventory for ' + catalog.key + ' before marking it complete.');
            }
            catalog.inventory_complete = true;
        }
    }
    if (hasReviewFiles) {
        const pdfOnly = [...comparison.keys()].filter(key => !matched.has(key)).map(key => key.split('|'));
        const totals = new Map();
        for (const [, catalog] of pdfOnly) totals.set(catalog, (totals.get(catalog) || 0) + 1);
        for (const [catalog, total] of totals) {
            differences.push({ key: catalog, message: total + ' PDF review references have no exact match in this CSV batch.' });
        }
    }
    return { batch, differences };
}

if (typeof module !== 'undefined') module.exports = { readCurriculumCsv, buildCurriculumImport };

function normalizeZionCurriculumFiles(files, reference) {
    const rows = files.flatMap(file => readCurriculumCsv(file.text)
        .map(values => ({ ...values, fileName: file.name })));
    const recognized = row => ('unit_or_chapter' in row && 'item_id' in row) ||
        'mapping_status' in row || 'auto_apply' in row || ('curriculum_sections' in row && 'item_ids' in row);
    if (!rows.some(recognized)) return null;
    if (!rows.every(recognized)) throw new Error('Import the Zion package separately from custom CSVs.');

    const batch = { catalogs: [], items: [], standards: [], reviews: [] };
    const catalogByLevel = new Map();
    const standardByCode = new Map(reference.standards.map(standard => [standard.code, standard]));
    const itemById = new Map();
    const sourceStatus = new Map();
    const statusNames = {
        'search lead': 'search', 'candidate link': 'candidate', candidate: 'candidate',
        'partial link': 'partial', partial: 'partial', 'documented supplement': 'supplement',
        'separate checkpoint proposed': 'checkpoint', 'needs evidence route': 'needed'
    };
    const pdfByStandard = new Map();
    for (const review of reference.reviews.filter(item => item.key.startsWith('zion-pdf-'))) {
        if (!pdfByStandard.has(review.standard_key)) pdfByStandard.set(review.standard_key, { status: review.disposition, ids: new Set() });
        if (review.item_key) pdfByStandard.get(review.standard_key).ids.add(review.item_key);
    }

    const subjectFor = publisher => publisher === 'Good and Beautiful ELA' ? 'ELA'
        : publisher === 'Beast Academy' ? 'Math' : null;
    const catalogFor = (subject, level) => catalogByLevel.get(subject + ':' + level);
    const split = value => (value || '').split(/\s*\|\s*/).filter(Boolean);
    function digest(fields) {
        let hash = 2166136261;
        for (const glyph of JSON.stringify(fields)) {
            hash = Math.imul(hash ^ glyph.codePointAt(0), 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    for (const row of rows.filter(item => 'unit_or_chapter' in item)) {
        const subject = subjectFor(row.curriculum);
        if (!subject || !row.edition || !row.item_id || !row.item_label || !row.source_url) {
            throw new Error('A Zion inventory row is missing its publisher, edition, item ID, label, or source.');
        }
        let catalog = catalogFor(subject, row.level);
        if (catalog && catalog.edition !== row.edition) {
            throw new Error('Import one edition per publisher and level per batch so review links resolve to the correct edition.');
        }
        if (!catalog) {
            const level = row.level === 'K' ? 0 : Number(row.level);
            if (!Number.isInteger(level) || level < 0 || level > 12) throw new Error('Check the inventory level.');
            const editionId = row.edition.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
            catalog = {
                key: (subject === 'ELA' ? 'tgtb-' : 'beast-') + level + '-' + editionId,
                subject, title: subject === 'ELA' ? 'The Good and the Beautiful Language Arts' : 'Beast Academy Math',
                publisher: subject === 'ELA' ? 'The Good and the Beautiful' : 'Beast Academy', level: row.level,
                edition: row.edition, source: row.source_url,
                suggested_grades: subject === 'Math' && level === 1 ? [0,1] : subject === 'Math' && level === 5 ? [5,6] : [level],
                inventory_complete: false
            };
            catalogByLevel.set(subject + ':' + row.level, catalog);
            batch.catalogs.push(catalog);
        }
        if (itemById.has(row.item_id)) throw new Error('Duplicate Zion inventory item ' + row.item_id + '.');
        const sequence = Number(row.sequence);
        if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 999) throw new Error('Check the item order on ' + row.item_id + '.');
        const chapter = /^Chapter (\d+)/i.exec(row.unit_or_chapter);
        const group = Math.floor((sequence - 1) / 20) * 20 + 1;
        const item = {
            catalog_key: catalog.key, key: row.item_id,
            unit: chapter ? row.unit_or_chapter : row.unit_or_chapter + ' · Lessons ' + group + '–' + (group + 19),
            sort_order: chapter ? Number(chapter[1]) * 1000 + sequence : sequence,
            title: row.item_label, kind: /^(unit |chapter )?(assessment|test)\b/i.test(row.item_label) ? 'assessment' : subject === 'ELA' ? 'lesson' : 'section',
            page_ref: [row.book_location_or_guide && (subject === 'ELA' ? 'p. ' : 'Guide ') + row.book_location_or_guide,
                row.practice && 'Practice ' + row.practice].filter(Boolean).join(' · ') || null,
            online_ref: row.online || null, source: row.source_url, provisional: false
        };
        itemById.set(row.item_id, item);
        batch.items.push(item);
    }
    for (const catalog of batch.catalogs) {
        const count = batch.items.filter(item => item.catalog_key === catalog.key).length;
        catalog.inventory_complete = catalog.subject === 'ELA' ? count === 120 :
            new Set(batch.items.filter(item => item.catalog_key === catalog.key).map(item => item.unit)).size === 12;
    }

    function reviewRow(row, origin, knownSubject, level, itemKey, disposition, covered, evidence, source, difference) {
        const standard = standardByCode.get(row.standard_code);
        const catalog = catalogFor(knownSubject, level);
        if (!standard || standard.subject !== knownSubject || !catalog) {
            throw new Error('Include the matching curriculum inventory and Arkansas standard for ' + row.standard_code + '.');
        }
        const item = itemById.get(itemKey);
        if (itemKey && item?.catalog_key !== catalog.key) throw new Error('Unknown item ' + itemKey + ' on ' + row.standard_code + '.');
        if (!disposition) throw new Error('Unknown source disposition on ' + row.standard_code + '.');
        const signature = [origin, standard.key, catalog.key, itemKey || 'review', disposition, covered, evidence, source];
        const key = ['zion-csv', origin, standard.key, catalog.key, itemKey || 'review', digest(signature)].join(':');
        batch.reviews.push({ key, standard_key: standard.key, catalog_key: catalog.key, item_key: itemKey || null, disposition,
            covered: covered || null, evidence_needed: evidence || null, source: [source || row.fileName, difference].filter(Boolean).join(' · ') });
    }

    const differences = [];
    for (const row of rows.filter(item => 'auto_apply' in item)) {
        const disposition = statusNames[row.review_status.toLowerCase()];
        const standard = standardByCode.get(row.standard_code);
        if (!standard) throw new Error('Unknown standard ' + row.standard_code + '.');
        const pdf = pdfByStandard.get(standard.key);
        const leads = split(row.search_lead_item_ids);
        const linked = split(row.reviewed_link_ids);
        const ids = new Set([...leads, ...linked]);
        sourceStatus.set(standard.key, disposition);
        let difference = '';
        if (pdf?.status && pdf.status !== disposition) {
            difference = 'PDF disposition differs: ' + pdf.status + ' instead of ' + disposition + '.';
        } else if (pdf && ([...pdf.ids].some(id => !ids.has(id)) || [...ids].some(id => !pdf.ids.has(id)))) {
            difference = 'The PDF and CSV refer to different curriculum items.';
        }
        if (difference) differences.push({ key: row.standard_code, message: difference });
        const context = linked.length ? 'Reviewed item IDs: ' + linked.join(', ') : '';
        const reference = [row.fileName, row.official_standard_source].filter(Boolean).join(' · ');
        reviewRow(row, 'coverage', row.subject, row.reference_level, null, disposition, context,
            row.teacher_evidence_or_next_action, reference, difference);
        for (const key of leads) {
            reviewRow(row, 'lead', row.subject, row.reference_level, key, 'search', null,
                row.teacher_evidence_or_next_action, reference, '');
        }
    }
    for (const row of rows.filter(item => 'mapping_status' in item)) {
        const disposition = statusNames[row.mapping_status.toLowerCase()];
        if (disposition === 'supplement' && sourceStatus.get(standardByCode.get(row.standard_code)?.key) === disposition) continue;
        reviewRow(row, 'link', subjectFor(row.curriculum), row.level, row.item_id, disposition, row.component,
            row.teacher_evidence, row.source_url, '');
    }
    for (const row of rows.filter(item => 'curriculum_sections' in item)) {
        const disposition = statusNames[row.review_status.toLowerCase()];
        const ids = split(row.item_ids);
        for (const key of ids.length ? ids : [null]) {
            const source = [row.fileName, row.publisher_sequence, row.arkansas_source].filter(Boolean).join(' · ');
            const standard = standardByCode.get(row.standard_code);
            const existing = batch.reviews.some(review => review.standard_key === standard?.key && review.item_key === key &&
                review.disposition === disposition && review.evidence_needed === row.teacher_checkpoint &&
                (review.covered || !key) === (row.mapped_component || !key));
            if (!existing) reviewRow(row, 'grade6', 'Math', '5', key, disposition, row.mapped_component, row.teacher_checkpoint, source, '');
        }
    }
    return { batch, differences };
}

if (typeof module !== 'undefined') module.exports.normalizeZionCurriculumFiles = normalizeZionCurriculumFiles;
