const { logWarn } = require('../utils/errorLogger')

/**
 * 요청 시간 제한 미들웨어
 */

// 기본 타임아웃 설정 (밀리초)
const DEFAULT_TIMEOUT = 30000 // 30초
const UPLOAD_TIMEOUT = 300000 // 5분 (파일 업로드용)
const LONG_RUNNING_TIMEOUT = 60000 // 1분 (복잡한 작업용)

/**
 * 기본 요청 타임아웃 미들웨어
 */
const requestTimeout = (timeout = DEFAULT_TIMEOUT, message = null) => {
  return (req, res, next) => {
    // 이미 응답이 완료된 경우 타이머 설정하지 않음
    if (res.headersSent) {
      return next()
    }

    const timeoutId = setTimeout(() => {
      if (!res.headersSent) {
        // 타임아웃 로그 기록
        logWarn('요청 시간 초과', req, {
          timeout,
          url: req.originalUrl,
          method: req.method,
          userAgent: req.get('user-agent'),
        })

        const errorMessage =
          message || `요청 처리 시간이 ${timeout / 1000}초를 초과했습니다.`

        res.status(408).json({
          success: false,
          message: errorMessage,
          errorCode: 'REQUEST_TIMEOUT',
          timeout: timeout / 1000,
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        })
      }
    }, timeout)

    // 응답이 완료되면 타이머 제거
    res.on('finish', () => {
      clearTimeout(timeoutId)
    })

    // 연결이 끊어지면 타이머 제거
    req.on('close', () => {
      clearTimeout(timeoutId)
    })

    // 에러 발생시에도 타이머 제거
    res.on('error', () => {
      clearTimeout(timeoutId)
    })

    next()
  }
}

/**
 * 경로별 타임아웃 설정
 */
const pathBasedTimeout = (config) => {
  return (req, res, next) => {
    const path = req.path
    let timeout = DEFAULT_TIMEOUT
    let message = null

    // 경로 패턴 매칭
    for (const rule of config) {
      if (matchesPattern(path, rule.pattern)) {
        timeout = rule.timeout
        message = rule.message
        break
      }
    }

    // 동적 타임아웃 미들웨어 적용
    requestTimeout(timeout, message)(req, res, next)
  }
}

/**
 * 패턴 매칭 함수
 */
const matchesPattern = (path, pattern) => {
  if (typeof pattern === 'string') {
    return path.includes(pattern)
  } else if (pattern instanceof RegExp) {
    return pattern.test(path)
  }
  return false
}

/**
 * HTTP 메서드별 타임아웃 설정
 */
const methodBasedTimeout = (config) => {
  return (req, res, next) => {
    const method = req.method.toUpperCase()
    const methodConfig = config[method] || config.default

    if (methodConfig) {
      requestTimeout(methodConfig.timeout, methodConfig.message)(req, res, next)
    } else {
      requestTimeout()(req, res, next)
    }
  }
}

/**
 * 조건부 타임아웃 (파일 크기, 사용자 권한 등에 따라)
 */
const conditionalTimeout = (conditions) => {
  return (req, res, next) => {
    let timeout = DEFAULT_TIMEOUT
    let message = null

    // 조건들을 순서대로 확인
    for (const condition of conditions) {
      if (condition.check(req)) {
        timeout = condition.timeout
        message = condition.message
        break
      }
    }

    requestTimeout(timeout, message)(req, res, next)
  }
}

/**
 * 파일 업로드 타임아웃
 */
const uploadTimeout = (maxSize = 10 * 1024 * 1024) => {
  // 기본 10MB
  return conditionalTimeout([
    {
      check: (req) => {
        const contentLength = parseInt(req.get('content-length') || '0')
        return contentLength > maxSize
      },
      timeout: UPLOAD_TIMEOUT * 2, // 큰 파일은 더 긴 시간
      message: '대용량 파일 업로드로 인해 처리 시간이 길어질 수 있습니다.',
    },
    {
      check: (req) => {
        const contentType = req.get('content-type') || ''
        return contentType.includes('multipart/form-data')
      },
      timeout: UPLOAD_TIMEOUT,
      message: '파일 업로드 처리 중입니다. 잠시만 기다려주세요.',
    },
  ])
}

/**
 * 사용자 등급별 타임아웃
 */
const userBasedTimeout = (config) => {
  return (req, res, next) => {
    const userRole = req.user?.role || 'guest'
    const userConfig = config[userRole] || config.default

    const timeout = userConfig?.timeout || DEFAULT_TIMEOUT
    const message = userConfig?.message

    requestTimeout(timeout, message)(req, res, next)
  }
}

/**
 * 글로벌 타임아웃 설정
 */
const globalTimeout = () => {
  return pathBasedTimeout([
    // 파일 업로드 관련
    {
      pattern: /\/upload/i,
      timeout: UPLOAD_TIMEOUT,
      message: '파일 업로드 처리 중입니다.',
    },
    // 리포트 생성
    {
      pattern: /\/reports?/i,
      timeout: LONG_RUNNING_TIMEOUT,
      message: '리포트 생성 중입니다.',
    },
    // 데이터 내보내기
    {
      pattern: /\/export/i,
      timeout: LONG_RUNNING_TIMEOUT,
      message: '데이터 내보내기 중입니다.',
    },
    // 검색 기능
    {
      pattern: /\/search/i,
      timeout: 15000, // 15초
      message: '검색 처리 중입니다.',
    },
    // 인증 관련 (빠른 응답 필요)
    {
      pattern: /\/auth/i,
      timeout: 10000, // 10초
      message: '인증 처리 중입니다.',
    },
    // Health check (매우 빠른 응답)
    {
      pattern: /\/health/i,
      timeout: 5000, // 5초
      message: 'Health check 처리 중입니다.',
    },
  ])
}

/**
 * 타임아웃 상태 모니터링
 */
const timeoutMonitor = () => {
  const stats = {
    totalRequests: 0,
    timeoutRequests: 0,
    averageResponseTime: 0,
    slowestRequest: 0,
  }

  return (req, res, next) => {
    const startTime = Date.now()
    stats.totalRequests++

    // 응답 완료 시 통계 업데이트
    res.on('finish', () => {
      const responseTime = Date.now() - startTime

      // 평균 응답시간 계산
      stats.averageResponseTime = Math.round(
        (stats.averageResponseTime * (stats.totalRequests - 1) + responseTime) /
          stats.totalRequests
      )

      // 가장 느린 요청 시간 업데이트
      if (responseTime > stats.slowestRequest) {
        stats.slowestRequest = responseTime
      }

      // 타임아웃으로 처리된 경우 카운트
      if (res.statusCode === 408) {
        stats.timeoutRequests++
      }
    })

    // 통계 정보를 req에 추가
    req.timeoutStats = stats

    next()
  }
}

/**
 * 타임아웃 통계 조회
 */
const getTimeoutStats = () => {
  return (req, res) => {
    const stats = req.timeoutStats || {
      totalRequests: 0,
      timeoutRequests: 0,
      averageResponseTime: 0,
      slowestRequest: 0,
    }

    const timeoutRate =
      stats.totalRequests > 0
        ? Math.round(
            (stats.timeoutRequests / stats.totalRequests) * 100 * 100
          ) / 100
        : 0

    res.json({
      success: true,
      message: '타임아웃 통계를 조회했습니다.',
      data: {
        ...stats,
        timeoutRate: `${timeoutRate}%`,
        timestamp: new Date().toISOString(),
      },
    })
  }
}

/**
 * 타임아웃 설정 정보 조회
 */
const getTimeoutConfig = () => {
  return (req, res) => {
    const config = {
      defaultTimeout: DEFAULT_TIMEOUT / 1000,
      uploadTimeout: UPLOAD_TIMEOUT / 1000,
      longRunningTimeout: LONG_RUNNING_TIMEOUT / 1000,
      timeouts: {
        'Health Check': 5,
        Authentication: 10,
        Search: 15,
        'Default API': 30,
        'Long Running': 60,
        'File Upload': 300,
      },
    }

    res.json({
      success: true,
      message: '타임아웃 설정을 조회했습니다.',
      data: config,
    })
  }
}

/**
 * 사전 정의된 타임아웃 설정들
 */
const presetTimeouts = {
  // 빠른 응답이 필요한 API
  fast: requestTimeout(5000, '빠른 응답이 필요한 요청입니다.'),

  // 일반적인 API
  normal: requestTimeout(DEFAULT_TIMEOUT),

  // 긴 처리가 필요한 API
  slow: requestTimeout(
    LONG_RUNNING_TIMEOUT,
    '처리 시간이 오래 걸릴 수 있습니다.'
  ),

  // 파일 업로드
  upload: requestTimeout(UPLOAD_TIMEOUT, '파일 업로드 처리 중입니다.'),

  // 글로벌 설정
  global: globalTimeout(),
}

module.exports = {
  requestTimeout,
  pathBasedTimeout,
  methodBasedTimeout,
  conditionalTimeout,
  uploadTimeout,
  userBasedTimeout,
  globalTimeout,
  timeoutMonitor,
  getTimeoutStats,
  getTimeoutConfig,
  presetTimeouts,
  DEFAULT_TIMEOUT,
  UPLOAD_TIMEOUT,
  LONG_RUNNING_TIMEOUT,
}
