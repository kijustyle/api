const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
require('dotenv').config()

const { connectDB } = require('./config/database')
const { getCorsOptions } = require('./config/cors')
const { generalLimiter } = require('./middleware/rateLimiter')
const { validateInput } = require('./middleware/validation')

const app = express()
const PORT = process.env.PORT || 5000

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

app.use(morgan('combined')) // 로깅

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

// 기본 라우트
app.get('/', (req, res) => {
  res.json({
    message: '🚀 백엔드 서버가 성공적으로 실행중입니다!',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  })
})

// Health check 엔드포인트
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
})

// 라우트들 (추후 추가 예정)
// app.use('/api/auth', require('./routes/auth'));
// app.use('/api/users', require('./routes/users'));

// 404 에러 핸들링
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: '요청하신 경로를 찾을 수 없습니다.',
  })
})

// 글로벌 에러 핸들링
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({
    success: false,
    message:
      process.env.NODE_ENV === 'production'
        ? '서버 내부 오류가 발생했습니다.'
        : err.message,
  })
})

// 서버 시작 (포트 충돌 처리 포함)
const server = app.listen(PORT, () => {
  console.log(`🌟 서버가 포트 ${PORT}에서 실행중입니다.`)
  console.log(`🔗 서버 주소: http://localhost:${PORT}`)
})

// 포트 충돌 에러 처리
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`❌ 포트 ${PORT}이 이미 사용중입니다.`)
    console.log('💡 해결방법:')
    console.log('1. 다른 프로세스 종료: lsof -ti:' + PORT + ' | xargs kill -9')
    console.log('2. 또는 .env 파일에서 PORT 번호 변경')
    process.exit(1)
  } else {
    console.error('❌ 서버 시작 오류:', err)
    process.exit(1)
  }
})

module.exports = app
