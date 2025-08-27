/**
 * CORS 설정
 * 프론트엔드와의 안전한 통신을 위한 설정
 */

const corsOptions = {
  // 허용할 도메인들
  origin: function (origin, callback) {
    // 허용된 도메인 목록
    const allowedOrigins = [
      process.env.CLIENT_URL || 'http://localhost:3000',
      'http://localhost:3001', // 개발용 추가 포트
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
    ]

    // 운영 환경에서는 실제 도메인 추가
    if (process.env.NODE_ENV === 'production') {
      allowedOrigins.push(
        'https://yourdomain.com',
        'https://www.yourdomain.com'
      )
    }

    // origin이 없는 경우 (모바일 앱, Postman 등) 허용
    if (!origin) return callback(null, true)

    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true)
    } else {
      const msg = `CORS 정책에 의해 차단된 도메인: ${origin}`
      console.warn(msg)
      return callback(new Error(msg), false)
    }
  },

  // HTTP 메서드 허용 목록
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],

  // 허용할 헤더들
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'Cache-Control',
    'X-API-KEY',
  ],

  // 노출할 헤더들 (클라이언트에서 접근 가능)
  exposedHeaders: [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'X-Total-Count',
  ],

  // 쿠키 전송 허용
  credentials: true,

  // Preflight 요청 캐시 시간 (초)
  maxAge: 86400, // 24시간

  // OPTIONS 요청에 대한 성공 상태 코드
  optionsSuccessStatus: 200,

  // Preflight 요청 통과시키기
  preflightContinue: false,
}

/**
 * 개발 환경용 관대한 CORS 설정
 */
const developmentCorsOptions = {
  origin: true, // 모든 도메인 허용
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['*'],
  credentials: true,
  optionsSuccessStatus: 200,
}

/**
 * 운영 환경용 엄격한 CORS 설정
 */
const productionCorsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      process.env.CLIENT_URL,
      'https://yourdomain.com',
      'https://www.yourdomain.com',
      // 추가 운영 도메인들
    ]

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      console.error(`CORS 차단된 도메인: ${origin}`)
      callback(new Error('CORS 정책 위반'), false)
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Origin', 'Content-Type', 'Accept', 'Authorization'],
  credentials: true,
  maxAge: 3600, // 1시간
}

/**
 * 환경에 따른 CORS 설정 선택
 */
const getCorsOptions = () => {
  if (process.env.NODE_ENV === 'production') {
    return productionCorsOptions
  } else if (process.env.NODE_ENV === 'development') {
    return developmentCorsOptions
  } else {
    return corsOptions
  }
}

/**
 * 특정 경로용 CORS 설정
 */
const apiCorsOptions = {
  ...corsOptions,
  // API 전용 추가 설정
  exposedHeaders: [
    ...corsOptions.exposedHeaders,
    'X-API-Version',
    'X-Request-ID',
  ],
}

/**
 * 파일 업로드용 CORS 설정
 */
const uploadCorsOptions = {
  ...corsOptions,
  // 파일 업로드를 위한 추가 헤더
  allowedHeaders: [
    ...corsOptions.allowedHeaders,
    'X-File-Name',
    'X-File-Size',
    'X-File-Type',
  ],
}

module.exports = {
  corsOptions,
  developmentCorsOptions,
  productionCorsOptions,
  getCorsOptions,
  apiCorsOptions,
  uploadCorsOptions,
}
