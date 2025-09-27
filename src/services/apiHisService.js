const axios = require('axios');
const { sequelize } = require('../config/database')
const { QueryTypes } = require('sequelize')

class ApiHisService {
  constructor() {
    // 외부 API 기본 설정
    this.baseURL = process.env.API_URL;
    this.timeout = 10000; // 10초 타임아웃
  }

  /**
   * 직원 데이터를 조회하는 메서드
   * @param {string} employeeId - 사번 (예: "A25999")
   * @returns {Promise<Object>} - API 응답 데이터
   */
  async getEmployeeData(employeeId) {
    try {
      // 1단계: 입력값 검증
      if (!employeeId || typeof employeeId !== 'string') {
        throw new Error('사번이 유효하지 않습니다.');
      }

      // 2단계: 요청 데이터 구성
      const requestBody = {
        SRV_NM: "ACW_PC_GET_STAFF_DATA",
        PARAM: {
          ID: employeeId.trim(),
          DT: ""
        }
      };

      // 3단계: API 호출
      console.log('외부 API 호출 시작:', {
        url: this.baseURL,
        employeeId: employeeId
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
      if (!data || (Array.isArray(data) && data.length === 0)) {
        throw new Error('조회된 직원 데이터가 없습니다.');
      }

      // 데이터 가공 및 반환
      const employee = data[0];
      const member = {
        M_NO: employee.STF_NO,
        M_NAME: employee.KOR_NM || '',
        M_E_NAME: employee.ENG_NM || '',
        M_REGNO: employee.BRDY_YMD + '0000000' || '', 
        M_GROUP: employee.CUR_OCTY_TP_CD || '',
        M_DEPARTMENT: employee.BLNG_DEPT_CD || '',
        M_POSITION: employee.CUR_LOJP_TP_CD || '',
        M_DUTY: employee.CUR_OCRS_TP_CD || '',
        M_STATUS: employee.WRK_SHP_CD || '',
        M_ENTER_DT: employee.JICP_DT || '',
        M_EXIT_DT: employee.RTRM_DT || '',
        M_PHONE: employee.TEL_MOB || '',
        M_GENDER: employee.SEX || ''
      }

      await this.handleEmployeePhoto(employee);
      await this.insertMemberToDatabase(member);

      return member;

    } catch (error) {
      console.error(error.message);
      throw error;
    }
  }

  async handleEmployeePhoto(employee) {
    try {
      const photoPath = employee.PHOTO_FILE_PATH;

      console.log(photoPath);
      
      
      // 사진 경로가 없거나 유효하지 않은 경우
      if (!photoPath || photoPath.trim() === '' || !this.isValidUrl(photoPath)) {
        console.log('사진 정보가 유효하지 않습니다. TB_PHOTO에 기본 데이터 삽입');
        // await this.insertPhotoToDatabase(employee.STF_NO, null);
      } else {
        console.log('사진 다운로드 시작:', photoPath);
        
        // 사진 다운로드 및 BLOB 변환
        const photoBlob = await this.downloadPhotoAsBlob(photoPath);
        
        if (photoBlob) {
          console.log('사진 다운로드 성공, TB_PHOTO에 BLOB 데이터 삽입');
          await this.insertPhotoToDatabase(employee.STF_NO, photoBlob);
        } else {
          console.log('사진 다운로드 실패, TB_PHOTO에 기본 데이터 삽입');
          // await this.insertPhotoToDatabase(employee.STF_NO, null);
        }
      }
    } catch (error) {
      console.error('사진 처리 중 오류:', error);
      // 사진 처리 실패해도 직원 데이터 조회는 계속 진행
      await this.insertPhotoToDatabase(employee.STF_NO, null);
    }
  }

  async downloadPhotoAsBlob(photoUrl) {
    try {
      const response = await fetch(photoUrl, {
        timeout: 10000, // 10초 타임아웃
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        console.error('사진 다운로드 실패:', response.status, response.statusText);
        return null;
      }

      // Content-Type 확인 (이미지 파일인지 검증)
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.startsWith('image/')) {
        console.error('이미지 파일이 아닙니다:', contentType);
        return null;
      }

      // 파일 크기 체크 (예: 10MB 제한)
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > 20 * 1024 * 1024) {
        console.error('파일 크기가 너무 큽니다:', contentLength);
        return null;
      }

      // ArrayBuffer로 읽어서 Buffer로 변환
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      console.log('사진 다운로드 완료:', {
        url: photoUrl,
        size: buffer.length,
        contentType: contentType
      });

      return buffer;

    } catch (error) {
      console.error('사진 다운로드 중 오류:', error.message);
      return null;
    }
  }

  async isValidUrl(string) {
    try {
      // URL 형식 검증
      const url = new URL(string);
      
      console.log('유효한 URL 형식:', url.href);
      
      if (!['http:', 'https:'].includes(url.protocol)) {
        return false;
      }

      // HTTP 응답 검증
      return await this.checkUrlAccessibility(string);

    } catch (error) {
      return false;
    }
  }

  async checkUrlAccessibility(url) {
    try {
      const axios = require('axios');
      
      const response = await axios({
        method: 'HEAD',
        url: url,
        timeout: 5000,
        validateStatus: function (status) {
          return status >= 200 && status < 400; // 200-399 상태코드를 성공으로 처리
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      // 이미지 파일인지 확인
      const contentType = response.headers['content-type'];
      if (contentType && !contentType.startsWith('image/')) {
        console.log('이미지 파일이 아닙니다:', contentType);
        return false;
      }

      return true;

    } catch (error) {
      console.log('URL 접근성 검증 실패:', error.message);
      return false;
    }
  }

  async insertPhotoToDatabase(employeeId, photoBlob) {
    try {
      const photoQuery = `
        INSERT INTO TB_PHOTO (M_NO, PHOTO, REG_DT, REG_ID) 
        VALUES (:employeeId, :photoBlob, NOW(), 'SYSTEM')
        ON DUPLICATE KEY UPDATE 
        PHOTO = VALUES(PHOTO),
        REG_DT = NOW(),
        REG_ID = 'SYSTEM'
      `;
      
       await sequelize.query(photoQuery, {
        replacements: { 
          employeeId: employeeId,
          photoBlob: photoBlob
        },
        type: QueryTypes.INSERT,
      })
      
    } catch (error) {
      console.error('TB_PHOTO 삽입 중 오류:', error);
      throw error;
    }
  }

  async insertMemberToDatabase(member) {
    try {
      const memberQuery = `
        INSERT INTO TB_MEMBER (
          M_NO, M_NAME, M_E_NAME, M_REGNO, M_GROUP, 
          M_DEPARTMENT, M_POSITION, M_DUTY, M_STATUS, 
          M_ENTER_DT, M_EXIT_DT, M_PHONE, M_GENDER
        ) 
        VALUES (:M_NO, :M_NAME, :M_E_NAME, :M_REGNO, :M_GROUP, 
                :M_DEPARTMENT, :M_POSITION, :M_DUTY, :M_STATUS, 
                :M_ENTER_DT, :M_EXIT_DT, :M_PHONE, :M_GENDER)
        ON DUPLICATE KEY UPDATE 
        M_NAME = VALUES(M_NAME),
        M_E_NAME = VALUES(M_E_NAME),
        M_REGNO = VALUES(M_REGNO),
        M_GROUP = VALUES(M_GROUP),
        M_DEPARTMENT = VALUES(M_DEPARTMENT),
        M_POSITION = VALUES(M_POSITION),
        M_DUTY = VALUES(M_DUTY),
        M_STATUS = VALUES(M_STATUS),
        M_ENTER_DT = VALUES(M_ENTER_DT),
        M_EXIT_DT = VALUES(M_EXIT_DT),
        M_PHONE = VALUES(M_PHONE),
        M_GENDER = VALUES(M_GENDER)
      `;
      
      console.log('TB_MEMBER 삽입/업데이트 준비:', {
        M_NO: member.M_NO,
        M_NAME: member.M_NAME
      });
      
      await sequelize.query(memberQuery, {
        replacements: member,
        type: QueryTypes.INSERT,
      });
      
      console.log('TB_MEMBER 처리 완료 (삽입/업데이트):', member.M_NO);
      
    } catch (error) {
      console.error('TB_MEMBER 처리 중 오류:', error);
      throw new Error(`직원 정보 저장 실패: ${error.message}`);
    }
  }


}

module.exports = new ApiHisService();