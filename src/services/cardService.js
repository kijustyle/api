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

const issueBatchCard = async (params) => {
  const { employeeId, issuerId } = params;
  let transaction;
  let cardCSN = '';
  
  try {
    console.log(`=== 카드 발급 서비스 시작 ===`, {
      employeeId,
      issuerId,
      timestamp: new Date().toISOString()
    });

    // 트랜잭션 시작
    transaction = await sequelize.transaction();

    // 사번으로 직원 정보 조회
    console.log(`1단계: 직원 정보 조회 중... (사번: ${employeeId})`);
    
    const getEmployeeQuery = `
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
        s.card_type,
        p.photo as photo_blob,
        IFNULL(c.card_count, 0) + 1 as card_count
      from TB_CARD_BATCH_SAV s
      inner join TB_MEMBER m on s.m_no = m.m_no
      left join TB_PHOTO p on m.m_no = p.m_no
      left join TB_CARD c on m.m_no = c.m_no
      where 
        s.m_no = :employeeId
      AND s.CREATE_ID = :issuerId
      limit 1
    `
    
    const [employeeResult] = await sequelize.query(getEmployeeQuery, {
      replacements: { employeeId, issuerId },
      type: QueryTypes.SELECT,
      transaction,
    });
    
    if (!employeeResult) {
      throw new Error(`직원 정보를 찾을 수 없습니다. (사번: ${employeeId})`);
    }

    console.log(`직원 정보 조회 완료:`, {
      employeeResult
    });

    // 전문 작성
    const socketMessage = buildCardIssueMessage({
      no: employeeResult.m_no,
      name: employeeResult.m_name,
      department: employeeResult.m_department_name,
      position: employeeResult.m_position,
      cardCount: employeeResult.card_type === 'R' ? employeeResult.card_count : '0',
      photo_blob: employeeResult.photo_blob
        ? Buffer.from(employeeResult.photo_blob).toString('base64')
        : null,
      cardType: employeeResult.card_type,
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
        if (employeeResult.cardType === 'R') {
          // RFID 카드인 경우 실제 CSN 사용
          cardCSN = parsedResponse.cardCSN || '-';
        } else {
          cardCSN = '-';
        }
        console.log('추출된 카드번호:', cardCSN);
      } else {
        throw new Error(`카드 발급 실패 - 결과코드: ${parsedResponse.result}`);
      }
      
    } catch (socketError) {
      console.error('소켓 통신 오류:', socketError);
      throw new Error(`카드 발급 장비 연결 오류: ${socketError.message}`);
    }

    // 카드 발급 이력 저장
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
        employeeId: employeeResult.m_no,
        department: employeeResult.m_department_name,
        position: employeeResult.m_position,
        cardCount: employeeResult.card_type = 'R' ? employeeResult.card_count : '0',
        cardCSN,
        cardType: employeeResult.card_type,
        issuerId,
      },
      type: QueryTypes.INSERT,
      transaction,
    });

    console.log('발급 이력 저장 완료');

    // 배치 목록에서 삭제
    console.log(`4단계: 배치 목록에서 삭제 중...`);
    
    const deleteBatchItemQuery = `
      DELETE FROM TB_CARD_BATCH_SAV 
      WHERE m_no = :employeeId
      AND CREATE_ID = :issuerId
    `;
    
    await sequelize.query(deleteBatchItemQuery, {
      replacements: { employeeId, issuerId },
      type: QueryTypes.DELETE,
      transaction,
    });

    // 카드 정보 업데이트/삽입
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
        employeeId : employeeResult.m_no, 
        cardCount: employeeResult.cardType = 'R' ? employeeResult.card_count : '0', 
        cardCSN, 
        cardType : employeeResult.cardType
      },
      type: QueryTypes.INSERT,
      transaction,
    });

    console.log('카드 정보 저장 업데이트');
    
    console.log(`배치 목록에서 삭제 완료`);

    // 트랜잭션 커밋
    await transaction.commit();

    // 결과 반환
    const result = {
      employeeId: employeeResult.m_no,
      name: employeeResult.name,
      department: employeeResult.m_department_name,
      position: employeeResult.position,
      cardNumber: cardCSN,
      cardType: employeeResult.card_type,
      cardCount: employeeResult.cardCount,
      issueDate: new Date().toISOString(),
      issuerId
    };

    console.log(`=== 카드 발급 서비스 완료 ===`, result);
    
    return result;

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
    
    throw error;
  }
};

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
 * 카드 발급 이력 조회 (전체 이력 - 관리자용)
 */
const getCardIssueHistory = async (params) => {
  const { page, size, offset, dateFrom, dateTo, search, userId } = params;
  let transaction;
  
  try {
    console.log(`=== 카드 발급 이력 조회 서비스 시작 ===`, {
      page,
      size,
      offset,
      dateFrom,
      dateTo,
      search,
      userId,
      timestamp: new Date().toISOString()
    });

    // 트랜잭션 시작
    transaction = await sequelize.transaction();

    // 1단계: WHERE 조건 생성
    let whereConditions = [];
    let replacements = {
      limit: size,
      offset: offset
    };

    // 날짜 범위 조건
    if (dateFrom) {
      whereConditions.push(`ci.CREATE_DT >= :dateFrom`);
      replacements.dateFrom = `${dateFrom} 00:00:00`;
    }
    
    if (dateTo) {
      whereConditions.push(`ci.CREATE_DT <= :dateTo`);
      replacements.dateTo = `${dateTo} 23:59:59`;
    }

    // 검색 조건 (이름 또는 사번)
    if (search && search.trim()) {
      whereConditions.push(`(m.M_NAME LIKE :search OR ci.M_NO LIKE :search)`);
      replacements.search = `%${search.trim()}%`;
    }

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    console.log(`검색 조건:`, {
      whereClause,
      replacements
    });

    // 2단계: 총 개수 조회
    const countQuery = `
      SELECT COUNT(*) as totalCount
      FROM TB_CARD_ISSUE ci
      LEFT JOIN TB_MEMBER m ON ci.M_NO = m.M_NO
      ${whereClause}
    `;

    const [countResult] = await sequelize.query(countQuery, {
      replacements,
      type: QueryTypes.SELECT,
      transaction,
    });

    const totalElements = countResult.totalCount;
    const totalPages = Math.ceil(totalElements / size);

    console.log(`총 개수 조회 완료:`, {
      totalElements,
      totalPages,
      currentPage: page
    });

    // 3단계: 실제 데이터 조회
    const dataQuery = `
      SELECT 
        ci.M_NO as mNo,
        COALESCE(m.M_NAME, '알 수 없음') as mName,
        ci.M_DEPARTMENT as mDepartment,
        ci.M_POSITION as mPosition,
        ci.CARD_COUNT as cardCount,
        ci.CARD_SNO as cardSno,
        ci.CARD_TYPE as cardType,
        ci.CREATE_ID as createId,
        ci.CREATE_DT as createDt,
        CONCAT(ci.M_NO, '_', ci.CREATE_DT) as id
      FROM TB_CARD_ISSUE ci
      LEFT JOIN TB_MEMBER m ON ci.M_NO = m.M_NO
      ${whereClause}
      ORDER BY ci.CREATE_DT DESC
      LIMIT :limit OFFSET :offset
    `;

    const historyData = await sequelize.query(dataQuery, {
      replacements,
      type: QueryTypes.SELECT,
      transaction,
    });

    console.log(`데이터 조회 완료:`, {
    retrievedCount: historyData.length,  // 실제 조회된 개수
    requestedLimit: size,                // 요청한 LIMIT
    requestedOffset: offset,             // 요청한 OFFSET
    totalElements: totalElements,        // 전체 개수
    firstItem: historyData[0] ? {
      mNo: historyData[0].mNo,
      mName: historyData[0].mName,
      createDt: historyData[0].createDt
    } : null,
    lastItem: historyData[historyData.length - 1] ? {
      mNo: historyData[historyData.length - 1].mNo,
      createDt: historyData[historyData.length - 1].createDt
    } : null
  });

    // 트랜잭션 커밋
    await transaction.commit();

    // 4단계: 결과 반환
    const result = {
      content: historyData,
      totalElements: totalElements,
      totalPages: totalPages,
      currentPage: page,
      size: size,
      hasNext: page < totalPages - 1,
      hasPrevious: page > 0
    };

    console.log(`=== 카드 발급 이력 조회 서비스 완료 ===`, {
      totalElements: result.totalElements,
      currentPageItems: result.content.length,
      totalPages: result.totalPages,
      currentPage: result.currentPage
    });

    return result;

  } catch (error) {
    // 트랜잭션 롤백
    if (transaction) {
      await transaction.rollback();
    }
    
    console.error(`=== 카드 발급 이력 조회 서비스 실패 ===`, {
      error: error.message,
      stack: error.stack,
      params: params,
      timestamp: new Date().toISOString()
    });
    
    throw error;
  }
};

/**
 * 카드 발급 이력 엑셀 다운로드용 데이터 조회
 */
// cardService.js에 추가
const XLSX = require('xlsx');

const exportCardIssueHistoryToExcel = async (params) => {
  const { dateFrom, dateTo, search, userId } = params;
  let transaction;
  
  try {
    console.log(`=== 엑셀 다운로드 서비스 시작 ===`, params);

    transaction = await sequelize.transaction();

    // WHERE 조건 생성
    let whereConditions = [];
    let replacements = {};

    if (dateFrom) {
      whereConditions.push(`ci.CREATE_DT >= :dateFrom`);
      replacements.dateFrom = `${dateFrom} 00:00:00`;
    }
    
    if (dateTo) {
      whereConditions.push(`ci.CREATE_DT <= :dateTo`);
      replacements.dateTo = `${dateTo} 23:59:59`;
    }

    if (search && search.trim()) {
      whereConditions.push(`(m.M_NAME LIKE :search OR ci.M_NO LIKE :search)`);
      replacements.search = `%${search.trim()}%`;
    }

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    // 엑셀용 데이터 조회
    const excelQuery = `
      SELECT 
        ci.M_NO as '사번',
        COALESCE(m.M_NAME, '알 수 없음') as '이름',
        ci.M_DEPARTMENT as '부서',
        ci.M_POSITION as '직급',
        CASE 
          WHEN ci.CARD_TYPE = 'P' THEN 'PVC카드'
          WHEN ci.CARD_TYPE = 'R' THEN 'RFID카드'
          ELSE ci.CARD_TYPE
        END as '카드타입',
        ci.CARD_SNO as '카드번호',
        ci.CARD_COUNT as '발급수량',
        DATE_FORMAT(ci.CREATE_DT, '%Y-%m-%d %H:%i:%s') as '발급일시',
        ci.CREATE_ID as '발급자'
      FROM TB_CARD_ISSUE ci
      LEFT JOIN TB_MEMBER m ON ci.M_NO = m.M_NO
      ${whereClause}
      ORDER BY ci.CREATE_DT DESC
    `;

    const excelData = await sequelize.query(excelQuery, {
      replacements,
      type: QueryTypes.SELECT,
      transaction,
    });

    await transaction.commit();

    console.log(`엑셀 데이터 조회 완료: ${excelData.length}건`);

    // 엑셀 파일 생성
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new(); 
    XLSX.utils.book_append_sheet(workbook, worksheet, '카드발급이력');
    
    const excelBuffer = XLSX.write(workbook, { 
      type: 'buffer', 
      bookType: 'xlsx' 
    });
 
    console.log(`엑셀 파일 생성 완료: ${excelBuffer.length} bytes`);
    
    return excelBuffer;

  } catch (error) {
    if (transaction) {
      await transaction.rollback();
    }
    console.error(`엑셀 다운로드 서비스 실패:`, error);
    throw error;
  }
};

// module.exports에 추가
module.exports = {
  // 기존 메서드들...
  exportCardIssueHistoryToExcel  // 이 줄 추가
};

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
  issueBatchCard,
  generateCardNumber,
  getCurrentDate,
  getCardIssueHistory,
  exportCardIssueHistoryToExcel
}