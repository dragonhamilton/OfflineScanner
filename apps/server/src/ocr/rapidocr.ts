import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import type { OcrEngine } from './types.ts';
import { orderLines } from './types.ts';

interface RapidLine {
  text: string;
  box: [number, number][];
  score: number;
}

/**
 * RapidOCR runs as a long-lived Python process (tools/rapidocr/ocr_server.py)
 * started with uv. Requests and replies are one JSON object per line.
 */
export async function createRapidOcrEngine(repoRoot: string, tmpDir: string): Promise<OcrEngine> {
  const toolDir = path.join(repoRoot, 'tools/rapidocr');
  const child: ChildProcessWithoutNullStreams = spawn(
    'uv',
    ['run', '--project', toolDir, 'python', path.join(toolDir, 'ocr_server.py')],
    { cwd: toolDir, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  child.stderr.on('data', d => process.stderr.write(`[rapidocr] ${d}`));

  const replies = readline.createInterface({ input: child.stdout });
  const waiting: ((line: string) => void)[] = [];
  replies.on('line', line => waiting.shift()?.(line));

  let exited = false;
  child.on('exit', code => {
    exited = true;
    const err = JSON.stringify({ error: `rapidocr process exited (code ${code})` });
    while (waiting.length) waiting.shift()!(err);
  });

  // Requests are serialised: one image at a time.
  let queue: Promise<unknown> = Promise.resolve();

  function request(imagePath: string): Promise<RapidLine[]> {
    const job = queue.then(
      () =>
        new Promise<RapidLine[]>((resolve, reject) => {
          if (exited) return reject(new Error('rapidocr process is not running'));
          waiting.push(line => {
            const reply = JSON.parse(line) as { lines?: RapidLine[]; error?: string };
            if (reply.error) reject(new Error(reply.error));
            else resolve(reply.lines ?? []);
          });
          child.stdin.write(JSON.stringify({ path: imagePath }) + '\n');
        }),
    );
    queue = job.catch(() => undefined);
    return job;
  }

  return {
    name: 'rapidocr',
    async recognize(image) {
      const file = path.join(tmpDir, `ocr_${randomUUID()}.png`);
      await fs.writeFile(file, image);
      try {
        const lines = await request(file);
        return orderLines(
          lines.map(l => {
            const xs = l.box.map(p => p[0]);
            const ys = l.box.map(p => p[1]);
            return {
              text: l.text.trim(),
              height: Math.max(...ys) - Math.min(...ys),
              confidence: l.score,
              x: Math.min(...xs),
              y: Math.min(...ys),
            };
          }),
        );
      } finally {
        await fs.rm(file, { force: true });
      }
    },
    async close() {
      child.stdin.end();
      child.kill();
    },
  };
}
