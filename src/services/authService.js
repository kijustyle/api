const Manager = require('../models/Manager')
const { hashPassword, comparePassword } = require('../utils/password')
const { generateToken, generateRefreshToken } = require('../utils/jwt')
const { logInfo, logWarn, logAuthError } = require('../utils/errorLogger')
const { AppError, UnauthorizedError } = require('../middleware/errorHandler')

/**
 * 인증 관련 서비스 로직
 */

/**
 * 관리자 로그인
 */
const loginManager = async (mgId, password, req) => {
  try {
    // 관리자 정보 조회
    const manager = await Manager.findOne({
      where: { MG_ID: mgId },
    })

    if (!manager) {
      logAuthError('LOGIN_FAILED', `존재하지 않는 관리자 ID: ${mgId}`, req, {
        mgId,
      })
      throw new UnauthorizedError(
        '관리자 ID 또는 비밀번호가 올바르지 않습니다.'
      )
    }

    // 비밀번호 검증
    const isPasswordValid = await comparePassword(password, manager.MG_PASSWORD)

    if (!isPasswordValid) {
      logAuthError('LOGIN_FAILED', `비밀번호 불일치: ${mgId}`, req, { mgId })
      throw new UnauthorizedError(
        '관리자 ID 또는 비밀번호가 올바르지 않습니다.'
      )
    }

    // JWT 토큰 생성
    const tokenPayload = {
      id: manager.MG_ID,
      name: manager.MG_NAME,
      type: manager.MG_TYPE,
      no: manager.M_NO,
    }

    const accessToken = generateToken(tokenPayload, '1h') // 1시간 유효
    const refreshToken = generateRefreshToken(tokenPayload) // 30일 유효

    // 로그인 성공 로그
    logInfo('관리자 로그인 성공', req, {
      mgId,
      mgName: manager.MG_NAME,
      mgType: manager.MG_TYPE,
      loginTime: new Date().toISOString(),
    })

    return {
      manager: manager.toSafeJSON(),
      tokens: {
        accessToken,
        refreshToken,
        tokenType: 'Bearer',
        expiresIn: 3600, // 1시간 (초 단위)
      },
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }

    logAuthError('LOGIN_ERROR', '로그인 처리 중 오류 발생', req, {
      mgId,
      error: error.message,
    })
    throw new AppError('로그인 처리 중 오류가 발생했습니다.', 500)
  }
}

/**
 * 관리자 정보 조회 (토큰 기반)
 */
const getManagerProfile = async (mgId, req) => {
  try {
    const manager = await Manager.findOne({
      where: { MG_ID: mgId },
    })

    if (!manager) {
      throw new UnauthorizedError('유효하지 않은 관리자입니다.')
    }

    logInfo('관리자 정보 조회', req, { mgId })

    return manager.toSafeJSON()
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }

    logAuthError('PROFILE_ERROR', '관리자 정보 조회 중 오류', req, {
      mgId,
      error: error.message,
    })
    throw new AppError('관리자 정보 조회 중 오류가 발생했습니다.', 500)
  }
}

/**
 * 토큰 갱신
 */
const refreshAccessToken = async (refreshToken, req, rotateRefreshToken) => {
  try {
    // 리프레시 토큰 검증은 JWT 유틸에서 처리
    const { verifyToken } = require('../utils/jwt')
    const decoded = verifyToken(refreshToken)

    // 관리자가 여전히 유효한지 확인
    const manager = await Manager.findOne({
      where: { MG_ID: decoded.id },
    })

    if (!manager) {
      throw new UnauthorizedError('유효하지 않은 관리자입니다.')
    }

    if (manager.MG_STATUS === 'N') {
      throw new UnauthorizedError('비활성화된 관리자 계정입니다.')
    }

    // 새 액세스 토큰 생성
    const tokenPayload = {
      id: manager.MG_ID,
      name: manager.MG_NAME,
      type: manager.MG_TYPE,
      no: manager.M_NO,
    }

    const newAccessToken = generateToken(tokenPayload, '1h')

    let newRefreshToken = null
    if (rotateRefreshToken) {
      newRefreshToken = generateRefreshToken(tokenPayload)
    }

    logInfo('토큰 갱신 성공', req, { mgId: decoded.id })

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken, // null이거나 새 토큰
      tokenType: 'Bearer',
      expiresIn: 3600,
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }

    logAuthError('REFRESH_TOKEN_ERROR', '토큰 갱신 중 오류', req, {
      error: error.message,
    })
    throw new UnauthorizedError('토큰 갱신에 실패했습니다.')
  }
}

/**
 * 관리자 비밀번호 변경
 */
const changePassword = async (mgId, currentPassword, newPassword, req) => {
  try {
    const manager = await Manager.findOne({
      where: { MG_ID: mgId },
    })

    if (!manager) {
      throw new UnauthorizedError('유효하지 않은 관리자입니다.')
    }

    // 현재 비밀번호 확인
    const isCurrentPasswordValid = await comparePassword(
      currentPassword,
      manager.MG_PASSWORD
    )
    if (!isCurrentPasswordValid) {
      logAuthError('PASSWORD_CHANGE_FAILED', '현재 비밀번호 불일치', req, {
        mgId,
      })
      throw new UnauthorizedError('현재 비밀번호가 올바르지 않습니다.')
    }

    // 새 비밀번호 해싱
    const hashedNewPassword = await hashPassword(newPassword)

    // 비밀번호 업데이트
    await manager.update({
      MG_PASSWORD: hashedNewPassword,
    })

    logInfo('비밀번호 변경 성공', req, { mgId })

    return { message: '비밀번호가 성공적으로 변경되었습니다.' }
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }

    logAuthError('PASSWORD_CHANGE_ERROR', '비밀번호 변경 중 오류', req, {
      mgId,
      error: error.message,
    })
    throw new AppError('비밀번호 변경 중 오류가 발생했습니다.', 500)
  }
}

/**
 * 임시 비밀번호 생성 (관리자용)
 */
const createInitialPassword = async (mgId, initialPassword = '1234') => {
  try {
    const hashedPassword = await hashPassword(initialPassword)
    console.log(`\n=== 임시 비밀번호 생성 ===`)
    console.log(`관리자 ID: ${mgId}`)
    console.log(`임시 비밀번호: ${initialPassword}`)
    console.log(`해시된 비밀번호: ${hashedPassword}`)
    console.log(`========================\n`)

    return hashedPassword
  } catch (error) {
    console.error('임시 비밀번호 생성 실패:', error)
    throw error
  }
}

module.exports = {
  loginManager,
  getManagerProfile,
  refreshAccessToken,
  changePassword,
  createInitialPassword,
}
