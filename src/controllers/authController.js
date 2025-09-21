const { asyncHandler } = require('../middleware/errorHandler')
const authService = require('../services/authService')
const { validateLogin } = require('../middleware/validation')

/**
 * 인증 관련 컨트롤러
 */

/**
 * 관리자 로그인
 * POST /api/v1/auth/login
 */
const login = asyncHandler(async (req, res) => {
  const { mgId, password } = req.body

  console.log(mgId);
  console.log(password);
  

  // 로그인 서비스 호출
  const result = await authService.loginManager(mgId, password, req)

  // 성공 응답
  res.status(200).json({
    success: true,
    message: '로그인이 성공적으로 완료되었습니다.',
    manager: result.manager, // data 대신 직접 필드명 사용
    tokens: result.tokens, // 토큰도 최상위로
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
  })
})

/**
 * 관리자 정보 조회
 * GET /api/v1/auth/me
 */
const getProfile = asyncHandler(async (req, res) => {
  const mgId = req.user.id
  const manager = await authService.getManagerProfile(mgId, req)

  res.status(200).json({
    success: true,
    message: '관리자 정보를 조회했습니다.',
    manager: manager, // data 대신 manager 사용
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
  })
})

/**
 * 토큰 갱신
 * POST /api/v1/auth/refresh
 */
const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body

  if (!refreshToken) {
    return res.status(401).json({
      success: false,
      message: '리프레시 토큰이 필요합니다.',
      error: 'MISSING_REFRESH_TOKEN'
    })
  }

  const result = await authService.refreshAccessToken(refreshToken, req, false)

  return res.status(200).json({
    success: true,
    message: '토큰이 성공적으로 갱신되었습니다.',
    data: result,
  });
})

/**
 * 로그아웃
 * POST /api/v1/auth/logout
 */
const logout = asyncHandler(async (req, res) => {
  const mgId = req.user.id

  // 실제로는 클라이언트에서 토큰을 삭제하면 되지만,
  // 추후 토큰 블랙리스트 기능을 추가할 수 있습니다.

  res.success(null, '로그아웃이 성공적으로 완료되었습니다.', 200, {
    logoutTime: new Date().toISOString(),
    mgId,
  })
})

/**
 * 비밀번호 변경
 * PUT /api/v1/auth/password
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body
  const mgId = req.user.id

  // 입력 값 검증
  const errors = []

  if (!currentPassword) {
    errors.push({
      field: 'currentPassword',
      message: '현재 비밀번호가 필요합니다.',
    })
  }

  if (!newPassword) {
    errors.push({ field: 'newPassword', message: '새 비밀번호가 필요합니다.' })
  } else if (newPassword.length < 4) {
    errors.push({
      field: 'newPassword',
      message: '새 비밀번호는 최소 4자 이상이어야 합니다.',
    })
  }

  if (newPassword !== confirmPassword) {
    errors.push({
      field: 'confirmPassword',
      message: '새 비밀번호 확인이 일치하지 않습니다.',
    })
  }

  if (errors.length > 0) {
    return res.validationError(errors, '입력 데이터가 올바르지 않습니다.')
  }

  const result = await authService.changePassword(
    mgId,
    currentPassword,
    newPassword,
    req
  )

  res.status(200).json({
    success: true,
    message: result.message,
    
  });
})

/**
 * 관리자 권한 체크
 * GET /api/v1/auth/check-permission/:requiredType
 */
const checkPermission = asyncHandler(async (req, res) => {
  const { requiredType } = req.params
  const userType = req.user.type

  const hierarchy = {
    master: 3,
    manager: 2,
    card: 1,
  }

  const hasPermission = hierarchy[userType] >= hierarchy[requiredType]

  res.success(
    {
      hasPermission,
      userType,
      requiredType,
      hierarchy: hierarchy[userType] || 0,
    },
    hasPermission ? '권한이 충족됩니다.' : '권한이 부족합니다.'
  )
})

/**
 * 임시 비밀번호 생성 (개발/테스트용)
 * POST /api/v1/auth/generate-temp-password
 */
const generateTempPassword = asyncHandler(async (req, res) => {
  const { mgId, tempPassword } = req.body

  if (!mgId) {
    return res.status(400).json({
      success: false,
      message: '관리자 ID가 제공되지 않았습니다.',
      errors: [{ field: 'mgId', message: '관리자 ID가 필요합니다.' }],
    })
  }

  const hashedPassword = await authService.createInitialPassword(
    mgId,
    tempPassword || '1234'
  )

  res.status(200).json({
    success: true,
    message: '임시 비밀번호가 생성되었습니다.',
    data: {
      mgId,
      tempPassword: tempPassword || '1234',
      hashedPassword,
      instruction:
        '이 해시된 비밀번호를 데이터베이스 MG_PASSWORD 컬럼에 저장하세요.',
    },
    timestamp: new Date().toISOString(),
  })
})

module.exports = {
  login,
  getProfile,
  refreshToken,
  logout,
  changePassword,
  checkPermission,
  generateTempPassword,
}
