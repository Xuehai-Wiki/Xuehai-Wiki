// 学海 Status API 数据结构 (https://xh.asxz.one/status/api/v1/)
export interface HistoryPoint {
	time: string; // "YYYY-MM-DD HH:mm:ss"
	status: 0 | 1;
}

export interface SlaPoint {
	date: string; // "YYYY-MM-DD"
	sla: number; // 0-100
}

export interface StatusData {
	history_24h: Record<string, HistoryPoint[]>;
	sla_60d: Record<string, SlaPoint[]>;
	server_time: string;
}