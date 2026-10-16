import { FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../db'

function nowKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
}

export async function getValidSession(slug: string, token: string): Promise<boolean> {
  if (!token) return false
  const session = await db.prepare(
    'SELECT slug FROM sessions WHERE token = ? AND expires_at > ?'
  ).get(token, nowKST()) as any
  return session?.slug === slug
}

export async function requireManagerAuth(req: FastifyRequest, reply: FastifyReply) {
  const slug = (req.params as any)?.slug
  const token = req.headers['x-session-token'] as string
  if (!slug || !await getValidSession(slug, token)) {
    return reply.code(401).send({ error: '관리자 인증이 필요합니다' })
  }
}

export async function requireAdminAuth(req: FastifyRequest, reply: FastifyReply) {
  const token = req.headers['x-session-token'] as string
  if (!token || !await getValidSession('__admin__', token)) {
    return reply.code(401).send({ error: '운영자 인증이 필요합니다' })
  }
}
