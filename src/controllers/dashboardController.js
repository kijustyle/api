const dashboardService = require('../services/dashboardService')

/**
 * 대시보드 통계 조회
 */
const getDashboardStats = async (req, res) => {
  try {
    const stats = await dashboardService.getDashboardStats()
    
    res.json({
      success: true,
      ...stats
    })
  } catch (error) {
    console.error('대시보드 통계 조회 오류:', error)
    res.status(500).json({
      success: false,
      message: error.message
    })
  }
}

/**
 * 기간별 발급 차트 데이터 조회
 */
const getIssueChartData = async (req, res) => {
  try {
    const { period = '1month' } = req.query
    
    const chartData = await dashboardService.getIssueChartData(period)
    
    res.json({
      success: true,
      ...chartData
    })
  } catch (error) {
    console.error('차트 데이터 조회 오류:', error)
    res.status(500).json({
      success: false,
      message: error.message
    })
  }
}

/**
 * 최근 발급 현황 조회
 */
const getRecentIssues = async (req, res) => {
  try {
    const { limit = 5 } = req.query 
    
    const recentIssues = await dashboardService.getRecentIssues(parseInt(limit))
    
    res.json({
      success: true,
      ...recentIssues
    })
  } catch (error) {
    console.error('최근 발급 현황 조회 오류:', error)
    res.status(500).json({
      success: false,
      message: error.message
    })
  }
}

module.exports = {
  getDashboardStats,
  getIssueChartData,
  getRecentIssues
}
