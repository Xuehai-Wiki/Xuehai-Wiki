import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.join(ROOT, 'src', 'assets', 'fonts', 'Pretendard');
const OUTPUT_DIR = path.join(ROOT, 'public', 'fonts', 'Pretendard');
const TEXT_DIRS = ['src', 'public'];
const TEXT_EXTENSIONS = new Set([
	'.astro',
	'.js',
	'.json',
	'.md',
	'.mjs',
	'.ts',
	'.yaml',
	'.yml',
]);

const fonts = [
	{ weight: 400, file: 'pretendard-400-latin.woff2' },
	{ weight: 600, file: 'pretendard-600-latin.woff2' },
	{ weight: 700, file: 'pretendard-700-latin.woff2' },
];

async function collectFiles(directory, files = []) {
	const entries = await readdir(directory, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(directory, entry.name);
		if (entry.isDirectory()) await collectFiles(fullPath, files);
		else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
	}
	return files;
}

async function collectText() {
	const characters = new Set();
	for (let code = 32; code <= 126; code += 1) {
		characters.add(String.fromCharCode(code));
	}

	const files = [];
	for (const directory of TEXT_DIRS) {
		files.push(...(await collectFiles(path.join(ROOT, directory))));
	}

	for (const file of files) {
		const text = await readFile(file, 'utf8');
		for (const character of text) {
			if (character.codePointAt(0) > 31) characters.add(character);
		}
	}

	return [...characters].sort().join('');
}

async function writeIfChanged(outputPath, buffer) {
	let current;
	try {
		current = await readFile(outputPath);
	} catch {
		current = null;
	}
	if (current?.equals(buffer)) return false;

	const temporaryPath = `${outputPath}.${Date.now()}.tmp`;
	await writeFile(temporaryPath, buffer);
	await rename(temporaryPath, outputPath);
	return true;
}

const text = await collectText();
await mkdir(OUTPUT_DIR, { recursive: true });

for (const font of fonts) {
	const sourcePath = path.join(SOURCE_DIR, font.file);
	const outputPath = path.join(OUTPUT_DIR, font.file);
	const source = await readFile(sourcePath);
	const subset = await subsetFont(source, text, { targetFormat: 'woff2' });
	const changed = await writeIfChanged(outputPath, subset);
	const sourceSize = (await stat(sourcePath)).size;
	const outputSize = subset.length;
	console.log(
		`✓ Pretendard ${font.weight}: ${sourceSize} B -> ${outputSize} B${changed ? '' : ' (unchanged)'}`,
	);
}
