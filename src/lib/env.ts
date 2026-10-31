import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32).optional(),
  TOKEN_ENCRYPTION_KEY: z.string().min(32),
  MAX_UPLOAD_BYTES: z.coerce.number().default(5 * 1024 * 1024 * 1024),
  RECAPTCHA_SECRET_KEY: z.string().optional(),
  SESSION_TTL_DAYS: z.coerce.number().default(30),
})

export const env = envSchema.parse(process.env)
