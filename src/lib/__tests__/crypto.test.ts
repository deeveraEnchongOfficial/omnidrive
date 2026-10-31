import { describe, it, expect, beforeAll } from 'vitest'


describe('crypto', () => {
  let crypto: typeof import('../crypto')
  beforeAll(async () => {
    crypto = await import('../crypto')
  })

  it('round-trips encryptText/decryptText', () => {
    const secret = 'google-refresh-token-abc123'
    expect(crypto.decryptText(crypto.encryptText(secret))).toBe(secret)
  })

  it('produces different ciphertexts for same plaintext (random IV)', () => {
    expect(crypto.encryptText('same')).not.toBe(crypto.encryptText('same'))
  })

  it('rejects tampered ciphertext', () => {
    const enc = crypto.encryptText('secret')
    const tampered = enc.slice(0, -4) + 'AAAA'
    expect(() => crypto.decryptText(tampered)).toThrow()
  })

  it('rejects malformed payload', () => {
    expect(() => crypto.decryptText('not:valid')).toThrow('Invalid encrypted payload')
  })

  it('hashToken is deterministic sha256 hex', () => {
    expect(crypto.hashToken('tok')).toMatch(/^[a-f0-9]{64}$/)
    expect(crypto.hashToken('tok')).toBe(crypto.hashToken('tok'))
  })

  it('randomToken returns urlsafe tokens', () => {
    const t = crypto.randomToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(crypto.randomToken()).not.toBe(crypto.randomToken())
  })
})
