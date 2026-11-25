async function createMiddleSchoolTranscriptPdf(snapshot) {
    if (!window.PDFLib) throw new Error('The PDF library could not load. Reload the page before issuing.');
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const documentPdf = await PDFDocument.create();
    const regular = await documentPdf.embedFont(StandardFonts.Helvetica);
    const bold = await documentPdf.embedFont(StandardFonts.HelveticaBold);
    const ink = rgb(.10, .20, .17);
    const muted = rgb(.26, .33, .30);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let page;
    let y;
    const margin = 51;
    const maxWidth = 510;

    function newPage() {
        page = documentPdf.addPage([612, 792]);
        y = 738;
    }

    function measure(text, font, size) {
        try { return font.widthOfTextAtSize(text, size); } catch {
            ctx.font = `${font === bold ? 'bold ' : ''}${size}px Arial, sans-serif`;
            return ctx.measureText(text).width;
        }
    }

    function wrap(text, font, size) {
        const lines = [];
        for (const paragraph of String(text).replace(/\t/g, '    ').split(/\r?\n/)) {
            let line = '';
            for (const word of paragraph.split(/\s+/).filter(Boolean)) {
                const candidate = line ? line + ' ' + word : word;
                if (measure(candidate, font, size) <= maxWidth) {
                    line = candidate;
                    continue;
                }
                if (line) lines.push(line);
                line = '';
                for (const glyph of word) {
                    if (line && measure(line + glyph, font, size) > maxWidth) {
                        lines.push(line);
                        line = '';
                    }
                    line += glyph;
                }
            }
            lines.push(line);
        }
        return lines;
    }

    async function line(text, { font = regular, size = 10, color = ink, gap = 0 } = {}) {
        for (const chunk of wrap(text, font, size)) {
            if (y < margin + size) newPage();
            if (chunk) {
                try {
                    page.drawText(chunk, { x: margin, y, size, font, color });
                } catch {
                    const scale = 3;
                    const width = Math.ceil(measure(chunk, font, size)) + 4;
                    const height = Math.ceil(size * 1.55);
                    canvas.width = width * scale;
                    canvas.height = height * scale;
                    ctx.scale(scale, scale);
                    ctx.font = `${font === bold ? 'bold ' : ''}${size}px Arial, sans-serif`;
                    ctx.fillStyle = '#1a332b';
                    ctx.textBaseline = 'alphabetic';
                    ctx.fillText(chunk, 0, size);
                    const image = await documentPdf.embedPng(canvas.toDataURL('image/png'));
                    page.drawImage(image, { x: margin, y: y - (height - size), width, height });
                }
            }
            y -= size * 1.4;
        }
        y -= gap;
    }

    function space(needed) {
        if (y - needed < margin) newPage();
    }

    newPage();
    const title = snapshot.document_title || 'Middle School Transcript';
    documentPdf.setTitle(title);
    documentPdf.setAuthor(snapshot.issuer);
    await line(snapshot.issuer, { font: bold, size: 12 });
    await line(snapshot.contact, { color: muted, gap: 14 });
    await line(title, { font: bold, size: 25, gap: 6 });
    await line(snapshot.legal_name, { font: bold, size: 15 });
    await line((snapshot.preview ? 'Preview only  |  ' : 'Issued ') + snapshot.issued_on, { color: muted, gap: 18 });

    if (snapshot.curriculum_record) {
        for (const entry of snapshot.publications) {
            space(70);
            const grade = Number(entry.grade) === 0 ? 'Kindergarten' : 'Grade ' + entry.grade;
            await line([entry.year, grade, entry.period, (entry.as_of ? 'As of ' + entry.as_of : 'Through ' + entry.period_end)].join('  |  '),
                { font: bold, size: 13, gap: 7 });
            if (entry.purpose) await line(entry.purpose, { color: muted, gap: 6 });
            for (const course of entry.courses) {
                space(55);
                await line(course.title, { font: bold, size: 11 });
                await line(['Instructional level ' + course.level, course.edition, course.status].join('  |  '),
                    { color: muted });
                await line(course.completed + ' curriculum item(s) completed through this reporting period');
                for (const result of course.results) {
                    await line(result.title + '  |  ' + result.result + (result.kind === 'proficiency' ? ' (proficiency)' : ''));
                }
                y -= 8;
            }
            if (entry.accomplishment) await line('Accomplishment  |  ' + entry.accomplishment, { gap: 5 });
            if (entry.next_step) await line('Next step  |  ' + entry.next_step, { gap: 5 });
            if (entry.standards.length) {
                space(65);
                await line('Arkansas standards summary', { font: bold, size: 11, gap: 3 });
                for (const standard of entry.standards) {
                    await line([standard.code, 'Edition ' + standard.edition, standard.description,
                        entry.scale?.find(mark => mark.key === standard.mark)?.label || (entry.scale ? 'Not yet assessed' : standard.demonstrated ? 'Demonstrated' : 'Taught')].filter(Boolean).join('  |  '));
                }
            }
            if (entry.scale?.length || entry.grading_key) {
                space(60);
                await line('Grading key', { font: bold, size: 11, gap: 3 });
                for (const mark of entry.scale || []) await line(mark.label + ' — ' + mark.description);
                if (entry.scale?.length) await line('Not yet assessed means there is no reported proficiency mark.');
                if (entry.grading_key) await line(entry.grading_key, { gap: 5 });
            }
            y -= 12;
        }
        space(92);
        if (snapshot.grading_key) {
            await line('Grading key', { font: bold, size: 13, gap: 3 });
            await line(snapshot.grading_key, { gap: 10 });
        }
        await line('Office certification', { font: bold, size: 13, gap: 3 });
        await line(snapshot.preview ? 'Preview for office review.' : 'I certify that this copy reflects the verified results selected for issuance.');
        await line(snapshot.signer + '  |  ' + snapshot.signer_title, { font: bold });
    } else {
        const awarded = new Set();
        for (const year of snapshot.years || []) {
            const results = snapshot.results.filter(result => result.year_id === year.id);
            space(78);
            await line(year.year + '  |  ' + (Number(year.grade) === 0 ? 'Kindergarten' : 'Grade ' + year.grade),
                { font: bold, size: 13, gap: 3 });
            const dates = [year.entered_on && 'Entered ' + year.entered_on, year.withdrawn_on && 'Withdrawn ' + year.withdrawn_on,
                year.progression].filter(Boolean).join('  |  ');
            if (dates) await line(dates, { color: muted, gap: 4 });
            if (!results.length) await line('No entries selected for this enrollment.', { color: muted, gap: 6 });
            for (const result of results) {
                space(57);
                await line(result.title, { font: bold, size: 11 });
                const when = [result.term, [result.starts_on, result.ends_on].filter(Boolean).join(' to ')].filter(Boolean).join('  |  ');
                await line([result.area, 'Instructional level ' + result.instructional_level, when].filter(Boolean).join('  |  '), { color: muted });
                const resultType = result.result_kind === 'interim' ? 'Interim as of ' + result.as_of
                    : result.result_kind === 'final' ? 'Final' : 'Term result';
                await line([result.period, result.period_end !== result.as_of && result.period_end,
                    resultType + '  |  ' + result.mark].filter(Boolean).join('  |  '));
                const credit = result.credit_decision === 'awarded' ? `${result.units} high-school unit(s) awarded by ${snapshot.issuer}`
                    : result.credit_decision === 'pending' ? 'High-school credit pending'
                    : result.credit_decision === 'no_credit' ? 'No high-school credit awarded' : 'Middle school coursework';
                if (awarded.has(result.course_id)) y -= 7;
                else await line(credit, { color: muted, gap: 7 });
                if (result.credit_decision === 'awarded') awarded.add(result.course_id);
            }
            y -= 8;
        }

        space(110);
        await line('Grading and credit key', { font: bold, size: 13, gap: 3 });
        await line(snapshot.grading_key, { gap: 5 });
        await line('Ordinary middle school coursework carries no high-school units. Awarded units appear once per course. Pending decisions carry no units.', { gap: 12 });
        space(84);
        await line('Office certification', { font: bold, size: 13, gap: 3 });
        await line('I certify that this transcript reflects the verified records selected for issuance.');
        await line(snapshot.signer + '  |  ' + snapshot.signer_title, { font: bold });
        await line('Certified ' + snapshot.issued_on + '  |  For verification, contact the school above.', { color: muted });
    }

    const pages = documentPdf.getPages();
    pages.forEach((sheet, index) => {
        sheet.drawText('Page ' + (index + 1) + ' of ' + pages.length, {
            x: margin, y: 28, size: 9, font: regular, color: muted
        });
    });
    return documentPdf.save();
}
