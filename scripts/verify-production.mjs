import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { setTimeout as pause } from 'node:timers/promises';

const exec = promisify(execFile);
const base = 'https://zionoutschool.com/';
const smokeFiles = [
    'family-portal.html', 'grade-reports.html', 'gradebook.html', 'graduation-planner.html',
    'graduation-planner.css', 'supabase-portal.js', 'portal-admin.html', 'ai-workroom.html',
    'ai-workroom.js', 'ai-workroom.css',
];

function normalizeLinks(html, filename) {
    const page = new URL(filename, base);
    return html.replace(/<a\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, tag => {
        const attributes = [...tag.slice(2, -1).matchAll(/([^\s=\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)];
        const normalized = attributes.map(([, name, doubleQuoted, singleQuoted, unquoted]) => {
            const key = name.toLowerCase();
            let value = doubleQuoted ?? singleQuoted ?? unquoted ?? null;
            if (value !== null) value = value.replace(/&(?:amp|quot|apos|#39|#34);/g, entity => (
                { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&#34;': '"' }[entity]
            ));
            if (key === 'href' && value) {
                const url = new URL(value, page);
                if (url.origin === page.origin) {
                    value = (url.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '')) + url.search + url.hash;
                }
            }
            return [key, value];
        });
        return '<a' + JSON.stringify(normalized.sort(([first], [second]) => first.localeCompare(second))) + '>';
    }).replace(/\r\n/g, '\n');
}

async function git(args) {
    const result = await exec('git', args, { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
    return result.stdout;
}

function isWebsiteFile(path) {
    return !path.startsWith('.') && !/^(?:supabase|tests|scripts|artifacts|apps-script)\//.test(path)
        && /\.(?:html|css|m?js|json|png|jpe?g|svg|webp|ico|woff2?|pdf)$/i.test(path);
}

async function checkFile(file, revision, bytes) {
    const url = new URL(file.split('/').map(encodeURIComponent).join('/'), base);
    url.searchParams.set('release-check', revision.slice(0, 12));
    try {
        const result = await exec('curl', [
            '--fail', '--silent', '--show-error', '--location', '--max-time', '12', url.href,
        ], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
        const matches = file.endsWith('.html')
            ? normalizeLinks(result.stdout.toString('utf8'), file) === normalizeLinks(bytes.toString('utf8'), file)
            : result.stdout.equals(bytes);
        return matches ? '' : file + ' differs from GitHub';
    } catch {
        return file + ' is unreachable on production';
    }
}

async function main() {
    const { values } = parseArgs({ options: {
        revision: { type: 'string', default: 'HEAD' },
        before: { type: 'string' },
        wait: { type: 'string', default: '0' },
    } });
    const revision = (await git(['rev-parse', '--verify', values.revision + '^{commit}'])).toString().trim();
    const seconds = Number(values.wait);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 600) throw new Error('Wait must be 0–600 seconds.');
    const files = new Set(smokeFiles);
    if (values.before && !/^0+$/.test(values.before)) {
        const before = (await git(['rev-parse', '--verify', values.before + '^{commit}'])).toString().trim();
        const changes = await git(['diff', '--name-only', '--diff-filter=AMCR', '-z', before, revision, '--']);
        for (const file of changes.toString().split('\0').filter(isWebsiteFile)) files.add(file);
    }
    const expected = await Promise.all([...files].map(async file => [file, await git(['show', revision + ':' + file])]));
    const deadline = Date.now() + seconds * 1000;
    do {
        const failed = [];
        for (let start = 0; start < expected.length; start += 8) {
            const group = expected.slice(start, start + 8);
            failed.push(...(await Promise.all(group.map(([file, bytes]) => checkFile(file, revision, bytes)))).filter(Boolean));
        }
        if (!failed.length) {
            console.log(`Verified ${expected.length} production website files against Git commit ${revision.slice(0, 12)}.`);
            return;
        }
        if (Date.now() >= deadline) throw new Error(failed.join('\n'));
        await pause(5000);
    } while (true);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
