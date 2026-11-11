import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL_ENV);
const runtimeTmpRoot = () => Reflect.apply(os.tmpdir, os, []);
const DEFAULT_DB_DIR = IS_SERVERLESS
  ? [runtimeTmpRoot(), 'medical-auditor-data'].join(path.sep)
  : path.join(process.cwd(), 'data');

const DB_PATH = process.env.AUDITOR_DB_PATH || path.join(DEFAULT_DB_DIR, 'medical_auditor.db');
const DB_DIR = path.dirname(DB_PATH);
const UPLOADS_DIR = path.join(DB_DIR, 'uploads');
const REFERENCES_DIR = path.join(UPLOADS_DIR, 'references');
const EXAMINATIONS_DIR = path.join(UPLOADS_DIR, 'examinations');
const PAGES_DIR = path.join(UPLOADS_DIR, 'pages');
const EXPORTS_DIR = path.join(UPLOADS_DIR, 'exports');

// Ensure directories exist cleanly
for (const dir of [DB_DIR, UPLOADS_DIR, REFERENCES_DIR, EXAMINATIONS_DIR, PAGES_DIR, EXPORTS_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(DB_PATH);
    dbInstance.exec('PRAGMA foreign_keys = ON;');
    dbInstance.exec('PRAGMA journal_mode = WAL;');

    // Run schema
    const schemaPath = path.join(process.cwd(), 'src', 'lib', 'db', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      dbInstance.exec(schemaSql);
    }

    // Safe additive schema migrations for existing SQLite databases
    const qCols = dbInstance.prepare('PRAGMA table_info(questions)').all() as Array<{ name: string }>;
    const qColNames = new Set(qCols.map(c => c.name));
    if (!qColNames.has('image_path')) {
      dbInstance.exec('ALTER TABLE questions ADD COLUMN image_path TEXT;');
    }
    if (!qColNames.has('image_description')) {
      dbInstance.exec('ALTER TABLE questions ADD COLUMN image_description TEXT;');
    }

    // Initialize default settings if not exists (pre-populating from environment variables when deployed on Vercel)
    const checkSettings = dbInstance.prepare("SELECT COUNT(*) as count FROM system_settings").get() as { count: number };
    if (checkSettings.count === 0) {
      const envGemini = process.env.GEMINI_API_KEY || '';
      const envOpenAi = process.env.OPENAI_API_KEY || '';
      const envAnthropic = process.env.ANTHROPIC_API_KEY || '';
      const defaultProvider = envGemini ? 'gemini' : envOpenAi ? 'openai' : envAnthropic ? 'anthropic' : 'built_in';

      const initSetting = dbInstance.prepare("INSERT INTO system_settings (key, value) VALUES (?, ?)");
      initSetting.run('ai_provider', defaultProvider); // 'built_in' | 'gemini' | 'openai' | 'anthropic'
      initSetting.run('gemini_api_key', envGemini);
      initSetting.run('gemini_model', 'gemini-3.5-flash-lite');
      initSetting.run('openai_api_key', envOpenAi);
      initSetting.run('openai_model', 'gpt-4o');
      initSetting.run('anthropic_api_key', envAnthropic);
      initSetting.run('anthropic_model', 'claude-3-5-sonnet-20241022');
      initSetting.run('max_upload_size_mb', '100');
      initSetting.run('ocr_confidence_threshold', '75');
      initSetting.run('secondary_ocr_verification', 'true');
    }
  }
  return dbInstance;
}

export {
  DB_DIR,
  UPLOADS_DIR,
  REFERENCES_DIR,
  EXAMINATIONS_DIR,
  PAGES_DIR,
  EXPORTS_DIR
};
