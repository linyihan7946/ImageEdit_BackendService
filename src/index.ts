// 首先加载环境变量
import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import { wechatLogin, authMiddleware } from './wechat-auth';
import { WechatLoginParams } from './wechat-auth';
import { setupEditImageRoute, setupEditImageNewRoute } from './edit-image';
import { setupCosAuthRoute } from './cos-auth';
import { EditRecordModel } from './models';
import bodyParser from 'body-parser';
// const bodyParser = require('body-parser');



// 创建Express应用实例
const app = express();
// 从环境变量中读取端口配置
const PORT = process.env.PORT || 3000;

// 中间件设置
// 只使用bodyParser来处理请求体，避免重复解析导致stream is not readable错误
// 增加请求体大小限制到100MB
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));

// 移除了express.json和express.urlencoded，避免与bodyParser冲突

// 微信登录路由
app.post('/api/wechat/login', async (req: Request, res: Response) => {
  try {
    const params: WechatLoginParams = req.body;
    
    // 参数验证
    if (!params.code) {
      return res.status(400).json({ success: false, message: '缺少必要参数code' });
    }
    
    // 调用微信登录逻辑
    const result = await wechatLogin(params);
    
    if (result.success) {
      return res.json(result);
    } else {
      return res.status(401).json(result);
    }
  } catch (error) {
    console.error('微信登录接口错误:', error);
    return res.status(500).json({ 
      success: false, 
      message: error instanceof Error ? error.message : '服务器内部错误' 
    });
  }
});

// 测试需要认证的路由
app.get('/api/user/info', authMiddleware(), (req: Request, res: Response) => {
  // @ts-ignore
  const userInfo = req.user;
  return res.json({
    success: true,
    message: '已成功认证',
    user: userInfo
  });
});

// 接收图片链接的POST请求
app.post('/process-image', (req: Request, res: Response) => {
  console.log('收到处理图片的POST请求');
  
  // 从请求体中获取图片链接
  const { imageUrl } = req.body;
  
  // 验证参数
  if (!imageUrl) {
    return res.status(400).json({ 
      success: false, 
      message: '缺少必要参数: imageUrl' 
    });
  }
  
  // 验证URL格式（简单验证）
  try {
    new URL(imageUrl);
  } catch (error) {
    return res.status(400).json({ 
      success: false, 
      message: '无效的图片链接格式' 
    });
  }
  
  // 这里可以添加图片处理逻辑
  console.log('接收到的图片链接:', imageUrl);
  
  // 返回成功响应
  res.json({
    success: true,
    message: '图片链接接收成功',
    data: {
      imageUrl: imageUrl,
      timestamp: new Date().toISOString()
    }
  });
});

// 设置图片编辑路由
setupEditImageRoute(app);
setupEditImageNewRoute(app);

// 设置COS授权路由
setupCosAuthRoute(app);

// 获取用户今日使用次数
app.get('/api/user/today-usage', authMiddleware(), async (req: Request, res: Response) => {
  try {
    console.log(req);
    // @ts-ignore
    const userId = req.user?.userId || 0;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '用户未登录'
      });
    }
    
    // 获取用户今日编辑次数
    const todayCount = await EditRecordModel.getUserTodayCount(userId);
    
    res.json({
      success: true,
      data: {
        todayUsage: todayCount,
        maxFreeUsage: 3
      }
    });
  } catch (error) {
    console.error('获取用户今日使用次数失败:', error);
    res.status(500).json({
      success: false,
      message: '获取使用次数失败'
    });
  }
});

// 接收Base64图片并上传到COS的路由
app.post('/api/upload-base64-to-cos', async (req: Request, res: Response) => {
  try {
    const { 
      imageBase64: base64Data, 
      imageType: fileType = 'jpg',
      isChunk = false, 
      fileId,
      chunkIndex,
      totalChunks,
      merge = false
    } = req.body;
    
    // 记录请求参数信息（避免记录完整的base64数据）
    console.log('收到Base64数据请求，isChunk:', isChunk, 'merge:', merge);
    
    // 处理分块上传逻辑
    if (isChunk) {
      if (merge) {
          // 处理合并请求
          console.log(`收到合并请求，fileId: ${fileId}`);
          
          if (!fileId) {
            return res.status(400).json({
              success: false,
              message: '缺少fileId参数'
            });
          }
          
          try {
            // 导入必要的模块
            const { cosUploader } = require('./cos-upload');
            const { mkdirSync, readdirSync, readFileSync, unlinkSync, rmdirSync } = require('fs');
            const path = require('path');
            
            // 创建临时目录用于存储分块
            const tempDir = path.join(__dirname, '../temp', fileId);
            
            // 检查临时目录是否存在
            if (!require('fs').existsSync(tempDir)) {
              console.error(`临时目录不存在: ${tempDir}`);
              return res.status(404).json({
                success: false,
                message: '分块数据不存在，请重新上传'
              });
            }
            
            // 读取所有分块文件
            const chunkFiles = readdirSync(tempDir);
            if (chunkFiles.length === 0) {
              console.error('没有找到分块文件');
              return res.status(404).json({
                success: false,
                message: '没有找到分块文件'
              });
            }
            
            // 按索引排序分块文件
            chunkFiles.sort((a: string, b: string) => {
              const indexA = parseInt(a.split('_')[1]);
              const indexB = parseInt(b.split('_')[1]);
              return indexA - indexB;
            });
            
            // 合并所有分块数据
            const buffers: Buffer[] = [];
            for (const chunkFile of chunkFiles) {
              const chunkPath = path.join(tempDir, chunkFile);
              const chunkBuffer = readFileSync(chunkPath);
              buffers.push(chunkBuffer);
              
              // 删除已读取的分块文件
              unlinkSync(chunkPath);
            }
            
            // 合并所有Buffer
            const mergedBuffer = Buffer.concat(buffers);
            console.log(`分块合并完成，总大小: ${mergedBuffer.length} 字节`);
            
            // 删除临时目录
            rmdirSync(tempDir);
            
            // 生成文件名并上传到COS
            const fileName = `upload/chunk_merged_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileType}`;
            console.log('开始上传合并后的文件到COS:', fileName);
            
            // 调用cosUploader上传合并后的数据
              // 使用正确的参数格式调用现有的uploadBuffer方法
              const fileUrl = await cosUploader.uploadBuffer(
                mergedBuffer,
                fileName,
                { contentType: `image/${fileType}` }
              );
            
            console.log('合并文件上传到COS成功，URL:', fileUrl);
            
            // 返回成功结果
            res.json({
              success: true,
              message: '分块合并成功并上传到COS',
              data: {
                fileUrl: fileUrl,
                timestamp: new Date().toISOString(),
                fileSize: mergedBuffer.length,
                chunksCount: chunkFiles.length
              }
            });
          } catch (mergeError) {
            console.error('合并分块失败:', mergeError);
            res.status(500).json({
              success: false,
              message: `合并分块失败: ${mergeError instanceof Error ? mergeError.message : String(mergeError)}`
            });
          }
        } else {
        // 处理单个分块上传
        console.log(`收到分块 ${chunkIndex}/${totalChunks}，fileId: ${fileId}`);
        
        if (!fileId || chunkIndex === undefined || !totalChunks) {
          return res.status(400).json({
            success: false,
            message: '缺少分块上传必要参数'
          });
        }
        
        if (!base64Data) {
          return res.status(400).json({
            success: false,
            message: '缺少Base64数据'
          });
        }
        
        // 将Base64数据转换为Buffer
        const buffer = Buffer.from(base64Data, 'base64');
        console.log(`分块 ${chunkIndex} 转换后的Buffer大小:`, buffer.length);
        
        // 导入必要的模块
         const { mkdirSync, writeFileSync } = require('fs');
         const path = require('path');
         
         // 创建临时目录用于存储分块
         const tempDir = path.join(__dirname, '../temp', fileId);
         const { existsSync } = require('fs');
         if (!existsSync(tempDir)) {
           mkdirSync(tempDir, { recursive: true });
         }
         
         // 将分块保存到临时文件
         const chunkFilePath = path.join(tempDir, `chunk_${chunkIndex}.bin`);
         writeFileSync(chunkFilePath, buffer);
         console.log(`分块 ${chunkIndex} 已保存到: ${chunkFilePath}`);
         
         res.json({
          success: true,
          message: `分块 ${chunkIndex} 上传成功`,
          data: {
            chunkIndex,
            totalChunks,
            fileId
          }
        });
      }
    } else {
      // 处理单块上传逻辑
      console.log('收到Base64图片上传请求');
      
      // 参数验证
      if (!base64Data) {
        return res.status(400).json({
          success: false,
          message: '缺少必要参数: imageBase64'
        });
      }
      
      // 检查请求体大小（用于调试大文件）
      const requestSize = JSON.stringify(req.body).length;
      console.log(`请求体大小: ${(requestSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Base64字符串长度: ${base64Data.length}`);
      
      // 验证Base64格式
      if (!/^([A-Za-z0-9+/=]|data:image\/[^;]+;base64,)+$/.test(base64Data)) {
        return res.status(400).json({
          success: false,
          message: '无效的Base64字符串格式'
        });
      }
      
      // 处理大Base64数据
      // 对于超大Base64，建议使用分块上传
      if (base64Data.length > 10 * 1024 * 1024) { // 10MB
        console.warn('警告: 接收到超大Base64数据，建议使用分块上传');
      }
      
      // 导入cos-upload模块
      const { cosUploader } = require('./cos-upload');
      
      // 上传Base64到COS
      console.log('开始上传Base64数据到COS...');
      const fileUrl = await cosUploader.uploadBase64(
        base64Data,
        `.${fileType}`,
        {
          contentType: `image/${fileType}`,
          // 对于大数据，可以添加进度回调
          onProgress: (progressData: { loaded: number; total: number; speed: number }) => {
            const percent = ((progressData.loaded / progressData.total) * 100).toFixed(2);
            const speed = (progressData.speed / 1024).toFixed(2); // KB/s
            console.log(`上传进度: ${percent}%, 速度: ${speed} KB/s`);
          }
        }
      );
      
      console.log('Base64上传成功，生成的文件URL:', fileUrl);
      
      // 返回成功响应
      return res.json({
        success: true,
        message: 'Base64图片上传到COS成功',
        data: {
          fileUrl: fileUrl,
          timestamp: new Date().toISOString(),
          base64Length: base64Data.length
        }
      });
    }
  } catch (error) {
    console.error('Base64图片上传到COS失败:', error);
    
    // 处理不同类型的错误
    if (error instanceof Error) {
      if (error.message.includes('Base64')) {
        return res.status(400).json({
          success: false,
          message: `Base64处理失败: ${error.message}`
        });
      } else if (error.message.includes('COS')) {
        return res.status(500).json({
          success: false,
          message: `COS上传失败: ${error.message}`
        });
      }
    }
    
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : '服务器内部错误',
      error: error
    });
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`服务器正在运行，访问地址: http://localhost:${PORT}`);
});


// base64ToImage函数已移至edit-image.ts中