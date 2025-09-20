const express = require('express')
const router = express.Router()
const dashboardController = require('../../controllers/dashboardController')
const { authenticateToken } = require('../../middleware/auth')

// 대시보드 통계
router.get('/stats', authenticateToken, dashboardController.getDashboardStats)

// 차트 데이터
router.get('/chart', authenticateToken, dashboardController.getIssueChartData)

// 최근 발급 현황
router.get('/recent-issues', authenticateToken, dashboardController.getRecentIssues)

module.exports = router