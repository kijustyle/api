const { logError } = require('../utils/errorLogger')

/**
 * 커스텀 에러 클래스들
 */
class AppError extends Error {
  constructor(
    message,
    statusCode = 500,
    errorCode = null,
    isOperational = true
  ) {
    super(message)
    this.statusCode = statusCode
    this.errorCode = errorCode || this.getDefaultErrorCode()
    this.isOperational = isOperational
    this.timestamp = new Date().toISOString()

    Error.captureStackTrace(this, this.constructor)
  }

  getDefaultErrorCode() {
    const codes = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'VALIDATION_ERROR',
      500: 'INTERNAL_SERVER_ERROR',
    }
    return codes[this.statusCode] || 'UNKNOWN_ERROR'
  }
}

class ValidationError extends AppError {
  constructor(message, errors = []) {
    super(message, 422, 'VALIDATION_ERROR')
    this.errors = errors
  }
}

class NotFoundError extends AppError {
  constructor(resource = '리소스') {
    super(`${resource}를 찾을 수 없습니다.`, 404, 'NOT_FOUND')
  }
}

class UnauthorizedError extends AppError {
  constructor(message = '인증이 필요합니다.') {
    super(message, 401, 'UNAUTHORIZED')
  }
}

class ForbiddenError extends AppError {
  constructor(message = '권한이 부족합니다.') {
    super(message, 403, 'FORBIDDEN')
  }
}

class ConflictError extends AppError {
  constructor(message = '리소스 충돌이 발생했습니다.') {
    super(message, 409, 'CONFLICT')
  }
}

class DatabaseError extends AppError {
  constructor(message, originalError = null) {
    super(`데이터베이스 오류: ${message}`, 500, 'DATABASE_ERROR')
    this.originalError = originalError
  }
}

/**
 * Sequelize 에러 처리
 */
const handleSequelizeError = (error) => {
  switch (error.name) {
    case 'SequelizeValidationError':
      const validationErrors = error.errors.map((err) => ({
        field: err.path,
        message: err.message,
        value: err.value,
      }))
      return new ValidationError(
        '데이터 검증에 실패했습니다.',
        validationErrors
      )

    case 'SequelizeUniqueConstraintError':
      const duplicateField = error.errors[0]?.path || 'field'
      return new ConflictError(`${duplicateField}이(가) 이미 존재합니다.`)

    case 'SequelizeForeignKeyConstraintError':
      return new ValidationError('관련된 데이터가 존재하지 않습니다.')

    case 'SequelizeConnectionError':
      return new DatabaseError('데이터베이스 연결에 실패했습니다.', error)

    case 'SequelizeDatabaseError':
      return new DatabaseError('데이터베이스 쿼리 실행에 실패했습니다.', error)

    default:
      return new DatabaseError(error.message, error)
  }
}

/**
 * JWT 에러 처리
 */
const handleJWTError = (error) => {
  switch (error.name) {
    case 'JsonWebTokenError':
      return new UnauthorizedError('유효하지 않은 토큰입니다.')

    case 'TokenExpiredError':
      return new UnauthorizedError('토큰이 만료되었습니다.')

    case 'NotBeforeError':
      return new UnauthorizedError('토큰이 아직 활성화되지 않았습니다.')

    default:
      return new UnauthorizedError('토큰 인증에 실패했습니다.')
  }
}

/**
 * Mongoose 에러 처리 (MongoDB 사용시)
 */
const handleMongooseError = (error) => {
  switch (error.name) {
    case 'ValidationError':
      const errors = Object.values(error.errors).map((err) => ({
        field: err.path,
        message: err.message,
        value: err.value,
      }))
      return new ValidationError('데이터 검증에 실패했습니다.', errors)

    case 'CastError':
      return new ValidationError(`유효하지 않은 ${error.path}: ${error.value}`)

    case 'MongoError':
      if (error.code === 11000) {
        const duplicateField = Object.keys(error.keyValue)[0]
        return new ConflictError(`${duplicateField}이(가) 이미 존재합니다.`)
      }
      return new DatabaseError(error.message, error)

    default:
      return new DatabaseError(error.message, error)
  }
}

/**
 * 에러 타입별 처리기
 */
const processError = (error) => {
  // 이미 AppError 인스턴스인 경우
  if (error instanceof AppError) {
    return error
  }

  // Sequelize 에러
  if (error.name && error.name.startsWith('Sequelize')) {
    return handleSequelizeError(error)
  }

  // JWT 에러
  if (
    error.name &&
    ['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(
      error.name
    )
  ) {
    return handleJWTError(error)
  }

  // Mongoose 에러
  if (
    error.name &&
    ['ValidationError', 'CastError', 'MongoError'].includes(error.name)
  ) {
    return handleMongooseError(error)
  }

  // 일반적인 Node.js 에러들
  if (error.code === 'ENOENT') {
    return new NotFoundError('파일')
  }

  if (error.code === 'EACCES') {
    return new ForbiddenError('파일 액세스 권한이 없습니다.')
  }

  // 알 수 없는 에러는 서버 에러로 처리
  return new AppError(
    process.env.NODE_ENV === 'production'
      ? '서버 내부 오류가 발생했습니다.'
      : error.message,
    500,
    'INTERNAL_SERVER_ERROR',
    false // 운영 에러가 아님을 표시
  )
}

/**
 * 중앙집중식 에러 핸들러
 */
const errorHandler = (error, req, res, next) => {
  const processedError = processError(error)

  // 에러 로깅
  if (!processedError.isOperational || processedError.statusCode >= 500) {
    logError(
      `${processedError.errorCode}: ${processedError.message}`,
      error,
      req,
      {
        statusCode: processedError.statusCode,
        errorCode: processedError.errorCode,
        isOperational: processedError.isOperational,
        originalError: error.originalError?.message || null,
      }
    )
  }

  // 개발 환경에서는 상세한 에러 정보 제공
  const isDevelopment = process.env.NODE_ENV === 'development'

  const errorResponse = {
    success: false,
    message: processedError.message,
    errorCode: processedError.errorCode,
    timestamp: processedError.timestamp,
    requestId: req.requestId,
    ...(processedError.errors && { errors: processedError.errors }),
    ...(isDevelopment && {
      stack: processedError.stack,
      originalError: error.originalError?.message,
    }),
  }

  res.status(processedError.statusCode).json(errorResponse)
}

/**
 * 404 에러 핸들러
 */
const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(`경로 ${req.originalUrl}`)
  next(error)
}

/**
 * 비동기 함수 에러 처리 래퍼
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

/**
 * 에러 생성 헬퍼 함수들
 */
const throwValidationError = (message, errors = []) => {
  throw new ValidationError(message, errors)
}

const throwNotFoundError = (resource) => {
  throw new NotFoundError(resource)
}

const throwUnauthorizedError = (message) => {
  throw new UnauthorizedError(message)
}

const throwForbiddenError = (message) => {
  throw new ForbiddenError(message)
}

const throwConflictError = (message) => {
  throw new ConflictError(message)
}

module.exports = {
  // 에러 클래스들
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  DatabaseError,

  // 핸들러들
  errorHandler,
  notFoundHandler,
  asyncHandler,

  // 헬퍼 함수들
  throwValidationError,
  throwNotFoundError,
  throwUnauthorizedError,
  throwForbiddenError,
  throwConflictError,
}
