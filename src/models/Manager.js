const { DataTypes } = require('sequelize')
const { sequelize } = require('../config/database')

/**
 * TB_MANAGER 테이블 모델
 * 관리자 계정 정보를 관리합니다.
 */
const Manager = sequelize.define(
  'Manager',
  {
    // MG_ID - 관리자 ID (Primary Key)
    MG_ID: {
      type: DataTypes.STRING(20),
      primaryKey: true,
      allowNull: false,
      comment: '관리자 ID',
    },

    // MG_NAME - 관리자 이름
    MG_NAME: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: '관리자 이름',
    },

    // MG_PASSWORD - 암호화된 비밀번호
    MG_PASSWORD: {
      type: DataTypes.STRING(128),
      allowNull: false,
      comment: '암호화된 비밀번호',
    },

    // MG_TYPE - 관리자 권한 타입
    MG_TYPE: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'manager',
      comment: '관리자 권한 타입 (master, manager, card 등)',
    },

    // M_NO - 관리자 번호 (Auto Increment 가능)
    M_NO: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: '관리자 번호',
    },
  },
  {
    // 테이블 설정
    tableName: 'TB_MANAGER',
    timestamps: false, // createdAt, updatedAt 컬럼 사용하지 않음
    underscored: false, // 컬럼명을 snake_case로 변환하지 않음
    freezeTableName: true, // 모델명을 그대로 테이블명으로 사용

    // 인덱스 설정
    indexes: [
      {
        unique: true,
        fields: ['MG_ID'],
      },
      {
        fields: ['MG_TYPE'],
      },
    ],
  }
)

/**
 * 관리자 권한 체크 메서드
 */
Manager.prototype.hasPermission = function (requiredType) {
  const hierarchy = {
    master: 3,
    manager: 2,
    card: 1,
  }

  return hierarchy[this.MG_TYPE] >= hierarchy[requiredType]
}

/**
 * 관리자 정보를 안전하게 반환 (비밀번호 제외)
 */
Manager.prototype.toSafeJSON = function () {
  const values = { ...this.dataValues }
  delete values.MG_PASSWORD
  return values
}

module.exports = Manager
