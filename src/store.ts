// SQLite 持久化：规则、有效记录、版本、候选摘要。追加/撤销在事务中原子完成。
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ApiError,
  Feedback,
  Rules,
  candidateDigest,
  enumerateCandidates,
  filterCandidates,
  validateFeedback,
  validateRules,
  validateSequence,
} from "./core";

export interface RecordRow {
  seq: number;
  guess: number[];
  black: number;
  white: number;
  beforeCount: number;
  afterCount: number;
}

export interface AnalysisInfo {
  id: string;
  rules: Rules;
  version: number;
  candidateCount: number;
  digest: string;
  createdAt: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS analyses (
        id TEXT PRIMARY KEY,
        color_count INTEGER NOT NULL,
        slots INTEGER NOT NULL,
        version INTEGER NOT NULL,
        candidate_count INTEGER NOT NULL,
        digest TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS records (
        analysis_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        guess TEXT NOT NULL,
        black INTEGER NOT NULL,
        white INTEGER NOT NULL,
        before_count INTEGER NOT NULL,
        after_count INTEGER NOT NULL,
        PRIMARY KEY (analysis_id, seq)
      );
      CREATE TABLE IF NOT EXISTS candidates (
        analysis_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        seq TEXT NOT NULL,
        PRIMARY KEY (analysis_id, idx)
      );
      CREATE INDEX IF NOT EXISTS idx_records_analysis ON records(analysis_id);
    `);
  }

  close(): void {
    this.db.close();
  }

  createAnalysis(rules: Rules): AnalysisInfo {
    validateRules(rules);
    const all = enumerateCandidates(rules);
    const id = `a_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const info: AnalysisInfo = {
      id,
      rules,
      version: 1,
      candidateCount: all.length,
      digest: candidateDigest(all),
      createdAt: new Date().toISOString(),
    };
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          "INSERT INTO analyses (id, color_count, slots, version, candidate_count, digest, created_at) VALUES (?,?,?,?,?,?,?)"
        )
        .run(id, rules.colorCount, rules.slots, 1, all.length, info.digest, info.createdAt);
      const ins = this.db.prepare("INSERT INTO candidates (analysis_id, idx, seq) VALUES (?,?,?)");
      all.forEach((c, i) => ins.run(id, i, JSON.stringify(c)));
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return info;
  }

  getAnalysis(id: string): AnalysisInfo {
    const row = this.db.prepare("SELECT * FROM analyses WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new ApiError("NOT_FOUND", `分析 ${id} 不存在`, 404);
    return {
      id: row.id as string,
      rules: { colorCount: row.color_count as number, slots: row.slots as number },
      version: row.version as number,
      candidateCount: row.candidate_count as number,
      digest: row.digest as string,
      createdAt: row.created_at as string,
    };
  }

  listRecords(id: string): RecordRow[] {
    this.getAnalysis(id);
    const rows = this.db
      .prepare("SELECT * FROM records WHERE analysis_id = ? ORDER BY seq")
      .all(id) as unknown as Record<string, unknown>[];
    return rows.map((r) => ({
      seq: r.seq as number,
      guess: JSON.parse(r.guess as string) as number[],
      black: r.black as number,
      white: r.white as number,
      beforeCount: r.before_count as number,
      afterCount: r.after_count as number,
    }));
  }

  loadCandidates(id: string): number[][] {
    const rows = this.db
      .prepare("SELECT seq FROM candidates WHERE analysis_id = ? ORDER BY idx")
      .all(id) as unknown as { seq: string }[];
    return rows.map((r) => JSON.parse(r.seq) as number[]);
  }

  pageCandidates(id: string, offset: number, limit: number): { total: number; items: number[][] } {
    const info = this.getAnalysis(id);
    const rows = this.db
      .prepare("SELECT seq FROM candidates WHERE analysis_id = ? ORDER BY idx LIMIT ? OFFSET ?")
      .all(id, limit, offset) as unknown as { seq: string }[];
    return { total: info.candidateCount, items: rows.map((r) => JSON.parse(r.seq) as number[]) };
  }

  /**
   * 追加一条记录：校验 -> 过滤 -> 若候选为空则拒绝（INCONSISTENT），
   * 否则在事务中写入记录并替换候选集。
   */
  appendRecord(id: string, guess: unknown, fb: unknown): {
    info: AnalysisInfo;
    record: RecordRow;
    before: number;
    after: number;
  } {
    const info = this.getAnalysis(id);
    validateSequence(guess, info.rules, "guess");
    validateFeedback(fb, info.rules);
    const current = this.loadCandidates(id);
    const result = filterCandidates(current, guess as number[], fb as Feedback);
    if (result.after === 0) {
      throw new ApiError(
        "INCONSISTENT",
        `新反馈与规则或历史矛盾：过滤前 ${result.before} 个候选，过滤后 0 个。历史未修改。`,
        409
      );
    }
    const f = fb as Feedback;
    const nextSeq = this.listRecords(id).length + 1;
    const digest = candidateDigest(result.candidates);
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          "INSERT INTO records (analysis_id, seq, guess, black, white, before_count, after_count) VALUES (?,?,?,?,?,?,?)"
        )
        .run(id, nextSeq, JSON.stringify(guess), f.black, f.white, result.before, result.after);
      this.db.prepare("DELETE FROM candidates WHERE analysis_id = ?").run(id);
      const ins = this.db.prepare("INSERT INTO candidates (analysis_id, idx, seq) VALUES (?,?,?)");
      result.candidates.forEach((c, i) => ins.run(id, i, JSON.stringify(c)));
      this.db
        .prepare("UPDATE analyses SET version = version + 1, candidate_count = ?, digest = ? WHERE id = ?")
        .run(result.after, digest, id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return {
      info: this.getAnalysis(id),
      record: {
        seq: nextSeq,
        guess: guess as number[],
        black: f.black,
        white: f.white,
        beforeCount: result.before,
        afterCount: result.after,
      },
      before: result.before,
      after: result.after,
    };
  }

  /** 撤销最后一条有效记录：重放剩余历史重建候选，事务原子完成。 */
  undoLast(id: string): { info: AnalysisInfo; removed: RecordRow } {
    const info = this.getAnalysis(id);
    const records = this.listRecords(id);
    if (records.length === 0) {
      throw new ApiError("NOTHING_TO_UNDO", "没有可撤销的记录", 409);
    }
    const removed = records[records.length - 1];
    let candidates = enumerateCandidates(info.rules);
    for (const r of records.slice(0, -1)) {
      candidates = filterCandidates(candidates, r.guess, { black: r.black, white: r.white }).candidates;
    }
    const digest = candidateDigest(candidates);
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM records WHERE analysis_id = ? AND seq = ?").run(id, removed.seq);
      this.db.prepare("DELETE FROM candidates WHERE analysis_id = ?").run(id);
      const ins = this.db.prepare("INSERT INTO candidates (analysis_id, idx, seq) VALUES (?,?,?)");
      candidates.forEach((c, i) => ins.run(id, i, JSON.stringify(c)));
      this.db
        .prepare("UPDATE analyses SET version = version + 1, candidate_count = ?, digest = ? WHERE id = ?")
        .run(candidates.length, digest, id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return { info: this.getAnalysis(id), removed };
  }
}
