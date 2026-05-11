import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchBusinesses, updateBusiness, deleteBusiness, changePin } from '../api'
import type { Business } from '../types'

type Modal =
  | { type: 'edit'; slug: string; currentName: string }
  | { type: 'pin'; slug: string; name: string }
  | { type: 'delete'; slug: string; name: string }
  | null

export default function BusinessListPage() {
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<Modal>(null)
  const [pin, setPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [newPinConfirm, setNewPinConfirm] = useState('')
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()

  const load = () =>
    fetchBusinesses().then(setBusinesses).finally(() => setLoading(false))

  useEffect(() => { load() }, [])

  const openEdit = (biz: Business) => {
    setModal({ type: 'edit', slug: biz.slug, currentName: biz.name })
    setNewName(biz.name); setPin(''); setError('')
  }
  const openPin = (biz: Business) => {
    setModal({ type: 'pin', slug: biz.slug, name: biz.name })
    setPin(''); setNewPin(''); setNewPinConfirm(''); setError('')
  }
  const openDelete = (biz: Business) => {
    setModal({ type: 'delete', slug: biz.slug, name: biz.name })
    setPin(''); setError('')
  }
  const closeModal = () => {
    setModal(null); setPin(''); setNewPin(''); setNewPinConfirm(''); setNewName(''); setError('')
  }

  const handleEdit = async () => {
    if (!modal || modal.type !== 'edit') return
    if (!newName.trim()) { setError('사업장명을 입력하세요'); return }
    if (!pin) { setError('PIN을 입력하세요'); return }
    setSaving(true); setError('')
    try {
      await updateBusiness(modal.slug, { name: newName.trim(), pin })
      await load(); closeModal()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  const handlePin = async () => {
    if (!modal || modal.type !== 'pin') return
    if (!pin) { setError('현재 PIN을 입력하세요'); return }
    if (newPin.length < 4) { setError('새 PIN은 4자리 이상이어야 합니다'); return }
    if (newPin !== newPinConfirm) { setError('새 PIN이 일치하지 않습니다'); return }
    setSaving(true); setError('')
    try {
      await changePin(modal.slug, { current_pin: pin, new_pin: newPin })
      closeModal()
      alert('PIN이 변경되었습니다.')
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!modal || modal.type !== 'delete') return
    if (!pin) { setError('PIN을 입력하세요'); return }
    setSaving(true); setError('')
    try {
      await deleteBusiness(modal.slug, pin)
      await load(); closeModal()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  const formatDate = (dt: string) => {
    const d = new Date(dt)
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col px-6 max-w-lg mx-auto py-10">
      <button onClick={() => navigate('/')} className="text-gray-400 text-sm mb-6 self-start">← 돌아가기</button>

      <h1 className="text-xl font-extrabold text-gray-800 mb-1">사업장 목록</h1>
      <p className="text-sm text-gray-400 mb-6">등록된 전체 사업장입니다</p>

      {loading ? (
        <div className="text-center text-gray-400 py-20">불러오는 중...</div>
      ) : businesses.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-4xl mb-3">🏪</div>
          <p className="text-sm">등록된 사업장이 없습니다</p>
          <button onClick={() => navigate('/create')} className="mt-4 text-blue-600 text-sm font-semibold">
            새 사업장 등록하기 →
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {businesses.map((biz) => (
            <div key={biz.slug} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
              <div className="flex items-center justify-between">
                <button className="flex-1 text-left" onClick={() => navigate(`/${biz.slug}`)}>
                  <div className="font-bold text-gray-800">{biz.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    코드: <span className="font-mono font-semibold text-gray-600">{biz.slug}</span>
                    <span className="mx-2">·</span>
                    {formatDate(biz.created_at)}
                  </div>
                </button>
                <div className="flex items-center gap-1 ml-3 shrink-0">
                  <button onClick={() => openEdit(biz)}
                    className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition text-sm" title="이름 수정">
                    ✏️
                  </button>
                  <button onClick={() => openPin(biz)}
                    className="p-2 text-gray-400 hover:text-yellow-500 hover:bg-yellow-50 rounded-xl transition text-sm" title="PIN 변경">
                    🔑
                  </button>
                  <button onClick={() => openDelete(biz)}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition text-sm" title="삭제">
                    🗑
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <button onClick={() => navigate('/create')}
        className="mt-6 w-full border-2 border-blue-600 text-blue-600 font-bold py-4 rounded-2xl text-sm hover:bg-blue-50 transition">
        + 새 사업장 등록하기
      </button>

      {/* 모달 */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-6">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl">

            {/* 이름 수정 */}
            {modal.type === 'edit' && (
              <>
                <h3 className="text-lg font-extrabold text-gray-800 mb-4">사업장명 수정</h3>
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">새 사업장명</label>
                    <input value={newName} onChange={e => setNewName(e.target.value)} autoFocus
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">관리자 PIN</label>
                    <input type="password" value={pin} onChange={e => setPin(e.target.value)}
                      placeholder="PIN 입력" inputMode="numeric"
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      onKeyDown={e => e.key === 'Enter' && handleEdit()} />
                  </div>
                  {error && <p className="text-red-500 text-xs">{error}</p>}
                  <div className="flex gap-2 mt-1">
                    <button onClick={closeModal} className="flex-1 py-3 rounded-xl border border-gray-200 text-sm text-gray-500 font-semibold hover:bg-gray-50 transition">취소</button>
                    <button onClick={handleEdit} disabled={saving} className="flex-1 py-3 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition disabled:opacity-50">
                      {saving ? '저장 중...' : '저장'}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* PIN 변경 */}
            {modal.type === 'pin' && (
              <>
                <h3 className="text-lg font-extrabold text-gray-800 mb-1">PIN 변경</h3>
                <p className="text-sm text-gray-400 mb-4">{modal.name}</p>
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">현재 PIN</label>
                    <input type="password" value={pin} onChange={e => setPin(e.target.value)}
                      placeholder="현재 PIN 입력" inputMode="numeric" autoFocus
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">새 PIN</label>
                    <input type="password" value={newPin} onChange={e => setNewPin(e.target.value)}
                      placeholder="4자리 이상" inputMode="numeric"
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">새 PIN 확인</label>
                    <input type="password" value={newPinConfirm} onChange={e => setNewPinConfirm(e.target.value)}
                      placeholder="새 PIN 재입력" inputMode="numeric"
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      onKeyDown={e => e.key === 'Enter' && handlePin()} />
                  </div>
                  {error && <p className="text-red-500 text-xs">{error}</p>}
                  <div className="flex gap-2 mt-1">
                    <button onClick={closeModal} className="flex-1 py-3 rounded-xl border border-gray-200 text-sm text-gray-500 font-semibold hover:bg-gray-50 transition">취소</button>
                    <button onClick={handlePin} disabled={saving} className="flex-1 py-3 rounded-xl bg-yellow-400 text-white text-sm font-bold hover:bg-yellow-500 transition disabled:opacity-50">
                      {saving ? '변경 중...' : '변경'}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* 삭제 */}
            {modal.type === 'delete' && (
              <>
                <h3 className="text-lg font-extrabold text-gray-800 mb-1">사업장 삭제</h3>
                <p className="text-sm text-gray-500 mb-4">
                  <span className="font-bold text-gray-700">{modal.name}</span>을 삭제하면<br />
                  직원 및 근태 데이터가 모두 삭제됩니다.
                </p>
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">관리자 PIN 입력</label>
                    <input type="password" value={pin} onChange={e => setPin(e.target.value)}
                      placeholder="PIN 입력" inputMode="numeric" autoFocus
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                      onKeyDown={e => e.key === 'Enter' && handleDelete()} />
                  </div>
                  {error && <p className="text-red-500 text-xs">{error}</p>}
                  <div className="flex gap-2 mt-1">
                    <button onClick={closeModal} className="flex-1 py-3 rounded-xl border border-gray-200 text-sm text-gray-500 font-semibold hover:bg-gray-50 transition">취소</button>
                    <button onClick={handleDelete} disabled={saving} className="flex-1 py-3 rounded-xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition disabled:opacity-50">
                      {saving ? '삭제 중...' : '삭제'}
                    </button>
                  </div>
                </div>
              </>
            )}

          </div>
        </div>
      )}
    </div>
  )
}
