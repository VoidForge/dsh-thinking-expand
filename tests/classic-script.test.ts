/**
 * Classic-script re-execution test for the built browser bundle.
 *
 * DSH client bundles are served as classic scripts and re-executed in the same
 * page after a plugin disable/enable cycle or an HMR rebuild. The bundle must
 * therefore be one self-contained IIFE: evaluating it twice must not throw a
 * SyntaxError or collide with global lexical bindings.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

interface Registration {
  id: string
  factory: unknown
}

test('the built bundle is a self-contained classic script', () => {
  // A classic script cannot contain top-level module syntax: the loader
  // concatenates bundle sources and evaluates them as scripts.
  assert.doesNotMatch(source, /^\s*(?:import|export)\s/m)
  assert.doesNotMatch(source, /__THINKING_FOCUS_RULES__/)
})

test('the bundle evaluates twice in one page without global binding collisions', () => {
  const registrations: Registration[] = []
  const window = {
    __ModuleLoader__: {
      // The stub accepts repeats; the shipped loader re-executes this script
      // only after invalidating its module entry.
      load(registration: Registration): void { registrations.push(registration) },
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
  assert.equal((context as { __THINKING_FOCUS_RULES__?: unknown }).__THINKING_FOCUS_RULES__, undefined)
})
