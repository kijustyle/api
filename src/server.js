const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
require('dotenv').config()

const { connectDB } = require('./config/database')
const { getCorsOptions } = require('./config/cors')
const { generalLimiter } = require('./middleware/rateLimiter')
const { validateInput } = require('./middleware/validation')

// 로깅 및 모니터링 시스템
const {
  getRequestLogger,
  apiResponseLogger,
} = require('./middleware/requestLogger')
const { performanceMonitor } = require('./middleware/performanceMonitor')
const { logInfo, logError, logSystemInfo } = require('./utils/errorLogger')

const app = express()
const PORT = process.env.PORT || 8000

// 시스템 시작 로그
logSystemInfo('서버 시작 중...', {
  port: PORT,
  nodeVersion: process.version,
  environment: process.env.NODE_ENV,
})

// 데이터베이스 연결
connectDB()

// 보안 미들웨어들
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    crossOriginEmbedderPolicy: false, // 개발 중에는 비활성화
  })
) // 보안 헤더 설정

// 로깅 미들웨어들 (가장 먼저 적용)
const requestLoggers = getRequestLogger()
requestLoggers.forEach((logger) => app.use(logger))

// 성능 모니터링 미들웨어
app.use(performanceMonitor)

// API 응답 로깅
app.use(apiResponseLogger)

// CORS 설정 (환경별로 다른 설정 적용)
app.use(cors(getCorsOptions()))

// Rate Limiting 적용
app.use('/api/', generalLimiter)

// JSON 파싱
app.use(
  express.json({
    limit: '10mb',
    verify: (req, res, buf) => {
      req.rawBody = buf
    },
  })
)
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// 입력 데이터 검증 및 정리
app.use('/api/', validateInput)

// 신뢰할 수 있는 프록시 설정 (nginx, cloudflare 등 사용시)
app.set('trust proxy', 1)

// 라우트들
app.use('/health', require('./routes/health'))

app.use('/api/v1/auth', require('./routes/v1/auth'))
// 기본 라우트
app.get('/', (req, res) => {
  logInfo('루트 엔드포인트 접근', req)
  res.json({
    message: '🚀 백엔드 서버가 성공적으로 실행중입니다!',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    environment: process.env.NODE_ENV,
  })
})

// 라우트들 (추후 추가 예정)
// app.use('/api/auth', require('./routes/auth'));
// app.use('/api/users', require('./routes/users'));

// API 응답 포맷터 (API 경로에만 적용)
app.use('/api/', (req, res, next) => {
  // 성공 응답 헬퍼 추가
  res.success = (
    data,
    message = '요청이 성공적으로 처리되었습니다.',
    statusCode = 200
  ) => {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
    })
  }
  next()
})

// 라우트들
app.use('/api/v1/auth', require('./routes/v1/auth'))

// 404 에러 핸들링
app.use('*', (req, res) => {
  logInfo('404 - 경로를 찾을 수 없음', req, {
    requestedPath: req.originalUrl,
    method: req.method,
  })

  res.status(404).json({
    success: false,
    message: '요청하신 경로를 찾을 수 없습니다.',
    error: 'NOT_FOUND',
    requestedPath: req.originalUrl,
  })
})

// 글로벌 에러 핸들링
app.use((err, req, res, next) => {
  // 에러 로깅
  logError('서버 에러 발생', err, req, {
    url: req.originalUrl,
    method: req.method,
    userAgent: req.get('user-agent'),
    body: req.body,
  })

  // 클라이언트 응답
  const isDevelopment = process.env.NODE_ENV === 'development'
  res.status(err.statusCode || 500).json({
    success: false,
    message: isDevelopment ? err.message : '서버 내부 오류가 발생했습니다.',
    error: err.name || 'INTERNAL_SERVER_ERROR',
    ...(isDevelopment && { stack: err.stack }),
    requestId: req.requestId,
    timestamp: new Date().toISOString(),
  })
})

// 서버 시작 (포트 충돌 처리 포함)
const server = app.listen(PORT, () => {
  const startupMessage = `🌟 서버가 포트 ${PORT}에서 실행중입니다.`
  console.log(startupMessage)
  console.log(`🔗 서버 주소: http://localhost:${PORT}`)
  console.log(`📊 Health Check: http://localhost:${PORT}/health`)
  console.log(`📈 Performance: http://localhost:${PORT}/health/performance`)

  logSystemInfo('서버 시작 완료', {
    port: PORT,
    url: `http://localhost:${PORT}`,
    healthCheck: `http://localhost:${PORT}/health`,
  })
})

// 포트 충돌 에러 처리
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const errorMessage = `❌ 포트 ${PORT}이 이미 사용중입니다.`
    console.log(errorMessage)
    console.log('💡 해결방법:')
    console.log('1. 다른 프로세스 종료: lsof -ti:' + PORT + ' | xargs kill -9')
    console.log('2. 또는 .env 파일에서 PORT 번호 변경')

    logError('서버 시작 실패 - 포트 충돌', err, null, { port: PORT })
    process.exit(1)
  } else {
    console.error('❌ 서버 시작 오류:', err)
    logError('서버 시작 실패', err)
    process.exit(1)
  }
})

// Graceful shutdown 처리
process.on('SIGTERM', () => {
  logSystemInfo('SIGTERM 신호 수신 - Graceful shutdown 시작')
  server.close(() => {
    logSystemInfo('서버가 정상적으로 종료되었습니다.')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  logSystemInfo('SIGINT 신호 수신 (Ctrl+C) - 서버 종료')
  server.close(() => {
    logSystemInfo('서버가 정상적으로 종료되었습니다.')
    process.exit(0)
  })
})

// Unhandled Promise Rejection 처리
process.on('unhandledRejection', (reason, promise) => {
  logError('처리되지 않은 Promise 거부', reason, null, {
    promise: promise.toString(),
  })
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

// Uncaught Exception 처리
process.on('uncaughtException', (error) => {
  logError('처리되지 않은 예외', error)
  console.error('Uncaught Exception:', error)
  process.exit(1)
})

module.exports = app
