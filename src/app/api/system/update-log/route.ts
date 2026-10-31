import { NextResponse } from 'next/server'
import path from 'node:path'
import fs from 'node:fs'
import { getAuthUser } from '@/lib/auth'
import { apiError } from '@/lib/http'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
  const logFile = path.join(process.cwd(), 'update.log')
  if (!fs.existsSync(logFile)) {
    return NextResponse.json({ log: 'No update history found.' })
  }
  try {
    return NextResponse.json({ log: fs.readFileSync(logFile, 'utf8') })
  } catch (error) {
    return NextResponse.json({ code: 'READ_LOG_FAILED', message: 'Failed to read update log file.', error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
