const { AppError } = require('./errorHandler')

/**
 * API 버전 관리 미들웨어
 */

// 지원하는 API 버전들
const SUPPORTED_VERSIONS = ['v1', 'v2']
const DEFAULT_VERSION = 'v1'
const LATEST_VERSION = 'v2'

// 버전별 지원 상태
const VERSION_STATUS = {
  v1: {
    status: 'deprecated',
    deprecatedSince: '2024-01-01',
    sunsetDate: '2024-12-31',
    message: 'v1 API는 더 이상 권장되지 않습니다. v2로 마이그레이션해주세요.',
  },
  v2: {
    status: 'current',
    message: '현재 지원되는 최신 API 버전입니다.',
  },
}

/**
 * URL 경로에서 API 버전 추출
 * 예: /api/v1/users -> v1
 */
const extractVersionFromPath = (req, res, next) => {
  const pathVersion = req.path.match(/^\/api\/(v\d+)\//)

  if (pathVersion) {
    req.apiVersion = pathVersion[1]
  }

  next()
}

/**
 * 헤더에서 API 버전 추출
 * 예: Accept: application/vnd.api+json;version=1
 *     X-API-Version: v1
 */
const extractVersionFromHeaders = (req, res, next) => {
  // Accept 헤더에서 버전 추출
  const acceptHeader = req.get('Accept')
  if (acceptHeader && acceptHeader.includes('version=')) {
    const versionMatch = acceptHeader.match(/version=(\d+)/)
    if (versionMatch) {
      req.apiVersion = `v${versionMatch[1]}`
    }
  }

  // X-API-Version 헤더에서 버전 추출
  const versionHeader = req.get('X-API-Version')
  if (versionHeader && !req.apiVersion) {
    req.apiVersion = versionHeader.startsWith('v')
      ? versionHeader
      : `v${versionHeader}`
  }

  next()
}

/**
 * API 버전 검증 및 기본값 설정
 */
const validateApiVersion = (req, res, next) => {
  // 버전이 설정되지 않은 경우 기본 버전 사용
  if (!req.apiVersion) {
    req.apiVersion = DEFAULT_VERSION
  }

  // 지원하지 않는 버전인지 확인
  if (!SUPPORTED_VERSIONS.includes(req.apiVersion)) {
    const error = new AppError(
      `지원하지 않는 API 버전입니다: ${
        req.apiVersion
      }. 지원되는 버전: ${SUPPORTED_VERSIONS.join(', ')}`,
      400,
      'UNSUPPORTED_API_VERSION'
    )
    return next(error)
  }

  // 버전 정보를 응답 헤더에 추가
  res.set('X-API-Version', req.apiVersion)
  res.set('X-API-Latest-Version', LATEST_VERSION)
  res.set('X-API-Supported-Versions', SUPPORTED_VERSIONS.join(', '))

  next()
}

/**
 * 버전 상태 및 경고 헤더 추가
 */
const addVersionHeaders = (req, res, next) => {
  const versionInfo = VERSION_STATUS[req.apiVersion]

  if (versionInfo) {
    res.set('X-API-Version-Status', versionInfo.status)

    if (versionInfo.status === 'deprecated') {
      res.set('X-API-Deprecation-Warning', versionInfo.message)
      if (versionInfo.deprecatedSince) {
        res.set('X-API-Deprecated-Since', versionInfo.deprecatedSince)
      }
      if (versionInfo.sunsetDate) {
        res.set('X-API-Sunset', versionInfo.sunsetDate)
      }
    }
  }

  next()
}

/**
 * 버전별 라우팅 헬퍼
 */
const createVersionedRouter = (express) => {
  const router = express.Router()

  // 버전별 라우터 저장소
  const versionRouters = {}

  // 각 버전별 라우터 생성
  SUPPORTED_VERSIONS.forEach((version) => {
    versionRouters[version] = express.Router()
    router.use(`/${version}`, versionRouters[version])
  })

  // 버전 없는 요청은 기본 버전으로 리다이렉트
  router.use('/', (req, res, next) => {
    if (req.path === '/') {
      return res.redirect(`/api/${DEFAULT_VERSION}`)
    }
    next()
  })

  return {
    router,
    v1: versionRouters.v1,
    v2: versionRouters.v2,
  }
}

/**
 * 버전 호환성 체크 미들웨어
 */
const checkCompatibility = (requiredVersion) => {
  return (req, res, next) => {
    const currentVersion = parseInt(req.apiVersion.replace('v', ''))
    const required = parseInt(requiredVersion.replace('v', ''))

    if (currentVersion < required) {
      const error = new AppError(
        `이 기능은 ${requiredVersion} 이상에서만 사용 가능합니다. 현재 버전: ${req.apiVersion}`,
        400,
        'VERSION_TOO_LOW'
      )
      return next(error)
    }

    next()
  }
}

/**
 * 버전별 응답 변환기
 */
const transformResponse = (req, res, next) => {
  const originalJson = res.json

  res.json = function (data) {
    // 버전별 응답 변환 로직
    let transformedData = data

    switch (req.apiVersion) {
      case 'v1':
        transformedData = transformToV1(data)
        break
      case 'v2':
        transformedData = transformToV2(data)
        break
      default:
        transformedData = data
    }

    return originalJson.call(this, transformedData)
  }

  next()
}

/**
 * v1 응답 형식으로 변환
 */
const transformToV1 = (data) => {
  if (!data || typeof data !== 'object') return data

  // v1은 단순한 형식 사용
  if (data.success !== undefined) {
    return {
      status: data.success ? 'success' : 'error',
      data: data.data,
      message: data.message,
      timestamp: data.timestamp,
    }
  }

  return data
}

/**
 * v2 응답 형식으로 변환 (기본값이므로 그대로 반환)
 */
const transformToV2 = (data) => {
  return data // v2는 기본 형식 사용
}

/**
 * API 버전 정보 응답
 */
const getVersionInfo = (req, res) => {
  const versionInfo = {
    currentVersion: req.apiVersion,
    latestVersion: LATEST_VERSION,
    supportedVersions: SUPPORTED_VERSIONS,
    versionDetails: VERSION_STATUS,
  }

  res.success(versionInfo, 'API 버전 정보를 조회했습니다.')
}

/**
 * 전체 API 버전 미들웨어 체인
 */
const apiVersioning = [
  extractVersionFromPath,
  extractVersionFromHeaders,
  validateApiVersion,
  addVersionHeaders,
  transformResponse,
]

module.exports = {
  apiVersioning,
  extractVersionFromPath,
  extractVersionFromHeaders,
  validateApiVersion,
  addVersionHeaders,
  transformResponse,
  createVersionedRouter,
  checkCompatibility,
  getVersionInfo,
  SUPPORTED_VERSIONS,
  DEFAULT_VERSION,
  LATEST_VERSION,
}
