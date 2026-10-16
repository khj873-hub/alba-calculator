import type { IncomingMessage, ServerResponse } from 'http'
import { app, ensureSeed } from '../server/src/index'

/**
 * Vercel 서버리스 진입점. vercel.json 이 /api/* 를 이 함수로 보낸다.
 *
 * Fastify 를 listen 하지 않고, 준비된 인스턴스의 Node 핸들러에 요청을 넘긴다
 * (server/src/index.ts 는 process.env.VERCEL 이 있으면 listen 하지 않는다).
 *
 * 콜드 스타트마다 app.ready() 는 1회만 수행되고, 시드도 1회만 돈다.
 */
let ready: Promise<void> | null = null

function boot(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await app.ready()
      try {
        await ensureSeed()
      } catch (e) {
        // 시드 실패가 요청 처리를 막지 않게 한다(동시 콜드스타트 경합 등).
        console.error('[startup] ensureSeed 실패:', e)
      }
    })()
  }
  return ready
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await boot()
  app.server.emit('request', req, res)
}
