import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HackerNewsScraper } from '../src/services/HackerNewsScraper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resultsPath = path.resolve(__dirname, '../../testresults.me');
const SECTION_TITLE = 'step 2 - test real web';

describe('HackerNewsScraper - real web', () => {
  it(
    'acquires the correct JSON of 30 entries from news.ycombinator.com',
    { timeout: 30000 },
    async () => {
      const scraper = new HackerNewsScraper();
      const entries = await scraper.scrape();

      const report = `${SECTION_TITLE}\n${JSON.stringify(entries, null, 2)}\n`;

      console.log(report);
      fs.appendFileSync(resultsPath, `\n${report}`, 'utf8');

      expect(entries).toHaveLength(30);

      entries.forEach((entry, index) => {
        expect(entry).toEqual({
          number: index + 1,
          title: expect.any(String),
          points: expect.any(Number),
          comments: expect.any(Number)
        });
        expect(entry.title.length).toBeGreaterThan(0);
        expect(entry.points).toBeGreaterThanOrEqual(0);
        expect(entry.comments).toBeGreaterThanOrEqual(0);
      });

      const roundtrip = JSON.parse(JSON.stringify(entries));
      expect(roundtrip).toEqual(entries);
    }
  );
});
