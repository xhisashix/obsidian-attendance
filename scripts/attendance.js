// obsidian-attendance/scripts/attendance.js
const content = await dv.io.load(dv.current().file.path);
const lines = content.split("\n");

const toMinutes = (timeStr) => {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
};

const formatHours = (mins) => (mins / 60).toFixed(2) + " h";

const formatHM = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}時間${m > 0 ? m + "分" : ""}` : `${m}分`;
};

// JOBマスタ（ノート）から表示名を取得してマップ化（テンプレート配下は除外）
const jobMasterMap = {};
for (const file of app.vault.getMarkdownFiles()) {
  if (/(^|\/)templates\//i.test(file.path)) continue;
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (fm && fm.job_code) {
    jobMasterMap[String(fm.job_code)] =
      fm.job_label || `${fm.job_code}: ${file.basename}`;
  }
}

const logRegex = /^-\s*(\d{1,2}:\d{2})\s+(.+)$/;
const rawLogs = [];

for (const line of lines) {
  const match = line.trim().match(logRegex);
  if (match) {
    const time = match[1];
    rawLogs.push({ time, mins: toMinutes(time), text: match[2] });
  }
}

// 遡って追記した場合でも時系列になるよう時刻順でソート
rawLogs.sort((a, b) => a.mins - b.mins);

const records = [];
let totalDayMins = 0;
const jobTotals = {}; // { [jobCode]: mins }
const catTotals = {}; // { [jobCode__category]: { jobCode, category, mins, count } }

for (let i = 1; i < rawLogs.length; i++) {
  const prev = rawLogs[i - 1]; // 1つ前の時刻（開始時刻の候補）
  const current = rawLogs[i]; // 終了時刻
  const duration = current.mins - prev.mins;

  if (duration <= 0) continue;

  // ① current（今回の終了行）自体が [開始] や [休憩] の場合は、タスクの終わりではないためスキップ
  if (current.text.startsWith("[開始]") || current.text.startsWith("[休憩]")) {
    continue;
  }

  // ② prev（開始行）が [終了] の場合もデータとして不正なのでスキップ
  if (prev.text.startsWith("[終了]")) {
    continue;
  }

  const detailMatch = current.text.match(
    /^\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$/,
  );
  if (detailMatch) {
    const jobCode = detailMatch[1].trim();
    const category = detailMatch[2].trim();
    const comment = `${detailMatch[3].trim()}`;

    records.push({
      jobCode,
      category,
      start: prev.time, // ここで prev.time（09:00など）が正しく開始になる
      end: current.time,
      mins: duration,
      comment,
    });

    totalDayMins += duration;
    jobTotals[jobCode] = (jobTotals[jobCode] || 0) + duration;

    const key = `${jobCode}__${category}`;
    if (!catTotals[key]) {
      catTotals[key] = { jobCode, category, mins: 0, count: 0 };
    }
    catTotals[key].mins += duration;
    catTotals[key].count += 1;
  }
}

// 未記録時間のチェック・日次合計の表示
if (rawLogs.length > 0) {
  const lastLogTime = rawLogs[rawLogs.length - 1].time;
  dv.paragraph(
    `🕒 **最終記録終了時刻:** ${lastLogTime} ｜ ⏱️ **合計稼働:** ${formatHours(totalDayMins)} (${formatHM(totalDayMins)})`,
  );
}

// 1. 時系列の明細テーブル
dv.table(
  ["開始", "終了", "稼働時間", "JOBコード", "カテゴリ", "補足コメント"],
  records.map((r) => [
    r.start,
    r.end,
    `${formatHours(r.mins)} (${formatHM(r.mins)})`,
    r.jobCode,
    r.category,
    r.comment,
  ]),
);

// 2. JOB × カテゴリ別 日次集計テーブル
if (Object.keys(catTotals).length > 0) {
  dv.header(4, "🏷️ JOB × カテゴリ別 稼働内訳");
  const catRows = Object.values(catTotals)
    .sort((a, b) => a.jobCode.localeCompare(b.jobCode) || b.mins - a.mins)
    .map((item) => {
      const jobTotal = jobTotals[item.jobCode] || 1;
      const inJobRatio = ((item.mins / jobTotal) * 100).toFixed(1);
      const dayRatio =
        totalDayMins > 0 ? ((item.mins / totalDayMins) * 100).toFixed(1) : "0.0";
      return [
        jobMasterMap[item.jobCode] || item.jobCode,
        item.category,
        `**${formatHours(item.mins)}** (${formatHM(item.mins)})`,
        `${item.count} 回`,
        `${inJobRatio}%`,
        `${dayRatio}%`,
      ];
    });

  dv.table(
    ["JOB", "カテゴリ", "合計時間", "タスク数", "JOB内比率", "日内比率"],
    catRows,
  );
}

const btn = dv.el("button", "📋 勤怠JSONをコピー");
btn.onclick = () => {
  const payload = records.map(({ jobCode, start, end, category, comment }) => ({
    jobCode,
    start,
    end,
    category,
    comment,
  }));
  navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  new Notice("勤怠データをクリップボードにコピーしました");
};
