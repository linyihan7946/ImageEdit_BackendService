import { Request, Response, Express } from 'express';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { EditRecordModel } from './models';
import { cosUploader } from './cos-upload';
import { base64ToImage, getImageMimeTypeFromUrl, imageUrlToBase64 } from './image-utils';
import { authMiddleware } from './wechat-auth';

// 从环境变量中读取API端点配置
const API_ENDPOINT = process.env.API_ENDPOINT || 'https://api.apiyi.com/v1/chat/completions';
const API_EDITIMAGE_NEW = process.env.API_EDITIMAGE_NEW || 'https://api.apiyi.com/v1beta/models/gemini-2.5-flash-image:generateContent';

// 确保图片保存目录存在
const IMAGES_DIR = path.join(__dirname, '../images');
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  console.log(`创建图片保存目录: ${IMAGES_DIR}`);
}


/**
 * 新的编辑图片的接口：指定长宽比
 * @param app 
 */
export function setupEditImageNewRoute(app: Express): void {
  // 新的图片编辑接口 - 支持contents格式
  app.post('/edit-image-new', authMiddleware(), async (req: Request, res: Response) => {
    console.log('收到新格式图片编辑请求');
    const API_KEY = process.env.API_KEY || '';
    
    const req1: any = req;
    const userId = req1.user?.userId || 0;
    try {
      // 从请求体中获取参数
      // mime_type:  "image/jpeg"
      // aspectRatio: "16:9"
      const { instruction, aspectRatio, imageUrls } = req.body;
      
      if (!instruction) {
        return res.status(400).json({ 
          success: false, 
          message: '缺少编辑指令文本' 
        });
      }
      
      if (!imageUrls || imageUrls.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: '缺少图片数据' 
        });
      }

      if (!aspectRatio) {
        return res.status(400).json({ 
          success: false, 
          message: '缺少长宽比' 
        });
      }
      const mime_type = getImageMimeTypeFromUrl(imageUrls[0]);

      const base64ImageData = imageUrlToBase64(imageUrls[0]);
      
      // 构建转发请求体（转换为原有API所需格式）
      const requestBody = {
        "contents": [
          {
            "parts": [
              {
                "text": instruction
              },
              {
                "inline_data": {
                  mime_type,
                  "data": base64ImageData
                }
              }
            ]
          }
        ],
        "generationConfig": {
          "responseModalities": ["IMAGE"],
          "imageConfig": {
            aspectRatio
          }
        }
      };
      
      console.log('转发到API的请求体:', JSON.stringify(requestBody, null, 2));
      
      // 发送请求到目标API
      const response = await axios.post(API_EDITIMAGE_NEW, requestBody, {
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      
      // 处理响应
      const images: string[] = [];
      const data = response.data;
      const choices: any[] = data.choices || [];
      
      for (let i = 0; i < choices.length; i++) {
        const choice = choices[i];
        const message = choice.message;
        if (!message) continue;
        
        const content: string = message.content;
        const first = content.indexOf("(");
        const last = content.indexOf(")");
        
        if (first !== -1 && last !== -1) {
          const base64 = content.substring(first + 1, last);
          const imageUrl = await cosUploader.uploadBase64(base64, '.png', {
            contentType: 'image/png'
          });
          images.push(imageUrl);
        }
      }
      
      console.log("生成的图片URLs:", images);
      
      // 记录操作到数据库
      try {
        // 创建编辑记录
        const recordId = await EditRecordModel.create({
          user_id: userId,
          prompt: instruction,
          input_images: JSON.stringify([{ type: 'base64_image' }]),
          output_image: JSON.stringify(images),
          status: 1, // 1表示成功
          cost: 0 // 可以根据实际情况设置成本
        });
        
        console.log(`操作已成功记录到数据库，记录ID: ${recordId}`);
      } catch (dbError) {
        console.error('记录操作到数据库失败:', dbError);
        // 数据库错误不影响API响应返回
      }
      
      res.json({
        success: true,
        message: '图片编辑请求处理成功',
        data: {images}
      });
      
    } catch (error: any) {
      console.error('新格式图片编辑请求失败:', error.message || error);
      
      // 记录失败操作到数据库
      try {
        // 创建失败的编辑记录
        await EditRecordModel.create({
          user_id: userId,
          prompt: req.body.contents?.[0]?.parts?.find((p: any) => p.text)?.text || '',
          input_images: JSON.stringify([{ type: 'base64_image' }]),
          status: 2, // 2表示失败
          cost: 0
        });
        
        console.log('失败操作已记录到数据库');
      } catch (dbError) {
        console.error('记录失败操作到数据库失败:', dbError);
      }
      
      // 处理错误响应
      if (error.response) {
        // 服务器返回了错误状态码
        res.status(error.response.status || 500).json({
          success: false,
          message: 'API调用失败',
          error: error.response.data || error.message
        });
      } else if (error.request) {
        // 请求已发送但没有收到响应
        res.status(504).json({
          success: false,
          message: 'API请求超时或无响应',
          error: 'Network Error'
        });
      } else {
        // 其他错误
        res.status(500).json({
          success: false,
          message: '服务器内部错误',
          error: error.message || 'Unknown Error'
        });
      }
    }
  });
}

/**
 * 设置图片编辑路由
 * @param app Express应用实例
 */
export function setupEditImageRoute(app: Express): void {
  // 图片编辑接口转发
  app.post('/edit-image', authMiddleware(), async (req: Request, res: Response) => {
    console.log('收到图片编辑请求');
    const API_KEY = process.env.API_KEY || '';
    
    const req1: any = req;
    const userId = req1.user?.userId || 0;
    try {
      // 从请求体中获取参数
      const { instruction, imageUrls } = req.body;
      
      // 验证必要参数
      if (!instruction) {
        return res.status(400).json({ 
          success: false, 
          message: '缺少必要参数: instruction' 
        });
      }
      
      if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: '缺少必要参数: imageUrls（必须是非空数组）' 
        });
      }
      
      // 验证所有图片URL格式
      for (const url of imageUrls) {
        try {
          new URL(url);
        } catch (error) {
          return res.status(400).json({ 
            success: false, 
            message: `无效的图片链接格式: ${url}` 
          });
        }
      }
      
      // 构建转发请求体
      const requestBody = {
        model: 'gemini-2.5-flash-image',
        stream: false,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: instruction
              },
              ...imageUrls.map(url => ({
                type: 'image_url',
                image_url: {
                  url: url
                }
              }))
            ]
          }
        ]
      };
      
      console.log('转发到API的请求体:', JSON.stringify(requestBody, null, 2));
      
      // 发送请求到目标API
      const response = await axios.post(API_ENDPOINT, requestBody, {
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      const result: any = {};

      // 保存API响应到本地文件
      const timestamp = Date.now();
      const data = response.data;
      const choices: any[] = data.choices;
      const images: string[] = [];
      for (let i = 0; i < choices.length; i++) {
        const choice = choices[i];
        const message = choice.message;
        if (!message) {
          continue;
        }
        const content: string = message.content;
        const first = content.indexOf("(");
        const last = content.indexOf(")");
        if (first === -1 || last === -1) {
          continue;
        }
        const base64 = content.substring(first + 1, last);
        const imageUrl = await cosUploader.uploadBase64(base64, '.png', {
          contentType: 'image/png'
        });
        images.push(imageUrl);
      }
      console.log("images:", images);
      
      // 记录操作到数据库
      try {
        // 创建编辑记录
        const recordId = await EditRecordModel.create({
          user_id: userId,
          prompt: instruction,
          input_images: JSON.stringify(imageUrls),
          output_image: JSON.stringify(images),
          status: 1, // 1表示成功
          cost: 0 // 可以根据实际情况设置成本
        });
        
        console.log(`操作已成功记录到数据库，记录ID: ${recordId}`);
      } catch (dbError) {
        console.error('记录操作到数据库失败:', dbError);
        // 数据库错误不影响API响应返回
      }
      
      // 返回API响应
      res.json({
        success: true,
        message: '图片编辑请求处理成功',
        data: {images}// response.data
      });
      
    } catch (error: any) {
      console.error('图片编辑请求失败:', error.message || error);
      
      // 记录失败操作到数据库
      try { 
        // 创建失败的编辑记录
        await EditRecordModel.create({
          user_id: userId,
          prompt: req.body.instruction || '',
          input_images: JSON.stringify(req.body.imageUrls || []),
          status: 2, // 2表示失败
          cost: 0
        });
        
        console.log('失败操作已记录到数据库');
      } catch (dbError) {
        console.error('记录失败操作到数据库失败:', dbError);
      }
      
      // 处理错误响应
      if (error.response) {
        // 服务器返回了错误状态码
        res.status(error.response.status || 500).json({
          success: false,
          message: 'API调用失败',
          error: error.response.data || error.message
        });
      } else if (error.request) {
        // 请求已发送但没有收到响应
        res.status(504).json({
          success: false,
          message: 'API请求超时或无响应',
          error: 'Network Error'
        });
      } else {
        // 其他错误
        res.status(500).json({
          success: false,
          message: '服务器内部错误',
          error: error.message || 'Unknown Error'
        });
      }
    }
  });
}