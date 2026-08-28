import { execSync } from 'node:child_process';

/**
 * 取文件最后一次提交的时间(ISO 8601),用于 tracker 详情页"最后修改"。
 * 依赖 git 历史;在无 git 历史的环境(如浅克隆 CI)返回 null,由调用方降级隐藏。
 */
export function getGitLastModified(relPathFromRepoRoot: string): string | null {
	try {
		const out = execSync(
			`git log -1 --format=%cI -- ${JSON.stringify(relPathFromRepoRoot)}`,
			{ cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] },
		)
			.toString()
			.trim();
		return out || null;
	} catch {
		return null;
	}
}

export function formatDateTime(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}