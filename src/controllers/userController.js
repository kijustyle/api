const userService = require('../services/userService')

/**
 * 사번으로 사용자 검색
 * GET /api/v1/users/search/:employeeId
 */
const searchUserByEmployeeId = async (req, res) => {
  try {
    const { employeeId } = req.params

    if (!employeeId || employeeId.trim() === '') {
      return res.status(400).json({
        success: false,
        message: '사번이 제공되지 않았습니다.',
        timestamp: new Date().toISOString()
      })
    }

    const user = await userService.searchByEmployeeId(employeeId)

    if (!user) {
      return res.status(404).json({
        success: false,
        message: '해당 사번의 사용자를 찾을 수 없습니다.',
        timestamp: new Date().toISOString()
      })
    }

    res.status(200).json({
      success: true,
      message: '사용자 정보를 조회했습니다.',
      ...user,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('사용자 검색 오류:', error)
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
      timestamp: new Date().toISOString()
    })
  }
}

/**
 * 검색어로 사용자 검색
 * GET /api/v1/users/find/:searchTerm
 */
const findUserBySearchTerm = async (req, res) => {
  try {
    const { searchTerm } = req.params

    if (!searchTerm || searchTerm.trim() === '') {
      return res.status(400).json({
        success: false,
        message: '검색어가 제공되지 않았습니다.',
        timestamp: new Date().toISOString()
      })
    }

    const user = await userService.findBySearchTerm(searchTerm)

    if (!user) {
      return res.status(404).json({
        success: false,
        message: '해당 검색어의 사용자를 찾을 수 없습니다.',
        timestamp: new Date().toISOString()
      })
    }

    res.status(200).json({
      success: true,
      message: '사용자 정보를 조회했습니다.',
      ...user,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('사용자 검색 오류:', error)
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
      timestamp: new Date().toISOString()
    })
  }
}

/**
 * 사용자 목록 조회 (페이징)
 * GET /api/v1/users
 */
const getUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 0
    const size = parseInt(req.query.size) || 10
    const search = req.query.search || ''

    const result = await userService.getUsers({ page, size, search })

    res.status(200).json({
      success: true,
      message: '사용자 목록을 조회했습니다.',
      data: result,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('사용자 목록 조회 오류:', error)
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
      timestamp: new Date().toISOString()
    })
  }
}

/**
 * 부서 목록 조회
 * GET /api/v1/users/departments
 */
const getDepartments = async (req, res) => {
  try {
    const departments = await userService.getDepartments()

    res.status(200).json({
      success: true,
      message: '부서 목록을 조회했습니다.',
      data: departments,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('부서 목록 조회 오류:', error)
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
      timestamp: new Date().toISOString()
    })
  }
}

module.exports = {
  searchUserByEmployeeId,
  findUserBySearchTerm,
  getUsers,
  getDepartments
}