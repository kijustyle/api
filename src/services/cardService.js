const { sequelize } = require('../config/database')
const { QueryTypes } = require('sequelize')
const net = require('net')
const iconv = require('iconv-lite')

// 소켓 통신 설정
const CARD_SERVER_CONFIG = {
  host: process.env.CARD_SERVER_HOST || 'localhost',
  port: parseInt(process.env.CARD_SERVER_PORT) || 8210,
  timeout: parseInt(process.env.CARD_SERVER_TIMEOUT) || 60000
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
  let transaction = null;
  let cardCSN = '';
  
  try {
    // 트랜잭션 시작
    transaction = await sequelize.transaction();
    
    const { 
      employeeId, 
      name,
      department,
      position,
      cardType, 
      cardCount: originalCardCount,
      photo_blob,
      issuerId 
    } = params;

    let cardCount = originalCardCount;

    if (cardType === 'P') {
      cardCount = 0
    }
    
    console.log('카드 발급 시작:', {
      employeeId,
      cardType,
      cardCount,
      timestamp: new Date().toISOString()
    });

    // 카드 발급 서버 호출
    const socketMessage = buildCardIssueMessage({
      no: employeeId,
      name: name,
      department: department,
      position: position,
      cardCount: cardCount,
      photo_blob: photo_blob,
      cardType: cardType,
    });

    console.log('카드 발급 서버 호출 시작');
    let socketResponse;
    
    try {
      socketResponse = await sendToCardServer(socketMessage);
      console.log('카드 발급 서버 응답:', socketResponse);

      if (!socketResponse) {
        throw new Error('카드 발급 서버로부터 응답이 없습니다.');
      }

      const parsedResponse = JSON.parse(socketResponse);
      
      if (parsedResponse.result === '100') {
        // 카드 타입에 따른 처리
        if (cardType === 'R') {
          // RFID 카드인 경우 실제 CSN 사용
          cardCSN = parsedResponse.cardCSN || '';
        } else {
          cardCSN = '-';
        }
        console.log('발급 차수:', cardCount);
        console.log('추출된 카드번호:', cardCSN);
      } else {
        throw new Error(`카드 발급 실패 - 결과코드: ${parsedResponse.result}`);
      }
      
    } catch (socketError) {
      console.error('소켓 통신 오류:', socketError);
      throw new Error(`카드 발급 장비 연결 오류: ${socketError.message}`);
    }

    // 카드 발급 이력 저장
    console.log('DB 저장 시작');
    
    const insertHistoryQuery = `
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
        :cardCSN, :cardType, :issuerId, NOW()
      )
    `;
    
    await sequelize.query(insertHistoryQuery, {
      replacements: {
        employeeId,
        department: department,
        position: position,
        cardCount: cardCount,
        cardCSN,
        cardType,
        issuerId,
      },
      type: QueryTypes.INSERT,
      transaction,
    });

    console.log('발급 이력 저장 완료');

    // 5. 카드 정보 업데이트/삽입
    const upsertCardQuery = `
      INSERT INTO TB_CARD (
        M_NO, CARD_COUNT, CARD_STATUS, CARD_SNO, CARD_UDT_TIME, CARD_TYPE
      ) VALUES (
        :employeeId, :cardCount, 'Y', :cardCSN, NOW(), :cardType
      )
      ON DUPLICATE KEY UPDATE
        CARD_COUNT = :cardCount,
        CARD_STATUS = 'Y',
        CARD_SNO = :cardCSN,
        CARD_UDT_TIME = NOW(),
        CARD_TYPE = :cardType
    `;

    await sequelize.query(upsertCardQuery, {
      replacements: { 
        employeeId, 
        cardCount: cardCount, 
        cardCSN, 
        cardType 
      },
      type: QueryTypes.INSERT,
      transaction,
    });

    console.log('카드 정보 저장 완료');

    // 6. 트랜잭션 커밋
    await transaction.commit();
    transaction = null; // 트랜잭션 상태 초기화
    
    console.log('카드 발급 전체 완료');

    // 7. 성공 응답 반환
    return {
      id: employeeId,
      employeeId,
      name: name,
      department: department,
      position: position,
      cardCount: cardCount,
      cardCSN: cardCSN,
      issuedBy: issuerId,
      issuedAt: new Date().toISOString(),
      status: 'Y',
    };

  } catch (error) {
    console.error('카드 발급 오류 발생:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    // 트랜잭션이 아직 활성 상태인지 확인 후 롤백
    if (transaction && !transaction.finished) {
      try {
        await transaction.rollback();
        console.log('트랜잭션 롤백 완료');
      } catch (rollbackError) {
        console.error('트랜잭션 롤백 실패:', rollbackError.message);
      }
    }

    // 에러 재발생
    throw error;
  }
};

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

    // 일괄 발급용 소켓 메시지 생성
    const socketMessage = buildBatchIssueMessage({
      employeeId,
      name: name,
      department: department,
      position: position,
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
        cardCount: cardCount,
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

  console.log('Base64 photo length:', cardData.photo_blob ? cardData.photo_blob.length : 'null');
  console.log('Base64 photo preview:', cardData.photo_blob ? cardData.photo_blob.substring(0, 100) + '...' : 'null');
  
  const parts = [
    '0', // 즉시발급 구분자
    cardData.no || '',
    cardData.name || '',
    cardData.department || '',
    cardData.position || '',
    cardData.cardCount || '',
    cardData.cardType || '',
    cardData.photo_blob || '',
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