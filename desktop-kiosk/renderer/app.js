/* 퍼펙트근태 키오스크 P0 데모 — 얼굴 등록/인식/라이브니스/출퇴근 기록
   - 얼굴 처리는 전부 기기 내(face-api.js). 원본 사진 저장/전송 없음(임베딩만 localStorage).
   - 데모 한정: 서버 연동·암호화는 P1에서. 지금은 동작·정확도 체감용. */

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
const MATCH_THRESHOLD = 0.5;   // 거리 임계값(작을수록 엄격). 0.5 권장 시작점
const EAR_CLOSED = 0.21;       // 눈 감김 판정
const BLINK_VALID_MS = 4000;   // 최근 깜빡임 유효 시간

const $ = (s) => document.querySelector(s);
const video = $('#video'), overlay = $('#overlay'), ctx = overlay.getContext('2d');
const statusEl = $('#status'), resultEl = $('#result'), hintEl = $('#hint');

const REG_KEY = 'kiosk_faces_v1', LOG_KEY = 'kiosk_logs_v1';
let registry = [];          // [{name, descriptor:number[]}]
let matcher = null;
let current = null;         // 현재 화면에서 인식된 {name, distance}
let lastBlinkAt = 0, eyeWasOpen = true;
let busy = false;

function setStatus(t) { statusEl.textContent = t; }
function showResult(t, kind) { resultEl.textContent = t; resultEl.className = 'result' + (kind ? ' ' + kind : ''); }

/* ---------- 저장소 ---------- */
function loadRegistry() {
  try { registry = JSON.parse(localStorage.getItem(REG_KEY) || '[]'); } catch { registry = []; }
  rebuildMatcher(); renderRegistry();
}
function saveRegistry() { localStorage.setItem(REG_KEY, JSON.stringify(registry)); }
function rebuildMatcher() {
  if (!registry.length) { matcher = null; return; }
  const labeled = registry.map(r => new faceapi.LabeledFaceDescriptors(r.name, [new Float32Array(r.descriptor)]));
  matcher = new faceapi.FaceMatcher(labeled, MATCH_THRESHOLD);
}
function loadLogs() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { return []; } }
function saveLogs(l) { localStorage.setItem(LOG_KEY, JSON.stringify(l)); }

/* ---------- 초기화 ---------- */
async function initBackend() {
  // TF 백엔드 명시 초기화(webgl 우선, 실패 시 cpu) — wasm 미초기화 오류 방지
  for (const be of ['webgl', 'cpu']) {
    try {
      await faceapi.tf.setBackend(be);
      await faceapi.tf.ready();
      if (faceapi.tf.getBackend() === be) { console.log('TF backend:', be); return be; }
    } catch (e) { /* 다음 후보 */ }
  }
  return faceapi.tf.getBackend();
}

async function init() {
  try {
    setStatus('엔진 준비 중…');
    await initBackend();
    setStatus('AI 모델 로딩 중…');
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    loadRegistry(); renderLogs();
    setStatus('카메라 여는 중…');
    await startCamera();
    $('#btnEnroll').disabled = false;
    $('#btnCheck').disabled = false;
    setStatus('준비 완료');
    loop();
  } catch (e) {
    console.error(e);
    setStatus('초기화 실패: ' + (e.message || e));
    showResult('카메라 또는 모델 로딩 실패. 인터넷·카메라 권한을 확인하세요.', 'bad');
  }
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
  video.srcObject = stream;
  await video.play();
  overlay.width = video.videoWidth || 640;
  overlay.height = video.videoHeight || 480;
}

const detOpts = () => new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });
async function detectOne() {
  return faceapi.detectSingleFace(video, detOpts()).withFaceLandmarks().withFaceDescriptor();
}

/* ---------- 라이브니스(눈 깜빡임, EAR) ---------- */
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function eyeAspect(eye) { // 6점
  return (dist(eye[1], eye[5]) + dist(eye[2], eye[4])) / (2 * dist(eye[0], eye[3]));
}
function updateBlink(landmarks) {
  const ear = (eyeAspect(landmarks.getLeftEye()) + eyeAspect(landmarks.getRightEye())) / 2;
  if (ear < EAR_CLOSED) { eyeWasOpen = false; }
  else { if (!eyeWasOpen) lastBlinkAt = Date.now(); eyeWasOpen = true; } // 감았다 뜨는 순간 = 깜빡임
}
function blinkedRecently() { return Date.now() - lastBlinkAt < BLINK_VALID_MS; }

/* ---------- 실시간 루프(인식 표시) ---------- */
async function loop() {
  try {
    const det = await detectOne();
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (det) {
      updateBlink(det.landmarks);
      current = matcher ? matcher.findBestMatch(det.descriptor) : null;
      const box = det.detection.box;
      const matched = current && current.label !== 'unknown';
      ctx.strokeStyle = matched ? '#22c55e' : '#f59e0b';
      ctx.lineWidth = 3;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      const label = matched ? current.label : '미등록';
      ctx.font = '20px sans-serif'; ctx.fillStyle = matched ? '#22c55e' : '#f59e0b';
      ctx.save(); ctx.scale(-1, 1); // 거울 보정해 글자 정방향
      ctx.fillText(label, -(box.x + box.width), box.y - 10);
      ctx.restore();
      hintEl.textContent = matched
        ? (blinkedRecently() ? `${label}님 — 버튼을 눌러 체크` : '천천히 눈을 깜빡여 주세요')
        : '얼굴 등록이 필요합니다';
    } else {
      current = null;
      hintEl.textContent = '화면을 정면으로 바라봐 주세요';
    }
  } catch (e) { /* 프레임 단위 오류는 무시 */ }
  requestAnimationFrame(() => setTimeout(loop, 120));
}

/* ---------- 얼굴 등록 ---------- */
$('#btnEnroll').onclick = async () => {
  const name = $('#name').value.trim();
  if (!name) { showResult('직원 이름을 입력하세요', 'bad'); return; }
  if (busy) return; busy = true;
  setStatus('얼굴 등록 중…');
  const det = await detectOne();
  if (!det) { showResult('얼굴이 보이지 않습니다. 다시 시도', 'bad'); busy = false; setStatus('준비 완료'); return; }
  registry.push({ name, descriptor: Array.from(det.descriptor) });
  saveRegistry(); rebuildMatcher(); renderRegistry();
  $('#name').value = '';
  showResult(`✅ ${name} 등록 완료`, 'ok');
  setStatus('준비 완료'); busy = false;
};

/* ---------- 출근/퇴근 체크 ---------- */
$('#btnCheck').onclick = async () => {
  if (busy) return;
  if (!matcher) { showResult('등록된 얼굴이 없습니다. 먼저 등록하세요', 'bad'); return; }
  if (!current || current.label === 'unknown') { showResult('일치하는 직원이 없습니다 (재시도 또는 수동)', 'bad'); return; }
  if ($('#liveness').checked && !blinkedRecently()) {
    showResult('사진 도용 방지: 천천히 눈을 깜빡인 뒤 다시 눌러 주세요', 'bad'); return;
  }
  record(current.label, current.distance);
};

function record(name, distance) {
  const logs = loadLogs();
  const today = new Date().toISOString().slice(0, 10);
  const lastToday = [...logs].reverse().find(l => l.name === name && l.time.slice(0, 10) === today);
  const type = (lastToday && lastToday.type === '출근') ? '퇴근' : '출근';
  const now = new Date();
  logs.push({ name, type, time: now.toISOString(), sim: +(1 - distance).toFixed(2) });
  saveLogs(logs); renderLogs();
  const hhmm = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  showResult(`✅ ${name}님 ${type}! ${hhmm}  (유사도 ${(1 - distance).toFixed(2)})`, 'ok');
}

/* ---------- 목록 렌더 ---------- */
function renderRegistry() {
  $('#regCount').textContent = registry.length;
  $('#regList').innerHTML = registry.map((r, i) =>
    `<li><span>${esc(r.name)}</span><span class="del" data-i="${i}">삭제</span></li>`).join('');
  $('#regList').querySelectorAll('.del').forEach(el => el.onclick = () => {
    registry.splice(+el.dataset.i, 1); saveRegistry(); rebuildMatcher(); renderRegistry();
  });
}
function renderLogs() {
  const logs = loadLogs().slice().reverse().slice(0, 20);
  $('#logList').innerHTML = logs.map(l => {
    const t = new Date(l.time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const cls = l.type === '출근' ? 'in' : 'out';
    return `<li><span><span class="type ${cls}">${l.type}</span> ${esc(l.name)}</span><span class="t">${t}</span></li>`;
  }).join('') || '<li class="t">기록 없음</li>';
}
$('#btnClear').onclick = () => {
  if (!confirm('등록 얼굴과 출퇴근 기록을 모두 지울까요? (데모 데이터)')) return;
  localStorage.removeItem(REG_KEY); localStorage.removeItem(LOG_KEY);
  registry = []; rebuildMatcher(); renderRegistry(); renderLogs();
  showResult('데모 데이터를 초기화했습니다', '');
};
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

init();
