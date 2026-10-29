import { describe, it, expect } from 'vitest'
import { updateAtPath } from './utils.js'

describe('updateAtPath', () => {
  it('updates a value at the root', () => {
    const data = { users: [1, 2, 3] }

    expect(updateAtPath(data, ['users'], () => [1])).toBe(1)
    expect(data).toEqual({ users: [1] })
  })

  it('updates a value nested in plain objects', () => {
    const data = { a: { b: { c: 'before' } } }

    expect(updateAtPath(data, ['a', 'b', 'c'], () => 'after')).toBe(1)
    expect(data.a.b.c).toBe('after')
  })

  it('spreads over a list met along the path', () => {
    const data = {
      accounts: [
        { id: 'A', invoices: [1, 2] },
        { id: 'B', invoices: [3] },
      ],
    }

    expect(updateAtPath(data, ['accounts', 'invoices'], (value) => (value as number[]).length)).toBe(
      2,
    )
    expect(data.accounts).toEqual([
      { id: 'A', invoices: 2 },
      { id: 'B', invoices: 1 },
    ])
  })

  it('spreads over several nested lists', () => {
    const data = {
      person: {
        groups: [
          { accounts: [{ invoices: ['x'] }, { invoices: ['y', 'z'] }] },
          { accounts: [{ invoices: [] }] },
        ],
      },
    }

    const applied = updateAtPath(data, ['person', 'groups', 'accounts', 'invoices'], () => 'done')

    expect(applied).toBe(3)
    expect(data.person.groups[0].accounts[0].invoices).toBe('done')
    expect(data.person.groups[0].accounts[1].invoices).toBe('done')
    expect(data.person.groups[1].accounts[0].invoices).toBe('done')
  })

  it('reports nothing was applied when the path does not resolve', () => {
    expect(updateAtPath({ a: 1 }, ['b', 'c'], () => 'x')).toBe(0)
    expect(updateAtPath({ a: null }, ['a', 'b'], () => 'x')).toBe(0)
    expect(updateAtPath({ accounts: [] }, ['accounts', 'invoices'], () => 'x')).toBe(0)
  })

  it('updates a field explicitly set to null', () => {
    const data: { a: unknown } = { a: null }

    expect(updateAtPath(data, ['a'], () => 'x')).toBe(1)
    expect(data.a).toBe('x')
  })

  it('ignores an empty path', () => {
    expect(updateAtPath({ a: 1 }, [], () => 'x')).toBe(0)
  })
})
