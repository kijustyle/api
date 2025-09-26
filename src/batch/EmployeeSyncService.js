const axios = require('axios');
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const cron = require('node-cron');

class EmployeeSyncService {
  constructor() {
    // 외부 API 기본 설정
    this.baseURL = 'http://221.142.113.132/PA/AccessControl/AccessControl.asmx/AccessControlWebService';
    this.timeout = 30000; // 30초 타임아웃 (전체 조회는 시간이 더 걸릴 수 있음)
  }

  /**
   * 크론 스케줄 시작 (1시간마다 실행)
   */
  startCronJob() {
    console.log('직원 데이터 동기화 크론 작업을 시작합니다.');
    
    // 매시 정각에 실행 (0분 0초)
    cron.schedule('0 * * * *', async () => {
      console.log('=== 직원 데이터 동기화 크론 작업 시작 ===', new Date().toISOString());
      try {
        await this.syncAllEmployeeData();
      } catch (error) {
        console.error('크론 작업 실행 중 오류:', error);
      }
      console.log('=== 직원 데이터 동기화 크론 작업 완료 ===', new Date().toISOString());
    });

    // 즉시 한번 실행 (테스트용)
    // this.syncAllEmployeeData().catch(console.error);
  }

  /**
   * 전체 직원 데이터를 조회하고 DB에 저장하는 메서드
   * @param {string} targetDate - 8자리 날짜 (선택사항, 없으면 오늘 날짜)
   * @returns {Promise<Object>} - 처리 결과
   */
  async syncAllEmployeeData(targetDate = null) {
    try {
      // 날짜가 없으면 오늘 날짜 사용
      if (!targetDate) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        targetDate = `${year}${month}${day}`;
      }

      console.log('전체 직원 데이터 동기화 시작:', {
        targetDate: targetDate,
        timestamp: new Date().toISOString()
      });

      // 1단계: 외부 API에서 전체 직원 데이터 조회
      const allEmployees = await this.getAllEmployeeData(targetDate);
      
      if (!allEmployees || allEmployees.length === 0) {
        console.log('조회된 직원 데이터가 없습니다.');
        return { success: true, processedCount: 0, errors: [] };
      }

      console.log(`총 ${allEmployees.length}명의 직원 데이터를 처리합니다.`);

      // 2단계: 각 직원 데이터 처리
      let processedCount = 0;
      let errorCount = 0;
      const errors = [];

      // 배치 처리 (10명씩 처리하고 잠시 대기)
      for (let i = 0; i < allEmployees.length; i += 10) {
        const batch = allEmployees.slice(i, i + 10);
        
        for (const employee of batch) {
          try {
            // 직원 데이터 변환
            const member = this.transformEmployeeData(employee);
            
            // DB에 저장
            await this.insertMemberToDatabase(member);
            await this.handleEmployeePhoto(employee);
            
            processedCount++;

          } catch (error) {
            errorCount++;
            const errorInfo = {
              employeeId: employee.STF_NO,
              name: employee.KOR_NM,
              error: error.message
            };
            errors.push(errorInfo);
            console.error(`직원 ${employee.STF_NO}(${employee.KOR_NM}) 처리 실패:`, error.message);
          }
        }

        console.log(`진행상황: ${processedCount}/${allEmployees.length} 처리 완료`);
        
        // 1초 대기 (서버 부하 방지)
        if (i + 10 < allEmployees.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      const result = {
        success: true,
        totalCount: allEmployees.length,
        processedCount: processedCount,
        errorCount: errorCount,
        errors: errors,
        targetDate: targetDate,
        completedAt: new Date().toISOString()
      };

      console.log('전체 직원 데이터 동기화 완료:', {
        totalCount: result.totalCount,
        processedCount: result.processedCount,
        errorCount: result.errorCount,
        targetDate: result.targetDate
      });

      return result;

    } catch (error) {
      console.error('전체 직원 데이터 동기화 실패:', error.message);
      throw error;
    }
  }

  /**
   * 외부 API에서 전체 직원 데이터 조회
   * @param {string} targetDate - 8자리 날짜
   * @returns {Promise<Array>} - 직원 데이터 배열
   */
  async getAllEmployeeData(targetDate) {
    try {
      // 요청 데이터 구성 (ID는 빈값, DT는 8자리 날짜)
      const requestBody = {
        SRV_NM: "ACW_PC_GET_STAFF_DATA",
        PARAM: {
          ID: "",           // 빈값으로 전체 조회
          DT: targetDate   // 8자리 날짜
        }
      };

      console.log('외부 API 호출 시작:', {
        url: this.baseURL,
        targetDate: targetDate,
        requestBody: requestBody
      });

      const response = await axios.post(this.baseURL, requestBody, {
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });

      let parsedData;
      if (typeof response.data.d === 'string') {
        parsedData = JSON.parse(response.data.d);
      } else {
        parsedData = response.data.d || response.data;
      }

      // 성공 확인
      if (parsedData.resultCode !== 1) {
        throw new Error(`API 오류: ${parsedData.errorMsg}`);
      }

      const data = parsedData.DATA;
      if (!data || !Array.isArray(data)) {
        throw new Error('유효하지 않은 데이터 형식입니다.');
      }

      console.log(`외부 API 호출 성공: ${data.length}명의 직원 데이터 조회됨`);
      return data;

    } catch (error) {
      console.error('외부 API 호출 실패:', error.message);
      throw error;
    }
  }

  /**
   * 직원 원시 데이터를 DB 형식으로 변환
   * @param {Object} employee - 원시 직원 데이터
   * @returns {Object} - 변환된 직원 데이터
   */
  transformEmployeeData(employee) {
    return {
      M_NO: employee.STF_NO,
      M_NAME: employee.KOR_NM || '',
      M_E_NAME: employee.ENG_NM || '',
      M_REGNO: (employee.BRDY_YMD ? employee.BRDY_YMD.substring(2) + '0000000' : ''),
      M_GROUP: employee.CUR_OCTY_TP_CD || '',
      M_DEPARTMENT: employee.BLNG_DEPT_CD || '',
      M_POSITION: employee.CUR_LOJP_TP_CD || '',
      M_DUTY: employee.CUR_OCRS_TP_CD || '',
      M_STATUS: employee.WRK_SHP_CD || '',
      M_ENTER_DT: employee.JICP_DT || '',
      M_EXIT_DT: employee.RTRM_DT || '',
      M_PHONE: employee.TEL_MOB || '',
      M_GENDER: employee.SEX || ''
    };
  }

  /**
   * TB_MEMBER 테이블에 직원 데이터 삽입/업데이트
   * @param {Object} member - 직원 데이터
   */
  async insertMemberToDatabase(member) {
    try {
      const memberQuery = `
        INSERT INTO TB_MEMBER (
          M_NO, M_NAME, M_E_NAME, M_REGNO, M_GROUP, 
          M_DEPARTMENT, M_POSITION, M_DUTY, M_STATUS, 
          M_ENTER_DT, M_EXIT_DT, M_PHONE, M_GENDER, M_UPDATE_DT)
        VALUES (:M_NO, :M_NAME, :M_E_NAME, :M_REGNO, :M_GROUP, 
                :M_DEPARTMENT, :M_POSITION, :M_DUTY, :M_STATUS, 
                :M_ENTER_DT, :M_EXIT_DT, :M_PHONE, :M_GENDER, NOW())
        ON DUPLICATE KEY UPDATE 
        M_NAME = VALUES(M_NAME),
        M_E_NAME = VALUES(M_E_NAME),
        M_DEPARTMENT = VALUES(M_DEPARTMENT),
        M_POSITION = VALUES(M_POSITION),
        M_DUTY = VALUES(M_DUTY),
        M_STATUS = VALUES(M_STATUS),
        M_PHONE = VALUES(M_PHONE),
        M_UPDATE_DT = NOW()
      `;
      
      await sequelize.query(memberQuery, {
        replacements: member,
        type: QueryTypes.INSERT,
      });
      
    } catch (error) {
      console.error(`TB_MEMBER 처리 중 오류 (${member.M_NO}):`, error.message);
      throw error;
    }
  }

  /**
   * 직원 사진 처리
   * @param {Object} employee - 직원 원시 데이터
   */
  async handleEmployeePhoto(employee) {
    try {
      const photoPath = employee.PHOTO_FILE_PATH;
      
      if (!photoPath || photoPath.trim() === '') {
        // 사진 경로가 없으면 스킵 (로그 최소화)
        return;
      }

      // URL 유효성 검증
      if (!await this.isValidUrl(photoPath)) {
        console.log(`유효하지 않은 사진 URL (${employee.STF_NO}):`, photoPath);
        return;
      }

      // 사진 다운로드 및 저장
      const photoBlob = await this.downloadPhotoAsBlob(photoPath);
      if (photoBlob) {
        await this.insertPhotoToDatabase(employee.STF_NO, photoBlob);
      }

    } catch (error) {
      // 사진 처리 실패는 로그만 남기고 계속 진행
      console.error(`사진 처리 실패 (${employee.STF_NO}):`, error.message);
    }
  }

  /**
   * URL 유효성 검증
   * @param {string} urlString - 검증할 URL
   * @returns {Promise<boolean>} - 유효성 여부
   */
  async isValidUrl(urlString) {
    try {
      const url = new URL(urlString);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return false;
      }

      // 간단한 HEAD 요청으로 접근성 확인
      const response = await axios.head(urlString, {
        timeout: 5000,
        validateStatus: (status) => status >= 200 && status < 400
      });

      const contentType = response.headers['content-type'];
      return contentType && contentType.startsWith('image/');

    } catch (error) {
      return false;
    }
  }

  /**
   * 사진 다운로드
   * @param {string} photoUrl - 사진 URL
   * @returns {Promise<Buffer|null>} - 사진 데이터 또는 null
   */
  async downloadPhotoAsBlob(photoUrl) {
    try {
      const response = await axios({
        method: 'GET',
        url: photoUrl,
        responseType: 'arraybuffer',
        timeout: 10000,
        maxContentLength: 20 * 1024 * 1024, // 20MB 제한
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const contentType = response.headers['content-type'];
      if (!contentType || !contentType.startsWith('image/')) {
        return null;
      }

      return Buffer.from(response.data);

    } catch (error) {
      console.error('사진 다운로드 실패:', error.message);
      return null;
    }
  }

  /**
   * TB_PHOTO 테이블에 사진 데이터 삽입/업데이트
   * @param {string} employeeId - 직원 번호
   * @param {Buffer} photoBlob - 사진 데이터
   */
  async insertPhotoToDatabase(employeeId, photoBlob) {
    try {
      const photoQuery = `
        INSERT INTO TB_PHOTO (M_NO, PHOTO, REG_DT, REG_ID) 
        VALUES (:employeeId, :photoBlob, NOW(), 'SYNC_SYSTEM')
        ON DUPLICATE KEY UPDATE 
        PHOTO = VALUES(PHOTO),
        REG_DT = NOW(),
        REG_ID = 'SYNC_SYSTEM'
      `;
      
      await sequelize.query(photoQuery, {
        replacements: { 
          employeeId: employeeId,
          photoBlob: photoBlob
        },
        type: QueryTypes.INSERT,
      });
      
    } catch (error) {
      console.error(`TB_PHOTO 삽입 중 오류 (${employeeId}):`, error.message);
      throw error;
    }
  }

  /**
   * 수동 실행 메서드 (테스트용)
   * @param {string} targetDate - 8자리 날짜 (선택사항)
   */
  async runManualSync(targetDate = null) {
    console.log('수동 동기화 실행 시작');
    try {
      const result = await this.syncAllEmployeeData(targetDate);
      console.log('수동 동기화 완료:', result);
      return result;
    } catch (error) {
      console.error('수동 동기화 실패:', error);
      throw error;
    }
  }
}

module.exports = new EmployeeSyncService();