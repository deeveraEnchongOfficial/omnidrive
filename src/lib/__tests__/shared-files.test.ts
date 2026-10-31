import { describe, it, expect, beforeAll } from 'vitest'


describe('scope helpers', () => {
  let shared: typeof import('../shared-files')
  beforeAll(async () => {
    shared = await import('../shared-files')
  })

  it('scopeListHasReadonly detects the readonly scope', () => {
    expect(shared.scopeListHasReadonly(['openid', shared.GOOGLE_READONLY_SCOPE])).toBe(true)
    expect(shared.scopeListHasReadonly(['openid', 'https://www.googleapis.com/auth/drive.file'])).toBe(false)
  })

  it('scopeListHasReadonly survives malformed Json values', () => {
    for (const v of [null, undefined, 'string', 42, { scope: 'x' }]) {
      expect(shared.scopeListHasReadonly(v)).toBe(false)
    }
  })

  it('mergeRequiredScopes unions requested with GOOGLE_SCOPES', () => {
    const merged = shared.mergeRequiredScopes(['openid', 'extra'])
    expect(merged).toContain('extra')
    for (const s of shared.GOOGLE_SCOPES) expect(merged).toContain(s)
    expect(new Set(merged).size).toBe(merged.length)
  })

  it('grantedScopes prefers token scope, falls back to requested', () => {
    expect(shared.grantedScopes('a b', ['c'])).toEqual(['a', 'b'])
    expect(shared.grantedScopes('', ['c'])).toEqual(shared.mergeRequiredScopes(['c']))
    expect(shared.grantedScopes(null, ['c'])).toEqual(shared.mergeRequiredScopes(['c']))
  })
})

describe('toMirroredFileData', () => {
  let shared: typeof import('../shared-files')
  beforeAll(async () => {
    shared = await import('../shared-files')
  })

  it('maps a full drive file', () => {
    const row = shared.toMirroredFileData({
      id: 'f1', name: 'Doc.pdf', mimeType: 'application/pdf', size: '1234',
      owners: [{ displayName: 'Ann', emailAddress: 'a@x.com' }],
      webViewLink: 'https://drive.google.com/f1', createdTime: '2024-01-01T00:00:00Z',
      sharedWithMeTime: '2024-02-01T00:00:00Z',
    })
    expect(row).toMatchObject({ providerFileId: 'f1', name: 'Doc.pdf', sizeBytes: 1234n, ownerName: 'Ann', ownerEmail: 'a@x.com' })
    expect(row?.sharedAt?.toISOString()).toBe('2024-02-01T00:00:00.000Z')
  })

  it('falls back to createdTime and nulls missing fields', () => {
    const row = shared.toMirroredFileData({ id: 'f2', name: 'x', mimeType: 'm/m', createdTime: '2024-01-01T00:00:00Z' })
    expect(row?.sizeBytes).toBe(0n)
    expect(row?.ownerName).toBeNull()
    expect(row?.sharedAt?.toISOString()).toBe('2024-01-01T00:00:00.000Z')
  })

  it('returns null on missing required fields', () => {
    expect(shared.toMirroredFileData({ name: 'x', mimeType: 'm' })).toBeNull()
    expect(shared.toMirroredFileData({ id: 'f', mimeType: 'm' })).toBeNull()
    expect(shared.toMirroredFileData({ id: 'f', name: 'x' })).toBeNull()
  })
})

describe('API helpers', () => {
  let shared: typeof import('../shared-files')
  beforeAll(async () => {
    shared = await import('../shared-files')
  })

  it('serializeMirroredFile stringifies BigInt and ISO-dates sharedAt', () => {
    const out = shared.serializeMirroredFile({ id: 'x', name: 'n', mimeType: 'm', sizeBytes: 9n, ownerName: null, ownerEmail: 'o@x', webViewLink: 'u', sharedAt: new Date('2024-03-01T00:00:00Z'), connectedAccount: { email: 'me@x' } } as never)
    expect(out.sizeBytes).toBe('9')
    expect(out.sharedAt).toBe('2024-03-01T00:00:00.000Z')
    expect(out.accountEmail).toBe('me@x')
  })

  it('accountNeedsReconnect only flags connected google accounts lacking readonly', () => {
    expect(shared.accountNeedsReconnect({ provider: 'google_drive', status: 'connected', scopes: ['https://www.googleapis.com/auth/drive.file'] })).toBe(true)
    expect(shared.accountNeedsReconnect({ provider: 'google_drive', status: 'connected', scopes: [shared.GOOGLE_READONLY_SCOPE] })).toBe(false)
    expect(shared.accountNeedsReconnect({ provider: 'google_drive', status: 'disconnected', scopes: [] })).toBe(false)
    expect(shared.accountNeedsReconnect({ provider: 's3', status: 'connected', scopes: [] })).toBe(false)
  })

  it('emailsNeedingReconnect returns emails of accounts lacking readonly', () => {
    const emails = shared.emailsNeedingReconnect([
      { provider: 'google_drive', status: 'connected', scopes: ['https://www.googleapis.com/auth/drive.file'], email: 'a@x.com' },
      { provider: 'google_drive', status: 'connected', scopes: [shared.GOOGLE_READONLY_SCOPE], email: 'b@x.com' },
      { provider: 'google_drive', status: 'disconnected', scopes: [], email: 'c@x.com' },
      { provider: 's3', status: 'connected', scopes: [], email: 'd@x.com' },
    ])
    expect(emails).toEqual(['a@x.com'])
  })
})
