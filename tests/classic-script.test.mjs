/**
 * Classic-script re-execution test.
 *
 * Client bundles are served as classic scripts and re-executed in the same page
 * after a plugin disable/enable cycle or an HMR rebuild. The bundled script must
 * therefore not create persistent global lexical bindings: evaluating the same
 * file twice must not throw a SyntaxError before it registers its factory.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

test('the bundle evaluates twice in one page without global binding collisions', () => {
  const registrations = []
  const window = {
    __ModuleLoader__: {
      // The stub accepts repeats; the shipped loader re-executes this script
      // only after invalidating its module entry.
      load(registration) { registrations.push(registration) },
    },
  }
  const context = vm.createContext({ window, console })
  vm.runInContext(source, context, { filename: 'client.js' })
  vm.runInContext(source, context, { filename: 'client.js' })
  assert.equal(registrations.length, 2)
  for (const registration of registrations) {
    assert.equal(registration.id, '@local/dsh-thinking-expand')
    assert.equal(typeof registration.factory, 'function')
  }
  // No DOM or module API is touched just by evaluating the bundle.
  assert.equal(typeof context.__THINKING_FOCUS_RULES__, 'undefined')
})
