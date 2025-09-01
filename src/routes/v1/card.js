const express = require('express')
const cardController = require('../../controllers/cardController')

const router = express.Router()

// 더미 인증 미들웨어
const dummyAuth = (req, res, next) => {
  req.user = { id: 'admin', name: '관리자' }
  next()
}

/**
 * 카드 관련 라우트
 */

// 카드 발급 이력 조회
router.get('/history', dummyAuth, cardController.getCardHistory)

// 카드 발급
router.post('/issue', dummyAuth, cardController.issueCard)

// 카드 다운로드
router.get('/:cardId/download', dummyAuth, cardController.downloadCard)

module.exports = router