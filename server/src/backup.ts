import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { db } from './db'
import path from 'path'
import fs from 'fs'

const ENABLED = !!(
  process.env.R2_ENDPOINT &&
  process.env.R2_BUCKET &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY
)

const BUCKET = process.env.R2_BUCKET ?? ''
const INTERVAL_MS = 5 * 60 * 1000      // 5분
const RETENTION_DAYS = 30
const PREFIX = 'snapshots/'

// 환경변수에 섞인 trailing whitespace/newline은 SigV4 서명 미스매치 유발
const s3 = ENABLED ? new S3Client({
  endpoint: process.env.R2_ENDPOINT!.trim(),
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!.trim(),
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!.trim(),
  },
  region: 'auto',
  forcePathStyle: true,
}) : null

async function snapshotAndUpload(): Promise<boolean> {
  if (!s3) return false
  const tmpPath = path.join('/tmp', `alba-snapshot-${Date.now()}.db`)
  try {
    // better-sqlite3.backup(): 트랜잭션 lock 안 걸고 일관성 있는 파일 사본
    await db.backup(tmpPath)
    const data = fs.readFileSync(tmpPath)
    const key = `${PREFIX}alba-${new Date().toISOString().replace(/[:.]/g, '-')}.db`
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: data,
      ContentType: 'application/octet-stream',
    }))
    console.log(`[backup] ✓ ${key} (${(data.length / 1024 / 1024).toFixed(2)} MB)`)
    return true
  } catch (e: any) {
    console.error('[backup] ✗ 실패:', e.message)
    return false
  } finally {
    try { fs.unlinkSync(tmpPath) } catch {}
  }
}

async function cleanupOldBackups() {
  if (!s3) return
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    let continuationToken: string | undefined = undefined
    const toDelete: { Key: string }[] = []

    do {
      const list: any = await s3.send(new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: PREFIX,
        ContinuationToken: continuationToken,
      }))
      for (const o of list.Contents ?? []) {
        if (o.LastModified && o.LastModified.getTime() < cutoff && o.Key) {
          toDelete.push({ Key: o.Key })
        }
      }
      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined
    } while (continuationToken)

    if (toDelete.length === 0) return

    // S3 DeleteObjects는 한 번에 1000개 한도
    for (let i = 0; i < toDelete.length; i += 1000) {
      const batch = toDelete.slice(i, i + 1000)
      await s3.send(new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: batch, Quiet: true },
      }))
    }
    console.log(`[backup] retention: ${toDelete.length}개 삭제 (${RETENTION_DAYS}일 초과)`)
  } catch (e: any) {
    console.error('[backup] retention 실패:', e.message)
  }
}

export function startBackup() {
  if (!ENABLED) {
    console.log('[backup] ⚠️  R2 환경변수 미설정 — 백업 비활성화')
    return
  }
  console.log(`[backup] R2 백업 활성 — ${INTERVAL_MS / 60000}분 간격, ${RETENTION_DAYS}일 보관 (bucket=${BUCKET})`)
  console.log('[backup] 시작 시 1회 백업 시도...')

  snapshotAndUpload().then(ok => { if (ok) cleanupOldBackups() })

  setInterval(() => {
    snapshotAndUpload().then(ok => { if (ok) cleanupOldBackups() })
  }, INTERVAL_MS)
}
