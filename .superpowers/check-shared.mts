import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const counts = await prisma.sharedFile.groupBy({ by: ['connectedAccountId', 'status'], _count: true })
console.log(JSON.stringify(counts, null, 2))
const sample = await prisma.sharedFile.findMany({ take: 8, select: { name: true, ownerName: true, status: true, sharedAt: true } })
console.log(JSON.stringify(sample, null, 2))
await prisma.$disconnect()
