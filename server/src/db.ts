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

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL CHECK(provider IN ('google','kakao')),
    provider_id TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    picture_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    last_login_at TEXT,
    UNIQUE(provider, provider_id)
  );
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
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
  // v2 마이그레이션: 직원 접근 토큰 + 급여 적용 ON/OFF + 홈 화면 모드
  const empColsAfter = db.prepare('PRAGMA table_info(employees)').all() as any[]
  if (empColsAfter.length > 0 && !empColsAfter.find((c: any) => c.name === 'access_token')) {
    db.exec('ALTER TABLE employees ADD COLUMN access_token TEXT')
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_emp_token ON employees(access_token)')
    const existing = db.prepare('SELECT id FROM employees WHERE access_token IS NULL').all() as any[]
    const upd = db.prepare('UPDATE employees SET access_token = ? WHERE id = ?')
    for (const row of existing) upd.run(randomBytes(16).toString('hex'), row.id)
  }
  if (empColsAfter.length > 0 && !empColsAfter.find((c: any) => c.name === 'pay_enabled')) {
    db.exec('ALTER TABLE employees ADD COLUMN pay_enabled INTEGER NOT NULL DEFAULT 1')
  }
  // 주휴수당 포함 시급 모드 — 시급에 주휴분이 녹아있는 포괄임금형 직원
  // 0=별도 지급(기본, 자동 산정) / 1=포함(시급 그대로, weekly_holiday_pay=0)
  const empColsV4 = db.prepare('PRAGMA table_info(employees)').all() as any[]
  if (empColsV4.length > 0 && !empColsV4.find((c: any) => c.name === 'pay_includes_holiday')) {
    db.exec('ALTER TABLE employees ADD COLUMN pay_includes_holiday INTEGER NOT NULL DEFAULT 0')
  }

  // 직원 재직/퇴사 상태 — 요금제 활성 인원 카운트의 토대.
  // 퇴사는 soft 처리(레코드 보존: 임금대장·근태 조회 가능, 활성 카운트에서만 제외).
  const empColsV5 = db.prepare('PRAGMA table_info(employees)').all() as any[]
  if (empColsV5.length > 0 && !empColsV5.find((c: any) => c.name === 'status')) {
    db.exec("ALTER TABLE employees ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
    db.exec('ALTER TABLE employees ADD COLUMN resigned_at TEXT')
  }

  const bizColsAfter = db.prepare('PRAGMA table_info(businesses)').all() as any[]
  if (!bizColsAfter.find((c: any) => c.name === 'home_mode')) {
    db.exec("ALTER TABLE businesses ADD COLUMN home_mode TEXT NOT NULL DEFAULT 'kiosk'")
  }
  // v3 마이그레이션: 휴가(연차/무급/병가/경조사) 기능
  const bizColsV3 = db.prepare('PRAGMA table_info(businesses)').all() as any[]
  if (!bizColsV3.find((c: any) => c.name === 'leave_pay_calc_mode')) {
    db.exec("ALTER TABLE businesses ADD COLUMN leave_pay_calc_mode TEXT NOT NULL DEFAULT '8hours'")
  }
  if (!bizColsV3.find((c: any) => c.name === 'weekly_holiday_includes_leave')) {
    db.exec('ALTER TABLE businesses ADD COLUMN weekly_holiday_includes_leave INTEGER NOT NULL DEFAULT 1')
  }
  if (!bizColsV3.find((c: any) => c.name === 'time_off_enabled')) {
    db.exec('ALTER TABLE businesses ADD COLUMN time_off_enabled INTEGER NOT NULL DEFAULT 0')
  }
  if (!bizColsV3.find((c: any) => c.name === 'owner_user_id')) {
    db.exec('ALTER TABLE businesses ADD COLUMN owner_user_id INTEGER REFERENCES users(id)')
  }
  if (!bizColsV3.find((c: any) => c.name === 'is_active')) {
    db.exec('ALTER TABLE businesses ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1')
  }
  if (!bizColsV3.find((c: any) => c.name === 'suspended_at')) {
    db.exec('ALTER TABLE businesses ADD COLUMN suspended_at TEXT')
  }
  // 요금제: free/basic/pro/enterprise (+레거시 paid). 정의·한도는 plans.ts.
  // plan_expires_at 만료 시 index.ts가 무료(free)로 자동 다운그레이드.
  // CHECK 제약은 ALTER TABLE에서 일부 환경 호환성 이슈 → 앱 레이어에서 검증
  if (!bizColsV3.find((c: any) => c.name === 'plan')) {
    db.exec("ALTER TABLE businesses ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'")
  }
  // 유료 결제 만료일: 'YYYY-MM-DD' KST. NULL이면 무기한.
  // 만료 도달 시 미들웨어가 is_active=0으로 자동 정지
  if (!bizColsV3.find((c: any) => c.name === 'plan_expires_at')) {
    db.exec('ALTER TABLE businesses ADD COLUMN plan_expires_at TEXT')
  }
  // 주휴수당 정책 — 사업장별 커스터마이즈
  // weekly_holiday_threshold_hours: 주휴수당 지급 기준 시간 (법정 15시간, 사업장이 더 엄격하게 가능)
  // week_start_day: 주차 시작 요일 (1=월, 0=일)
  if (!bizColsV3.find((c: any) => c.name === 'weekly_holiday_threshold_hours')) {
    db.exec('ALTER TABLE businesses ADD COLUMN weekly_holiday_threshold_hours INTEGER NOT NULL DEFAULT 15')
  }
  if (!bizColsV3.find((c: any) => c.name === 'week_start_day')) {
    db.exec('ALTER TABLE businesses ADD COLUMN week_start_day INTEGER NOT NULL DEFAULT 1')
  }
  // 출근 SMS 알림 — 사업주 수신번호 + 기능 ON/OFF (기본 OFF, 사업장별 opt-in)
  if (!bizColsV3.find((c: any) => c.name === 'notify_phone')) {
    db.exec('ALTER TABLE businesses ADD COLUMN notify_phone TEXT')
  }
  if (!bizColsV3.find((c: any) => c.name === 'sms_notify_enabled')) {
    db.exec('ALTER TABLE businesses ADD COLUMN sms_notify_enabled INTEGER NOT NULL DEFAULT 0')
  }
  // time_off 테이블이 구 스키마(half_period NULL 허용)면 신 스키마로 재생성
  const toExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='time_off'").get() as any
  if (toExists) {
    const toCols = db.prepare('PRAGMA table_info(time_off)').all() as any[]
    const hpCol = toCols.find((c: any) => c.name === 'half_period')
    if (hpCol && hpCol.notnull === 0) {
      db.exec(`
        CREATE TABLE time_off_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('annual','unpaid','sick','family')),
          portion REAL NOT NULL DEFAULT 1.0 CHECK(portion IN (0.5, 1.0)),
          half_period TEXT NOT NULL DEFAULT 'full' CHECK(half_period IN ('am','pm','full')),
          memo TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          UNIQUE(employee_id, date, half_period)
        );
        INSERT INTO time_off_new (id, employee_id, date, type, portion, half_period, memo, created_at)
          SELECT id, employee_id, date, type, portion, COALESCE(half_period, 'full'), memo, created_at FROM time_off;
        DROP TABLE time_off;
        ALTER TABLE time_off_new RENAME TO time_off;
        CREATE INDEX IF NOT EXISTS idx_timeoff_emp_date ON time_off(employee_id, date);
      `)
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
    hourly_rate INTEGER NOT NULL DEFAULT 10320,
    color TEXT NOT NULL DEFAULT '#3B82F6',
    access_token TEXT,
    pay_enabled INTEGER NOT NULL DEFAULT 1,
    pay_includes_holiday INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    resigned_at TEXT,
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
  CREATE UNIQUE INDEX IF NOT EXISTS idx_emp_token ON employees(access_token);

  CREATE TABLE IF NOT EXISTS time_off (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('annual','unpaid','sick','family')),
    portion REAL NOT NULL DEFAULT 1.0 CHECK(portion IN (0.5, 1.0)),
    half_period TEXT NOT NULL DEFAULT 'full' CHECK(half_period IN ('am','pm','full')),
    memo TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(employee_id, date, half_period)
  );
  CREATE INDEX IF NOT EXISTS idx_timeoff_emp_date ON time_off(employee_id, date);

  CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT,
    inquiry_type TEXT,
    business_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    content TEXT,
    agreed_marketing INTEGER NOT NULL DEFAULT 0,
    ip TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    handled_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_inquiry_status ON inquiries(status);
  CREATE INDEX IF NOT EXISTS idx_inquiry_created ON inquiries(created_at DESC);
  `)

  // 문의 유형(관심 플랜·단순 도입 등) — 기존 inquiries 테이블에 멱등 추가
  const inqCols = db.prepare('PRAGMA table_info(inquiries)').all() as any[]
  if (inqCols.length > 0 && !inqCols.find((c: any) => c.name === 'inquiry_type')) {
    db.exec('ALTER TABLE inquiries ADD COLUMN inquiry_type TEXT')
  }

  db.exec(`

  CREATE TABLE IF NOT EXISTS notification_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,                 -- 'sms' | 'alimtalk'
    to_phone TEXT NOT NULL,
    template TEXT,                         -- 'check_in' | 'test' 등
    message TEXT NOT NULL,
    status TEXT NOT NULL,                  -- 'sent' | 'failed' | 'skipped'
    provider_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_notiflog_created ON notification_logs(created_at DESC);
`)

// 토큰 헬퍼 (employees INSERT 시 사용)
export function generateAccessToken(): string {
  return randomBytes(16).toString('hex')
}
