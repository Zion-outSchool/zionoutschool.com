const fs = require('node:fs');
const path = require('node:path');
const { normalizeZionCurriculumFiles } = require('../curriculum-import.js');
const [reference, folder, output] = process.argv.slice(2);
const pdf = JSON.parse(fs.readFileSync(reference, 'utf8'));
const files = fs.readdirSync(folder).filter(name => name.endsWith('.csv'))
    .map(name => ({ name, text: fs.readFileSync(path.join(folder, name), 'utf8') }));
const { batch } = normalizeZionCurriculumFiles(files, pdf);
const normalize = text => text.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
const pdfItems = new Map(pdf.items.map(item => [item.catalog_key + ':' + item.key, item]));
const catalogMap = new Map(pdf.catalogs.map(catalog => [catalog.key,
    batch.catalogs.find(item => item.subject === catalog.subject && item.level === catalog.level)]));
const originalReviewCounts = new Map();
for (const review of pdf.reviews) {
    const oldCatalog = review.catalog_key;
    const catalog = catalogMap.get(oldCatalog);
    const item = pdfItems.get(oldCatalog + ':' + review.item_key);
    const possible = item ? batch.items.filter(candidate => candidate.catalog_key === catalog.key &&
        normalize(candidate.title) === normalize(item.title) && (catalog.subject === 'ELA'
            ? candidate.sort_order === item.sort_order
            : candidate.unit === item.unit)) : [];
    review.catalog_key = catalog.key;
    review.item_key = possible.length === 1 ? possible[0].key : null;
    if (item && !review.item_key) review.source += ' · PDF item reference has no exact inventory match. Confirm the title and edition.';
    if (item && !review.item_key) originalReviewCounts.set(oldCatalog,(originalReviewCounts.get(oldCatalog)||0)+1);
}
const { batch: native, differences } = normalizeZionCurriculumFiles(files, { ...pdf, catalogs: batch.catalogs });
const combined = { catalogs: native.catalogs, items: native.items, standards: pdf.standards,
    reviews: [...native.reviews, ...pdf.reviews] };
const lines = Object.entries(combined).map(([key, entries]) =>
    '  ' + JSON.stringify(key) + ': [\n' + entries.map(entry => '    ' + JSON.stringify(entry)).join(',\n') + '\n  ]');
fs.writeFileSync(output, '{\n' + lines.join(',\n') + '\n}\n', { mode: 0o600 });
console.log(Object.fromEntries(Object.entries(combined).map(([key, entries]) => [key, entries.length])));
console.log('Dispositions differ:', differences.filter(item => item.message.includes('disposition')).length,
    'item references differ:', differences.filter(item => item.message.includes('different curriculum')).length);
console.log('PDF item references without exact match:', Object.fromEntries(originalReviewCounts));
console.log('Inventory counts:', Object.fromEntries(native.catalogs.map(c => [c.key, native.items.filter(i => i.catalog_key === c.key).length])));
