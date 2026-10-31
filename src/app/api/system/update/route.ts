import { NextResponse } from 'next/server'
import { exec, spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { getAuthUser } from '@/lib/auth'
import { apiError } from '@/lib/http'

export async function POST() {
  const user = await getAuthUser()
  if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')

  const projectRoot = process.cwd()
  const updateScript = path.join(projectRoot, 'update.sh')

  const gitVersion = await new Promise<string | null>((resolve) => {
    exec('git --version', (error) => resolve(error ? null : 'ok'))
  })
  if (!gitVersion) {
    return NextResponse.json({
      code: 'GIT_NOT_FOUND',
      message: 'Git is not installed inside the app container. Update by running git pull and rebuilding the app on your host.',
    }, { status: 400 })
  }

  if (fs.existsSync(updateScript)) {
    const logFile = path.join(projectRoot, 'update.log')
    fs.writeFileSync(logFile, 'Initiating update...\n')
    const child = spawn('bash', ['update.sh'], { cwd: projectRoot, detached: true, stdio: 'ignore' })
    child.unref()
    return NextResponse.json({
      status: 'success',
      message: 'System update initiated. Rebuilding and restarting in the background. Please wait ~1 minute and refresh the page.',
    })
  }

  const result = await new Promise<{ stdout: string; stderr: string } | { error: string; stderr: string }>((resolve) => {
    exec('git pull', { cwd: projectRoot }, (error, stdout, stderr) => {
      if (error) resolve({ error: error.message, stderr })
      else resolve({ stdout, stderr })
    })
  })
  if ('error' in result) {
    return NextResponse.json({ code: 'UPDATE_FAILED', message: 'Failed to run git pull. Make sure git is installed and configured.', error: result.error, stderr: result.stderr }, { status: 500 })
  }
  return NextResponse.json({ status: 'success', message: 'System code updated successfully. Restart the app to apply.', stdout: result.stdout, stderr: result.stderr })
}
