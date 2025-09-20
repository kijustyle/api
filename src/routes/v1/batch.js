const express = require('express')
const batchController = require('../../controllers/batchController')
const { authenticateToken } = require('../../middleware/auth')
const multer = require('multer')

const router = express.Router()

// multer 설정 - 메모리에 파일 저장
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 10 * 1024 * 1024  // 10MB 제한
  },
  fileFilter: (req, file, cb) => {
    // 엑셀 파일만 허용
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv' // .csv
    ]
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('엑셀 또는 CSV 파일만 업로드 가능합니다.'), false)
    }
  }
})

// 검색어로 사용자 검색
router.get('/list', authenticateToken, batchController.selectSavedBatchList)
// 일괄 발급 대상자 저장
router.post('/save', authenticateToken, batchController.saveBatchEmployees)
// 일괄 발급 대상자 삭제
router.delete('/delete/:employeeId', authenticateToken, batchController.deleteBatchEmployee)
// 저장된 대량 발급 대상자의 카드 타입 변경
router.put('/update-card-type', authenticateToken, batchController.updateCardType)
// 엑셀 파일 업로드 (POST로 수정)
router.post('/upload-excel', 
  authenticateToken, 
  upload.single('file'),
  batchController.uploadExcelFile
)


module.exports = router