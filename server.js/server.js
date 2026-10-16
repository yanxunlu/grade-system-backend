require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

// 放寬上傳限制到 10mb
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));

app.use(express.static(path.join(__dirname, "images")));
app.use(express.static(path.join(__dirname, "public")));

// =================【 Supabase 資料庫連線 】=================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 初始化 Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// =================【 LINE 推播核心函數 (精美字卡版) 】=================
const sendLinePush = async (studentName, message) => {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.log("⚠️ 錯誤：找不到 Token，請檢查 .env 檔案");
    return;
  }

  try {
    const { data, error } = await supabase
      .from("students")
      .select("line_user_id")
      .eq("name", studentName)
      .single();

    if (error || !data || !data.line_user_id) {
      console.log(`⚠️ Supabase 找不到【${studentName}】的 UID。`);
      return;
    }

    const targetUid = data.line_user_id;

    if (!targetUid.startsWith("U") || targetUid.length !== 33) {
      console.log(`❌ 錯誤：這不是有效的 LINE UID！抓到的是：[${targetUid}]`);
      return;
    }

    await axios.post(
      "https://api.line.me/v2/bot/message/push",
      {
        to: targetUid,
        messages: [
          {
            type: "flex",
            altText: "🔔 您有一則新成績通知",
            contents: {
              type: "bubble",
              size: "mega",
              body: {
                type: "box",
                layout: "vertical",
                contents: [
                  {
                    type: "text",
                    text: "🔔 最新成績通知",
                    weight: "bold",
                    color: "#1DB446",
                    size: "sm",
                  },
                  {
                    type: "text",
                    text: studentName,
                    weight: "bold",
                    size: "xl",
                    margin: "md",
                  },
                  {
                    type: "text",
                    text: message,
                    size: "md",
                    margin: "md",
                    wrap: true,
                  },
                ],
              },
              footer: {
                type: "box",
                layout: "vertical",
                contents: [
                  {
                    type: "button",
                    style: "primary",
                    color: "#1DB446",
                    action: {
                      type: "uri",
                      label: "詳細內容",
                      uri: "https://cyshzoo.netlify.app/student.html",
                    },
                  },
                ],
              },
            },
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
    console.log(`✅ 已成功推播字卡給【${studentName}】的家長！`);
  } catch (err) {
    console.error(
      "❌ LINE 推播失敗：",
      err.response ? JSON.stringify(err.response.data) : err.message
    );
  }
};

// =================【 API 路由 】=================

// OCR 成績照片辨識 API
app.post("/api/ocr-score", async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ message: "無影像資料" });

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt =
      '你是一個成績單辨識助手。請辨識圖中的『學生姓名』、『科目名稱』、『成績分數』。請只回傳 JSON 格式：{"studentName":"...","subject":"...","score":100}';

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Data, mimeType: "image/jpeg" } },
    ]);

    const text = result.response.text().replace(/```json|```/g, "").trim();
    res.json(JSON.parse(text));
  } catch (err) {
    console.error("辨識錯誤:", err);
    res.status(500).json({ message: "辨識失敗" });
  }
});

app.get("/", (req, res) => {
  res.send("成績管理系統 API 運行中 (Supabase 版) 🚀");
});

// 🟢 新增單筆成績
app.post("/grades", async (req, res) => {
  try {
    let { studentName, subject, score } = req.body;
    if (!studentName || !subject || score === undefined) {
      return res.status(400).json({ message: "請提供完整的成績資訊" });
    }
    studentName = studentName.trim();

    const { data: newGrade, error } = await supabase
      .from("newgrades")
      .insert([{ studentName, subject, score: Number(score) }])
      .select()
      .single();

    if (error) throw error;

    // 觸發推播 (字卡文字)
    const msg = `${subject} 成績已上傳，分數為：${score}`;
    await sendLinePush(studentName, msg);

    res.status(201).json({ message: "成績已新增", data: newGrade });
  } catch (err) {
    res.status(500).json({ message: "新增成績失敗", error: err.message });
  }
});

// 🟢 批次新增成績 (Excel 匯入)
app.post("/grades/batch", async (req, res) => {
  try {
    const { grades } = req.body;
    if (!Array.isArray(grades)) {
      return res
        .status(400)
        .json({ success: false, message: "資料格式錯誤，需提供陣列" });
    }

    const formattedGrades = grades.map((g) => ({
      studentName: g.studentName ? g.studentName.trim() : "",
      subject: g.subject,
      score: Number(g.score),
    }));

    const { error } = await supabase.from("newgrades").insert(formattedGrades);
    if (error) throw error;

    const studentUpdates = {};
    formattedGrades.forEach((g) => {
      if (!studentUpdates[g.studentName]) studentUpdates[g.studentName] = [];
      studentUpdates[g.studentName].push(`${g.subject}: ${g.score}分`);
    });

    for (const studentName of Object.keys(studentUpdates)) {
      const msg = `以下是最新成績更新：\n${studentUpdates[studentName].join(
        "\n"
      )}`;
      await sendLinePush(studentName, msg);
    }

    res
      .status(200)
      .json({
        success: true,
        message: "批次匯入成功",
        count: grades.length,
      });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "批次匯入失敗", error: err.message });
  }
});

// 🟢 取得所有成績
app.get("/grades", async (req, res) => {
  try {
    const { data: grades, error } = await supabase.from("newgrades").select("*");
    if (error) throw error;
    res.status(200).json({ data: grades });
  } catch (err) {
    res.status(500).json({ message: "查詢成績失敗", error: err.message });
  }
});

// 🟢 修改單筆成績
app.put("/grades/:id", async (req, res) => {
  try {
    const { studentName, subject, score } = req.body;
    const updateData = {};
    if (studentName) updateData.studentName = studentName;
    if (subject) updateData.subject = subject;
    if (score !== undefined) updateData.score = Number(score);

    const { data: updatedGrade, error } = await supabase
      .from("newgrades")
      .update(updateData)
      .eq("id", req.params.id)
      .select()
      .single();

    if (error || !updatedGrade)
      return res.status(404).json({ message: "找不到該成績或更新失敗" });
    res.status(200).json({ message: "成績已更新", data: updatedGrade });
  } catch (err) {
    res.status(500).json({ message: "更新成績失敗", error: err.message });
  }
});

// 🟢 刪除單筆成績
app.delete("/grades/:id", async (req, res) => {
  try {
    const { data: deletedGrade, error } = await supabase
      .from("newgrades")
      .delete()
      .eq("id", req.params.id)
      .select()
      .single();

    if (error || !deletedGrade)
      return res.status(404).json({ message: "找不到該成績" });
    res.status(200).json({ message: "成績已刪除", data: deletedGrade });
  } catch (err) {
    res.status(500).json({ message: "刪除成績失敗", error: err.message });
  }
});

// 🟢 刪除所有成績
app.delete("/grades", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("newgrades")
      .delete()
      .neq("id", 0); // 刪除所有資料

    if (error) throw error;
    res.status(200).json({ message: "所有成績已刪除", data });
  } catch (err) {
    res.status(500).json({ message: "刪除所有成績失敗", error: err.message });
  }
});

// 🟢 統整成績（按學生整合）
app.post("/grades/merge", async (req, res) => {
  try {
    const { data: grades, error } = await supabase.from("newgrades").select("*");
    if (error) throw error;

    const merged = {};
    grades.forEach((g) => {
      if (!merged[g.studentName]) {
        merged[g.studentName] = { _id: g.studentName, grades: [] };
      }
      merged[g.studentName].grades.push({
        subject: g.subject,
        score: g.score,
      });
    });

    const result = Object.values(merged).sort((a, b) =>
      a._id.localeCompare(b._id)
    );
    res.status(200).json({ data: result });
  } catch (err) {
    res.status(500).json({ message: "統整成績失敗", error: err.message });
  }
});

// 🟢 成績組距統計
app.get("/grades/scoreDistribution", async (req, res) => {
  try {
    const buckets = [
      { min: 0, max: 9, label: "0-9" },
      { min: 10, max: 19, label: "10~19" },
      { min: 20, max: 29, label: "20~29" },
      { min: 30, max: 39, label: "30~39" },
      { min: 40, max: 49, label: "40~49" },
      { min: 50, max: 59, label: "50~59" },
      { min: 60, max: 69, label: "60~69" },
      { min: 70, max: 79, label: "70~79" },
      { min: 80, max: 89, label: "80~89" },
      { min: 90, max: 100, label: "90~100" },
    ];

    const { data: grades, error } = await supabase.from("newgrades").select("*");
    if (error) throw error;

    const subjects = [...new Set(grades.map((g) => g.subject))];
    const results = [];

    for (const subject of subjects) {
      const distribution = {};
      buckets.forEach((b) => (distribution[b.label] = 0));
      const subjectGrades = grades.filter((g) => g.subject === subject);

      subjectGrades.forEach((g) => {
        const b = buckets.find(
          (b) => g.score >= b.min && g.score <= b.max
        );
        if (b) distribution[b.label]++;
      });

      results.push({ subject, distribution });
    }

    res.status(200).json({ data: results });
  } catch (err) {
    res.status(500).json({ message: "組距統計失敗", error: err.message });
  }
});

// 🟢 平均排名
app.get("/grades/averageRanking", async (req, res) => {
  try {
    const { data: grades, error } = await supabase.from("newgrades").select("*");
    if (error) throw error;

    const studentScores = {};
    grades.forEach((g) => {
      if (!studentScores[g.studentName]) {
        studentScores[g.studentName] = { total: 0, count: 0 };
      }
      studentScores[g.studentName].total += g.score;
      studentScores[g.studentName].count += 1;
    });

    const averages = Object.keys(studentScores).map((studentName) => ({
      studentName,
      avgScore:
        studentScores[studentName].total / studentScores[studentName].count,
    }));

    averages.sort((a, b) => b.avgScore - a.avgScore);

    const result = averages.map((item, index) => ({
      studentName: item.studentName,
      avgScore: item.avgScore,
      rank: index + 1,
    }));

    res.status(200).json({ data: result });
  } catch (err) {
    res.status(500).json({ message: "平均排名失敗", error: err.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});
