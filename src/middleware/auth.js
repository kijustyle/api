const { verifyToken, extractToken } = require('../utils/jwt')

/**
 * JWT 토큰 검증 미들웨어
 * 보호된 라우트에 접근하기 전에 토큰을 검증합니다.
 */
const authenticateToken = async (req, res, next) => {
  try {
    // Authorization 헤더에서 토큰 추출
    const authHeader = req.headers.authorization
    const token = extractToken(authHeader)

    if (!token) {
      return res.status(401).json({
        success: false,
        message: '접근 권한이 없습니다. 로그인이 필요합니다.',
        error: 'MISSING_TOKEN',
      })
    }

    // 토큰 검증
    const decoded = verifyToken(token)

    // req.user에 사용자 정보 저장 (이후 컨트롤러에서 사용)
    req.user = decoded

    next()
  } catch (error) {
    console.error('JWT 인증 오류:', error.message)

    // 토큰 만료 에러
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: '토큰이 만료되었습니다. 다시 로그인해주세요.',
        error: 'TOKEN_EXPIRED',
      })
    }

    // 토큰 형식 오류
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: '유효하지 않은 토큰입니다.',
        error: 'INVALID_TOKEN',
      })
    }

    // 기타 오류
    return res.status(401).json({
      success: false,
      message: '인증에 실패했습니다.',
      error: 'AUTH_FAILED',
    })
  }
}

/**
 * 선택적 인증 미들웨어
 * 토큰이 있으면 검증하고, 없어도 통과시킵니다.
 * 공개/비공개 데이터를 동시에 처리할 때 사용
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    const token = extractToken(authHeader)

    if (token) {
      const decoded = verifyToken(token)
      req.user = decoded
    } else {
      req.user = null
    }

    next()
  } catch (error) {
    // 토큰이 잘못되어도 계속 진행
    req.user = null
    next()
  }
}

/**
 * 권한 체크 미들웨어
 * 특정 권한이 있는지 확인합니다.
 * @param {String|Array} roles - 필요한 권한들
 */
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: '로그인이 필요합니다.',
        error: 'AUTHENTICATION_REQUIRED',
      })
    }

    const userRoles = Array.isArray(req.user.roles)
      ? req.user.roles
      : [req.user.role]
    const requiredRoles = Array.isArray(roles) ? roles : [roles]

    const hasPermission = requiredRoles.some((role) => userRoles.includes(role))

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: '권한이 부족합니다.',
        error: 'INSUFFICIENT_PERMISSIONS',
      })
    }

    next()
  }
}

module.exports = {
  authenticateToken,
  optionalAuth,
  requireRole,
}
