const axios = require('axios');
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const cron = require('node-cron');

class CodeSyncService {
  constructor() {
    // 외부 API 기본 설정
    this.baseURL = 'http://221.142.113.132/PA/AccessControl/AccessControl.asmx/AccessControlWebService';
    this.timeout = 30000; // 30초 타임아웃 (전체 조회는 시간이 더 걸릴 수 있음)
  }

  /**
   * 크론 스케줄 시작 (24시간마다 실행)
   */
  startCronJob() {
    console.log('코드 데이터 동기화 크론 작업을 시작합니다.');
    
    // 3시간마다 실행
    cron.schedule('0 */3 * * *', async () => {
      console.log('=== 코드 데이터 동기화 크론 작업 시작 ===', new Date().toISOString());
      try {
        await this.syncCodeData();
      } catch (error) {
        console.error('크론 작업 실행 중 오류:', error);
      }
      console.log('=== 코드 데이터 동기화 크론 작업 완료 ===', new Date().toISOString());
    });

  }

  /**
   * 전체 직원 데이터를 조회하고 DB에 저장하는 메서드
   * @returns {Promise<Object>} - 처리 결과
   */
  async syncCodeData() {
    try {

      console.log('전체 코드 데이터 동기화 시작:', {
        timestamp: new Date().toISOString()
      });

      // 1단계: 외부 API에서 전체 코드 데이터 조회
      const allCodes = await this.getAllCodeData();

      if (!allCodes || allCodes.length === 0) {
        console.log('조회된 코드 데이터가 없습니다.');
        return { success: true, processedCount: 0, errors: [] };
      }

      console.log(`총 ${allCodes.length}개의 코드 데이터를 처리합니다.`);

      // 2단계: 각 코드 데이터 처리
      let processedCount = 0;
      let errorCount = 0;
      const errors = [];

      // 배치 처리 (10명씩 처리하고 잠시 대기)
      for (let i = 0; i < allCodes.length; i += 10) {
        const batch = allCodes.slice(i, i + 10);

        for (const code of batch) {
          try {
            // DB에 저장
            await this.insertCodeToDatabase(code);

            processedCount++;

          } catch (error) {
            errorCount++;
            const errorInfo = {
              patientId: patient.PT_NO,
              name: patient.PT_NM,
              error: error.message
            };
            errors.push(errorInfo);
            console.error(`환자 ${patient.PT_NO}(${patient.PT_NM}) 처리 실패:`, error.message);
          }
        }

        console.log(`진행상황: ${processedCount}/${allCodes.length} 처리 완료`);

        // 1초 대기 (서버 부하 방지)
        if (i + 10 < allCodes.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      const result = {
        success: true,
        totalCount: allCodes.length,
        processedCount: processedCount,
        errorCount: errorCount,
        errors: errors,
        completedAt: new Date().toISOString()
      };

      console.log('전체 코드 데이터 동기화 완료:', {
        totalCount: result.totalCount,
        processedCount: result.processedCount,
        errorCount: result.errorCount,
      });

      return result;

    } catch (error) {
      console.error('전체 코드 데이터 동기화 실패:', error.message);
      throw error;
    }
  }

  /**
   * 외부 API에서 전체 코드 데이터 조회
   * @returns {Promise<Array>} - 코드 데이터 배열
   */
  async getAllCodeData() {
    try {
      // 요청 데이터 구성 (ID는 빈값, DT는 8자리 날짜)
      const requestBody = {
        SRV_NM: "ACW_PC_GET_CODE_INFO",
        PARAM: {
          IN_GRP_CD: ""    
        }
      };

      console.log('외부 API 호출 시작:', {
        url: this.baseURL,
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
   * TB_MEMBER 테이블에 직원 데이터 삽입/업데이트
   * @param {Object} code - 코드 데이터
   */
  async insertCodeToDatabase(code) {
    try {
      const query = `
        INSERT INTO ccms.TB_CODE (PC_CODE, CD_CODE, CD_NAME, CD_VALUE) VALUES
        (
          :COMN_GRP_CD, :COMN_CD, :COMN_CD_NM, :SORT_SEQ)
        ON DUPLICATE KEY UPDATE 
          CD_NAME = VALUES(CD_NAME),
          CD_VALUE = VALUES(CD_VALUE)
      `;

      await sequelize.query(query, {
        replacements: code,
        type: QueryTypes.INSERT,
      });

    } catch (error) {
      console.error('TB_CODE 처리 중 오류:', error);
      throw error;
    }
  }

}

module.exports = new CodeSyncService();