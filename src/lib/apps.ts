import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface RawAppVersion {
	versionCode: number;
	versionName?: string;
	url?: string;
	md5?: string;
	packageSize?: number;
	createTime?: number;
	updateTime?: number;
	auditTime?: number;
	description?: string;
	releaseSummary?: string;
	releaseNote?: string;
	plistUrl?: string;
	status?: number;
	updateLevel?: number;
	versionType?: number;
	remindEnabled?: boolean;
	noteRead?: boolean;
}

interface RawApp {
	appId: string;
	appCode: string;
	packageName: string;
	name: string;
	platform: string;
	userType: number;
	installPosition: number;
	network: number;
	icon?: string;
	beautifyIcon?: string;
	description?: string;
	appVersions: RawAppVersion[];
	createTime?: number;
	updateTime?: number;
	show?: boolean;
	outside?: boolean;
	independent?: boolean;
	order?: number;
	orderV2?: number;
	programType?: number;
	envs?: string[];
	displaySize?: number;
}

export interface AppVersion extends RawAppVersion {
	versionLabel: string;
	descriptionText: string;
	sizeText: string;
	createDateText: string;
	updateDateText: string;
	auditDateText: string;
}

export interface AppCategory {
	key: string;
	label: string;
	order: number;
}

export interface AppRole {
	label: string;
	cls: 'student' | 'teacher' | 'other' | 'common';
}

export interface App extends Omit<RawApp, 'appVersions'> {
	role: AppRole;
	category: AppCategory;
	latest: AppVersion | null;
	sizeText: string;
	dateText: string;
	downloadUrl: string;
	iconOk: boolean;
	detailUrl: string;
	versions: AppVersion[];
	totalVersions: number;
}

const CATEGORIES: (AppCategory & { matcher: (code: string) => boolean })[] = [
	{ key: 'ai', label: 'AI 应用', matcher: (code) => code.startsWith('CA11'), order: 1 },
	{ key: 'system', label: '系统与办公', matcher: (code) => code.startsWith('CA00'), order: 2 },
	{ key: 'practice', label: '刷题与错题', matcher: (code) => code.startsWith('CA101'), order: 3 },
	{ key: 'teacher', label: '名师金课', matcher: (code) => code.startsWith('CA102'), order: 4 },
	{ key: 'homework', label: '作业与作文', matcher: (code) => code.startsWith('CA103'), order: 5 },
	{ key: 'classroom', label: '课堂与智能', matcher: (code) => code.startsWith('CA104'), order: 6 },
	{ key: 'read', label: '听说与阅读', matcher: (code) => code.startsWith('CA105'), order: 7 },
	{ key: 'launcher', label: '大厅与平台', matcher: (code) => code.startsWith('CA106'), order: 8 },
	{ key: 'tools', label: '学习工具', matcher: (code) => code.startsWith('CA107'), order: 9 },
	{ key: 'feedback', label: '反馈', matcher: (code) => code.startsWith('CA108'), order: 10 },
	{ key: 'train', label: '练习与训练', matcher: (code) => code.startsWith('CA20'), order: 11 },
	{ key: 'settings', label: '设置', matcher: (code) => code.startsWith('CB20'), order: 12 },
	{ key: 'subject', label: '学科强化练', matcher: (code) => code.startsWith('WBYY'), order: 13 },
	{ key: 'bai-fen', label: '百分·云教育', matcher: (code) => code.startsWith('LS00'), order: 14 },
	{ key: 'deep', label: '深度学习', matcher: (code) => code.startsWith('CAT0'), order: 15 },
	{ key: 'legacy', label: '经典旧版', matcher: (code) => /^\d{4}$/.test(code), order: 16 },
	{ key: 'other', label: '其他', matcher: () => true, order: 99 },
];

const ROLES: Record<number, AppRole> = {
	1: { label: '学生端', cls: 'student' },
	2: { label: '教师端', cls: 'teacher' },
	4: { label: '通用', cls: 'common' },
	3: { label: '其他', cls: 'other' },
};

function roleOf(userType: number): AppRole {
	return ROLES[userType] ?? { label: '通用', cls: 'common' };
}

function categoryOf(appCode: string): AppCategory {
	const category = CATEGORIES.find((item) => item.matcher(appCode));
	if (!category) throw new Error(`无法分类应用:${appCode}`);
	return category;
}

function formatSize(bytes?: number): string {
	if (!bytes) return '';
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(timestamp?: number): string {
	if (!timestamp) return '';
	return new Date(timestamp).toISOString().slice(0, 10);
}

function normalizeVersion(version: RawAppVersion): AppVersion {
	return {
		...version,
		versionLabel: version.versionName || `v${version.versionCode}`,
		descriptionText: version.description || '',
		sizeText: formatSize(version.packageSize),
		createDateText: formatDate(version.createTime),
		updateDateText: formatDate(version.updateTime),
		auditDateText: formatDate(version.auditTime),
	};
}

function normalizeApp(app: RawApp): App {
	const versions = app.appVersions
		.slice()
		.sort((left, right) => right.versionCode - left.versionCode)
		.map(normalizeVersion);
	const latest = versions[0] ?? null;

	return {
		...app,
		role: roleOf(app.userType),
		category: categoryOf(app.appCode),
		latest,
		sizeText: latest?.sizeText ?? '',
		dateText: formatDate(latest?.updateTime ?? app.updateTime),
		downloadUrl: latest?.url ?? '',
		iconOk: Boolean(app.icon) && !(app.icon ?? '').split('?')[0].toLowerCase().endsWith('.xml'),
		detailUrl: `/apps/${app.appId}/`,
		versions,
		totalVersions: versions.length,
	};
}

const rawApps = JSON.parse(
	readFileSync(resolve(process.cwd(), 'public/data/xuehai-apps.json'), 'utf8'),
) as RawApp[];

export const apps: App[] = rawApps
	.map(normalizeApp)
	.sort((left, right) => left.name.localeCompare(right.name, 'zh'));

export function appsByCategory(): { key: string; label: string; order: number; list: App[] }[] {
	const grouped = new Map<string, { key: string; label: string; order: number; list: App[] }>();
	for (const app of apps) {
		const group = grouped.get(app.category.key);
		if (group) {
			group.list.push(app);
		} else {
			grouped.set(app.category.key, {
				key: app.category.key,
				label: app.category.label,
				order: app.category.order,
				list: [app],
			});
		}
	}
	return [...grouped.values()].sort((left, right) => left.order - right.order);
}
