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
  try {
    const result = await cardService.issueCard({
      ...req.body,
      issuerId: req.user.id // 인증된 사용자 ID
    })
    
    res.json({
      success: true,
      data: result,
      message: '카드 발급이 완료되었습니다.'
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
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