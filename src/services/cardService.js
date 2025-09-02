const { sequelize } = require('../config/database')
const { QueryTypes } = require('sequelize')

// PDF와 QR 코드 라이브러리는 선택적으로 사용
let PDFDocument, QRCode
try {
  PDFDocument = require('pdfkit')
  QRCode = require('qrcode')
} catch (error) {
  console.warn('PDF/QR 라이브러리가 설치되지 않음:', error.message)
}

/**
 * 카드 발급 이력 조회
 */
const getCardHistory = async (params) => {
  try {
    const { page, size, employeeId } = params

    // 전체 개수 조회
    const countQuery = `
      SELECT COUNT(*) as total
      FROM TB_CARD_ISSUE
      WHERE EMPLOYEE_ID = :employeeId
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
        CARD_ID,
        EMPLOYEE_ID,
        CARD_TYPE,
        CARD_NUMBER,
        ISSUED_AT,
        ISSUED_BY,
        STATUS,
        ISSUER_NOTES
      FROM TB_CARD_ISSUE
      WHERE EMPLOYEE_ID = :employeeId
      ORDER BY ISSUED_AT DESC
      LIMIT :size OFFSET :offset
    `

    const dataResults = await sequelize.query(dataQuery, {
      replacements: { employeeId, size, offset },
      type: QueryTypes.SELECT,
    })

    return {
      content: dataResults.map((row) => ({
        id: row.CARD_ID,
        employeeId: row.EMPLOYEE_ID,
        cardType: row.CARD_TYPE,
        cardNumber: row.CARD_NUMBER,
        issuedAt: row.ISSUED_AT,
        issuedBy: row.ISSUED_BY,
        status: row.STATUS,
        issuerNotes: row.ISSUER_NOTES,
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
 * 카드 발급
 */
const issueCard = async (params) => {
  const transaction = await sequelize.transaction()

  try {
    const { employeeId, cardType, issuerNotes, issuerId } = params

    // 사용자 존재 여부 확인
    const userCheckQuery = `
      SELECT M_NO, M_NAME, M_STATUS 
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

    // 카드 번호 생성
    const cardNumber = generateCardNumber(cardType)

    // QR 코드 생성 (라이브러리가 있는 경우에만)
    let qrCode = null
    if (QRCode) {
      const qrData = JSON.stringify({
        cardNumber,
        employeeId,
        cardType,
        issuedAt: new Date().toISOString(),
      })
      qrCode = await QRCode.toDataURL(qrData)
    }

    // 카드 ID 생성
    const cardId = `CARD_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`

    // 카드 발급 정보 저장
    const insertQuery = `
      INSERT INTO TB_CARD_ISSUE (
        CARD_ID,
        EMPLOYEE_ID,
        CARD_TYPE,
        CARD_NUMBER,
        ISSUED_AT,
        ISSUED_BY,
        STATUS,
        QR_CODE,
        ISSUER_NOTES
      ) VALUES (
        :cardId, :employeeId, :cardType, :cardNumber, 
        NOW(), :issuerId, 'active', :qrCode, :issuerNotes
      )
    `

    await sequelize.query(insertQuery, {
      replacements: {
        cardId,
        employeeId,
        cardType,
        cardNumber,
        issuerId,
        qrCode,
        issuerNotes,
      },
      type: QueryTypes.INSERT,
      transaction,
    })

    await transaction.commit()

    return {
      id: cardId,
      employeeId,
      cardType,
      cardNumber,
      issuedAt: new Date().toISOString(),
      issuedBy: issuerId,
      status: 'active',
      qrCode,
      issuerNotes,
    }
  } catch (error) {
    await transaction.rollback()
    console.error('카드 발급 DB 오류:', error)
    throw error
  }
}

/**
 * 카드 번호 생성
 */
const generateCardNumber = (cardType) => {
  const prefix = {
    employee: 'NFMC-EMP',
    visitor: 'NFMC-VIS',
    temporary: 'NFMC-TMP',
    contractor: 'NFMC-CON',
  }

  const cardPrefix = prefix[cardType] || 'NFMC-UNK'
  const timestamp = Date.now().toString().slice(-6)
  const random = Math.random().toString(36).substr(2, 3).toUpperCase()

  return `${cardPrefix}-${timestamp}${random}`
}

/**
 * 카드 PDF 생성
 */
const generateCardPDF = async (cardId) => {
  try {
    // PDFDocument가 없으면 더미 PDF 반환
    if (!PDFDocument) {
      console.warn('PDFDocument 라이브러리가 없어 더미 PDF를 생성합니다.')
      return Buffer.from('더미 PDF 데이터')
    }

    // 카드 정보 조회
    const query = `
      SELECT 
        tci.*,
        tm.M_NAME as EMPLOYEE_NAME,
        tm.M_DEPARTMENT_NAME,
        tm.M_POSITION
      FROM TB_CARD_ISSUE tci
      INNER JOIN TB_MEMBER tm ON tci.EMPLOYEE_ID = tm.M_NO
      WHERE tci.CARD_ID = :cardId AND tci.STATUS = 'active'
    `

    const results = await sequelize.query(query, {
      replacements: { cardId },
      type: QueryTypes.SELECT,
    })

    if (results.length === 0) {
      return null
    }

    const card = results[0]

    // PDF 생성
    const doc = new PDFDocument({
      size: [340, 215], // 카드 크기
      margins: { top: 20, bottom: 20, left: 20, right: 20 },
    })

    let buffers = []
    doc.on('data', buffers.push.bind(buffers))

    const pdfBuffer = await new Promise((resolve) => {
      doc.on('end', () => {
        const buffer = Buffer.concat(buffers)
        resolve(buffer)
      })

      // 카드 디자인
      doc.fontSize(16).font('Helvetica-Bold').text('국립소방병원', 20, 20)

      doc
        .fontSize(12)
        .font('Helvetica')
        .text(`이름: ${card.EMPLOYEE_NAME}`, 20, 50)
        .text(`부서: ${card.M_DEPARTMENT_NAME || '-'}`, 20, 70)
        .text(`직급: ${card.M_POSITION || '-'}`, 20, 90)
        .text(`사번: ${card.EMPLOYEE_ID}`, 20, 110)
        .text(`카드번호: ${card.CARD_NUMBER}`, 20, 130)
        .text(
          `발급일: ${new Date(card.ISSUED_AT).toLocaleDateString('ko-KR')}`,
          20,
          150
        )

      doc.end()
    })

    return pdfBuffer
  } catch (error) {
    console.error('카드 PDF 생성 오류:', error)
    return null
  }
}

module.exports = {
  getCardHistory,
  issueCard,
  generateCardPDF,
}
