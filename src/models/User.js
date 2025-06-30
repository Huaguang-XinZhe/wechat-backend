const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    openid: {
      type: DataTypes.STRING(100),
      unique: true,
      allowNull: false,
      comment: "微信用户唯一标识",
    },
    unionid: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: "微信开放平台唯一标识",
    },
    session_key: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: "微信会话密钥",
    },
    nickname: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: "用户昵称",
    },
    avatar_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "用户头像地址",
    },
    gender: {
      type: DataTypes.TINYINT,
      allowNull: true,
      defaultValue: 0,
      comment: "性别：0-未知，1-男，2-女",
    },
    country: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: "国家",
    },
    province: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: "省份",
    },
    city: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: "城市",
    },
    language: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "语言",
    },
    last_login_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "最后登录时间",
    },
    login_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: "登录次数",
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: "是否激活",
    },
  },
  {
    tableName: "users",
    comment: "用户表",
    indexes: [
      {
        unique: true,
        fields: ["openid"],
      },
      {
        fields: ["unionid"],
      },
      {
        fields: ["last_login_at"],
      },
    ],
  }
);

// 实例方法
User.prototype.toJSON = function () {
  const values = Object.assign({}, this.get());
  // 隐藏敏感字段
  delete values.session_key;
  return values;
};

// 类方法
User.findByOpenid = function (openid) {
  return this.findOne({ where: { openid } });
};

User.updateLoginInfo = async function (openid) {
  return this.update(
    {
      last_login_at: new Date(),
      login_count: sequelize.literal("login_count + 1"),
    },
    { where: { openid } }
  );
};

module.exports = User;
