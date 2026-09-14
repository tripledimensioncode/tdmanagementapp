const fs = require('fs/promises');
const path = require('path');

const runtimeDirs = [
  'data',
  path.join('prisma', 'data'),
  path.join('public', 'uploads', 'images'),
  path.join('public', 'uploads', 'videos'),
  path.join('public', 'uploads', 'files')
];

async function ensureRuntimeDirectories() {
  const rootDir = path.join(__dirname, '..');

  for (const relativeDir of runtimeDirs) {
    const fullPath = path.join(rootDir, relativeDir);
    await fs.mkdir(fullPath, { recursive: true });
    console.log(`[bootstrap] ensured ${relativeDir}`);
  }
}

ensureRuntimeDirectories().catch((err) => {
  console.error('[bootstrap] failed to prepare runtime directories');
  console.error(err);
  process.exit(1);
});
