# 使用Node.js官方镜像作为基础镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制package.json和package-lock.json（如果存在）
COPY package*.json ./

# 安装依赖（开发和生产）
RUN npm ci

# 复制源代码
COPY . .

# 编译TypeScript
RUN npm run build

# 保留所有依赖（开发和生产）

# 创建必要的目录
RUN mkdir -p /app/images && mkdir -p /app/temp

# 从示例文件创建.env文件（如果不存在）
RUN if [ ! -f .env ]; then cp .env.example .env; fi

# 设置环境变量
# 注意：开发依赖已保留，如需开发模式可将NODE_ENV设置为development
ENV NODE_ENV production

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["npm", "start"]