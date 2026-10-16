import postgres from 'postgres'
import { AsyncLocalStorage } from 'async_hooks'
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto'

/**
 * Postgres(Supabase) 데이터 레이어.
 *
 * 기존 better-sqlite3 의 `db.prepare(sql).get/all/run(...)` 시그니처를 그대로 유지하되
 * Promise 를 돌려준다. 호출부는 `await` 만 붙이면 되고 SQL 문은 거의 그대로 쓴다.
 *
 * 자동 처리:
 *  - `?` 플레이스홀더 → `$1, $2 …`
 *  - `.run()` 의 INSERT 는 `RETURNING id` 를 붙여 lastInsertRowid 를 채운다
 *  - int8(COUNT 등)은 number 로 파싱 (pg 기본은 string)
 *
 * 스키마(DDL)는 Supabase 마이그레이션에서 관리한다. 여기서 CREATE TABLE 을 하지 않는다.
 */

const URL = process.env.DATABASE_URL
if (!URL) throw new Error('DATABASE_URL 미설정: Supabase 연결 문자열이 필요합니다.')

// 서버리스에서는 Supabase Transaction Pooler(6543) + prepare:false 를 쓴다.
export const sql = postgres(URL, {
  prepare: false,
  max: Number(process.env.PG_POOL_MAX ?? 1),
  idle_timeout: 20,
  connect_timeout: 10,
  // int8(bigint) 을 JS number 로 받는다. 기본값은 string 이고 postgres.BigInt 는
  // JSON 직렬화가 안 되므로(JSON.stringify 가 BigInt 에서 예외) 둘 다 쓰지 않는다.
  // id·COUNT 모두 Number.MAX_SAFE_INTEGER 안이라 안전하다.
  types: {
    bigint: {
      to: 20,
      from: [20],
      serialize: (x: number | bigint) => x.toString(),
      parse: (x: string) => Number(x),
    },
  },
  transform: { undefined: null },
})

/** `?` → `$1, $2 …` (문자열 리터럴 안의 ? 는 건드리지 않는다) */
function toPgPlaceholders(text: string): string {
  let out = ''
  let i = 0
  let n = 0
  let quote: string | null = null
  while (i < text.length) {
    const ch = text[i]
    if (quote) {
      out += ch
      if (ch === quote) quote = null
      i++
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      out += ch
      i++
      continue
    }
    if (ch === '?') {
      out += '$' + ++n
      i++
      continue
    }
    out += ch
    i++
  }
  return out
}

type Row = Record<string, any>

/**
 * 진행 중인 트랜잭션 연결을 비동기 컨텍스트로 전파한다.
 * 이게 없으면 db.transaction() 안의 db.prepare() 가 풀에서 **다른** 연결을 집어
 *  (1) 트랜잭션 밖에서 실행되어 롤백이 안 되고
 *  (2) 풀이 가득 차면(max:1) 서로를 기다리며 데드락이 난다.
 */
const txStore = new AsyncLocalStorage<Conn>()
const conn = (): Conn => txStore.getStore() ?? sql

class Statement {
  private readonly text: string
  constructor(private readonly raw: string) {
    this.text = toPgPlaceholders(raw)
  }

  private exec(args: any[]) {
    // 호출부가 .get(a, b) 또는 .get([a, b]) 둘 다 쓰므로 평탄화한다.
    const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args
    return conn().unsafe(this.text, params as any[])
  }

  async get(...args: any[]): Promise<Row | undefined> {
    const rows = await this.exec(args)
    return rows[0] as Row | undefined
  }

  async all(...args: any[]): Promise<Row[]> {
    return (await this.exec(args)) as unknown as Row[]
  }

  /** better-sqlite3 호환: { changes, lastInsertRowid } */
  async run(...args: any[]): Promise<{ changes: number; lastInsertRowid: number | null }> {
    const isInsert = /^\s*insert\s/i.test(this.text)
    const wantsReturn = isInsert && !/returning/i.test(this.text)
    const text = wantsReturn ? this.text.replace(/;?\s*$/, ' RETURNING id') : this.text
    const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args
    let rows: any
    try {
      rows = await conn().unsafe(text, params as any[])
    } catch (e: any) {
      // id 컬럼이 없는 테이블(sessions 등)의 INSERT 는 RETURNING 없이 재시도
      if (wantsReturn && /column "id" does not exist/i.test(e?.message ?? '')) {
        rows = await conn().unsafe(this.text, params as any[])
      } else throw e
    }
    return {
      changes: rows.count ?? rows.length ?? 0,
      lastInsertRowid: rows?.[0]?.id ?? null,
    }
  }
}

type Conn = typeof sql

export const db = {
  prepare(text: string) {
    return new Statement(text)
  },
  /** DDL·여러 문장 실행 */
  async exec(text: string) {
    await conn().unsafe(text)
  },
  /**
   * better-sqlite3 의 db.transaction(fn) 대체.
   * 반환된 함수를 호출하면 트랜잭션 안에서 fn 이 실행된다. fn 은 async 여야 한다.
   */
  transaction<T>(fn: () => Promise<T>) {
    return async (): Promise<T> => {
      let result!: T
      await sql.begin(async (tx) => {
        // fn 안의 db.prepare() 가 이 트랜잭션 연결을 쓰도록 컨텍스트에 심는다.
        await txStore.run(tx as unknown as Conn, async () => {
          result = await fn()
        })
      })
      return result
    }
  },
}

// PIN 해시 유틸
export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(pin, salt, 32).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPinHash(pin: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(':')
    const candidate = scryptSync(pin, salt, 32)
    return timingSafeEqual(Buffer.from(hash, 'hex'), candidate)
  } catch {
    return false
  }
}

export function generateAccessToken(): string {
  return randomBytes(24).toString('hex')
}

/** 기본 사업장 시드 (최초 1회). 스키마는 Supabase 마이그레이션이 담당한다. */
export async function ensureSeed(): Promise<void> {
  const defaultPin = hashPin(process.env.DEFAULT_MANAGER_PIN || '1234')
  await db
    .prepare(
      `INSERT INTO businesses (slug, name, manager_pin) VALUES ('default', '기본 사업장', ?)
       ON CONFLICT (slug) DO NOTHING`,
    )
    .run(defaultPin)
}
