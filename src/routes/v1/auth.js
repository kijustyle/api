const express = require('express')
const authController = require('../../controllers/authController')
const { validateManagerLogin } = require('../../middleware/validation')
const { authenticateToken } = require('../../middleware/auth')
const { loginLimiter } = require('../../middleware/rateLimiter')

const router = express.Router()

/**
 * 관리자 인증 관련 라우트 (v1)
 */

// 로그인 (Rate Limiting 적용)
router.post(
  '/login',
  loginLimiter, // 로그인 시도 제한
  validateManagerLogin, // 입력 검증
  authController.login // 로그인 처리
)

// 로그아웃 (인증 필요)
router.post(
  '/logout',
  authenticateToken, // JWT 토큰 검증
  authController.logout
)

// 내 정보 조회 (인증 필요)
router.get(
  '/me',
  authenticateToken, // JWT 토큰 검증
  authController.getProfile
)

router.post(
  '/rfid',
  authController.authRfid
)

// 토큰 갱신
router.post('/refresh', authController.refreshToken)

// 비밀번호 변경 (인증 필요)
router.put(
  '/password',
  authenticateToken, // JWT 토큰 검증
  authController.changePassword
)

// 권한 체크 (인증 필요)
router.get(
  '/check-permission/:requiredType',
  authenticateToken, // JWT 토큰 검증
  authController.checkPermission
)

// 임시 비밀번호 생성 (개발/테스트용)
// 운영 환경에서는 제거하거나 특별한 권한이 필요하도록 수정
if (process.env.NODE_ENV === 'development') {
  router.post('/generate-temp-password', authController.generateTempPassword)
}

module.exports = router
