// obsidian-attendance/scripts/attendance.js
const content = await dv.io.load(dv.current().file.path);
const lines = content.split("\n");

const toMinutes = (timeStr) => {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
};

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
for (let i = 1; i < rawLogs.length; i++) {
  const prev = rawLogs[i - 1]; // 1つ前の時刻（開始時刻の候補）
  const current = rawLogs[i]; // 終了時刻

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
    records.push({
      jobCode: detailMatch[1].trim(),
      category: detailMatch[2].trim(),
      start: prev.time, // ここで prev.time（09:00など）が正しく開始になる
      end: current.time,
      comment: `${detailMatch[3].trim()}`,
    });
  }
}

// 未記録時間のチェック表示
if (rawLogs.length > 0) {
  const lastLogTime = rawLogs[rawLogs.length - 1].time;
  dv.paragraph(`🕒 **最終記録終了時刻:** ${lastLogTime}`);
}

dv.table(
  ["開始", "終了", "JOBコード", "カテゴリ", "補足コメント"],
  records.map((r) => [r.start, r.end, r.jobCode, r.category, r.comment]),
);

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
