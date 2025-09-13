const express = require('express')
const userController = require('../../controllers/userController')

const router = express.Router()

// 인증 미들웨어 - 일단 더미로 만들기
const dummyAuth = (req, res, next) => {
  req.user = { id: 'admin', name: '관리자' }
  next()
}

/**
 * 사용자 관련 라우트
 */

// 부서 목록 조회 (먼저 배치)
router.get('/departments', dummyAuth, userController.getDepartments)

// 사번으로 사용자 검색
router.get('/search/:employeeId', dummyAuth, userController.searchUserByEmployeeId)

// 검색어로 사용자 검색
router.get('/find/:searchTerm', dummyAuth, userController.findUserBySearchTerm)

// 사용자 목록 조회
router.get('/', dummyAuth, userController.getUsers)

module.exports = router