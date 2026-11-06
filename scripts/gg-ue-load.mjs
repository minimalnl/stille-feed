// Loads the pure GGUeFix helpers out of grid-ad.js without starting the page.
import fs from 'node:fs';
import vm from 'node:vm';

export function loadGGUeFix() {
  const sandbox = {
    console,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    atob,
    btoa,
    location: { search: '' },
    document: { getElementById() { return null; } },
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(new URL('../grid-ad.js', import.meta.url), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'grid-ad.js' });
  if (!sandbox.GGUeFix) throw new Error('GGUeFix was not created');
  return sandbox.GGUeFix;
}
