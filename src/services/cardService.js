const { sequelize } = require('../config/database')
const { QueryTypes } = require('sequelize')

/**
 * 카드 발급 이력 조회 (새로운 TB_CARD_ISSUE 테이블 기준)
 */
const getCardHistory = async (params) => {
  try {
    const { page, size, employeeId } = params

    // 전체 개수 조회
    const countQuery = `
      SELECT COUNT(*) as total
      FROM TB_CARD_ISSUE
      WHERE M_NO = :employeeId
    `

    const countResults = await sequelize.query(countQuery, {
      replacements: { employeeId },
      type: QueryTypes.SELECT,
    })
    const total = countResults[0].total

    // 페이징 데이터 조회
    const offset = page * size
    const dataQuery = `
      SELECT 
        M_NO,
        M_DEPARTMENT,
        M_POSITION,
        CARD_COUNT,
        CARD_TYPE,
        CREATE_ID,
        CREATE_DT
      FROM TB_CARD_ISSUE
      WHERE M_NO = :employeeId
      ORDER BY CREATE_DT DESC
      LIMIT :size OFFSET :offset
    `

    const dataResults = await sequelize.query(dataQuery, {
      replacements: { employeeId, size, offset },
      type: QueryTypes.SELECT,
    })

    return {
      content: dataResults.map((row) => ({
        employeeId: row.M_NO,
        department: row.M_DEPARTMENT,
        position: row.M_POSITION,
        cardCount: row.CARD_COUNT,
        cardType: row.CARD_TYPE,
        issuedBy: row.CREATE_ID,
        issuedAt: row.CREATE_DT
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
    console.error('카드 이력 조회 DB 오류:', error)
    throw new Error('데이터베이스 오류가 발생했습니다.')
  }
}

/**
 * 카드 발급 (새로운 TB_CARD_ISSUE 테이블 기준)
 */
const issueCard = async (params) => {
  const transaction = await sequelize.transaction()

  try {
    const { employeeId, cardType, issuerNotes, issuerId } = params

    // 사용자 정보 조회
    const userCheckQuery = `
      SELECT M_NO, M_NAME, M_STATUS, M_DEPARTMENT, M_POSITION
      FROM TB_MEMBER 
      WHERE M_NO = :employeeId AND M_STATUS = 'W'
      LIMIT 1
    `

    const userResults = await sequelize.query(userCheckQuery, {
      replacements: { employeeId },
      type: QueryTypes.SELECT,
      transaction,
    })

    if (userResults.length === 0) {
      await transaction.rollback()
      throw new Error('해당 사번의 재직 중인 직원을 찾을 수 없습니다.')
    }

    const user = userResults[0]

    // 해당 사번의 최대 카드 차수 조회
    const maxCountQuery = `
      SELECT IFNULL(MAX(CARD_COUNT), 0) as max_count
      FROM TB_CARD_ISSUE
      WHERE M_NO = :employeeId
    `

    const maxCountResults = await sequelize.query(maxCountQuery, {
      replacements: { employeeId },
      type: QueryTypes.SELECT,
      transaction,
    })

    const nextCardCount = maxCountResults[0].max_count + 1

    // 카드 시리얼 번호 생성
    const cardSno = generateCardNumber(cardType, nextCardCount)

    // 카드 발급 정보 저장
    const insertQuery = `
      INSERT INTO TB_CARD_ISSUE (
        M_NO,
        M_DEPARTMENT,
        M_POSITION,
        CARD_COUNT,
        CARD_SNO,
        CARD_TYPE,
        CREATE_ID,
        CREATE_DT
      ) VALUES (
        :employeeId, :department, :position, :cardCount,
        :cardSno, :cardType, :issuerId, NOW()
      )
    `

    await sequelize.query(insertQuery, {
      replacements: {
        employeeId,
        department: user.M_DEPARTMENT,
        position: user.M_POSITION,
        cardCount: nextCardCount,
        cardSno,
        cardType,
        issuerId,
      },
      type: QueryTypes.INSERT,
      transaction,
    })

    await transaction.commit()

    return {
      id: `${employeeId}_${nextCardCount}`,
      employeeId,
      department: user.M_DEPARTMENT,
      position: user.M_POSITION,
      cardCount: nextCardCount,
      cardNumber: cardSno,
      cardType,
      issuedBy: issuerId,
      issuedAt: new Date().toISOString(),
      status: 'active',
    }
  } catch (error) {
    await transaction.rollback()
    console.error('카드 발급 DB 오류:', error)
    throw error
  }
}

/**
 * 카드 번호 생성 (차수 포함)
 */
const generateCardNumber = (cardType, cardCount) => {
  const prefix = {
    'E': 'NFMC-EMP', // Employee
    'V': 'NFMC-VIS', // Visitor
    'T': 'NFMC-TMP', // Temporary
    'C': 'NFMC-CON', // Contractor
  }

  const cardPrefix = prefix[cardType] || 'NFMC-UNK'
  const timestamp = Date.now().toString().slice(-6)
  const countStr = cardCount.toString().padStart(3, '0')
  
  return `${cardPrefix}-${timestamp}-${countStr}`
}


module.exports = {
  getCardHistory,
  issueCard,
  generateCardNumber
}
