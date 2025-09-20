const cardService = require('../services/cardService')

const getCardHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 0
    const size = parseInt(req.query.size) || 10
    const { employeeId } = req.query

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: '사번이 필요합니다.',
        timestamp: new Date().toISOString()
      })
    }

    const result = await cardService.getCardHistory({ page, size, employeeId })

    res.status(200).json({
      success: true,
      message: '카드 발급 이력을 조회했습니다.',
      ...result,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('카드 이력 조회 오류:', error)
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
      timestamp: new Date().toISOString()
    })
  }
}

const issueCard = async (req, res) => {
  const startTime = Date.now()
  let progressInterval
  
  try {
    
    // 진행 상황 모니터링 (10초마다)
    progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime
      console.log(`카드 발급 진행 중... ${elapsed}ms`)
      
      if (elapsed > 70000) { // 70초 넘으면 경고
        console.warn(`카드 발급이 곧 타임아웃될 수 있습니다. 경과시간: ${elapsed}ms`)
      }
    }, 10000)
    
    // 실제 카드 발급 서비스 호출
    const result = await cardService.issueCard({
      ...req.body,
      issuerId: req.user.no
    })
    
    // 진행 상황 모니터링 중지
    clearInterval(progressInterval)
    progressInterval = null
    
    const totalTime = Date.now() - startTime
    console.log(`=== 카드 발급 완료 ===`, {
      totalTime: `${totalTime}ms`,
      result: result,
      timestamp: new Date().toISOString()
    })
    
    res.json({
      success: true,
      data: result,
      message: '카드 발급이 완료되었습니다.',
      processingTime: totalTime
    })
    
  } catch (error) {
    // 진행 상황 모니터링 중지
    if (progressInterval) {
      clearInterval(progressInterval)
      progressInterval = null
    }
    
    const totalTime = Date.now() - startTime
    console.error(`=== 카드 발급 실패 ===`, {
      error: error.message,
      stack: error.stack,
      totalTime: `${totalTime}ms`,
      timestamp: new Date().toISOString(),
      requestBody: req.body
    })
    
    // 타임아웃 에러인지 확인
    const isTimeout = error.message.includes('timeout') || 
                     error.message.includes('TIMEOUT') ||
                     totalTime > 85000
    
    const statusCode = isTimeout ? 408 : 500
    const message = isTimeout ? 
      '카드 발급 처리 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.' : 
      '카드 발급 중 오류가 발생했습니다.'
    
    res.status(statusCode).json({
      success: false,
      message: message,
      error: error.message,
      processingTime: totalTime,
      timestamp: new Date().toISOString()
    })
  }
}

const issueBatchCard = async (req, res) => {
  const startTime = Date.now()
  let progressInterval
  
  try {
   
    progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime
      console.log(`카드 발급 진행 중... ${elapsed}ms`)
      
      if (elapsed > 70000) { // 70초 넘으면 경고
        console.warn(`카드 발급이 곧 타임아웃될 수 있습니다. 경과시간: ${elapsed}ms`)
      }
    }, 10000)
    
    // 실제 카드 발급 서비스 호출
    const result = await cardService.issueBatchCard({
      ...req.body,
      issuerId: req.user.no
    })
    
    // 진행 상황 모니터링 중지
    clearInterval(progressInterval)
    progressInterval = null
    
    const totalTime = Date.now() - startTime
    console.log(`=== 카드 발급 완료 ===`, {
      totalTime: `${totalTime}ms`,
      result: result,
      timestamp: new Date().toISOString()
    })
    
    res.json({
      success: true,
      data: result,
      message: '카드 발급이 완료되었습니다.',
      processingTime: totalTime
    })
    
  } catch (error) {
    // 진행 상황 모니터링 중지
    if (progressInterval) {
      clearInterval(progressInterval)
      progressInterval = null
    }
    
    const totalTime = Date.now() - startTime
    console.error(`=== 카드 발급 실패 ===`, {
      error: error.message,
      stack: error.stack,
      totalTime: `${totalTime}ms`,
      timestamp: new Date().toISOString(),
      requestBody: req.body
    })
    
    // 타임아웃 에러인지 확인
    const isTimeout = error.message.includes('timeout') || 
                     error.message.includes('TIMEOUT') ||
                     totalTime > 85000
    
    const statusCode = isTimeout ? 408 : 500
    const message = isTimeout ? 
      '카드 발급 처리 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.' : 
      '카드 발급 중 오류가 발생했습니다.'
    
    res.status(statusCode).json({
      success: false,
      message: message,
      error: error.message,
      processingTime: totalTime,
      timestamp: new Date().toISOString()
    })
  }
}

/**
 * 카드 발급 이력 조회 (전체 이력 - 관리자용) - GET 방식
 */
const getCardIssueHistory = async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log(`=== 카드 발급 이력 조회 시작 ===`, {
      query: req.query,  // POST에서 GET으로 변경
      user: req.user?.no,
      timestamp: new Date().toISOString()
    });

    const { 
      page = 0, 
      size = 10, 
      dateFrom, 
      dateTo, 
      search 
    } = req.query;  // req.body에서 req.query로 변경

    // 페이징 파라미터 검증
    const pageNum = Math.max(0, parseInt(page));
    const sizeNum = Math.min(100, Math.max(1, parseInt(size)));
    const offset = pageNum * sizeNum;

    console.log(`페이징 파라미터:`, {
      page: pageNum,
      size: sizeNum,
      offset: offset,
      dateFrom,
      dateTo,
      search
    });

    // 카드 발급 이력 조회 서비스 호출
    const result = await cardService.getCardIssueHistory({
      page: pageNum,
      size: sizeNum,
      offset: offset,
      dateFrom,
      dateTo,
      search,
      userId: req.user?.id
    });

    const totalTime = Date.now() - startTime;
    console.log(`=== 카드 발급 이력 조회 완료 ===`, {
      totalCount: result.totalElements,
      currentPage: pageNum,
      totalPages: result.totalPages,
      processingTime: `${totalTime}ms`,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      content: result.content,
      totalElements: result.totalElements,
      totalPages: result.totalPages,
      currentPage: pageNum,
      size: sizeNum,
      hasNext: pageNum < result.totalPages - 1,
      hasPrevious: pageNum > 0,
      message: '카드 발급 이력 조회가 완료되었습니다.',
      processingTime: totalTime
    });

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`=== 카드 발급 이력 조회 실패 ===`, {
      error: error.message,
      stack: error.stack,
      totalTime: `${totalTime}ms`,
      timestamp: new Date().toISOString(),
      requestQuery: req.query  // req.body에서 req.query로 변경
    });

    res.status(500).json({
      success: false,
      message: '카드 발급 이력 조회 중 오류가 발생했습니다.',
      error: error.message,
      processingTime: totalTime,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * 카드 발급 이력 엑셀 다운로드 - GET 방식
 */
// cardController.js의 exportCardIssueHistory 메서드 수정
const exportCardIssueHistory = async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log(`=== 카드 발급 이력 엑셀 다운로드 시작 ===`, {
      query: req.query,
      user: req.user?.id,
      timestamp: new Date().toISOString()
    });

    const { dateFrom, dateTo, search } = req.query;

    // 엑셀 다운로드 서비스 호출
    const excelBuffer = await cardService.exportCardIssueHistoryToExcel({
      dateFrom,
      dateTo,
      search,
      userId: req.user?.id
    });

    const totalTime = Date.now() - startTime;
    console.log(`=== 카드 발급 이력 엑셀 다운로드 완료 ===`, {
      fileSize: excelBuffer.length,
      processingTime: `${totalTime}ms`,
      timestamp: new Date().toISOString()
    });

    // 파일명 생성 (현재 날짜 포함)
    const today = new Date().toISOString().split('T')[0];
    const fileName = `카드발급이력_${today}.xlsx`;

    // 응답 헤더 설정 (수정된 부분)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader('Content-Length', excelBuffer.length);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    // 바이너리 데이터 전송
    res.end(excelBuffer);

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`=== 카드 발급 이력 엑셀 다운로드 실패 ===`, {
      error: error.message,
      stack: error.stack,
      totalTime: `${totalTime}ms`,
      timestamp: new Date().toISOString(),
      requestQuery: req.query
    });

    res.status(500).json({
      success: false,
      message: '엑셀 다운로드 중 오류가 발생했습니다.',
      error: error.message,
      processingTime: totalTime,
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = {
  getCardHistory,
  issueCard,
  issueBatchCard,
  getCardIssueHistory,
  exportCardIssueHistory
}