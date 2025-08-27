const bcrypt = require('bcryptjs')

/**
 * 비밀번호 해시화
 * @param {String} password - 평문 비밀번호
 * @param {Number} saltRounds - 솔트 라운드 (기본: 12)
 * @returns {Promise<String>} 해시된 비밀번호
 */
const hashPassword = async (password, saltRounds = 12) => {
  try {
    const salt = await bcrypt.genSalt(saltRounds)
    const hashedPassword = await bcrypt.hash(password, salt)
    return hashedPassword
  } catch (error) {
    console.error('비밀번호 해시 오류:', error)
    throw new Error('비밀번호 암호화에 실패했습니다.')
  }
}

/**
 * 비밀번호 검증
 * @param {String} plainPassword - 평문 비밀번호
 * @param {String} hashedPassword - 해시된 비밀번호
 * @returns {Promise<Boolean>} 비밀번호 일치 여부
 */
const comparePassword = async (plainPassword, hashedPassword) => {
  try {
    const isMatch = await bcrypt.compare(plainPassword, hashedPassword)
    return isMatch
  } catch (error) {
    console.error('비밀번호 비교 오류:', error)
    throw new Error('비밀번호 검증에 실패했습니다.')
  }
}

/**
 * 비밀번호 강도 검사
 * @param {String} password - 검사할 비밀번호
 * @returns {Object} 강도 검사 결과
 */
const checkPasswordStrength = (password) => {
  const result = {
    score: 0,
    feedback: [],
    isStrong: false,
  }

  if (!password) {
    result.feedback.push('비밀번호를 입력해주세요.')
    return result
  }

  // 길이 검사
  if (password.length >= 8) {
    result.score += 1
  } else {
    result.feedback.push('최소 8자 이상이어야 합니다.')
  }

  if (password.length >= 12) {
    result.score += 1
  }

  // 소문자 포함
  if (/[a-z]/.test(password)) {
    result.score += 1
  } else {
    result.feedback.push('소문자를 포함해야 합니다.')
  }

  // 대문자 포함
  if (/[A-Z]/.test(password)) {
    result.score += 1
  } else {
    result.feedback.push('대문자를 포함해야 합니다.')
  }

  // 숫자 포함
  if (/\d/.test(password)) {
    result.score += 1
  } else {
    result.feedback.push('숫자를 포함해야 합니다.')
  }

  // 특수문자 포함
  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    result.score += 1
  } else {
    result.feedback.push('특수문자를 포함하면 더 안전합니다.')
  }

  // 연속된 문자 확인
  if (!/(.)\1{2,}/.test(password)) {
    result.score += 1
  } else {
    result.feedback.push('동일한 문자가 3번 이상 연속되면 안 됩니다.')
  }

  // 일반적인 패턴 확인
  const commonPatterns = ['123', 'abc', 'password', 'admin', 'user']
  const hasCommonPattern = commonPatterns.some((pattern) =>
    password.toLowerCase().includes(pattern)
  )

  if (!hasCommonPattern) {
    result.score += 1
  } else {
    result.feedback.push('일반적인 패턴을 사용하지 마세요.')
  }

  // 강도 평가
  if (result.score >= 6) {
    result.isStrong = true
    result.strength = 'strong'
  } else if (result.score >= 4) {
    result.strength = 'medium'
  } else {
    result.strength = 'weak'
  }

  if (result.feedback.length === 0) {
    result.feedback.push('안전한 비밀번호입니다!')
  }

  return result
}

/**
 * 임시 비밀번호 생성
 * @param {Number} length - 생성할 비밀번호 길이 (기본: 12)
 * @returns {String} 임시 비밀번호
 */
const generateTemporaryPassword = (length = 12) => {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const lowercase = 'abcdefghijklmnopqrstuvwxyz'
  const numbers = '0123456789'
  const symbols = '!@#$%^&*'

  const allChars = uppercase + lowercase + numbers + symbols

  // 각 카테고리에서 최소 1개씩 포함
  let password = ''
  password += uppercase[Math.floor(Math.random() * uppercase.length)]
  password += lowercase[Math.floor(Math.random() * lowercase.length)]
  password += numbers[Math.floor(Math.random() * numbers.length)]
  password += symbols[Math.floor(Math.random() * symbols.length)]

  // 나머지 길이만큼 랜덤 문자 추가
  for (let i = 4; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)]
  }

  // 문자 순서 섞기
  return password
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('')
}

module.exports = {
  hashPassword,
  comparePassword,
  checkPasswordStrength,
  generateTemporaryPassword,
}
