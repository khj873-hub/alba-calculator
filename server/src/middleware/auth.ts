import { FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../db'

function nowKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
}

export function getValidSession(slug: string, token: string): boolean {
  if (!token) return false
  const session = db.prepare(
    'SELECT slug FROM sessions WHERE token = ? AND expires_at > ?'
  ).get(token, nowKST()) as any
  return session?.slug === slug
}

export async function requireManagerAuth(req: FastifyRequest, reply: FastifyReply) {
  const slug = (req.params as any)?.slug
  const token = req.headers['x-session-token'] as string
  if (!slug || !getValidSession(slug, token)) {
    return reply.code(401).send({ error: '관리자 인증이 필요합니다' })
  }
}

export async function requireAdminAuth(req: FastifyRequest, reply: FastifyReply) {
  const token = req.headers['x-session-token'] as string
  if (!token || !getValidSession('__admin__', token)) {
    return reply.code(401).send({ error: '운영자 인증이 필요합니다' })
  }
}
