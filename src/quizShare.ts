// 노래 맞추기 결과 공유: 결과 이미지 그리기, 공유 링크, X(트위터) 글쓰기 주소
// 서버(Firebase)를 쓰지 않으므로 사용량이 늘지 않습니다.

export interface QuizResultInfo {
  correct: number;
  total: number;
  easy: boolean; // true = 초보자 모드, false = 하드 모드
  score?: number; // 최종 점수 (0~100). 예전 링크에는 없을 수 있음
}

// X 글에 자동으로 붙일 해시태그 ("#" 없이). 비워 두면 붙이지 않습니다. 예: ["앙스타"]
export const QUIZ_SHARE_HASHTAGS: string[] = [];

// 공유 링크: 기록이 주소(#/quiz?r=맞힌수-문제수-모드[-점수])에 담김. 받은 사람은 설정 화면에서 안내 문구를 봄
export function buildQuizShareUrl(r: QuizResultInfo): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  const score = typeof r.score === "number" ? `-${Math.max(0, Math.min(100, Math.round(r.score)))}` : "";
  return `${base}#/quiz?r=${r.correct}-${r.total}-${r.easy ? "e" : "h"}${score}`;
}

// 주소의 해시에서 친구 기록을 읽음. 형식이 맞지 않거나 말이 안 되는 숫자면 무시(주소는 누구나 고칠 수 있으므로 검증)
export function parseQuizChallenge(hash: string): QuizResultInfo | null {
  const q = hash.split("?")[1];
  if (!q) return null;
  const m = /^(\d{1,3})-(\d{1,3})-([eh])(?:-(\d{1,3}))?$/.exec(new URLSearchParams(q).get("r") || "");
  if (!m) return null;
  const correct = Number(m[1]);
  const total = Number(m[2]);
  if (total < 1 || total > 100 || correct > total) return null;
  const score = m[4] === undefined ? undefined : Number(m[4]);
  if (score !== undefined && score > 100) return null;
  return score === undefined ? { correct, total, easy: m[3] === "e" } : { correct, total, easy: m[3] === "e", score };
}

// X 글쓰기 창 주소 (공식 Web Intent). 이미지는 이 주소로 첨부할 수 없어서 글과 링크만 채워 줍니다.
export function buildTweetIntentUrl(o: { text: string; url: string; hashtags?: string[] }): string {
  let q = `text=${encodeURIComponent(o.text)}&url=${encodeURIComponent(o.url)}`;
  if (o.hashtags && o.hashtags.length > 0) q += `&hashtags=${encodeURIComponent(o.hashtags.join(","))}`;
  return `https://x.com/intent/tweet?${q}`;
}

export interface ResultCardText {
  title: string; // 퀴즈 이름
  rateLabel: string; // "최종 정답률"
  detail: string; // "총 10문제 중 7문제 정답!"
  modeLabel: string; // "초보자 모드"
  scoreText: string; // "점수 82점"
  footer: string; // 사이트 주소 등
  percent: number; // 0~100
}

const FONT = '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR","Noto Sans JP","Hiragino Sans",sans-serif';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 공백 기준으로 줄바꿈(한 단어가 너무 길면 글자 단위), 최대 줄 수를 넘으면 말줄임
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  const push = (ch: string) => {
    if (cur && ctx.measureText(cur + ch).width > maxW) {
      lines.push(cur);
      cur = ch;
    } else cur += ch;
  };
  text.split(" ").forEach((word, i) => {
    const trial = cur ? `${cur} ${word}` : word;
    if (i > 0 && ctx.measureText(trial).width <= maxW) cur = trial;
    else {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      Array.from(word).forEach(push);
    }
  });
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/.{1}$/, "…");
    return kept;
  }
  return lines;
}

// 1200×675(16:9) 결과 카드를 2배 해상도 PNG로 그림 (html2canvas 없이 직접 그려서 모바일에서도 안정적)
export function renderQuizResultBlob(c: ResultCardText): Promise<Blob> {
  const W = 1200;
  const H = 675;
  const S = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * S;
  canvas.height = H * S;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("canvas 미지원"));
  ctx.scale(S, S);

  // 배경
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#ffe3e3");
  bg.addColorStop(1, "#fff5f5");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 흰 카드
  ctx.save();
  ctx.shadowColor = "rgba(255,107,107,0.28)";
  ctx.shadowBlur = 44;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 48, 48, W - 96, H - 96, 36);
  ctx.fill();
  ctx.restore();

  // 정답률 링
  const cx = 336;
  const cy = 318;
  const r = 168;
  const p = Math.max(0, Math.min(100, c.percent)) / 100;
  ctx.lineWidth = 36;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#f1f3f5";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  if (p > 0) {
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, "#ff8787");
    g.addColorStop(1, "#ff6b6b");
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
    ctx.stroke();
  }

  // 링 가운데 글자
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 118px ${FONT}`;
  const numW = ctx.measureText(String(c.percent)).width;
  ctx.font = `800 54px ${FONT}`;
  const pctW = ctx.measureText("%").width;
  const startX = cx - (numW + pctW + 6) / 2;
  ctx.textAlign = "left";
  ctx.fillStyle = "#1f2933";
  ctx.font = `800 118px ${FONT}`;
  ctx.fillText(String(c.percent), startX, cy + 36);
  ctx.font = `800 54px ${FONT}`;
  ctx.fillText("%", startX + numW + 6, cy + 36);
  ctx.textAlign = "center";
  ctx.fillStyle = "#6b7785";
  ctx.font = `600 28px ${FONT}`;
  ctx.fillText(c.rateLabel, cx, cy + 92, 250);

  // 오른쪽 글
  const x0 = 640;
  const maxW = 470;
  ctx.textAlign = "left";
  ctx.fillStyle = "#1f2933";
  ctx.font = `800 46px ${FONT}`;
  const titleLines = wrapLines(ctx, c.title, maxW, 2);
  let y = 190;
  titleLines.forEach((ln) => {
    ctx.fillText(ln, x0, y);
    y += 58;
  });

  // 모드 알약
  ctx.font = `700 26px ${FONT}`;
  const pillW = Math.min(maxW, ctx.measureText(c.modeLabel).width + 44);
  ctx.fillStyle = "#fff1f1";
  roundRect(ctx, x0, y - 6, pillW, 48, 24);
  ctx.fill();
  ctx.fillStyle = "#e8505b";
  ctx.fillText(c.modeLabel, x0 + 22, y + 28, pillW - 30);
  y += 108;

  // 점수 설명
  ctx.fillStyle = "#1f2933";
  ctx.font = `800 38px ${FONT}`;
  wrapLines(ctx, c.detail, maxW, 2).forEach((ln) => {
    ctx.fillText(ln, x0, y);
    y += 52;
  });

  // 점수
  ctx.fillStyle = "#e8505b";
  ctx.font = `800 46px ${FONT}`;
  ctx.fillText(c.scoreText, x0, y + 14, maxW);

  // 하단 주소
  ctx.textAlign = "center";
  ctx.fillStyle = "#98a2b3";
  ctx.font = `600 24px ${FONT}`;
  ctx.fillText(c.footer, W / 2, H - 82, W - 200);

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob 실패"))), "image/png")
  );
}
