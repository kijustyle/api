const jwt = require('jsonwebtoken')

/**
 * JWT 토큰 생성
 * @param {Object} payload - 토큰에 포함될 데이터 (보통 user id, email 등)
 * @param {String} expiresIn - 만료 시간 (기본: 7일)
 * @returns {String} JWT 토큰
 */
const generateToken = (payload, expiresIn = process.env.JWT_EXPIRE || '7d') => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn })
}

/**
 * JWT 토큰 검증
 * @param {String} token - 검증할 토큰
 * @returns {Object} 디코딩된 페이로드
 */
const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET)
  } catch (error) {
    throw new Error('유효하지 않은 토큰입니다.')
  }
}

/**
 * 토큰에서 Bearer 제거
 * @param {String} authHeader - Authorization 헤더 값
 * @returns {String} 순수 토큰 문자열
 */
const extractToken = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  return authHeader.substring(7) // "Bearer " 제거
}

/**
 * 리프레시 토큰 생성 (더 긴 유효기간)
 * @param {Object} payload - 토큰에 포함될 데이터
 * @returns {String} 리프레시 토큰
 */
const generateRefreshToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' })
}

module.exports = {
  generateToken,
  verifyToken,
  extractToken,
  generateRefreshToken,
}
