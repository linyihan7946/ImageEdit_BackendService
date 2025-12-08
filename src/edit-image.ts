import { Request, Response, Express } from 'express';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { EditRecordModel } from './models';
import { cosUploader } from './cos-upload';
import { base64ToImage, getImageMimeTypeFromUrl, imageUrlToBase64, imageUrlToBase64Simple } from './image-utils';
import { authMiddleware } from './wechat-auth';

// 从环境变量中读取API端点配置
const API_ENDPOINT = process.env.API_ENDPOINT as string || '';
const API_EDITIMAGE_NEW = process.env.API_EDITIMAGE_NEW as string || '';
const API_GEMINI_PRO_IMAGE = process.env.API_GEMINI_PRO_IMAGE as string || '';

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

      const base64ImageData = await imageUrlToBase64Simple(imageUrls[0]);
      console.log('base64ImageData:', base64ImageData);
      
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
      const candidates: any[] = data.candidates || [];
      
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        const content = candidate.content || '';
        if (!content) continue;
        const parts: any[] = content.parts || [];
        if (!parts || parts.length === 0) continue;
        const part = parts[0];
        const inlineData = part.inlineData;
        if (!inlineData) {
          continue;
        }
        const data = inlineData.data || '';
        if (!data) {
          continue;
        }
        const base64 = data;
        const imageUrl = await cosUploader.uploadBase64(base64, '.png', {
          contentType: 'image/png'
        });
        images.push(imageUrl);
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
 * Gemini 3 Pro图片生成接口：支持多张图片合成
 * @param app 
 */
export function setupGeminiImageGenerateRoute(app: Express): void {
  // Gemini 3 Pro图片生成接口 - 支持多张图片合成
  app.post('/gemini-image-generate', authMiddleware(), async (req: Request, res: Response) => {
    console.log('收到Gemini 3 Pro图片生成请求');
    const API_KEY = process.env.API_KEY || '';
    
    const req1: any = req;
    const userId = req1.user?.userId || 0;
    try {
      // 从请求体中获取参数
      const { prompt, imageUrls, aspectRatio = '16:9', imageSize = '2K' } = req.body;
      
      if (!prompt) {
        return res.status(400).json({ 
          success: false, 
          message: '缺少图片生成提示词' 
        });
      }
      
      if (!imageUrls || imageUrls.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: '缺少图片数据' 
        });
      }

      // 设置超时时间映射，与Python代码保持一致
      const TIMEOUT_MAP: { [key: string]: number } = { "1K": 180, "2K": 300, "4K": 360 };
      const timeout = TIMEOUT_MAP[imageSize] || 300; // 默认5分钟超时

      // 准备parts数组，包含所有图片和文本提示
      const parts: any[] = [];
      
      // 处理每张图片，转换为base64格式
      console.log(`📤 正在读取 ${imageUrls.length} 张图片...`);
      for (let i = 0; i < imageUrls.length; i++) {
        const imageUrl = imageUrls[i];
        const mime_type = getImageMimeTypeFromUrl(imageUrl);
        const base64ImageData = await imageUrlToBase64Simple(imageUrl);
        
        parts.push({
          "inline_data": {
            "mime_type": mime_type,
            "data": base64ImageData
          }
        });
        console.log(`✅ 图片 ${i + 1} (${mime_type})`);
      }
      
      // 添加编辑指令
      parts.push({"text": prompt});
      
      // 构建请求体，与Python示例保持一致
      const requestBody = {
        "contents": [{"parts": parts}],
        "generationConfig": {
          "responseModalities": ["IMAGE"],
          "imageConfig": {
            "aspectRatio": aspectRatio,
            "imageSize": imageSize
          }
        }
      };
      
      console.log(`⏳ 正在处理，预计 ${timeout / 60} 分钟...`);
      const startTime = Date.now();
      console.log('转发到Gemini API的请求体:', JSON.stringify(requestBody, null, 2));
      
      // 发送请求到Gemini API，使用动态超时时间
      const response = await axios.post(API_GEMINI_PRO_IMAGE, requestBody, {
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: timeout * 1000 // 转换为毫秒
      });
      
      const elapsed = (Date.now() - startTime) / 1000;
      console.log(`⏱️  实际用时: ${elapsed.toFixed(1)} 秒`);
      
      // 处理API响应
      const data = response.data;
      const images: string[] = [];
      
      if (data.candidates && data.candidates.length > 0) {
        // 获取生成的图片数据
        const img_data = data.candidates[0].content.parts[0].inlineData.data;
        
        // 生成文件名，与Python代码保持一致
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const fileName = `edited_${timestamp}.png`;
        
        // 将生成的图片上传到COS
        const imageUrl = await cosUploader.uploadBase64(img_data, '.png', {
          contentType: 'image/png'
        });
        
        images.push(imageUrl);
        console.log(`✅ 编辑成功！已保存至: ${imageUrl}`);
      }
      
      console.log("生成的图片URLs:", images);
      
      // 记录操作到数据库
      try {
        // 创建编辑记录
        const recordId = await EditRecordModel.create({
          user_id: userId,
          prompt: prompt,
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
      
      res.json({
        success: true,
        message: 'Gemini图片生成请求处理成功',
        data: {images}
      });
      
    } catch (error: any) {
        console.error('Gemini图片生成请求失败:', error.message || error);
        
        // 获取安全的prompt和imageUrls值
        const safePrompt = req.body?.prompt || '';
        const safeImageUrls = req.body?.imageUrls || [];
        
        // 记录失败操作到数据库
        try {
          // 创建失败的编辑记录
          await EditRecordModel.create({
            user_id: userId,
            prompt: safePrompt,
            input_images: JSON.stringify(safeImageUrls),
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
          message: 'Gemini API调用失败',
          error: error.response.data || error.message
        });
      } else if (error.request) {
        // 请求已发送但没有收到响应
        res.status(504).json({
          success: false,
          message: 'Gemini API请求超时或无响应',
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