const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function auditMacArchitecture(directory, arch) {
  if (process.platform !== 'darwin') throw new Error('Mach-O verification must run on macOS.');
  const expected = { x64: 'x86_64', arm64: 'arm64' }[arch];
  if (!expected) throw new Error(`Unsupported architecture: ${arch}`);
  const checked = [];
  function visit(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) {
        const description = execFileSync('/usr/bin/file', ['-b', file], { encoding: 'utf8' });
        if (!description.includes('Mach-O')) continue;
        const slices = execFileSync('/usr/bin/lipo', ['-archs', file], { encoding: 'utf8' }).trim().split(/\s+/);
        if (!slices.includes(expected)) throw new Error(`${file} has ${slices.join(', ')}, expected ${expected}.`);
        checked.push(file);
      }
    }
  }
  visit(directory);
  if (!checked.length) throw new Error(`No native binaries found in ${directory}.`);
  console.log(`Verified ${checked.length} Mach-O files for ${expected}.`);
  return checked;
}
if (require.main === module) auditMacArchitecture(path.resolve(process.argv[2]), process.argv[3]);
module.exports = { auditMacArchitecture };
