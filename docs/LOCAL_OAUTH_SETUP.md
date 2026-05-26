# 로컬 환경에서 구글 OAuth 확인하기

> dev 서버에서 "구글로 로그인" 흐름을 동작시키려면 Google Cloud Console에서 OAuth 클라이언트 ID 발급 후 환경 변수 설정이 필요합니다.
>
> 환경 변수가 비어 있으면 OAuth는 자동 비활성화되어 기존 PIN 흐름만 동작합니다 (안전).

---

## 1. Google Cloud Console 설정 (5~10분)

### 1.1 프로젝트 만들기
1. https://console.cloud.google.com/ 접속 → 구글 계정 로그인
2. 좌측 상단 프로젝트 선택 → **새 프로젝트**
3. 이름: `퍼펙트 근태관리` (자유롭게)

### 1.2 OAuth 동의 화면 설정
1. 좌측 메뉴 → **API 및 서비스 → OAuth 동의 화면**
2. **외부** 선택 → 만들기
3. 입력
   - 앱 이름: `퍼펙트 근태관리`
   - 사용자 지원 이메일: 사장님 본인 이메일
   - 개발자 연락처: 본인 이메일
4. **저장 후 계속**
5. 범위(Scopes) 단계: **저장 후 계속** (기본값 OK)
6. 테스트 사용자: **사장님 본인 구글 이메일 추가** (테스트 단계 — 외부 100명까지)
7. **저장 후 계속**

### 1.3 OAuth 2.0 클라이언트 ID 발급
1. 좌측 메뉴 → **API 및 서비스 → 사용자 인증 정보**
2. **+ 사용자 인증 정보 만들기** → OAuth 클라이언트 ID
3. 애플리케이션 유형: **웹 애플리케이션**
4. 이름: `alba-calculator local + prod`
5. **승인된 JavaScript 원본**:
   ```
   http://localhost:5174
   https://alba-calculator-production.up.railway.app
   ```
6. **승인된 리디렉션 URI**:
   ```
   http://localhost:5174/api/auth/google/callback
   https://alba-calculator-production.up.railway.app/api/auth/google/callback
   ```
7. **만들기** → 다음 정보 확보
   - **Client ID** (xxx.apps.googleusercontent.com)
   - **Client Secret** (xxx)

---

## 2. 로컬 환경 변수 설정

`alba-calculator/server/` 에 `.env` 파일 생성 (없으면 새로 만듦):

```bash
cd alba-calculator/server
cp .env.example .env
```

`.env` 편집:
```
PORT=3002
NODE_ENV=development
MANAGER_PIN=1234

# 구글 OAuth (위에서 받은 값 채우기)
GOOGLE_CLIENT_ID=xxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxxxx
PUBLIC_ORIGIN=http://localhost:5174
```

⚠️ **`.env` 파일은 절대 git commit 하지 마세요** (`.gitignore`에 이미 등록됨).

---

## 3. dev 서버 재시작

```bash
# 기존 dev 서버 종료 후
cd alba-calculator
npm run dev
```

---

## 4. 동작 확인

### 4.1 사장님 입장 (구글 로그인 신규)

1. 브라우저: http://localhost:5174
2. **사업장 만들기** (또는 기존 사업장 진입)
3. **/{slug}/manager/login** 진입 → **"구글로 로그인"** 버튼 표시
4. 클릭 → 구글 동의 화면 (테스트 사용자로 등록한 이메일로 로그인)
5. 동의 → 자동으로 사장님 대시보드로 진입

> 처음엔 "이 사업장에 연결되지 않았습니다" 경고가 나옵니다. 운영자가 이메일을 미리 매핑해두지 않았기 때문 — 4.2 단계로 진행하세요.

### 4.2 운영자(관리자) 입장 — 이메일 사전 매핑

curl 또는 API 도구로:
```bash
curl -X POST http://localhost:3002/api/businesses/{slug}/link-owner \
  -H "Content-Type: application/json" \
  -d '{"pin":"사장님_PIN","email":"사장님@gmail.com"}'
```

이후 사장님이 다시 "구글로 로그인" 시도 → 즉시 인증 성공.

> P1에서 운영자 전용 화면(GUI) 만들 예정. P0는 API 직접 호출.

### 4.3 기존 PIN 흐름도 그대로
- PIN 로그인 버튼도 **여전히 동작** (구글 연결과 별도)
- 기존 사업장 사장님이 OAuth 도입 후에도 PIN으로 로그인 가능

---

## 5. 동작 안 할 때 점검

| 증상 | 원인 | 해결 |
|---|---|---|
| "구글로 로그인" 버튼 안 보임 | 환경 변수 미설정 | `.env`에 `GOOGLE_CLIENT_ID/SECRET` 채우고 서버 재시작 |
| 구글이 "redirect_uri_mismatch" 오류 | Console 등록 URI와 `PUBLIC_ORIGIN` 불일치 | 두 곳 정확히 일치하는지 확인 (포트·끝 슬래시 포함) |
| 구글 동의 후 "이 앱은 검증되지 않음" 경고 | 테스트 사용자 미등록 | OAuth 동의 화면에 사장님 이메일 추가 |
| "사업장에 연결되지 않았습니다" | 운영자가 owner_user_id 미매핑 | 4.2 단계 진행 |
| 콜백 후 빈 화면 | hash token 파싱 실패 | 브라우저 콘솔 확인 + 페이지 새로고침 |

---

## 6. 프로덕션 환경

같은 방식으로 Railway 환경 변수 추가:
```
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
PUBLIC_ORIGIN=https://alba-calculator-production.up.railway.app
```

Google Cloud Console의 승인된 URI에 **production URL이 이미 등록되어 있으니 추가 작업 불필요**.

---

## 7. 보안 메모

- **Client Secret은 절대 프런트 코드·git에 노출 금지** (서버 환경 변수만)
- **PUBLIC_ORIGIN은 정확한 도메인 사용** (https 권장, prod에서 http는 거부됨)
- **state 파라미터로 CSRF 방지** — 우리 코드가 자동 처리
- **ID token만 검증, refresh token 미저장** — 1회용 인증, 우리는 토큰 보관 안 함
