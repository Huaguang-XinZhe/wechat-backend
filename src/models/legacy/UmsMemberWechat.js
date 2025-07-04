const { DataTypes } = require("sequelize");
const { legacySequelize } = require("../../config/legacyDatabase");
const UmsMember = require("./UmsMember");

const UmsMemberWechat = legacySequelize.define(
  "UmsMemberWechat",
  {
    openid: {
      type: DataTypes.STRING(100),
      primaryKey: true,
      allowNull: false,
      comment: "微信用户唯一标识",
    },
    invite_code: {
      type: DataTypes.STRING(10),
      allowNull: true,
      comment: "用户邀请码",
    },
    invite_from: {
      type: DataTypes.STRING(10),
      allowNull: true,
      comment: "注册时使用的邀请码",
    },
  },
  {
    tableName: "ums_member_wechat",
    timestamps: false, // 不使用 Sequelize 的 createdAt 和 updatedAt
  }
);

module.exports = UmsMemberWechat;
