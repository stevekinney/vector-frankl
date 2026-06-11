import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

const declarationsRoot = resolve('dist');

async function* walkDeclarationFiles(directory: string): AsyncGenerator<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      yield* walkDeclarationFiles(path);
      continue;
    }

    if (entry.isFile() && path.endsWith('.d.ts')) {
      yield path;
    }
  }
}

function toImportSpecifier(fromFile: string, aliasTarget: string): string {
  const target = resolve(declarationsRoot, aliasTarget);
  let specifier = relative(dirname(fromFile), target).split(sep).join('/');

  if (!specifier.startsWith('.')) {
    specifier = `./${specifier}`;
  }

  return specifier;
}

for await (const file of walkDeclarationFiles(declarationsRoot)) {
  const content = await readFile(file, 'utf8');
  const rewritten = content.replace(
    /(["'])@\/([^"']+)\1/g,
    (match: string, quote: string, aliasTarget: string) => {
      if (aliasTarget.includes('*')) {
        return match;
      }

      return `${quote}${toImportSpecifier(file, aliasTarget)}${quote}`;
    },
  );

  if (rewritten !== content) {
    await writeFile(file, rewritten);
  }
}
