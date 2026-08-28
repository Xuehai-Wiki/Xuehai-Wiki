/**
 * 功能开关:计划中"现在不做、但代码要写在最终项目里"的能力。
 * 全部默认关闭;以后接入时填配置即可,页面渲染逻辑已就位。
 */
export const features = {
	/** 点赞按钮:CF Worker API 占位。enabled 时详情页展示按钮并请求 workerUrl。 */
	likes: {
		enabled: false,
		workerUrl: '', // 例如 https://xuehai-like.<account>.workers.dev
	},
	/** 评论:Twikoo。enabled 时详情页注入 twikoo 评论框。 */
	comments: {
		enabled: true,
		twikooEnvId: 'https://xuehai-wiki.netlify.app/.netlify/functions/twikoo',
	},
} as const;