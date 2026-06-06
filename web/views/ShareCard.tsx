import { useCallback } from 'react';

import { useI18n } from '../i18n.js';
import type { ContributorStat, GroveSource } from '../lib.js';

interface ShareCardProps {
  project: string;
  contributors: ContributorStat[];
  source: GroveSource;
  facts: number;
  branches: number;
}

function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Render a bamboo-framed summary of the grove to an offscreen canvas and hand it
 * back as a PNG download — the shareable, post-it-anywhere artifact. Drawn fresh
 * each click so it always reflects current stats and the active theme.
 */
export function ShareCard({ project, contributors, source, facts, branches }: ShareCardProps) {
  const { t } = useI18n();
  const onShare = useCallback(async () => {
    // Canvas silently falls back to a system font if a face isn't loaded yet —
    // pull the weights we draw with so the PNG is crisp on first click.
    try {
      await Promise.all([
        document.fonts?.load("700 64px 'Baloo 2'"),
        document.fonts?.load("800 84px 'Baloo 2'"),
        document.fonts?.load("600 40px 'Be Vietnam Pro'"),
        document.fonts?.load("400 30px 'Be Vietnam Pro'"),
      ]);
    } catch {
      /* fonts unavailable (offline) — fall back to system, still renders */
    }
    const W = 1200;
    const H = 630;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bark = token('--bark', '#7a5b2e');
    const growth = token('--growth', '#3aa35a');
    const paper = token('--surface', '#ffffff');
    const ink = token('--ink', '#1c1c1c');
    const soft = token('--ink-soft', '#555');

    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, W, H);
    // bamboo side-stripe
    ctx.fillStyle = growth;
    ctx.fillRect(0, 0, 16, H);
    ctx.fillStyle = bark;
    ctx.fillRect(16, 0, 6, H);

    const display = "'Baloo 2', system-ui, sans-serif";
    const body = "'Be Vietnam Pro', system-ui, sans-serif";

    ctx.fillStyle = ink;
    ctx.font = `700 64px ${display}`;
    ctx.fillText('🎋 ' + project, 80, 140);

    ctx.fillStyle = soft;
    ctx.font = `400 30px ${body}`;
    ctx.fillText(t('card.tagline'), 80, 190);

    const top = contributors[0];
    ctx.fillStyle = ink;
    ctx.font = `600 40px ${body}`;
    if (top) {
      const metric =
        source === 'git-fallback'
          ? t('metric.commits', { n: top.commits })
          : t('metric.score', { n: top.value_score });
      ctx.fillText(`🥇 ${top.author}`, 80, 300);
      ctx.fillStyle = soft;
      ctx.font = `400 30px ${body}`;
      ctx.fillText(metric, 80, 344);
    }

    const stats: Array<[string, string]> = [
      [String(contributors.length), t('card.contributors')],
      [String(facts), t('card.facts')],
      [String(branches), t('card.branches')],
    ];
    stats.forEach(([n, k], i) => {
      const x = 80 + i * 360;
      ctx.fillStyle = growth;
      ctx.font = `800 84px ${display}`;
      ctx.fillText(n, x, 500);
      ctx.fillStyle = soft;
      ctx.font = `400 28px ${body}`;
      ctx.fillText(k, x, 540);
    });

    ctx.fillStyle = soft;
    ctx.font = '400 24px ui-monospace, monospace';
    ctx.fillText('npm i -g tre-mem', 80, 600);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project}-grove.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }, [project, contributors, source, facts, branches, t]);

  return (
    <button className="btn-share" onClick={onShare} title={t('grove.share.title')}>
      📸 {t('grove.share')}
    </button>
  );
}
