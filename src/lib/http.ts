import { NextResponse } from 'next/server'
import { ZodError } from 'zod'

export function apiError(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status })
}

export function handleRouteError(error: unknown) {
  if (error instanceof ZodError) {
    return apiError(400, 'VALIDATION_FAILED', error.issues[0]?.message ?? 'Invalid request.')
  }
  if (error instanceof SyntaxError) {
    return apiError(400, 'BAD_JSON', 'Request body is not valid JSON.')
  }
  console.error('[api]', error)
  return apiError(500, 'INTERNAL_ERROR', 'Something went wrong.')
}
