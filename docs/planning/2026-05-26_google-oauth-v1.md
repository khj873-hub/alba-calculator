# 구글 로그인(OAuth 2.0) 도입 v1 기획안

- **작성일**: 2026-05-26
- **상태**: 🟡 검토 중 — 사장님 확정 후 단계별 구현
- **트리거**: PIN 분실 운영 부담 해소 + 보안 강화 + 향후 카카오 OAuth 확장 대비
- **선행 결정사항**
  - 기존 PIN 사업장 유지 + 구글 연결 선택 옵션 (강제 마이그레이션 X)
  - 카카오는 본 작업 완료 후 별도 PR로 추가

---

## 1. 목적

| 문제 | 현재 | 도입 후 |
|---|---|---|
| PIN 분실 운영 부담 | 운영자가 일일이 PIN 초기화 | 사장님이 본인 구글로 복구 |
| PIN 4자리 보안 우려 | 추측·brute-force 위험 (rate limit 10/분) | OAuth 표준, 구글 보안 수준 |
| 사장님 식별 | 사업장별로만 존재 | 사람(구글 계정) = 1, 사업장 = N 관계 |
| 신청서 → 등록 연결 | 운영자가 PIN을 사장님에게 안전 전달 필요 | 구글 이메일만 매칭하면 끝 |

---

## 2. 핵심 데이터 흐름

```
┌─────────┐                ┌────────┐                ┌──────────┐
│ 사장님  │  ① 로그인 클릭 │ 우리 앱│  ② redirect    │ 구글     │
│ 브라우저├─────────────→│ (Vite) ├───────────────→│ OAuth    │
│         │                │        │                │ 서버     │
│         │  ⑤ 세션 토큰   │        │  ④ ID token    │          │
│         │ ←──────────────│        │ ←──────────────│          │
└─────────┘                └────┬───┘                └──────────┘
                                │ ③ token 검증·user 조회·세션 발급
                                ▼
                          ┌──────────┐
                          │ Railway  │
                          │ SQLite   │
                          │ (users·  │
                          │ sessions)│
                          └──────────┘
```

### 우리 서버가 받는 정보 (구글 ID token claim)
- `sub` — 구글 사용자 고유 ID (영구 불변, 우리 키 값)
- `email` — 이메일 (운영자가 신청서와 매칭하는 키)
- `email_verified` — 이메일 검증 여부 (true만 허용)
- `name`, `picture` — 표시용 (선택)

### 우리 서버가 **저장하지 않는 것**
- 비밀번호 (절대 우리에게 안 옴)
- 구글 access token / refresh token (1회용 ID token만 검증 후 폐기)
- 사장님의 다른 구글 데이터 (Gmail·Drive 등)

---

## 3. DB 변경

### 신규 테이블 `users`
```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  provider      TEXT NOT NULL CHECK(provider IN ('google', 'kakao')),  -- 향후 확장
  provider_id   TEXT NOT NULL,        -- Google sub
  email         TEXT NOT NULL,
  name          TEXT,
  picture_url   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  last_login_at TEXT,
  UNIQUE(provider, provider_id)
);
CREATE INDEX idx_users_email ON users(email);
```

### `businesses` 컬럼 추가
```sql
ALTER TABLE businesses ADD COLUMN owner_user_id INTEGER REFERENCES users(id);
-- NULL 허용: 기존 PIN 전용 사업장은 NULL (PIN으로만 로그인)
-- 구글 연결된 사업장은 user.id 참조
```

### `sessions` 테이블 (기존)
변경 없음. 다만 발급 경로가 두 가지:
- PIN 인증 → 세션 토큰 (기존)
- OAuth 인증 → 세션 토큰 (신규)

---

## 4. 인증 시나리오 (4가지 경우)

| 사업장 상태 | 사장님 행동 | 동작 |
|---|---|---|
| **PIN 전용 (기존)** | PIN 입력 | 기존 흐름 그대로 (변경 없음) |
| **PIN 전용 (기존)** | "구글로 연결" 버튼 | 구글 로그인 → 운영자 매핑 검토 후 `owner_user_id` 설정 |
| **구글 연결됨** | "구글로 로그인" 버튼 | OAuth → `owner_user_id` 매칭 → 세션 발급 |
| **구글 연결됨** | PIN 입력 (백업) | PIN도 유효하게 유지 (사장님이 일시적 분실 시) |

---

## 5. 운영자 신규 등록 흐름 변경

### 기존 (PIN)
1. 신청 폼 → 운영자 확인 → 사업장명·PIN 결정
2. PIN을 사장님에게 안전 전달 (카카오톡 비밀 메시지 등)
3. 사장님이 PIN으로 로그인

### 신규 (구글)
1. 신청 폼에 **사장님 구글 이메일** 필수 입력
2. 운영자가 사업장 등록 시:
   - `businesses(slug, name)` 생성
   - 사장님 이메일로 `users` 행 미리 생성 (`provider='google'`, `provider_id`는 first-login에서 채움)
   - `businesses.owner_user_id` 연결
3. 사장님에게 **URL만** 전달 (PIN 없음)
4. 사장님이 첫 로그인 시 구글 OAuth → 이메일 매칭 → 자동 연결

### 신청 폼 추가 필드
- `구글 이메일` (필수)
- 폼 ID: `1FAIpQLSfqabZynjYejxaNUbJoCAL1LmBFZh5a1lCF4WudjaNvFEtVkg`
- 운영자가 응답 시트에서 이메일 확인 후 등록

---

## 6. 화면 변경

| 화면 | 변경 |
|---|---|
| **로그인 화면** (`/{slug}/manager/login`) | "구글로 로그인" 버튼 + 기존 PIN 입력 (둘 다 노출) |
| **OAuth 콜백** (`/auth/google/callback`) 신규 | 구글 인증 후 리다이렉트, 토큰 검증, 사업장 매핑 |
| **대시보드** | 상단에 로그인한 구글 계정 표시 (이메일·프로필 사진) |
| **사업장 설정** | "구글 계정 연결/해제" 섹션 (PIN 연동 사업장만) |

---

## 7. 기술 의사결정

### OAuth Client 구성
- **Google Cloud Console**: 프로젝트 생성 → OAuth 2.0 Client ID 발급
  - **Authorized origins**: `https://alba-calculator-production.up.railway.app`, `http://localhost:5174`
  - **Authorized redirect URIs**: `{origin}/auth/google/callback`
- **Client ID·Secret**: Railway 환경 변수 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

### 흐름 방식 — Authorization Code (PKCE)
- 보안 표준 (Implicit flow는 deprecated)
- 백엔드에서 code → token 교환 (client secret 사용)
- 프런트에는 token 절대 노출 안 함

### 라이브러리
- 백엔드: `google-auth-library` (Google 공식 Node.js SDK) — ID token 검증
- 프런트: 기본 `window.location.href`로 OAuth URL 이동 (라이브러리 없음, 가볍게)

---

## 8. 구현 단계 (Step별)

### Step A — DB·환경 변수 (~30분)
- `users` 테이블 + `businesses.owner_user_id` 마이그레이션
- `.env.example`에 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` 추가
- Google Cloud Console OAuth 클라이언트 발급 (수동)

### Step B — 백엔드 OAuth (1일)
- `/api/auth/google/callback` 라우트 — code 교환·ID token 검증
- user 자동 upsert + 세션 발급
- 운영자용 `/api/admin/businesses/link-owner` (이메일로 사업장 미리 연결)

### Step C — 프런트 (1일)
- 로그인 화면 "구글로 로그인" 버튼
- OAuth 콜백 페이지 — 토큰 받아 세션 토큰 저장 후 대시보드 이동
- 대시보드 상단에 사장님 계정 표시
- 사업장 설정에 "구글 연결/해제" 섹션

### Step D — 검증·문서 (반나절)
- 자동 회귀 (기존 PIN 흐름 영향 없음 확인)
- 신청 폼 안내 갱신
- 사용 설명서(USER_GUIDE.md) 신규 흐름 반영

### 예상 총 작업: **2~3일**

---

## 9. 리스크 및 대응

| 리스크 | 대응 |
|---|---|
| Google Cloud OAuth 승인 정책 (verification) | 외부 사용자 100명까지는 인증 절차 없이 사용 가능. 그 이상은 Google 검토 (1~2주 소요) |
| 사장님이 다른 이메일로 신청 후 다른 계정으로 로그인 | 운영자에게 문의 → 매핑 변경 (또는 사장님이 "기존 이메일로 로그인" 안내) |
| 환경 변수 노출 | Railway 환경 변수는 빌드에 인라인되지 않음 (Vite는 `VITE_` 접두사만). `GOOGLE_CLIENT_SECRET`은 서버에만 |
| 기존 PIN 사장님이 OAuth 도입 후 혼란 | 로그인 화면에 PIN/구글 둘 다 노출. 안내 문구 명시 |

---

## 10. 카카오 OAuth 추가 시 영향 (P2)

### 변경되는 것
- `users.provider` 컬럼에 `'kakao'` 추가 (CHECK 제약 갱신)
- 로그인 화면에 "카카오로 로그인" 버튼 추가
- 콜백 라우트 1개 추가 (`/auth/kakao/callback`)

### 변경 안 되는 것
- `users` 테이블 구조 (이미 provider 추상화됨)
- `businesses.owner_user_id` 연결 방식
- 세션 발급 흐름

→ 본 v1에서 provider 추상화만 잘 해두면 카카오 추가는 **0.5일 분량**.

---

## 11. 확인 후 다음 단계

이 기획서를 사장님이 검토하시고 다음 한 가지만 결정해주시면 구현 진입합니다:

**Q. 운영자 신청 폼에 "사장님 구글 이메일" 필드 추가는 누가 하시나요?**
- 옵션 1: 사장님이 Google Forms 직접 편집 후 알려주심
- 옵션 2: 본 PR에서 운영자 측 등록 시 별도 확인 절차로 처리 (폼 미수정)

다른 변경하고 싶은 부분이나 의견 있으면 본 문서에 코멘트 또는 채팅으로 알려주세요.

---

## 참고
- Google OAuth 2.0 공식 문서: https://developers.google.com/identity/protocols/oauth2
- Google ID Token 검증: https://developers.google.com/identity/sign-in/web/backend-auth
- google-auth-library: https://www.npmjs.com/package/google-auth-library
