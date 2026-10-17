const fs = require('node:fs');

const source = fs.readFileSync('src/common/services/env-validation.service.ts', 'utf8');
const docs = fs.readFileSync('docs/environment-variables.md', 'utf8');
const declaration = source.match(/CRITICAL_ENV_VARS\s*=\s*\[([\s\S]*?)\]\s*as const/);

if (!declaration) {
  console.error('Could not find CRITICAL_ENV_VARS in env-validation.service.ts');
  process.exit(1);
}

const required = [...declaration[1].matchAll(/['"]([A-Z][A-Z0-9_]*)['"]/g)].map((match) => match[1]);
const undocumented = required.filter((name) => !docs.includes(`\`${name}\``));

if (undocumented.length) {
  console.error(`Required environment variables missing from docs/environment-variables.md: ${undocumented.join(', ')}`);
  process.exit(1);
}

console.log(`Documented ${required.length} required environment variables.`);
