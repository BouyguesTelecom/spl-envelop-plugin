import { describe, it, expect } from 'vitest'
import { buildSchema, execute, parse } from 'graphql'
import { useSPL, splDirectiveTypeDef } from './index.js'

describe('SPL Plugin', () => {
  const schema = buildSchema(/* GraphQL */ `
    ${splDirectiveTypeDef}

    type User {
      id: ID!
      name: String!
      age: Int!
    }

    type Query {
      users: [User!]!
    }
  `)

  const testUsers = [
    { id: '1', name: 'Alice', age: 30 },
    { id: '2', name: 'Bob', age: 20 },
    { id: '3', name: 'Charlie', age: 35 },
  ]

  it('exports SPL directive definition', () => {
    expect(splDirectiveTypeDef).toContain('directive @SPL')
    expect(splDirectiveTypeDef).toContain('on FIELD')
  })

  it('exports useSPL plugin function', () => {
    const plugin = useSPL()
    expect(typeof plugin.onExecute).toBe('function')
  })

  it('executes basic GraphQL queries without SPL', async () => {
    const query = parse('{ users { id name age } }')

    const result = await execute({
      schema,
      document: query,
      rootValue: { users: () => testUsers },
    })

    expect(result.data?.users).toEqual(testUsers)
  })

  it('allows SPL directive in queries', () => {
    // Should not throw validation error
    const query = parse('{ users @SPL(query: "age > 25") { id name age } }')
    expect(query.definitions).toHaveLength(1)
  })

  it('creates plugin with onExecute handler', () => {
    const plugin = useSPL()
    expect(plugin.onExecute).toBeDefined()
    expect(typeof plugin.onExecute).toBe('function')
  })
})
