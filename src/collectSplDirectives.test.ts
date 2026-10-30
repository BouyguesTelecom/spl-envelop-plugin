import { describe, it, expect } from 'vitest'
import { parse } from 'graphql'
import { collectSplDirectives } from './collectSplDirectives.js'

const collect = (source: string, operationName?: string | null) =>
  collectSplDirectives(parse(source), operationName)

/** Compact view of the result, easier to assert on than the full objects. */
const paths = (source: string, operationName?: string | null) =>
  collect(source, operationName).map((o) => o.path.join('.'))

describe('response paths', () => {
  it('locates a directive on a root field', () => {
    expect(collect('{ users @SPL(query: "age > 25") { id } }')).toEqual([
      { path: ['users'], query: 'age > 25' },
    ])
  })

  it('builds the full path of a nested field', () => {
    expect(paths('{ a { b { c @SPL(query: "x = 1") { d } } } }')).toEqual(['a.b.c'])
  })

  it('uses the alias as response key, since that is what the result is keyed by', () => {
    expect(paths('{ renamed: users @SPL(query: "x = 1") { id } }')).toEqual(['renamed'])
  })

  it('uses aliases at every level of the path', () => {
    expect(paths('{ p: person { c: contracts @SPL(query: "x = 1") { id } } }')).toEqual([
      'p.c',
    ])
  })

  it('reports occurrences in document order, across siblings and depth', () => {
    expect(
      paths(`
        {
          first @SPL(query: "a = 1") { x }
          nested { inner @SPL(query: "b = 2") { y } }
          last @SPL(query: "c = 3") { z }
        }
      `),
    ).toEqual(['first', 'nested.inner', 'last'])
  })

  it('returns nothing when the document holds no @SPL', () => {
    expect(collect('{ users { id } }')).toEqual([])
  })
})

describe('directive parsing', () => {
  it('keeps every @SPL of a field, in the order written', () => {
    expect(
      collect('{ users @SPL(query: "a = 1") @SPL(query: "SORT BY id") { id } }'),
    ).toEqual([
      { path: ['users'], query: 'a = 1' },
      { path: ['users'], query: 'SORT BY id' },
    ])
  })

  it('ignores directives other than @SPL', () => {
    expect(collect('{ users @include(if: true) @skip(if: false) { id } }')).toEqual([])
  })

  it('ignores an @SPL without a query argument', () => {
    expect(collect('{ users @SPL { id } }')).toEqual([])
  })

  it('ignores an @SPL whose query is not a literal string', () => {
    // The plugin reads the query from the document, so a variable cannot be resolved here.
    expect(collect('query Q($q: String) { users @SPL(query: $q) { id } }')).toEqual([])
  })

  it('reads the query argument whatever its position among the arguments', () => {
    expect(collect('{ users @SPL(other: 1, query: "a = 1") { id } }')).toEqual([
      { path: ['users'], query: 'a = 1' },
    ])
  })

  it('keeps the query string verbatim, quotes and all', () => {
    const query = "'5' IN MAP(reviews.items, rating) SORT BY publishedOn DESC LIMIT 2"
    expect(collect(`{ f @SPL(query: "${query}") { id } }`)[0].query).toBe(query)
  })
})

describe('operation selection', () => {
  const twoOperations = `
    query First { a @SPL(query: "a = 1") { x } }
    query Second { b @SPL(query: "b = 2") { y } }
  `

  it('visits only the operation named by operationName', () => {
    expect(paths(twoOperations, 'Second')).toEqual(['b'])
  })

  it('returns nothing when several operations exist and none is named', () => {
    // graphql-js cannot pick one, and neither should we: guessing would filter the wrong field.
    expect(collect(twoOperations)).toEqual([])
  })

  it('uses the single operation when operationName is absent', () => {
    expect(paths('{ users @SPL(query: "a = 1") { id } }')).toEqual(['users'])
    expect(paths('{ users @SPL(query: "a = 1") { id } }', null)).toEqual(['users'])
  })

  it('works on a mutation', () => {
    expect(paths('mutation M { create @SPL(query: "a = 1") { id } }', 'M')).toEqual(['create'])
  })

  it('returns nothing for a document holding only fragments', () => {
    expect(collect('fragment F on T { users @SPL(query: "a = 1") { id } }')).toEqual([])
  })

  it('never mistakes the fields of an unused fragment for root fields', () => {
    // The regression this guards: visiting the whole document would report `orphan` at the root.
    expect(
      paths(`
        { users { id } }
        fragment Unused on T { orphan @SPL(query: "a = 1") { id } }
      `),
    ).toEqual([])
  })
})

describe('fragments', () => {
  it('gives a spread fragment the path of the spread site', () => {
    expect(
      paths(`
        { person { ...Contracts } }
        fragment Contracts on Person { contracts @SPL(query: "a = 1") { id } }
      `),
    ).toEqual(['person.contracts'])
  })

  it('adds no path segment for an inline fragment', () => {
    expect(paths('{ person { ... on Person { c @SPL(query: "a = 1") { id } } } }')).toEqual([
      'person.c',
    ])
  })

  it('handles an inline fragment without a type condition', () => {
    expect(paths('{ person { ... { c @SPL(query: "a = 1") { id } } } }')).toEqual(['person.c'])
  })

  it('follows fragments spread from within fragments', () => {
    expect(
      paths(`
        { person { ...Outer } }
        fragment Outer on Person { account { ...Inner } }
        fragment Inner on Account { invoices @SPL(query: "a = 1") { id } }
      `),
    ).toEqual(['person.account.invoices'])
  })

  it('spreads the same fragment at each of its usage sites', () => {
    expect(
      paths(`
        { left { ...F } right { ...F } }
        fragment F on T { items @SPL(query: "a = 1") { id } }
      `),
    ).toEqual(['left.items', 'right.items'])
  })

  it('skips a spread whose fragment is not defined', () => {
    expect(collect('{ person { ...Missing } }')).toEqual([])
  })

  it('terminates on a cyclic fragment instead of recursing forever', () => {
    // Such a document is invalid GraphQL, but it parses, and the walk must not hang.
    const cyclic = `
      { root { ...A } }
      fragment A on T { a @SPL(query: "a = 1") { ...B } }
      fragment B on T { b { ...A } }
    `
    expect(paths(cyclic)).toEqual(['root.a'])
  })
})
