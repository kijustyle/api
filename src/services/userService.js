const { sequelize } = require('../config/database')
const { QueryTypes } = require('sequelize')

/**
 * 사번으로 사용자 검색 (TB_MEMBER + TB_PHOTO 조인)
 */
const searchByEmployeeId = async (employeeId) => {
  try {
    const query = `
      select 
        m.m_no,
        m.m_name,
        m.m_department,
        m.m_department_name,
        m.m_position,
        m.m_phone,
        m.m_e_name,
        m.m_status,
        m.m_gender,
        p.photo as photo_blob,
        IFNULL(c.card_count, 0) + 1 as card_count
      from TB_MEMBER m
      left join TB_PHOTO p on m.m_no = p.m_no
      left join TB_CARD c on m.m_no = c.m_no
      where m.m_no = :employeeId
      limit 1
    `

    const results = await sequelize.query(query, {
      replacements: { employeeId },
      type: QueryTypes.SELECT,
    })

    if (results.length === 0) {
      return null
    }

    const user = results[0]

    // 응답 데이터 변환
    return {
      m_no: user.m_no,
      m_name: user.m_name,
      m_department: user.m_department,
      m_department_name: user.m_department_name,
      m_position: user.m_position,
      m_phone: user.m_phone,
      m_e_name: user.m_e_name,
      m_status: user.m_status,
      m_gender: user.m_gender,
      card_count: user.card_count,
      photo_blob: user.photo_blob
        ? Buffer.from(user.photo_blob).toString('base64')
        : null,
    }
  } catch (error) {
    console.error('사용자 검색 DB 오류:', error)
    throw new Error('데이터베이스 오류가 발생했습니다.')
  }
}

/**
 * 사번으로 사용자 검색 (TB_MEMBER + TB_PHOTO 조인)
 */
const findBySearchTerm = async (searchTerm) => {
  try {
    const query = `
      select 
        m.m_no,
        m.m_name,
        m.m_department,
        m.m_department_name,
        m.m_position,
        m.m_phone,
        m.m_e_name,
        m.m_status,
        m.m_gender,
        p.photo as photo_blob,
        IFNULL(c.card_count, 0) + 1 as card_count
      from TB_MEMBER m
      left join TB_PHOTO p on m.m_no = p.m_no
      left join TB_CARD c on m.m_no = c.m_no
      where m.m_name LIKE :searchTerm or m.m_no LIKE :searchTerm
      limit 1
    `

    const results = await sequelize.query(query, {
      replacements: { searchTerm },
      type: QueryTypes.SELECT,
    })

    if (results.length === 0) {
      return null
    }

    const user = results[0]

    // 응답 데이터 변환
    return {
      m_no: user.m_no,
      m_name: user.m_name,
      m_department: user.m_department,
      m_department_name: user.m_department_name,
      m_position: user.m_position,
      m_phone: user.m_phone,
      m_e_name: user.m_e_name,
      m_status: user.m_status,
      m_gender: user.m_gender,
      card_count: user.card_count,
      photo_blob: user.photo_blob
        ? Buffer.from(user.photo_blob).toString('base64')
        : null,
    }
  } catch (error) {
    console.error('사용자 검색 DB 오류:', error)
    throw new Error('데이터베이스 오류가 발생했습니다.')
  }
}

/**
 * 사용자 목록 조회 (페이징)
 */
const getUsers = async (params) => {
  try {
    const { page, size, search } = params
    let whereConditions = []
    let replacements = { limit: size, offset: page * size }

    if (search && search.trim()) {
      whereConditions.push('(m.M_NAME LIKE :search OR m.M_NO LIKE :search)')
      replacements.search = `%${search.trim()}%`
    }

    const whereClause =
      whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

    // 전체 개수 조회
    const countQuery = `SELECT COUNT(*) as total FROM TB_MEMBER m ${whereClause}`
    const countResults = await sequelize.query(countQuery, {
      replacements,
      type: QueryTypes.SELECT,
    })
    const total = countResults[0].total

    // 페이징 데이터 조회
    const dataQuery = `
      SELECT 
        m.M_NO,
        m.M_NAME,
        m.M_DEPARTMENT_NAME,
        m.M_POSITION,
        m.M_STATUS
      FROM TB_MEMBER m
      ${whereClause}
      ORDER BY m.M_NAME ASC
      LIMIT :limit OFFSET :offset
    `

    const dataResults = await sequelize.query(dataQuery, {
      replacements,
      type: QueryTypes.SELECT,
    })

    return {
      content: dataResults.map((row) => ({
        m_no: row.M_NO,
        m_name: row.M_NAME,
        m_department_name: row.M_DEPARTMENT_NAME,
        m_position: row.M_POSITION,
        m_status: row.M_STATUS,
      })),
      totalElements: total,
      totalPages: Math.ceil(total / size),
      size,
      number: page,
      numberOfElements: dataResults.length,
      first: page === 0,
      last: page >= Math.ceil(total / size) - 1,
    }
  } catch (error) {
    console.error('사용자 목록 조회 DB 오류:', error)
    throw new Error('데이터베이스 오류가 발생했습니다.')
  }
}

/**
 * 부서 목록 조회
 */
const getDepartments = async () => {
  try {
    const query = `
      SELECT DISTINCT 
        M_DEPARTMENT as code,
        M_DEPARTMENT_NAME as name
      FROM TB_MEMBER 
      WHERE M_DEPARTMENT IS NOT NULL 
        AND M_DEPARTMENT_NAME IS NOT NULL
      ORDER BY M_DEPARTMENT_NAME ASC
    `

    const results = await sequelize.query(query, {
      type: QueryTypes.SELECT,
    })

    return results.map((row) => ({
      code: row.code,
      name: row.name,
    }))
  } catch (error) {
    console.error('부서 목록 조회 DB 오류:', error)
    throw new Error('데이터베이스 오류가 발생했습니다.')
  }
}

module.exports = {
  searchByEmployeeId,
  getUsers,
  getDepartments,
}
