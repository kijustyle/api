/**
 * 일관된 API 응답 형식을 위한 미들웨어
 */

/**
 * 표준 응답 형식
 */
const createResponse = (
  success,
  data = null,
  message = null,
  errors = null,
  meta = {}
) => {
  const response = {
    success,
    timestamp: new Date().toISOString(),
    ...meta,
  }

  if (message) {
    response.message = message
  }

  if (success) {
    if (data !== null) {
      response.data = data
    }
  } else {
    if (errors) {
      response.errors = Array.isArray(errors) ? errors : [errors]
    }
    if (data) {
      response.error_data = data
    }
  }

  return response
}

/**
 * Response 객체에 헬퍼 메서드들 추가
 */
const responseFormatter = (req, res, next) => {
  // 성공 응답
  res.success = (
    data,
    message = '요청이 성공적으로 처리되었습니다.',
    statusCode = 200,
    meta = {}
  ) => {
    const formattedResponse = createResponse(true, data, message, null, {
      requestId: req.requestId,
      ...meta,
    })
    return res.status(statusCode).json(formattedResponse)
  }

  // 생성 성공 응답
  res.created = (
    data,
    message = '리소스가 성공적으로 생성되었습니다.',
    meta = {}
  ) => {
    return res.success(data, message, 201, meta)
  }

  // 수정 성공 응답
  res.updated = (
    data,
    message = '리소스가 성공적으로 수정되었습니다.',
    meta = {}
  ) => {
    return res.success(data, message, 200, meta)
  }

  // 삭제 성공 응답
  res.deleted = (
    message = '리소스가 성공적으로 삭제되었습니다.',
    meta = {}
  ) => {
    return res.success(null, message, 200, meta)
  }

  // 에러 응답
  res.error = (message, statusCode = 400, errors = null, errorCode = null) => {
    const formattedResponse = createResponse(false, null, message, errors, {
      requestId: req.requestId,
      errorCode: errorCode || getErrorCodeFromStatus(statusCode),
    })
    return res.status(statusCode).json(formattedResponse)
  }

  // 검증 실패 응답
  res.validationError = (
    errors,
    message = '입력 데이터가 올바르지 않습니다.'
  ) => {
    return res.error(message, 422, errors, 'VALIDATION_ERROR')
  }

  // 인증 실패 응답
  res.unauthorized = (message = '인증이 필요합니다.') => {
    return res.error(message, 401, null, 'UNAUTHORIZED')
  }

  // 권한 없음 응답
  res.forbidden = (message = '권한이 부족합니다.') => {
    return res.error(message, 403, null, 'FORBIDDEN')
  }

  // 리소스 없음 응답
  res.notFound = (message = '요청한 리소스를 찾을 수 없습니다.') => {
    return res.error(message, 404, null, 'NOT_FOUND')
  }

  // 충돌 응답
  res.conflict = (message = '리소스 충돌이 발생했습니다.') => {
    return res.error(message, 409, null, 'CONFLICT')
  }

  // 서버 에러 응답
  res.serverError = (message = '서버 내부 오류가 발생했습니다.') => {
    return res.error(message, 500, null, 'INTERNAL_SERVER_ERROR')
  }

  // 페이징 응답
  res.paginated = (
    data,
    pagination,
    message = '데이터를 성공적으로 조회했습니다.'
  ) => {
    return res.success(data, message, 200, {
      pagination: {
        currentPage: pagination.page || 1,
        totalPages: Math.ceil(pagination.total / pagination.limit),
        pageSize: pagination.limit || 10,
        totalItems: pagination.total || 0,
        hasNext:
          pagination.page < Math.ceil(pagination.total / pagination.limit),
        hasPrev: pagination.page > 1,
      },
    })
  }

  // 리스트 응답 (페이징 없음)
  res.list = (data, message = '목록을 성공적으로 조회했습니다.') => {
    return res.success(data, message, 200, {
      count: Array.isArray(data) ? data.length : 0,
    })
  }

  next()
}

/**
 * 상태코드에 따른 기본 에러 코드 생성
 */
const getErrorCodeFromStatus = (statusCode) => {
  const errorCodes = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    405: 'METHOD_NOT_ALLOWED',
    409: 'CONFLICT',
    422: 'VALIDATION_ERROR',
    429: 'RATE_LIMIT_EXCEEDED',
    500: 'INTERNAL_SERVER_ERROR',
    502: 'BAD_GATEWAY',
    503: 'SERVICE_UNAVAILABLE',
  }
  return errorCodes[statusCode] || 'UNKNOWN_ERROR'
}

/**
 * 기존 응답을 가로채서 표준 형식으로 변환
 */
const interceptResponse = (req, res, next) => {
  const originalJson = res.json

  res.json = function (data) {
    // 이미 표준 형식인지 확인
    if (data && typeof data === 'object' && data.hasOwnProperty('success')) {
      return originalJson.call(this, data)
    }

    // 표준 형식으로 변환
    const statusCode = res.statusCode
    const isSuccess = statusCode >= 200 && statusCode < 300

    const formattedData = createResponse(
      isSuccess,
      isSuccess ? data : null,
      isSuccess
        ? '요청이 성공적으로 처리되었습니다.'
        : '요청 처리 중 오류가 발생했습니다.',
      !isSuccess ? data : null,
      { requestId: req.requestId }
    )

    return originalJson.call(this, formattedData)
  }

  next()
}

module.exports = {
  responseFormatter,
  interceptResponse,
  createResponse,
}
