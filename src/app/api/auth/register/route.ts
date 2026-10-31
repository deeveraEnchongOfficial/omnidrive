import { NextResponse } from 'next/server'
import { z } from 'zod'
import argon2 from 'argon2'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'
import { apiError, handleRouteError } from '@/lib/http'
import { createAuditLog } from '@/lib/audit'

const registerSchema = z.object({
  name: z.string().trim().min(1).max(191),
  email: z.string().trim().email().max(191),
  password: z.string().min(8).max(191),
  captchaToken: z.string().optional(),
})

async function verifyRecaptcha(token: string) {
  const body = new URLSearchParams({ secret: env.RECAPTCHA_SECRET_KEY!, response: token })
  const res = await fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', body })
  const data = (await res.json()) as { success?: boolean }
  return data.success === true
}

export async function POST(request: Request) {
  try {
    const body = registerSchema.parse(await request.json())
    if (env.RECAPTCHA_SECRET_KEY) {
      if (!body.captchaToken || !(await verifyRecaptcha(body.captchaToken))) {
        return apiError(400, 'CAPTCHA_FAILED', 'Captcha verification failed.')
      }
    }
    const email = body.email.toLowerCase()
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return apiError(409, 'EMAIL_TAKEN', 'An account with this email already exists.')

    const user = await prisma.user.create({
      data: { name: body.name, email, passwordHash: await argon2.hash(body.password) },
    })
    await createAuditLog({ userId: user.id, action: 'user.register', entityType: 'user', entityId: user.id })
    return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email } }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
