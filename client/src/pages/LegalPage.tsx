import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import termsRaw from '../legal/TERMS_OF_SERVICE.md?raw'
import privacyRaw from '../legal/PRIVACY_POLICY.md?raw'

const DOCS: Record<string, { title: string; body: string }> = {
  terms: { title: '이용약관', body: termsRaw },
  privacy: { title: '개인정보처리방침', body: privacyRaw },
}

export default function LegalPage() {
  const { doc } = useParams<{ doc: string }>()
  const navigate = useNavigate()
  const entry = doc && DOCS[doc]

  if (!entry) {
    return (
      <div className="min-h-screen bg-white max-w-3xl mx-auto px-6 py-16 text-center">
        <p className="text-gray-500">문서를 찾을 수 없습니다.</p>
        <button onClick={() => navigate('/')} className="mt-4 text-sm text-gray-400 hover:text-gray-600 underline">← 메인으로</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-100 px-6 py-4 max-w-3xl mx-auto flex items-center justify-between">
        <button onClick={() => navigate('/')} className="text-sm text-gray-400 hover:text-gray-600">← 메인으로</button>
        <span className="text-sm font-bold text-gray-700">{entry.title}</span>
        <span className="w-12" />
      </header>

      <article className="max-w-3xl mx-auto px-6 py-10 prose-legal">
        <ReactMarkdown
          components={{
            h1: ({ children }) => <h1 className="text-2xl font-extrabold text-gray-900 mb-4">{children}</h1>,
            h2: ({ children }) => <h2 className="text-lg font-bold text-gray-800 mt-8 mb-3">{children}</h2>,
            h3: ({ children }) => <h3 className="text-base font-bold text-gray-700 mt-5 mb-2">{children}</h3>,
            p: ({ children }) => <p className="text-sm text-gray-600 leading-relaxed mb-3">{children}</p>,
            ul: ({ children }) => <ul className="text-sm text-gray-600 list-disc pl-5 mb-3 space-y-1">{children}</ul>,
            ol: ({ children }) => <ol className="text-sm text-gray-600 list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
            li: ({ children }) => <li>{children}</li>,
            strong: ({ children }) => <strong className="font-bold text-gray-800">{children}</strong>,
            hr: () => <hr className="my-6 border-gray-200" />,
            blockquote: ({ children }) => <blockquote className="border-l-4 border-orange-300 bg-orange-50 pl-4 py-2 my-3 text-sm text-gray-700">{children}</blockquote>,
            table: ({ children }) => <div className="overflow-x-auto my-3"><table className="w-full text-sm border-collapse">{children}</table></div>,
            thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
            th: ({ children }) => <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-700 text-xs">{children}</th>,
            td: ({ children }) => <td className="border border-gray-200 px-3 py-2 text-gray-600 text-xs">{children}</td>,
            code: ({ children }) => <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">{children}</code>,
            a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{children}</a>,
          }}
        >
          {entry.body}
        </ReactMarkdown>
      </article>

      <footer className="border-t border-gray-100 mt-10 px-6 py-6 text-center text-xs text-gray-400">
        주식회사 지누소프트 · 사업자등록번호 716-87-01425
      </footer>
    </div>
  )
}
