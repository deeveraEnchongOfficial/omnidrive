import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/http'

const routingModes = ['most_available', 'round_robin', 'priority'] as const
const routingPolicySchema = z.object({ mode: z.enum(routingModes), priorityAccountIds: z.array(z.string().min(1)).max(100).optional() })

export function normalizePriorityAccountIds(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

async function getOrCreateRoutingPolicy(userId: string) {
  return prisma.uploadRoutingPolicy.upsert({
    where: { userId },
    create: { userId, mode: 'most_available', priorityAccountIds: [] },
    update: {},
  })
}

export async function GET() {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const policy = await getOrCreateRoutingPolicy(user.id)
    return NextResponse.json({ policy: { id: policy.id, mode: policy.mode, priorityAccountIds: normalizePriorityAccountIds(policy.priorityAccountIds), roundRobinCursor: policy.roundRobinCursor } })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getAuthUser()
    if (!user) return apiError(401, 'AUTH_REQUIRED', 'Sign in required.')
    const body = routingPolicySchema.parse(await request.json())
    const accountIds = [...new Set(body.priorityAccountIds ?? [])]
    const validAccounts = accountIds.length === 0 ? [] : await prisma.connectedAccount.findMany({ where: { id: { in: accountIds }, userId: user.id, status: 'connected' }, select: { id: true } })
    const validIds = new Set(validAccounts.map((account) => account.id))
    const priorityAccountIds = accountIds.filter((id) => validIds.has(id))
    const policy = await prisma.uploadRoutingPolicy.upsert({
      where: { userId: user.id },
      create: { userId: user.id, mode: body.mode, priorityAccountIds, roundRobinCursor: 0 },
      update: { mode: body.mode, priorityAccountIds, ...(body.mode !== 'round_robin' ? { roundRobinCursor: 0 } : {}) },
    })
    return NextResponse.json({ policy: { id: policy.id, mode: policy.mode, priorityAccountIds: normalizePriorityAccountIds(policy.priorityAccountIds), roundRobinCursor: policy.roundRobinCursor } })
  } catch (error) {
    return handleRouteError(error)
  }
}
