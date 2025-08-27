const express = require('express')
const { sequelize } = require('../config/database')
const {
  generatePerformanceReport,
} = require('../middleware/performanceMonitor')
const { logInfo, logError } = require('../utils/errorLogger')

const router = express.Router()

/**
 * 기본 헬스체크 엔드포인트
 */
router.get('/', async (req, res) => {
  try {
    const healthData = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version,
    }

    res.status(200).json({
      success: true,
      message: '서버가 정상적으로 작동중입니다.',
      data: healthData,
    })
  } catch (error) {
    logError('Health check 실패', error, req)
    res.status(500).json({
      success: false,
      message: '서버 상태 확인 중 오류가 발생했습니다.',
      error: 'HEALTH_CHECK_FAILED',
    })
  }
})

/**
 * 상세 헬스체크 (데이터베이스 연결 포함)
 */
router.get('/detailed', async (req, res) => {
  const startTime = Date.now()
  const healthChecks = {
    server: { status: 'OK', responseTime: 0 },
    database: { status: 'CHECKING', responseTime: 0, error: null },
    memory: { status: 'OK', usage: null },
    disk: { status: 'OK', usage: null },
  }

  try {
    // 메모리 사용량 확인
    const memoryUsage = process.memoryUsage()
    const memoryUsageMB = {
      rss: Math.round(memoryUsage.rss / 1024 / 1024),
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      external: Math.round(memoryUsage.external / 1024 / 1024),
    }

    // 메모리 사용률이 80% 이상이면 경고
    const heapUsagePercent =
      (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100
    healthChecks.memory.usage = memoryUsageMB
    healthChecks.memory.usagePercent = Math.round(heapUsagePercent)
    healthChecks.memory.status = heapUsagePercent > 80 ? 'WARNING' : 'OK'

    // 데이터베이스 연결 확인
    try {
      const dbStartTime = Date.now()
      await sequelize.authenticate()
      healthChecks.database.responseTime = Date.now() - dbStartTime
      healthChecks.database.status = 'OK'
    } catch (dbError) {
      healthChecks.database.status = 'ERROR'
      healthChecks.database.error = dbError.message
      healthChecks.database.responseTime = Date.now() - startTime
    }

    // 전체 응답 시간
    const totalResponseTime = Date.now() - startTime
    healthChecks.server.responseTime = totalResponseTime

    // 전체 상태 결정
    const hasErrors = Object.values(healthChecks).some(
      (check) => check.status === 'ERROR'
    )
    const hasWarnings = Object.values(healthChecks).some(
      (check) => check.status === 'WARNING'
    )

    let overallStatus = 'OK'
    let httpStatus = 200

    if (hasErrors) {
      overallStatus = 'ERROR'
      httpStatus = 503 // Service Unavailable
    } else if (hasWarnings) {
      overallStatus = 'WARNING'
      httpStatus = 200
    }

    const detailedHealth = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      responseTime: totalResponseTime,
      uptime: Math.round(process.uptime()),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version,
      checks: healthChecks,
    }

    // 상태 로깅
    if (hasErrors) {
      logError(
        'Health check failed',
        new Error('One or more health checks failed'),
        req,
        detailedHealth
      )
    } else if (hasWarnings) {
      logInfo('Health check warning', req, detailedHealth)
    }

    res.status(httpStatus).json({
      success: !hasErrors,
      message: hasErrors
        ? '일부 시스템에 문제가 있습니다.'
        : hasWarnings
        ? '시스템에 경고사항이 있습니다.'
        : '모든 시스템이 정상입니다.',
      data: detailedHealth,
    })
  } catch (error) {
    logError('Detailed health check 실패', error, req)
    res.status(500).json({
      success: false,
      message: '상세 헬스체크 중 오류가 발생했습니다.',
      error: 'DETAILED_HEALTH_CHECK_FAILED',
      data: {
        status: 'ERROR',
        timestamp: new Date().toISOString(),
        checks: healthChecks,
      },
    })
  }
})

/**
 * 성능 리포트 엔드포인트
 */
router.get('/performance', (req, res) => {
  try {
    const performanceReport = generatePerformanceReport()

    res.json({
      success: true,
      message: '성능 리포트를 성공적으로 조회했습니다.',
      data: performanceReport,
    })
  } catch (error) {
    logError('성능 리포트 조회 실패', error, req)
    res.status(500).json({
      success: false,
      message: '성능 리포트 조회 중 오류가 발생했습니다.',
      error: 'PERFORMANCE_REPORT_FAILED',
    })
  }
})

/**
 * 시스템 정보 엔드포인트
 */
router.get('/system', (req, res) => {
  try {
    const systemInfo = {
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
        uptime: Math.round(process.uptime()),
        pid: process.pid,
      },
      memory: {
        ...process.memoryUsage(),
        totalSystem: require('os').totalmem(),
        freeSystem: require('os').freemem(),
      },
      cpu: {
        usage: process.cpuUsage(),
        cores: require('os').cpus().length,
        loadAvg: require('os').loadavg(),
      },
      environment: {
        nodeEnv: process.env.NODE_ENV,
        port: process.env.PORT,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    }

    res.json({
      success: true,
      message: '시스템 정보를 성공적으로 조회했습니다.',
      data: systemInfo,
    })
  } catch (error) {
    logError('시스템 정보 조회 실패', error, req)
    res.status(500).json({
      success: false,
      message: '시스템 정보 조회 중 오류가 발생했습니다.',
      error: 'SYSTEM_INFO_FAILED',
    })
  }
})

/**
 * 데이터베이스 상태 확인
 */
router.get('/database', async (req, res) => {
  try {
    const startTime = Date.now()

    // 기본 연결 테스트
    await sequelize.authenticate()

    // 간단한 쿼리 실행
    const [results] = await sequelize.query(
      'SELECT 1 as test, NOW() as current_time'
    )

    const responseTime = Date.now() - startTime

    const dbStatus = {
      status: 'OK',
      responseTime,
      connection: 'active',
      dialect: sequelize.getDialect(),
      version: sequelize.getDatabaseVersion
        ? await sequelize.getDatabaseVersion()
        : 'unknown',
      testQuery: results[0],
      poolInfo: {
        max: sequelize.config.pool?.max || 'unknown',
        min: sequelize.config.pool?.min || 'unknown',
        idle: sequelize.config.pool?.idle || 'unknown',
        acquire: sequelize.config.pool?.acquire || 'unknown',
      },
    }

    res.json({
      success: true,
      message: '데이터베이스가 정상적으로 작동중입니다.',
      data: dbStatus,
    })
  } catch (error) {
    logError('데이터베이스 상태 확인 실패', error, req)
    res.status(503).json({
      success: false,
      message: '데이터베이스 연결에 문제가 있습니다.',
      error: 'DATABASE_CONNECTION_FAILED',
      data: {
        status: 'ERROR',
        error: error.message,
        responseTime: Date.now() - (req.startTime || Date.now()),
      },
    })
  }
})

/**
 * 로그 상태 확인
 */
router.get('/logs', (req, res) => {
  try {
    const fs = require('fs')
    const path = require('path')
    const logDir = path.join(__dirname, '../../logs')

    let logStatus = {
      directory: logDir,
      exists: fs.existsSync(logDir),
      files: [],
    }

    if (logStatus.exists) {
      const files = fs.readdirSync(logDir)
      logStatus.files = files.map((file) => {
        const filePath = path.join(logDir, file)
        const stats = fs.statSync(filePath)
        return {
          name: file,
          size: Math.round(stats.size / 1024) + ' KB',
          modified: stats.mtime.toISOString(),
          type: path.extname(file),
        }
      })
    }

    res.json({
      success: true,
      message: '로그 상태를 성공적으로 조회했습니다.',
      data: logStatus,
    })
  } catch (error) {
    logError('로그 상태 확인 실패', error, req)
    res.status(500).json({
      success: false,
      message: '로그 상태 확인 중 오류가 발생했습니다.',
      error: 'LOG_STATUS_FAILED',
    })
  }
})

/**
 * 살아있음을 확인하는 간단한 엔드포인트 (로드밸런서용)
 */
router.get('/ping', (req, res) => {
  res.status(200).send('pong')
})

/**
 * 준비상태 확인 (Kubernetes readiness probe용)
 */
router.get('/ready', async (req, res) => {
  try {
    // 데이터베이스 연결만 간단히 확인
    await sequelize.authenticate()
    res.status(200).send('ready')
  } catch (error) {
    res.status(503).send('not ready')
  }
})

module.exports = router
