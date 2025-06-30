const { Sequelize } = require("sequelize");
const logger = require("../utils/logger");

// 数据库连接配置
const sequelize = new Sequelize({
  dialect: "mysql",
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME || "wechat_miniprogram",
  username: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  timezone: "+08:00",
  dialectOptions: {
    charset: "utf8mb4",
    dateStrings: true,
    typeCast: true,
  },
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  logging: (msg) => logger.debug(msg),
  define: {
    timestamps: true,
    underscored: true,
    freezeTableName: true,
  },
});

// 连接数据库
async function connectDB() {
  try {
    await sequelize.authenticate();
    logger.info("数据库连接已建立");

    // 同步数据库表结构
    if (process.env.NODE_ENV === "development") {
      await sequelize.sync({ alter: true });
      logger.info("数据库表结构同步完成");
    }
  } catch (error) {
    logger.error("数据库连接失败:", error);
    throw error;
  }
}

// 关闭数据库连接
async function closeDB() {
  try {
    await sequelize.close();
    logger.info("数据库连接已关闭");
  } catch (error) {
    logger.error("关闭数据库连接失败:", error);
  }
}

module.exports = {
  sequelize,
  connectDB,
  closeDB,
};
