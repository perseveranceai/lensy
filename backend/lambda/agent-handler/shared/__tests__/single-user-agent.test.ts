// REG-27: every outbound request from a scan identifies with one name, so a site owner's
// allow rule (user agent AND our fixed IP, see /bot) covers all of them. An older
// "Lensy Documentation Quality Auditor/1.0" name survived in dead code until 2026-11.
import * as fs from 'fs';
import * as path from 'path';
import { HONEST_UA } from '../fetch-page';

const AGENT_DIR = path.join(__dirname, '../..');
const API_HANDLER = path.join(__dirname, '../../../api-handler/index.ts');

function tsFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return ['node_modules', '__tests__'].includes(e.name) ? [] : tsFiles(p);
        return e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') ? [p] : [];
    });
}

describe('REG-27: one honest user agent', () => {
    test('the honest user agent is Lensy/1.0 with the /bot link', () => {
        expect(HONEST_UA).toBe('Lensy/1.0 (+https://perseveranceai.com/bot)');
    });

    test('no agent-handler source names Lensy any other way', () => {
        const offenders = tsFiles(AGENT_DIR).flatMap((file) => {
            const src = fs.readFileSync(file, 'utf8');
            return /Lensy Documentation Quality Auditor/.test(src) ? [path.relative(AGENT_DIR, file)] : [];
        });
        expect(offenders).toEqual([]);
    });

    test('only fetch-page.ts defines a Lensy user-agent string', () => {
        const offenders = tsFiles(AGENT_DIR).flatMap((file) => {
            if (file.endsWith(path.join('shared', 'fetch-page.ts'))) return [];
            const src = fs.readFileSync(file, 'utf8');
            return /['"`]Lensy\/\d/.test(src) ? [path.relative(AGENT_DIR, file)] : [];
        });
        expect(offenders).toEqual([]);
    });

    test('GET /bot-info advertises the same user agent the fetcher sends', () => {
        const src = fs.readFileSync(API_HANDLER, 'utf8');
        const m = src.match(/const LENSY_USER_AGENT = '([^']+)'/);
        expect(m?.[1]).toBe(HONEST_UA);
    });
});
