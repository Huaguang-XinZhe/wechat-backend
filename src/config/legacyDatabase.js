const { Sequelize } = require("sequelize");

// 从环境变量获取老系统数据库配置
const legacySequelize = new Sequelize(
  process.env.LEGACY_DB_NAME || "mall",
  process.env.LEGACY_DB_USER || "root",
  process.env.LEGACY_DB_PASSWORD || "",
  {
    host: process.env.LEGACY_DB_HOST || "localhost",
    port: process.env.LEGACY_DB_PORT || 3306,
    dialect: "mysql",
    logging: process.env.NODE_ENV === "development" ? console.log : false,
    timezone: "+08:00",
    dialectOptions: {
      dateStrings: true,
      typeCast: true,
    },
    define: {
      // 解决中文编码问题
      charset: "utf8mb4",
      collate: "utf8mb4_unicode_ci",
    },
  }
);

// 测试连接函数
async function testLegacyConnection() {
  try {
    await legacySequelize.authenticate();
    console.log("老系统数据库连接成功");
    return true;
  } catch (error) {
    console.error("老系统数据库连接失败:", error);
    return false;
  }
}

module.exports = {
  legacySequelize,
  testLegacyConnection,
};
