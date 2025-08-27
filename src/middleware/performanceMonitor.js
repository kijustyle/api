const fs = require('fs')
const path = require('path')
const { logWarn, logInfo } = require('../utils/errorLogger')

/**
 * 성능 모니터링 시스템
 */

// 성능 데이터 저장소 (메모리 기반)
let performanceStats = {
  requests: [],
  endpoints: {},
  systemMetrics: {
    totalRequests: 0,
    avgResponseTime: 0,
    slowRequests: 0,
    errorRequests: 0,
  },
}

// 설정값들
const SLOW_REQUEST_THRESHOLD = 1000 // 1초 이상이면 느린 요청
const STATS_CLEANUP_INTERVAL = 60 * 60 * 1000 // 1시간마다 정리
const MAX_STORED_REQUESTS = 1000 // 최대 저장할 요청 수

/**
 * 요청 성능 측정 미들웨어
 */
const performanceMonitor = (req, res, next) => {
  const startTime = Date.now()
  const startHrTime = process.hrtime()

  // 메모리 사용량 측정
  const startMemory = process.memoryUsage()

  // 응답이 완료되었을 때 실행
  res.on('finish', () => {
    const endTime = Date.now()
    const duration = endTime - startTime
    const hrDuration = process.hrtime(startHrTime)
    const precisionDuration = hrDuration[0] * 1000 + hrDuration[1] / 1000000

    const endMemory = process.memoryUsage()
    const memoryDelta = {
      rss: endMemory.rss - startMemory.rss,
      heapUsed: endMemory.heapUsed - startMemory.heapUsed,
      heapTotal: endMemory.heapTotal - startMemory.heapTotal,
    }

    // 성능 데이터 생성
    const performanceData = {
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      duration: Math.round(precisionDuration * 100) / 100, // 소수점 2자리
      userAgent: req.get('user-agent'),
      ip: req.ip,
      userId: req.user?.id || null,
      contentLength: res.get('content-length') || 0,
      memoryDelta,
      query: Object.keys(req.query).length > 0 ? req.query : null,
      params: Object.keys(req.params).length > 0 ? req.params : null,
    }

    // 통계 업데이트
    updatePerformanceStats(performanceData)

    // 느린 요청 경고
    if (duration > SLOW_REQUEST_THRESHOLD) {
      logWarn(`느린 요청 감지: ${duration}ms`, req, {
        duration,
        threshold: SLOW_REQUEST_THRESHOLD,
        endpoint: `${req.method} ${req.originalUrl || req.url}`,
        performanceType: 'SLOW_REQUEST',
      })
    }

    // 개발 환경에서 성능 정보 출력
    if (
      process.env.NODE_ENV === 'development' &&
      process.env.ENABLE_CONSOLE_LOGS !== 'false'
    ) {
      const emoji =
        duration > SLOW_REQUEST_THRESHOLD ? '🐌' : duration > 500 ? '⚠️' : '⚡'

      // 긴 응답 데이터는 요약해서 출력
      let logMessage = `${emoji} ${req.method} ${
        req.originalUrl || req.url
      } - ${res.statusCode} - ${duration}ms`

      // 메모리 사용량 추가
      if (memoryDelta.heapUsed !== 0) {
        logMessage += ` - Memory: ${Math.round(memoryDelta.heapUsed / 1024)}KB`
      }

      console.log(logMessage)
    }

    // 성능 로그 파일에 기록
    logPerformanceData(performanceData)
  })

  next()
}

/**
 * 성능 통계 업데이트
 */
const updatePerformanceStats = (data) => {
  const endpoint = `${data.method} ${data.url}`

  // 전체 통계 업데이트
  performanceStats.systemMetrics.totalRequests++

  if (data.statusCode >= 400) {
    performanceStats.systemMetrics.errorRequests++
  }

  if (data.duration > SLOW_REQUEST_THRESHOLD) {
    performanceStats.systemMetrics.slowRequests++
  }

  // 평균 응답시간 계산
  const currentAvg = performanceStats.systemMetrics.avgResponseTime
  const totalReqs = performanceStats.systemMetrics.totalRequests
  performanceStats.systemMetrics.avgResponseTime =
    Math.round(
      ((currentAvg * (totalReqs - 1) + data.duration) / totalReqs) * 100
    ) / 100

  // 엔드포인트별 통계
  if (!performanceStats.endpoints[endpoint]) {
    performanceStats.endpoints[endpoint] = {
      count: 0,
      totalDuration: 0,
      avgDuration: 0,
      minDuration: data.duration,
      maxDuration: data.duration,
      errorCount: 0,
      slowCount: 0,
    }
  }

  const endpointStats = performanceStats.endpoints[endpoint]
  endpointStats.count++
  endpointStats.totalDuration += data.duration
  endpointStats.avgDuration =
    Math.round((endpointStats.totalDuration / endpointStats.count) * 100) / 100
  endpointStats.minDuration = Math.min(endpointStats.minDuration, data.duration)
  endpointStats.maxDuration = Math.max(endpointStats.maxDuration, data.duration)

  if (data.statusCode >= 400) {
    endpointStats.errorCount++
  }

  if (data.duration > SLOW_REQUEST_THRESHOLD) {
    endpointStats.slowCount++
  }

  // 최근 요청 목록 유지 (최대 1000개)
  performanceStats.requests.push(data)
  if (performanceStats.requests.length > MAX_STORED_REQUESTS) {
    performanceStats.requests = performanceStats.requests.slice(
      -MAX_STORED_REQUESTS
    )
  }
}

/**
 * 성능 데이터 파일 로깅
 */
const logPerformanceData = (data) => {
  const logDir = path.join(__dirname, '../../logs')
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }

  const today = new Date().toISOString().split('T')[0]
  const logFile = path.join(logDir, `performance-${today}.log`)

  fs.appendFile(logFile, JSON.stringify(data) + '\n', (err) => {
    if (err) {
      console.error('성능 로그 쓰기 실패:', err)
    }
  })
}

/**
 * 성능 통계 조회
 */
const getPerformanceStats = () => {
  return {
    ...performanceStats,
    systemMetrics: {
      ...performanceStats.systemMetrics,
      uptime: Math.round(process.uptime()),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
    },
  }
}

/**
 * 느린 엔드포인트 조회
 */
const getSlowEndpoints = (limit = 10) => {
  return Object.entries(performanceStats.endpoints)
    .map(([endpoint, stats]) => ({ endpoint, ...stats }))
    .sort((a, b) => b.avgDuration - a.avgDuration)
    .slice(0, limit)
}

/**
 * 에러가 많은 엔드포인트 조회
 */
const getErrorProneEndpoints = (limit = 10) => {
  return Object.entries(performanceStats.endpoints)
    .map(([endpoint, stats]) => ({
      endpoint,
      ...stats,
      errorRate:
        stats.count > 0
          ? Math.round((stats.errorCount / stats.count) * 100 * 100) / 100
          : 0,
    }))
    .filter((stats) => stats.errorCount > 0)
    .sort((a, b) => b.errorRate - a.errorRate)
    .slice(0, limit)
}

/**
 * 성능 리포트 생성
 */
const generatePerformanceReport = () => {
  const stats = getPerformanceStats()

  return {
    summary: {
      totalRequests: stats.systemMetrics.totalRequests,
      avgResponseTime: stats.systemMetrics.avgResponseTime,
      slowRequestRate:
        stats.systemMetrics.totalRequests > 0
          ? Math.round(
              (stats.systemMetrics.slowRequests /
                stats.systemMetrics.totalRequests) *
                100 *
                100
            ) / 100
          : 0,
      errorRequestRate:
        stats.systemMetrics.totalRequests > 0
          ? Math.round(
              (stats.systemMetrics.errorRequests /
                stats.systemMetrics.totalRequests) *
                100 *
                100
            ) / 100
          : 0,
      uptime: stats.systemMetrics.uptime,
      memoryUsage: stats.systemMetrics.memoryUsage,
    },
    slowEndpoints: getSlowEndpoints(5),
    errorProneEndpoints: getErrorProneEndpoints(5),
    recentRequests: stats.requests.slice(-10),
  }
}

/**
 * 주기적으로 통계 정리
 */
setInterval(() => {
  const cutoffTime = Date.now() - 24 * 60 * 60 * 1000 // 24시간 전

  performanceStats.requests = performanceStats.requests.filter(
    (req) => new Date(req.timestamp).getTime() > cutoffTime
  )

  logInfo('성능 통계 정리 완료', null, {
    remainingRequests: performanceStats.requests.length,
    performanceType: 'CLEANUP',
  })
}, STATS_CLEANUP_INTERVAL)

module.exports = {
  performanceMonitor,
  getPerformanceStats,
  getSlowEndpoints,
  getErrorProneEndpoints,
  generatePerformanceReport,
}
