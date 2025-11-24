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

# 创建环境变量文件（默认值）
RUN echo "PORT=3000" > .env && \
    echo "API_ENDPOINT=https://api.apiyi.com/v1/chat/completions" >> .env && \
    echo "API_EDITIMAGE_NEW=https://api.apiyi.com/v1beta/models/gemini-2.5-flash-image:generateContent" >> .env && \
    echo "API_KEY=your_api_key_here" >> .env && \
    echo "WECHAT_APPID=your_wechat_appid" >> .env && \
    echo "WECHAT_SECRET=your_wechat_secret" >> .env && \
    echo "DB_HOST=mysql" >> .env && \
    echo "DB_PORT=3306" >> .env && \
    echo "DB_USER=root" >> .env && \
    echo "DB_PASSWORD=password" >> .env && \
    echo "DB_NAME=image_edit" >> .env && \
    echo "COS_SECRET_ID=your_cos_secret_id" >> .env && \
    echo "COS_SECRET_KEY=your_cos_secret_key" >> .env && \
    echo "COS_REGION=ap-guangzhou" >> .env && \
    echo "COS_BUCKET=your_bucket_name" >> .env

# 创建必要的目录
RUN mkdir -p /app/images && mkdir -p /app/temp

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["npm", "start"]