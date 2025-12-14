import { Request, Response, Router } from 'express';
import { EditRecordModel, UserModel } from '../models';
import { authMiddleware } from '../wechat-auth';

const router = Router();

/**
 * 获取用户今日使用次数
 * GET /api/user/today-usage
 */
router.get('/today-usage', authMiddleware(), async (req: Request, res: Response) => {
  try {
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

/**
 * 获取用户信息
 * GET /api/user/info
 */
router.get('/info', authMiddleware(), async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const userId = req.user?.userId || 0;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: '用户未登录' });
    }
    
    // 获取用户信息
    const userInfo = await UserModel.findById(userId);
    
    if (!userInfo) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
    // 返回用户信息（排除敏感字段）
    const { id, nickname, avatar_url, register_time, last_login_time, status } = userInfo;
    
    res.json({
      success: true,
      data: {
        userId: id,
        nickname,
        avatarUrl: avatar_url,
        registerTime: register_time,
        lastLoginTime: last_login_time,
        status
      }
    });
  } catch (error) {
    console.error('获取用户信息失败:', error);
    res.status(500).json({
      success: false,
      message: '获取用户信息失败'
    });
  }
});

export default router;