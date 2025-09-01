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
      data: result,
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

/**
 * 카드 발급
 * POST /api/v1/cards/issue
 */
const issueCard = async (req, res) => {
  try {
    const { employeeId, cardType = 'employee', issuerNotes = '' } = req.body
    const issuerId = req.user?.id || 'admin' // 실제로는 JWT에서 가져와야 함

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: '사번이 필요합니다.',
        timestamp: new Date().toISOString()
      })
    }

    const result = await cardService.issueCard({
      employeeId,
      cardType,
      issuerNotes,
      issuerId
    })

    res.status(201).json({
      success: true,
      message: '카드가 성공적으로 발급되었습니다.',
      data: result,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('카드 발급 오류:', error)
    res.status(500).json({
      success: false,
      message: error.message || '서버 오류가 발생했습니다.',
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