const rateLimit = require('express-rate-limit')

/**
 * Rate Limiting 설정
 * API 호출 횟수를 제한하여 서버를 보호합니다.
 */

// 기본 Rate Limiter 생성 함수
const createRateLimiter = (
  windowMs,
  max,
  message,
  skipSuccessfulRequests = false
) => {
  return rateLimit({
    windowMs, // 시간 윈도우 (밀리초)
    max, // 최대 요청 수
    message: {
      success: false,
      message,
      error: 'RATE_LIMIT_EXCEEDED',
    },
    standardHeaders: true, // rate limit 정보를 `RateLimit-*` 헤더에 포함
    legacyHeaders: false, // X-RateLimit-* 헤더 비활성화
    skipSuccessfulRequests, // 성공한 요청은 카운트에서 제외

    // IPv6 지원하는 기본 키 생성기 사용 (커스텀 키 생성기 제거)
    // keyGenerator는 기본값 사용하여 IPv6 문제 해결

    // 요청이 제한될 때 실행되는 핸들러
    handler: (req, res) => {
      console.warn(
        `Rate limit exceeded for ${req.ip} at ${new Date().toISOString()}`
      )

      res.status(429).json({
        success: false,
        message,
        error: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.round(windowMs / 1000), // 초 단위
        limit: max,
        windowMs,
      })
    },

    // 건너뛸 요청들 (예: 성공한 요청, 특정 상태코드)
    skip: (req) => {
      // 개발 환경에서는 localhost 건너뛰기
      if (
        process.env.NODE_ENV === 'development' &&
        (req.ip === '127.0.0.1' || req.ip === '::1')
      ) {
        return true
      }
      return false
    },
  })
}

// 일반 API용 Rate Limiter (15분당 100회)
const generalLimiter = createRateLimiter(
  15 * 60 * 1000, // 15분
  100, // 최대 100회 요청
  '요청이 너무 많습니다. 15분 후에 다시 시도해주세요.'
)

// 로그인 시도 제한 (15분당 5회)
const loginLimiter = createRateLimiter(
  15 * 60 * 1000, // 15분
  5, // 최대 5회 시도
  '로그인 시도 횟수를 초과했습니다. 15분 후에 다시 시도해주세요.',
  true // 성공한 로그인은 카운트에서 제외
)

// 회원가입 제한 (1시간당 3회)
const registerLimiter = createRateLimiter(
  60 * 60 * 1000, // 1시간
  3, // 최대 3회 시도
  '회원가입 시도 횟수를 초과했습니다. 1시간 후에 다시 시도해주세요.'
)

// 비밀번호 재설정 제한 (1시간당 3회)
const passwordResetLimiter = createRateLimiter(
  60 * 60 * 1000, // 1시간
  3, // 최대 3회 시도
  '비밀번호 재설정 요청이 너무 많습니다. 1시간 후에 다시 시도해주세요.'
)

// 엄격한 제한 (1분당 10회) - 민감한 작업용
const strictLimiter = createRateLimiter(
  1 * 60 * 1000, // 1분
  10, // 최대 10회 요청
  '요청이 너무 빈번합니다. 잠시 후 다시 시도해주세요.'
)

module.exports = {
  generalLimiter,
  loginLimiter,
  registerLimiter,
  passwordResetLimiter,
  strictLimiter,
  createRateLimiter,
}
