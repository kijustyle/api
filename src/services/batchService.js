const { sequelize } = require('../config/database')
const { QueryTypes } = require('sequelize')

/**
 * 일괄발급 대상자 검색
 */
const selectSavedBatchList = async (currentUserId) => {
  try {
    const query = `
      SELECT 
          m.m_no,
          m.m_name,
          m.m_department,
          m.m_department_name,
          m.m_position,
          m.m_phone,
          m.m_e_name,
          m.m_status,
          IFNULL(c.card_count, 0) + 1 as card_count,
          bs.CARD_TYPE as saved_card_type,
          case when bs.CARD_TYPE = 'R' then 'RFID'
               when bs.CARD_TYPE = 'P' then 'PVC'
          END as saved_card_type_name,
          bs.CREATE_ID as saved_by,
          bs.CREATE_DT as saved_date
      FROM TB_CARD_BATCH_SAV bs
      INNER JOIN TB_MEMBER m ON bs.M_NO = m.m_no
      LEFT JOIN TB_PHOTO p ON m.m_no = p.m_no
      LEFT JOIN TB_CARD c ON m.m_no = c.m_no
      WHERE 
        m.m_status = 'W'
      AND bs.CREATE_ID = :currentUserId
      ORDER BY bs.CREATE_DT DESC, m.m_no ASC
    `
    const results = await sequelize.query(query, {
      replacements: { 
        currentUserId: currentUserId
      },
      type: QueryTypes.SELECT,
    })

    // 빈 배열 반환 (null이 아닌)
    if (results.length === 0) {
      return []
    }

    // 배열로 반환하도록 수정
    return results.map(user => ({
      m_no: user.m_no,
      m_name: user.m_name,
      m_department: user.m_department,
      m_department_name: user.m_department_name,
      m_position: user.m_position,
      m_phone: user.m_phone,
      m_e_name: user.m_e_name,
      m_status: user.m_status,
      m_gender: user.m_gender,
      card_count: user.card_count,
      saved_card_type: user.saved_card_type
    }))
  } catch (error) {
    console.error('사용자 검색 DB 오류:', error)
    throw new Error('데이터베이스 오류가 발생했습니다.')
  }
}

const saveBatchEmployees = async ({ adminNo, employees }) => {
  const transaction = await sequelize.transaction();
  
  try {
    let savedCount = 0;
    let duplicateCount = 0;
    
    console.log('employees : {}', employees);

    
    for (const employee of employees) {
      // 중복 체크 쿼리
      const checkQuery = `
        SELECT COUNT(*) as count
        FROM TB_CARD_BATCH_SAV
        WHERE M_NO = :employeeNo
          AND CREATE_ID = :adminNo
      `;
      
      const [checkResult] = await sequelize.query(checkQuery, {
        replacements: { 
          employeeNo: employee.m_no,
          adminNo: adminNo
        },
        type: QueryTypes.SELECT,
        transaction
      });
      
      // 이미 존재하면 스킵
      if (checkResult.count > 0) {
        duplicateCount++;
        continue;
      }
      
      // 새 직원 저장 쿼리
      const insertQuery = `
        INSERT INTO TB_CARD_BATCH_SAV (
          M_NO,
          CARD_TYPE,
          CREATE_ID,
          CREATE_DT
        ) VALUES (
          :employeeNo,
          :cardType,
          :adminNo,
          NOW()
        )
      `;
      
      await sequelize.query(insertQuery, {
        replacements: {
          employeeNo: employee.m_no,
          cardType: employee.saved_card_type || 'R',
          adminNo: adminNo
        },
        type: QueryTypes.INSERT,
        transaction
      });
      
      savedCount++;
    }
    
    await transaction.commit();
    
    return {
      savedCount,
      duplicateCount,
      totalProcessed: employees.length
    };
    
  } catch (error) {
    await transaction.rollback();
    console.error('배치 저장 중 DB 오류:', error);
    throw new Error('데이터베이스 오류가 발생했습니다.');
  }
};

const deleteBatchEmployee = async (employeeId, createId) => {
  try {
    // 권한 확인: 자신이 저장한 것만 삭제 가능
    const deleteQuery = `
      DELETE FROM TB_CARD_BATCH_SAV 
      WHERE M_NO = :employeeId 
        AND CREATE_ID = :createId
    `
    
    // raw: false 옵션 추가하여 메타데이터 포함
    await sequelize.query(deleteQuery, {
      replacements: { 
        employeeId,
        createId 
      },
      type: QueryTypes.DELETE,
    })
    
    // result[1]에 영향받은 행 수가 있을 수 있음
    const affected = 1;

    return {
      affected: affected
    }
    
  } catch (error) {
    console.error('Batch employee 삭제 오류:', error)
    throw error
  }
};

const updateCardType = async (employeeId, cardType, createId) => {
  try {
    // 현재 값 확인
    const checkQuery = `
      SELECT CARD_TYPE 
      FROM TB_CARD_BATCH_SAV 
      WHERE M_NO = :employeeId AND CREATE_ID = :createId
    `;
    
    const [current] = await sequelize.query(checkQuery, {
      replacements: { employeeId, createId },
      type: QueryTypes.SELECT,
    });
    
    if (!current) {
      return null; // 레코드 없음
    }
    
    if (current.CARD_TYPE === cardType) {
      // 이미 같은 값이면 성공으로 처리
      return {
        employeeId,
        cardType,
        affectedRows: 1, // 논리적으로 성공
        message: '이미 동일한 값입니다.'
      };
    }
    
    // 실제 업데이트 수행
    const updateQuery = `
      UPDATE TB_CARD_BATCH_SAV 
      SET CARD_TYPE = :cardType
      WHERE M_NO = :employeeId AND CREATE_ID = :createId
    `;
    
    const result = await sequelize.query(updateQuery, {
      replacements: { employeeId, cardType, createId },
      type: QueryTypes.UPDATE,
    });

    return {
      employeeId,
      cardType,
      affectedRows: result[1] || 1
    };
    
  } catch (error) {
    throw error;
  }
};

const saveEmployeesFromExcel = async (employeeIds, cardType, createId) => {
  const transaction = await sequelize.transaction()
  
  try {
    // 중복 제거
    // const uniqueIds = [...new Set(employeeIds)]
    
    // 이미 존재하는 사번 확인
    const checkQuery = `
      SELECT M_NO 
      FROM TB_CARD_BATCH_SAV 
      WHERE M_NO IN (:employeeIds)
        AND CREATE_ID = :createId
    `
    
    const existingRecords = await sequelize.query(checkQuery, {
      replacements: { 
        employeeIds: employeeIds,
        createId 
      },
      type: QueryTypes.SELECT,
      transaction
    })
    
    const existingIds = existingRecords.map(record => record.M_NO)
    
    // 새로 추가할 사번들
    const newIds = employeeIds.filter(id => !existingIds.includes(id))
    
    console.log(`전체: ${employeeIds.length}, 기존: ${existingIds.length}, 신규: ${newIds.length}`)

    console.log(existingIds);
    console.log(newIds);
    
    
    // 새 사번들 저장
    const savedEmployees = []
    
    for (const employeeId of newIds) {

      const memberCnt = `
        select 
          count(*) AS cnt
        from 
          TB_MEMBER
        where 
          m_no = :employeeId
      `
    
      const memberCntResult = await sequelize.query(memberCnt, {
        replacements: { employeeId },
        type: QueryTypes.SELECT
      });

      const count = memberCntResult[0]?.cnt || 0;
      
      
      if(count > 0) {

        const insertQuery = `
          INSERT INTO TB_CARD_BATCH_SAV (M_NO, CARD_TYPE, CREATE_ID, CREATE_DT)
          VALUES (:mNo, :cardType, :createId, NOW()) 
        `
        
        await sequelize.query(insertQuery, {
          replacements: {
            mNo: employeeId,
            cardType,
            createId
          },
          type: QueryTypes.INSERT,
          transaction
        })
        
        savedEmployees.push(employeeId)
      
      }else {
        existingIds.push(employeeId)
      }
      
     
    }

    await transaction.commit()
    
    return {
      savedCount: savedEmployees.length,
      skippedCount: existingIds.length,
      savedEmployees: savedEmployees,
      skippedEmployees: existingIds
    }
    
  } catch (error) {
    await transaction.rollback()
    console.error('엑셀 데이터 저장 오류:', error)
    throw error
  }
}

module.exports = {
  selectSavedBatchList,
  saveBatchEmployees,
  deleteBatchEmployee,
  updateCardType,
  saveEmployeesFromExcel
}