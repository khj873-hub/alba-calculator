import { useParams, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'

export function useSlug(): string {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  useEffect(() => {
    if (!slug) navigate('/', { replace: true })
  }, [slug, navigate])
  return slug ?? ''
}
