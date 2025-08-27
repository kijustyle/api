const morgan = require('morgan')
const fs = require('fs')
const path = require('path')

/**
 * 고급 요청 로깅 시스템
 */

// 로그 디렉토리 생성
const logDir = path.join(__dirname, '../../logs')
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true })
}

// 날짜별 로그 파일 생성
const getLogFileName = (type) => {
  const today = new Date().toISOString().split('T')[0]
  return path.join(logDir, `${type}-${today}.log`)
}

// 커스텀 토큰 정의
morgan.token('id', (req) => req.requestId || 'unknown')
morgan.token('user', (req) =>
  req.user ? req.user.id || req.user.email : 'anonymous'
)
morgan.token('body', (req) => {
  // 민감한 정보는 마스킹
  if (req.body) {
    const safeBody = { ...req.body }
    if (safeBody.password) safeBody.password = '***'
    if (safeBody.token) safeBody.token = '***'
    return JSON.stringify(safeBody)
  }
  return ''
})
morgan.token('query', (req) => JSON.stringify(req.query))
morgan.token('real-ip', (req) => {
  return (
    req.headers['x-forwarded-for'] ||
    req.headers['x-real-ip'] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
    req.ip
  )
})

// 파일 스트림 생성
const accessLogStream = fs.createWriteStream(getLogFileName('access'), {
  flags: 'a',
})
const errorLogStream = fs.createWriteStream(getLogFileName('error'), {
  flags: 'a',
})

/**
 * 요청 ID 생성 미들웨어
 */
const generateRequestId = (req, res, next) => {
  req.requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  res.set('X-Request-ID', req.requestId)
  next()
}

/**
 * 환경별 로깅 미들웨어 설정
 */
const getRequestLogger = () => {
  const loggers = [generateRequestId]

  if (process.env.NODE_ENV === 'production') {
    // 운영 환경: 파일로만 로깅
    loggers.push(
      morgan('combined', { stream: accessLogStream }),
      morgan('combined', {
        stream: errorLogStream,
        skip: (req, res) => res.statusCode < 400,
      })
    )
  } else {
    // 개발 환경: 콘솔 + 파일 로깅
    loggers.push(
      morgan('dev'), // 개발환경용 간단한 로깅
      morgan('combined', { stream: accessLogStream }),
      morgan('combined', {
        stream: errorLogStream,
        skip: (req, res) => res.statusCode < 400,
      })
    )
  }

  return loggers
}

/**
 * 특정 경로 제외 로깅
 */
const createSkipLogger = (skipPaths = []) => {
  return morgan('combined', {
    skip: (req) => skipPaths.includes(req.path),
    stream: accessLogStream,
  })
}

/**
 * API 응답 로깅 (성공/실패 구분)
 */
const apiResponseLogger = (req, res, next) => {
  const originalSend = res.send

  res.send = function (data) {
    // 응답 데이터 로깅 (민감한 정보 제외)
    let responseData = data
    try {
      const parsed = JSON.parse(data)
      if (parsed.token) parsed.token = '***'
      if (parsed.password) parsed.password = '***'
      responseData = JSON.stringify(parsed)
    } catch (e) {
      // JSON이 아닌 경우 그대로 유지
    }

    // 상세 응답 로그 (개발 환경에서만)
    if (
      process.env.NODE_ENV === 'development' &&
      process.env.ENABLE_CONSOLE_LOGS !== 'false'
    ) {
      // 너무 긴 응답은 요약해서 출력
      const summarizedData =
        responseData?.length > 100
          ? responseData.substring(0, 100) + '...'
          : responseData

      console.log(
        `📤 Response [${req.requestId}]: ${res.statusCode} - ${
          summarizedData ? summarizedData.length : 0
        } chars`
      )
    }

    return originalSend.call(this, data)
  }

  next()
}

module.exports = {
  getRequestLogger,
  createSkipLogger,
  generateRequestId,
  apiResponseLogger,
  logDir,
}
