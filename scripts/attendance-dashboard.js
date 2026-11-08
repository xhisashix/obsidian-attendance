// obsidian-attendance/scripts/attendance-dashboard.js
const DAILY_NOTE_FOLDER = input?.folder ?? "diary"; // デイリーノートのフォルダ名（デフォルト: diary）
const TARGET_HEADING = "## 勤怠ログ";
const currentPage = typeof dv?.current === "function" ? dv.current() : null;
const safeMoment = typeof moment !== "undefined" ? moment : null;

const normalizeMonth = (value) => {
  if (!value) return null;

  if (typeof value === "string") {
    const text = value.trim();
    const match = text.match(/^(\d{4})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}`;

    const date = new Date(text);
    if (!Number.isNaN(date.getTime()) && safeMoment) {
      return safeMoment(date).format("YYYY-MM");
    }
    return null;
  }

  if (value instanceof Date) {
    return safeMoment ? safeMoment(value).format("YYYY-MM") : null;
  }

  if (typeof value === "object") {
    if (typeof value.year === "number" && typeof value.month === "number") {
      return `${value.year}-${String(value.month).padStart(2, "0")}`;
    }
    if (typeof value.year === "string" && typeof value.month === "string") {
      return `${value.year}-${String(value.month).padStart(2, "0")}`;
    }
  }

  if (typeof value === "number") {
    const date = new Date(value);
    return safeMoment ? safeMoment(date).format("YYYY-MM") : null;
  }

  return null;
};

const getCurrentMonth = () => {
  const fromInput = normalizeMonth(input?.month);
  if (fromInput) return fromInput;

  const fromPage = normalizeMonth(currentPage?.target_month);
  if (fromPage) return fromPage;

  if (safeMoment) return safeMoment().format("YYYY-MM");

  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
};

// 引数 > ダッシュボードのFrontmatter(target_month) > 今月 の優先順で対象月を決定
const targetMonth = getCurrentMonth();

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

try {
  // 1. JOBマスタ（ノート）から表示名を取得してマップ化（テンプレート配下は除外）
  const jobMasterMap = {};
  for (const file of app.vault.getMarkdownFiles()) {
    if (/(^|\/)templates\//i.test(file.path)) continue;
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm && fm.job_code) {
      jobMasterMap[String(fm.job_code)] =
        fm.job_label || `${fm.job_code}: ${file.basename}`;
    }
  }

  // 2. 対象月のデイリーノート一覧を取得
  const allFiles = app.vault.getMarkdownFiles().filter((f) => {
    const inFolder = DAILY_NOTE_FOLDER
      ? f.path.startsWith(DAILY_NOTE_FOLDER + "/")
      : true;
    return inFolder && f.basename.startsWith(targetMonth);
  });

  allFiles.sort((a, b) => a.basename.localeCompare(b.basename));

  if (allFiles.length === 0) {
    dv.paragraph(
      `📭 対象月 **${targetMonth}** の勤怠ログが見つかりませんでした。` +
        ` DailyNotes 配下に ${targetMonth} から始まるノートがあるか確認してください。`,
    );
    return;
  }

  let totalMonthMins = 0;
  let workedDays = 0;
  const jobTotals = {}; // { [jobCode]: mins }
  const catTotals = {}; // { [jobCode__category]: { jobCode, category, mins, count } }
  const dailySummaries = []; // 日別サマリー用
  const errorNotes = []; // 記録不備があるノート

  // NOTE: 実際の勤怠ログは "9:00 [開始]" のような 1 桁時刻を使うため、
  // 2 桁固定の正規表現だと最初の始業記録を捉えられず、処理全体が崩れる。
  const logRegex = /^-\s*(\d{1,2}:\d{2})\s+(.+)$/;

  // 3. 各デイリーノートを走査・パース
  for (const file of allFiles) {
    const content = await app.vault.cachedRead(file);
    const lines = content.split("\n");

    let inSection = false;
    const rawLogs = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === TARGET_HEADING) {
        inSection = true;
        continue;
      }
      if (inSection && trimmed.startsWith("#")) break;
      if (inSection && trimmed.startsWith("-")) {
        const match = trimmed.match(logRegex);
        if (match) {
          rawLogs.push({
            time: match[1],
            mins: toMinutes(match[1]),
            text: match[2],
          });
        }
      }
    }

    if (rawLogs.length === 0) continue;

    rawLogs.sort((a, b) => a.mins - b.mins);

    if (!rawLogs[0].text.startsWith("[開始]")) {
      errorNotes.push(`[[${file.basename}]] (始業 \`[開始]\` 抜け)`);
    }

    let dayMins = 0;
    const dayCatTotals = {}; // { [jobCode__category]: { jobCode, category, mins, count } }
    for (let i = 1; i < rawLogs.length; i++) {
      const prev = rawLogs[i - 1];
      const current = rawLogs[i];
      const duration = current.mins - prev.mins;

      if (duration <= 0) continue;
      if (current.text.startsWith("[開始]") || current.text.startsWith("[休憩]"))
        continue;

      const detailMatch = current.text.match(
        /^\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$/,
      );
      if (detailMatch) {
        const jobCode = detailMatch[1].trim();
        const category = detailMatch[2].trim();

        dayMins += duration;
        totalMonthMins += duration;

        // JOB別加算
        jobTotals[jobCode] = (jobTotals[jobCode] || 0) + duration;

        // JOB × カテゴリ別加算（月次）
        const key = `${jobCode}__${category}`;
        if (!catTotals[key]) {
          catTotals[key] = { jobCode, category, mins: 0, count: 0 };
        }
        catTotals[key].mins += duration;
        catTotals[key].count += 1;

        // JOB × カテゴリ別加算（日次）
        if (!dayCatTotals[key]) {
          dayCatTotals[key] = { jobCode, category, mins: 0, count: 0 };
        }
        dayCatTotals[key].mins += duration;
        dayCatTotals[key].count += 1;
      } else if (!current.text.startsWith("[終了]")) {
        errorNotes.push(`[[${file.basename}]] (記法エラー: \`${current.text}\`)`);
      }
    }

    if (dayMins > 0) {
      workedDays++;
      const breakdown = Object.values(dayCatTotals)
        .sort((a, b) => a.jobCode.localeCompare(b.jobCode) || b.mins - a.mins)
        .map(
          (item) =>
            `\`${item.jobCode}\` [${item.category}] **${formatHours(item.mins)}** (${formatHM(item.mins)})`,
        )
        .join("<br>");

      dailySummaries.push({
        fileLink: `[[${file.basename}]]`,
        mins: dayMins,
        breakdown,
        lastTime: rawLogs[rawLogs.length - 1].time,
      });
    }
  }

  // --- 4. サマリーパネルの描画 ---
  const avgMins = workedDays > 0 ? Math.round(totalMonthMins / workedDays) : 0;
  const summaryBox = dv.el("div", "", {
    attr: {
      style:
        "background-color: rgba(56, 139, 253, 0.1); border-left: 4px solid #388bfd; padding: 12px 16px; margin-bottom: 16px; border-radius: 4px;",
    },
  });
  dv.header(4, `📊 ${targetMonth} 稼働サマリー`, { container: summaryBox });
  dv.paragraph(
    `🗓️ **稼働日数:** ${workedDays}日 ｜ ⏱️ **合計稼働:** ${formatHours(totalMonthMins)} (${formatHM(totalMonthMins)}) ｜ 📈 **1日平均:** ${formatHM(avgMins)}`,
    { container: summaryBox },
  );

  if (errorNotes.length > 0) {
    dv.paragraph(`⚠️ **要確認ノート:** ${errorNotes.join(", ")}`, {
      container: summaryBox,
    });
  }

  // --- 5. JOB別集計テーブル ---
  dv.header(3, "📁 JOB別 稼働集計");
  const jobRows = Object.entries(jobTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([code, mins]) => {
      const ratio =
        totalMonthMins > 0 ? ((mins / totalMonthMins) * 100).toFixed(1) : "0.0";
      const barCount = Math.round(Number(ratio) / 5);
      const bar = "🟩".repeat(barCount) + "⬜".repeat(Math.max(0, 20 - barCount));
      return [
        jobMasterMap[code] || code,
        `**${formatHours(mins)}** (${formatHM(mins)})`,
        `${ratio}%`,
        bar,
      ];
    });

  dv.table(["JOB", "合計時間", "割合", "比率グラフ"], jobRows);

  // --- 6. JOB × カテゴリ別 詳細テーブル ---
  dv.header(3, "🏷️ JOB × カテゴリ別 内訳");
  const catRows = Object.values(catTotals)
    .sort((a, b) => a.jobCode.localeCompare(b.jobCode) || b.mins - a.mins)
    .map((item) => {
      const jobTotal = jobTotals[item.jobCode] || 1;
      const inJobRatio = ((item.mins / jobTotal) * 100).toFixed(1);
      return [
        item.jobCode,
        item.category,
        `**${formatHours(item.mins)}** (${formatHM(item.mins)})`,
        `${item.count} 回`,
        `${inJobRatio}%`,
      ];
    });

  dv.table(
    ["JOBコード", "カテゴリ", "合計時間", "タスク数", "JOB内比率"],
    catRows,
  );

  // --- 7. 日別稼働一覧（折りたたみ） ---
  dv.header(3, "📅 日別ログ一覧");
  dv.table(
    ["日付", "稼働時間", "JOB × カテゴリ別 内訳", "最終記録時刻"],
    dailySummaries.map((d) => [
      d.fileLink,
      `${formatHours(d.mins)} (${formatHM(d.mins)})`,
      d.breakdown,
      d.lastTime,
    ]),
  );
} catch (error) {
  console.error("attendance-dashboard error:", error);
  dv.paragraph("❌ 勤怠ダッシュボードの実行中にエラーが発生しました。エラー内容をコンソールで確認してください。", {
    cls: "warning",
  });
  dv.paragraph(`詳細: ${error?.message || String(error)}`);
}
