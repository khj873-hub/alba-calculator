import { useNavigate } from 'react-router-dom'

export default function SuspendedNotice({ slug }: { slug?: string }) {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 max-w-lg mx-auto">
      <div className="text-5xl mb-4">⏸</div>
      <h2 className="text-xl font-extrabold text-gray-800 mb-2">서비스 이용이 일시 제한되었습니다</h2>
      <p className="text-sm text-gray-500 text-center mb-6 leading-relaxed">
        해당 사업장은 현재 서비스 이용이 제한된 상태입니다.<br/>
        운영자에게 문의해주세요.
      </p>

      <div className="bg-white border border-gray-200 rounded-2xl p-5 w-full max-w-sm mb-6">
        <div className="flex justify-between text-xs mb-2">
          <span className="text-gray-400">사업장 코드</span>
          <span className="font-mono font-bold text-gray-700">{slug || '-'}</span>
        </div>
        <div className="border-t border-gray-100 my-3" />
        <div className="text-xs text-gray-500 leading-relaxed">
          <p className="font-bold text-gray-700 mb-1">📞 문의처</p>
          <p>주식회사 지누소프트</p>
          <p>이메일: khj873@jinusoft.com</p>
          <p>전화: 0505-170-3258</p>
        </div>
      </div>

      <button
        onClick={() => navigate('/')}
        className="text-sm text-gray-400 hover:text-gray-600 px-4 py-2 rounded-lg border border-gray-200"
      >
        메인으로
      </button>
    </div>
  )
}
