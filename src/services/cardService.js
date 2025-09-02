const { sequelize } = require('../config/database')
const { QueryTypes } = require('sequelize')
const net = require('net')
const iconv = require('iconv-lite')

// 소켓 통신 설정
const CARD_SERVER_CONFIG = {
  host: process.env.CARD_SERVER_HOST || 'localhost',
  port: parseInt(process.env.CARD_SERVER_PORT) || 8210,
  timeout: parseInt(process.env.CARD_SERVER_TIMEOUT) || 10000
}

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
        CARD_SNO,
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
        cardNumber: row.CARD_SNO,
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
 * 카드 발급 (DB 저장 + 소켓 통신)
 */
const issueCard = async (params) => {
  const transaction = await sequelize.transaction()

  try {
    const { 
      employeeId, 
      name,
      department,
      position,
      cardType, 
      cardCount,
      photo_blob,
      issuerId 
    } = params

    // . 카드 차수 결정
    let nextCardCount = cardCount
    
    if (!nextCardCount) {
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

      nextCardCount = maxCountResults[0].max_count + 1
    }

    // 3. 카드 시리얼 번호 생성
    const cardSno = generateCardNumber(cardType, nextCardCount)

    // 4. Java 카드 발급 서버로 소켓 전문 전송
    console.log('카드 발급 서버로 전문 전송 시작...')
    
    const socketMessage = buildCardIssueMessage({
      no: employeeId,
      name: name,
      department: department,
      position: position,
      cardCount: cardCount,
    })

    try {
      const socketResponse = await sendToCardServer(socketMessage)
      console.log('카드 발급 서버 응답:', socketResponse)

      // 응답 확인
      if (!socketResponse || (!socketResponse.includes('100') && !socketResponse.includes('OK'))) {
        throw new Error(`카드 발급 서버 처리 실패: ${socketResponse}`)
      }
    } catch (socketError) {
      console.error('소켓 통신 오류:', socketError)
      throw new Error(`카드 발급 장비 연결 오류: ${socketError.message}`)
    }

    // 5. 카드 발급 정보 DB 저장
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
        department,
        position,
        cardCount,
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
      name: userData.M_NAME || name,
      department: userData.M_DEPARTMENT || department,
      position: userData.M_POSITION || position,
      cardCount: nextCardCount,
      cardNumber: cardSno,
      cardType,
      issuedBy: issuerId,
      issuedAt: new Date().toISOString(),
      status: 'active',
    }
  } catch (error) {
    await transaction.rollback()
    console.error('카드 발급 오류:', error)
    throw error
  }
}

/**
 * 카드 일괄 발급
 */
const issueBatchCards = async (cardsData) => {
  const results = []
  const total = cardsData.length

  for (let i = 0; i < cardsData.length; i++) {
    const cardData = cardsData[i]
    const seq = i + 1

    try {
      // 각 카드에 대해 개별 발급 처리
      const result = await issueCardWithBatchMode(cardData, seq, total)
      results.push({
        seq,
        employeeId: cardData.employeeId,
        success: true,
        ...result
      })
    } catch (error) {
      console.error(`일괄 발급 실패 [${seq}/${total}]: ${error.message}`)
      results.push({
        seq,
        employeeId: cardData.employeeId,
        success: false,
        error: error.message
      })
    }
  }

  return results
}

/**
 * 일괄 발급 모드로 카드 발급
 */
const issueCardWithBatchMode = async (params, seq, total) => {
  const transaction = await sequelize.transaction()

  try {
    const { 
      employeeId, 
      name,
      department,
      position,
      cardType = 'E', 
      photo_blob,
      issuerId = 'BATCH'
    } = params

    // 사용자 정보 조회
    let userData = { 
      M_NAME: name, 
      M_DEPARTMENT: department, 
      M_POSITION: position 
    }

    if (!name || !department || !position) {
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

      userData = userResults[0]
    }

    // 카드 차수 조회
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
    const cardSno = generateCardNumber(cardType, nextCardCount)

    // 일괄 발급용 소켓 메시지 생성
    const socketMessage = buildBatchIssueMessage({
      employeeId,
      name: userData.M_NAME || name,
      department: userData.M_DEPARTMENT || department,
      position: userData.M_POSITION || position,
      cardNumber: cardSno,
      photo_blob
    }, seq, total)

    // 소켓 전송
    const socketResponse = await sendToCardServer(socketMessage)
    
    if (!socketResponse || (!socketResponse.includes('100') && !socketResponse.includes('OK'))) {
      throw new Error(`카드 발급 서버 처리 실패: ${socketResponse}`)
    }

    // DB 저장
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
        department: userData.M_DEPARTMENT || department,
        position: userData.M_POSITION || position,
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
      cardNumber: cardSno,
      cardCount: nextCardCount
    }
  } catch (error) {
    await transaction.rollback()
    throw error
  }
}

/**
 * 연결 테스트
 */
const testConnection = async () => {
  const message = 'TEST|CONNECTION_CHECK'
  
  try {
    const response = await sendToCardServer(message)
    return response.includes('OK|CONNECTION_TEST_SUCCESS')
  } catch (error) {
    console.error(`연결 테스트 실패: ${error.message}`)
    return false
  }
}

/**
 * 즉시 발급용 메시지 생성
 * 형식: 0|사번|이름|부서|직위|카드번호|발급일자|사진데이터
 */
const buildCardIssueMessage = (cardData) => {
  const parts = [
    '0', // 즉시발급 구분자
    cardData.no || '',
    cardData.name || '',
    cardData.department || '',
    cardData.position || '',
    cardData.cardCount || '',
    getCurrentDate(), // 발급일자
  ]

  return parts.join('|')
}

/**
 * 일괄 발급용 메시지 생성
 * 형식: 1|사번|이름|부서|직위|카드번호|발급일자|사진|순번|전체수
 */
const buildBatchIssueMessage = (cardData, seq, total) => {
  const parts = [
    '1', // 일괄발급 구분자
    cardData.employeeId || '',
    cardData.name || '',
    cardData.department || '',
    cardData.position || '',
    cardData.cardNumber || '',
    getCurrentDate(),
    cardData.photo_blob || '',
    seq.toString(),
    total.toString()
  ]

  return parts.join('|')
}

/**
 * 카드 발급 서버로 소켓 통신
 */
const sendToCardServer = (message) => {
  return new Promise((resolve, reject) => {
    const client = new net.Socket()
    let responseData = ''

    // 타임아웃 설정
    const timeoutId = setTimeout(() => {
      client.destroy()
      reject(new Error('카드 발급 서버 응답 시간 초과'))
    }, CARD_SERVER_CONFIG.timeout)

    client.connect(CARD_SERVER_CONFIG.port, CARD_SERVER_CONFIG.host, () => {
      console.log('카드 발급 서버 연결 성공')
      
      // MS949 인코딩으로 전송
      const encodedMessage = iconv.encode(message, 'MS949')
      client.write(encodedMessage)
    })

    client.on('data', (data) => {
      // MS949 디코딩
      responseData += iconv.decode(data, 'MS949')
    })

    client.on('end', () => {
      clearTimeout(timeoutId)
      console.log(`서버 응답: ${responseData}`)
      resolve(responseData)
    })

    client.on('error', (error) => {
      clearTimeout(timeoutId)
      console.error('소켓 통신 오류:', error)
      reject(new Error(`카드 발급 서버 연결 실패: ${error.message}`))
    })

    client.on('close', () => {
      clearTimeout(timeoutId)
      if (!responseData) {
        reject(new Error('카드 발급 서버로부터 응답이 없습니다'))
      }
    })
  })
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

/**
 * 현재 날짜 YYYYMMDD 형식
 */
const getCurrentDate = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = (now.getMonth() + 1).toString().padStart(2, '0')
  const day = now.getDate().toString().padStart(2, '0')
  return `${year}${month}${day}`
}

module.exports = {
  getCardHistory,
  issueCard,
  issueBatchCards,
  testConnection,
  generateCardNumber
}