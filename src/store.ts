import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AppError } from './errors';
import { Rules, totalCandidateCount, validateRules } from './rules';
import { enumerateCandidates } from './enumerate';
import { Feedback } from './feedback';
import { filterCandidates } from './filter';

export interface RecordRow {
  seq: number;
  guess: number[];
  black: number;
  white: number;
}

export interface Analysis {
  id: number;
  colors: string[];
  slots: number;
  version: number;
  totalCandidates: number;
  remainingCandidates: number;
  records: RecordRow[];
  candidates: Int32Array[];
}

export interface AppendOutcome {
  accepted: boolean;
  beforeCount: number;
  afterCount: number;
  version: number;
  reason?: string;
}

export interface UndoOutcome {
  undone: RecordRow | null;
  beforeCount: number;
  afterCount: number;
  version: number;
}

const SCHEMA_VERSION = 1;

export class Store {
  private readonly db: DatabaseSync;
  private readonly maxCandidates: number;
  private readonly maxColors: number;

  constructor(dbPath: string, maxCandidates: number, maxColors: number = Number.MAX_SAFE_INTEGER) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.maxCandidates = maxCandidates;
    this.maxColors = maxColors;
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        colors_json TEXT NOT NULL,
        slots INTEGER NOT NULL,
        version INTEGER NOT NULL,
        total_candidates INTEGER NOT NULL,
        remaining_candidates INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS records (
        analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        guess_json TEXT NOT NULL,
        black INTEGER NOT NULL,
        white INTEGER NOT NULL,
        PRIMARY KEY (analysis_id, seq)
      );
    `);
    this.db
      .prepare('INSERT OR IGNORE INTO meta(key, value) VALUES(?, ?)')
      .run('schema_version', String(SCHEMA_VERSION));
  }

  private withTransaction<T>(body: (tx: {
    run: (sql: string, ...params: Array<number | string>) => void;
  }) => T): T {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = body({
        run: (sql: string, ...params: Array<number | string>) => {
          this.db.prepare(sql).run(...params);
        },
      });
      this.db.exec('COMMIT;');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  createAnalysis(rules: Rules): Analysis {
    validateRules(rules, this.maxColors, Number.MAX_SAFE_INTEGER);
    const candidates = enumerateCandidates(rules.colors.length, rules.slots, this.maxCandidates);
    const total = candidates.length;
    const info = this.db
      .prepare(
        `INSERT INTO analyses(colors_json, slots, version, total_candidates, remaining_candidates, created_at)
         VALUES(?, ?, 0, ?, ?, ?)`,
      )
      .run(JSON.stringify(rules.colors), rules.slots, total, total, new Date().toISOString());
    return {
      id: Number(info.lastInsertRowid),
      colors: rules.colors,
      slots: rules.slots,
      version: 0,
      totalCandidates: total,
      remainingCandidates: total,
      records: [],
      candidates,
    };
  }

  listAnalysisSummaries(): Array<{
    id: number;
    colors: string[];
    slots: number;
    version: number;
    totalCandidates: number;
    remainingCandidates: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT id, colors_json, slots, version, total_candidates, remaining_candidates
         FROM analyses ORDER BY id`,
      )
      .all() as unknown as Array<{
      id: number;
      colors_json: string;
      slots: number;
      version: number;
      total_candidates: number;
      remaining_candidates: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      colors: JSON.parse(row.colors_json) as string[],
      slots: row.slots,
      version: row.version,
      totalCandidates: row.total_candidates,
      remainingCandidates: row.remaining_candidates,
    }));
  }

  loadAnalysis(id: number): Analysis {
    const row = this.db
      .prepare(
        `SELECT id, colors_json, slots, version, total_candidates, remaining_candidates
         FROM analyses WHERE id = ?`,
      )
      .get(id) as
      | {
          id: number;
          colors_json: string;
          slots: number;
          version: number;
          total_candidates: number;
          remaining_candidates: number;
        }
      | undefined;
    if (!row) {
      throw new AppError('NOT_FOUND', `分析 ${id} 不存在`);
    }
    const colors = JSON.parse(row.colors_json) as string[];
    const recordRows = this.db
      .prepare(
        `SELECT seq, guess_json, black, white FROM records
         WHERE analysis_id = ? ORDER BY seq`,
      )
      .all(id) as unknown as Array<{
      seq: number;
      guess_json: string;
      black: number;
      white: number;
    }>;
    const records: RecordRow[] = recordRows.map((r) => ({
      seq: r.seq,
      guess: JSON.parse(r.guess_json) as number[],
      black: r.black,
      white: r.white,
    }));

    // 重启后按有效历史一次性重算完整候选集，保证与同一历史的新建分析完全一致。
    let candidates = enumerateCandidates(colors.length, row.slots, this.maxCandidates);
    for (const record of records) {
      candidates = filterCandidates(candidates, record.guess, record, colors.length);
    }
    if (candidates.length !== row.remaining_candidates) {
      throw new AppError(
        'INTERNAL',
        `分析 ${id} 的候选摘要与历史重算结果不一致（摘要 ${row.remaining_candidates}，重算 ${candidates.length}）`,
      );
    }
    const expectedTotal = totalCandidateCount(colors.length, row.slots);
    if (expectedTotal !== row.total_candidates) {
      throw new AppError('INTERNAL', `分析 ${id} 的总候选数摘要异常`);
    }
    return {
      id: row.id,
      colors,
      slots: row.slots,
      version: row.version,
      totalCandidates: row.total_candidates,
      remainingCandidates: row.remaining_candidates,
      records,
      candidates,
    };
  }

  /**
   * 原子追加：先在内存中过滤，若结果为空则拒绝，且不写入任何内容。
   * 接受时记录与候选摘要在同一事务内更新，失败整体回滚。
   */
  appendFeedback(
    id: number,
    guess: number[],
    feedback: Feedback,
  ): { analysis: Analysis; outcome: AppendOutcome } {
    const analysis = this.loadAnalysis(id);
    const beforeCount = analysis.candidates.length;
    const next = filterCandidates(analysis.candidates, guess, feedback, analysis.colors.length);
    if (next.length === 0) {
      return {
        analysis,
        outcome: {
          accepted: false,
          beforeCount,
          afterCount: 0,
          version: analysis.version,
          reason: '新反馈与规则或全部历史矛盾，过滤后候选为空，已拒绝且未修改历史',
        },
      };
    }
    const seq = analysis.records.length + 1;
    const nextVersion = analysis.version + 1;
    this.withTransaction((tx) => {
      tx.run(
        'INSERT INTO records(analysis_id, seq, guess_json, black, white) VALUES(?, ?, ?, ?, ?)',
        id,
        seq,
        JSON.stringify(guess),
        feedback.black,
        feedback.white,
      );
      tx.run(
        'UPDATE analyses SET version = ?, remaining_candidates = ? WHERE id = ?',
        nextVersion,
        next.length,
        id,
      );
    });
    analysis.records.push({ seq, guess, black: feedback.black, white: feedback.white });
    analysis.candidates = next;
    analysis.version = nextVersion;
    analysis.remainingCandidates = next.length;
    return {
      analysis,
      outcome: { accepted: true, beforeCount, afterCount: next.length, version: nextVersion },
    };
  }

  /** 原子撤销最后一条有效反馈，并按此前状态恢复候选。 */
  undoLast(id: number): { analysis: Analysis; outcome: UndoOutcome } {
    const analysis = this.loadAnalysis(id);
    const beforeCount = analysis.candidates.length;
    if (analysis.records.length === 0) {
      return {
        analysis,
        outcome: { undone: null, beforeCount, afterCount: beforeCount, version: analysis.version },
      };
    }
    const removed = analysis.records[analysis.records.length - 1];
    const remaining = analysis.records.slice(0, -1);
    let candidates = enumerateCandidates(analysis.colors.length, analysis.slots, this.maxCandidates);
    for (const record of remaining) {
      candidates = filterCandidates(candidates, record.guess, record, analysis.colors.length);
    }
    const nextVersion = analysis.version + 1;
    this.withTransaction((tx) => {
      tx.run('DELETE FROM records WHERE analysis_id = ? AND seq = ?', id, removed.seq);
      tx.run(
        'UPDATE analyses SET version = ?, remaining_candidates = ? WHERE id = ?',
        nextVersion,
        candidates.length,
        id,
      );
    });
    analysis.records.pop();
    analysis.candidates = candidates;
    analysis.version = nextVersion;
    analysis.remainingCandidates = candidates.length;
    return {
      analysis,
      outcome: {
        undone: removed,
        beforeCount,
        afterCount: candidates.length,
        version: nextVersion,
      },
    };
  }
}
