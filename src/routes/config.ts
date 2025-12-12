import { Router } from 'express';
import { Configure } from '../configure';

const router = Router();

// 配置信息接口
router.get('/config', (req, res) => {
  try {
    const config = {
      dishIngredientReferenceImage: process.env.DISH_INGREDIENT_REFERENCE_IMAGE || '',// 菜品用料图参考图
      freeEditCount: Configure.freeEditCount, // 免费编辑次数
    };

    res.json({
      success: true,
      message: '获取配置信息成功',
      data: config
    });
  } catch (error) {
    console.error('获取配置信息失败:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : '获取配置信息失败'
    });
  }
});

export default router;