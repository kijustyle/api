// services/dashboardService.js
const { sequelize } = require('../config/database')
const { QueryTypes } = require('sequelize')

/**
 * 대시보드 통계 데이터 조회
 */
const getDashboardStats = async () => {
  try {
    // 1. 금일 발급 건수
    const todayIssueQuery = `
      SELECT COUNT(*) as todayIssued
      FROM TB_CARD_ISSUE 
      WHERE DATE(CREATE_DT) = CURDATE()
    `
    
    // 2. 이번달 발급 건수  
    const monthlyIssueQuery = `
      SELECT COUNT(*) as monthlyIssued
      FROM TB_CARD_ISSUE 
      WHERE YEAR(CREATE_DT) = YEAR(CURDATE()) 
        AND MONTH(CREATE_DT) = MONTH(CURDATE())
    `
    
    // 3. 활성 카드 수 (상태가 Y인 카드)
    const activeCardsQuery = `
      SELECT COUNT(*) as activeCards
      FROM TB_CARD 
      WHERE CARD_STATUS = 'Y'
    `
    
    // 4. 재직 중인 직원 수 (상태가 W인 직원)
    const totalUsersQuery = `
      SELECT COUNT(*) as totalUsers
      FROM TB_MEMBER 
      WHERE M_STATUS = 'W'
    `

    // 병렬로 모든 쿼리 실행
    const [
      [todayResult],
      [monthlyResult], 
      [activeResult],
      [usersResult]
    ] = await Promise.all([
      sequelize.query(todayIssueQuery, { type: QueryTypes.SELECT }),
      sequelize.query(monthlyIssueQuery, { type: QueryTypes.SELECT }),
      sequelize.query(activeCardsQuery, { type: QueryTypes.SELECT }),
      sequelize.query(totalUsersQuery, { type: QueryTypes.SELECT })
    ])

    return {
      todayIssued: todayResult.todayIssued || 0,
      monthlyIssued: monthlyResult.monthlyIssued || 0,
      activeCards: activeResult.activeCards || 0,
      totalUsers: usersResult.totalUsers || 0
    }
    
  } catch (error) {
    console.error('대시보드 통계 조회 오류:', error)
    throw new Error('대시보드 데이터 조회 중 오류가 발생했습니다.')
  }
}

/**
 * 기간별 발급 통계 (차트용)
 */
const getIssueChartData = async (period = '1month') => {
  try {
    let query = ''
    
    switch (period) {
      case '1month':
        query = `
          WITH RECURSIVE date_range AS (
            SELECT DATE_SUB(CURDATE(), INTERVAL 30 DAY) as date_val
            UNION ALL
            SELECT DATE_ADD(date_val, INTERVAL 1 DAY)
            FROM date_range
            WHERE date_val < CURDATE()
          )
          SELECT 
            DATE_FORMAT(dr.date_val, '%Y-%m-%d') as period,
            COALESCE(COUNT(ci.CREATE_DT), 0) as count
          FROM date_range dr
          LEFT JOIN TB_CARD_ISSUE ci ON DATE(ci.CREATE_DT) = dr.date_val
          GROUP BY dr.date_val
          ORDER BY dr.date_val ASC
        `
        break
        
      case '6months':
        query = `
          WITH RECURSIVE month_range AS (
            SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01') as month_val
            UNION ALL
            SELECT DATE_FORMAT(DATE_ADD(month_val, INTERVAL 1 MONTH), '%Y-%m-01')
            FROM month_range
            WHERE month_val < DATE_FORMAT(CURDATE(), '%Y-%m-01')
          )
          SELECT 
            DATE_FORMAT(mr.month_val, '%Y-%m') as period,
            COALESCE(COUNT(ci.CREATE_DT), 0) as count
          FROM month_range mr
          LEFT JOIN TB_CARD_ISSUE ci ON DATE_FORMAT(ci.CREATE_DT, '%Y-%m') = DATE_FORMAT(mr.month_val, '%Y-%m')
          GROUP BY mr.month_val
          ORDER BY mr.month_val ASC
        `
        break
        
      case '1year':
        query = `
          WITH RECURSIVE month_range AS (
            SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 11 MONTH), '%Y-%m-01') as month_val
            UNION ALL
            SELECT DATE_FORMAT(DATE_ADD(month_val, INTERVAL 1 MONTH), '%Y-%m-01')
            FROM month_range
            WHERE month_val < DATE_FORMAT(CURDATE(), '%Y-%m-01')
          )
          SELECT 
            DATE_FORMAT(mr.month_val, '%Y-%m') as period,
            COALESCE(COUNT(ci.CREATE_DT), 0) as count
          FROM month_range mr
          LEFT JOIN TB_CARD_ISSUE ci ON DATE_FORMAT(ci.CREATE_DT, '%Y-%m') = DATE_FORMAT(mr.month_val, '%Y-%m')
          GROUP BY mr.month_val
          ORDER BY mr.month_val ASC
        `
        break
    }

    const results = await sequelize.query(query, { 
      type: QueryTypes.SELECT 
    })

    return results.map(row => ({
      period: row.period,
      count: parseInt(row.count) || 0
    }))
    
  } catch (error) {
    console.error('차트 데이터 조회 오류:', error)
    // CTE가 지원되지 않으면 기본 방식 사용
    return getIssueChartData(period)
  }
}

const getIssueChartDataFallback = async (period = '1month') => {
  try {
    // 현재 날짜 기준으로 날짜 배열 생성
    const today = new Date()
    let dateArray = []
    
    if (period === '1month') {
      // 30일간 연속 데이터
      for (let i = 30; i >= 0; i--) {
        const date = new Date(today)
        date.setDate(today.getDate() - i)
        dateArray.push({
          period: date.toISOString().split('T')[0],
          count: 0
        })
      }
    } else if (period === '6months') {
      // 6개월간 연속 데이터
      for (let i = 5; i >= 0; i--) {
        const date = new Date(today.getFullYear(), today.getMonth() - i, 1)
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        dateArray.push({
          period: `${year}-${month}`,
          count: 0
        })
      }
    } else if (period === '1year') {
      // 12개월간 연속 데이터
      for (let i = 11; i >= 0; i--) {
        const date = new Date(today.getFullYear(), today.getMonth() - i, 1)
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        dateArray.push({
          period: `${year}-${month}`,
          count: 0
        })
      }
    }
    
    // 실제 데이터 조회해서 매핑
    let query = `
      SELECT 
        DATE_FORMAT(CREATE_DT, '${period === '1month' ? '%Y-%m-%d' : '%Y-%m'}') as period,
        COUNT(*) as count
      FROM TB_CARD_ISSUE 
      WHERE CREATE_DT >= DATE_SUB(CURDATE(), INTERVAL ${period === '1month' ? '30 DAY' : period === '6months' ? '6 MONTH' : '12 MONTH'})
      GROUP BY DATE_FORMAT(CREATE_DT, '${period === '1month' ? '%Y-%m-%d' : '%Y-%m'}')
    `
    
    const results = await sequelize.query(query, { type: QueryTypes.SELECT })
    
    // 실제 데이터를 기본 배열에 매핑
    const dataMap = new Map()
    results.forEach(row => {
      dataMap.set(row.period, parseInt(row.count) || 0)
    })
    
    return dateArray.map(item => ({
      period: item.period,
      count: dataMap.get(item.period) || 0
    }))
    
  } catch (error) {
    console.error('Fallback 차트 데이터 조회 오류:', error)
    return []
  }
}

/**
 * 최근 발급 현황 (최근 5건)
 */
const getRecentIssues = async (limit = 4) => {
  try {
    const query = `
      SELECT 
        ci.M_NO,
        m.M_NAME,
        m.M_DEPARTMENT_NAME,
        ci.CARD_TYPE,
        ci.CREATE_DT,
        CASE 
          WHEN ci.CARD_TYPE = 'R' THEN 'RFID'
          WHEN ci.CARD_TYPE = 'P' THEN 'PVC'
          ELSE ci.CARD_TYPE
        END as CARD_TYPE_NAME
      FROM TB_CARD_ISSUE ci
      INNER JOIN TB_MEMBER m ON ci.M_NO = m.M_NO
      ORDER BY ci.CREATE_DT DESC
      LIMIT :limit
    `
    
    const results = await sequelize.query(query, {
      replacements: { limit },
      type: QueryTypes.SELECT
    })

    return results.map(row => ({
      issueId: row.ISSUE_ID,
      employeeId: row.M_NO,
      name: row.M_NAME,
      department: row.M_DEPARTMENT_NAME,
      cardType: row.CARD_TYPE,
      cardTypeName: row.CARD_TYPE_NAME,
      issuedAt: row.CREATE_DT
    }))
    
  } catch (error) {
    console.error('최근 발급 현황 조회 오류:', error)
    throw new Error('최근 발급 현황 조회 중 오류가 발생했습니다.')
  }
}

module.exports = {
  getDashboardStats,
  getIssueChartData,
  getRecentIssues
}

