import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const seedFile = path.resolve('data/seed_models.json');
const rawData = fs.readFileSync(seedFile, 'utf-8');
const models = JSON.parse(rawData);

const now = new Date().toISOString();
let sqlStatements = [];

for (const m of models) {
  const versionsJson = JSON.stringify([
    {
      version: m.latest_version,
      release_date: m.release_date,
      file_size: m.file_size,
      download_url: m.download_url,
    },
  ]).replace(/'/g, "''");

  sqlStatements.push(`
    INSERT OR REPLACE INTO models (
      id, brand, series, name, model_code, support_url, product_image,
      latest_version, release_date, file_size, download_url,
      all_versions_json, last_checked_at, last_updated_at, is_active
    ) VALUES (
      '${m.id}',
      '${m.brand}',
      '${(m.series || '').replace(/'/g, "''")}',
      '${m.name.replace(/'/g, "''")}',
      '${m.model_code}',
      '${m.support_url}',
      ${m.product_image ? `'${m.product_image}'` : 'NULL'},
      '${m.latest_version}',
      '${m.release_date}',
      '${m.file_size}',
      '${m.download_url}',
      '${versionsJson}',
      '${now}',
      '${now}',
      1
    );
  `);
}

const tempSqlFile = path.resolve('.wrangler/seed.sql');
fs.mkdirSync(path.dirname(tempSqlFile), { recursive: true });
fs.writeFileSync(tempSqlFile, sqlStatements.join('\n'), 'utf-8');

console.log(`Seeding ${models.length} models into local D1 database...`);
try {
  execSync(`npx wrangler d1 execute DB --local --file="${tempSqlFile}"`, {
    stdio: 'inherit',
  });
  console.log('Seeding completed successfully!');
} catch (err) {
  console.error('Seeding error:', err);
  process.exit(1);
} finally {
  if (fs.existsSync(tempSqlFile)) {
    fs.unlinkSync(tempSqlFile);
  }
}
