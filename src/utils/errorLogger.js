const fs = require('fs')
const path = require('path')

/**
 * 에러 로깅 시스템
 */

// 로그 디렉토리 확인/생성
const logDir = path.join(__dirname, '../../logs')
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true })
}

// 에러 레벨 정의
const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG',
}

// 날짜별 에러 로그 파일
const getErrorLogFileName = (level) => {
  const today = new Date().toISOString().split('T')[0]
  return path.join(logDir, `${level.toLowerCase()}-${today}.log`)
}

/**
 * 구조화된 로그 생성
 */
const createLogEntry = (
  level,
  message,
  error,
  req = null,
  additionalInfo = {}
) => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    requestId: req?.requestId || null,
    userId: req?.user?.id || null,
    ip: req?.ip || null,
    method: req?.method || null,
    url: req?.originalUrl || req?.url || null,
    userAgent: req?.get('user-agent') || null,
    ...additionalInfo,
  }

  // 에러 객체가 있는 경우 스택 트레이스 포함
  if (error) {
    logEntry.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code || null,
      statusCode: error.statusCode || null,
    }
  }

  return logEntry
}

/**
 * 파일에 로그 쓰기
 */
const writeLogToFile = (level, logEntry) => {
  const logFile = getErrorLogFileName(level)
  const logLine = JSON.stringify(logEntry) + '\n'

  fs.appendFile(logFile, logLine, (err) => {
    if (err) {
      console.error('로그 파일 쓰기 실패:', err)
    }
  })
}

/**
 * 콘솔 출력 (개발 환경용)
 */
const logToConsole = (level, logEntry) => {
  const colors = {
    ERROR: '\x1b[31m', // 빨간색
    WARN: '\x1b[33m', // 노란색
    INFO: '\x1b[36m', // 청록색
    DEBUG: '\x1b[35m', // 마젠타색
  }
  const resetColor = '\x1b[0m'

  const timestamp = new Date().toLocaleTimeString()
  const prefix = `${colors[level]}[${level}] ${timestamp}${resetColor}`

  if (level === 'ERROR' && logEntry.error) {
    console.error(`${prefix} ${logEntry.message}`)
    console.error(
      `📍 Request: ${logEntry.method} ${logEntry.url} (${logEntry.requestId})`
    )
    console.error(
      `🔍 User: ${logEntry.userId || 'anonymous'} | IP: ${logEntry.ip}`
    )
    console.error(
      `💥 Error: ${logEntry.error.name} - ${logEntry.error.message}`
    )
    if (process.env.NODE_ENV === 'development') {
      console.error(`📚 Stack:\n${logEntry.error.stack}`)
    }
  } else {
    console.log(`${prefix} ${logEntry.message}`)
    if (logEntry.requestId) {
      console.log(
        `   📍 Request: ${logEntry.method} ${logEntry.url} (${logEntry.requestId})`
      )
    }
  }
}

/**
 * 메인 로깅 함수들
 */
const logError = (message, error, req = null, additionalInfo = {}) => {
  const logEntry = createLogEntry(
    LOG_LEVELS.ERROR,
    message,
    error,
    req,
    additionalInfo
  )

  writeLogToFile(LOG_LEVELS.ERROR, logEntry)
  if (process.env.NODE_ENV === 'development') {
    logToConsole(LOG_LEVELS.ERROR, logEntry)
  }

  return logEntry
}

const logWarn = (message, req = null, additionalInfo = {}) => {
  const logEntry = createLogEntry(
    LOG_LEVELS.WARN,
    message,
    null,
    req,
    additionalInfo
  )

  writeLogToFile(LOG_LEVELS.WARN, logEntry)
  if (process.env.NODE_ENV === 'development') {
    logToConsole(LOG_LEVELS.WARN, logEntry)
  }

  return logEntry
}

const logInfo = (message, req = null, additionalInfo = {}) => {
  const logEntry = createLogEntry(
    LOG_LEVELS.INFO,
    message,
    null,
    req,
    additionalInfo
  )

  writeLogToFile(LOG_LEVELS.INFO, logEntry)
  if (process.env.NODE_ENV === 'development') {
    logToConsole(LOG_LEVELS.INFO, logEntry)
  }

  return logEntry
}

const logDebug = (message, req = null, additionalInfo = {}) => {
  // DEBUG 레벨은 개발 환경에서만
  if (process.env.NODE_ENV === 'development') {
    const logEntry = createLogEntry(
      LOG_LEVELS.DEBUG,
      message,
      null,
      req,
      additionalInfo
    )
    logToConsole(LOG_LEVELS.DEBUG, logEntry)
    return logEntry
  }
}

/**
 * 데이터베이스 에러 로깅
 */
const logDatabaseError = (operation, error, req = null, query = null) => {
  return logError(`데이터베이스 ${operation} 실패`, error, req, {
    operation,
    query: query ? query.substring(0, 200) : null,
    errorType: 'DATABASE_ERROR',
  })
}

/**
 * 인증 에러 로깅
 */
const logAuthError = (type, message, req = null, additionalInfo = {}) => {
  return logWarn(`인증 실패: ${message}`, req, {
    authType: type,
    errorType: 'AUTH_ERROR',
    ...additionalInfo,
  })
}

/**
 * API 에러 로깅
 */
const logApiError = (endpoint, error, req = null) => {
  return logError(`API 에러: ${endpoint}`, error, req, {
    endpoint,
    errorType: 'API_ERROR',
  })
}

/**
 * 시스템 상태 로깅
 */
const logSystemInfo = (message, data = {}) => {
  return logInfo(message, null, {
    ...data,
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime(),
    errorType: 'SYSTEM_INFO',
  })
}

module.exports = {
  logError,
  logWarn,
  logInfo,
  logDebug,
  logDatabaseError,
  logAuthError,
  logApiError,
  logSystemInfo,
  LOG_LEVELS,
}
