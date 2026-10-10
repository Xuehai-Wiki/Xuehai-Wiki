import { readFile, writeFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { minify } from 'terser';

const files = await Array.fromAsync(glob('dist/*.js'));
let minified = 0;

for (const file of files) {
	const source = await readFile(file, 'utf8');
	const output = await minify(source, {
		compress: { passes: 2 },
		mangle: true,
		format: { comments: false },
	});
	if (!output.code) throw new Error(`Terser returned no output for ${file}`);
	await writeFile(file, output.code);
	minified++;
}

console.log(`Minified ${minified} public JavaScript file${minified === 1 ? '' : 's'}.`);
