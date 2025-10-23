import express, { Request, Response } from 'express';

// 创建Express应用实例
const app = express();
const PORT = process.env.PORT || 3000;

// 中间件设置
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 简单的路由示例
app.get('/', (req: Request, res: Response) => {
  console.log('收到GET请求');
  res.json({ message: 'Hello World! 这是一个Node.js + Express + TypeScript项目' });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`服务器正在运行，访问地址: http://localhost:${PORT}`);
});