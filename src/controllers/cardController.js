const cardService = require('../services/cardService')

/**
 * 카드 발급 이력 조회
 * GET /api/v1/cards/history?employeeId=123&page=0&size=10
 */
const getCardHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 0
    const size = parseInt(req.query.size) || 10
    const { employeeId } = req.query

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: '사번이 필요합니다.',
        timestamp: new Date().toISOString()
      })
    }

    const result = await cardService.getCardHistory({ page, size, employeeId })

    res.status(200).json({
      success: true,
      message: '카드 발급 이력을 조회했습니다.',
      ...result,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('카드 이력 조회 오류:', error)
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
      timestamp: new Date().toISOString()
    })
  }
}

const issueCard = async (req, res) => {
  const startTime = Date.now()
  let progressInterval
  
  try {
    // console.log('=== 카드 발급 컨트롤러 시작 ===', {
    //   timestamp: new Date().toISOString(),
    //   userId: req.user.id,
    //   requestBody: req.body
    // })
    
    // 진행 상황 모니터링 (10초마다)
    progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime
      console.log(`카드 발급 진행 중... ${elapsed}ms`)
      
      if (elapsed > 70000) { // 70초 넘으면 경고
        console.warn(`카드 발급이 곧 타임아웃될 수 있습니다. 경과시간: ${elapsed}ms`)
      }
    }, 10000)
    
    // 실제 카드 발급 서비스 호출
    const result = await cardService.issueCard({
      ...req.body,
      issuerId: req.user.id
    })
    
    // 진행 상황 모니터링 중지
    clearInterval(progressInterval)
    progressInterval = null
    
    const totalTime = Date.now() - startTime
    console.log(`=== 카드 발급 완료 ===`, {
      totalTime: `${totalTime}ms`,
      result: result,
      timestamp: new Date().toISOString()
    })
    
    res.json({
      success: true,
      data: result,
      message: '카드 발급이 완료되었습니다.',
      processingTime: totalTime
    })
    
  } catch (error) {
    // 진행 상황 모니터링 중지
    if (progressInterval) {
      clearInterval(progressInterval)
      progressInterval = null
    }
    
    const totalTime = Date.now() - startTime
    console.error(`=== 카드 발급 실패 ===`, {
      error: error.message,
      stack: error.stack,
      totalTime: `${totalTime}ms`,
      timestamp: new Date().toISOString(),
      requestBody: req.body
    })
    
    // 타임아웃 에러인지 확인
    const isTimeout = error.message.includes('timeout') || 
                     error.message.includes('TIMEOUT') ||
                     totalTime > 85000
    
    const statusCode = isTimeout ? 408 : 500
    const message = isTimeout ? 
      '카드 발급 처리 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.' : 
      '카드 발급 중 오류가 발생했습니다.'
    
    res.status(statusCode).json({
      success: false,
      message: message,
      error: error.message,
      processingTime: totalTime,
      timestamp: new Date().toISOString()
    })
  }
}

/**
 * 카드 다운로드
 * GET /api/v1/cards/:cardId/download
 */
const downloadCard = async (req, res) => {
  try {
    const { cardId } = req.params

    const pdfBuffer = await cardService.generateCardPDF(cardId)

    if (!pdfBuffer) {
      return res.status(404).json({
        success: false,
        message: '카드를 찾을 수 없습니다.',
        timestamp: new Date().toISOString()
      })
    }

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="card-${cardId}.pdf"`)
    res.end(pdfBuffer)

  } catch (error) {
    console.error('카드 다운로드 오류:', error)
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
      timestamp: new Date().toISOString()
    })
  }
}

module.exports = {
  getCardHistory,
  issueCard,
  downloadCard
}