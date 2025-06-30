# 使用官方 Node.js 镜像作为基础镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 设置环境变量
ENV NODE_ENV=production
ENV TZ=Asia/Shanghai

# 安装 timezone 数据
RUN apk add --no-cache tzdata

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖（仅生产环境）
RUN npm ci --only=production && npm cache clean --force

# 复制应用代码
COPY src/ ./src/

# 创建日志目录
RUN mkdir -p logs

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs &&
    adduser -S nextjs -u 1001

# 更改文件权限
RUN chown -R nextjs:nodejs /app
USER nextjs

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "const http = require('http'); const options = {hostname: 'localhost', port: 3000, path: '/health', method: 'GET'}; const req = http.request(options, (res) => process.exit(res.statusCode === 200 ? 0 : 1)); req.on('error', () => process.exit(1)); req.end();"

# 启动应用
CMD ["npm", "start"]
