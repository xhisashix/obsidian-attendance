<%*
// === 設定項目 ===
const DAILY_NOTE_FOLDER = "diary"; // デイリーノートのフォルダ名（デフォルト: diary）
const DAILY_NOTE_FORMAT = "YYYY-MM-DD";
const TARGET_HEADING = "## 勤怠ログ";
// ================

// 1. 当日のデイリーノートから「直前の記録時刻」を取得
const todayFileName = tp.date.now(DAILY_NOTE_FORMAT);
const filePath = DAILY_NOTE_FOLDER ? `${DAILY_NOTE_FOLDER}/${todayFileName}.md` : `${todayFileName}.md`;
const targetFile = app.vault.getAbstractFileByPath(filePath);

if (!targetFile) {
  new Notice(`⚠️ デイリーノートが見つかりません: ${filePath}`);
  return;
}

const content = await app.vault.read(targetFile);
const lines = content.split("\n");
let lastTime = "未記録";
const timeRegex = /^-\s*(\d{2}:\d{2})\s+\[/;

for (const line of lines) {
  const m = line.trim().match(timeRegex);
  if (m) lastTime = m[1];
}

// 2. JOBリストの抽出
const jobList = [];
for (const file of app.vault.getMarkdownFiles()) {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (fm && fm.job_code && fm.active !== false) {
    jobList.push({
      label: fm.job_label || `${fm.job_code}: ${file.basename}`,
      code: String(fm.job_code),
      categories: Array.isArray(fm.categories) ? fm.categories : [],
      order: fm.order ?? 999
    });
  }
}
jobList.sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));

// 始業時と昼休憩明け用の固定項目
jobList.unshift({ label: "🌅 業務開始（始業打刻）", code: "開始", categories: [] });
jobList.push({ label: "☕ 休憩終了（昼休み明け）", code: "休憩", categories: [] });

// 3. JOBを選択（直前の記録時刻をヘッダーに表示して抜け漏れを可視化）
const selectedJob = await tp.system.suggester(
  jobList.map(j => j.label),
  jobList,
  false,
  `【前回記録: ${lastTime}】完了したJOBを選択してください`
);
if (!selectedJob) return;

// 4. 終了時刻の選択（現在時刻・キリのいい時刻・遡り・手入力）
const nowMoment = moment();
const nowStr = nowMoment.format("HH:mm");
// 直近の00分・30分（MTG終了時刻としてよくある区切り）を自動計算
const rounded30 = moment().minutes(Math.floor(nowMoment.minutes() / 30) * 30).format("HH:mm");
const prev30 = moment().minutes(Math.floor(nowMoment.minutes() / 30) * 30).subtract(30, "minutes").format("HH:mm");
const prev60 = moment().minutes(Math.floor(nowMoment.minutes() / 30) * 30).subtract(60, "minutes").format("HH:mm");

const timeOptions = [
  { label: `⏱️ 現在時刻 (${nowStr})`, value: nowStr },
  { label: `🎯 直近の区切り (${rounded30})`, value: rounded30 },
  { label: `⏪ 1つ前の区切り (${prev30})`, value: prev30 },
  { label: `⏪ 2つ前の区切り (${prev60})`, value: prev60 },
  { label: `⌨️ 時刻を直接入力する (HH:mm)`, value: "MANUAL" }
];

let endTime = await tp.system.suggester(
  timeOptions.map(t => t.label),
  timeOptions.map(t => t.value),
  false,
  `[${selectedJob.code}] 終了した時刻を選択（開始: ${lastTime}〜）`
);
if (!endTime) return;

if (endTime === "MANUAL") {
  endTime = await tp.system.prompt("終了時刻を入力してください (例: 11:00)", rounded30);
  if (!endTime) return;
}

let newLogLine = "";
const categories = selectedJob.categories;

if (categories.length === 0) {
  newLogLine = `- ${endTime} [${selectedJob.code}]`;
} else {
  // 5. カテゴリ選択
  let selectedCategory = categories[0];
  if (categories.length > 1) {
    selectedCategory = await tp.system.suggester(
      categories,
      categories,
      false,
      `[${selectedJob.code}] (${lastTime}〜${endTime}) カテゴリを選択`
    );
    if (!selectedCategory) return;
  }

  // 6. コメント入力
  const comment = await tp.system.prompt(
    `[${selectedJob.code} / ${selectedCategory}] (${lastTime}〜${endTime}) 補足コメント`
  );
  if (comment === null) return;

  newLogLine = `- ${endTime} [${selectedJob.code}] [${selectedCategory}] ${comment.trim()}`;
}

// 7. デイリーノートへ追記
await app.vault.process(targetFile, (data) => {
  const fileLines = data.split("\n");
  const headingIndex = fileLines.findIndex(line => line.trim() === TARGET_HEADING);

  if (headingIndex === -1) {
    return `${data.trimEnd()}\n\n${TARGET_HEADING}\n${newLogLine}\n`;
  }

  let insertIndex = headingIndex + 1;
  for (let i = headingIndex + 1; i < fileLines.length; i++) {
    if (fileLines[i].startsWith("#")) break;
    if (fileLines[i].trim().startsWith("- ")) {
      insertIndex = i + 1;
    } else if (insertIndex === headingIndex + 1 && fileLines[i].trim() === "") {
      insertIndex = i + 1;
    }
  }

  fileLines.splice(insertIndex, 0, newLogLine);
  return fileLines.join("\n");
});

new Notice(`✅ 記録完了: ${lastTime} 〜 ${endTime} [${selectedJob.code}]`);
%>