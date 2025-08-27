const { Sequelize } = require('sequelize')
require('dotenv').config()

// Sequelize 인스턴스 생성
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'mysql',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true,
    },
  }
)

// 데이터베이스 연결 테스트 함수
const connectDB = async () => {
  try {
    await sequelize.authenticate()
    console.log('✅ MariaDB 연결 성공')

    // 개발 환경에서만 테이블 동기화
    if (process.env.NODE_ENV === 'development') {
      await sequelize.sync({ alter: true })
      console.log('✅ 데이터베이스 동기화 완료')
    }
  } catch (error) {
    console.error('❌ MariaDB 연결 실패:', error.message)
    process.exit(1)
  }
}

module.exports = { sequelize, connectDB }
