const axios = require('axios');
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const cron = require('node-cron');

class PatientSyncService {
  constructor() {
    // 외부 API 기본 설정
    this.baseURL = 'http://221.142.113.132/PA/AccessControl/AccessControl.asmx/AccessControlWebService';
    this.timeout = 30000; // 30초 타임아웃 (전체 조회는 시간이 더 걸릴 수 있음)
  }

  /**
   * 크론 스케줄 시작 (1시간마다 실행)
   */
  startCronJob() {
    console.log('환자 보호자 데이터 동기화 크론 작업을 시작합니다.');
    
    // 매시 정각에 실행 (0분 0초)
    cron.schedule('*/5 * * * *', async () => {
      console.log('=== 환자 보호자 데이터 동기화 크론 작업 시작 ===', new Date().toISOString());
      try {
        await this.syncPatientData();
      } catch (error) {
        console.error('크론 작업 실행 중 오류:', error);
      }
      console.log('=== 환자 데이터 동기화 크론 작업 완료 ===', new Date().toISOString());
    });

  }

  /**
   * 전체 환자 데이터를 조회하고 DB에 저장하는 메서드
   * @param {string} targetDate - 8자리 날짜 (선택사항, 없으면 오늘 날짜)
   * @returns {Promise<Object>} - 처리 결과
   */
  async syncPatientData(targetDate = null) {
    try {
      // 날짜가 없으면 오늘 날짜 사용
      if (!targetDate) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        targetDate = `${year}${month}${day}`;
      }

      console.log('전체 환자 보호자 데이터 동기화 시작:', {
        targetDate: targetDate,
        timestamp: new Date().toISOString()
      });

      // 1단계: 외부 API에서 전체 환자 보호자 데이터 조회
      const allPatients = await this.getAllPatientData(targetDate);

      if (!allPatients || allPatients.length === 0) {
        console.log('조회된 환자 보호자 데이터가 없습니다.');
        return { success: true, processedCount: 0, errors: [] };
      }

      console.log(`총 ${allPatients.length}명의 환자 보호자 데이터를 처리합니다.`);

      // 2단계: 각 환자 보호자 데이터 처리
      let processedCount = 0;
      let errorCount = 0;
      const errors = [];

      // 배치 처리 (10명씩 처리하고 잠시 대기)
      for (let i = 0; i < allPatients.length; i += 10) {
        const batch = allPatients.slice(i, i + 10);

        for (const patient of batch) {
          try {
            // DB에 저장
            await this.insertPatientToDatabase(patient);
            
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

        console.log(`진행상황: ${processedCount}/${allPatients.length} 처리 완료`);

        // 1초 대기 (서버 부하 방지)
        if (i + 10 < allPatients.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      await this.deletePatientToDatabase();

      const result = {
        success: true,
        totalCount: allPatients.length,
        processedCount: processedCount,
        errorCount: errorCount,
        errors: errors,
        targetDate: targetDate,
        completedAt: new Date().toISOString()
      };

      console.log('전체 환자 보호자 데이터 동기화 완료:', {
        totalCount: result.totalCount,
        processedCount: result.processedCount,
        errorCount: result.errorCount,
        targetDate: result.targetDate
      });

      return result;

    } catch (error) {
      console.error('전체 환자 데이터 동기화 실패:', error.message);
      throw error;
    }
  }

  /**
   * 외부 API에서 전체 환자 보호자 데이터 조회
   * @param {string} targetDate - 8자리 날짜
   * @returns {Promise<Array>} - 환자 보호자 데이터 배열
   */
  async getAllPatientData(targetDate) {
    try {
      // 요청 데이터 구성 (ID는 빈값, DT는 8자리 날짜)
      const requestBody = {
        SRV_NM: "ACW_PC_ACP_WARD_ACCESS",
        PARAM: {
          IN_HSP_TP_CD: "01",           // 빈값으로 전체 조회
          IN_PT_NO: ""    // 8자리 날짜
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

      console.log(`외부 API 호출 성공: ${data.length}명의 환자 데이터 조회됨`);
      return data;

    } catch (error) {
      console.error('외부 API 호출 실패:', error.message);
      throw error;
    }
  }


  /**
   * TB_MEMBER 테이블에 환자 데이터 삽입/업데이트
   * @param {Object} patient - 환자 데이터
   */
  async insertPatientToDatabase(patient) {
    try {
      const query = `
        INSERT INTO TB_TAG_MEMBER (
          TTM_IDNO, TTM_NAME, TTM_RANKKIND, TTM_SOURCE, TTM_ISDT,
          TTM_UPDT, TTM_LASTDT, TTM_ROOMNO, TTM_STARTDT, TTM_ENDDT,
          TTM_CHASU, TTM_WARDKIND
        ) VALUES (
          :PT_NO, :name, :rank_kind, '0', dotnet_date_to_datetime(:ISSU_DT),
          dotnet_date_to_datetime(:UDP_DT), dotnet_date_to_datetime(:UDP_DT), :WD_DEPT_CD, 
          dotnet_date_to_datetime(:ADS_DT), dotnet_date_to_datetime(:DS_DT),
          :ISSU_SEQ, :IOE_TP_CD
        )
        ON DUPLICATE KEY UPDATE 
          TTM_NAME = VALUES(TTM_NAME),
          TTM_RANKKIND = VALUES(TTM_RANKKIND),
          TTM_UPDT = VALUES(TTM_UPDT),
          TTM_LASTDT = VALUES(TTM_LASTDT),
          TTM_ROOMNO = VALUES(TTM_ROOMNO),
          TTM_STARTDT = VALUES(TTM_STARTDT),
          TTM_ENDDT = VALUES(TTM_ENDDT),
          TTM_CHASU = VALUES(TTM_CHASU),
          TTM_WARDKIND = VALUES(TTM_WARDKIND),
          TTM_EDR_ENDDT = VALUES(TTM_EDR_ENDDT)
      `;

      await sequelize.query(query, {
        replacements: { 
          ...patient,
          name : patient.PT_TP_CD === 'P' ? patient.PT_NM : patient.PT_NM + '보호자',
          rank_kind: patient.PT_TP_CD === 'P' ? '1' : '3',
        },
        type: QueryTypes.INSERT,
      });

      console.log('TB_TAG_MEMBER 데이터 삽입/업데이트 완료:', patient.PT_NO);

    } catch (error) {
      console.error('TB_TAG_MEMBER 처리 중 오류:', error);
      throw error;
    }
  }

  /**
   * TB_TAG_MEMBER 테이블에 환자 데이터 삭제
   */
  async deletePatientToDatabase() {
    try {
      const query = `
        DELETE FROM TB_TAG_MEMBER
        WHERE TTM_ENDDT IS NOT NULL
          AND NOW() > TTM_ENDDT + INTERVAL 7 HOUR
          AND DATE(TTM_ENDDT) + INTERVAL 1 DAY + INTERVAL 7 HOUR
                < DATE(NOW()) + INTERVAL 7 HOUR + INTERVAL 1 MINUTE
          AND TTM_RANKKIND IN ('1', '3');
      `;

      await sequelize.query(query, {
        type: QueryTypes.DELETE,
      });

      console.log('TB_TAG_MEMBER 데이터 삭제 완료');

    } catch (error) {
      console.error('TB_TAG_MEMBER 처리 중 오류:', error);
      throw error;
    }
  }

}

module.exports = new PatientSyncService();