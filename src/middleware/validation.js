/**
 * 입력 데이터 검증 미들웨어
 * SQL Injection, XSS 등을 방지합니다.
 */

// 이메일 유효성 검사
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

// 비밀번호 강도 검사 (최소 8자, 대소문자, 숫자 포함)
const isValidPassword = (password) => {
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/
  return passwordRegex.test(password)
}

// 위험한 문자열 패턴 검사 (SQL Injection 방지)
const containsSQLInjection = (input) => {
  if (typeof input !== 'string') return false

  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/i,
    /(--|#|\/\*|\*\/)/,
    /(\bOR\b|\bAND\b).*?[=<>]/i,
    /'.*?'/,
    /;/,
  ]

  return sqlPatterns.some((pattern) => pattern.test(input))
}

// XSS 패턴 검사
const containsXSS = (input) => {
  if (typeof input !== 'string') return false

  const xssPatterns = [
    /<script[^>]*>.*?<\/script>/gi,
    /<iframe[^>]*>.*?<\/iframe>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<[^>]*script/gi,
  ]

  return xssPatterns.some((pattern) => pattern.test(input))
}

// 문자열 정리 (HTML 태그 제거, 특수문자 이스케이프)
const sanitizeString = (input) => {
  if (typeof input !== 'string') return input

  return input
    .trim()
    .replace(/<[^>]*>/g, '') // HTML 태그 제거
    .replace(/[<>&"']/g, (match) => {
      const htmlEntities = {
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&#x27;',
      }
      return htmlEntities[match]
    })
}

// 재귀적으로 객체 내 모든 문자열 정리
const sanitizeObject = (obj) => {
  if (typeof obj === 'string') {
    return sanitizeString(obj)
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject)
  }

  if (typeof obj === 'object' && obj !== null) {
    const sanitized = {}
    for (const key in obj) {
      sanitized[key] = sanitizeObject(obj[key])
    }
    return sanitized
  }

  return obj
}

const validateInput = (req, res, next) => {
  try {
    // 검증에서 제외할 필드들 (바이너리 데이터나 특수한 형태의 데이터)
    const excludeFields = ['photo_blob', 'image_data', 'file_data', 'binary_data']
    
    // 모든 입력 데이터에서 위험한 패턴 검사
    const checkData = (data, path = '') => {
      if (typeof data === 'string') {
        // 현재 필드가 제외 대상인지 확인
        const fieldName = path.split('.').pop() // 마지막 필드명 추출
        if (excludeFields.includes(fieldName)) {
          return // 검증 건너뛰기
        }
        
        if (containsSQLInjection(data)) {
          throw new Error(`SQL Injection 패턴이 감지되었습니다: ${path}`)
        }
        if (containsXSS(data)) {
          throw new Error(`XSS 패턴이 감지되었습니다: ${path}`)
        }
      } else if (typeof data === 'object' && data !== null) {
        for (const key in data) {
          checkData(data[key], path ? `${path}.${key}` : key)
        }
      }
    }

    // body, query, params 검사
    if (req.body) checkData(req.body, 'body')
    if (req.query) checkData(req.query, 'query')
    if (req.params) checkData(req.params, 'params')

    // 데이터 정리 (제외 필드는 sanitize하지 않음)
    if (req.body) req.body = sanitizeObjectWithExclusions(req.body, excludeFields)
    if (req.query) req.query = sanitizeObjectWithExclusions(req.query, excludeFields)

    next()
  } catch (error) {
    console.error('입력 검증 오류:', error.message)
    return res.status(400).json({
      success: false,
      message: '유효하지 않은 입력입니다.',
      error: 'INVALID_INPUT',
    })
  }
}

// sanitizeObject를 개선한 버전 (특정 필드 제외 기능 추가)
const sanitizeObjectWithExclusions = (obj, excludeFields = []) => {
  
  if (typeof obj !== 'object' || obj === null) {
    return obj
  }

  const sanitized = {}
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      if (excludeFields.includes(key)) {
        // 제외 필드는 그대로 유지
        sanitized[key] = obj[key]
      } else if (typeof obj[key] === 'string') {
        // 문자열은 sanitize 적용
        sanitized[key] = sanitizeString(obj[key]) // 기존 sanitize 함수 사용
      } else if (typeof obj[key] === 'object') {
        // 중첩 객체는 재귀적으로 처리
        sanitized[key] = sanitizeObjectWithExclusions(obj[key], excludeFields)
      } else {
        sanitized[key] = obj[key]
      }
    }
  }
  return sanitized
}

/**
 * 회원가입 데이터 검증
 */
const validateRegister = (req, res, next) => {
  const { email, password, name } = req.body
  const errors = []

  // 필수 필드 확인
  if (!email) errors.push('이메일은 필수입니다.')
  if (!password) errors.push('비밀번호는 필수입니다.')
  if (!name) errors.push('이름은 필수입니다.')

  // 이메일 형식 확인
  if (email && !isValidEmail(email)) {
    errors.push('올바른 이메일 형식이 아닙니다.')
  }

  // 비밀번호 강도 확인
  if (password && !isValidPassword(password)) {
    errors.push('비밀번호는 8자 이상, 대소문자와 숫자를 포함해야 합니다.')
  }

  // 이름 길이 확인
  if (name && (name.length < 2 || name.length > 50)) {
    errors.push('이름은 2-50자 사이여야 합니다.')
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: '입력 데이터가 올바르지 않습니다.',
      errors,
      error: 'VALIDATION_ERROR',
    })
  }

  next()
}

/**
 * 로그인 데이터 검증 (관리자용)
 */
const validateManagerLogin = (req, res, next) => {
  const { mgId, password } = req.body
  const errors = []

  if (!mgId) {
    errors.push({ field: 'mgId', message: '관리자 ID는 필수입니다.' })
  } else if (mgId.length < 3 || mgId.length > 20) {
    errors.push({
      field: 'mgId',
      message: '관리자 ID는 3-20자 사이여야 합니다.',
    })
  }

  if (!password) {
    errors.push({ field: 'password', message: '비밀번호는 필수입니다.' })
  } else if (password.length < 4) {
    errors.push({
      field: 'password',
      message: '비밀번호는 최소 4자 이상이어야 합니다.',
    })
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: '입력 데이터가 올바르지 않습니다.',
      errors,
      error: 'VALIDATION_ERROR',
    })
  }

  next()
}

module.exports = {
  validateInput,
  validateRegister,
  validateManagerLogin, // 관리자 로그인 검증으로 변경
  isValidEmail,
  isValidPassword,
  sanitizeString,
  sanitizeObject,
}
