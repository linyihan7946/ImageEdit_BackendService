# 使用Node.js官方镜像作为基础镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制package.json和package-lock.json（如果存在）
COPY package*.json ./

# 安装生产依赖
RUN npm ci --only=production

# 安装开发依赖（用于编译TypeScript）
RUN npm install --only=dev

# 复制源代码
COPY . .

# 编译TypeScript
RUN npm run build

# 创建必要的目录
RUN mkdir -p /app/images && mkdir -p /app/temp

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["npm", "start"]