import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const groups = await prisma.mirroredFile.groupBy({ by: ['connectedAccountId', 'status', 'sharedWithMe', 'starred'], _count: true })
console.log('mirrored groups:', JSON.stringify(groups))
const accounts = await prisma.connectedAccount.findMany({ where: { provider: 'google_drive' }, select: { id: true, email: true, status: true, lastError: true, updatedAt: true } })
console.log('accounts:', JSON.stringify(accounts, null, 1))
const sample = await prisma.mirroredFile.findMany({ take: 10, select: { name: true, starred: true, sharedWithMe: true, status: true, ownerName: true } })
console.log('sample:', JSON.stringify(sample))
await prisma.$disconnect()
