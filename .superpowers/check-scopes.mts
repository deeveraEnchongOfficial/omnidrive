import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const accounts = await prisma.connectedAccount.findMany({
  where: { provider: 'google_drive' },
  select: { id: true, email: true, status: true, scopes: true, lastError: true, updatedAt: true },
})
for (const a of accounts) console.log(JSON.stringify({ id: a.id, email: a.email, status: a.status, scopes: a.scopes, lastError: a.lastError, updatedAt: a.updatedAt }, null, 2))
await prisma.$disconnect()
