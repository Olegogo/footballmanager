import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const templatePath = path.join(rootDir, 'web', 'config.template.js');
const outputPath = path.join(rootDir, 'web', 'config.js');
const apiBaseUrl = String(process.env.API_BASE_URL || '').replace(/\/+$/, '');

const template = await fs.readFile(templatePath, 'utf-8');
const output = template.replace('__API_BASE_URL__', apiBaseUrl);

await fs.writeFile(outputPath, output, 'utf-8');
console.log(`Generated web/config.js with API base: ${apiBaseUrl || '(same-origin)'}`);
