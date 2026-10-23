/**
 * Manifest invariants: the package name, the bundle patch, the built entry
 * points, and the peer declaration must agree with the code and with each
 * other, or the bundle stops installing or loading in DSH.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { PACKAGE_NAME, SETTINGS_ENTRY_ID } from '../src/constants.ts'

interface Manifest {
  name: string
  type: string
  main: string
  types: string
  files: string[]
  exports: Record<string, string | Record<string, string>>
  peerDependencies: Record<string, string>
  dsh: {
    bundle: { patch: string }
    client: { platform: string; immediately: boolean }
  }
}

const manifest = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
) as Manifest
const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

test('manifest identity, bundle patch, and client entry agree with the code', () => {
  assert.equal(manifest.name, PACKAGE_NAME)
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.main, './lib/index.js')
  assert.equal(manifest.types, './lib/index.d.ts')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.deepEqual(manifest.dsh.client, { platform: 'web', immediately: true })
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
  assert.equal(manifest.exports['./icon'], './icon.svg')
  assert.match(manifest.peerDependencies['@deepseek-ai/schemastery'], /^>=3\.18\.5 <4$/)
  assert.match(patch, new RegExp('id:\\s*' + SETTINGS_ENTRY_ID))
  const escapedName = manifest.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  assert.match(patch, new RegExp(escapedName))
})

test('the package ships the prebuilt entry points a linked install resolves', () => {
  // `lib/` is committed, so a `link:`/git install needs no build script and no
  // pnpm build allowance; the files list must not drop any entry point.
  for (const file of ['lib/index.js', 'lib/index.d.ts', 'lib/client.js']) {
    assert.ok(manifest.files.includes(file), file + ' missing from package.json files')
  }
  assert.ok(manifest.files.includes('cordis.patch.yml'))
  assert.ok(manifest.files.includes('icon.svg'))
  assert.ok(manifest.files.includes('locale/*.json'))
})
