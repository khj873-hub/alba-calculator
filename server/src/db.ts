import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto'

const DATA_DIR = path.resolve(__dirname, '../../data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'alba.db')
export const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('foreign_keys = ON')

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

// 관리자 세션 토큰 테이블
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
`)

// businesses 테이블 생성
db.exec(`
  CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL DEFAULT '내 사업장',
    manager_pin TEXT NOT NULL DEFAULT '1234',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`)

// employees 테이블 마이그레이션 (트랜잭션으로 원자적 실행)
const migrate = db.transaction(() => {
  const empCols = (db.prepare('PRAGMA table_info(employees)').all() as any[])
  if (empCols.length > 0 && !empCols.find((c: any) => c.name === 'business_id')) {
    const defaultPin = hashPin(process.env.MANAGER_PIN || '1234')
    db.prepare("INSERT OR IGNORE INTO businesses (slug, name, manager_pin) VALUES ('default', '기본 사업장', ?)").run(defaultPin)
    const biz = db.prepare("SELECT id FROM businesses WHERE slug = 'default'").get() as any
    db.exec(`ALTER TABLE employees ADD COLUMN business_id INTEGER DEFAULT ${biz.id}`)
  }
  // 위치 컬럼 추가 (신규)
  const bizCols = db.prepare('PRAGMA table_info(businesses)').all() as any[]
  if (!bizCols.find((c: any) => c.name === 'lat')) {
    db.exec('ALTER TABLE businesses ADD COLUMN lat REAL')
    db.exec('ALTER TABLE businesses ADD COLUMN lng REAL')
    db.exec('ALTER TABLE businesses ADD COLUMN radius_meters INTEGER DEFAULT 300')
  }
  // 평문 PIN이 남아 있는 사업장 재해싱 (초기 마이그레이션 시 해싱 누락된 경우)
  const bizs = db.prepare('SELECT slug, manager_pin FROM businesses').all() as any[]
  for (const b of bizs) {
    if (!b.manager_pin.includes(':')) {
      db.prepare('UPDATE businesses SET manager_pin = ? WHERE slug = ?').run(hashPin(b.manager_pin), b.slug)
    }
  }
})
migrate()

// 나머지 테이블 생성 (신규 설치 시)
db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    hourly_rate INTEGER NOT NULL DEFAULT 9860,
    color TEXT NOT NULL DEFAULT '#3B82F6',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    clock_in TEXT NOT NULL,
    clock_out TEXT,
    memo TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_att_employee ON attendance(employee_id);
  CREATE INDEX IF NOT EXISTS idx_att_clock_in ON attendance(clock_in);
  CREATE INDEX IF NOT EXISTS idx_emp_business ON employees(business_id);
`)
