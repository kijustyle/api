const batchService = require('../services/batchService')

/**
 * 저장된 발급 리스트
 * GET /api/v1/batch/list
 */
const selectSavedBatchList = async (req, res) => {
  try {
   
    const userNo = req.user.no     // M_NO (관리자 번호)
    const users = await batchService.selectSavedBatchList(userNo)

    res.status(200).json({
      success: true,
      message: users.length > 0 
        ? `${users.length}명의 사용자를 찾았습니다.`
        : '검색 결과가 없습니다.',
      list: users, // 배열로 반환
      count: users.length,
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
 * 일괄 발급 대상 직원 저장
 * POST /api/v1/batch/employees/save
 */
const saveBatchEmployees = async (req, res) => {
  try {
    const userNo = req.user.no; // M_NO (관리자 번호)
    const { employees } = req.body; // 클라이언트에서 보낸 직원 목록

    console.log(employees);
    console.log(userNo);
    
    
    // 유효성 검사
    if (!employees || !Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({
        success: false,
        message: '저장할 직원 목록이 없습니다.',
        timestamp: new Date().toISOString()
      });
    }
    
    // 서비스 호출하여 직원 저장
    const savedResult = await batchService.saveBatchEmployees({
      adminNo: userNo,
      employees: employees
    });
    
    res.status(200).json({
      success: true,
      message: `${savedResult.savedCount}명의 직원이 저장되었습니다.`,
      savedCount: savedResult.savedCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('일괄 발급 대상 저장 오류:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
};


const deleteBatchEmployee = async (req, res) => {
  try {
    const { employeeId } = req.params
    const userId = req.user.no // 현재 로그인한 관리자 ID
    
    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: '삭제할 직원 사번이 필요합니다.',
        timestamp: new Date().toISOString()
      })
    }
    
    console.log(`대량 발급 대상자 삭제 요청 - 사번: ${employeeId}, 요청자: ${userId}`)
    
    // 서비스 호출
    const result = await batchService.deleteBatchEmployee(employeeId, userId)
    console.log(result);
    
    if (result.affected > 0) {
      res.status(200).json({
        success: true,
        message: `사번 ${employeeId} 직원이 대량 발급 목록에서 삭제되었습니다.`,
        deletedBy: userId,
        timestamp: new Date().toISOString()
      })
    } else {
      res.status(404).json({
        success: false,
        message: '삭제할 직원을 찾을 수 없거나 권한이 없습니다.',
        timestamp: new Date().toISOString()
      })
    }
    
  } catch (error) {
    console.error('대량 발급 대상자 삭제 오류:', error)
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
      error: error.message,
      timestamp: new Date().toISOString()
    })
  }
}

const updateCardType = async (req, res) => {
  try {
    const { employeeId, cardType } = req.body;
    const userId = req.user.no
    
    // 유효성 검사
    if (!employeeId || !cardType) {
      return res.status(400).json({
        success: false,
        message: '사번과 카드 타입은 필수입니다.'
      });
    }
    
    if (!['R', 'P'].includes(cardType.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: '카드 타입은 R 또는 P만 가능합니다.'
      });
    }
    
    // 데이터베이스 업데이트
    const result = await batchService.updateCardType(employeeId, cardType.toUpperCase(), userId);
    
    if (result) {
      res.json({
        success: true,
        message: '카드 타입이 변경되었습니다.',
        data: result
      });
    } else {
      res.status(404).json({
        success: false,
        message: '해당 직원을 찾을 수 없습니다.'
      });
    }
    
  } catch (error) {
    console.error('카드 타입 업데이트 오류:', error);
    res.status(500).json({
      success: false,
      message: '카드 타입 변경 중 오류가 발생했습니다.'
    });
  }
};


const XLSX = require('xlsx')

const uploadExcelFile = async (req, res) => {
  try {
    // 1. 파일 확인
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '파일이 업로드되지 않았습니다.',
        timestamp: new Date().toISOString()
      })
    }

    const userId = String(req.user.no) // CREATE_ID로 사용
    const cardType = req.body.cardType || 'R' // 기본 카드 타입
    
    console.log(`엑셀 업로드 - 요청자: ${userId}, 파일명: ${req.file.originalname}`)

    // 2. 엑셀 파싱하여 사번 추출
    let employeeIds = []
    
    try {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' })
      const sheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[sheetName]
      
      // JSON 변환 (첫 행을 헤더로 사용)
      const jsonData = XLSX.utils.sheet_to_json(worksheet, {
        header: 1, // 배열로 받기 (헤더 포함)
        defval: '', // 빈 셀 기본값
      })
      
      console.log('파싱된 원시 데이터:', jsonData.slice(0, 5)) // 처음 5개만 로그
      
      // 첫 행은 헤더이므로 제외하고 사번 추출
      employeeIds = jsonData
        .slice(1) // 첫 번째 행(헤더) 제외
        .map(row => row[0]) // 첫 번째 컬럼 값
        .filter(id => id && String(id).trim()) // 빈 값 제거
        .map(id => String(id).trim()) // 문자열 변환 및 공백 제거
      
      console.log(`추출된 사번: ${employeeIds.slice(0, 10).join(', ')}...`) // 처음 10개만 로그
      
    } catch (parseError) {
      console.error('엑셀 파싱 오류:', parseError)
      return res.status(400).json({
        success: false,
        message: '엑셀 파일을 읽을 수 없습니다.',
        error: parseError.message,
        timestamp: new Date().toISOString()
      })
    }

    if (employeeIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: '엑셀 파일에서 사번을 찾을 수 없습니다.',
        timestamp: new Date().toISOString()
      })
    }

    console.log(`추출된 사번 개수: ${employeeIds.length}`)

    // 3. 서비스 호출하여 저장
    const result = await batchService.saveEmployeesFromExcel(
      employeeIds, 
      cardType, 
      userId
    )

    // 4. 응답
    res.json({
      success: true,
      message: `${result.savedCount}명 저장, ${result.skippedCount}명 이미 존재`,
      totalCount: employeeIds.length,
      savedCount: result.savedCount,
      skippedCount: result.skippedCount,
      savedEmployees: result.savedEmployees,
      skippedEmployees: result.skippedEmployees,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('엑셀 업로드 오류:', error)
    res.status(500).json({
      success: false,
      message: '파일 처리 중 오류가 발생했습니다.',
      error: error.message,
      timestamp: new Date().toISOString()
    })
  }
}

module.exports = {
  selectSavedBatchList,
  saveBatchEmployees,
  deleteBatchEmployee,
  updateCardType,
  uploadExcelFile
}