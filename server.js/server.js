require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const port = process.env.PORT || 3000;

// =================【 基礎設定 】=================
// 修改點：放寬限制以利照片傳輸，其餘保留原本設定
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, "images")));
app.use(express.static(path.join(__dirname, "public")));

// =================【 資料庫連線 】=================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ 已連線 MongoDB (成績庫)"))
  .catch((err) => console.error("❌ MongoDB 連線失敗：", err));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 這裡填入你剛才提供的 API Key
const genAI = new GoogleGenerativeAI("AIzaSyCxgjXQq59Esu78B-bRgUpm4JxwBtx9M-w");

// =================【 原本的 MongoDB 模型 】=================
const gradeSchema = new mongoose.Schema({
  studentName: String,
  subject: String,
  score: Number,
  date: { type: Date, default: Date.now },
});
const Grade = mongoose.model("Grade", gradeSchema);

// =================【 原本的 LINE 推播邏輯 (保留) 】=================
const sendLinePush = async (studentName, scoreData) => {
  try {
    const { data: user, error } = await supabase
      .from("profiles")
      .select("line_user_id")
      .eq("full_name", studentName)
      .single();

    if (error || !user?.line_user_id) {
      console.log(`⚠️ 找不到學生 ${studentName} 的 LINE ID`);
      return;
    }

    const linePayload = {
      to: user.line_user_id,
      messages: [{
        type: "flex",
        altText: `成績通知：${studentName}`,
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: "📝 成績通知", weight: "bold", color: "#1DB446", size: "sm" },
              { type: "text", text: studentName, size: "xl", weight: "bold", margin: "md" },
              { type: "separator", margin: "md" },
              {
                type: "box",
                layout: "horizontal",
                margin: "md",
                contents: [
                  { type: "text", text: scoreData.subject, size: "md", color: "#555555" },
                  { type: "text", text: `${scoreData.score} 分`, align: "end", weight: "bold", size: "md" }
                ]
              }
            ]
          }
        }
      }]
    };

    await axios.post("https://api.line.me/v2/bot/message/push", linePayload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });
    console.log(`✅ 已推播給 ${studentName}`);
  } catch (err) {
    console.error("LINE 推播失敗");
  }
};

// =================【 新增：OCR 辨識路由 】=================
app.post("/api/ocr-score", async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = "請辨識圖中的『學生姓名』、『科目』、『成績』。只需回傳 JSON：{\"studentName\":\"...\",\"subject\":\"...\",\"score\":100}";
    
    const result = await model.generateContent([
      prompt,
      { inlineData: { data: imageBase64, mimeType: "image/jpeg" } }
    ]);

    const text = result.response.text().replace(/```json|```/g, "").trim();
    res.json(JSON.parse(text));
  } catch (err) {
    res.status(500).json({ message: "辨識失敗" });
  }
});

// =================【 原本的成績存檔路由 (保留) 】=================
app.post("/api/grades", async (req, res) => {
  try {
    const { studentName, subject, score } = req.body;
    const newGrade = new Grade({ studentName, subject, score });
    await newGrade.save();

    // 觸發原本的推播功能
    await sendLinePush(studentName, { subject, score });

    res.status(201).json({ message: "成績已儲存" });
  } catch (err) {
    res.status(500).json({ message: "儲存失敗" });
  }
});

// =================【 原本的統計功能 (保留) 】=================
app.get("/api/statistics", async (req, res) => {
  try {
    const buckets = [
      { min: 0, max: 9, label: "0~9" }, { min: 10, max: 19, label: "10~19" },
      { min: 20, max: 29, label: "20~29" }, { min: 30, max: 39, label: "30~39" },
      { min: 40, max: 49, label: "40~49" }, { min: 50, max: 59, label: "50~59" },
      { min: 60, max: 69, label: "60~69" }, { min: 70, max: 79, label: "70~79" },
      { min: 80, max: 89, label: "80~89" }, { min: 90, max: 100, label: "90~100" }
    ];
    const subjects = await Grade.distinct("subject");
    const results = [];
    for (const subject of subjects) {
      const distribution = {};
      buckets.forEach(b => (distribution[b.label] = 0));
      const grades = await Grade.find({ subject });
      grades.forEach(g => {
        const b = buckets.find(b => g.score >= b.min && g.score <= b.max);
        if (b) distribution[b.label]++;
      });
      results.push({ subject, distribution });
    }
    res.status(200).json({ data: results });
  } catch (err) {
    res.status(500).json({ message: "統計失敗" });
  }
});

// =================【 啟動伺服器 】=================
app.listen(port, () => {
  console.log(`🚀 系統運行中：http://localhost:${port}`);
});
