import { describe, it, expect } from 'vitest'
import { getPath, setPath } from './utils.js'

describe('Utils', () => {
  describe('getPath', () => {
    it('gets value from nested object', () => {
      const obj = { user: { profile: { name: 'John' } } }
      expect(getPath(obj, ['user', 'profile', 'name'])).toBe('John')
    })

    it('returns undefined for non-existent path', () => {
      const obj = { a: 1 }
      expect(getPath(obj, ['nonexistent'])).toBeUndefined()
    })

    it('handles empty path', () => {
      const obj = { a: 1 }
      expect(getPath(obj, [])).toBe(obj)
    })

    it('handles arrays', () => {
      const obj = { items: [{ name: 'first' }, { name: 'second' }] }
      expect(getPath(obj, ['items', '0', 'name'])).toBe('first')
    })
  })

  describe('setPath', () => {
    it('sets value in nested object', () => {
      const obj = { user: { profile: { name: 'John' } } }
      setPath(obj, ['user', 'profile', 'age'], 30)
      expect((obj as any).user.profile.age).toBe(30)
    })

    it('creates nested structure if it does not exist', () => {
      const obj = {}
      setPath(obj, ['user', 'profile', 'name'], 'John')
      expect(obj).toEqual({ user: { profile: { name: 'John' } } })
    })

    it('handles arrays', () => {
      const obj = { items: [{}, {}] } as any
      setPath(obj, ['items', '0', 'name'], 'first')
      expect(obj.items[0].name).toBe('first')
    })
  })
})
