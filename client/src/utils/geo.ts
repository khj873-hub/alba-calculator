export function getCurrentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('이 브라우저는 위치 서비스를 지원하지 않습니다'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) reject(new Error('위치 권한이 거부되었습니다. 브라우저 설정에서 위치를 허용해주세요.'))
        else reject(new Error('위치를 가져올 수 없습니다. 잠시 후 다시 시도해주세요.'))
      },
      { timeout: 10000, maximumAge: 30000 }
    )
  })
}
