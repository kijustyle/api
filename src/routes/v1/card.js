// routes/card.js 수정
const express = require('express')
const cardController = require('../../controllers/cardController')
const { authenticateToken } = require('../../middleware/auth')

const router = express.Router()

// 더미 인증 미들웨어
const dummyAuth = (req, res, next) => {
  req.user = { id: 'admin', name: '관리자' }
  next()
}

// 카드 발급 전용 타임아웃 미들웨어
const cardIssueTimeout = (req, res, next) => {
  console.log('카드 발급 타임아웃 미들웨어 적용 - 90초 설정')
  
  // 요청 타임아웃 90초
  req.setTimeout(90000, () => {
    console.log('카드 발급 요청 타임아웃 (90초)')
    if (!res.headersSent) {
      res.status(408).json({
        success: false,
        message: '카드 발급 처리 시간이 초과되었습니다. (90초)',
        error: 'REQUEST_TIMEOUT',
        timestamp: new Date().toISOString()
      })
    }
  })
  
  // 응답 타임아웃 90초
  res.setTimeout(90000, () => {
    console.log('카드 발급 응답 타임아웃 (90초)')
  })
  
  next()
}

/**
 * 카드 관련 라우트
 */

// 카드 발급 이력 조회 (기존 - 특정 사번용)
router.get('/history', authenticateToken, cardController.getCardHistory)

// 카드 발급 (타임아웃 미들웨어 추가)
router.post('/issue', authenticateToken, cardIssueTimeout, cardController.issueCard)

// 카드 발급 사번으로만 대량 발급 요청
router.post('/issueBatchCard', authenticateToken, cardIssueTimeout, cardController.issueBatchCard)

// ✅ 카드발급 이력 조회 (전체 - 관리자용) - GET으로 변경
router.get('/issue-history', authenticateToken, cardController.getCardIssueHistory)

// ✅ 엑셀 다운로드 - GET으로 변경
router.get('/issue-history/export', authenticateToken, cardController.exportCardIssueHistory)

module.exports = router